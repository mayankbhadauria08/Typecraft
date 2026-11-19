-- Institutes, Release 2: targets, assignments, the batch leaderboard, student invitations, reminders and
-- GST invoices for institute payments (docs/INSTITUTES.md §12–§15).
-- Adds tables and indexes only. Every statement is CREATE … IF NOT EXISTS, so running the file twice changes nothing.
-- Apply on the live database by hand, after 0009, one statement at a time: take a restore bookmark first.

-- Batches whose leaderboard is on (students then see each other's first names and best speeds of the week).
-- No row = off, which is how every batch starts.
CREATE TABLE IF NOT EXISTS batch_leaderboards (
  batch_id TEXT PRIMARY KEY REFERENCES batches (id) ON DELETE CASCADE,
  on_by    TEXT,
  on_at    TEXT NOT NULL
);

-- One target per batch: a speed at an accuracy, by a day (optional).
CREATE TABLE IF NOT EXISTS batch_targets (
  batch_id  TEXT PRIMARY KEY REFERENCES batches (id) ON DELETE CASCADE,
  wpm       INTEGER NOT NULL CHECK (wpm BETWEEN 5 AND 150),
  accuracy  INTEGER NOT NULL CHECK (accuracy BETWEEN 50 AND 100),
  due_day   TEXT,                                   -- YYYY-MM-DD (India), or NULL
  note      TEXT NOT NULL DEFAULT '',
  set_by    TEXT,
  set_at    TEXT NOT NULL
);

-- Work given to a batch: a course lesson, or an exam practice test, by a day.
CREATE TABLE IF NOT EXISTS assignments (
  id         TEXT PRIMARY KEY,                      -- 'asg_' + 20 random hex
  batch_id   TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('lesson', 'exam')),
  ref        TEXT NOT NULL,                         -- lesson id (l1…) or exam mode (ssc-typing, ssc-dest, cpct)
  due_day    TEXT NOT NULL,                         -- YYYY-MM-DD (India)
  note       TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  removed_at TEXT
);
CREATE INDEX IF NOT EXISTS assignments_batch ON assignments (batch_id, removed_at);

-- Students invited by email to a batch (from a spreadsheet). The email carries the batch's join link.
CREATE TABLE IF NOT EXISTS student_invites (
  id         TEXT PRIMARY KEY,                      -- 'sinv_' + 20 random hex
  batch_id   TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  email      TEXT NOT NULL,                         -- lower-case
  name       TEXT NOT NULL DEFAULT '',
  invited_by TEXT,
  invited_at TEXT NOT NULL,
  email_status TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS student_invites_one ON student_invites (batch_id, email);

-- Reminder emails already sent to an institute, so each goes once (kind: seats_90, ends_30, ends_7; ref: the term's end).
CREATE TABLE IF NOT EXISTS institute_reminders (
  institute_id TEXT NOT NULL REFERENCES institutes (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  ref          TEXT NOT NULL,
  sent_at      TEXT NOT NULL,
  PRIMARY KEY (institute_id, kind, ref)
);

-- An invoice for money an institute paid (one per recorded payment), numbered from the same sequence as
-- every other TypeCraft invoice. The institute's and seller's details are copied at issue time.
CREATE TABLE IF NOT EXISTS institute_invoices (
  id           TEXT PRIMARY KEY,
  number       TEXT NOT NULL UNIQUE,
  seq          INTEGER NOT NULL UNIQUE,
  institute_id TEXT NOT NULL REFERENCES institutes (id) ON DELETE CASCADE,
  payment_id   TEXT UNIQUE,                         -- institute_payments.id (kept if that payment is removed later)
  amount_paise INTEGER NOT NULL,
  billed_to    TEXT NOT NULL,                       -- JSON: name, contact, email, phone, city, gstin
  seller       TEXT NOT NULL,                       -- JSON snapshot of platform_settings 'seller'
  lines        TEXT NOT NULL,                       -- JSON [{ description, quantity, amountPaise }]
  issued_at    TEXT NOT NULL,
  emailed_at   TEXT
);
CREATE INDEX IF NOT EXISTS institute_invoices_institute ON institute_invoices (institute_id, issued_at);
