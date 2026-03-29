// ── Mobile Nav ──
const burgerBtn = document.getElementById("burger");
const mobNav = document.getElementById("mobNav");

burgerBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  mobNav?.classList.toggle("open");
});

function closeMob() {
  mobNav?.classList.remove("open");
}

document.addEventListener("click", (event) => {
  if (!mobNav || !burgerBtn || !mobNav.classList.contains("open")) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }

  if (mobNav.contains(target) || burgerBtn.contains(target)) {
    return;
  }

  closeMob();
});

const authState = { user: null };

function setAuthMessage(type, message) {
  const error = document.getElementById("authError");
  const success = document.getElementById("authSuccess");
  if (!error || !success) {
    return;
  }
  error.textContent = type === "error" ? message : "";
  success.textContent = type === "success" ? message : "";
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const forgotForm = document.getElementById("forgotForm");
  const resetForm = document.getElementById("resetForm");
  const loginTabBtn = document.getElementById("loginTabBtn");
  const signupTabBtn = document.getElementById("signupTabBtn");
  if (
    !loginForm ||
    !signupForm ||
    !forgotForm ||
    !resetForm ||
    !loginTabBtn ||
    !signupTabBtn
  ) {
    return;
  }

  const showLogin = tab === "login";
  const showSignup = tab === "signup";
  const showForgot = tab === "forgot";
  const showReset = tab === "reset";

  loginForm.classList.toggle("hidden-auth-link", !showLogin);
  signupForm.classList.toggle("hidden-auth-link", !showSignup);
  forgotForm.classList.toggle("hidden-auth-link", !showForgot);
  resetForm.classList.toggle("hidden-auth-link", !showReset);
  loginTabBtn.classList.toggle("active", showLogin);
  signupTabBtn.classList.toggle("active", showSignup);
  setAuthMessage("", "");
}

function openAuthModal(tab = "login") {
  const modal = document.getElementById("authModal");
  if (!modal) {
    return;
  }
  modal.classList.remove("hidden-auth-link");
  modal.setAttribute("aria-hidden", "false");
  switchAuthTab(tab);
}

function closeAuthModal() {
  const modal = document.getElementById("authModal");
  if (!modal) {
    return;
  }
  modal.classList.add("hidden-auth-link");
  modal.setAttribute("aria-hidden", "true");
}

function renderAuthState() {
  const statusChip = document.getElementById("authStatusChip");
  const adminNavItem = document.getElementById("adminNavItem");
  const adminMobileLink = document.getElementById("mobAdminLink");
  const logoutBtn = document.getElementById("authLogoutBtn");
  const mobileLogoutBtn = document.getElementById("mobAuthLogoutBtn");
  const openBtn = document.getElementById("authOpenBtn");
  const mobileOpenBtn = document.getElementById("mobAuthOpenBtn");

  if (statusChip) {
    statusChip.textContent = authState.user
      ? `Logged in: ${authState.user.name}`
      : "Guest";
  }

  [adminNavItem, adminMobileLink, logoutBtn, mobileLogoutBtn].forEach((el) => {
    if (el) {
      el.classList.toggle("hidden-auth-link", !authState.user);
    }
  });

  [openBtn, mobileOpenBtn].forEach((el) => {
    if (el) {
      el.classList.toggle("hidden-auth-link", Boolean(authState.user));
    }
  });
}

async function readJsonResponse(res) {
  const raw = await res.text();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(
      `Server returned a non-JSON response (${res.status} ${res.statusText}). Make sure you opened the site through the Node server.`,
    );
  }
}

async function fetchCurrentUser() {
  try {
    const res = await fetch("/me");
    if (!res.ok) {
      authState.user = null;
      renderAuthState();
      return;
    }
    const data = await readJsonResponse(res);
    authState.user = data.user || null;
    renderAuthState();
  } catch {
    authState.user = null;
    renderAuthState();
  }
}

async function submitAuth(
  path,
  payload,
  successMessage,
  { autoClose = true } = {},
) {
  try {
    setAuthMessage("", "");
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(res);
    if (!res.ok) {
      throw new Error(data?.error || "Authentication failed.");
    }
    authState.user = data.user || null;
    renderAuthState();
    setAuthMessage("success", successMessage);
    if (autoClose) {
      setTimeout(() => {
        closeAuthModal();
        setAuthMessage("", "");
      }, 700);
    }
    return data;
  } catch (err) {
    setAuthMessage("error", err.message || "Authentication failed.");
    return null;
  }
}

async function requestPasswordReset() {
  const email = document.getElementById("forgotEmail")?.value.trim() || "";
  try {
    setAuthMessage("", "");
    const res = await fetch("/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await readJsonResponse(res);
    if (!res.ok) {
      throw new Error(data?.error || "Could not process password reset.");
    }

    if (data?.devResetToken) {
      const tokenInput = document.getElementById("resetToken");
      if (tokenInput) {
        tokenInput.value = String(data.devResetToken);
      }
      switchAuthTab("reset");
      setAuthMessage(
        "success",
        "Reset token generated for development. Paste token and set a new password.",
      );
      return;
    }

    switchAuthTab("login");
    setAuthMessage(
      "success",
      data?.message ||
        "If that email exists, a password reset link has been generated.",
    );
  } catch (err) {
    setAuthMessage(
      "error",
      err.message || "Could not process password reset request.",
    );
  }
}

async function submitPasswordReset() {
  const token = document.getElementById("resetToken")?.value.trim() || "";
  const password = document.getElementById("resetPassword")?.value || "";
  const confirmPassword =
    document.getElementById("resetPasswordConfirm")?.value || "";

  if (password !== confirmPassword) {
    setAuthMessage("error", "Passwords do not match.");
    return;
  }

  try {
    setAuthMessage("", "");
    const res = await fetch("/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await readJsonResponse(res);
    if (!res.ok) {
      throw new Error(data?.error || "Could not reset password.");
    }

    const resetPasswordInput = document.getElementById("resetPassword");
    const resetPasswordConfirmInput = document.getElementById(
      "resetPasswordConfirm",
    );
    if (resetPasswordInput) {
      resetPasswordInput.value = "";
    }
    if (resetPasswordConfirmInput) {
      resetPasswordConfirmInput.value = "";
    }

    switchAuthTab("login");
    setAuthMessage(
      "success",
      data?.message || "Password updated successfully. Please log in.",
    );
  } catch (err) {
    setAuthMessage("error", err.message || "Could not reset password.");
  }
}

function applyAuthResetFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const authView = String(params.get("auth") || "")
    .trim()
    .toLowerCase();
  const resetToken = String(params.get("reset_token") || "").trim();

  if (!resetToken && authView !== "reset") {
    return;
  }

  if (resetToken) {
    const tokenInput = document.getElementById("resetToken");
    if (tokenInput) {
      tokenInput.value = resetToken;
    }
  }

  openAuthModal("reset");
}

async function logoutUser() {
  try {
    await fetch("/logout", { method: "POST" });
  } catch {
    // Keep UI responsive; /me will settle actual state on refresh.
  }
  authState.user = null;
  renderAuthState();
  closeAuthModal();
  closeMob();
}

// ── Scroll Reveal ──
const rvEls = document.querySelectorAll(".rv");
const obs = new IntersectionObserver(
  (entries) => {
    entries.forEach((e, i) => {
      if (e.isIntersecting) {
        setTimeout(() => e.target.classList.add("in"), i * 75);
        obs.unobserve(e.target);
      }
    });
  },
  { threshold: 0.07 },
);
rvEls.forEach((el) => obs.observe(el));

// ── Toast ──
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3500);
}

async function sendContactMessage() {
  const firstName =
    document.getElementById("contactFirstName")?.value.trim() || "";
  const lastName =
    document.getElementById("contactLastName")?.value.trim() || "";
  const fromEmail =
    document.getElementById("contactEmailInput")?.value.trim() || "";
  const phone =
    document.getElementById("contactPhoneInput")?.value.trim() || "";
  const topic =
    document.getElementById("contactTopic")?.value.trim() || "General Enquiry";
  const message = document.getElementById("contactMessage")?.value.trim() || "";

  if (!message) {
    showToast("Please add a message before sending.");
    return;
  }

  try {
    const response = await fetch("/contact-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        lastName,
        email: fromEmail,
        phone,
        topic,
        message,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      showToast(payload.error || "Unable to send message right now.");
      return;
    }

    showToast("Message sent successfully.");
    const fieldIds = [
      "contactFirstName",
      "contactLastName",
      "contactEmailInput",
      "contactPhoneInput",
      "contactTopic",
      "contactMessage",
    ];
    fieldIds.forEach((id) => {
      const field = document.getElementById(id);
      if (field) {
        field.value = "";
      }
    });
  } catch {
    showToast("Unable to send message right now.");
  }
}

// ── Nav Highlight on Scroll ──
const secs = document.querySelectorAll("section[id]");
const navLinks = document.querySelectorAll(".nav-ul a");
window.addEventListener("scroll", () => {
  const y = window.scrollY + 90;
  secs.forEach((s) => {
    if (y >= s.offsetTop && y < s.offsetTop + s.offsetHeight) {
      navLinks.forEach((a) => {
        a.style.color = "";
        if (a.getAttribute("href") === "#" + s.id) {
          a.style.color = "var(--lime)";
        }
      });
    }
  });
});

// ── Smooth close mobile nav on link click ──
document.querySelectorAll(".mob-nav a").forEach((a) => {
  a.addEventListener("click", closeMob);
});

function initHeroParallax() {
  const hero = document.querySelector(".hero");
  const heroBg = document.querySelector(".hero-bg");
  const gridBg = document.querySelector(".court-grid-bg");
  const heroGlow = document.querySelector(".hero-glow");

  if (!hero || !heroBg || !gridBg || !heroGlow) {
    return;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  let ticking = false;

  const updateParallax = () => {
    ticking = false;

    const rect = hero.getBoundingClientRect();
    const viewportHeight = window.innerHeight || 1;

    // Keep animation active only while the hero is near the viewport.
    if (rect.bottom < -120 || rect.top > viewportHeight + 120) {
      return;
    }

    const travel = Math.min(Math.max(window.scrollY, 0), viewportHeight * 1.6);
    heroBg.style.transform = `translate3d(0, ${travel * 0.28}px, 0) scale(1.1)`;
    gridBg.style.transform = `translate3d(0, ${travel * 0.4}px, 0)`;
    heroGlow.style.transform = `translate3d(${travel * 0.1}px, ${travel * -0.24}px, 0)`;
  };

  const requestTick = () => {
    if (ticking) {
      return;
    }
    ticking = true;
    window.requestAnimationFrame(updateParallax);
  };

  window.addEventListener("scroll", requestTick, { passive: true });
  window.addEventListener("resize", requestTick);
  requestTick();
}

initHeroParallax();

// ── Admin Managed Content (server-backed CMS) ──
async function applyAdminContent() {
  let data = null;
  try {
    const response = await fetch("/content");
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    data = payload?.content || null;
  } catch (err) {
    console.warn("Could not load admin content settings", err);
    return;
  }

  if (!data || typeof data !== "object") {
    return;
  }

  const fieldMap = {
    logoTagline: "logoTaglineText",
    heroAnnouncement: "heroAnnouncementText",
    heroDescription: "heroDescriptionText",
    standardCourtPrice: "standardCourtPrice",
    singleCourtPrice: "singleCourtPrice",
    tablePrice: "tablePriceText",
    courtMembershipPrice: "courtMembershipPrice",
    allAccessMembershipPrice: "allAccessMembershipPrice",
    bookingCta: "bookingCtaButton",
    floatingButtonText: "floatingButtonText",
    // Contact fields intentionally omitted to keep Contact Us static
  };

  Object.entries(fieldMap).forEach(([key, elementId]) => {
    const value = data[key];
    if (typeof value !== "string") {
      return;
    }

    const el = document.getElementById(elementId);
    if (!el) {
      return;
    }

    el.textContent = value;
  });
}

applyAdminContent();

document.getElementById("authOpenBtn")?.addEventListener("click", () => {
  openAuthModal("login");
});
document.getElementById("mobAuthOpenBtn")?.addEventListener("click", () => {
  openAuthModal("login");
  closeMob();
});
document
  .getElementById("authCloseBtn")
  ?.addEventListener("click", closeAuthModal);
document.getElementById("loginTabBtn")?.addEventListener("click", () => {
  switchAuthTab("login");
});
document.getElementById("signupTabBtn")?.addEventListener("click", () => {
  switchAuthTab("signup");
});
document.getElementById("forgotPasswordBtn")?.addEventListener("click", () => {
  switchAuthTab("forgot");
});
document.getElementById("backToLoginBtn")?.addEventListener("click", () => {
  switchAuthTab("login");
});
document
  .getElementById("backToLoginFromResetBtn")
  ?.addEventListener("click", () => {
    switchAuthTab("login");
  });
document.getElementById("authLogoutBtn")?.addEventListener("click", logoutUser);
document
  .getElementById("mobAuthLogoutBtn")
  ?.addEventListener("click", logoutUser);

document.getElementById("authModal")?.addEventListener("click", (event) => {
  if (event.target.id === "authModal") {
    closeAuthModal();
  }
});

document
  .getElementById("loginForm")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAuth(
      "/login",
      {
        email: document.getElementById("loginEmail").value.trim(),
        password: document.getElementById("loginPassword").value,
      },
      "Logged in successfully.",
    );
  });

document
  .getElementById("signupForm")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const membershipType = document.getElementById(
      "signupMembershipType",
    ).value;
    const signupResult = await submitAuth(
      "/signup",
      {
        name: document.getElementById("signupName").value.trim(),
        email: document.getElementById("signupEmail").value.trim(),
        membershipType,
        password: document.getElementById("signupPassword").value,
      },
      membershipType
        ? "Account created. Redirecting to payment..."
        : "Account created successfully.",
      { autoClose: !membershipType },
    );

    if (!signupResult || !membershipType) {
      return;
    }

    try {
      const checkoutRes = await fetch("/create-membership-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipType }),
      });
      const checkoutData = await readJsonResponse(checkoutRes);

      if (!checkoutRes.ok) {
        throw new Error(
          checkoutData?.error || "Could not start membership checkout.",
        );
      }

      if (!checkoutData?.url) {
        throw new Error("Missing checkout URL from server.");
      }

      window.location.href = checkoutData.url;
    } catch (err) {
      setAuthMessage(
        "error",
        err.message || "Could not start membership checkout.",
      );
    }
  });

document
  .getElementById("forgotForm")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await requestPasswordReset();
  });

document
  .getElementById("resetForm")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitPasswordReset();
  });

fetchCurrentUser();
applyAuthResetFromQuery();

// Membership CTAs open the auth modal (login tab) for both buttons.
document.querySelectorAll("#membership .btn-m").forEach((btn) => {
  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const membershipType = btn.dataset.membership || "";
    // If logged in, go straight to checkout
    if (authState && authState.user) {
      try {
        const checkoutRes = await fetch("/create-membership-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ membershipType }),
        });
        const checkoutData = await readJsonResponse(checkoutRes);
        if (!checkoutRes.ok || !checkoutData?.url) {
          showToast(
            checkoutData?.error || "Could not start membership checkout.",
          );
          return;
        }
        window.location.href = checkoutData.url;
        return;
      } catch (err) {
        showToast(err.message || "Could not start membership checkout.");
        return;
      }
    }
    // Not logged in: store intent and open signup
    sessionStorage.setItem("pending_membership_type", membershipType);
    openAuthModal("signup");
    const membershipSelect = document.getElementById("signupMembershipType");
    if (membershipSelect) {
      membershipSelect.value = membershipType;
    }
  });
});

// Signup form: after signup, redirect to checkout if needed
const signupForm = document.getElementById("signupForm");
signupForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const membershipType = document.getElementById("signupMembershipType").value;
  const signupResult = await submitAuth(
    "/signup",
    {
      name: document.getElementById("signupName").value.trim(),
      email: document.getElementById("signupEmail").value.trim(),
      membershipType,
      password: document.getElementById("signupPassword").value,
    },
    membershipType
      ? "Account created. Redirecting to payment..."
      : "Account created successfully.",
    { autoClose: !membershipType },
  );

  // After signup, if user intended to buy membership, redirect to checkout
  const pendingMembership = sessionStorage.getItem("pending_membership_type");
  if (
    signupResult &&
    pendingMembership &&
    pendingMembership === membershipType
  ) {
    try {
      const checkoutRes = await fetch("/create-membership-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipType }),
      });
      const checkoutData = await readJsonResponse(checkoutRes);
      if (!checkoutRes.ok || !checkoutData?.url) {
        showToast(
          checkoutData?.error || "Could not start membership checkout.",
        );
      } else {
        sessionStorage.removeItem("pending_membership_type");
        window.location.href = checkoutData.url;
      }
    } catch (err) {
      showToast(err.message || "Could not start membership checkout.");
    }
  }
});

// Handle password reset links: ?auth=reset&reset_token=<token>
(function applyResetFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const resetToken = String(params.get("reset_token") || "").trim();
  if (!resetToken) return;

  const tokenInput = document.getElementById("resetToken");
  if (tokenInput) tokenInput.value = resetToken;

  // Clean the token out of the URL so refreshing doesn't re-trigger
  const cleanUrl = window.location.pathname;
  history.replaceState({}, "", cleanUrl);

  openAuthModal("reset");
})();

// Handle membership checkout return (success / cancel)
(function handleMembershipReturn() {
  const params = new URLSearchParams(window.location.search);
  const membershipStatus = params.get("membership");
  if (!membershipStatus) return;
  history.replaceState({}, "", window.location.pathname);
  if (membershipStatus === "success") {
    showToast("Membership purchased successfully! Welcome aboard.");
    fetchCurrentUser();
  } else if (membershipStatus === "cancel") {
    showToast("Membership purchase cancelled.");
  }
})();
