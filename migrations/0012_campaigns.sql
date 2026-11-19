-- Admin console Phase 4b: email campaigns and notifications for learners (docs/ADMIN-PHASE-4.md §4–5).
-- Adds tables only: nothing existing changes, and it is safe to run twice.
-- Apply by hand after a restore bookmark (docs/LAUNCH.md §1j). Never `wrangler d1 migrations apply`.

-- An email to many people. audience is JSON: {"kind":"all"} | {"kind":"free"} | {"kind":"paid"}
-- | {"kind":"plan","plan":"<package id>"} | {"kind":"inactive","days":7|14|30}.
-- draft → scheduled (send_at) → sending (the people are fixed then) → sent; scheduled or sending → cancelled.
CREATE TABLE IF NOT EXISTS email_campaigns (
  id          TEXT PRIMARY KEY,                    -- 'cmp_' + random
  name        TEXT NOT NULL,                       -- for the team; never emailed
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,                       -- plain text; blank lines start paragraphs
  audience    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  send_at     TEXT,                                -- when sending may start
  total       INTEGER NOT NULL DEFAULT 0,          -- people it went to, fixed when sending starts
  created_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  started_at  TEXT,
  finished_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_campaigns_due ON email_campaigns (status, send_at);

-- One row per person a campaign goes to. waiting → sent | failed (the email itself is in email_logs)
-- | skipped (turned off product news, or the account was closed, before their turn) | cancelled.
CREATE TABLE IF NOT EXISTS campaign_sends (
  campaign_id TEXT NOT NULL REFERENCES email_campaigns (id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),
  email_id    TEXT,                                -- email_logs.id
  sent_at     TEXT,                                -- when it was handed to Resend (counts towards the daily limit)
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS campaign_sends_waiting ON campaign_sends (status, campaign_id);
CREATE INDEX IF NOT EXISTS campaign_sends_sent ON campaign_sends (sent_at);

-- Short messages for learners, shown under the site header and at the top of the trainer.
CREATE TABLE IF NOT EXISTS site_notices (
  id         TEXT PRIMARY KEY,                     -- 'ntc_' + random
  message    TEXT NOT NULL,                        -- up to 200 characters, plain text
  link_url   TEXT,                                 -- a path on the site (/pricing) or an https address
  link_label TEXT,
  tone       TEXT NOT NULL DEFAULT 'info' CHECK (tone IN ('info', 'offer', 'warning')),
  audience   TEXT NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'guests', 'signed_in', 'free', 'paid')),
  place      TEXT NOT NULL DEFAULT 'both' CHECK (place IN ('site', 'trainer', 'both')),
  starts_at  TEXT,                                 -- NULL: from now
  ends_at    TEXT,                                 -- NULL: until turned off
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS site_notices_live ON site_notices (active, ends_at);
