-- Admin console, phase 2: core operations (docs/ADMIN-PHASE-2.md §4).
-- Adds tables and indexes only. Every statement is CREATE … IF NOT EXISTS, so running the
-- file twice changes nothing, and no existing row is touched.

-- Private notes staff write on a customer's profile. Customers never see them.
CREATE TABLE IF NOT EXISTS customer_notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,  -- the customer
  body       TEXT NOT NULL,
  created_by TEXT,                                                   -- users.id of the author (kept if that account goes)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customer_notes_user ON customer_notes (user_id, created_at);

-- A lesson or game unlocked ('allow') or locked ('deny') for one customer, whatever the plan says.
-- Active = ended_at IS NULL and (expires_at IS NULL or still in the future).
CREATE TABLE IF NOT EXISTS access_overrides (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('lesson', 'game')),
  target     TEXT NOT NULL,                                          -- lesson id (l1…) or game id (storm…)
  effect     TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  reason     TEXT NOT NULL,
  expires_at TEXT,                                                   -- NULL = until someone ends it
  created_by TEXT,
  created_at TEXT NOT NULL,
  ended_at   TEXT,
  ended_by   TEXT
);
CREATE INDEX IF NOT EXISTS access_overrides_user ON access_overrides (user_id, ended_at);
CREATE INDEX IF NOT EXISTS access_overrides_created ON access_overrides (created_at);

-- What a refund should do to the customer's plan, chosen by the administrator who sent it.
-- Keyed by Razorpay's refund id; no row means 'auto' (a full refund ends the plan, a partial one keeps it).
CREATE TABLE IF NOT EXISTS refund_choices (
  razorpay_refund_id TEXT PRIMARY KEY,
  plan_action        TEXT NOT NULL CHECK (plan_action IN ('keep', 'end')),
  created_by         TEXT,
  created_at         TEXT NOT NULL
);

-- Lists sorted by date, and the activity log read for one customer, order or package.
CREATE INDEX IF NOT EXISTS users_created ON users (created_at);
CREATE INDEX IF NOT EXISTS refunds_created ON refunds (created_at);
CREATE INDEX IF NOT EXISTS audit_logs_target ON audit_logs (target, created_at);
