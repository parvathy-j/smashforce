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
    // Query bookings for this facility/court/date
    const bookings = await listBookings({ facility, court, bookingDate: date });

    // Define all possible 1-hour slots
    const ALL_SLOTS = [
      "6:00 AM", "7:00 AM", "8:00 AM", "9:00 AM", "10:00 AM", "11:00 AM",
      "5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM", "9:00 PM", "10:00 PM"
    ];

    // Helper to parse time string (e.g., "5:00 PM") to minutes since midnight
    function parseTime(t) {
      const [time, ampm] = t.split(" ");
      let [h, m] = time.split(":").map(Number);
      if (ampm === "PM" && h !== 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      return h * 60 + (m || 0);
    }

    // Expand booking ranges into all affected slots
    const blocked = new Set();
    for (const b of bookings) {
      // If bookingTime is a range (e.g., "8:30 AM - 5:30 PM"), block all overlapping slots
      const rangeMatch = String(b.bookingTime).match(/([0-9: ]+[AP]M)\s*-\s*([0-9: ]+[AP]M)/);
      if (rangeMatch) {
        const start = parseTime(rangeMatch[1]);
        const end = parseTime(rangeMatch[2]);
        for (const slot of ALL_SLOTS) {
          const slotStart = parseTime(slot);
          const slotEnd = slotStart + 60;
          // If slot overlaps with booking range, block it
          if (slotStart < end && slotEnd > start) blocked.add(slot);
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
