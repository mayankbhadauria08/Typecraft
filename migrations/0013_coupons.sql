-- Admin console Phase 4c: coupons and promotions (docs/ADMIN-PHASE-4.md §7).
-- Adds tables only: nothing existing changes, and it is safe to run twice.
-- Apply by hand after a restore bookmark (docs/LAUNCH.md §1k). Never `wrangler d1 migrations apply`.
-- Money is in paise. An order's amount_paise stays what the customer paid; order_discounts says
-- what the price was before, and why it was lower.

-- A code a customer types at checkout.
CREATE TABLE IF NOT EXISTS coupons (
  id            TEXT PRIMARY KEY,                  -- 'cpn_' + random
  code          TEXT NOT NULL,                     -- upper case: A-Z, 0-9 and dashes
  note          TEXT NOT NULL DEFAULT '',          -- for the team (who it is for); never shown to customers
  kind          TEXT NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value         INTEGER NOT NULL CHECK (value > 0),-- percent: 1 to 90; fixed: paise off
  plans         TEXT NOT NULL DEFAULT '[]',        -- JSON array of package ids; [] = every paid plan
  starts_at     TEXT,                              -- NULL: from now
  ends_at       TEXT,                              -- NULL: no end
  max_uses      INTEGER,                           -- NULL: no limit
  once_per_customer INTEGER NOT NULL DEFAULT 1 CHECK (once_per_customer IN (0, 1)),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by    TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_by    TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS coupons_code ON coupons (code);

-- A sale: lower prices for everyone, between two times. Shown on the pricing page.
CREATE TABLE IF NOT EXISTS promotions (
  id         TEXT PRIMARY KEY,                     -- 'prm_' + random
  name       TEXT NOT NULL,                        -- shown to customers: "Diwali sale"
  kind       TEXT NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value      INTEGER NOT NULL CHECK (value > 0),
  plans      TEXT NOT NULL DEFAULT '[]',
  starts_at  TEXT NOT NULL,
  ends_at    TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS promotions_live ON promotions (active, ends_at);

-- The discount on one order: the better of a coupon and a sale, never both.
CREATE TABLE IF NOT EXISTS order_discounts (
  order_id         TEXT PRIMARY KEY REFERENCES orders (id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  list_price_paise INTEGER NOT NULL,               -- the plan's price before the discount
  discount_paise   INTEGER NOT NULL CHECK (discount_paise > 0),
  source           TEXT NOT NULL CHECK (source IN ('coupon', 'promotion')),
  coupon_id        TEXT REFERENCES coupons (id) ON DELETE SET NULL,
  promotion_id     TEXT REFERENCES promotions (id) ON DELETE SET NULL,
  code             TEXT,                           -- the code as used, kept if the coupon is deleted
  label            TEXT NOT NULL,                  -- "Coupon DIWALI30" or "Diwali sale", for the invoice
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS order_discounts_coupon ON order_discounts (coupon_id, user_id);
CREATE INDEX IF NOT EXISTS order_discounts_promotion ON order_discounts (promotion_id);
