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

function toggleAuthView(isLogin) {
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const loginTabBtn = document.getElementById("loginTabBtn");
  const signupTabBtn = document.getElementById("signupTabBtn");
  if (!loginForm || !signupForm || !loginTabBtn || !signupTabBtn) {
    return;
  }

  loginForm.classList.toggle("hidden-auth-link", !isLogin);
  signupForm.classList.toggle("hidden-auth-link", isLogin);
  loginTabBtn.classList.toggle("active", isLogin);
  signupTabBtn.classList.toggle("active", !isLogin);
  setAuthMessage("", "");
}

function openAuthModal(tab = "login") {
  const modal = document.getElementById("authModal");
  if (!modal) {
    return;
  }
  modal.classList.remove("hidden-auth-link");
  modal.setAttribute("aria-hidden", "false");
  toggleAuthView(tab === "login");
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
    contactLocation: "contactLocationText",
    contactPhone: "contactPhoneText",
    contactEmail: "contactEmailText",
    contactHours: "contactHoursText",
    floatingButtonText: "floatingButtonText",
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
  toggleAuthView(true);
});
document.getElementById("signupTabBtn")?.addEventListener("click", () => {
  toggleAuthView(false);
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

fetchCurrentUser();

// Membership CTAs open the auth modal (login tab) for both buttons.
document.querySelectorAll("#membership .btn-m").forEach((btn) => {
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    openAuthModal("login");

    const membershipSelect = document.getElementById("signupMembershipType");
    if (membershipSelect) {
      membershipSelect.value = btn.dataset.membership || "";
    }
  });
});
