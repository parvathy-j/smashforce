// API endpoint to get booked slots for a facility, court, and date
// GET /api/booked-slots?facility=standard&court=1&date=2026-03-28
const express = require("express");
const router = express.Router();
// Assumes you have a function to get bookings from DB
// Example: listBookings({ facility, court, bookingDate })

router.get("/api/booked-slots", async (req, res) => {
  try {
    const facility = String(req.query.facility || "").trim();
    const court = String(req.query.court || "").trim();
    const date = String(req.query.date || "").trim();
    if (!facility || !court || !date) {
      return res
        .status(400)
        .json({ error: "Missing facility, court, or date" });
    }
    // Lazy require avoids circular-dependency issue (server.js requires this file too)
    const { listBookings } = require("./server");

    // Fetch all bookings for this date, then filter in JS for facility + court.
    // listBookings uses `filters.date` (not `bookingDate`), and has no facility/court filter.
    const allForDate = await listBookings({ date, limit: 500 });

    // Only consider active bookings (not expired/failed/cancelled)
    const ACTIVE_STATUSES = new Set(["paid", "pending", "pending_in_person"]);

    // The DB stores court as "Court 1" or "Table 2"; the API receives the raw number (e.g. "1").
    // Normalise both sides to just the number/label for comparison.
    function normaliseCourt(raw) {
      return String(raw || "").replace(/^(court|table)\s*/i, "").trim().toLowerCase();
    }

    const bookings = allForDate.filter((b) => {
      if (!ACTIVE_STATUSES.has(String(b.paymentStatus || "").toLowerCase())) return false;
      // facility stored as 'standard' | 'single' | 'table' — match loosely
      const bFac = String(b.facility || "").toLowerCase();
      if (!bFac.includes(facility.toLowerCase())) return false;
      // court: DB "Court 1" → "1", API "1" → "1"
      return normaliseCourt(b.court) === normaliseCourt(court);
    });

    // Define all possible slots (every 30 min, morning and evening)
    const ALL_SLOTS = [
      "6:00 AM",
      "6:30 AM",
      "7:00 AM",
      "7:30 AM",
      "8:00 AM",
      "8:30 AM",
      "9:00 AM",
      "9:30 AM",
      "10:00 AM",
      "10:30 AM",
      "11:00 AM",
      "11:30 AM",
      "12:00 PM",
      "12:30 PM",
      "1:00 PM",
      "1:30 PM",
      "2:00 PM",
      "2:30 PM",
      "3:00 PM",
      "3:30 PM",
      "4:00 PM",
      "4:30 PM",
      "5:00 PM",
      "5:30 PM",
      "6:00 PM",
      "6:30 PM",
      "7:00 PM",
      "7:30 PM",
      "8:00 PM",
      "8:30 PM",
      "9:00 PM",
      "9:30 PM",
      "10:00 PM",
      "10:30 PM",
    ];

    // Helper to parse time string (e.g., "5:00 PM") to minutes since midnight
    function parseTime(t) {
      const [time, ampm] = t.split(" ");
      let [h, m] = time.split(":").map(Number);
      if (ampm === "PM" && h !== 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      return h * 60 + (m || 0);
    }

    // Expand booking ranges into all affected 30-min slots
    const blocked = new Set();
    for (const b of bookings) {
      const rangeMatch = String(b.bookingTime).match(
        /([0-9]+:[0-9]+\s*[AP]M)\s*-\s*([0-9]+:[0-9]+\s*[AP]M)/i,
      );
      if (rangeMatch) {
        const bookStart = parseTime(rangeMatch[1]);
        const bookEnd   = parseTime(rangeMatch[2]);
        for (const slot of ALL_SLOTS) {
          const slotStart = parseTime(slot);
          const slotEnd   = slotStart + 30; // each slot is 30 minutes
          // Block this slot if it overlaps with the booking window [bookStart, bookEnd)
          if (slotStart < bookEnd && slotEnd > bookStart) blocked.add(slot);
        }
      } else if (ALL_SLOTS.includes(b.bookingTime)) {
        blocked.add(b.bookingTime);
      }
    }
    return res.json({ booked: Array.from(blocked) });
  } catch (err) {
    console.error("Booked slots API error:", err.message);
    return res.status(500).json({ error: "Failed to fetch booked slots" });
  }
});

module.exports = router;
