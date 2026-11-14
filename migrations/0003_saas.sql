-- TypeCraft SaaS: plans, payments (Razorpay), invoices, email logs, OTP, admin roles,
-- audit logs and platform settings. Only adds tables and rows; nothing existing changes.
-- Safe to run more than once (IF NOT EXISTS / INSERT OR IGNORE).
-- Money is stored in paise (INTEGER). Times are ISO-8601 UTC text.

-- Plans. features: JSON array of feature keys (package_features.key).
-- limits: JSON object, e.g. {"lessons":"first5","dailyTests":3,"historyDays":7}.
CREATE TABLE IF NOT EXISTS packages (
  id            TEXT PRIMARY KEY,                 -- 'free', 'starter', 'pro', 'premium', 'lifetime'
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  price_paise   INTEGER NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  currency      TEXT NOT NULL DEFAULT 'INR',
  validity_days INTEGER,                           -- NULL = never expires (free, lifetime)
  features      TEXT NOT NULL DEFAULT '[]',
  limits        TEXT NOT NULL DEFAULT '{}',
  highlight     INTEGER NOT NULL DEFAULT 0,        -- 1 = "recommended" card
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- The catalogue of feature keys a package can grant (labels shown on the pricing page).
CREATE TABLE IF NOT EXISTS package_features (
  key           TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0
);

-- A paid (or admin-granted) period of a package for a user. Entitlements = union of active rows.
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  package_id  TEXT NOT NULL REFERENCES packages (id),
  order_id    TEXT REFERENCES orders (id),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  source      TEXT NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase', 'admin', 'promo')),
  features    TEXT NOT NULL DEFAULT '[]',          -- snapshot at purchase
  limits      TEXT NOT NULL DEFAULT '{}',          -- snapshot at purchase
  starts_at   TEXT NOT NULL,
  expires_at  TEXT,                                -- NULL = lifetime
  reminded_at TEXT,                                -- renewal reminder sent
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_subscriptions_user ON user_subscriptions (user_id, status);
CREATE INDEX IF NOT EXISTS user_subscriptions_expires ON user_subscriptions (status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_order ON user_subscriptions (order_id) WHERE order_id IS NOT NULL;

-- Our order, one per checkout attempt. amount is a snapshot of the package price.
CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,              -- 'ord_' + random
  user_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  package_id        TEXT NOT NULL REFERENCES packages (id),
  amount_paise      INTEGER NOT NULL CHECK (amount_paise > 0),
  currency          TEXT NOT NULL DEFAULT 'INR',
  status            TEXT NOT NULL DEFAULT 'created'
                    CHECK (status IN ('created', 'attempted', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'cancelled')),
  razorpay_order_id TEXT UNIQUE,
  failure_reason    TEXT,
  paid_at           TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_user ON orders (user_id, created_at);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status, created_at);

-- Razorpay payments seen for an order (verified by signature or by a verified webhook).
CREATE TABLE IF NOT EXISTS payments (
  id                  TEXT PRIMARY KEY,            -- 'pay_row_' + random
  order_id            TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  razorpay_payment_id TEXT NOT NULL UNIQUE,
  amount_paise        INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  status              TEXT NOT NULL CHECK (status IN ('created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded')),
  method              TEXT,                         -- card, upi, netbanking, wallet…
  error_code          TEXT,
  error_description   TEXT,
  verified_by         TEXT NOT NULL DEFAULT 'signature' CHECK (verified_by IN ('signature', 'webhook', 'api')),
  captured_at         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_order ON payments (order_id);
CREATE INDEX IF NOT EXISTS payments_status ON payments (status, created_at);

CREATE TABLE IF NOT EXISTS refunds (
  id                 TEXT PRIMARY KEY,
  payment_id         TEXT NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  order_id           TEXT NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  user_id            TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  razorpay_refund_id TEXT UNIQUE,
  amount_paise       INTEGER NOT NULL CHECK (amount_paise > 0),
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  reason             TEXT,
  requested_by       TEXT,                          -- admin user id
  processed_at       TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS refunds_payment ON refunds (payment_id);

-- One invoice per paid order. number is sequential: TC-2026-000001.
CREATE TABLE IF NOT EXISTS invoices (
  id            TEXT PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  seq           INTEGER NOT NULL UNIQUE,
  order_id      TEXT NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  amount_paise  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'INR',
  billed_name   TEXT NOT NULL,
  billed_email  TEXT NOT NULL,
  seller        TEXT NOT NULL,                      -- JSON snapshot of seller details (platform_settings)
  lines         TEXT NOT NULL,                      -- JSON [{description, amountPaise}]
  issued_at     TEXT NOT NULL,
  emailed_at    TEXT
);
CREATE INDEX IF NOT EXISTS invoices_user ON invoices (user_id, issued_at);

-- Razorpay webhook deliveries, kept for idempotency and debugging.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          TEXT PRIMARY KEY,                     -- x-razorpay-event-id (or sha256 of body)
  provider    TEXT NOT NULL DEFAULT 'razorpay',
  event       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  error       TEXT,
  payload     TEXT NOT NULL,                        -- trimmed JSON (no card data is ever sent by Razorpay)
  received_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS webhook_events_received ON webhook_events (received_at);

-- Every email the platform sends or tries to send, with retries.
CREATE TABLE IF NOT EXISTS email_logs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT REFERENCES users (id) ON DELETE SET NULL,
  to_email        TEXT NOT NULL,
  template        TEXT NOT NULL,                    -- 'welcome', 'otp', 'payment_success', …
  category        TEXT NOT NULL DEFAULT 'transactional' CHECK (category IN ('auth', 'security', 'transactional', 'billing', 'platform', 'support')),
  subject         TEXT NOT NULL,
  payload         TEXT,                             -- JSON data to re-render on retry (never OTP codes or tokens in clear)
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'bounced', 'delivered', 'cancelled')),
  provider        TEXT NOT NULL DEFAULT 'resend',
  provider_id     TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TEXT,
  sent_at         TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS email_logs_status ON email_logs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS email_logs_user ON email_logs (user_id, created_at);
CREATE INDEX IF NOT EXISTS email_logs_created ON email_logs (created_at);

-- One-time codes sent by email. Only an HMAC of the code is stored.
CREATE TABLE IF NOT EXISTS otp_verifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES users (id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('login', 'verify_email', 'sensitive')),
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS otp_verifications_email ON otp_verifications (email, purpose, created_at);

-- Devices a user has signed in from (for "new sign-in" alerts). ua_hash = sha256 of browser + OS family.
CREATE TABLE IF NOT EXISTS known_devices (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ua_hash    TEXT NOT NULL,
  label      TEXT,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  PRIMARY KEY (user_id, ua_hash)
);

-- Admin roles. Emails in the OWNER_EMAILS secret are always 'owner' even without a row.
CREATE TABLE IF NOT EXISTS admin_users (
  user_id    TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'support')),
  created_by TEXT,
  created_at TEXT NOT NULL
);

-- Sensitive actions (admin changes, refunds, role changes, plan grants).
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,                                  -- user id, or NULL for the system / webhooks
  action     TEXT NOT NULL,                         -- 'package.update', 'payment.refund', …
  target     TEXT,                                  -- 'package:pro', 'user:<id>', …
  detail     TEXT,                                  -- JSON
  ip         TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_created ON audit_logs (created_at);

-- Key/value settings editable in admin (seller details, support email, feature flags).
CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                         -- JSON
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

-- Standalone typing tests (the public Typing Test page; saved for signed-in users).
CREATE TABLE IF NOT EXISTS typing_tests (
  id         TEXT PRIMARY KEY,                      -- made in the browser (idempotent)
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  duration   INTEGER NOT NULL,                      -- seconds: 30, 60, 120, 300
  wpm        REAL NOT NULL,
  raw_wpm    REAL,
  accuracy   REAL NOT NULL,
  errors     INTEGER NOT NULL DEFAULT 0,
  chars      INTEGER NOT NULL DEFAULT 0,
  text_kind  TEXT NOT NULL DEFAULT 'words',         -- words, quotes, numbers, code
  day        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, id)
);
CREATE INDEX IF NOT EXISTS typing_tests_user ON typing_tests (user_id, created_at);

-- Messages from the Contact page.
CREATE TABLE IF NOT EXISTS contact_messages (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users (id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  topic      TEXT NOT NULL DEFAULT 'general',
  message    TEXT NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 0,            -- 1 = from a plan with priority support
  status     TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'answered', 'closed')),
  ip         TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contact_messages_created ON contact_messages (status, created_at);

-- Email preferences (marketing/announcements opt-out; security and billing emails always go).
CREATE TABLE IF NOT EXISTS email_preferences (
  user_id        TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  announcements  INTEGER NOT NULL DEFAULT 1,
  test_results   INTEGER NOT NULL DEFAULT 0,
  login_alerts   INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL
);

-- ---------- starting data (prices and entitlements are editable in admin) ----------
INSERT OR IGNORE INTO package_features (key, label, description, display_order) VALUES
  ('lessons.first5',     'First 5 lessons',                    'The first five home-row lessons.', 1),
  ('lessons.all',        'All 78 lessons',                     'The full course: home row to Pro tracks, bosses and placement test.', 2),
  ('arcade.daily',       'Daily Challenge',                    'One shared challenge a day.', 3),
  ('arcade.all',         'All 8 arcade games',                 'Word Storm, Beat, Tug of War, Ghost race, Pop, Tower, Safe cracker, Boss.', 4),
  ('tests.basic',        'Typing tests',                       'Timed tests with WPM and accuracy (daily limit applies).', 5),
  ('history.full',       'Full performance history',           'Every lesson, game and test you have done.', 6),
  ('analytics.basic',    'Progress analytics',                 'Speed and accuracy trends by day and week.', 7),
  ('analytics.advanced', 'Advanced analytics',                 'Per-key accuracy heatmap, slowest letter pairs, error types.', 8),
  ('practice.custom',    'Custom practice',                    'Practise your own text or your weakest keys.', 9),
  ('exercises.premium',  'Premium exercise packs',             'Extra packs: numbers & data entry, code, business writing, exam passages.', 10),
  ('insights',           'Personal insights',                  'A weekly plan built from your mistakes and speed.', 11),
  ('certificates',       'Certificates',                       'Printable level certificates with your verified speed.', 12),
  ('support.priority',   'Priority support',                   'Your messages are answered first.', 13);

INSERT OR IGNORE INTO packages (id, name, description, price_paise, validity_days, features, limits, highlight, active, display_order, created_at, updated_at) VALUES
  ('free', 'Free', 'Start touch typing: the first five lessons, the Daily Challenge and basic tests.', 0, NULL,
   '["lessons.first5","arcade.daily","tests.basic"]',
   '{"lessons":"first5","dailyTests":3,"historyDays":7}', 0, 1, 1, '2026-11-15T00:00:00.000Z', '2026-11-15T00:00:00.000Z'),
  ('starter', 'Starter', 'The whole course and arcade for a month.', 9900, 30,
   '["lessons.all","arcade.daily","arcade.all","tests.basic","history.full","analytics.basic"]',
   '{"lessons":"all","dailyTests":20,"historyDays":null}', 0, 1, 2, '2026-11-15T00:00:00.000Z', '2026-11-15T00:00:00.000Z'),
  ('pro', 'Pro', 'Three months with advanced analytics, custom practice and premium packs.', 19900, 90,
   '["lessons.all","arcade.daily","arcade.all","tests.basic","history.full","analytics.basic","analytics.advanced","practice.custom","exercises.premium"]',
   '{"lessons":"all","dailyTests":null,"historyDays":null}', 1, 1, 3, '2026-11-15T00:00:00.000Z', '2026-11-15T00:00:00.000Z'),
  ('premium', 'Premium', 'Six months of everything in Pro, plus insights, certificates and priority support.', 39900, 180,
   '["lessons.all","arcade.daily","arcade.all","tests.basic","history.full","analytics.basic","analytics.advanced","practice.custom","exercises.premium","insights","certificates","support.priority"]',
   '{"lessons":"all","dailyTests":null,"historyDays":null}', 0, 1, 4, '2026-11-15T00:00:00.000Z', '2026-11-15T00:00:00.000Z'),
  ('lifetime', 'Lifetime', 'One payment, no renewals: everything in Premium for as long as TypeCraft runs.', 79900, NULL,
   '["lessons.all","arcade.daily","arcade.all","tests.basic","history.full","analytics.basic","analytics.advanced","practice.custom","exercises.premium","insights","certificates","support.priority"]',
   '{"lessons":"all","dailyTests":null,"historyDays":null}', 0, 1, 5, '2026-11-15T00:00:00.000Z', '2026-11-15T00:00:00.000Z');

INSERT OR IGNORE INTO platform_settings (key, value, updated_at) VALUES
  ('seller', '{"name":"TypeCraft","legalName":"[Your full name] (sole proprietor)","address":"[Your address, City, State, PIN]","email":"hello@typecrafttyping.com","phone":"","gstin":null}', '2026-11-15T00:00:00.000Z'),
  ('support', '{"email":"hello@typecrafttyping.com","hours":"Mon–Sat, 10:00–18:00 IST","replyDays":2}', '2026-11-15T00:00:00.000Z'),
  ('payments', '{"enabled":true,"testMode":true}', '2026-11-15T00:00:00.000Z'),
  ('invoice_seq', '{"next":1}', '2026-11-15T00:00:00.000Z'),
  ('signups', '{"open":true}', '2026-11-15T00:00:00.000Z');
