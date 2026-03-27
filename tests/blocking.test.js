// Automated test for booking slot blocking
// Run with: node tests/blocking.test.js

const fetch = require("node-fetch");
const assert = require("assert");

const BASE_URL = "http://localhost:3000"; // Change if needed

async function testBookedSlotBlocking() {
  // 1. Create a booking for a specific court, date, and time
  const facility = "standard";
  const court = "1";
  const date = "2026-04-01";
  const time = "7:00 PM";

  // Simulate booking creation (assume API exists for test, or insert directly in DB)
  // Here, we assume a test endpoint exists for test setup (not in prod!)
  const createRes = await fetch(`${BASE_URL}/api/test-create-booking`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ facility, court, date, time }),
  });
  assert.strictEqual(createRes.status, 200, "Booking creation failed");

  // 2. Query the booked slots API
  const bookedRes = await fetch(
    `${BASE_URL}/api/booked-slots?facility=${facility}&court=${court}&date=${date}`,
  );
  assert.strictEqual(bookedRes.status, 200, "Booked slots API failed");
  const data = await bookedRes.json();
  assert(Array.isArray(data.booked), "Booked slots response invalid");
  assert(data.booked.includes(time), "Booked slot is not blocked");

  // 3. Clean up (delete test booking)
  await fetch(`${BASE_URL}/api/test-delete-booking`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ facility, court, date, time }),
  });

  console.log("✅ Booked slot blocking test passed");
}

testBookedSlotBlocking().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
