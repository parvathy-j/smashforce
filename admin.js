let adminCalendar = null;
let lastLoadedBookings = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setStatus(message) {
  const el = document.getElementById("statusBar");
  if (el) el.textContent = message;
}

function setSessionLabel(message) {
  const el = document.getElementById("adminSessionLabel");
  if (el) el.textContent = message;
}

function formatMoney(cents, currency = "aud") {
  const amount = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: String(currency || "aud").toUpperCase(),
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function bookingRef(booking) {
  if (booking.checkoutSessionId) {
    return "SFA-" + booking.checkoutSessionId.slice(-8).toUpperCase();
  }
  return booking.id ? "SFA-" + String(booking.id).slice(-6).toUpperCase() : "-";
}

// Parse "9:00 AM" -> "09:00:00" for use in ISO datetime strings
function parseTimeToISO(timeStr) {
  const match = (timeStr || "").trim().match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return null;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

const STATUS_COLORS = {
  paid: "#22c55e",
  pending: "#f59e0b",
  pending_in_person: "#38bdf8",
  failed: "#ef4444",
  expired: "#9ca3af",
};

function bookingToCalendarEvent(b) {
  if (!b.bookingDate || !b.bookingTime) return null;
  const parts = b.bookingTime.split(" - ");
  const startISO = parseTimeToISO(parts[0]?.trim());
  const endISO = parseTimeToISO(parts[1]?.trim());
  if (!startISO) return null;

  const start = `${b.bookingDate}T${startISO}`;
  let end;
  if (endISO) {
    end = `${b.bookingDate}T${endISO}`;
  } else {
    const d = new Date(start);
    d.setHours(d.getHours() + 1);
    end = `${b.bookingDate}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
  }

  const status = String(b.paymentStatus || "pending").toLowerCase();
  const court = b.court ? ` (${b.court})` : "";
  const customer = b.customerName || b.customerEmail || "";
  return {
    title: `${b.facility || ""}${court}${customer ? " — " + customer : ""}`,
    start,
    end,
    backgroundColor: STATUS_COLORS[status] || "#5da9e9",
    borderColor: STATUS_COLORS[status] || "#5da9e9",
    extendedProps: { booking: b },
  };
}

// ---------------------------------------------------------------------------
// FullCalendar
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", function () {
  const calendarEl = document.getElementById("adminFullCalendar");
  if (!calendarEl || typeof FullCalendar === "undefined") return;

  adminCalendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "timeGridWeek",
    height: 650,
    slotDuration: "00:30:00",
    slotMinTime: "06:00:00",
    slotMaxTime: "24:00:00",
    headerToolbar: {
      left: "prev,next today",
      center: "title",
      right: "dayGridMonth,timeGridWeek,timeGridDay",
    },
    events: [],
    eventClick(info) {
      const b = info.event.extendedProps.booking;
      if (b) showBookingDetailsModal(b.bookingDate, [b]);
    },
  });

  adminCalendar.render();
});

function refreshCalendar(bookings) {
  if (!adminCalendar) return;
  adminCalendar.removeAllEvents();
  const events = bookings.map(bookingToCalendarEvent).filter(Boolean);
  adminCalendar.addEventSource(events);
}

// ---------------------------------------------------------------------------
// Booking Details Modal
// ---------------------------------------------------------------------------

function showBookingDetailsModal(dateStr, bookings) {
  const modal = document.getElementById("bookingDetailsModal");
  document.getElementById("modalDateLabel").textContent = dateStr || "";
  const list = document.getElementById("modalBookingList");

  const items = bookings || (lastLoadedBookings || []).filter((b) => b.bookingDate === dateStr);
  if (!items.length) {
    list.innerHTML = '<div style="color:#888;">No bookings for this date.</div>';
  } else {
    list.innerHTML = items
      .map(
        (b) => `<div class="booking-entry">
          <span class="booking-customer">${b.customerName || b.customerEmail || "-"}</span>
          <span class="booking-status">(${b.paymentStatus || "pending"})</span><br>
          <span>${b.facility || "-"}${b.court ? ` (${b.court})` : ""}</span><br>
          <span>${b.bookingTime || "-"}</span>
          ${b.phone ? `<br><span>Phone: ${b.phone}</span>` : ""}
          ${b.customerEmail ? `<br><span>Email: ${b.customerEmail}</span>` : ""}
        </div>`,
      )
      .join("");
  }
  modal.style.display = "flex";
}

document.getElementById("closeBookingDetails").onclick = function () {
  document.getElementById("bookingDetailsModal").style.display = "none";
};
window.addEventListener("click", function (e) {
  const modal = document.getElementById("bookingDetailsModal");
  if (e.target === modal) modal.style.display = "none";
});

// ---------------------------------------------------------------------------
// Mark Booking Paid
// ---------------------------------------------------------------------------

async function markBookingPaid(bookingId) {
  try {
    const response = await fetch(
      `/admin/bookings/${encodeURIComponent(bookingId)}/mark-paid`,
      { method: "POST" },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "Could not mark booking paid.");
    setStatus(data?.message || "Booking marked paid.");
    await loadAdminBookings();
  } catch (err) {
    setStatus(err.message || "Could not mark booking paid.");
  }
}

// ---------------------------------------------------------------------------
// Render Bookings Table
// ---------------------------------------------------------------------------

function renderBookingRows(bookings = []) {
  const body = document.getElementById("bookingsTableBody");
  if (!body) return;
  body.innerHTML = "";

  if (!Array.isArray(bookings) || bookings.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.textContent = "No bookings found.";
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  bookings.forEach((booking) => {
    const tr = document.createElement("tr");
    const created = booking.createdAt ? new Date(booking.createdAt).toLocaleString() : "-";
    const ref = bookingRef(booking);
    const customer = booking.customerName || booking.customerEmail || "-";
    const facility = booking.facility || "-";
    const facilityText = booking.court ? `${facility} (${booking.court})` : facility;
    const date = booking.bookingDate || "-";
    const time = booking.bookingTime || "-";
    const amount = formatMoney(booking.amount, booking.currency);
    const status = String(booking.paymentStatus || "pending").toLowerCase();

    const cells = Array.from({ length: 9 }, () => document.createElement("td"));

    cells[0].textContent = created;

    cells[1].textContent = ref;
    cells[1].style.fontSize = "0.78rem";
    cells[1].style.opacity = "0.7";

    const nameDiv = document.createElement("div");
    nameDiv.textContent = customer;
    const emailSmall = document.createElement("small");
    emailSmall.textContent = booking.customerEmail || "";
    cells[2].appendChild(nameDiv);
    cells[2].appendChild(emailSmall);

    cells[3].textContent = facilityText;
    cells[4].textContent = date;
    cells[5].textContent = time;
    cells[6].textContent = amount;

    const pill = document.createElement("span");
    pill.className = `status-pill ${status}`;
    pill.textContent = status.replace(/_/g, " ");
    cells[7].appendChild(pill);

    if (status === "pending_in_person") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn booking-action-btn";
      btn.textContent = "Mark Paid";
      btn.addEventListener("click", () => markBookingPaid(booking.id));
      cells[8].appendChild(btn);
    }

    cells.forEach((cell) => tr.appendChild(cell));
    body.appendChild(tr);
  });
}

// ---------------------------------------------------------------------------
// Court Summary
// ---------------------------------------------------------------------------

function renderBookedSummary(bookings = []) {
  const summaryDiv = document.getElementById("bookedSummaryContent");
  if (!summaryDiv) return;

  const selectedDate = document.getElementById("bookingsDateFilter")?.value;
  if (!selectedDate) {
    summaryDiv.textContent = "Select a date to see booked courts/tables.";
    return;
  }

  const FACILITIES = {
    "Standard Courts (1-6)": [1, 2, 3, 4, 5, 6],
    "Single Courts (7-9)": [7, 8, 9],
    "Multi-Game Tables": ["Table 1", "Table 2", "Table 3", "Table 4", "Table 5"],
  };

  const booked = {
    "Standard Courts (1-6)": new Set(),
    "Single Courts (7-9)": new Set(),
    "Multi-Game Tables": new Set(),
  };

  bookings.forEach((b) => {
    if (b.bookingDate !== selectedDate || !b.facility || !b.court) return;
    const fac = b.facility.toLowerCase();
    if (fac.includes("standard")) booked["Standard Courts (1-6)"].add(Number(b.court));
    else if (fac.includes("single")) booked["Single Courts (7-9)"].add(Number(b.court));
    else if (fac.includes("table")) booked["Multi-Game Tables"].add(b.court);
  });

  const lines = [];
  for (const [fac, courts] of Object.entries(FACILITIES)) {
    lines.push(`<strong>${fac}:</strong>`);
    lines.push('<ul style="margin:0 0 0 1em;padding:0;list-style:none;">');
    courts.forEach((court) => {
      const isBooked = booked[fac].has(court);
      const label = typeof court === "number" ? `Court ${court}` : court;
      lines.push(
        `<li>${label} <span style="color:${isBooked ? "#f87171" : "#86efac"};font-weight:600;">${isBooked ? "Booked" : "Available"}</span></li>`,
      );
    });
    lines.push("</ul>");
  }
  summaryDiv.innerHTML = lines.join("");
}

// ---------------------------------------------------------------------------
// Load Bookings
// ---------------------------------------------------------------------------

function buildBookingsQuery() {
  const date = document.getElementById("bookingsDateFilter")?.value || "";
  const status = document.getElementById("bookingsStatusFilter")?.value || "";
  const email = document.getElementById("bookingsEmailFilter")?.value || "";
  const ref = document.getElementById("bookingsRefFilter")?.value || "";
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (status) params.set("status", status);
  if (email.trim()) params.set("email", email.trim());
  if (ref.trim()) params.set("ref", ref.trim());
  params.set("limit", "200");
  return params.toString();
}

async function loadAdminBookings() {
  try {
    const query = buildBookingsQuery();
    const response = await fetch(`/admin/bookings?${query}`);
    let data;
    try {
      data = await response.json();
    } catch {
      setStatus("Server error: Invalid response format.");
      return;
    }
    if (!response.ok) {
      setStatus(data?.error || "Could not load bookings.");
      return;
    }
    lastLoadedBookings = data.bookings || [];
    renderBookingRows(lastLoadedBookings);
    renderBookedSummary(lastLoadedBookings);
    refreshCalendar(lastLoadedBookings);
  } catch (err) {
    setStatus(err.message || "Failed to load bookings.");
  }
}

// ---------------------------------------------------------------------------
// Membership Lookup
// ---------------------------------------------------------------------------

document.getElementById("membershipLookupForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("membershipLookupEmail").value.trim();
  const resultDiv = document.getElementById("membershipLookupResult");
  resultDiv.textContent = "Checking...";
  try {
    const res = await fetch(`/admin/check-membership?email=${encodeURIComponent(email)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Unknown error");
    const status =
      data.membershipType && data.membershipType !== "none"
        ? `Member (${data.membershipType})`
        : "Not a member";
    resultDiv.textContent = `${data.name || ""} (${data.email}): ${status}`;
  } catch (err) {
    resultDiv.textContent = err.message || "Could not check membership.";
  }
});

// ---------------------------------------------------------------------------
// Session / Auth
// ---------------------------------------------------------------------------

async function requireAdminSession() {
  try {
    const res = await fetch("/me");
    if (!res.ok) { window.location.href = "smash-force-academy.html"; return false; }
    const data = await res.json();
    if (!data.user?.isAdmin) { window.location.href = "smash-force-academy.html"; return false; }
    setSessionLabel(`Signed in as ${data.user?.name || data.user?.email || "Admin"}`);
    return true;
  } catch {
    window.location.href = "smash-force-academy.html";
    return false;
  }
}

async function logoutAdmin() {
  try { await fetch("/logout", { method: "POST" }); } catch { /* ignore */ }
  window.location.href = "smash-force-academy.html";
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

document.getElementById("reconcileBookingsBtn")?.addEventListener("click", async () => {
  setStatus("Reconciling with Stripe...");
  try {
    const response = await fetch("/admin/reconcile-bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hours: 48, limit: 100 }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "Reconciliation failed.");
    const s = data.summary;
    setStatus(
      `Reconciliation complete.${s ? ` Inserted: ${s.inserted}, Updated: ${s.updated}, Skipped: ${s.skipped}` : ""}`,
    );
    await loadAdminBookings();
  } catch (err) {
    setStatus(err.message || "Reconciliation failed.");
  }
});

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

document.getElementById("adminLogoutBtn").addEventListener("click", logoutAdmin);
document.getElementById("refreshBookingsBtn")?.addEventListener("click", loadAdminBookings);
document.getElementById("bookingsDateFilter")?.addEventListener("change", loadAdminBookings);
document.getElementById("bookingsStatusFilter")?.addEventListener("change", loadAdminBookings);
document.getElementById("bookingsEmailFilter")?.addEventListener("input", loadAdminBookings);
document.getElementById("bookingsRefSearchBtn")?.addEventListener("click", loadAdminBookings);
document.getElementById("bookingsRefFilter")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadAdminBookings();
});

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

requireAdminSession().then((ok) => {
  if (ok) loadAdminBookings();
});
