-- Exam practice and verifiable certificates (docs/EXAM-MODES.md §2).
-- Adds tables only. Every statement is CREATE … IF NOT EXISTS, so running the file twice changes nothing.
-- Apply on the live database by hand (it has no d1_migrations table): take a restore bookmark first.

-- One saved exam-practice attempt. The Worker scores what was typed (shared/exam-rules.js) and keeps
-- the numbers only, never the typed text.
CREATE TABLE IF NOT EXISTS exam_results (
  id              TEXT PRIMARY KEY,                -- made in the browser, so a resend saves once
  user_id         TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mode            TEXT NOT NULL,                   -- ssc-typing | ssc-dest | cpct
  passage_id      TEXT NOT NULL,
  seconds         REAL NOT NULL,                   -- time used
  strokes         INTEGER NOT NULL,                -- key depressions typed
  correct_strokes INTEGER NOT NULL,
  words           INTEGER NOT NULL,                -- words of the passage reached
  full_mistakes   INTEGER NOT NULL,
  half_mistakes   INTEGER NOT NULL,
  gross_wpm       REAL NOT NULL,
  net_wpm         REAL NOT NULL,
  kdph            INTEGER NOT NULL,                -- correct key depressions an hour
  mistakes_pct    REAL NOT NULL,
  passed          INTEGER NOT NULL DEFAULT 0,
  day             TEXT NOT NULL,                   -- the learner's own day
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS exam_results_user ON exam_results (user_id, created_at);

-- A code anyone can check at /verify. kind 'level' (a speed certificate from the course: ref = the
-- level, 20 to 60) or 'exam' (a passed exam-practice result: ref = exam_results.id).
CREATE TABLE IF NOT EXISTS certificate_codes (
  code       TEXT PRIMARY KEY,                     -- 12 characters, no look-alikes (shown as XXXX-XXXX-XXXX)
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('level', 'exam')),
  ref        TEXT NOT NULL,
  shared     INTEGER NOT NULL DEFAULT 1,           -- 0: the holder stopped sharing it
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS certificate_codes_one ON certificate_codes (user_id, kind, ref);
