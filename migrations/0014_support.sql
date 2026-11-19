-- Admin console Phase 4a: the Support inbox (docs/ADMIN-CONSOLE.md, docs/ADMIN-PHASE-4.md §2).
-- Adds tables only. Every statement is CREATE … IF NOT EXISTS, so running the file twice changes nothing.
-- Apply on the live database by hand (it has no d1_migrations table): take a restore bookmark first.
-- Messages themselves stay in contact_messages (0003): status new | answered | closed.

-- What staff wrote on a message: a reply emailed to the customer, or a note only staff see.
CREATE TABLE IF NOT EXISTS support_replies (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES contact_messages (id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users (id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('reply', 'note')),
  body        TEXT NOT NULL,
  email_id    TEXT,                                -- email_logs.id of the reply that was sent
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS support_replies_message ON support_replies (message_id, created_at);

-- Who on the team looks after a message (one row per assigned message).
CREATE TABLE IF NOT EXISTS support_assignments (
  message_id   TEXT PRIMARY KEY REFERENCES contact_messages (id) ON DELETE CASCADE,
  assigned_to  TEXT REFERENCES users (id) ON DELETE SET NULL,
  assigned_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS support_assignments_to ON support_assignments (assigned_to);
