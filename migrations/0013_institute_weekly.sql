-- Institutes: the Monday email to teachers and admins (docs/INSTITUTES.md §17).
-- Adds two tables. CREATE … IF NOT EXISTS: running the file twice changes nothing.
-- Apply on the live database by hand, after 0009, one statement at a time: take a restore bookmark first.

-- One row per person per week it was sent: the claim that makes the email go once.
CREATE TABLE IF NOT EXISTS institute_weekly_emails (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  week    TEXT NOT NULL,                             -- the Monday it went out (YYYY-MM-DD, India)
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, week)
);

-- A teacher or admin who switched the weekly email off (no row: on).
CREATE TABLE IF NOT EXISTS institute_email_settings (
  user_id    TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  weekly     INTEGER NOT NULL DEFAULT 1 CHECK (weekly IN (0, 1)),
  updated_at TEXT NOT NULL
);
