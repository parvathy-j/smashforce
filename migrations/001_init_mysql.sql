
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  membership_type VARCHAR(32) NOT NULL DEFAULT '',
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  password_hash VARCHAR(255) NOT NULL,
  created_at VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  CONSTRAINT fk_sessions_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_expires_at ON sessions (expires_at);
CREATE INDEX idx_sessions_user_id ON sessions (user_id);

CREATE TABLE IF NOT EXISTS bookings (
  id VARCHAR(64) PRIMARY KEY,
  ref VARCHAR(32) NOT NULL UNIQUE,
  user_id VARCHAR(64) NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(64) NOT NULL DEFAULT '',
  facility VARCHAR(64) NOT NULL,
  booking_date VARCHAR(64) NOT NULL,
  booking_time VARCHAR(64) NOT NULL,
  duration VARCHAR(64) NOT NULL DEFAULT '',
  court VARCHAR(64) NOT NULL DEFAULT '',
  membership_type VARCHAR(32) NOT NULL DEFAULT '',
  applied_membership VARCHAR(32) NOT NULL DEFAULT 'none',
  amount INT NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'usd',
  payment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  checkout_session_id VARCHAR(255) UNIQUE,
  payment_intent_id VARCHAR(255) UNIQUE,
  source VARCHAR(32) NOT NULL DEFAULT 'checkout',
  created_at VARCHAR(64) NOT NULL,
  updated_at VARCHAR(64) NOT NULL,
  CONSTRAINT fk_bookings_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_bookings_created_at ON bookings (created_at);
CREATE INDEX idx_bookings_user_id ON bookings (user_id);
CREATE INDEX idx_bookings_booking_date ON bookings (booking_date);

CREATE TABLE IF NOT EXISTS site_content (
  `key` VARCHAR(64) PRIMARY KEY,
  content_json LONGTEXT NOT NULL,
  updated_at VARCHAR(64) NOT NULL
);