-- Institutes, Release 3: buying seats online with Razorpay (docs/INSTITUTES.md §15).
-- Adds one table and its index. CREATE … IF NOT EXISTS: running the file twice changes nothing.
-- Apply on the live database by hand, after 0010, one statement at a time: take a restore bookmark first.

-- One checkout for an institute: a new institute with seats, more seats for the current term, or a renewal.
-- Seats change only when Razorpay confirms the payment to the server (signature check and the payment fetched
-- from Razorpay, or a signed webhook): never on the word of the browser alone.
CREATE TABLE IF NOT EXISTS institute_orders (
  id                  TEXT PRIMARY KEY,               -- 'iord_' + 20 random hex
  user_id             TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,   -- who pays
  institute_id        TEXT REFERENCES institutes (id) ON DELETE CASCADE,       -- NULL for a new institute until it is paid
  kind                TEXT NOT NULL CHECK (kind IN ('new', 'seats', 'renew')),
  details             TEXT NOT NULL DEFAULT '{}',     -- JSON: a new institute's name, city, contact, GSTIN
  package_id          TEXT NOT NULL REFERENCES packages (id),
  seats               INTEGER NOT NULL CHECK (seats > 0),
  months              INTEGER NOT NULL CHECK (months > 0),
  amount_paise        INTEGER NOT NULL CHECK (amount_paise > 0),
  currency            TEXT NOT NULL DEFAULT 'INR',
  status              TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'pending', 'paid', 'failed', 'cancelled')),
  razorpay_order_id   TEXT UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  failure_reason      TEXT,
  claim_id            TEXT,                           -- set by the one call that switches the seats on
  institute_payment_id TEXT,                          -- the payment it recorded (institute_payments.id)
  invoice_emailed_at  TEXT,
  paid_at             TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS institute_orders_status ON institute_orders (status, created_at);
