-- MySQL bootstrap schema for SmashCourt

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(191) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  membership_type VARCHAR(32) NOT NULL DEFAULT '',
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  created_at VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token VARCHAR(191) PRIMARY KEY,
  user_id VARCHAR(191) NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_sessions_expires_at (expires_at),
  INDEX idx_sessions_user_id (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

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
  amount INTEGER NOT NULL,
  currency VARCHAR(16) NOT NULL DEFAULT 'usd',
  payment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  checkout_session_id VARCHAR(191) UNIQUE,
  payment_intent_id VARCHAR(191) UNIQUE,
  source VARCHAR(32) NOT NULL DEFAULT 'checkout',
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL,
  INDEX idx_bookings_created_at (created_at),
  INDEX idx_bookings_user_id (user_id),
  INDEX idx_bookings_booking_date (booking_date),
  CONSTRAINT fk_bookings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS site_content (
  `key` VARCHAR(191) PRIMARY KEY,
  content_json LONGTEXT NOT NULL,
  updated_at VARCHAR(64) NOT NULL
);
