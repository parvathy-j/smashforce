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


// ---------------------------------------------------------------------------
// Resource Grid — courts as rows, time slots as columns
// ---------------------------------------------------------------------------

const GRID_START_MINS = 5 * 60;   // 5:00 AM
const GRID_END_MINS   = 22 * 60;  // 10:00 PM (last slot label; bookings run to 11 PM)

const GRID_RESOURCES = [
  { key: "standard-1",  label: "Court 1",   facility: "standard", court: "1" },
  { key: "standard-2",  label: "Court 2",   facility: "standard", court: "2" },
  { key: "standard-3",  label: "Court 3",   facility: "standard", court: "3" },
  { key: "standard-4",  label: "Court 4",   facility: "standard", court: "4" },
  { key: "standard-5",  label: "Court 5",   facility: "standard", court: "5" },
  { key: "standard-6",  label: "Court 6",   facility: "standard", court: "6" },
  { key: "single-7",    label: "Court 7",   facility: "single",   court: "7" },
  { key: "single-8",    label: "Court 8",   facility: "single",   court: "8" },
  { key: "single-9",    label: "Court 9",   facility: "single",   court: "9" },
  { key: "table-1",     label: "Table 1",   facility: "table",    court: "Table 1" },
  { key: "table-2",     label: "Table 2",   facility: "table",    court: "Table 2" },
  { key: "table-3",     label: "Table 3",   facility: "table",    court: "Table 3" },
  { key: "table-4",     label: "Table 4",   facility: "table",    court: "Table 4" },
  { key: "table-5",     label: "Table 5",   facility: "table",    court: "Table 5" },
];

function gridSlots() {
  const slots = [];
  for (let m = GRID_START_MINS; m < GRID_END_MINS + 60; m += 30) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const ampm = h < 12 ? "AM" : "PM";
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const label = `${displayH}:${String(min).padStart(2, "0")} ${ampm}`;
    slots.push({ mins: m, label });
  }
  return slots;
}

function slotToMinsGrid(timeStr) {
  const match = (timeStr || "").trim().match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!match) return null;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + m;
}

function resourceMatchesBooking(resource, booking) {
  if (!booking.court) return false;
  const fac = (booking.facility || "").toLowerCase();
  // DB stores "Court 1" / "Table 1"; strip the prefix to get the number/label
  const courtRaw = String(booking.court).replace(/^(court|table)\s*/i, "").trim();

  if (resource.facility === "standard") {
    return fac === "standard" && courtRaw === resource.court;
  }
  if (resource.facility === "single") {
    return fac === "single" && courtRaw === resource.court;
  }
  if (resource.facility === "table") {
    // resource.court is "Table 1" — compare full string
    return fac === "table" && String(booking.court).toLowerCase() === resource.court.toLowerCase();
  }
  return false;
}

function escapeAttr(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function renderBookingGrid(bookings) {
  const container = document.getElementById("bookingGridContainer");
  if (!container) return;

  const selectedDate = document.getElementById("bookingsDateFilter")?.value;
  if (!selectedDate) {
    container.innerHTML = '<p style="color:var(--text-dim);padding:1em 0;">Select a date to view the court schedule.</p>';
    return;
  }

  const dayBookings = bookings.filter((b) => b.bookingDate === selectedDate && b.bookingTime);
  const slots = gridSlots();

  // Build lookup: resourceKey -> list of {startMins, endMins, booking}
  const bookingMap = {};
  GRID_RESOURCES.forEach((r) => { bookingMap[r.key] = []; });

  dayBookings.forEach((b) => {
    const parts = (b.bookingTime || "").split(" - ");
    const startMins = slotToMinsGrid(parts[0]?.trim());
    const endMins   = slotToMinsGrid(parts[1]?.trim());
    if (startMins === null) return;
    const actualEnd = endMins !== null ? endMins : startMins + 60;

    GRID_RESOURCES.forEach((r) => {
      if (resourceMatchesBooking(r, b)) {
        bookingMap[r.key].push({ startMins, endMins: actualEnd, booking: b });
      }
    });
  });

  // Render table
  let html = '<table class="booking-grid">';

  // Header row — time labels
  html += '<thead><tr><th class="grid-court-label">Court / Table</th>';
  slots.forEach((s) => {
    if (s.mins % 60 === 0) {
      html += `<th class="grid-time-header" colspan="2">${s.label}</th>`;
    }
  });
  html += "</tr></thead><tbody>";

  // Sub-header row — :00 / :30 ticks
  html += '<tr class="grid-subrow"><td class="grid-court-label"></td>';
  slots.forEach((s) => {
    const tick = s.mins % 60 === 0 ? ":00" : ":30";
    html += `<td class="grid-tick">${tick}</td>`;
  });
  html += "</tr>";

  // One row per resource
  GRID_RESOURCES.forEach((r) => {
    html += `<tr><td class="grid-court-label">${r.label}</td>`;
    const rowBookings = bookingMap[r.key];

    slots.forEach((s) => {
      // Is this slot covered by a booking?
      const match = rowBookings.find(
        (entry) => s.mins >= entry.startMins && s.mins < entry.endMins
      );
      if (match) {
        const b = match.booking;
        const status = String(b.paymentStatus || "pending").toLowerCase();
        const customer = escapeAttr(b.customerName || b.customerEmail || "");
        const time = escapeAttr(b.bookingTime || "");
        // Only render cell at the start slot; spanning is handled by colspan logic below
        // We use a simple colored cell approach (no colspan) for simplicity
        html += `<td class="grid-cell booked ${status}"
          data-booking-id="${escapeAttr(String(b.id || ""))}"
          data-date="${escapeAttr(selectedDate)}"
          title="${customer} · ${time} · ${status}"
          onclick="gridCellClick(this)">
          ${s.mins === match.startMins ? `<span class="grid-cell-label">${customer}</span>` : ""}
        </td>`;
      } else {
        html += `<td class="grid-cell empty"></td>`;
      }
    });

    html += "</tr>";
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

function gridCellClick(cell) {
  const bookingId = cell.dataset.bookingId;
  const dateStr = cell.dataset.date;
  if (!bookingId || !dateStr) return;
  const booking = lastLoadedBookings.find((b) => String(b.id) === bookingId);
  if (booking) showBookingDetailsModal(dateStr, [booking]);
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
    list.innerHTML = '<div style="color:#888;padding:1em 0;">No bookings for this date.</div>';
  } else {
    list.innerHTML = items.map((b) => {
      const status = String(b.paymentStatus || "pending").toLowerCase();
      const ref = bookingRef(b);
      const statusColors = {
        paid: "#86efac",
        pending: "#fcd34d",
        pending_in_person: "#7dd3fc",
        expired: "#d1d5db",
        failed: "#fca5a5",
      };
      const statusColor = statusColors[status] || "#d1d5db";
      const rows = [
        ["Ref",      ref],
        ["Customer", b.customerName || "-"],
        ["Email",    b.customerEmail || "-"],
        ["Phone",    b.customerPhone || b.phone || "-"],
        ["Facility", b.facility ? `${b.facility}${b.court ? ` — ${b.court}` : ""}` : "-"],
        ["Date",     b.bookingDate || "-"],
        ["Time",     b.bookingTime || "-"],
        ["Duration", b.duration || "-"],
        ["Amount",   formatMoney(b.amount, b.currency)],
      ].map(([label, value]) => `
        <div class="modal-detail-row">
          <span class="modal-detail-label">${label}</span>
          <span class="modal-detail-value">${value}</span>
        </div>`).join("");

      return `<div class="booking-entry">
        <div class="modal-entry-header">
          <span class="booking-customer">${b.customerName || b.customerEmail || "-"}</span>
          <span class="modal-status-badge" style="background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40;">${status.replace(/_/g, " ")}</span>
        </div>
        <div class="modal-detail-grid">${rows}</div>
        ${status === "pending_in_person" ? `<button class="btn primary" style="margin-top:10px;width:100%;" onclick="markBookingPaid('${b.id}')">Mark Paid</button>` : ""}
      </div>`;
    }).join("");
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
    renderBookingGrid(lastLoadedBookings);
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
