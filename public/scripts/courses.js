const THUMBNAIL_BASE_URL =
  "https://pub-ca86c708c96b412c8950da6a69e053d7.r2.dev";
const completedEpisodes = new Set();
let currentCourseId = null;
let episodesCache = [];
// courses.js
async function manageHeaderLinks() {
  // DOM refs (some optional)
  const toggleBtn = document.querySelector(".menu-toggle");
  const sideMenu = document.querySelector(".side-menu");
  const overlay = document.querySelector(".menu-overlay");
  const profileIcon = document.getElementById("profile-icon");
  const signInLink = document.getElementById("sign-in-link");
  const cmsLink = document.getElementById("cms-link");
  const cmsLinkDesktop = document.getElementById("cms-link-desktop");
  const searchBtn = document.querySelector(".search-btn");
  const subscribeLinks = document.querySelectorAll(
    '.header-subscribe-link, a[href="/subscribe"]'
  );

  // ---- Focus trap helpers ----
  let focusables = [];
  let firstFocusable = null;
  let lastFocusable = null;
  function handleTrap(e) {
    if (e.key === "Tab") {
      if (!focusables.length) return;
      // shift + tab
      if (e.shiftKey) {
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable.focus();
        }
      } else {
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable.focus();
        }
      }
    }
    if (e.key === "Escape") {
      closeMenu();
      toggleBtn?.focus();
    }
  }
  function trapFocus(container) {
    if (!container) return;
    focusables = Array.from(
      container.querySelectorAll(
        'a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute("disabled"));
    if (!focusables.length) return;
    firstFocusable = focusables[0];
    lastFocusable = focusables[focusables.length - 1];
    firstFocusable.focus();
    document.addEventListener("keydown", handleTrap);
  }

  // ---- Menu open/close ----
  function openMenu() {
    sideMenu?.classList.add("open");
    overlay?.classList.add("show");
    sideMenu?.setAttribute("aria-hidden", "false");
    overlay?.setAttribute("aria-hidden", "false");
    trapFocus(sideMenu);
  }
  function closeMenu() {
    sideMenu?.classList.remove("open");
    overlay?.classList.remove("show");
    sideMenu?.setAttribute("aria-hidden", "true");
    overlay?.setAttribute("aria-hidden", "true");
    document.removeEventListener("keydown", handleTrap);
  }

  // attach toggle / overlay handlers safely
  toggleBtn?.addEventListener("click", openMenu);
  overlay?.addEventListener("click", closeMenu);

  // ensure side menu links close menu when clicked
  if (sideMenu) {
    sideMenu.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => setTimeout(closeMenu, 120));
    });
  }

  // swipe detection for mobile: swipe right from left edge opens, swipe left closes
  let touchStartX = 0;
  document.addEventListener("touchstart", (e) => {
    if (!e.touches?.length) return;
    touchStartX = e.touches[0].clientX;
  });
  document.addEventListener("touchend", (e) => {
    if (!e.changedTouches?.length) return;
    const touchEndX = e.changedTouches[0].clientX;
    if (touchStartX < 40 && touchEndX > touchStartX + 60) openMenu(); // open
    if (
      sideMenu?.classList.contains("open") &&
      touchStartX > 40 &&
      touchEndX < touchStartX - 60
    )
      closeMenu(); // close
  });

  // ---- Small helper: logout flow ----
  async function doLogout() {
    try {
      const res = await fetch("/api/logout", { method: "POST" });
      if (res.ok) {
        window.location.href = "/";
      } else {
        const data = await res.json();
        const msg = data?.error || "Logout failed";
        if (typeof showNotification === "function")
          showNotification(msg, "error");
        else alert(msg);
      }
    } catch (err) {
      if (typeof showNotification === "function")
        showNotification("Logout failed", "error");
      else alert("Logout failed");
    }
  }

  // ---- Provide default UI for logged-out users while we fetch /me ----
  try {
    const resUser = await fetch("/me");
    if (!resUser.ok) {
      // Not logged in: profile/icon -> login, sign-in link points to /login
      if (profileIcon) {
        profileIcon.href = `/login?redirect=${window.location.pathname}`;
        profileIcon.innerHTML = `<i class="fa fa-user"></i>`;
        profileIcon.title = "Sign In";
      }
      if (signInLink) {
        signInLink.innerHTML = `<i class="fa fa-user"></i> Sign In`;
        signInLink.href = `/login?redirect=${window.location.pathname}`;
      }
      // subscribe links should go to login so user signs in first
      subscribeLinks.forEach((el) => (el.href = `/login?redirect=/subscribe?redirect=${window.location.pathname}`));
      // hide/manage subscription control if present
      if (manageSubscriptionLink) manageSubscriptionLink.style.display = "none";
      if (cmsLink) cmsLink.style.display = "none";
      if (cmsLinkDesktop) cmsLinkDesktop.style.display = "none";
      // attach search handler (safe)
      if (searchBtn) {
        searchBtn.addEventListener("click", () => {
          const q = prompt("Search courses:");
          if (q)
            window.location.href = `/search?q=${encodeURIComponent(q.trim())}`;
        });
      }
      return;
    }

    // logged in
    const user = await resUser.json();
    // optional welcome
    if (typeof showNotification === "function")
      showNotification("Welcome, " + (user.fullName || "User"), "info");

    // CMS links visible for admin
    if (user?.role === "admin") {
      // show CMS links
      if (cmsLink) cmsLink.style.display = "block";
      if (cmsLinkDesktop) cmsLinkDesktop.style.display = "block";
      // hide all subscribe links for admins
      subscribeLinks.forEach((el) => {
        el.style.display = "none";
      });
    } else {
      // non-admins: set href according to subscription status
      if (user?.isSubscribed) {
        subscribeLinks.forEach((el) => {
          el.style.display = "";
          el.href = "#courses";
        });
      } else {
        subscribeLinks.forEach((el) => {
          el.style.display = "";
          el.href = `/subscribe?redirect=${window.location.pathname}`;
        });
      }
    }

    // subscribe links: subscribed -> #courses, else -> /subscribe
    if (user?.isSubscribed) {
      subscribeLinks.forEach((el) => (el.href = "#courses"));
    } else {
      subscribeLinks.forEach((el) => (el.href = `/subscribe?redirect=${window.location.pathname}`));
    }

    // profile icon -> logout (header)
    if (profileIcon) {
      profileIcon.href = "#";
      profileIcon.title = "Log Out";
      profileIcon.innerHTML = `<i class="fa fa-sign-out-alt"></i>`;
      // remove old handlers safely by replacing node then adding handler
      profileIcon.replaceWith(profileIcon.cloneNode(true));
      const newProfile = document.getElementById("profile-icon");
      newProfile?.addEventListener("click", async (e) => {
        e.preventDefault();
        await doLogout();
      });
    }

    // side-menu sign-in link -> Sign Out (with icon)
    if (signInLink) {
      signInLink.innerHTML = `<i class="fa fa-sign-out-alt"></i> Sign Out`;
      signInLink.href = "#";
      signInLink.replaceWith(signInLink.cloneNode(true));
      const newSign = document.getElementById("sign-in-link");
      newSign?.addEventListener("click", async (e) => {
        e.preventDefault();
        await doLogout();
      });
    }

    if (searchBtn) {
      searchBtn.addEventListener("click", () => {
        const q = prompt("Search courses:");
        if (q)
          window.location.href = `/search?q=${encodeURIComponent(q.trim())}`;
      });
    }
  } catch (err) {
    console.warn("manageHeaderLinks error:", err);
    if (profileIcon) {
      profileIcon.href = `/login?redirect=${window.location.pathname}`;
      profileIcon.innerHTML = `<i class="fa fa-user"></i>`;
      profileIcon.title = "Sign In";
    }
    subscribeLinks.forEach((el) => (el.href = `/login?redirect=${window.location.pathname}`));
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  manageHeaderLinks();
  // derive courseId from URL path /course/:id
  const parts = window.location.pathname.split("/");
  const courseId = parts[parts.length - 1];
  currentCourseId = courseId;

  await loadCourse(courseId);
  episodesCache = await loadEpisodes(courseId);

  // auto-mark complete when video ends
  const player = document.getElementById("episodePlayer");
  if (player) {
    player.addEventListener("ended", async () => {
      if (window.currentEpisodeOrder) {
        await markEpisodeComplete(courseId, window.currentEpisodeOrder);
        // refresh episodesCache & completedEpisodes
        episodesCache = await loadEpisodes(courseId);

        const autoplayOn = document.getElementById("autoplayToggle").checked;
        if (autoplayOn) {
          const nextOrder = window.currentEpisodeOrder + 1;
          const nextEp = episodesCache.find((e) => e.order === nextOrder);
          if (
            nextEp &&
            (nextOrder === 1 || completedEpisodes.has(nextOrder - 1))
          ) {
            playEpisode(courseId, nextOrder);
            highlightPlaying(nextOrder);
          } else {
            showNotification("You’ve reached the last class.", "info");
          }
        }
      }
    });
    if (player.paused) {
      player.play();
    }
  }
});

async function loadCourse(courseId) {
  const res = await fetch(`/api/courses/${courseId}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Could not load course");
  const course = await res.json();
  document.querySelector("title").innerHTML = course.title + " - King Fidel";
  document.getElementById("courseTitle").textContent = course.title;
  document.getElementById("courseDescription").textContent = course.description;
  document.getElementById("courseThumb").src = course.thumbnailKey
    ? `${THUMBNAIL_BASE_URL}/${course.thumbnailKey}`
    : "fallback.jpg";
}

async function loadEpisodes(courseId) {
  const list = document.getElementById("episodesList");
  const res = await fetch(`/api/courses/${courseId}/episodes`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Could not load classes");
  const data = await res.json();

  const episodes = data.episodes;
  completedEpisodes.clear();
  (data.progress || []).forEach((order) => completedEpisodes.add(order));

  // class count
  document.getElementById("classCount").textContent = `${
    episodes.length
  } Class${episodes.length !== 1 ? "es" : ""}`;

  // ✅ update main course thumbnail progress
  const totalClasses = episodes.length;
  const completedClasses = completedEpisodes.size;
  const percentDone =
    totalClasses > 0 ? (completedClasses / totalClasses) * 100 : 0;

  const thumbProgress = document.getElementById("thumbProgress");
  if (thumbProgress) {
    thumbProgress.style.width = percentDone + "%";
    thumbProgress.title = `${Math.round(percentDone)}% complete`;
  }

  list.innerHTML = "";
  if (episodes.length < 1) {
    list.innerHTML = "No classes yet for this course.";
    return;
  }

  episodes
    .sort((a, b) => a.order - b.order)
    .forEach((ep) => {
      const thumbUrl = ep.thumbnailKey
        ? `${THUMBNAIL_BASE_URL}/${ep.thumbnailKey}`
        : "fallback.jpg";

      const div = document.createElement("div");
      div.className = "episode-item" + (ep.locked ? " locked" : "");
      div.dataset.order = ep.order;

      // badge state
      let badgeText = "";
      let badgeClass = "";
      if (ep.completed) {
        badgeText = "Completed";
        badgeClass = "completed";
      } else if (ep.locked) {
        badgeText = "Locked";
        badgeClass = "locked";
      } else {
        badgeText = "Unlocked";
        badgeClass = "unlocked";
      }

      div.innerHTML = `
      <div class="episode-thumb">
        <img src="${thumbUrl}" alt="${ep.title}">
      </div>
      <div class="episode-details">
        <div style="display:flex;align-items:center;gap:6px">
          <strong>${ep.order}. ${ep.title}</strong>
          <span class="badge ${badgeClass}" id="badge-${ep.order}">
            ${badgeText}
          </span>
        </div>
        <small>${ep.description || ""}</small>
      </div>
    `;

      if (!ep.locked) {
        div.addEventListener("click", () => {
          if (ep.order === 1 || completedEpisodes.has(ep.order - 1)) {
            playEpisode(courseId, ep.order);
            highlightPlaying(ep.order);
          } else {
            showNotification("Please complete previous class first", "info");
          }
        });
      }

      list.appendChild(div);
    });

  // ✅ auto-load the furthest unlocked or first episode
  const maxCompleted = (data.progress || []).length
    ? Math.max(...data.progress)
    : 0;

  let orderToPlay = maxCompleted + 1;
  const candidate = episodes.find(
    (ep) => ep.order === orderToPlay && !ep.locked
  );
  if (!candidate) {
    orderToPlay = 1;
  }

  playEpisode(courseId, orderToPlay);
  highlightPlaying(orderToPlay);

  return episodes;
}

function highlightPlaying(order) {
  document
    .querySelectorAll(".episode-item")
    .forEach((el) => el.classList.remove("playing"));
  const active = document.querySelector(`.episode-item[data-order='${order}']`);
  if (active) active.classList.add("playing");
}

async function playEpisode(courseId, order) {
  try {
    const res = await fetch(`/api/courses/${courseId}/episodes/${order}`, {
      credentials: "include",
    });
    if (!res.ok) throw new Error("Could not load episode");
    const data = await res.json();

    window.currentEpisodeOrder = order;
    const player = document.getElementById("episodePlayer");
    player.src = data.signedUrl;

    // attempt autoplay
    const playPromise = player.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          player.muted = false; // unmute after autoplay starts
        })
        .catch((err) => console.warn("Autoplay failed:", err));
    }

    document.getElementById("currentEpisodeTitle").textContent =
      data.episode.title;
  } catch (err) {
    console.error(err);
    showNotification("Could not load this class", "error");
  }
}

async function markEpisodeComplete(courseId, order) {
  try {
    const res = await fetch(
      `/api/courses/${courseId}/episodes/${order}/complete`,
      {
        method: "POST",
        credentials: "include",
      }
    );
    if (res.ok) {
      completedEpisodes.add(order);
      const badge = document.getElementById(`badge-${order}`);
      if (badge) {
        badge.textContent = "Completed";
        badge.classList.add("completed");
      }
      showNotification(`Class ${order} completed!`, "success");
    }
  } catch (err) {
    console.error(err);
  }
}
const player = document.getElementById("episodePlayer");
const videoContainer = document.getElementById("videoContainer");
const centerBtn = document.getElementById("playPauseBtn");
const leftOverlay = document.querySelector(".seek-overlay.left");
const rightOverlay = document.querySelector(".seek-overlay.right");
const muteBtn = document.getElementById("muteBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const bottomPlayBtn = document.getElementById("bottomPlayBtn");
const progressBar = document.getElementById("progressBar");
const progressFill = document.getElementById("progressFill");
const progressHandle = document.getElementById("progressHandle");
const timeDisplay = document.getElementById("timeDisplay");
let centerOverlay = document.getElementById("centerOverlay");

// Ensure center overlay spans full width/height except bottom controls
centerOverlay.style.position = "absolute";
centerOverlay.style.top = "0";
centerOverlay.style.left = "0";
centerOverlay.style.width = "100%";
centerOverlay.style.height = "calc(100% - 70px)";
centerOverlay.style.zIndex = "5";
centerOverlay.style.cursor = "pointer";

// Format time display
function formatTime(time) {
  if (!time) return "0:00";

  const hours = Math.floor(time / 3600);
  let minutes = Math.floor((time - hours * 3600) / 60);
  const seconds = Math.floor(time % 60)
    .toString()
    .padStart(2, "0");

  // ✅ if we have at least 1 hour, pad minutes with 2 digits:
  if (hours >= 1) {
    minutes = minutes.toString().padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  } else {
    return `${minutes}:${seconds}`;
  }
}

// Show/hide bottom controls
let controlsTimeout;
function showControls() {
  document.querySelector(".bottom-controls").classList.add("show");
  clearTimeout(controlsTimeout);
  controlsTimeout = setTimeout(() => {
    document.querySelector(".bottom-controls").classList.remove("show");
  }, 3000);
}

// Play/pause toggle
function togglePlay() {
  if (player.paused) player.play();
  else player.pause();
  showControls();
}

// Update bottom play icon
function updatePlayIcon() {
  if (player.paused) {
    bottomPlayBtn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24">
      <polygon points="5,3 19,12 5,21" fill="white"/>
    </svg>`;
    centerBtn.innerHTML = `
    <svg viewBox="0 0 64 64" width="64" height="64">
      <polygon points="16,12 48,32 16,52" fill="white" />
    </svg>`;
  } else {
    bottomPlayBtn.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24">
      <rect x="6" y="4" width="4" height="16" fill="white"/>
      <rect x="14" y="4" width="4" height="16" fill="white"/>
    </svg>`;
    centerBtn.innerHTML = `
    <svg viewBox="0 0 64 64" width="64" height="64">
      <rect x="16" y="12" width="10" height="40" fill="white" />
      <rect x="38" y="12" width="10" height="40" fill="white" />
    </svg>`;
  }
}

// Mute/volume icon update
function updateMuteIcon() {
  if (player.muted) {
    muteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20">
    <!-- speaker -->
    <path fill="white" d="M5 9v6h4l5 5V4l-5 5H5z"/>
    <!-- X / cross -->
    <line x1="18" y1="9" x2="22" y2="13" stroke="white" stroke-width="2"/>
    <line x1="22" y1="9" x2="18" y2="13" stroke="white" stroke-width="2"/>
  </svg>`;
  } else {
    muteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20">
    <!-- speaker -->
    <path fill="white" d="M5 9v6h4l5 5V4l-5 5H5z"/>
    <!-- sound waves -->
    <path fill="white" d="M16.5 12c0-1.77-1-3.29-2.5-4.03v8.06c1.5-.74 2.5-2.26 2.5-4.03z"/>
    <path fill="white" d="M19 12c0 3.31-2.69 6-6 6v-2c2.21 0 4-1.79 4-4s-1.79-4-4-4V6c3.31 0 6 2.69 6 6z"/>
  </svg>`;
  }
}

// Fullscreen icon update
function updateFullscreenIcon() {
  if (document.fullscreenElement) {
    fullscreenBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20">
    <!-- Top-left -->
    <path fill="white" d="M3 3h6v2H5v4H3V3z"/>
    <!-- Top-right -->
    <path fill="white" d="M15 3h6v6h-2V5h-4V3z"/>
    <!-- Bottom-left -->
    <path fill="white" d="M3 15h6v6H3v-6z"/>
    <!-- Bottom-right -->
    <path fill="white" d="M15 15h6v6h-6v-2h4v-4h-2z"/>
  </svg>`;
  } else {
    fullscreenBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20">
    <!-- Top-left -->
    <path fill="white" d="M9 3H3v6h2V5h4V3z"/>
    <!-- Top-right -->
    <path fill="white" d="M21 3h-6v2h4v4h2V3z"/>
    <!-- Bottom-left -->
    <path fill="white" d="M3 15v6h6v-2H5v-4H3z"/>
    <!-- Bottom-right -->
    <path fill="white" d="M15 21h6v-6h-2v4h-4v2z"/>
  </svg>`;
  }
}

// Single vs double click logic
let singleClickTimeout = null;
const DOUBLE_TAP_DELAY = 300; // ms

// --- CENTER OVERLAY ---
// single click pauses/plays and shows center button
centerOverlay.addEventListener("click", (e) => {
  e.stopPropagation();
  // always just toggle play immediately for center
  togglePlay();
  // show center button explicitly
  centerBtn.classList.add("show");
  // hide it after a bit
  setTimeout(() => centerBtn.classList.remove("show"), 800);
});

// --- LEFT/RIGHT OVERLAYS ---
let lastTapLeft = 0,
  lastTapRight = 0;

function showSeekIcon(side) {
  const overlay = side === "left" ? leftOverlay : rightOverlay;
  const icon = overlay.querySelector(".seek-icon");
  icon.style.opacity = "1";
  icon.style.transform = "translateY(-50%) scale(1.2)";
  icon.style.animation = "none";
  void icon.offsetWidth; // restart animation
  icon.style.animation = "slideFade 0.8s forwards";
}

function showControls() {
  const controls = document.querySelector(".bottom-controls");
  controls.classList.add("show");
  centerBtn.classList.add("show");
  clearTimeout(controlsTimeout);
  controlsTimeout = setTimeout(() => {
    controls.classList.remove("show");
    centerBtn.classList.remove("show");
  }, 3000);
}

function handleOverlayClick(side) {
  const now = Date.now();
  if (side === "left") {
    if (now - lastTapLeft < DOUBLE_TAP_DELAY) {
      // double-tap left = seek back 10
      showSeekIcon("left");
      player.currentTime = Math.max(0, player.currentTime - 10);
      lastTapLeft = 0;
      return;
    }
    lastTapLeft = now;
  } else {
    if (now - lastTapRight < DOUBLE_TAP_DELAY) {
      // double-tap right = seek forward 10
      showSeekIcon("right");
      player.currentTime = Math.min(player.duration, player.currentTime + 10);
      lastTapRight = 0;
      return;
    }
    lastTapRight = now;
  }
}

leftOverlay.addEventListener("click", (e) => {
  e.stopPropagation();
  handleOverlayClick("left");
});
rightOverlay.addEventListener("click", (e) => {
  e.stopPropagation();
  handleOverlayClick("right");
});
const bottomControls = document.querySelector(".bottom-controls");

// show controls
function showControls() {
  bottomControls.classList.add("show");
  centerBtn.classList.add("show");
  clearTimeout(controlsTimeout);
  controlsTimeout = setTimeout(() => {
    bottomControls.classList.remove("show");
    centerBtn.classList.remove("show");
  }, 1500); // fade after 3s idle
}

// mouse moves anywhere in the video container
videoContainer.addEventListener("mousemove", showControls);

// hover left/right overlays
leftOverlay.addEventListener("mouseenter", showControls);
rightOverlay.addEventListener("mouseenter", showControls);

// hover bottom controls area itself
bottomControls.addEventListener("mouseenter", () => {
  clearTimeout(controlsTimeout); // keep it visible while hovered
  bottomControls.classList.add("show");
  centerBtn.classList.add("show");
});
bottomControls.addEventListener("mouseleave", () => {
  controlsTimeout = setTimeout(() => {
    bottomControls.classList.remove("show");
    centerBtn.classList.remove("show");
  }, 1500);
});

// Event listeners
bottomPlayBtn.addEventListener("click", togglePlay);
player.addEventListener("play", updatePlayIcon);
player.addEventListener("pause", updatePlayIcon);
muteBtn.addEventListener("click", () => {
  player.muted = !player.muted;
  updateMuteIcon();
});
fullscreenBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    videoContainer.requestFullscreen();
    screen.orientation.lock("landscape-primary");
  } else {
    screen.orientation.unlock();
    document.exitFullscreen();
  }
  setTimeout(updateFullscreenIcon, 50);
});

updateMuteIcon();
updateFullscreenIcon();

// Swipe down to exit fullscreen
let startX = null;
videoContainer.addEventListener(
  "touchstart",
  (e) => (startY = e.touches[0].clientY)
);
videoContainer.addEventListener("touchmove", (e) => {
  if (!startY) return;
  const diff = e.touches[0].clientY - startY;
  if (diff > 100 && document.fullscreenElement) {
    screen.orientation.unlock();
    document.exitFullscreen();
  }
});
videoContainer.addEventListener("touchend", () => (startY = null));
document.addEventListener("keydown", (e) => {
  // avoid interfering with text inputs
  if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;

  switch (e.code) {
    case "Space": // spacebar toggles play/pause
      e.preventDefault(); // prevent page scroll
      togglePlay();
      showControls(); // also show controls when user interacts
      break;

    case "ArrowRight": // seek forward 10s
      player.currentTime = Math.min(player.duration, player.currentTime + 10);
      showSeekIcon("right");
      showControls();
      break;

    case "ArrowLeft": // seek backward 10s
      player.currentTime = Math.max(0, player.currentTime - 10);
      showSeekIcon("left");
      showControls();
      break;

    case "KeyM": // optional: M to toggle mute
      player.muted = !player.muted;
      updateMuteIcon();
      showControls();
      break;

    case "KeyF": // optional: F to toggle fullscreen
      if (!document.fullscreenElement) videoContainer.requestFullscreen();
      else document.exitFullscreen();
      setTimeout(updateFullscreenIcon, 50);
      showControls();
      break;
  }
});
// Progress bar updates
player.addEventListener("timeupdate", () => {
  const pct = (player.currentTime / player.duration) * 100 || 0;
  progressFill.style.width = pct + "%";
  progressHandle.style.left = pct + "%";
  timeDisplay.textContent = `${formatTime(player.currentTime)} / ${formatTime(
    player.duration
  )}`;
});

let dragging = false;

// Desktop mouse events
progressHandle.addEventListener("mousedown", (e) => {
  e.preventDefault();
  dragging = true;
});
document.addEventListener("mouseup", () => (dragging = false));
document.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  updateProgressFromEvent(e.clientX);
});

// Mobile touch events
progressHandle.addEventListener("touchstart", (e) => {
  e.preventDefault();
  dragging = true;
});
document.addEventListener("touchend", () => (dragging = false));
document.addEventListener("touchmove", (e) => {
  if (!dragging) return;
  updateProgressFromEvent(e.touches[0].clientX);
});

// Click/tap directly on the bar (non-drag)
progressBar.addEventListener("click", (e) => {
  updateProgressFromEvent(e.clientX);
});

function updateProgressFromEvent(clientX) {
  const rect = progressBar.getBoundingClientRect();
  const x = clientX - rect.left;
  const pct = Math.max(0, Math.min(1, x / rect.width));
  progressFill.style.width = pct * 100 + "%";
  progressHandle.style.left = pct * 100 + "%";
  player.currentTime = pct * player.duration;
}
