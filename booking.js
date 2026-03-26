//
//  STRIPE SETUP
//   Replace 'pk_test_...' with your actual publishable key
//   The backend endpoint /create-checkout-session must be available
//
const STRIPE_PK =
  window.__SFA_CONFIG__?.STRIPE_PUBLISHABLE_KEY ||
  "pk_test_YOUR_PUBLISHABLE_KEY_HERE";
const stripe = Stripe(STRIPE_PK);
const elements = stripe.elements({ locale: "auto" });
const PENDING_BOOKING_KEY = "sfa_pending_booking";
const authState = { user: null };

const cardElement = elements.create("card", {
  style: {
    base: {
      color: "#f0f4ff",
      fontFamily: '"Outfit", sans-serif',
      fontSmoothing: "antialiased",
      fontSize: "15px",
      "::placeholder": { color: "rgba(240,244,255,0.25)" },
    },
    invalid: { color: "#ff4d6d", iconColor: "#ff4d6d" },
  },
  hidePostalCode: false,
});

// Mount card element when Step 4 is shown
function mountStripe() {
  try {
    cardElement.mount("#stripe-card-element");
    cardElement.on("change", ({ error }) => {
      document.getElementById("stripe-error").textContent = error
        ? error.message
        : "-";
    });
  } catch (e) {
    /* already mounted */
  }
}

// Payment Request Button (Apple Pay / Google Pay)
let paymentRequest = null;
let walletAvailable = false;
function setupPaymentRequest(amountCents) {
  paymentRequest = stripe.paymentRequest({
    country: "AU",
    currency: "aud",
    total: { label: "Smashforce Badminton Centre", amount: amountCents },
    requestPayerName: true,
    requestPayerEmail: true,
  });
  const prButton = elements.create("paymentRequestButton", {
    paymentRequest,
  });
  paymentRequest.canMakePayment().then((result) => {
    walletAvailable = Boolean(result);
    if (result) {
      prButton.mount("#payment-request-button");
      return;
    }

    if (state.payMethod !== "card") {
      const payMethods = document.querySelectorAll(".pm");
      payMethods.forEach((p) => p.classList.remove("sel"));
      payMethods[0]?.classList.add("sel");
      state.payMethod = "card";
      document.getElementById("card-pay-section").classList.remove("hidden");
      document.getElementById("wallet-pay-section").classList.add("hidden");
    }

    const errorEl = document.getElementById("stripe-error");
    if (errorEl) {
      errorEl.textContent =
        "Apple Pay / Google Pay is not available on this browser or device. Use card, or open in Safari with Wallet configured.";
    }
  });
  paymentRequest.on("paymentmethod", async (ev) => {
    // Handle wallet payment  same flow as card
    ev.complete("success");
    showSuccess();
  });
}

//
//  APP STATE
//
const state = {
  step: 1,
  facilityType: null, // 'standard' | 'single' | 'table'
  facilityLabel: "",
  courtNum: null,
  courtLabel: "",
  price: 0, // base price per hour
  memberPrice: 0, // member price per hour
  isMember: false,
  date: null, // Date object
  dateLabel: "",
  startTime: "",
  endTime: "",
  durationHrs: 1,
  total: 0,
  calYear: 0,
  calMonth: 0,
  payMethod: "card",
};

const FACILITIES = {
  standard: {
    label: "Standard Courts (1-6)",
    price: 25,
    memberPrice: 22,
    courts: [1, 2, 3, 4, 5, 6],
  },
  single: {
    label: "Single Courts (7-9)",
    price: 15,
    memberPrice: 12,
    courts: [7, 8, 9],
  },
  table: {
    label: "Multi-Game Tables",
    price: 15,
    memberPrice: 12,
    courts: [],
  },
};

// Fetch booked slots from backend
async function getBooked(dateStr) {
  if (!state.facilityType || !state.courtNum || !dateStr) return [];
  try {
    const res = await fetch(
      `/api/booked-slots?facility=${encodeURIComponent(state.facilityType)}&court=${encodeURIComponent(state.courtNum)}&date=${encodeURIComponent(dateStr)}`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.booked) ? data.booked : [];
  } catch (e) {
    return [];
  }
}

//
//  CALENDAR
//
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function initCalendar() {
  const now = new Date();
  state.calYear = now.getFullYear();
  state.calMonth = now.getMonth();
  renderCalendar();
}

function renderCalendar() {
  const { calYear, calMonth } = state;
  document.getElementById("calMonthLabel").textContent =
    `${MONTHS[calMonth]} ${calYear}`;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  // max 60 days ahead
  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + 60);

  // Prev button  can't go before current month
  const nowM = new Date();
  nowM.setDate(1);
  nowM.setHours(0, 0, 0, 0);
  const viewM = new Date(calYear, calMonth, 1);
  document.getElementById("calPrev").disabled = viewM <= nowM;
  // Next button  max 2 months ahead
  const maxM = new Date(nowM);
  maxM.setMonth(maxM.getMonth() + 2);
  document.getElementById("calNext").disabled = viewM >= maxM;

  const grid = document.getElementById("calDays");
  grid.innerHTML = "";

  // Empty cells
  for (let i = 0; i < firstDay; i++) {
    const e = document.createElement("div");
    e.className = "cal-day empty";
    grid.appendChild(e);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(calYear, calMonth, d);
    date.setHours(0, 0, 0, 0);
    const el = document.createElement("div");
    el.className = "cal-day";
    el.textContent = d;

    const isPast = date < today;
    const isFuture = date > maxDate;
    if (isPast || isFuture) {
      el.classList.add("past");
    }

    const isToday = date.getTime() === today.getTime();
    if (isToday) el.classList.add("today");

    // Available dot for non-past dates
    if (!isPast && !isFuture) {
      const dot = document.createElement("div");
      dot.className = "avail-dot";
      el.appendChild(dot);
      el.onclick = () => selectDate(date, el);
    }

    // Is selected?
    if (state.date && date.getTime() === state.date.getTime()) {
      el.classList.add("selected");
    }

    grid.appendChild(el);
  }
}

function changeMonth(dir) {
  state.calMonth += dir;
  if (state.calMonth < 0) {
    state.calMonth = 11;
    state.calYear--;
  }
  if (state.calMonth > 11) {
    state.calMonth = 0;
    state.calYear++;
  }
  renderCalendar();
}

async function selectDate(date, el) {
  clearFormError();
  state.date = date;
  // Format label
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  state.dateLabel = `${days[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;

  document
    .querySelectorAll(".cal-day")
    .forEach((c) => c.classList.remove("selected"));
  el.classList.add("selected");
  document.getElementById("selDateLabel").textContent =
    `${date.getDate()} ${MONTHS[date.getMonth()]}`;

  // Reset time
  state.startTime = "";
  state.endTime = "";
  // Fetch booked slots and render
  state.bookedSlots = await getBooked(fmtDate(date));
  renderTimeSlots();
  updateSummary();
}

//
//  TIME SLOTS
//

const MORNING = ["6:00 AM", "7:00 AM", "8:00 AM"];
const EVENING = [
  "5:00 PM",
  "6:00 PM",
  "7:00 PM",
  "8:00 PM",
  "9:00 PM",
  "10:00 PM",
];

function renderTimeSlots() {
  const booked = state.bookedSlots || [];
  let html = "<div>";
  html += buildSlotGroup("Morning Session", MORNING, booked);
  html += buildSlotGroup("Evening Session", EVENING, booked);
  html += "</div>";
  document.getElementById("timeContent").innerHTML = html;
}

function buildSlotGroup(label, times, booked) {
  let h = `<div><div class="sess-label">${label}</div><div class="slots-grid">`;
  times.forEach((t) => {
    const isTaken = booked.includes(t);
    const isSel = t === state.startTime;
    h += `<div class="slot${isTaken ? " taken" : ""}${isSel ? " selected" : ""}"
               ${isTaken ? "" : "onclick=\"selectSlot('" + t + "')\""}>${t}</div>`;
  });
  h += "</div></div>";
  return h;
}

function selectSlot(time) {
  clearFormError();
  state.startTime = time;
  state.endTime = calcEndTime(time, state.durationHrs);
  renderTimeSlots();
  updateSummary();
}

function showFormError(message) {
  const errorEl = document.getElementById("booking-form-error");
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.classList.remove("hidden");
}

function clearFormError() {
  const errorEl = document.getElementById("booking-form-error");
  if (!errorEl) return;
  errorEl.textContent = "";
  errorEl.classList.add("hidden");
}

function setDuration(hrs, btn) {
  // Only 1 hour allowed, force always
  state.durationHrs = 1;
  document
    .querySelectorAll(".dur-btn")
    .forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  if (state.startTime) {
    state.endTime = calcEndTime(state.startTime, 1);
    updateSummary();
  }
  if (state.date) renderTimeSlots();
}

function calcEndTime(start, hrs) {
  // Always 1 hour
  const all = [...MORNING, ...EVENING];
  const idx = all.indexOf(start);
  return all[idx + 1] || "11:00 PM";
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

//
//  FACILITY SELECTION
//
function selectFacility(type, card) {
  clearFormError();
  document
    .querySelectorAll(".fac-card")
    .forEach((c) => c.classList.remove("selected"));
  document
    .querySelectorAll(".court-picker")
    .forEach((p) => (p.style.display = "none"));
  card.classList.add("selected");

  state.facilityType = type;
  const fac = FACILITIES[type];
  state.facilityLabel = fac.label;
  state.price = fac.price;
  state.memberPrice = fac.memberPrice;
  state.courtNum = null;
  state.courtLabel = "";

  document.getElementById("cp-" + type).style.display = "block";

  if (type !== "table") {
    buildCourtNums(type, fac.courts);
  }
  updateSummary();
}

function buildCourtNums(type, courts) {
  const container = document.getElementById("cn-" + type);
  container.innerHTML = "";
  courts.forEach((n) => {
    const el = document.createElement("div");
    el.className = "court-num";
    el.textContent = n;
    el.onclick = (event) => selectCourt(n, el, type, event);
    container.appendChild(el);
  });
}

function selectCourt(num, el, type, event) {
  event?.stopPropagation();
  clearFormError();
  document
    .querySelectorAll(`#cn-${type} .court-num`)
    .forEach((e) => e.classList.remove("selected"));
  el.classList.add("selected");
  state.courtNum = num;
  state.courtLabel = `Court ${num}`;
  updateSummary();
}

function selectTable(num, el, event) {
  event?.stopPropagation();
  clearFormError();
  document
    .querySelectorAll("#cn-table .tbl-card")
    .forEach((e) => e.classList.remove("selected"));
  el.classList.add("selected");
  state.courtNum = num;
  state.courtLabel = `Table ${num}`;
  updateSummary();
}

//
//  MEMBERSHIP
//
function applyMembership() {
  if (!authState.user) {
    document.getElementById("mem-check").checked = false;
    state.isMember = false;
    updateSummary();
    return;
  }
  state.isMember = document.getElementById("mem-check").checked;
  document
    .getElementById("mem-saving")
    .classList.toggle("hidden", !state.isMember);
  updateSummary();
}

function updateMemberSelect() {
  const v = document.getElementById("f-membership").value;
  if (!authState.user && v) {
    document.getElementById("f-membership").value = "";
    state.isMember = false;
    updateSummary();
    return;
  }
  if (authState.user?.membershipType && v !== authState.user.membershipType) {
    document.getElementById("f-membership").value =
      authState.user.membershipType;
  }
  state.isMember = !!(authState.user?.membershipType || "");
  document.getElementById("mem-check") &&
    (document.getElementById("mem-check").checked = state.isMember);
  document.getElementById("mem-saving") &&
    document
      .getElementById("mem-saving")
      .classList.toggle("hidden", !state.isMember);
  updateSummary();
}

//
//  SUMMARY UPDATE
//
function effectivePrice() {
  if (state.isMember && authState.user) {
    const memType = authState.user.membershipType || "";
    if (state.facilityType === "table" && memType !== "all-access") {
      return state.price;
    }
    return state.memberPrice;
  }
  return state.price;
}

function splitName(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { first: "", last: "" };
  }
  if (parts.length === 1) {
    return { first: parts[0], last: "" };
  }
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function prefillUserDetails() {
  if (!authState.user) {
    return;
  }
  const nameParts = splitName(authState.user.name);
  const first = document.getElementById("f-fname");
  const last = document.getElementById("f-lname");
  const email = document.getElementById("f-email");

  if (first && !first.value.trim()) {
    first.value = nameParts.first;
  }
  if (last && !last.value.trim()) {
    last.value = nameParts.last;
  }
  if (email && !email.value.trim()) {
    email.value = authState.user.email || "";
  }
}

function applyStoredMembershipState() {
  const memCheck = document.getElementById("mem-check");
  const memType = document.getElementById("f-membership");
  const membershipType = authState.user?.membershipType || "";

  if (!memType || !memCheck) {
    return;
  }

  memType.value = membershipType;
  memType.disabled = true;
  memCheck.disabled = !membershipType;
  memCheck.checked = Boolean(membershipType);
  state.isMember = Boolean(membershipType);
}

function setMembershipEnabled(enabled) {
  const memCheck = document.getElementById("mem-check");
  const memType = document.getElementById("f-membership");
  const lockMsg = document.getElementById("mem-lock-msg");

  if (memCheck) {
    memCheck.disabled = !enabled;
  }
  if (memType) {
    memType.disabled = !enabled;
    if (!enabled) {
      memType.value = "";
    }
  }
  if (!enabled) {
    state.isMember = false;
    if (memCheck) {
      memCheck.checked = false;
    }
  } else {
    applyStoredMembershipState();
  }
  if (lockMsg) {
    lockMsg.classList.toggle("hidden", enabled);
  }
  document
    .getElementById("mem-saving")
    .classList.toggle("hidden", !state.isMember);
  updateSummary();
}

function setAuthMessage(type, message) {
  const error = document.getElementById("authError");
  const success = document.getElementById("authSuccess");
  error.textContent = "";
  success.textContent = "";
  if (type === "error") {
    error.textContent = message;
  }
  if (type === "success") {
    success.textContent = message;
  }
}

function renderAuthState() {
  const status = document.getElementById("auth-status");
  const openBtn = document.getElementById("auth-open-btn");
  const logoutBtn = document.getElementById("auth-logout-btn");

  if (authState.user) {
    status.textContent = `Logged in: ${authState.user.name}`;
    openBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
    setMembershipEnabled(true);
    prefillUserDetails();
    return;
  }

  status.textContent = "Guest";
  openBtn.classList.remove("hidden");
  logoutBtn.classList.add("hidden");
  setMembershipEnabled(false);
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const loginTabBtn = document.getElementById("loginTabBtn");
  const signupTabBtn = document.getElementById("signupTabBtn");

  const showLogin = tab === "login";
  loginForm.classList.toggle("hidden", !showLogin);
  signupForm.classList.toggle("hidden", showLogin);
  loginTabBtn.classList.toggle("active", showLogin);
  signupTabBtn.classList.toggle("active", !showLogin);
  setAuthMessage("", "");
}

function openAuthModal(tab = "login") {
  const modal = document.getElementById("authModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  switchAuthTab(tab);
}

function closeAuthModal() {
  const modal = document.getElementById("authModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
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

async function submitAuth(path, payload, successMessage) {
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
    setTimeout(() => {
      closeAuthModal();
      setAuthMessage("", "");
    }, 600);
  } catch (err) {
    setAuthMessage("error", err.message || "Authentication failed.");
  }
}

async function logoutUser() {
  try {
    await fetch("/logout", { method: "POST" });
  } catch {
    // Keep UX stable even if network fails; session will be validated on /me.
  }
  authState.user = null;
  renderAuthState();
}

function calcTotal() {
  return effectivePrice() * state.durationHrs;
}

function updateSummary() {
  const total = calcTotal();
  state.total = total;
  const dur = `1 hr`;
  const timeStr = state.startTime
    ? `${state.startTime} - ${state.endTime}`
    : "-";

  // Step 2 sidebar
  setText("sum-fac", state.facilityLabel || "-");
  setText("sum-court", state.courtLabel || "-");
  setText("sum-date", state.dateLabel || "-");
  setText("sum-time", timeStr);
  setText("sum-dur", state.startTime ? dur : "-");
  setText(
    "sum-rate",
    state.facilityLabel
      ? `$${effectivePrice()}/hr${state.isMember ? " (member)" : ""}`
      : "-",
  );
  setText("sum-total", state.startTime ? `$${total.toFixed(2)}` : "$0.00");

  // Step 3 sidebar
  setText("s3-fac", state.facilityLabel || "-");
  setText("s3-court", state.courtLabel || "-");
  setText("s3-date", state.dateLabel || "-");
  setText("s3-time", timeStr);
  setText("s3-dur", dur);
  setText("s3-total", `$${total.toFixed(2)}`);

  // Step 4 final
  setText("fa-price", `$${total.toFixed(2)}`);
  setText("fa-sub", `${dur} - ${state.facilityLabel}`);
  setText("payBtnText", `Pay $${total.toFixed(2)} ->`);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

//
//  STEP NAVIGATION
//
function goStep(n) {
  document
    .querySelectorAll(".panel")
    .forEach((p) => p.classList.remove("active"));
  document.getElementById("step" + n).classList.add("active");
  state.step = n;
  updateProgressBar(n);
  if (n === 4) {
    populateConfirm();
    mountStripe();
    setupPaymentRequest(Math.round(state.total * 100));
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function maybeGoStep(n) {
  if (n < state.step) goStep(n);
}

function step1Next() {
  clearFormError();
  if (!state.facilityType) {
    showFormError("Please select a facility type.");
    return;
  }
  if (!state.courtNum) {
    showFormError("Please select a specific court or table number.");
    return;
  }
  initCalendar();
  goStep(2);
}

function step2Next() {
  clearFormError();
  if (!state.date) {
    showFormError("Please select a date.");
    return;
  }
  if (!state.startTime) {
    showFormError("Please select a start time.");
    return;
  }
  goStep(3);
}

function step3Next() {
  clearFormError();
  const fname = document.getElementById("f-fname").value.trim();
  const lname = document.getElementById("f-lname").value.trim();
  const email = document.getElementById("f-email").value.trim();
  const phone = document.getElementById("f-phone").value.trim();
  if (!fname || !lname || !email || !phone) {
    showFormError("Please fill in all required fields.");
    return;
  }
  if (!/\S+@\S+\.\S+/.test(email)) {
    showFormError("Please enter a valid email address.");
    return;
  }
  goStep(4);
}

function updateProgressBar(step) {
  for (let i = 1; i <= 4; i++) {
    const ps = document.getElementById("ps" + i);
    if (!ps) continue;
    ps.style.opacity = "1";
    ps.classList.remove("active", "done");
    if (i < step) ps.classList.add("done");
    else if (i === step) ps.classList.add("active");
    else ps.style.opacity = "0.4";
  }
  for (let i = 1; i <= 3; i++) {
    const pc = document.getElementById("pc" + i);
    if (!pc) continue;
    pc.classList.toggle("done", i < step);
  }
}

//
//  POPULATE STEP 4 CONFIRM
//
function populateConfirm() {
  const fname = document.getElementById("f-fname").value;
  const lname = document.getElementById("f-lname").value;
  const email = document.getElementById("f-email").value;
  const phone = document.getElementById("f-phone").value;
  const memSel = authState.user?.membershipType || "";
  const memLabels = {
    "": "None",
    court: "Court Membership",
    "all-access": "All Access Membership",
  };

  setText("c-name", `${fname} ${lname}`);
  setText("c-email", email);
  setText("c-phone", phone);
  setText("c-fac", state.facilityLabel);
  setText("c-court", state.courtLabel);
  setText("c-date", state.dateLabel);
  setText("c-time", `${state.startTime} - ${state.endTime}`);
  // Always show 1 hr for duration
  setText("c-dur", "1 hr");
  setText("c-mem", memLabels[memSel] || "None");
  updateSummary();
}

//
//  PAYMENT SUBMISSION
//
function setPayMethod(method, el) {
  if (method !== "card" && !walletAvailable) {
    const payMethods = document.querySelectorAll(".pm");
    payMethods.forEach((p) => p.classList.remove("sel"));
    payMethods[0]?.classList.add("sel");
    state.payMethod = "card";
    document.getElementById("card-pay-section").classList.remove("hidden");
    document.getElementById("wallet-pay-section").classList.add("hidden");
    document.getElementById("stripe-error").textContent =
      "Apple Pay / Google Pay is not available on this browser or device.";
    return;
  }

  state.payMethod = method;
  document.querySelectorAll(".pm").forEach((p) => p.classList.remove("sel"));
  el.classList.add("sel");
  document
    .getElementById("card-pay-section")
    .classList.toggle("hidden", method !== "card");
  document
    .getElementById("wallet-pay-section")
    .classList.toggle("hidden", method === "card");
}

function getCheckoutPayload() {
  const firstName = document.getElementById("f-fname").value.trim();
  const lastName = document.getElementById("f-lname").value.trim();
  const email = document.getElementById("f-email").value.trim();
  const phone = document.getElementById("f-phone").value.trim();
  const membershipType = document.getElementById("f-membership").value;
  return {
    facility: state.facilityType,
    date: state.date ? fmtDate(state.date) : "",
    time: `${state.startTime} - ${state.endTime}`,
    duration: state.durationHrs,
    court: state.courtLabel,
    name: `${firstName} ${lastName}`.trim(),
    email,
    phone,
    isMember: Boolean(state.isMember),
    membershipType,
  };
}

function persistPendingBooking() {
  const payload = {
    state: {
      facilityLabel: state.facilityLabel,
      courtLabel: state.courtLabel,
      dateLabel: state.dateLabel,
      startTime: state.startTime,
      endTime: state.endTime,
      durationHrs: state.durationHrs,
    },
    email: document.getElementById("f-email").value.trim(),
  };
  sessionStorage.setItem(PENDING_BOOKING_KEY, JSON.stringify(payload));
}

function restorePendingBooking() {
  const raw = sessionStorage.getItem(PENDING_BOOKING_KEY);
  if (!raw) {
    return null;
  }

  try {
    const pending = JSON.parse(raw);
    if (pending.state) {
      state.facilityLabel = pending.state.facilityLabel || "";
      state.courtLabel = pending.state.courtLabel || "";
      state.dateLabel = pending.state.dateLabel || "";
      state.startTime = pending.state.startTime || "";
      state.endTime = pending.state.endTime || "";
      state.durationHrs = Number(pending.state.durationHrs || 0.5);
    }
    if (pending.email) {
      const emailInput = document.getElementById("f-email");
      if (emailInput) {
        emailInput.value = pending.email;
      }
    }
    return pending;
  } catch (err) {
    console.error("Could not restore pending booking", err);
    return null;
  }
}

async function submitPayment() {
  const btn = document.getElementById("payBtn");
  const spinner = document.getElementById("paySpinner");
  const btnText = document.getElementById("payBtnText");
  const errorEl = document.getElementById("stripe-error");

  btn.disabled = true;
  btnText.classList.add("hidden");
  spinner.classList.remove("hidden");
  errorEl.textContent = "";

  try {
    persistPendingBooking();
    const checkoutPayload = getCheckoutPayload();

    const response = await fetch("/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checkoutPayload),
    });

    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data?.error || "Could not start checkout.");
    }

    if (!data?.url) {
      throw new Error("Missing Stripe checkout URL from server.");
    }

    window.location.href = data.url;
  } catch (err) {
    errorEl.textContent = err.message || "Payment failed. Please try again.";
    btn.disabled = false;
    btnText.classList.remove("hidden");
    spinner.classList.add("hidden");
  }
}

async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkoutState = params.get("checkout");

  if (!checkoutState) {
    return;
  }

  restorePendingBooking();

  if (checkoutState === "cancel") {
    goStep(4);
    document.getElementById("stripe-error").textContent =
      "Checkout was canceled. You can try again.";
    history.replaceState({}, "", "booking.html");
    return;
  }

  if (checkoutState !== "success") {
    return;
  }

  const sessionId = params.get("session_id");
  if (!sessionId) {
    document.getElementById("stripe-error").textContent =
      "Payment returned without a session ID.";
    goStep(4);
    return;
  }

  try {
    const statusRes = await fetch(
      `/checkout-session-status?session_id=${encodeURIComponent(sessionId)}`,
    );
    const statusData = await readJsonResponse(statusRes);

    if (!statusRes.ok) {
      throw new Error(statusData?.error || "Could not verify payment.");
    }

    if (statusData?.payment_status === "paid") {
      showSuccess(sessionId);
      sessionStorage.removeItem(PENDING_BOOKING_KEY);
      history.replaceState({}, "", "booking.html");
      return;
    }

    goStep(4);
    document.getElementById("stripe-error").textContent =
      "Payment is not completed yet. Please try again.";
  } catch (err) {
    goStep(4);
    document.getElementById("stripe-error").textContent =
      err.message || "Could not verify payment.";
  }
}

//
//  SUCCESS
//
function showSuccess(sessionId = "") {
  const ref = sessionId
    ? `SFA-${sessionId.slice(-8).toUpperCase()}`
    : "SFA-" + Math.random().toString(36).substr(2, 6).toUpperCase();
  const dur = "1 hr";

  setText("succ-email", document.getElementById("f-email").value);
  setText("succ-ref", ref);
  setText("succ-fac", state.facilityLabel);
  setText("succ-court", state.courtLabel);
  setText(
    "succ-dt",
    `${state.dateLabel}, ${state.startTime} - ${state.endTime}`,
  );
  setText("succ-dur", dur);

  goStep(5);
  // Hide progress bar on success
  document.querySelector(".progress-wrap").style.display = "none";
}

document
  .getElementById("auth-open-btn")
  .addEventListener("click", () => openAuthModal("login"));
document
  .getElementById("auth-logout-btn")
  .addEventListener("click", logoutUser);
document
  .getElementById("authCloseBtn")
  .addEventListener("click", closeAuthModal);
document
  .getElementById("loginTabBtn")
  .addEventListener("click", () => switchAuthTab("login"));
document
  .getElementById("signupTabBtn")
  .addEventListener("click", () => switchAuthTab("signup"));

document.getElementById("authModal").addEventListener("click", (event) => {
  if (event.target.id === "authModal") {
    closeAuthModal();
  }
});

document
  .getElementById("loginForm")
  .addEventListener("submit", async (event) => {
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
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAuth(
      "/signup",
      {
        name: document.getElementById("signupName").value.trim(),
        email: document.getElementById("signupEmail").value.trim(),
        membershipType: document.getElementById("signupMembershipType").value,
        password: document.getElementById("signupPassword").value,
      },
      "Account created successfully.",
    );
  });

//
//  INIT
//
updateProgressBar(1);
updateSummary();
renderAuthState();
fetchCurrentUser();
handleCheckoutReturn();
