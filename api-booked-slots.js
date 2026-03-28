// API endpoint to get booked slots for a facility, court, and date
// GET /api/booked-slots?facility=standard&court=1&date=2026-03-28
const express = require("express");
const router = express.Router();

// All possible 30-min slots the booking page can show
const ALL_SLOTS = [
  "6:00 AM",  "6:30 AM",
  "7:00 AM",  "7:30 AM",
  "8:00 AM",  "8:30 AM",
  "9:00 AM",  "9:30 AM",
  "10:00 AM", "10:30 AM",
  "11:00 AM", "11:30 AM",
  "12:00 PM", "12:30 PM",
  "1:00 PM",  "1:30 PM",
  "2:00 PM",  "2:30 PM",
  "3:00 PM",  "3:30 PM",
  "4:00 PM",  "4:30 PM",
  "5:00 PM",  "5:30 PM",
  "6:00 PM",  "6:30 PM",
  "7:00 PM",  "7:30 PM",
  "8:00 PM",  "8:30 PM",
  "9:00 PM",  "9:30 PM",
  "10:00 PM", "10:30 PM",
];

// Parse "9:00 AM" → minutes since midnight
function parseTimeMins(t) {
  const m = String(t || "").trim().match(/^(\d+):(\d+)\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

router.get("/api/booked-slots", async (req, res) => {
  try {
    const facility = String(req.query.facility || "").trim().toLowerCase();
    const courtNum = String(req.query.court  || "").trim();
    const date     = String(req.query.date   || "").trim();

    if (!facility || !courtNum || !date) {
      return res.status(400).json({ error: "Missing facility, court, or date" });
    }

    // Build the court label exactly as stored in the DB:
    //   facility="table"  → "Table 1"
    //   facility="standard" | "single" → "Court 7"
    const courtLabel = facility === "table"
      ? `Table ${courtNum}`
      : `Court ${courtNum}`;

    // Lazy require avoids circular-dependency (server.js requires this file)
    const { getActiveBookingTimes } = require("./server");
    const bookingTimes = await getActiveBookingTimes({ facility, courtLabel, date });

    // Expand each booking's time range into the 30-min slots it covers
    const blocked = new Set();
    for (const bookingTime of bookingTimes) {
      const rangeMatch = bookingTime.match(
        /([0-9]+:[0-9]+\s*[AP]M)\s*-\s*([0-9]+:[0-9]+\s*[AP]M)/i,
      );
      if (rangeMatch) {
        const bookStart = parseTimeMins(rangeMatch[1]);
        const bookEnd   = parseTimeMins(rangeMatch[2]);
        if (bookStart === null || bookEnd === null) continue;
        for (const slot of ALL_SLOTS) {
          const slotStart = parseTimeMins(slot);
          if (slotStart === null) continue;
          const slotEnd = slotStart + 30; // each slot is 30 minutes
          // Block slot if it overlaps [bookStart, bookEnd)
          if (slotStart < bookEnd && slotEnd > bookStart) blocked.add(slot);
        }
      } else if (ALL_SLOTS.includes(bookingTime)) {
        blocked.add(bookingTime);
      }
    }

    return res.json({ booked: Array.from(blocked) });
  } catch (err) {
    console.error("Booked slots API error:", err.message);
    return res.status(500).json({ error: "Failed to fetch booked slots" });
  }
});

module.exports = router;
