-- Admin console Phase 3: course edits (docs/ADMIN-PHASE-3.md §3).
-- Adds tables only. Every statement is CREATE … IF NOT EXISTS, so running the file twice changes nothing.
-- Apply on the live database by hand (it has no d1_migrations table): take a restore bookmark first.

-- One draft per item ('lesson:l7', 'level:2', 'unit:home', 'pack:numbers'): what the item should
-- become when the next version is published. {"reset": true} means "back to the original".
CREATE TABLE IF NOT EXISTS course_drafts (
  item       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                       -- JSON
  updated_by TEXT,                                -- users.id of the staff member
  updated_at TEXT NOT NULL
);

-- Every published version of the course edits. The live course is the highest version.
CREATE TABLE IF NOT EXISTS course_releases (
  version      INTEGER PRIMARY KEY,
  edits        TEXT NOT NULL,                     -- JSON: everything published in this version
  items        TEXT NOT NULL DEFAULT '[]',        -- JSON: the items that changed from the version before
  note         TEXT,                              -- what changed, in the publisher's words
  published_by TEXT,
  published_at TEXT NOT NULL
);
