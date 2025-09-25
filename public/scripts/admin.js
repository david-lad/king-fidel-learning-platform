// -------------------- Constants --------------------
const THUMBNAIL_BASE_URL =
  "https://pub-ca86c708c96b412c8950da6a69e053d7.r2.dev";
const MAX_RETRIES = 3;
const progressBar = document.getElementById("videoProgress");
let currentUploadController = null;
let currentUploadInfo = null;      
let uploadInProgress = false;
let uploadCancelled = false;
// -------------------- Helpers --------------------
async function uploadFileWithRetry(endpoint, file, type = "file") {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const formData = new FormData();
      formData.append(type, file);

      const res = await fetch(endpoint, {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!res.ok) throw new Error(`Upload failed (status ${res.status})`);
      return await res.json();
    } catch (err) {
      console.warn(`Upload attempt ${attempt} failed:`, err);
      if (attempt === MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt)); // exponential backoff
    }
  }
}

async function uploadFile(endpoint, file, type = "file") {
  const formData = new FormData();
  formData.append(type, file);
  const res = await fetch(endpoint, {
    method: "POST",
    body: formData,
    credentials: "include",
  });
  if (!res.ok) {
    showNotification("Upload failed", "error", 2000);
    throw new Error("Upload failed");
  }
  return res.json();
}

async function uploadLargeVideo(file) {
  if (uploadInProgress) throw new Error("Another upload is in progress");
  
  uploadInProgress = true;
  uploadCancelled = false;
  currentUploadController = new AbortController();
  const signal = currentUploadController.signal;

  // show and reset progress UI
  try {
    progressBar.style.display = "block";
    progressBar.value = 0;

    // start multipart upload
    const startResp = await fetch("/admin/multipart/start-video-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ filename: file.name, contentType: file.type }),
      signal,
    });

    if (!startResp.ok) {
      throw new Error("Could not start multipart upload");
    }

    const { key, uploadId } = await startResp.json();
    currentUploadInfo = { key, uploadId };

    showNotification("Upload Started", "info", 2000);

    const chunkSize = 20 * 1024 * 1024; // 20MB
    const totalParts = Math.ceil(file.size / chunkSize);
    const parts = [];
    let partNumber = 1;

    for (let start = 0; start < file.size; start += chunkSize, partNumber++) {
      // if user aborted, signal.aborted will be true and fetch will throw
      if (uploadCancelled || signal.aborted) throw new Error("Upload aborted");

      const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
      const fd = new FormData();
      fd.append("part", chunk);
      fd.append("key", key);
      fd.append("uploadId", uploadId);
      fd.append("partNumber", partNumber);

      const uploadPartResp = await fetch("/admin/multipart/upload-part", {
        method: "POST",
        body: fd,
        credentials: "include",
        signal,
      });

      if (!uploadPartResp.ok) throw new Error("Upload part failed");
      const { ETag } = await uploadPartResp.json();
      parts.push({ ETag, PartNumber: partNumber });

      // update progress
      progressBar.value = Math.round((parts.length / totalParts) * 100);
    }

    // complete multipart
    const completeResp = await fetch("/admin/multipart/complete-video-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ key, uploadId, parts }),
      signal,
    });

    if (!completeResp.ok) throw new Error("Could not complete upload");

    progressBar.value = 100;
    showNotification("Upload Completed", "success");

    // small delay so UI doesn't flicker
    await new Promise((r) => setTimeout(r, 400));
    progressBar.style.display = "none";
    progressBar.value = 0;
    return { key };
  } catch (err) {
    // If aborted by controller or we intentionally throw 'Upload aborted',
    // ensure server-side multipart is aborted (best-effort).
    if (currentUploadInfo) {
      try {
        await fetch("/admin/multipart/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(currentUploadInfo),
        });
      } catch (e) {
        console.error("Failed to call abort endpoint:", e);
      }
    }

    // hide/reset progress UI
    progressBar.style.display = "none";
    progressBar.value = 0;

    // rethrow a recognizable error so callers can stop processing
    throw new Error("Upload aborted");
  } finally {
    // cleanup local state
    uploadInProgress = false;
    currentUploadController = null;
    currentUploadInfo = null;
    uploadCancelled = false;
  }
}

// -------------------- Courses --------------------
const courseForm = document.getElementById("courseForm");
const courseSubmitBtn = courseForm.querySelector("button[type='submit']");

// Track original preview for cancel
let originalCourseThumb = "";

// Save course
async function saveCourse(e) {
  e.preventDefault();
  courseSubmitBtn.classList.add("loading");

  try {
    const title = document.getElementById("courseTitle").value;
    const description = document.getElementById("courseDescription").value;
    const file = document.getElementById("courseThumbnail").files[0];

    const editingId = courseForm.dataset.editingId;

    if (!editingId && !file) {
      showNotification("Please upload a course thumbnail", "error");
      return;
    }

    let thumbnailKey = "";
    if (file) {
      const up = await uploadFileWithRetry(
        "/admin/upload-course-thumbnail",
        file,
        "thumbnail"
      );
      thumbnailKey = up.key;
    }

    let url = "/admin/courses";
    let method = "POST";
    if (editingId) {
      url += `/${editingId}`;
      method = "PUT";
    }

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ title, description, thumbnailKey }),
    });

    if (!res.ok) return showNotification("Could not save course", "error");

    showNotification(editingId ? "Course updated!" : "Course created!");

    // Reset form & preview
    courseForm.reset();
    delete courseForm.dataset.editingId;
    courseForm.classList.remove("editing");
    courseSubmitBtn.textContent = "Create Course";
    courseThumbnailPreview.style.display = "none";
    courseThumbnailPreview.src = "";
    originalCourseThumb = "";

    loadCourses();
  } finally {
    courseSubmitBtn.classList.remove("loading");
  }
}

// Cancel course edit
async function cancelEpisodeEdit() {
  // If an upload is running, request abort
  if (uploadInProgress && currentUploadController) {
    try {
      uploadCancelled = true;
      currentUploadController.abort(); // this will cause in-flight fetch() to reject
    } catch (e) {
      console.warn("Abort controller error:", e);
    }

    // also attempt server-side abort (if currentUploadInfo is present)
    if (currentUploadInfo) {
      try {
        await fetch("/admin/multipart/abort", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(currentUploadInfo),
        });
      } catch (e) {
        console.error("Abort endpoint call failed:", e);
      }
    }
  }

  // Reset UI + form (existing logic)
  episodeForm.reset();
  episodeForm.classList.remove("editing");
  delete episodeForm.dataset.editingId;
  epSubmitBtn.textContent = "Add New Class";
  originalEpisodeThumb = "";
  originalEpisodeVideoText = "";
  if (originalEpisodeThumb) {
    episodeThumbPreview.src = originalEpisodeThumb;
    episodeThumbPreview.style.display = "block";
  } else {
    episodeThumbPreview.style.display = "none";
  }

  if (originalEpisodeVideoText) {
    episodeVideoPreview.textContent = originalEpisodeVideoText;
    episodeVideoPreview.style.display = "block";
  } else {
    episodeVideoPreview.style.display = "none";
  }

  document.querySelectorAll(".episode-item").forEach((e) => {
    e.classList.remove("editing");
  });

  // Ensure progress UI fully hidden
  progressBar.style.display = "none";
  progressBar.value = 0;

  showNotification("Edit cancelled", "info", 2000);
}

function cancelCourseEdit() {
  courseForm.reset();
  courseForm.classList.remove("editing");
  delete courseForm.dataset.editingId;
  courseSubmitBtn.textContent = "Create Course";
  originalCourseThumb = "";
  if (originalCourseThumb) {
    courseThumbnailPreview.src = originalCourseThumb;
    courseThumbnailPreview.style.display = "block";
  } else {
    courseThumbnailPreview.style.display = "none";
  }
  document.querySelectorAll(".course-item").forEach((e) => {
    e.classList.remove("editing");
  });
  progressBar.style.display = "none";
  progressBar.value = 0;
}

// Load courses
async function loadCourses() {
  const res = await fetch("/api/courses");
  const courses = await res.json();
  const list = document.getElementById("coursesList");
  const select = document.getElementById("courseSelect");
  list.innerHTML = "";
  select.innerHTML = "";

  courses.forEach((c) => {
    const option = document.createElement("option");
    option.value = c._id;
    option.textContent = c.title;
    select.appendChild(option);

    const thumbUrl = c.thumbnailKey
      ? `${THUMBNAIL_BASE_URL}/${c.thumbnailKey}`
      : "fallback.jpg";

    const div = document.createElement("div");
    div.className = "course-item";
    div.innerHTML = `
      <img src="${thumbUrl}" alt="${c.title}">
      <div>
        <h3>${c.title}</h3>
        <p>${c.description || ""}</p>
        <button data-id="${c._id}" class="edit-course-btn">Edit</button>
        <button data-id="${c._id}" class="deleteBtn">Delete</button>
      </div>
    `;
    list.appendChild(div);
  });

  // Edit course
  list.querySelectorAll(".edit-course-btn").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const id = e.target.dataset.id;
      const course = await (
        await fetch(`/api/courses/${id}`, { credentials: "include" })
      ).json();

      document.getElementById("courseTitle").value = course.title;
      document.getElementById("courseDescription").value =
        course.description || "";
      courseForm.dataset.editingId = id;
      courseForm.classList.add("editing");
      courseSubmitBtn.textContent = "Update Course";

      const thumbnailPreview = document.getElementById(
        "courseThumbnailPreview"
      );
      if (course.thumbnailKey) {
        originalCourseThumb = `${THUMBNAIL_BASE_URL}/${course.thumbnailKey}`;
        thumbnailPreview.src = originalCourseThumb;
        thumbnailPreview.style.display = "block";
      } else {
        originalCourseThumb = "";
        thumbnailPreview.style.display = "none";
      }

      document
        .querySelectorAll(".course-item")
        .forEach((item) => item.classList.remove("editing"));
      btn.closest(".course-item").classList.add("editing");

      showNotification(
        "Editing course. Upload a new thumbnail to replace the old one.",
        "info",
        4000
      );
    })
  );

  // Delete course
  list.querySelectorAll(".deleteBtn").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      if (!confirm("Delete this course?")) return;
      const id = e.target.dataset.id;
      const res = await fetch(`/admin/courses/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        showNotification("Course Deleted", "success");
        loadCourses();
        loadEpisodes();
      } else showNotification("Delete failed", "error");
    })
  );

  if (select.value) loadEpisodes(select.value);
}

// -------------------- Episodes --------------------
const episodeForm = document.getElementById("episodeForm");
const epSubmitBtn = episodeForm.querySelector("button[type='submit']");
let originalEpisodeThumb = "";
let originalEpisodeVideoText = "";

// Save episode
episodeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  epSubmitBtn.classList.add("loading");

  try {
    const courseId = document.getElementById("courseSelect").value;
    if (!courseId) return showNotification("Please select a course", "error");

    const title = document.getElementById("episodeTitle").value;
    const description = document.getElementById("episodeDescription").value;
    const order = parseInt(document.getElementById("episodeOrder").value, 10);

    const editingId = episodeForm.dataset.editingId;
    const videoFile = document.getElementById("episodeVideo").files[0];
    const thumbFile = document.getElementById("episodeThumb").files[0];

    if (!editingId) {
      if (!videoFile) return showNotification("Please upload a video", "error");
      if (!thumbFile)
        return showNotification("Please upload a thumbnail", "error");
    }

    const courseRes = await fetch(`/api/courses/${courseId}`, {
      credentials: "include",
    });
    if (!courseRes.ok)
      return showNotification("Could not fetch course info", "error");
    const course = await courseRes.json();
    const duplicate = course.episodes?.find(
      (ep) => ep.order === order && ep._id !== editingId
    );
    if (duplicate)
      return showNotification(`Class order ${order} already exists`, "error");

    let videoKey = "";
    let thumbnailKey = "";
    if (videoFile)
      videoKey =
        videoFile.size > 20 * 1024 * 1024
          ? (await uploadLargeVideo(videoFile)).key
          : (
              await uploadFileWithRetry(
                "/admin/upload-episode-video",
                videoFile,
                "video"
              )
            ).key;
    if (thumbFile)
      thumbnailKey = (
        await uploadFileWithRetry(
          "/admin/upload-episode-thumbnail",
          thumbFile,
          "thumbnail"
        )
      ).key;

    let url = `/admin/courses/${courseId}/episodes`;
    let method = "POST";
    if (editingId) {
      url += `/${editingId}`;
      method = "PUT";
    }

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        title,
        description,
        order,
        videoKey,
        thumbnailKey,
      }),
    });

    if (!res.ok) return showNotification("Could not save episode", "error");

    showNotification(editingId ? "Class updated!" : "Episode added!");

    episodeForm.reset();
    delete episodeForm.dataset.editingId;
    episodeForm.classList.remove("editing");
    epSubmitBtn.textContent = "Add New Class";
    episodeThumbPreview.style.display = "none";
    episodeThumbPreview.src = "";
    episodeVideoPreview.style.display = "none";
    episodeVideoPreview.textContent = "";
    originalEpisodeThumb = "";
    originalEpisodeVideoText = "";

    loadEpisodes(courseId);
  } finally {
    epSubmitBtn.classList.remove("loading");
  }
});


// Load episodes
async function loadEpisodes(courseId) {
  const list = document.getElementById("episodesList");
  list.innerHTML = "<p>Loading...</p>";

  const res = await fetch(`/admin/courses/${courseId}/episodes`, {
    credentials: "include",
  });
  if (!res.ok) return (list.innerHTML = "<p>Could not load classes</p>");

  const episodes = await res.json();
  list.innerHTML = episodes.length === 0 ? "No classes uploaded yet" : "";

  episodes
    .sort((a, b) => a.order - b.order)
    .forEach((ep) => {
      const thumbUrl = ep.thumbnailKey
        ? `${THUMBNAIL_BASE_URL}/${ep.thumbnailKey}`
        : "fallback.jpg";

      const div = document.createElement("div");
      div.className = "episode-item";
      div.innerHTML = `
      <img src="${thumbUrl}" alt="${ep.title}" />
      <div class="episode-info">
        <h4>${ep.order}. ${ep.title}</h4>
        <p>${ep.description || ""}</p>
        <button data-id="${ep._id}" class="edit-episode-btn">Edit</button>
        <button data-id="${ep._id}" class="delete-episode-btn">Delete</button>
      </div>
    `;
      list.appendChild(div);
    });

  // Delete episode
  list.querySelectorAll(".delete-episode-btn").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      if (!confirm("Delete this class?")) return;
      const id = e.target.dataset.id;
      const res = await fetch(`/admin/episodes/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) {
        showNotification("Episode deleted", "success");
        loadEpisodes(courseId);
      } else showNotification("Delete failed", "error");
    })
  );

  // Edit episode
  list.querySelectorAll(".edit-episode-btn").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const id = e.target.dataset.id;
      const ep = episodes.find((x) => x._id === id);
      if (!ep) return showNotification("Class not found", "error");

      document.getElementById("episodeTitle").value = ep.title;
      document.getElementById("episodeDescription").value =
        ep.description || "";
      document.getElementById("episodeOrder").value = ep.order;

      episodeForm.dataset.editingId = id;
      episodeForm.classList.add("editing");
      epSubmitBtn.textContent = "Update Episode";

      // Show thumbnail
      const thumbPreview = document.getElementById("episodeThumbPreview");
      if (ep.thumbnailKey) {
        originalEpisodeThumb = `${THUMBNAIL_BASE_URL}/${ep.thumbnailKey}`;
        thumbPreview.src = originalEpisodeThumb;
        thumbPreview.style.display = "block";
      } else {
        originalEpisodeThumb = "";
        thumbPreview.style.display = "none";
      }

      // Show video
      const videoPreview = document.getElementById("episodeVideoPreview");
      if (ep.videoKey) {
        originalEpisodeVideoText = `Current video: ${ep.title}`;
        videoPreview.textContent = originalEpisodeVideoText;
        videoPreview.style.display = "block";
      } else {
        originalEpisodeVideoText = "";
        videoPreview.style.display = "none";
      }

      // Highlight currently editing
      document
        .querySelectorAll(".episode-item")
        .forEach((item) => item.classList.remove("editing"));
      btn.closest(".episode-item").classList.add("editing");

      showNotification(
        "Editing class. Upload new files to replace the old ones.",
        "info"
      );
    })
  );
}

// -------------------- File input previews --------------------
const courseThumbnailInput = document.getElementById("courseThumbnail");
const courseThumbnailPreview = document.getElementById(
  "courseThumbnailPreview"
);
courseThumbnailInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    courseThumbnailPreview.src = URL.createObjectURL(file);
    courseThumbnailPreview.style.display = "block";
  } else {
    courseThumbnailPreview.style.display = "none";
  }
});

const episodeThumbInput = document.getElementById("episodeThumb");
const episodeThumbPreview = document.getElementById("episodeThumbPreview");
episodeThumbInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    episodeThumbPreview.src = URL.createObjectURL(file);
    episodeThumbPreview.style.display = "block";
  } else {
    episodeThumbPreview.style.display = "none";
  }
});

const episodeVideoInput = document.getElementById("episodeVideo");
const episodeVideoPreview = document.getElementById("episodeVideoPreview");
episodeVideoInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    episodeVideoPreview.textContent = `New video selected: ${file.name}`;
    episodeVideoPreview.style.display = "block";
  } else {
    episodeVideoPreview.style.display = "none";
  }
});

// -------------------- Event bindings --------------------
courseForm.addEventListener("submit", saveCourse);
document
  .getElementById("cancelCourseEdit")
  .addEventListener("click", cancelCourseEdit);
document
  .getElementById("cancelEpisodeEdit")
  .addEventListener("click", cancelEpisodeEdit);
document.getElementById("courseSelect").addEventListener("change", (e) => {
  const courseId = e.target.value;
  if (courseId) loadEpisodes(courseId);
});

// Initialize
document.addEventListener("DOMContentLoaded", () => loadCourses());
