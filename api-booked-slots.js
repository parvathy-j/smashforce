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
    // Return array of booked times
    const bookedTimes = bookings.map((b) => b.bookingTime);
    return res.json({ booked: bookedTimes });
  } catch (err) {
    console.error("Booked slots API error:", err.message);
    return res.status(500).json({ error: "Failed to fetch booked slots" });
  }
});

module.exports = router;
