// Send booking confirmation email
async function sendBookingConfirmationEmail({ to, name, facility, court, date, time, duration, ref }) {
  const transporter = getMailerTransport();
  if (!transporter) return false;
  const mailOptions = {
    from: SMTP_FROM,
    to,
    subject: `Booking Confirmed: ${facility} on ${date}`,
    text: [
      `Hi ${name || "Player"},`,
      '',
      `Your booking is confirmed!`,
      '',
      `Facility: ${facility}`,
      `Court/Table: ${court}`,
      `Date: ${date}`,
      `Time: ${time}`,
      `Duration: ${duration}`,
      `Reference: ${ref}`,
      '',
      'Please arrive 10 minutes before your session.',
      '',
      'Thank you for booking with Smashforce Badminton Centre!'
    ].join('\n'),
  };
  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error('Booking confirmation email failed:', err.message);
    return false;
  }
}
// server.js
// Express backend for Stripe Checkout and webhook verification.

require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");

const app = express();

const stripe = process.env.STRIPE_SECRET_KEY
  ? Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
const APP_URL = String(process.env.APP_URL || "http://localhost:3000").trim();
const CMS_SERVING_URL = String(process.env.CMS_SERVING_URL || "").trim();
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || IS_PRODUCTION;

function resolveAppOrigin(rawUrl) {
  const value = String(rawUrl || "").trim();
  const candidates = [value, `https://${value}`];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      return new URL(candidate).origin;
    } catch {
      // Try the next candidate format.
    }
  }

  const fallback = "http://localhost:3000";
  console.warn(
    `Invalid APP_URL '${value}'. Falling back to ${fallback} for origin checks.`,
  );
  return fallback;
}

const APP_ORIGIN = resolveAppOrigin(APP_URL);
const SESSION_COOKIE_NAME = "sf_session";
const SESSION_COOKIE_DOMAIN = String(
  process.env.SESSION_COOKIE_DOMAIN || "",
).trim();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PASSWORD_RESET_DEV_EXPOSE_TOKEN =
  process.env.PASSWORD_RESET_DEV_EXPOSE_TOKEN === "1" || !IS_PRODUCTION;
const PASSWORD_RESET_BASE_URL = String(
  process.env.PASSWORD_RESET_BASE_URL || APP_URL,
).trim();
const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE =
  String(process.env.SMTP_SECURE || "").trim() === "1" ||
  String(process.env.SMTP_SECURE || "")
    .trim()
    .toLowerCase() === "true";
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "");
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER || "").trim();
const SMTP_REPLY_TO = String(process.env.SMTP_REPLY_TO || "").trim();
const SMTP_DEBUG = process.env.SMTP_DEBUG === "1";
const CONTACT_FORM_TO = String(
  process.env.CONTACT_FORM_TO || "info@smashforcebaminton.com",
).trim();
const USERS_FILE =
  process.env.USERS_FILE || path.join(__dirname, "data", "users.json");
const DB_FILE =
  process.env.DB_FILE || path.join(__dirname, "data", "smashforce.db");
const DB_PROVIDER = String(process.env.DB_PROVIDER || "sqlite")
  .trim()
  .toLowerCase();
let db = null;
let pgPool = null;
let mysqlPool = null;
let sqlite3 = null;
let mysql = null;
let mailerTransport = null;
const rateLimitBuckets = new Map();

function isSmtpConfigured() {
  return Boolean(SMTP_HOST && Number.isFinite(SMTP_PORT) && SMTP_FROM);
}

function getSmtpConfigSummary() {
  return {
    host: SMTP_HOST || "(empty)",
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    hasUser: Boolean(SMTP_USER),
    hasPass: Boolean(SMTP_PASS),
    from: SMTP_FROM || "(empty)",
    replyTo: SMTP_REPLY_TO || "(empty)",
  };
}

function getMailErrorDetails(err) {
  return {
    message: err?.message || "Unknown mail error",
    code: err?.code || "",
    responseCode: err?.responseCode || "",
    command: err?.command || "",
    response: err?.response || "",
  };
}

function getMailerTransport() {
  if (!isSmtpConfigured()) {
    return null;
  }

  if (mailerTransport) {
    return mailerTransport;
  }

  const transportConfig = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  };

  if (SMTP_USER && SMTP_PASS) {
    transportConfig.auth = {
      user: SMTP_USER,
      pass: SMTP_PASS,
    };
  }

  mailerTransport = nodemailer.createTransport(transportConfig);
  return mailerTransport;
}

async function sendPasswordResetEmail({ toEmail, toName, resetLink }) {
  const transporter = getMailerTransport();
  if (!transporter) {
    return false;
  }

  const safeName = String(toName || "there").trim() || "there";
  const mailOptions = {
    from: SMTP_FROM,
    to: toEmail,
    subject: "Reset your Smashforce password",
    text: `Hi ${safeName},\n\nWe received a request to reset your Smashforce password.\n\nUse this link to reset it (valid for 1 hour):\n${resetLink}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Hi ${safeName},</p><p>We received a request to reset your Smashforce password.</p><p><a href="${resetLink}">Reset your password</a> (valid for 1 hour)</p><p>If you did not request this, you can ignore this email.</p>`,
  };

  if (SMTP_REPLY_TO) {
    mailOptions.replyTo = SMTP_REPLY_TO;
  }

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error("Password reset mail error:", getMailErrorDetails(err));
    if (SMTP_DEBUG) {
      console.info("SMTP config summary:", getSmtpConfigSummary());
    }
    mailerTransport = null; // reset so next request gets a fresh transport
    return false;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendContactFormEmail({ name, email, phone, topic, message }) {
  const transporter = getMailerTransport();
  if (!transporter) {
    return false;
  }

  const safeName =
    String(name || "Website Visitor").trim() || "Website Visitor";
  const safeEmail = String(email || "").trim();
  const safePhone = String(phone || "").trim();
  const safeTopic =
    String(topic || "General Enquiry").trim() || "General Enquiry";
  const safeMessage = String(message || "").trim();

  const mailOptions = {
    from: SMTP_FROM,
    to: CONTACT_FORM_TO,
    subject: `Website Contact: ${safeTopic}`,
    text: [
      `Name: ${safeName}`,
      `Email: ${safeEmail || "Not provided"}`,
      `Phone: ${safePhone || "Not provided"}`,
      "",
      "Message:",
      safeMessage,
    ].join("\n"),
    html: `<p><strong>Name:</strong> ${escapeHtml(safeName)}</p><p><strong>Email:</strong> ${escapeHtml(safeEmail || "Not provided")}</p><p><strong>Phone:</strong> ${escapeHtml(safePhone || "Not provided")}</p><p><strong>Topic:</strong> ${escapeHtml(safeTopic)}</p><p><strong>Message:</strong></p><p>${escapeHtml(safeMessage).replace(/\n/g, "<br>")}</p>`,
  };

  if (safeEmail) {
    mailOptions.replyTo = safeEmail;
  } else if (SMTP_REPLY_TO) {
    mailOptions.replyTo = SMTP_REPLY_TO;
  }

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error("Contact form mail error:", getMailErrorDetails(err));
    if (SMTP_DEBUG) {
      console.info("SMTP config summary:", getSmtpConfigSummary());
    }
    mailerTransport = null; // reset so next request gets a fresh transport
    return false;
  }
}

function isPostgresProvider() {
  return DB_PROVIDER === "postgres" || DB_PROVIDER === "postgresql";
}

function isMysqlProvider() {
  return DB_PROVIDER === "mysql" || DB_PROVIDER === "mariadb";
}

function toPostgresSql(sql) {
  let index = 0;
  return String(sql).replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

function toDbBoolean(value) {
  if (isPostgresProvider()) {
    return Boolean(value);
  }
  return value ? 1 : 0;
}

function normalizeSameSite(value) {
  const normalized = String(value || "Lax")
    .trim()
    .toLowerCase();
  if (normalized === "strict") {
    return "Strict";
  }
  if (normalized === "none") {
    return "None";
  }
  return "Lax";
}

const SESSION_COOKIE_SAMESITE = normalizeSameSite(
  process.env.SESSION_COOKIE_SAMESITE || "Lax",
);

if (TRUST_PROXY) {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

const FACILITY_PRICES = {
  standard: {
    label: "Standard Court Booking",
    amount: 2500,
    memberAmount: 2200,
  },
  single: {
    label: "Single Court Booking",
    amount: 1500,
    memberAmount: 1200,
  },
  table: {
    label: "Multi-Game Table Booking",
    amount: 1500,
    memberAmount: 1200,
    allAccessAmount: 1200,
  },
};

const MEMBERSHIP_PRICES = {
  court: {
    label: "Court Membership (1 month)",
    amount: 4900,
  },
  "all-access": {
    label: "All Access Membership (1 month)",
    amount: 7900,
  },
};

function loadPromoCodes() {
  const raw = String(process.env.PROMO_CODES || "").trim();
  let normalized = {};
  // Always add a test promo code for $1 payments
  normalized["TESTPAY"] = { type: "fixed", value: 1499, minAmount: 0 };
  if (!raw) {
    return normalized;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return normalized;
    }
    for (const [rawCode, rawRule] of Object.entries(parsed)) {
      const code = String(rawCode || "")
        .trim()
        .toUpperCase();
      if (!code || !rawRule || typeof rawRule !== "object") continue;
      const type = String(rawRule.type || "")
        .trim()
        .toLowerCase();
      if (type === "percent") {
        const value = Number(rawRule.value);
        if (!Number.isFinite(value) || value <= 0 || value > 100) continue;
        normalized[code] = {
          type: "percent",
          value,
          minAmount: Math.max(0, Number(rawRule.minAmount || 0)),
        };
        continue;
      }
      if (type === "fixed") {
        const cents = Number(rawRule.value);
        if (!Number.isFinite(cents) || cents <= 0) continue;
        normalized[code] = {
          type: "fixed",
          value: Math.round(cents),
          minAmount: Math.max(0, Number(rawRule.minAmount || 0)),
        };
      }
    }
    return normalized;
  } catch {
    return normalized;
  }
}

const PROMO_CODES = loadPromoCodes();

function resolvePromo(codeRaw = "") {
  const code = String(codeRaw || "")
    .trim()
    .toUpperCase();
  if (!code) {
    return null;
  }
  return PROMO_CODES[code] ? { code, rule: PROMO_CODES[code] } : null;
}

function applyPromoDiscount(baseAmountCents, promo = null) {
  const base = Math.max(0, Math.round(Number(baseAmountCents || 0)));
  if (!promo?.rule) {
    return {
      amountBeforeDiscount: base,
      discountAmount: 0,
      amountAfterDiscount: base,
      appliedPromoCode: "",
    };
  }

  const minAmount = Math.max(0, Math.round(Number(promo.rule.minAmount || 0)));
  if (base < minAmount) {
    return {
      amountBeforeDiscount: base,
      discountAmount: 0,
      amountAfterDiscount: base,
      appliedPromoCode: "",
      promoError: `Promo code requires a minimum order of $${(minAmount / 100).toFixed(2)}.`,
    };
  }

  let discount = 0;
  if (promo.rule.type === "percent") {
    discount = Math.round((base * Number(promo.rule.value || 0)) / 100);
  } else if (promo.rule.type === "fixed") {
    discount = Math.round(Number(promo.rule.value || 0));
  }

  discount = Math.max(0, Math.min(discount, base));

  return {
    amountBeforeDiscount: base,
    discountAmount: discount,
    amountAfterDiscount: Math.max(0, base - discount),
    appliedPromoCode: discount > 0 ? promo.code : "",
  };
}

const SITE_CONTENT_DEFAULTS = {
  logoTagline: "Experience the Power of the Smash.",
  heroAnnouncement: "Now accepting bookings",
  heroDescription:
    "9 professional badminton courts, 5 multi-game tables, and elite facilities, open mornings and evenings for players of every level.",
  standardCourtPrice: "$25",
  singleCourtPrice: "$15",
  tablePrice: "$15/hr",
  courtMembershipPrice: "$49",
  allAccessMembershipPrice: "$79",
  bookingCta: "🏸 Book Your Court Now",
  contactLocation: "4 Simpson St, Moorabbin VIC 3189",
  contactPhone: "+61 370 447 733",
  contactEmail: "info@smashforceacademy.com",
  contactHours: "Morning 6–9 AM · Evening 5–11 PM",
  floatingButtonText: "🏸Book Now!",
};

app.use((req, res, next) => {
  if (req.path !== "/admin.html") {
    return next();
  }

  return requireAdmin(req, res, () => {
    res.sendFile(path.join(__dirname, "admin.html"));
  });
});

app.use(express.static("."));
const jsonParser = express.json();
app.use((req, res, next) => {
  // Preserve raw payload for Stripe signature verification.
  if (req.originalUrl.startsWith("/stripe-webhook")) {
    return next();
  }
  return jsonParser(req, res, next);
});

app.get("/", (_req, res) => {
  // Allow hosting frontend/CMS separately while keeping this service as backend.
  if (CMS_SERVING_URL) {
    return res.redirect(302, CMS_SERVING_URL);
  }
  res.sendFile(path.join(__dirname, "smash-force-academy.html"));
});

app.get("/health", (_, res) => {
  res.json({ ok: true, stripeConfigured: Boolean(stripe) });
});

app.get("/client-config.js", (_req, res) => {
  const publishableKey = String(process.env.STRIPE_PUBLISHABLE_KEY || "");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(
    `window.__SFA_CONFIG__ = { STRIPE_PUBLISHABLE_KEY: ${JSON.stringify(publishableKey)} };`,
  );
});

function requireStripeConfigured(res) {
  if (stripe) {
    return true;
  }

  res.status(503).json({
    error:
      "Stripe is not configured for this environment. Add STRIPE_SECRET_KEY to enable payments.",
  });
  return false;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) {
    return {};
  }

  return header.split(";").reduce((acc, pair) => {
    const [rawName, ...rawValue] = pair.trim().split("=");
    if (!rawName) {
      return acc;
    }
    acc[rawName] = decodeURIComponent(rawValue.join("=") || "");
    return acc;
  }, {});
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return String(forwarded).split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function createRateLimiter({ keyPrefix, maxRequests, windowMs }) {
  return (req, res, next) => {
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        error: "Too many requests. Please try again shortly.",
      });
    }

    bucket.count += 1;
    return next();
  };
}

function requireSameOrigin(req, res, next) {
  const token = getSessionToken(req);
  if (!token) {
    return next();
  }

  const originHeader = String(req.headers.origin || "").trim();
  const refererHeader = String(req.headers.referer || "").trim();
  let requestOrigin = "";

  if (originHeader) {
    requestOrigin = originHeader;
  } else if (refererHeader) {
    try {
      requestOrigin = new URL(refererHeader).origin;
    } catch {
      requestOrigin = "";
    }
  }

  if (!requestOrigin || requestOrigin !== APP_ORIGIN) {
    return res.status(403).json({ error: "Blocked by CSRF origin policy." });
  }

  return next();
}

const signupRateLimit = createRateLimiter({
  keyPrefix: "signup",
  maxRequests: 20,
  windowMs: 10 * 60 * 1000,
});

const loginRateLimit = createRateLimiter({
  keyPrefix: "login",
  maxRequests: 15,
  windowMs: 10 * 60 * 1000,
});

const forgotPasswordRateLimit = createRateLimiter({
  keyPrefix: "forgot-password",
  maxRequests: 8,
  windowMs: 10 * 60 * 1000,
});

const resetPasswordRateLimit = createRateLimiter({
  keyPrefix: "reset-password",
  maxRequests: 12,
  windowMs: 10 * 60 * 1000,
});

const contactMessageRateLimit = createRateLimiter({
  keyPrefix: "contact-message",
  maxRequests: 12,
  windowMs: 10 * 60 * 1000,
});

const bookingRateLimit = createRateLimiter({
  keyPrefix: "booking",
  maxRequests: 30,
  windowMs: 10 * 60 * 1000,
});

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    membershipType: user.membershipType || "",
    isAdmin: Boolean(user.isAdmin),
    createdAt: user.createdAt,
  };
}

async function ensureUsersFile() {
  await fs.mkdir(path.dirname(USERS_FILE), { recursive: true });
  try {
    await fs.access(USERS_FILE);
  } catch {
    await fs.writeFile(USERS_FILE, "[]", "utf8");
  }
}

function dbRun(sql, params = []) {
  if (isPostgresProvider()) {
    return pgPool.query(toPostgresSql(sql), params);
  }

  if (isMysqlProvider()) {
    return mysqlPool.execute(sql, params).then(([result]) => result);
  }

  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  if (isPostgresProvider()) {
    return pgPool
      .query(toPostgresSql(sql), params)
      .then((result) => result.rows[0] || null);
  }

  if (isMysqlProvider()) {
    return mysqlPool
      .execute(sql, params)
      .then(([rows]) => (rows && rows[0] ? rows[0] : null));
  }

  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });
}

function dbAll(sql, params = []) {
  if (isPostgresProvider()) {
    return pgPool
      .query(toPostgresSql(sql), params)
      .then((result) => result.rows || []);
  }

  if (isMysqlProvider()) {
    return mysqlPool.execute(sql, params).then(([rows]) => rows || []);
  }

  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

async function insertBooking(booking) {
  const nowIso = new Date().toISOString();
  const id = crypto.randomUUID();
  await dbRun(
    `INSERT INTO bookings (
      id,
      user_id,
      customer_name,
      customer_email,
      customer_phone,
      facility,
      booking_date,
      booking_time,
      duration,
      court,
      membership_type,
      applied_membership,
      amount,
      currency,
      payment_status,
      checkout_session_id,
      payment_intent_id,
      source,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      booking.userId || null,
      booking.name || "",
      booking.email || "",
      booking.phone || "",
      booking.facility || "",
      booking.date || "",
      booking.time || "",
      booking.duration || "",
      booking.court || "",
      booking.membershipType || "",
      booking.appliedMembership || "none",
      Number(booking.amount || 0),
      booking.currency || "aud",
      booking.paymentStatus || "pending",
      booking.checkoutSessionId || null,
      booking.paymentIntentId || null,
      booking.source || "checkout",
      nowIso,
      nowIso,
    ],
  );

  return id;
}

async function updateBookingByCheckoutSession(sessionId, status) {
  if (!sessionId) {
    return;
  }
  await dbRun(
    "UPDATE bookings SET payment_status = ?, updated_at = ? WHERE checkout_session_id = ?",
    [status, new Date().toISOString(), sessionId],
  );
}

async function updateBookingByPaymentIntent(paymentIntentId, status) {
  if (!paymentIntentId) {
    return;
  }
  await dbRun(
    "UPDATE bookings SET payment_status = ?, updated_at = ? WHERE payment_intent_id = ?",
    [status, new Date().toISOString(), paymentIntentId],
  );
}

async function updateBookingById(bookingId, updates = {}) {
  if (!bookingId) {
    return;
  }

  const clauses = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(updates, "status")) {
    clauses.push("payment_status = ?");
    params.push(updates.status);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "checkoutSessionId")) {
    clauses.push("checkout_session_id = ?");
    params.push(updates.checkoutSessionId || null);
  }
  if (Object.prototype.hasOwnProperty.call(updates, "paymentIntentId")) {
    clauses.push("payment_intent_id = ?");
    params.push(updates.paymentIntentId || null);
  }

  if (!clauses.length) {
    return;
  }

  clauses.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(bookingId);

  await dbRun(`UPDATE bookings SET ${clauses.join(", ")} WHERE id = ?`, params);
}

async function findBookingByCheckoutSession(sessionId) {
  if (!sessionId) {
    return null;
  }
  return dbGet(
    "SELECT id, payment_status AS paymentStatus FROM bookings WHERE checkout_session_id = ? LIMIT 1",
    [sessionId],
  );
}

async function findBookingById(bookingId) {
  if (!bookingId) {
    return null;
  }
  return dbGet(
    "SELECT id, payment_status AS paymentStatus, source FROM bookings WHERE id = ? LIMIT 1",
    [bookingId],
  );
}

function stripeCheckoutStatusToBookingStatus(session) {
  const paymentStatus = String(session?.payment_status || "").toLowerCase();
  const sessionStatus = String(session?.status || "").toLowerCase();

  if (paymentStatus === "paid") {
    return "paid";
  }
  if (sessionStatus === "expired") {
    return "expired";
  }
  if (paymentStatus === "unpaid") {
    return "pending";
  }
  return "pending";
}

async function reconcileStripeCheckoutSessions({
  hours = 48,
  limit = 100,
} = {}) {
  if (!stripe) {
    throw new Error("Stripe is not configured for this environment.");
  }

  const safeHours = Math.max(1, Math.min(Number(hours) || 48, 24 * 30));
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 100));
  const sinceEpoch = Math.floor(Date.now() / 1000) - safeHours * 60 * 60;

  const sessionsResult = await stripe.checkout.sessions.list({
    limit: safeLimit,
    created: { gte: sinceEpoch },
  });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const session of sessionsResult.data || []) {
    const checkoutSessionId = session.id;
    if (!checkoutSessionId) {
      skipped += 1;
      continue;
    }

    const mappedStatus = stripeCheckoutStatusToBookingStatus(session);
    const existing = await findBookingByCheckoutSession(checkoutSessionId);

    if (existing) {
      if (existing.paymentStatus !== mappedStatus) {
        await updateBookingById(existing.id, { status: mappedStatus });
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const md = session.metadata || {};
    const customerName =
      md.name || session.customer_details?.name || "Stripe Customer";
    const customerEmail =
      md.email ||
      session.customer_details?.email ||
      session.customer_email ||
      "";

    await insertBooking({
      userId: md.memberUserId || null,
      name: customerName,
      email: customerEmail,
      phone: md.phone || "",
      facility: md.facility || "unknown",
      date: md.date || "",
      time: md.time || "",
      duration: md.duration || "",
      court: md.court || "",
      membershipType: md.membershipType || "",
      appliedMembership: md.appliedMembership || "none",
      amount: Number(session.amount_total || 0),
      currency: String(session.currency || "aud").toLowerCase(),
      paymentStatus: mappedStatus,
      checkoutSessionId,
      source: "reconcile",
    });
    inserted += 1;
  }

  return {
    scanned: (sessionsResult.data || []).length,
    inserted,
    updated,
    skipped,
    hours: safeHours,
    limit: safeLimit,
  };
}

async function listBookings(filters = {}) {
  const where = [];
  const params = [];

  if (filters.userId && String(filters.userId).trim() !== "") {
    where.push("b.user_id = ?");
    params.push(filters.userId);
  }

  if (filters.status && String(filters.status).trim() !== "") {
    where.push("b.payment_status = ?");
    params.push(filters.status);
  }

  if (filters.date && String(filters.date).trim() !== "") {
    where.push("b.booking_date = ?");
    params.push(filters.date);
  }

  if (filters.email && String(filters.email).trim() !== "") {
    where.push("LOWER(b.customer_email) LIKE ?");
    params.push(`%${String(filters.email).toLowerCase()}%`);
  }

  let limit = Number(filters.limit);
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    limit = 100;
  }
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const sql = `SELECT
    b.id,
    b.user_id AS userId,
    b.customer_name AS customerName,
    b.customer_email AS customerEmail,
    b.customer_phone AS customerPhone,
    b.facility,
    b.booking_date AS bookingDate,
    b.booking_time AS bookingTime,
    b.duration,
    b.court,
    b.membership_type AS membershipType,
    b.applied_membership AS appliedMembership,
    b.amount,
    b.currency,
    b.payment_status AS paymentStatus,
    b.checkout_session_id AS checkoutSessionId,
    b.payment_intent_id AS paymentIntentId,
    b.source,
    b.created_at AS createdAt,
    u.name AS accountName,
    u.email AS accountEmail
  FROM bookings b
  LEFT JOIN users u ON u.id = b.user_id
  ${whereClause}
  ORDER BY b.created_at DESC
  LIMIT ${Number(limit) || 200}`;
  console.log("[listBookings] SQL:", sql);
  console.log("[listBookings] Params:", params);
  try {
    return await dbAll(sql, params);
  } catch (err) {
    const message = String(err?.message || "").toLowerCase();
    const isSchemaMismatch =
      message.includes("unknown column") ||
      message.includes("no such column") ||
      message.includes("doesn't exist");

    if (!isSchemaMismatch) {
      throw err;
    }

    try {
      const fallbackSql = `SELECT
        b.id,
        b.customer_name AS customerName,
        b.customer_email AS customerEmail,
        b.facility,
        b.booking_date AS bookingDate,
        b.booking_time AS bookingTime,
        b.court,
        b.amount,
        b.currency,
        b.payment_status AS paymentStatus,
        b.created_at AS createdAt
      FROM bookings b
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT ${Number(limit) || 200}`;
      const fallbackRows = await dbAll(fallbackSql, params);

      return fallbackRows.map((row) => ({
        id: row.id,
        userId: null,
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        customerPhone: "",
        facility: row.facility,
        bookingDate: row.bookingDate,
        bookingTime: row.bookingTime,
        duration: "",
        court: row.court,
        membershipType: "",
        appliedMembership: "none",
        amount: row.amount,
        currency: row.currency,
        paymentStatus: row.paymentStatus,
        checkoutSessionId: "",
        paymentIntentId: "",
        source: "",
        createdAt: row.createdAt,
        accountName: "",
        accountEmail: "",
      }));
    } catch {
      // Last-resort compatibility for older booking schemas.
      const genericSql = `SELECT * FROM bookings LIMIT ${Number(limit) || 200}`;
      const genericRows = await dbAll(genericSql);
      return genericRows.map((row) => ({
        id: row.id || row.booking_id || "",
        userId: row.user_id || row.userId || null,
        customerName: row.customer_name || row.customerName || "",
        customerEmail: row.customer_email || row.customerEmail || "",
        customerPhone: row.customer_phone || row.customerPhone || "",
        facility: row.facility || row.resource || "",
        bookingDate: row.booking_date || row.bookingDate || row.date || "",
        bookingTime: row.booking_time || row.bookingTime || row.time || "",
        duration: row.duration || "",
        court: row.court || row.court_no || row.courtNo || "",
        membershipType: row.membership_type || row.membershipType || "",
        appliedMembership:
          row.applied_membership || row.appliedMembership || "none",
        amount: Number(row.amount || 0),
        currency: row.currency || "aud",
        paymentStatus:
          row.payment_status || row.paymentStatus || row.status || "pending",
        checkoutSessionId:
          row.checkout_session_id || row.checkoutSessionId || "",
        paymentIntentId: row.payment_intent_id || row.paymentIntentId || "",
        source: row.source || "",
        createdAt:
          row.created_at || row.createdAt || row.booking_date || row.date || "",
        accountName: "",
        accountEmail: "",
      }));
    }
  }
}

async function getSiteContent() {
  const siteContentKeyColumn = isMysqlProvider() ? "`key`" : "key";
  const row = await dbGet(
    `SELECT content_json AS contentJson FROM site_content WHERE ${siteContentKeyColumn} = ? LIMIT 1`,
    ["homepage"],
  );

  if (!row?.contentJson) {
    return { ...SITE_CONTENT_DEFAULTS };
  }

  try {
    const parsed = JSON.parse(row.contentJson);
    if (!parsed || typeof parsed !== "object") {
      return { ...SITE_CONTENT_DEFAULTS };
    }
    return { ...SITE_CONTENT_DEFAULTS, ...parsed };
  } catch {
    return { ...SITE_CONTENT_DEFAULTS };
  }
}

function sanitizeSiteContentInput(raw = {}) {
  const safe = {};
  for (const key of Object.keys(SITE_CONTENT_DEFAULTS)) {
    const value = raw[key];
    safe[key] =
      typeof value === "string" ? value.trim() : SITE_CONTENT_DEFAULTS[key];
  }
  return safe;
}

async function saveSiteContent(content) {
  const payload = sanitizeSiteContentInput(content);
  const nowIso = new Date().toISOString();

  if (isMysqlProvider()) {
    await dbRun(
      `INSERT INTO site_content (\`key\`, content_json, updated_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         content_json = VALUES(content_json),
         updated_at = VALUES(updated_at)`,
      ["homepage", JSON.stringify(payload), nowIso],
    );
    return payload;
  }

  await dbRun(
    `INSERT INTO site_content (key, content_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       content_json = excluded.content_json,
       updated_at = excluded.updated_at`,
    ["homepage", JSON.stringify(payload), nowIso],
  );
  return payload;
}

async function cleanupExpiredSessions() {
  await dbRun("DELETE FROM sessions WHERE expires_at <= ?", [Date.now()]);
}

async function cleanupExpiredPasswordResets() {
  await dbRun("DELETE FROM password_resets WHERE expires_at <= ?", [
    Date.now(),
  ]);
}

function hashResetToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
}

function buildPasswordResetLink(token) {
  const fallback = new URL(APP_ORIGIN);
  let baseUrl = null;

  try {
    const hasScheme = PASSWORD_RESET_BASE_URL.includes("://");
    baseUrl = new URL(
      hasScheme
        ? PASSWORD_RESET_BASE_URL
        : `https://${PASSWORD_RESET_BASE_URL}`,
    );
  } catch {
    baseUrl = fallback;
  }

  if (!baseUrl.pathname || baseUrl.pathname === "/") {
    baseUrl.pathname = "/booking.html";
  }

  baseUrl.searchParams.set("auth", "reset");
  baseUrl.searchParams.set("reset_token", token);
  return baseUrl.toString();
}

async function createPasswordResetToken(userId) {
  const now = Date.now();
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(token);

  await dbRun(
    "DELETE FROM password_resets WHERE user_id = ? OR expires_at <= ? OR used_at IS NOT NULL",
    [userId, now],
  );

  await dbRun(
    "INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    [crypto.randomUUID(), userId, tokenHash, now + PASSWORD_RESET_TTL_MS, now],
  );

  return token;
}

async function findActivePasswordResetByToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) {
    return null;
  }

  const tokenHash = hashResetToken(token);
  const row = await dbGet(
    "SELECT id, user_id AS userId, expires_at AS expiresAt, used_at AS usedAt FROM password_resets WHERE token_hash = ? LIMIT 1",
    [tokenHash],
  );

  if (!row || row.usedAt) {
    return null;
  }

  if (Number(row.expiresAt || 0) <= Date.now()) {
    await dbRun("DELETE FROM password_resets WHERE id = ?", [row.id]);
    return null;
  }

  return row;
}

async function readUsers() {
  return dbAll(
    "SELECT id, name, email, membership_type AS membershipType, is_admin AS isAdmin, password_hash AS passwordHash, created_at AS createdAt FROM users ORDER BY created_at ASC",
  );
}

async function findUserByEmail(email) {
  return dbGet(
    "SELECT id, name, email, membership_type AS membershipType, is_admin AS isAdmin, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE email = ? LIMIT 1",
    [email],
  );
}

async function findUserById(id) {
  return dbGet(
    "SELECT id, name, email, membership_type AS membershipType, is_admin AS isAdmin, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE id = ? LIMIT 1",
    [id],
  );
}

async function insertUser(user) {
  await dbRun(
    "INSERT INTO users (id, name, email, membership_type, is_admin, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      user.id,
      user.name,
      user.email,
      user.membershipType || "",
      toDbBoolean(user.isAdmin),
      user.passwordHash,
      user.createdAt,
    ],
  );
}

async function initSqliteDatabase() {
  if (!sqlite3) {
    try {
      sqlite3 = require("sqlite3").verbose();
    } catch (err) {
      throw new Error(
        "SQLite driver is unavailable. Install sqlite3 or switch DB_PROVIDER to postgres/mysql.",
      );
    }
  }

  await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
  db = await new Promise((resolve, reject) => {
    const instance = new sqlite3.Database(DB_FILE, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(instance);
    });
  });

  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      membership_type TEXT NOT NULL DEFAULT '',
      is_admin INTEGER NOT NULL DEFAULT 0,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  try {
    await dbRun(
      "ALTER TABLE users ADD COLUMN membership_type TEXT NOT NULL DEFAULT ''",
    );
  } catch (err) {
    if (!String(err.message).includes("duplicate column name")) {
      throw err;
    }
  }

  try {
    await dbRun(
      "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
    );
  } catch (err) {
    if (!String(err.message).includes("duplicate column name")) {
      throw err;
    }
  }

  await dbRun(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at)",
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id)",
  );

  await dbRun(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets (user_id)",
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_password_resets_expires_at ON password_resets (expires_at)",
  );

  await dbRun(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT NOT NULL DEFAULT '',
      facility TEXT NOT NULL,
      booking_date TEXT NOT NULL,
      booking_time TEXT NOT NULL,
      duration TEXT NOT NULL DEFAULT '',
      court TEXT NOT NULL DEFAULT '',
      membership_type TEXT NOT NULL DEFAULT '',
      applied_membership TEXT NOT NULL DEFAULT 'none',
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'aud',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      checkout_session_id TEXT UNIQUE,
      payment_intent_id TEXT UNIQUE,
      source TEXT NOT NULL DEFAULT 'checkout',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings (created_at)",
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings (user_id)",
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_bookings_booking_date ON bookings (booking_date)",
  );

  await dbRun(`
    CREATE TABLE IF NOT EXISTS site_content (
      key TEXT PRIMARY KEY,
      content_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  const existingSiteContent = await dbGet(
    "SELECT key FROM site_content WHERE key = ? LIMIT 1",
    ["homepage"],
  );
  if (!existingSiteContent) {
    await dbRun(
      "INSERT INTO site_content (key, content_json, updated_at) VALUES (?, ?, ?)",
      [
        "homepage",
        JSON.stringify(SITE_CONTENT_DEFAULTS),
        new Date().toISOString(),
      ],
    );
  }

  await cleanupExpiredSessions();
  await cleanupExpiredPasswordResets();
}

async function initPostgresDatabase() {
  const pgConfig = {};
  if (process.env.DATABASE_URL) {
    pgConfig.connectionString = process.env.DATABASE_URL;
  }
  pgPool = new Pool(pgConfig);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      membership_type TEXT NOT NULL DEFAULT '',
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at)",
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id)",
  );

  await dbRun(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at BIGINT NOT NULL,
      used_at BIGINT,
      created_at BIGINT NOT NULL
    )
  `);
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets (user_id)",
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_password_resets_expires_at ON password_resets (expires_at)",
  );

  await dbRun(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT NOT NULL DEFAULT '',
      facility TEXT NOT NULL,
      booking_date TEXT NOT NULL,
      booking_time TEXT NOT NULL,
      duration TEXT NOT NULL DEFAULT '',
      court TEXT NOT NULL DEFAULT '',
      membership_type TEXT NOT NULL DEFAULT '',
      applied_membership TEXT NOT NULL DEFAULT 'none',
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'aud',
      payment_status TEXT NOT NULL DEFAULT 'pending',
      checkout_session_id TEXT UNIQUE,
      payment_intent_id TEXT UNIQUE,
      source TEXT NOT NULL DEFAULT 'checkout',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings (created_at)",
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings (user_id)",
  );
  await dbRun(
    "CREATE INDEX IF NOT EXISTS idx_bookings_booking_date ON bookings (booking_date)",
  );

  await dbRun(`
    CREATE TABLE IF NOT EXISTS site_content (
      key TEXT PRIMARY KEY,
      content_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  const existingSiteContent = await dbGet(
    "SELECT key FROM site_content WHERE key = ? LIMIT 1",
    ["homepage"],
  );
  if (!existingSiteContent) {
    await dbRun(
      "INSERT INTO site_content (key, content_json, updated_at) VALUES (?, ?, ?)",
      [
        "homepage",
        JSON.stringify(SITE_CONTENT_DEFAULTS),
        new Date().toISOString(),
      ],
    );
  }

  await cleanupExpiredSessions();
  await cleanupExpiredPasswordResets();
}

async function initMysqlDatabase() {
  if (!mysql) {
    try {
      mysql = require("mysql2/promise");
    } catch (err) {
      throw new Error(
        "MySQL driver is unavailable. Install mysql2 or switch DB_PROVIDER to sqlite/postgres.",
      );
    }
  }

  if (process.env.DATABASE_URL) {
    mysqlPool = mysql.createPool(process.env.DATABASE_URL);
  } else {
    mysqlPool = mysql.createPool({
      host: process.env.MYSQL_HOST || process.env.MYSQLHOST || "127.0.0.1",
      port: Number(process.env.MYSQL_PORT || process.env.MYSQLPORT || 3306),
      user: process.env.MYSQL_USER || process.env.MYSQLUSER || "root",
      password: process.env.MYSQL_PASSWORD || process.env.MYSQLPASSWORD || "",
      database:
        process.env.MYSQL_DATABASE || process.env.MYSQLDATABASE || "smashforce",
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
      queueLimit: 0,
    });
  }

  await mysqlPool.query("SELECT 1");

  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(191) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      membership_type VARCHAR(32) NOT NULL DEFAULT '',
      is_admin TINYINT(1) NOT NULL DEFAULT 0,
      password_hash TEXT NOT NULL,
      created_at VARCHAR(64) NOT NULL
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(191) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_sessions_expires_at (expires_at),
      INDEX idx_sessions_user_id (user_id),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id VARCHAR(191) PRIMARY KEY,
      user_id VARCHAR(191) NOT NULL,
      token_hash VARCHAR(64) NOT NULL UNIQUE,
      expires_at BIGINT NOT NULL,
      used_at BIGINT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_password_resets_user_id (user_id),
      INDEX idx_password_resets_expires_at (expires_at),
      CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS bookings (
      id VARCHAR(191) PRIMARY KEY,
      user_id VARCHAR(191) NULL,
      customer_name VARCHAR(255) NOT NULL,
      customer_email VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(64) NOT NULL DEFAULT '',
      facility VARCHAR(64) NOT NULL,
      booking_date VARCHAR(32) NOT NULL,
      booking_time VARCHAR(32) NOT NULL,
      duration VARCHAR(64) NOT NULL DEFAULT '',
      court VARCHAR(64) NOT NULL DEFAULT '',
      membership_type VARCHAR(32) NOT NULL DEFAULT '',
      applied_membership VARCHAR(32) NOT NULL DEFAULT 'none',
      amount INT NOT NULL,
      currency VARCHAR(16) NOT NULL DEFAULT 'aud',
      payment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      checkout_session_id VARCHAR(191) UNIQUE NULL,
      payment_intent_id VARCHAR(191) UNIQUE NULL,
      source VARCHAR(32) NOT NULL DEFAULT 'checkout',
      created_at VARCHAR(64) NOT NULL,
      updated_at VARCHAR(64) NOT NULL,
      INDEX idx_bookings_created_at (created_at),
      INDEX idx_bookings_user_id (user_id),
      INDEX idx_bookings_booking_date (booking_date),
      CONSTRAINT fk_bookings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS site_content (
      \`key\` VARCHAR(191) PRIMARY KEY,
      content_json LONGTEXT NOT NULL,
      updated_at VARCHAR(64) NOT NULL
    )
  `);

  const existingSiteContent = await dbGet(
    "SELECT `key` AS keyName FROM site_content WHERE `key` = ? LIMIT 1",
    ["homepage"],
  );
  if (!existingSiteContent?.keyName) {
    await dbRun(
      "INSERT INTO site_content (`key`, content_json, updated_at) VALUES (?, ?, ?)",
      [
        "homepage",
        JSON.stringify(SITE_CONTENT_DEFAULTS),
        new Date().toISOString(),
      ],
    );
  }

  await cleanupExpiredSessions();
  await cleanupExpiredPasswordResets();
}

async function initDatabase() {
  if (isPostgresProvider()) {
    await initPostgresDatabase();
    return;
  }

  if (isMysqlProvider()) {
    await initMysqlDatabase();
    return;
  }

  if (DB_PROVIDER !== "sqlite") {
    throw new Error(
      `Unsupported DB_PROVIDER '${DB_PROVIDER}'. Use 'sqlite', 'postgres', or 'mysql'.`,
    );
  }

  await initSqliteDatabase();
}

async function maybeMigrateLegacyUsers() {
  try {
    const countRow = await dbGet("SELECT COUNT(*) AS count FROM users");
    if ((countRow?.count || 0) > 0) {
      return;
    }

    await ensureUsersFile();
    const raw = await fs.readFile(USERS_FILE, "utf8");
    const users = JSON.parse(raw);
    if (!Array.isArray(users) || users.length === 0) {
      return;
    }

    for (const user of users) {
      if (!user?.id || !user?.email || !user?.passwordHash || !user?.name) {
        continue;
      }
      if (isPostgresProvider()) {
        await dbRun(
          "INSERT INTO users (id, name, email, membership_type, is_admin, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
          [
            String(user.id),
            String(user.name),
            String(user.email).toLowerCase(),
            String(user.membershipType || ""),
            toDbBoolean(user.isAdmin),
            String(user.passwordHash),
            String(user.createdAt || new Date().toISOString()),
          ],
        );
      } else if (isMysqlProvider()) {
        await dbRun(
          "INSERT IGNORE INTO users (id, name, email, membership_type, is_admin, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            String(user.id),
            String(user.name),
            String(user.email).toLowerCase(),
            String(user.membershipType || ""),
            toDbBoolean(user.isAdmin),
            String(user.passwordHash),
            String(user.createdAt || new Date().toISOString()),
          ],
        );
      } else {
        await dbRun(
          "INSERT OR IGNORE INTO users (id, name, email, membership_type, is_admin, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            String(user.id),
            String(user.name),
            String(user.email).toLowerCase(),
            String(user.membershipType || ""),
            toDbBoolean(user.isAdmin),
            String(user.passwordHash),
            String(user.createdAt || new Date().toISOString()),
          ],
        );
      }
    }
  } catch (err) {
    console.error("Legacy user migration skipped:", err.message);
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedValue = "") {
  const [salt, hash] = storedValue.split(":");
  if (!salt || !hash) {
    return false;
  }
  const derivedHash = crypto.scryptSync(password, salt, 64).toString("hex");

  const hashBuffer = Buffer.from(hash, "hex");
  const derivedBuffer = Buffer.from(derivedHash, "hex");
  if (hashBuffer.length !== derivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(hashBuffer, derivedBuffer);
}

function buildSessionCookie(token) {
  let baseCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${SESSION_COOKIE_SAMESITE}; Max-Age=${SESSION_TTL_MS / 1000}`;
  if (SESSION_COOKIE_DOMAIN) {
    baseCookie += `; Domain=${SESSION_COOKIE_DOMAIN}`;
  }
  const requiresSecure = IS_PRODUCTION || SESSION_COOKIE_SAMESITE === "None";
  return requiresSecure ? `${baseCookie}; Secure` : baseCookie;
}

function buildClearedSessionCookie() {
  let baseCookie = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=${SESSION_COOKIE_SAMESITE}; Max-Age=0`;
  if (SESSION_COOKIE_DOMAIN) {
    baseCookie += `; Domain=${SESSION_COOKIE_DOMAIN}`;
  }
  const requiresSecure = IS_PRODUCTION || SESSION_COOKIE_SAMESITE === "None";
  return requiresSecure ? `${baseCookie}; Secure` : baseCookie;
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await dbRun(
    "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    [token, userId, Date.now() + SESSION_TTL_MS, Date.now()],
  );
  return token;
}

function getSessionToken(req) {
  const cookies = parseCookies(req);
  return cookies[SESSION_COOKIE_NAME] || "";
}

async function getActiveSession(token) {
  const session = await dbGet(
    "SELECT token, user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token = ? LIMIT 1",
    [token],
  );
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    await dbRun("DELETE FROM sessions WHERE token = ?", [token]);
    return null;
  }

  return session;
}

async function getRequestUser(req, res) {
  const token = getSessionToken(req);
  if (!token) {
    return null;
  }

  const session = await getActiveSession(token);
  if (!session) {
    if (res) {
      res.setHeader("Set-Cookie", buildClearedSessionCookie());
    }
    return null;
  }

  const user = await findUserById(session.userId);
  if (!user) {
    await dbRun("DELETE FROM sessions WHERE token = ?", [token]);
    if (res) {
      res.setHeader("Set-Cookie", buildClearedSessionCookie());
    }
    return null;
  }

  return user;
}

async function requireAuth(req, res, next) {
  try {
    const user = await getRequestUser(req, res);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated." });
    }
    req.user = user;
    return next();
  } catch (err) {
    console.error("Auth guard error:", err.message);
    return res.status(500).json({
      error:
        "Authentication verification failed: Unable to check session validity. Please try logging in again.",
    });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const user = await getRequestUser(req, res);
    if (!user) {
      return res.status(401).json({ error: "Not authenticated." });
    }
    if (!user.isAdmin) {
      return res.status(403).json({ error: "Admin access required." });
    }
    req.user = user;
    return next();
  } catch (err) {
    console.error("Admin guard error:", err.message);
    return res.status(500).json({
      error:
        "Admin authentication verification failed: Unable to validate admin privileges. Please check your session.",
    });
  }
}

function normalizeMembershipType(rawValue = "") {
  const membershipType = String(rawValue).trim().toLowerCase();
  if (!membershipType) {
    return "";
  }
  if (membershipType === "court" || membershipType === "all-access") {
    return membershipType;
  }
  return null;
}

app.post("/signup", signupRateLimit, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");
    const membershipType = normalizeMembershipType(req.body?.membershipType);

    if (!name) {
      return res.status(400).json({ error: "Name is required." });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Valid email is required." });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters long." });
    }

    if (membershipType === null) {
      return res.status(400).json({ error: "Invalid membership type." });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({ error: "Email is already registered." });
    }

    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      membershipType: membershipType || "",
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };

    await insertUser(user);

    const token = await createSession(user.id);
    res.setHeader("Set-Cookie", buildSessionCookie(token));
    return res.status(201).json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error("Signup error:", err.message);
    return res.status(500).json({
      error:
        "Account creation failed: Unable to process your registration at this time. Please try again or contact support if this persists.",
    });
  }
});

app.post("/login", loginRateLimit, async (req, res) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Valid email is required." });
    }

    if (!password) {
      return res.status(400).json({ error: "Password is required." });
    }

    const user = await findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = await createSession(user.id);
    res.setHeader("Set-Cookie", buildSessionCookie(token));
    return res.json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error("Login error:", err.message);
    return res.status(500).json({
      error:
        "Login failed: Unable to process your login request. Please verify your credentials and try again.",
    });
  }
});

app.post("/forgot-password", forgotPasswordRateLimit, async (req, res) => {
  const genericMessage =
    "If that email exists, a password reset link has been generated.";

  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Valid email is required." });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.json({ ok: true, message: genericMessage });
    }

    const resetToken = await createPasswordResetToken(user.id);
    const resetLink = buildPasswordResetLink(resetToken);
    const sent = await sendPasswordResetEmail({
      toEmail: user.email,
      toName: user.name,
      resetLink,
    });

    if (!sent) {
      console.warn(
        `Password reset email was not sent for ${email}. Check SMTP settings.`,
      );
      console.info(`Password reset link for ${email}: ${resetLink}`);
    }

    const payload = { ok: true, message: genericMessage };
    if (PASSWORD_RESET_DEV_EXPOSE_TOKEN) {
      payload.devResetLink = resetLink;
      payload.devResetToken = resetToken;
    }

    return res.json(payload);
  } catch (err) {
    console.error("Forgot password error:", err.message);
    return res.status(500).json({
      error:
        "Password reset request failed: Unable to generate a reset link right now. Please try again.",
    });
  }
});

app.post("/reset-password", resetPasswordRateLimit, async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");

    if (!token) {
      return res.status(400).json({ error: "Reset token is required." });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters long." });
    }

    const resetRow = await findActivePasswordResetByToken(token);
    if (!resetRow) {
      return res
        .status(400)
        .json({ error: "Reset token is invalid or has expired." });
    }

    await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [
      hashPassword(password),
      resetRow.userId,
    ]);

    await dbRun("UPDATE password_resets SET used_at = ? WHERE id = ?", [
      Date.now(),
      resetRow.id,
    ]);
    await dbRun("DELETE FROM password_resets WHERE user_id = ?", [
      resetRow.userId,
    ]);
    await dbRun("DELETE FROM sessions WHERE user_id = ?", [resetRow.userId]);

    res.setHeader("Set-Cookie", buildClearedSessionCookie());
    return res.json({ ok: true, message: "Password updated successfully." });
  } catch (err) {
    console.error("Reset password error:", err.message);
    return res.status(500).json({
      error:
        "Password reset failed: Unable to update your password right now. Please try again.",
    });
  }
});

app.post("/contact-message", contactMessageRateLimit, async (req, res) => {
  try {
    const firstName = String(req.body?.firstName || "").trim();
    const lastName = String(req.body?.lastName || "").trim();
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const phone = String(req.body?.phone || "").trim();
    const topic =
      String(req.body?.topic || "General Enquiry").trim() || "General Enquiry";
    const message = String(req.body?.message || "").trim();

    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    if (message.length > 5000) {
      return res.status(400).json({
        error: "Message is too long. Please keep it under 5000 characters.",
      });
    }

    if (email && !isValidEmail(email)) {
      return res
        .status(400)
        .json({ error: "Please enter a valid email address." });
    }

    if (!CONTACT_FORM_TO) {
      console.warn(
        "CONTACT_FORM_TO is empty. Contact form email was not sent.",
      );
      return res.status(503).json({
        error:
          "Contact email destination is not configured yet. Please try again later.",
      });
    }

    const sent = await sendContactFormEmail({
      name: `${firstName} ${lastName}`.trim() || "Website Visitor",
      email,
      phone,
      topic,
      message,
    });

    if (!sent) {
      return res.status(503).json({
        error:
          "Unable to send your message right now. Please try again shortly.",
      });
    }

    return res.json({ ok: true, message: "Message sent successfully." });
  } catch (err) {
    console.error("Contact message error:", err.message);
    return res.status(500).json({
      error: "Unable to send your message right now. Please try again shortly.",
    });
  }
});

app.post("/logout", requireSameOrigin, async (req, res) => {
  const token = getSessionToken(req);
  if (token) {
    await dbRun("DELETE FROM sessions WHERE token = ?", [token]);
  }
  res.setHeader("Set-Cookie", buildClearedSessionCookie());
  return res.json({ ok: true });
});

app.get("/me", requireAuth, async (req, res) => {
  try {
    return res.json({ user: sanitizeUser(req.user) });
  } catch (err) {
    console.error("Me endpoint error:", err.message);
    return res.status(500).json({
      error:
        "Profile retrieval failed: Unable to fetch your user information. Please try refreshing or logging in again.",
    });
  }
});

app.get("/member-profile", requireAuth, (req, res) => {
  return res.json({ user: sanitizeUser(req.user) });
});

app.get("/content", async (_req, res) => {
  try {
    const content = await getSiteContent();
    return res.json({ content });
  } catch (err) {
    console.error("Content fetch error:", err.message);
    return res.status(500).json({
      error:
        "Content loading failed: Unable to retrieve site information. Please refresh the page and try again.",
    });
  }
});

app.get("/my-bookings", requireAuth, async (req, res) => {
  try {
    const bookings = await listBookings({ userId: req.user.id, limit: 100 });
    return res.json({ bookings });
  } catch (err) {
    console.error("My bookings error:", err.message);
    return res.status(500).json({
      error:
        "Bookings retrieval failed: Unable to fetch your booking history. Please try again later.",
    });
  }
});

app.get("/admin/bookings", requireAdmin, async (req, res) => {
  try {
    const bookings = await listBookings({
      status: String(req.query.status || "")
        .trim()
        .toLowerCase(),
      date: String(req.query.date || "").trim(),
      email: String(req.query.email || "").trim(),
      limit: req.query.limit,
    });
    return res.json({ bookings });
  } catch (err) {
    console.error("Admin bookings error:", err.message);
    return res.status(500).json({
      error:
        "Admin bookings retrieval failed: Unable to fetch booking data. Please check your filters and try again.",
    });
  }
});

// Admin: Check membership status by email
app.get("/admin/check-membership", requireAdmin, async (req, res) => {
  try {
    const email = String(req.query.email || "")
      .trim()
      .toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    return res.json({
      name: user.name,
      email: user.email,
      membershipType: user.membershipType || "none",
      isAdmin: !!user.isAdmin,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error("Check membership error:", err.message);
    return res
      .status(500)
      .json({ error: "Unable to check membership status." });
  }
});

app.post(
  "/admin/bookings/:bookingId/mark-paid",
  requireSameOrigin,
  requireAdmin,
  async (req, res) => {
    try {
      const bookingId = String(req.params.bookingId || "").trim();
      if (!bookingId) {
        return res.status(400).json({ error: "bookingId is required." });
      }

      const booking = await findBookingById(bookingId);
      if (!booking) {
        return res.status(404).json({ error: "Booking not found." });
      }

      const status = String(booking.paymentStatus || "").toLowerCase();
      if (status === "paid") {
        return res.json({
          ok: true,
          message: "Booking is already marked paid.",
        });
      }

      if (status !== "pending_in_person") {
        return res.status(400).json({
          error:
            "Only pending in-person bookings can be marked paid with this action.",
        });
      }

      await updateBookingById(bookingId, { status: "paid" });
      return res.json({ ok: true, message: "Booking marked as paid." });
    } catch (err) {
      console.error("Mark paid error:", err.message);
      return res.status(500).json({
        error:
          "Mark paid failed: Unable to update booking payment status. Please try again.",
      });
    }
  },
);

app.get("/admin/content", requireAdmin, async (_req, res) => {
  try {
    const content = await getSiteContent();
    return res.json({ content });
  } catch (err) {
    console.error("Admin content fetch error:", err.message);
    return res.status(500).json({
      error:
        "Admin content loading failed: Unable to retrieve site content for editing. Please try again.",
    });
  }
});

app.put("/admin/content", requireSameOrigin, requireAdmin, async (req, res) => {
  try {
    const content = await saveSiteContent(req.body || {});
    return res.json({ ok: true, content });
  } catch (err) {
    console.error("Admin content save error:", err.message);
    return res.status(500).json({
      error:
        "Content save failed: Unable to update site content. Your changes were not saved. Please try again.",
    });
  }
});

app.post(
  "/admin/reconcile-bookings",
  requireSameOrigin,
  requireAdmin,
  createRateLimiter({
    keyPrefix: "reconcile-bookings",
    maxRequests: 8,
    windowMs: 10 * 60 * 1000,
  }),
  async (req, res) => {
    try {
      const summary = await reconcileStripeCheckoutSessions({
        hours: req.body?.hours,
        limit: req.body?.limit,
      });
      return res.json({ ok: true, summary });
    } catch (err) {
      console.error("Reconcile bookings error:", err.message);
      return res.status(500).json({
        error:
          "Booking reconciliation failed: Unable to sync bookings with Stripe. Please check the logs and try again.",
      });
    }
  },
);

// Grant admin to a user by email — requires ADMIN_SECRET env var as Bearer token
app.post(
  "/admin/make-admin",
  createRateLimiter({
    keyPrefix: "make-admin",
    maxRequests: 10,
    windowMs: 10 * 60 * 1000,
  }),
  async (req, res) => {
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      return res.status(503).json({ error: "ADMIN_SECRET not configured." });
    }
    const authHeader = req.headers.authorization || "";
    if (authHeader !== `Bearer ${adminSecret}`) {
      return res.status(403).json({ error: "Invalid admin secret." });
    }
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "email is required." });
    }
    const user = await findUserByEmail(String(email).toLowerCase().trim());
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    await dbRun("UPDATE users SET is_admin = ? WHERE id = ?", [
      toDbBoolean(true),
      user.id,
    ]);
    return res.json({ ok: true, message: `${email} is now an admin.` });
  },
);

// Force-sync CMS content to the values defined in SITE_CONTENT_DEFAULTS.
// Useful when table data is stale and overriding correct homepage copy.
app.post(
  "/admin/sync-site-content",
  createRateLimiter({
    keyPrefix: "sync-site-content",
    maxRequests: 10,
    windowMs: 10 * 60 * 1000,
  }),
  async (req, res) => {
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      return res.status(503).json({ error: "ADMIN_SECRET not configured." });
    }

    const authHeader = req.headers.authorization || "";
    if (authHeader !== `Bearer ${adminSecret}`) {
      return res.status(403).json({ error: "Invalid admin secret." });
    }

    try {
      const content = await saveSiteContent(SITE_CONTENT_DEFAULTS);
      return res.json({ ok: true, content });
    } catch (err) {
      console.error("Sync site content error:", err.message);
      return res.status(500).json({
        error: "Site content sync failed: Unable to update site_content table.",
      });
    }
  },
);

function normalizeBookingPayload(body = {}, user = null) {
  const facility = String(body.facility || "")
    .trim()
    .toLowerCase();
  const price = FACILITY_PRICES[facility];
  const requestedMembershipType = normalizeMembershipType(body.membershipType);
  const storedMembershipType = normalizeMembershipType(user?.membershipType);
  const wantsMemberPricing =
    Boolean(body.isMember) ||
    Boolean(requestedMembershipType && requestedMembershipType.length);

  if (!price) {
    return { error: "Invalid facility selected." };
  }

  if (requestedMembershipType === null) {
    return { error: "Invalid membership type." };
  }

  if (wantsMemberPricing && !user) {
    return { error: "Login required for membership pricing." };
  }

  let amount = price.amount;
  let appliedMembership = "none";
  if (wantsMemberPricing) {
    if (!storedMembershipType) {
      return { error: "Your account does not have an active membership tier." };
    }

    if (
      requestedMembershipType &&
      requestedMembershipType !== storedMembershipType
    ) {
      return {
        error: "Requested membership tier does not match your account.",
      };
    }

    if (storedMembershipType === "all-access") {
      amount = price.allAccessAmount || price.memberAmount || price.amount;
      appliedMembership = "all-access";
    } else {
      amount = price.memberAmount || price.amount;
      appliedMembership = "court";
    }
  }

  const promo = resolvePromo(body.promoCode);
  if (String(body.promoCode || "").trim() && !promo) {
    return { error: "Invalid promo code." };
  }

  const promoPricing = applyPromoDiscount(amount, promo);
  if (promoPricing.promoError) {
    return { error: promoPricing.promoError };
  }

  return {
    facility,
    date: String(body.date || "").trim(),
    time: String(body.time || "").trim(),
    duration: String(body.duration || "").trim(),
    court: String(body.court || "").trim(),
    name: String(body.name || "").trim(),
    email: String(body.email || "").trim(),
    phone: String(body.phone || "").trim(),
    amount: promoPricing.amountAfterDiscount,
    amountBeforeDiscount: promoPricing.amountBeforeDiscount,
    discountAmount: promoPricing.discountAmount,
    promoCode: promoPricing.appliedPromoCode,
    membershipType: storedMembershipType || "",
    appliedMembership,
    memberUserId: user?.id || "",
    label: price.label,
  };
}

app.post(
  "/validate-promo",
  requireSameOrigin,
  bookingRateLimit,
  async (req, res) => {
    try {
      const user = await getRequestUser(req, res);
      const payload = normalizeBookingPayload(req.body, user);
      if (payload.error) {
        return res.status(400).json({ error: payload.error });
      }

      return res.json({
        ok: true,
        promoCode: payload.promoCode || "",
        amountBeforeDiscount: payload.amountBeforeDiscount,
        discountAmount: payload.discountAmount,
        amountAfterDiscount: payload.amount,
      });
    } catch (err) {
      console.error("Promo validation error:", err.message);
      return res.status(500).json({
        error:
          "Promo validation failed: Unable to validate this promo code right now. Please try again.",
      });
    }
  },
);

app.post(
  "/create-checkout-session",
  requireSameOrigin,
  bookingRateLimit,
  async (req, res) => {
    let bookingId = null;
    try {
      if (!requireStripeConfigured(res)) {
        return;
      }

      const user = await getRequestUser(req, res);
      const payload = normalizeBookingPayload(req.body, user);
      if (payload.error) {
        return res.status(400).json({ error: payload.error });
      }

      // Reserve the booking first so we never lose a user-intended booking due to later DB errors.
      bookingId = await insertBooking({
        userId: payload.memberUserId || null,
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        facility: payload.facility,
        date: payload.date,
        time: payload.time,
        duration: payload.duration,
        court: payload.court,
        membershipType: payload.membershipType,
        appliedMembership: payload.appliedMembership,
        amount: payload.amount,
        currency: "aud",
        paymentStatus: "pending",
        source: "checkout",
      });

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "aud",
              unit_amount: payload.amount,
              product_data: {
                name: payload.label,
                description: `${payload.date} at ${payload.time} (${payload.duration || "custom duration"})`,
              },
            },
          },
        ],
        customer_email: payload.email || undefined,
        metadata: {
          facility: payload.facility,
          date: payload.date,
          time: payload.time,
          duration: payload.duration,
          court: payload.court,
          name: payload.name,
          email: payload.email,
          phone: payload.phone,
          membershipType: payload.membershipType,
          appliedMembership: payload.appliedMembership,
          promoCode: payload.promoCode,
          discountAmount: String(payload.discountAmount || 0),
          amountBeforeDiscount: String(
            payload.amountBeforeDiscount || payload.amount,
          ),
          memberUserId: payload.memberUserId,
        },
        success_url: `${APP_URL}/booking.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP_URL}/booking.html?checkout=cancel`,
      });

      // Debug: Log session ID and currency
      console.log("[Stripe Checkout] Created session:", {
        id: session.id,
        currency: session.currency,
        url: session.url,
        amount_total: session.amount_total,
        payment_status: session.payment_status
      });

      await updateBookingById(bookingId, {
        checkoutSessionId: session.id,
        status: "pending",
      });

      return res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      console.error("Checkout session error:", err.message);
      if (bookingId) {
        try {
          await updateBookingById(bookingId, { status: "failed" });
        } catch (updateErr) {
          console.error(
            "Booking failure status update error:",
            updateErr.message,
          );
        }
      }
      return res.status(500).json({
        error:
          "Checkout session creation failed: Unable to initialize Stripe payment session. Please verify your booking details and try again.",
      });
    }
  },
);

app.post(
  "/create-inperson-booking",
  requireSameOrigin,
  requireAdmin,
  bookingRateLimit,
  async (req, res) => {
    try {
      // Walk-in bookings are captured by staff at the counter and should not
      // inherit logged-in admin membership pricing.
      const payload = normalizeBookingPayload(
        {
          ...req.body,
          isMember: false,
          membershipType: "",
        },
        null,
      );

      if (payload.error) {
        return res.status(400).json({ error: payload.error });
      }

      const bookingId = await insertBooking({
        userId: null,
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        facility: payload.facility,
        date: payload.date,
        time: payload.time,
        duration: payload.duration,
        court: payload.court,
        membershipType: "",
        appliedMembership: "none",
        amount: payload.amount,
        currency: "aud",
        paymentStatus: "pending_in_person",
        source: "in-person",
      });

      return res.json({
        ok: true,
        bookingId,
        message: "Walk-in booking saved as pending in-person payment.",
      });
    } catch (err) {
      console.error("In-person booking error:", err.message);
      return res.status(500).json({
        error:
          "In-person booking creation failed: Unable to save walk-in booking. Please try again.",
      });
    }
  },
);

app.post(
  "/create-membership-checkout-session",
  requireSameOrigin,
  requireAuth,
  async (req, res) => {
    try {
      if (!requireStripeConfigured(res)) {
        return;
      }

      const requestedMembershipType = normalizeMembershipType(
        req.body?.membershipType,
      );
      if (!requestedMembershipType) {
        return res.status(400).json({ error: "Invalid membership type." });
      }

      const userMembershipType = normalizeMembershipType(
        req.user?.membershipType,
      );
      if (requestedMembershipType !== userMembershipType) {
        return res.status(400).json({
          error: "Requested membership tier does not match your account.",
        });
      }

      const membershipPrice = MEMBERSHIP_PRICES[requestedMembershipType];
      if (!membershipPrice) {
        return res.status(400).json({ error: "Unsupported membership tier." });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "aud",
              unit_amount: membershipPrice.amount,
              product_data: {
                name: membershipPrice.label,
                description: "Membership signup payment",
              },
            },
          },
        ],
        customer_email: req.user.email || undefined,
        metadata: {
          checkoutType: "membership",
          membershipType: requestedMembershipType,
          memberUserId: req.user.id || "",
          email: req.user.email || "",
          name: req.user.name || "",
        },
        success_url: `${APP_URL}/smash-force-academy.html?membership=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP_URL}/smash-force-academy.html?membership=cancel`,
      });

      return res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      console.error("Membership checkout session error:", err.message);
      return res.status(500).json({
        error:
          "Membership checkout creation failed: Unable to start membership payment process. Please try again or contact support.",
      });
    }
  },
);

app.get("/checkout-session-status", async (req, res) => {
  try {
    if (!requireStripeConfigured(res)) {
      return;
    }

    const sessionId = String(req.query.session_id || "").trim();
    if (!sessionId) {
      return res.status(400).json({ error: "Missing session_id." });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return res.json({
      id: session.id,
      status: session.status,
      payment_status: session.payment_status,
      customer_email: session.customer_details?.email || null,
      metadata: session.metadata || {},
    });
  } catch (err) {
    console.error("Session status error:", err.message);
    return res.status(500).json({
      error:
        "Checkout session status retrieval failed: Unable to fetch payment session details. Please try again.",
    });
  }
});

// Keep legacy card-flow endpoint for compatibility with older frontend snippets.
app.post(
  "/create-payment-intent",
  requireSameOrigin,
  bookingRateLimit,
  async (req, res) => {
    let bookingId = null;
    try {
      if (!requireStripeConfigured(res)) {
        return;
      }

      const user = await getRequestUser(req, res);
      const payload = normalizeBookingPayload(req.body, user);
      if (payload.error) {
        return res.status(400).json({ error: payload.error });
      }

      bookingId = await insertBooking({
        userId: payload.memberUserId || null,
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        facility: payload.facility,
        date: payload.date,
        time: payload.time,
        duration: payload.duration,
        court: payload.court,
        membershipType: payload.membershipType,
        appliedMembership: payload.appliedMembership,
        amount: payload.amount,
        currency: "aud",
        paymentStatus: "pending",
        source: "payment-intent",
      });

      const paymentIntent = await stripe.paymentIntents.create({
        amount: payload.amount,
        currency: "aud",
        automatic_payment_methods: { enabled: true },
        metadata: {
          facility: payload.facility,
          date: payload.date,
          time: payload.time,
          duration: payload.duration,
          court: payload.court,
          name: payload.name,
          email: payload.email,
          phone: payload.phone,
          membershipType: payload.membershipType,
          appliedMembership: payload.appliedMembership,
          promoCode: payload.promoCode,
          discountAmount: String(payload.discountAmount || 0),
          amountBeforeDiscount: String(
            payload.amountBeforeDiscount || payload.amount,
          ),
          memberUserId: payload.memberUserId,
        },
      });

      await updateBookingById(bookingId, {
        paymentIntentId: paymentIntent.id,
        status: "pending",
      });

      return res.json({ clientSecret: paymentIntent.client_secret });
    } catch (err) {
      console.error("PaymentIntent error:", err.message);
      if (bookingId) {
        try {
          await updateBookingById(bookingId, { status: "failed" });
        } catch (updateErr) {
          console.error(
            "Booking failure status update error:",
            updateErr.message,
          );
        }
      }
      return res.status(500).json({
        error:
          "Payment intent creation failed: Unable to process your payment. Please verify your information and try again.",
      });
    }
  },
);

app.post(
  "/stripe-webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe) {
      return res
        .status(503)
        .send("Stripe is not configured for this environment.");
    }

    const signature = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET");
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        webhookSecret,
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res
        .status(400)
        .send(`Webhook signature verification failed: ${err.message}`);
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        await updateBookingByCheckoutSession(session.id, "paid");
        console.log("Checkout completed:", {
          sessionId: session.id,
          customer: session.customer_details?.email,
          metadata: session.metadata,
        });

        // Send confirmation email to customer
        const email = session.customer_details?.email || session.metadata?.email;
        if (email) {
          const name = session.metadata?.name || "Player";
          const facility = session.metadata?.facility || "Facility";
          const court = session.metadata?.court || "-";
          const date = session.metadata?.date || "-";
          const time = session.metadata?.time || "-";
          const duration = session.metadata?.duration || "-";
          const ref = `SFA-${session.id.slice(-8).toUpperCase()}`;
          sendBookingConfirmationEmail({
            to: email,
            name,
            facility,
            court,
            date,
            time,
            duration,
            ref
          });
        }
      }

      if (event.type === "payment_intent.succeeded") {
        const paymentIntent = event.data.object;
        await updateBookingByPaymentIntent(paymentIntent.id, "paid");
        console.log("PaymentIntent succeeded:", {
          id: paymentIntent.id,
          metadata: paymentIntent.metadata,
        });
      }

      if (event.type === "checkout.session.expired") {
        const session = event.data.object;
        await updateBookingByCheckoutSession(session.id, "expired");
      }

      if (event.type === "payment_intent.payment_failed") {
        const paymentIntent = event.data.object;
        await updateBookingByPaymentIntent(paymentIntent.id, "failed");
      }

      return res.json({ received: true });
    } catch (err) {
      console.error("Webhook processing failed:", err.message);
      return res
        .status(500)
        .send(
          "Webhook event processing failed: Unable to handle Stripe event. Please contact support with the event ID.",
        );
    }
  },
);

async function startServer(port = Number(process.env.PORT) || 3000) {
  try {
    await initDatabase();
    if (!isSmtpConfigured()) {
      console.warn(
        "SMTP is not configured. Forgot-password and contact-form emails will not be delivered.",
      );
    } else if (SMTP_DEBUG) {
      console.info("SMTP config summary:", getSmtpConfigSummary());
    }
    await maybeMigrateLegacyUsers();

    console.log(
      `Startup config: DB_PROVIDER=${DB_PROVIDER}, NODE_ENV=${process.env.NODE_ENV || "development"}, PORT=${port}`,
    );

    return await new Promise((resolve, reject) => {
      const server = app.listen(port, () => {
        console.log(`Server listening on port ${port}`);
        resolve(server);
      });
      server.on("error", reject);
    });
  } catch (err) {
    console.error("Server startup failed:", err.message);
    if (require.main === module) {
      console.error(`ERROR: Cannot start server - ${err.message}`);
      console.error(
        `DETAILS: Check database permissions, .env configuration, and ensure all required dependencies are installed.`,
      );
      process.exit(1);
    }
    throw err;
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
