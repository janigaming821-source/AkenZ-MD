-- Cloudflare D1 schema for the AkenZ MD shop (database `akenz-shop`).
-- Apply with: npx wrangler d1 execute akenz-shop --remote --file=shop/schema.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  plan TEXT NOT NULL,
  expires_at TEXT,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  -- The bot instance serving this buyer. An instance holds many buyers, so
  -- instance_id is what that instance uses to pick their settings.
  instance_id TEXT NOT NULL DEFAULT '',
  bot_url TEXT NOT NULL DEFAULT '',
  bot_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  plan TEXT NOT NULL,
  price_lkr INTEGER NOT NULL,
  bot_name TEXT NOT NULL DEFAULT '',
  prefix TEXT NOT NULL DEFAULT '.',
  ez_number TEXT NOT NULL,
  txn_id TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  handled_at TEXT,
  customer_id INTEGER REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at);
CREATE INDEX IF NOT EXISTS orders_ip_idx ON orders (ip, created_at);
