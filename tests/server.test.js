const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const path = require("path");

const TEST_DB_FILE = path.join(
  __dirname,
  "..",
  "data",
  `smashcourt.test.${process.pid}.db`,
);

process.env.DB_FILE = TEST_DB_FILE;
process.env.PORT = "0";
process.env.ADMIN_SECRET = "test-admin-secret";
process.env.APP_URL = "http://localhost:3000";

const { startServer } = require("../server");

let server;
let baseUrl;

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  return { response, body };
}

test.before(async () => {
  await fs.mkdir(path.dirname(TEST_DB_FILE), { recursive: true });
  await fs.unlink(TEST_DB_FILE).catch(() => {});

  server = await startServer(0);
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
  await fs.unlink(TEST_DB_FILE).catch(() => {});
});

test("GET /health returns ok", async () => {
  const { response, body } = await requestJson(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.stripeConfigured, "boolean");
});

test("POST /signup creates a user and /me returns it", async () => {
  const signupPayload = {
    name: "Integration Tester",
    email: `integration_${Date.now()}@example.com`,
    password: "Test1234!",
    membershipType: "court",
  };

  const signup = await requestJson(`${baseUrl}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signupPayload),
  });

  assert.equal(signup.response.status, 201);
  assert.equal(signup.body.user.email, signupPayload.email);
  assert.equal(signup.body.user.membershipType, "court");

  const sessionCookie = signup.response.headers.get("set-cookie");
  assert.ok(sessionCookie, "Expected session cookie after signup");

  const me = await requestJson(`${baseUrl}/me`, {
    headers: { Cookie: sessionCookie },
  });

  assert.equal(me.response.status, 200);
  assert.equal(me.body.user.email, signupPayload.email);
});

test("POST /signup rejects invalid membership type", async () => {
  const signup = await requestJson(`${baseUrl}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Invalid Member",
      email: `invalid_${Date.now()}@example.com`,
      password: "Test1234!",
      membershipType: "vip-plus",
    }),
  });

  assert.equal(signup.response.status, 400);
  assert.equal(signup.body.error, "Invalid membership type.");
});

test("POST /forgot-password returns a reset token payload for an existing user", async () => {
  const email = `reset_${Date.now()}@example.com`;

  const signup = await requestJson(`${baseUrl}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Reset Tester",
      email,
      password: "Test1234!",
      membershipType: "",
    }),
  });

  assert.equal(signup.response.status, 201);

  const forgotPassword = await requestJson(`${baseUrl}/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  assert.equal(forgotPassword.response.status, 200);
  assert.equal(forgotPassword.body.ok, true);
  assert.equal(typeof forgotPassword.body.message, "string");
  assert.equal(typeof forgotPassword.body.devResetToken, "string");
  assert.ok(forgotPassword.body.devResetToken.length > 20);
});

test("Admin can create in-person walk-in booking", async () => {
  const email = `walkin_admin_${Date.now()}@example.com`;

  const signup = await requestJson(`${baseUrl}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Walk-in Admin",
      email,
      password: "Test1234!",
      membershipType: "",
    }),
  });

  assert.equal(signup.response.status, 201);
  const sessionCookie = signup.response.headers.get("set-cookie");
  assert.ok(sessionCookie, "Expected session cookie after signup");

  const promote = await requestJson(`${baseUrl}/admin/make-admin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ADMIN_SECRET}`,
    },
    body: JSON.stringify({ email }),
  });

  assert.equal(promote.response.status, 200);
  assert.equal(promote.body.ok, true);

  const createWalkIn = await requestJson(`${baseUrl}/create-inperson-booking`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      facility: "standard",
      date: "2026-03-20",
      time: "6:00 PM - 7:00 PM",
      duration: 1,
      court: "Court 1",
      name: "Walk In Customer",
      email: "walkin.customer@example.com",
      phone: "+1 555 123 1234",
      isMember: false,
      membershipType: "",
    }),
  });

  assert.equal(createWalkIn.response.status, 200);
  assert.equal(createWalkIn.body.ok, true);
  assert.ok(createWalkIn.body.bookingId);

  const bookings = await requestJson(`${baseUrl}/admin/bookings?limit=20`, {
    headers: {
      Cookie: sessionCookie,
    },
  });

  assert.equal(bookings.response.status, 200);
  const walkIn = (bookings.body.bookings || []).find(
    (item) => item.id === createWalkIn.body.bookingId,
  );
  assert.ok(walkIn, "Expected walk-in booking in admin bookings list");
  assert.equal(walkIn.paymentStatus, "pending_in_person");
  assert.equal(walkIn.source, "in-person");

  const markPaid = await requestJson(
    `${baseUrl}/admin/bookings/${createWalkIn.body.bookingId}/mark-paid`,
    {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: "http://localhost:3000",
      },
    },
  );

  assert.equal(markPaid.response.status, 200);
  assert.equal(markPaid.body.ok, true);

  const refreshed = await requestJson(`${baseUrl}/admin/bookings?limit=20`, {
    headers: {
      Cookie: sessionCookie,
    },
  });

  assert.equal(refreshed.response.status, 200);
  const paidWalkIn = (refreshed.body.bookings || []).find(
    (item) => item.id === createWalkIn.body.bookingId,
  );
  assert.ok(paidWalkIn, "Expected walk-in booking after mark-paid action");
  assert.equal(paidWalkIn.paymentStatus, "paid");
});
