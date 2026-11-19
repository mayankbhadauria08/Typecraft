-- Admin console Phase 5a: a record of the background jobs, for System health (docs/ADMIN-PHASE-5.md §3).
-- Adds one table only: nothing existing changes, and it is safe to run twice.
-- Apply by hand after a restore bookmark (docs/LAUNCH.md §1n). Never `wrangler d1 migrations apply`.

-- One row per cron run: the 10-minute run ('*/10 * * * *') and the nightly run ('17 21 * * *', 02:47 India time).
-- parts is JSON: { "<part>": "ok" | "<error message>" } for each part of the site that did work in that run
-- (payments, email, campaigns, institutes …). Rows older than 30 days are removed by the nightly run.
CREATE TABLE IF NOT EXISTS job_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule    TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,                    -- NULL: still running, or the run was cut off
  ok          INTEGER,                 -- 1: every part finished; 0: at least one failed
  failed      INTEGER NOT NULL DEFAULT 0,
  parts       TEXT,
  ms          INTEGER
);
CREATE INDEX IF NOT EXISTS job_runs_recent ON job_runs (schedule, started_at);
