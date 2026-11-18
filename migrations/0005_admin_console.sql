-- TypeCraft admin console, phase 1: admin sign-in sessions and editable role permissions.
-- Only adds tables; nothing existing changes. Safe to run more than once (IF NOT EXISTS).
-- Roles themselves stay in admin_users (0003); actions are recorded in audit_logs (0003).

-- One row per admin sign-in, separate from the learner session. The cookie holds a random
-- token; only its SHA-256 is stored. Ended rows are kept 30 days as a sign-in history.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id            TEXT PRIMARY KEY,                       -- SHA-256 hex of the cookie token
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  second_factor INTEGER NOT NULL DEFAULT 0 CHECK (second_factor IN (0, 1)), -- 1 = an emailed code was checked
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,                          -- the idle timeout counts from here
  expires_at    TEXT NOT NULL,                          -- hard end, whatever the activity
  reauth_at     TEXT NOT NULL,                          -- last password confirmation (sensitive actions)
  ip            TEXT,
  device        TEXT,                                   -- "Chrome on Windows"
  ended_at      TEXT,
  ended_reason  TEXT                                    -- signed_out | signed_out_everywhere | idle | expired | role_removed | account_disabled | password_changed
);
CREATE INDEX IF NOT EXISTS admin_sessions_user ON admin_sessions (user_id, created_at);
CREATE INDEX IF NOT EXISTS admin_sessions_expires ON admin_sessions (expires_at);

-- What the Admin and Support roles may do, where it differs from the defaults in
-- src/console/permissions.js. No row = the default. Super Admin (owner) always has everything.
CREATE TABLE IF NOT EXISTS role_permissions (
  role        TEXT NOT NULL CHECK (role IN ('admin', 'support')),
  permission  TEXT NOT NULL,
  allowed     INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  updated_by  TEXT,                                     -- user id of the Super Admin who changed it
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);
