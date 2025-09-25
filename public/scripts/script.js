// app.js (full merged file with correct icons)
document.addEventListener("DOMContentLoaded", () => {
  const toggleBtn = document.querySelector(".menu-toggle");
  const sideMenu = document.querySelector(".side-menu");
  const overlay = document.querySelector(".menu-overlay");
  const profileIcon = document.getElementById("profile-icon");
  const signInLink = document.getElementById("sign-in-link");
  const cmsLink = document.getElementById("cms-link");
  const cmsLinkDesktop = document.getElementById("cms-link-desktop");
  const searchBtn = document.querySelector(".search-btn");
  const subscribeLinks = document.querySelectorAll(".header-subscribe-link");
  const sideSubscribeLink = document.querySelector("#side-header-subscribe-link");

  const THUMBNAIL_BASE_URL =
    "https://pub-ca86c708c96b412c8950da6a69e053d7.r2.dev";

  /* ---------------- Menu open/close ---------------- */
  function openMenu() {
    sideMenu?.classList.add("open");
    overlay?.classList.add("show");
    sideMenu?.setAttribute("aria-hidden", "false");
    overlay?.setAttribute("aria-hidden", "false");
  }
  function closeMenu() {
    sideMenu?.classList.remove("open");
    overlay?.classList.remove("show");
    sideMenu?.setAttribute("aria-hidden", "true");
    overlay?.setAttribute("aria-hidden", "true");
  }

  toggleBtn?.addEventListener("click", openMenu);
  overlay?.addEventListener("click", closeMenu);

  // Close menu on link click
  sideMenu?.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => setTimeout(closeMenu, 120))
  );

  // Simple swipe detection: swipe right to open, swipe left to close
  let touchStartX = 0;
  document.addEventListener("touchstart", (e) => {
    if (!e.touches?.length) return;
    touchStartX = e.touches[0].clientX;
  });
  document.addEventListener("touchend", (e) => {
    if (!e.changedTouches?.length) return;
    const touchEndX = e.changedTouches[0].clientX;
    if (touchStartX < 40 && touchEndX > touchStartX + 60) openMenu();
    if (
      sideMenu?.classList.contains("open") &&
      touchStartX > 40 &&
      touchEndX < touchStartX - 60
    )
      closeMenu();
  });

  /* -------------- Course loader -------------- */
  async function loadCourses() {
    try {
      const res = await fetch("/api/courses");
      if (!res.ok) throw new Error("Failed to fetch courses");
      const courses = await res.json();
      const grid = document.getElementById("courseGrid");
      if (!grid) return;
      grid.innerHTML = "";

      // check user
      let loggedIn = false;
      let user = null;
      try {
        const resUser = await fetch("/me");
        if (resUser.ok) {
          user = await resUser.json();
          loggedIn = true;
        }
      } catch (_) {}

      courses.forEach((course) => {
        const thumbUrl = course.thumbnailKey
          ? `${THUMBNAIL_BASE_URL}/${course.thumbnailKey}`
          : "fallback.jpg";
        let courseUrl;
        if (!loggedIn) {
          courseUrl = `/login?redirect=/subscribe?redirect=/courses/${course._id}`;
        } else if (user?.role === "admin" || user?.isSubscribed) {
          courseUrl = `/courses/${course._id}`;
        } else {
          courseUrl = `/subscribe?redirect=/courses/${course._id}`;
        }

        const card = document.createElement("div");
        card.className = "course-card";
        card.innerHTML = `
          <div class="image-wrapper">
            <img src="${thumbUrl}" alt="${escapeHtml(course.title)}" />
            <div class="meta-row">
              <div class="class-count">
                ${course.episodeCount} ${
          course.episodeCount == 1 ? "Class" : "Classes"
        }
              </div>
            </div>
          </div>
          <h2>${escapeHtml(course.title)}</h2>
          <p>${escapeHtml(course.description || "")}</p>
          <a href="${courseUrl}" class="btn enroll-btn">Enroll Now</a>
        `;
        grid.appendChild(card);
      });
    } catch (err) {
      console.error("Error loading courses:", err);
      const grid = document.getElementById("courseGrid");
      if (grid) grid.innerHTML = `<p>Could not load courses.</p>`;
    }
  }

  function escapeHtml(s = "") {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* -------------- Login state & UI updates -------------- */
  (async function initUserState() {
    try {
      const resUser = await fetch("/me");
      if (!resUser.ok) {
        // logged out — show default icons
        if (profileIcon) {
          profileIcon.href = "/login";
          profileIcon.innerHTML = `<i class="fa fa-user"></i>`;
          profileIcon.title = "Sign In";
        }
        if (signInLink) {
          signInLink.innerHTML = `<i class="fa fa-user"></i> Sign In`;
          signInLink.href = "/login";
        }
        subscribeLinks.forEach((l) => {
          l.href = "/login?redirect=/subscribe";
        });
        return;
      }

      const user = await resUser.json();

      // admin CMS links
      if (user?.role === "admin") {
        cmsLink && (cmsLink.style.display = "block");
        cmsLinkDesktop && (cmsLinkDesktop.style.display = "block");
        subscribeLinks.forEach((l) => {
          l.href = "#courses";
        });
        sideSubscribeLink.style.display = "none";
      }
      else if (user?.role === "user" && user?.isSubscribed) {
        subscribeLinks.forEach((l) => {
          l.href = "#courses";
        });
      }
      // profile icon -> logout
      if (profileIcon) {
        profileIcon.href = "#";
        profileIcon.title = "Log Out";
        profileIcon.innerHTML = `<i class="fa fa-sign-out-alt"></i>`;
        profileIcon.replaceWith(profileIcon.cloneNode(true));
        const newProfile = document.getElementById("profile-icon");
        newProfile?.addEventListener("click", async (e) => {
          e.preventDefault();
          try {
            const resLogout = await fetch("/api/logout", { method: "POST" });
            if (resLogout.ok) window.location.href = "/";
            else {
              const data = await resLogout.json();
              alert(data?.error || "Logout failed");
            }
          } catch (_) {
            alert("Logout failed");
          }
        });
      }

      // side menu sign-out
      if (signInLink) {
        signInLink.innerHTML = `<i class="fa fa-sign-out-alt"></i> Sign Out`;
        signInLink.href = "#";
        signInLink.replaceWith(signInLink.cloneNode(true));
        const newSign = document.getElementById("sign-in-link");
        newSign?.addEventListener("click", async (e) => {
          e.preventDefault();
          const resLogout = await fetch("/api/logout", { method: "POST" });
          if (resLogout.ok) {
            window.location.href = "/";
          } else {
            const data = await resLogout.json();
            alert(data?.error || "Logout failed");
          }
        });
      }
    } catch (err) {
      console.warn("Could not fetch /me:", err);
    }
  })();

  searchBtn?.addEventListener("click", () => {
    const q = prompt("Search courses:");
    if (q) window.location.href = `/search?q=${encodeURIComponent(q.trim())}`;
  });

  loadCourses();
});
