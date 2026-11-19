-- Institutes: seats for a class, batches, join codes, institute staff (docs/INSTITUTES.md §2).
-- Adds tables and indexes only. Every statement is CREATE … IF NOT EXISTS, so running the file twice
-- changes nothing, and no existing table or row is touched.
-- Apply on the live database by hand (it has no d1_migrations table): take a restore bookmark first.

-- One customer organisation: a typing or exam coaching centre. Seats give its students the paid plan
-- package_id while the institute is active and today is inside [starts_at, ends_at).
CREATE TABLE IF NOT EXISTS institutes (
  id            TEXT PRIMARY KEY,                    -- 'ins_' + 20 random hex
  name          TEXT NOT NULL,
  city          TEXT NOT NULL DEFAULT '',
  contact_name  TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  gstin         TEXT NOT NULL DEFAULT '',
  package_id    TEXT NOT NULL REFERENCES packages (id),  -- the plan a seat gives
  seats         INTEGER NOT NULL DEFAULT 0 CHECK (seats >= 0),
  price_paise   INTEGER NOT NULL DEFAULT 0 CHECK (price_paise >= 0),  -- agreed price per seat for the term
  starts_at     TEXT NOT NULL,
  ends_at       TEXT NOT NULL,
  -- pending: set up, not paid yet (staff can prepare batches; nobody can join)
  -- active: paid (seats give the plan); suspended: paused by TypeCraft; closed: finished for good
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  notes         TEXT NOT NULL DEFAULT '',            -- private, for TypeCraft staff only
  created_by    TEXT,                                -- users.id of the console user (kept if that account goes)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS institutes_status ON institutes (status, ends_at);

-- People who run an institute: its admin(s) and teachers. Invited by email; user_id is filled in when
-- the invitation is accepted by the account with that (verified) email.
CREATE TABLE IF NOT EXISTS institute_staff (
  id           TEXT PRIMARY KEY,                     -- 'stf_' + 20 random hex
  institute_id TEXT NOT NULL REFERENCES institutes (id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users (id) ON DELETE CASCADE,
  email        TEXT NOT NULL,                        -- lower-case
  role         TEXT NOT NULL CHECK (role IN ('admin', 'teacher')),
  status       TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'removed')),
  invited_by   TEXT,
  invited_at   TEXT NOT NULL,
  joined_at    TEXT,
  removed_by   TEXT,
  removed_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS institute_staff_one ON institute_staff (institute_id, email) WHERE status <> 'removed';
CREATE INDEX IF NOT EXISTS institute_staff_user ON institute_staff (user_id, status);
CREATE INDEX IF NOT EXISTS institute_staff_email ON institute_staff (email, status);

-- A class inside an institute. Students join a batch with its code; join_code NULL = joining is off.
CREATE TABLE IF NOT EXISTS batches (
  id           TEXT PRIMARY KEY,                     -- 'bat_' + 20 random hex
  institute_id TEXT NOT NULL REFERENCES institutes (id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  join_code    TEXT UNIQUE,                          -- 8 characters, no look-alikes (shown as ABCD-EFGH)
  archived_at  TEXT,
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS batches_institute ON batches (institute_id, archived_at);

-- Which teachers teach which batch. The institute's admins see every batch without a row here.
CREATE TABLE IF NOT EXISTS batch_teachers (
  batch_id    TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  staff_id    TEXT NOT NULL REFERENCES institute_staff (id) ON DELETE CASCADE,
  assigned_by TEXT,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, staff_id)
);
CREATE INDEX IF NOT EXISTS batch_teachers_staff ON batch_teachers (staff_id);

-- A seat in use: one student in one batch. Leaving or being removed ends the row (kept as history)
-- and frees the seat. One active row per student per institute.
CREATE TABLE IF NOT EXISTS institute_students (
  id                 TEXT PRIMARY KEY,               -- 'mem_' + 20 random hex
  institute_id       TEXT NOT NULL REFERENCES institutes (id) ON DELETE CASCADE,
  batch_id           TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'removed')),
  adult_confirmed_at TEXT NOT NULL,                  -- the student confirmed being 18 or older when joining
  joined_at          TEXT NOT NULL,
  ended_at           TEXT,
  ended_by           TEXT                            -- users.id of whoever removed them (NULL: the student left)
);
CREATE UNIQUE INDEX IF NOT EXISTS institute_students_one ON institute_students (institute_id, user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS institute_students_seats ON institute_students (institute_id, status);
CREATE INDEX IF NOT EXISTS institute_students_user ON institute_students (user_id, status);
CREATE INDEX IF NOT EXISTS institute_students_batch ON institute_students (batch_id, status);

-- Money received from an institute outside the website (bank transfer, UPI, cheque). Recorded by
-- TypeCraft staff in the console; recording it is what switches an institute on.
CREATE TABLE IF NOT EXISTS institute_payments (
  id           TEXT PRIMARY KEY,                     -- 'ipay_' + 20 random hex
  institute_id TEXT NOT NULL REFERENCES institutes (id) ON DELETE CASCADE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  method       TEXT NOT NULL CHECK (method IN ('bank_transfer', 'upi', 'cheque', 'cash', 'other')),
  reference    TEXT NOT NULL DEFAULT '',             -- UTR, UPI reference or cheque number
  paid_on      TEXT NOT NULL,                        -- the day the money arrived (YYYY-MM-DD)
  note         TEXT NOT NULL DEFAULT '',
  recorded_by  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS institute_payments_institute ON institute_payments (institute_id, paid_on);
