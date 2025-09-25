document.addEventListener("DOMContentLoaded", async () => {
  const priceValue = document.getElementById("priceValue");
  const currencySymbol = document.getElementById("currencySymbol");
  const subscribeBtn = document.getElementById("subscribeBtn");
  const nairaBtn = document.getElementById("nairaBtn");
  const usdBtn = document.getElementById("usdBtn");
  const currencySwitch = document.getElementById("currencySwitch");
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get("redirect") || "/";
  const plans = {
    NGN: 75000,
    USD: 50
  };

  // detect user + location from your session
  let user = null;
  try {
    user = await fetch("/me").then((r) => r.json());
    if (user.error) {
      showNotification(user.error, "error");
      window.location.href = `/login?redirect=subscribe`;
    }
  } catch (err) {
    showNotification("No User Session Found", "error");
    window.location.href = `/login?redirect=subscribe`;
  }
  if (user.isSubscribed) {
    showNotification("You are already subscribed!", "info", 1500);
    setTimeout(() => {
      window.location.href = redirect;
    }, 1500);
  }
  // decide default currency
  let currency =
    user && user.country && user.country.toLowerCase() === "ng" ? "NGN" : "USD";

  // show/hide currency switch for Nigerians only
  if (currency === "NGN") {
    currencySwitch.style.display = "flex"; // show the toggle
    nairaBtn.classList.add("active");
    usdBtn.classList.remove("active");
  } else {
    currencySwitch.style.display = "none"; // hide toggle for foreign users
  }

  updatePrice();

  // Currency toggle only works if visible
  nairaBtn.addEventListener("click", () => {
    currency = "NGN";
    nairaBtn.classList.add("active");
    usdBtn.classList.remove("active");
    updatePrice();
  });

  usdBtn.addEventListener("click", () => {
    currency = "USD";
    usdBtn.classList.add("active");
    nairaBtn.classList.remove("active");
    updatePrice();
  });

  subscribeBtn.addEventListener("click", () => {
    const amount = plans[currency];
    const txRef = "sub_" + Date.now();
    let completed = false;
    FlutterwaveCheckout({
      public_key: "FLWPUBK_TEST-fc149982779a0c60a8f59cf565cc50c3-X",
      tx_ref: txRef,
      currency,
      amount,
      customer: {
        email: user.email,
        phonenumber: user.phone,
        name: user.fullName,
      },
      customizations: {
        title: "King Fidel",
        logo: "logo.png",
        description: "Course Subscription"
      },
      callback: function (response) {
        console.log("Payment complete", response);
        completed = true;
      },
      onclose: function () {
        if (completed) {
          showNotification("You have successfully subscribed!", "success");
          setTimeout(() => {
            window.location.href = redirect;
          },2000);
        }
        console.log("Checkout closed");
      },
    });
  });

  function updatePrice() {
    currencySymbol.textContent = currency === "NGN" ? "₦" : "$";
    priceValue.textContent = plans[currency].toLocaleString();
  }
});
