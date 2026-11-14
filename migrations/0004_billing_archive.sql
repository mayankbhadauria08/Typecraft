-- Invoices and payment records are kept for tax and accounting when a learner deletes their
-- account (the account, learning data and sessions still go). Adds one table; nothing changes.
CREATE TABLE IF NOT EXISTS billing_archive (
  invoice_number   TEXT PRIMARY KEY,
  former_user_id   TEXT NOT NULL,          -- no link: the user row is gone
  billed_name      TEXT NOT NULL,
  billed_email     TEXT NOT NULL,
  amount_paise     INTEGER NOT NULL,
  currency         TEXT NOT NULL,
  issued_at        TEXT NOT NULL,
  invoice          TEXT NOT NULL,          -- JSON: the invoice row (seller, lines…)
  order_json       TEXT,                   -- JSON: the order row
  payments_json    TEXT,                   -- JSON: payments for the order
  refunds_json     TEXT,                   -- JSON: refunds for the order
  archived_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS billing_archive_email ON billing_archive (billed_email);
