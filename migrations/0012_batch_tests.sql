-- Institutes: a scheduled mock test for a batch (docs/INSTITUTES.md §16). Every student of the batch takes
-- the same exam practice passage inside a time window; the teacher sees the results in one table.
-- Adds two tables and their indexes. CREATE … IF NOT EXISTS: running the file twice changes nothing.
-- Apply on the live database by hand, after 0008 and 0009, one statement at a time: take a restore bookmark first.

CREATE TABLE IF NOT EXISTS batch_tests (
  id           TEXT PRIMARY KEY,                    -- 'btst_' + 20 random hex
  institute_id TEXT NOT NULL REFERENCES institutes (id) ON DELETE CASCADE,
  batch_id     TEXT NOT NULL REFERENCES batches (id) ON DELETE CASCADE,
  mode         TEXT NOT NULL,                       -- an exam practice test: ssc-typing | ssc-dest | cpct
  passage_id   TEXT NOT NULL,                       -- the same passage for everyone
  opens_at     TEXT NOT NULL,
  closes_at    TEXT NOT NULL,                       -- the last moment to start; a test started in time can be finished
  note         TEXT NOT NULL DEFAULT '',
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT
);
CREATE INDEX IF NOT EXISTS batch_tests_batch ON batch_tests (batch_id, opens_at);

-- One row per student per test: how often they opened the passage, and the one result that counts.
CREATE TABLE IF NOT EXISTS batch_test_attempts (
  test_id          TEXT NOT NULL REFERENCES batch_tests (id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  starts           INTEGER NOT NULL DEFAULT 0,
  first_started_at TEXT,
  last_started_at  TEXT,
  result_id        TEXT REFERENCES exam_results (id) ON DELETE SET NULL,  -- the first result submitted in time
  submitted_at     TEXT,
  PRIMARY KEY (test_id, user_id)
);
CREATE INDEX IF NOT EXISTS batch_test_attempts_user ON batch_test_attempts (user_id);
