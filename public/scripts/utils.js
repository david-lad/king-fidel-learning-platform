document.addEventListener("DOMContentLoaded", () => {
  const style = document.createElement("style");
  style.innerHTML = `/* Base notification bar */
#notification-bar {
  position: fixed;
  top: -70px; /* hidden initially */
  left: 50%;
  transform: translateX(-50%);
  width: 95%;
  max-width: 600px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: linear-gradient(135deg, #1daa3e, #16c65a); /* green gradient */
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  padding: 14px 20px;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
  border-radius: 0 0 10px 10px; /* rounded bottom corners */
  backdrop-filter: blur(8px); /* subtle glassy look */
  transition: top 0.4s ease-in-out, opacity 0.3s ease-in-out;
  opacity: 0.95;
  z-index: 9999;
}

/* Show state */
#notification-bar.show {
  top: 0;
  opacity: 1;
}

/* Different states */
#notification-bar.error {
  background: linear-gradient(135deg, #dc3545, #b71c1c); /* red gradient */
}

#notification-bar.info {
  background: linear-gradient(135deg, #cfA525, #ac8303); /* blue gradient */
}

/* Optional: add icon inside bar */
#notification-bar i {
  font-size: 18px;
}

/* Optional: add close button */
#notification-bar .close-btn {
  margin-left: auto;
  background: none;
  border: none;
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  opacity: 0.8;
}
#notification-bar .close-btn:hover {
  opacity: 1;
}`;
  document.head.appendChild(style);
});
function showNotification(message, type = "success", duration = 1500) {
  let bar = document.getElementById("notification-bar");

  // Create bar if it doesn't exist
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "notification-bar";
    bar.innerHTML = `
      <span id="notification-message"></span>
      <button class="close-btn" aria-label="Close">&times;</button>
    `;
    document.body.prepend(bar);

    // Attach close handler once
    bar.querySelector(".close-btn").addEventListener("click", () => {
      hideBar();
    });
  }

  // Update message
  document.getElementById("notification-message").innerHTML = message;

  // Set type class
  bar.className = "";
  bar.classList.add(type);

  // Show
  bar.style.top = "0";

  // Auto-hide after duration
  clearTimeout(bar.hideTimeout);
  bar.hideTimeout = setTimeout(hideBar, duration);

  function hideBar() {
    bar.style.top = "-90px";
  }
}
