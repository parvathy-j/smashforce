// Membership lookup logic
document
  .getElementById("membershipLookupForm")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("membershipLookupEmail").value.trim();
    const resultDiv = document.getElementById("membershipLookupResult");
    resultDiv.textContent = "Checking...";
    try {
      const res = await fetch(
        `/admin/check-membership?email=${encodeURIComponent(email)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Unknown error");
      let status =
        data.membershipType && data.membershipType !== "none"
          ? `Member (${data.membershipType})`
          : "Not a member";
      resultDiv.textContent = `${data.name} (${data.email}): ${status}`;
    } catch (err) {
      resultDiv.textContent = err.message || "Could not check membership.";
    }
  });
const defaults = {
  logoTagline: "Experience the Power of the Smash.",
  heroAnnouncement: "Now accepting bookings",
  heroDescription:
    "9 professional badminton courts, 5 multi-game tables, and elite facilities — open mornings and evenings for players of every level.",
  standardCourtPrice: "$25",
  singleCourtPrice: "$15",
  tablePrice: "$15/hr",
  courtMembershipPrice: "$49",
  allAccessMembershipPrice: "$79",
  bookingCta: "🏸 Book Your Court Now",
  contactLocation: "Your Full Address · City",
  contactPhone: "+1 (000) 000-0000",
  contactEmail: "info@smashforceacademy.com",
  contactHours: "Morning 6–9 AM · Evening 5–11 PM",
  floatingButtonText: "🏸Book Now!",
};

async function loadAdminContent() {
  try {
    const response = await fetch("/admin/content");
    if (!response.ok) {
      throw new Error("Could not load admin content.");
    }
    const payload = await response.json();
    return { ...defaults, ...(payload.content || {}) };
  } catch (err) {
    setStatus(err.message || "Could not load admin content.");
    return { ...defaults };
  }
}

function setStatus(message) {
  document.getElementById("statusText").textContent = message;
}

function setSessionLabel(message) {
  const label = document.getElementById("adminSessionLabel");
  if (label) {
    label.textContent = message;
  }
}

function formatMoney(cents, currency = "usd") {
  const amount = Number(cents || 0) / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: String(currency || "usd").toUpperCase(),
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

async function markBookingPaid(bookingId) {
  try {
    const response = await fetch(
      `/admin/bookings/${encodeURIComponent(bookingId)}/mark-paid`,
      {
        method: "POST",
      },
    );
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Could not mark booking paid.");
    }
    setStatus(data?.message || "Booking marked paid.");
    await loadAdminBookings();
  } catch (err) {
    setStatus(err.message || "Could not mark booking paid.");
  }
}

function renderBookingRows(bookings = []) {
  const body = document.getElementById("bookingsTableBody");
  if (!body) {
    return;
  }

  body.innerHTML = "";
  if (!Array.isArray(bookings) || bookings.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.textContent = "No bookings found for current filters.";
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  bookings.forEach((booking) => {
    const tr = document.createElement("tr");
    const created = booking.createdAt
      ? new Date(booking.createdAt).toLocaleString()
      : "-";
    const customer = booking.customerName || booking.customerEmail || "-";
    const facility = booking.facility || "-";
    const date = booking.bookingDate || "-";
    const time = booking.bookingTime || "-";
    const amount = formatMoney(booking.amount, booking.currency);
    const status = String(booking.paymentStatus || "pending").toLowerCase();

    const cells = [
      document.createElement("td"),
      document.createElement("td"),
      document.createElement("td"),
      document.createElement("td"),
      document.createElement("td"),
      document.createElement("td"),
      document.createElement("td"),
      document.createElement("td"),
    ];

    cells[0].textContent = created;

    const customerName = document.createElement("div");
    customerName.textContent = customer;
    const customerEmail = document.createElement("small");
    customerEmail.textContent = booking.customerEmail || "";
    cells[1].appendChild(customerName);
    cells[1].appendChild(customerEmail);

    const facilityText = booking.court
      ? `${facility} (${booking.court})`
      : facility;
    cells[2].textContent = facilityText;
    cells[3].textContent = date;
    cells[4].textContent = time;
    cells[5].textContent = amount;

    const statusPill = document.createElement("span");
    statusPill.className = `status-pill ${status}`;
    statusPill.textContent = status;
    cells[6].appendChild(statusPill);

    if (status === "pending_in_person") {
      const markPaidBtn = document.createElement("button");
      markPaidBtn.type = "button";
      markPaidBtn.className = "btn booking-action-btn";
      markPaidBtn.textContent = "Mark Paid";
      markPaidBtn.addEventListener("click", () => markBookingPaid(booking.id));
      cells[7].appendChild(markPaidBtn);
    } else {
      cells[7].textContent = "-";
    }

    cells.forEach((cell) => tr.appendChild(cell));
    body.appendChild(tr);
  });
}

function buildBookingsQuery() {
  const date = document.getElementById("bookingsDateFilter")?.value || "";
  const status = document.getElementById("bookingsStatusFilter")?.value || "";
  const email = document.getElementById("bookingsEmailFilter")?.value || "";
  const params = new URLSearchParams();
  if (date) {
    params.set("date", date);
  }
  if (status) {
    params.set("status", status);
  }
  if (email.trim()) {
    params.set("email", email.trim());
  }
  params.set("limit", "200");
  return params.toString();
}

async function loadAdminBookings() {
  try {
    const query = buildBookingsQuery();
    const response = await fetch(`/admin/bookings?${query}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Could not load bookings.");
    }
    renderBookingRows(data.bookings || []);
  } catch (err) {
    setStatus(err.message || "Failed to load bookings.");
  }
}

async function requireAdminSession() {
  try {
    const res = await fetch("/me");
    if (!res.ok) {
      window.location.href = "smash-force-academy.html";
      return false;
    }

    const data = await res.json();
    if (!data.user?.isAdmin) {
      window.location.href = "smash-force-academy.html";
      return false;
    }
    const name = data.user?.name || data.user?.email || "Member";
    setSessionLabel(`Signed in as ${name} (Admin)`);
    return true;
  } catch {
    window.location.href = "smash-force-academy.html";
    return false;
  }
}

async function logoutAdmin() {
  try {
    await fetch("/logout", { method: "POST" });
  } catch {
    // Redirect regardless; session state will be revalidated.
  }
  window.location.href = "smash-force-academy.html";
}

function fillForm(data) {
  Object.entries(data).forEach(([key, value]) => {
    const field = document.querySelector(`[name="${key}"]`);
    if (field) {
      field.value = value;
    }
  });
}

function readForm() {
  const payload = {};
  Object.keys(defaults).forEach((key) => {
    const field = document.querySelector(`[name="${key}"]`);
    payload[key] = field ? field.value.trim() : defaults[key];
  });
  return payload;
}

async function saveData() {
  const payload = readForm();
  try {
    const response = await fetch("/admin/content", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Could not save content.");
    }
    fillForm({ ...defaults, ...(data.content || {}) });
    setStatus("Saved. Refresh the website tab to see updated content.");
  } catch (err) {
    setStatus(err.message || "Could not save content.");
  }
}

async function resetData() {
  fillForm(defaults);
  await saveData();
  setStatus("Reset to defaults.");
}

document.getElementById("saveBtn").addEventListener("click", saveData);
document.getElementById("resetBtn").addEventListener("click", resetData);
document
  .getElementById("adminLogoutBtn")
  .addEventListener("click", logoutAdmin);

document
  .getElementById("refreshBookingsBtn")
  ?.addEventListener("click", loadAdminBookings);
document
  .getElementById("bookingsDateFilter")
  ?.addEventListener("change", loadAdminBookings);
document
  .getElementById("bookingsStatusFilter")
  ?.addEventListener("change", loadAdminBookings);
document
  .getElementById("bookingsEmailFilter")
  ?.addEventListener("input", loadAdminBookings);

requireAdminSession().then(async (ok) => {
  if (ok) {
    const content = await loadAdminContent();
    fillForm(content);
    loadAdminBookings();
  }
});
