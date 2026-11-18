# Admin console, Phase 2: Core operations

The work order for Phase 2. It is written so that a new session (or Claude in a terminal)
can continue from here without the earlier conversation. Read `docs/ADMIN-CONSOLE.md` first:
this file assumes it.

Branch: `admin/phase-2`. One pull request to `main` at the end. Nothing is merged, and
nothing is applied to the live database, without the owner's yes.

## Status

| Step | What | Status |
| --- | --- | --- |
| 0 | Plan, migration 0006, pages with an id in the address, shared kit | built |
| 1 | Customers | built |
| 2 | Payments | built |
| 3 | Refunds | not started |
| 4 | Subscriptions | not started |
| 5 | Learning access | not started |
| 6 | Packages | not started |
| 7 | Dashboard | not started |
| 8 | Search box | not started |
| 9 | Full check, docs, pull request | not started |

Update this table in the same commit as each step.

## 1. Decisions the owner has made

- Plain JavaScript, as in Phase 1. No React, no build step.
- A search box above the sidebar (step 8).
- Build order: Customers, Payments, Refunds, Subscriptions, Learning access, Packages, then
  Dashboard (it reads from all the others), then Search.
- The owner looks at the Customers screen before its style is repeated on the others.
- The current `/admin` keeps working until the console replaces it (Phase 6).

Still open (not blocking Phase 2): Razorpay Test Mode keys (real refund and re-check tests
wait for them; until then the tests use the fake Razorpay in `tests/billing.test.mjs`), and
email sending plus `SESSION_SECRET` (no emails to customers until then).

## 2. Rules that hold for every step

1. Never push to `main`. Never merge without the owner's yes.
2. Never change live data or run a migration on the live database without the owner's yes
   and a restore bookmark taken first.
3. Never print, log, commit or ask for a secret (password, key, token, emailed code).
4. Paid access is only ever granted from a result Razorpay itself confirms, never from what
   a browser says.
5. No real-money tests.
6. Every admin API checks the session and the permission itself (`requireAdmin`). A hidden
   button is not protection.
7. Real numbers only. No sample data, no decorative controls: every control works.
8. Keep the customer site and the current `/admin` working. Customer-facing files change
   only where this plan says so (step 5, and two small extractions in `src/billing.js`).
9. Migrations only add. Code on the customer or webhook path that reads a Phase 2 table
   must tolerate that table not existing yet.
10. Say plainly what is not done. Do not call it production-ready while something critical
    is missing.

## 3. Conventions

**API.** New endpoints live under `/api/console/…` in one file per module in `src/console/`,
merged in `src/console/index.js`. The Phase 1 endpoints stay at `/api/admin/…`; the older
`/api/admin/*` endpoints of the current admin are left alone.

- Every handler starts with `requireAdmin(env, request, '<permission>')`.
- Lists: `?page=` (25 a page), filters and search done in SQL, one `DB.batch` per request,
  answer `{ items, page, pageSize, pages, total }`. Only the columns the page shows.
- Writes: validate, change, `audit()` with before and after (or the reason), answer with the
  new state. A reason is required wherever this plan says so (3 to 300 characters).
- Days are India days (UTC+5:30): `src/console/lib.js` has the helpers.
- CSV downloads: `csvResponse()` in `src/console/lib.js` (BOM, every cell quoted, cells that
  start with `= + - @` get a leading apostrophe, at most 5,000 rows, audited).
- Before migration 0006 is applied, console endpoints answer 503 `console_not_ready`.

**Pages.** `src/console/pages.js` holds each page's frame; a page with an id in its address
has `match` (a regular expression) and receives `params`. Its `key` is the module's key, so
the sidebar highlights the module. Each page's script in `site/console/` asks only for that
module's data. Bump `CONSOLE_ASSETS` in `shell.js` when a file in `site/console/` changes.

**Browser kit** (`site/console/console.js`, `window.AC`), added in Phase 2:
`AC.list()` (filters, search, pager, address-bar sync), `AC.formDialog()` (a dialog with
fields that stays open until the server accepts), `AC.download()` (CSV through the password
check), `AC.money()`, `AC.badge()`, `AC.fmt.date()`. No inline styles in HTML (the console's
Content-Security-Policy refuses them); set sizes from script with `node.style.x = …` or use
SVG attributes.

**Permissions** are added to `src/console/permissions.js` in the step that first uses them,
and the two counts in `tests/console.test.mjs` are updated in the same commit.

**Tests**: one file per group of modules, each with its own port: `console-core` (customers,
8794), `console-payments` (payments and refunds, 8795, with the fake Razorpay in
`tests/fake-razorpay.mjs`), `console-plans` (subscriptions, learning access, packages, 8796),
`console-overview` (dashboard and search, 8798). `tests/console-kit.mjs` holds what they
share. Every step: who is refused, who is allowed, what is audited, what a wrong input
answers. All test files and `node tests/check-lessons.mjs` pass before each commit.

**Frames.** `src/console/page-kit.js` has `listFrame()` and `recordFrame()`; their ids are
the ones `AC.listPage()` and `AC.record()` look for. The Phase 2 pages are in
`src/console/pages-core.js`.

## 4. Database: `migrations/0006_admin_core.sql`

Adds only (every statement is `CREATE … IF NOT EXISTS`, so it is safe to run twice):

- `customer_notes`: staff notes on a customer (step 1).
- `access_overrides`: a lesson or game unlocked or locked for one customer (step 5).
- `refund_choices`: what a refund should do to the plan, keyed by the Razorpay refund id
  (step 3). A separate table so that the existing refund and webhook code is not changed.
- Indexes: `users (created_at)`, `refunds (created_at)`.

Going live: take a bookmark in the D1 console (`/bookmark`), paste the file without its
comments, check with `SELECT name FROM sqlite_master`. The live database has had every
migration applied by hand and has no `d1_migrations` table, so **never** run
`wrangler d1 migrations apply` (it would re-run 0001 to 0005). To use wrangler, run only
`wrangler d1 execute typecraft --remote --file=migrations/0006_admin_core.sql`.

## 5. Step 1: Customers (built)

Pages: `/console/customers` and `/console/customers/:id`.

| Method and path | Permission | What |
| --- | --- | --- |
| `GET /api/console/customers` | `customers.view` | List. `q` (name, email, phone), `plan` (`free`, `paid` or a package id), `status`, `verified`, `joined` (`today`, `7d`, `30d`), `sort`, `page` |
| `GET /api/console/customers/export.csv` | `customers.export` (password check) | The same filters as a spreadsheet |
| `GET /api/console/customers/:id` | `customers.view` | Profile. Sections appear only with their permission: payments (`payments.view`), emails (`emails.view`), admin activity (`audit.view`) |
| `POST /api/console/customers/:id/status` | `customers.manage` | `{ status, reason }`. Disable or restore |
| `POST /api/console/customers/:id/sign-out` | `customers.manage` | End every site session of the customer |
| `POST /api/console/customers/:id/notes` | `customers.notes` | `{ body }` up to 2,000 characters |
| `DELETE /api/console/notes/:id` | `customers.notes` | Only the author or a Super Admin |

Rules: nobody changes their own status; a Super Admin account cannot be disabled; only a
Super Admin can disable or sign out another staff account; disabling ends the customer's
sessions. "Current plan" is the active, unexpired subscription whose package has the highest
`display_order`; none means Free. Not here on purpose: editing a customer's email or
password, signing in as a customer, changing staff roles (Phase 5).

## 6. Step 2: Payments (built)

Pages: `/console/payments` (one row per order) and `/console/payments/:orderId`.

| Method and path | Permission | What |
| --- | --- | --- |
| `GET /api/console/payments` | `payments.view` | `q` (order id, Razorpay ids, invoice number, email), `status` (`paid`, `pending`, `failed`, `refunded`, `cancelled`), `package`, `from`, `to`, `page` |
| `GET /api/console/payments/export.csv` | `payments.export` (new, password check) | Same filters |
| `GET /api/console/payments/:orderId` | `payments.view` | Order, every payment attempt, refunds, invoice, the subscription it created |
| `POST /api/console/payments/:orderId/recheck` | `payments.recheck` (new, on for Admin and Support) | Ask Razorpay for the truth about an order that is not paid |

Search matches an email or name in part, and an ID only whole (ours, Razorpay's order,
payment or refund ID, an invoice number, a customer ID), so the unique indexes answer.
The Status filter's `pending` means `created`, `attempted` or `pending`; `refunded` includes
part refunds.

Re-check: the per-order body of `reconcile()` in `src/billing.js` is now the exported
`reconcileOrder(env, ctx, order)`, called from both places; the scheduled job does what it
did. Any order that is not paid can be checked, also a failed or cancelled one (a later
attempt on the same Razorpay order may have gone through). Once per order per 30 seconds.
Never marks anything paid unless Razorpay reports a captured payment of the same amount.
503 `payments_unavailable` without Razorpay keys. Audit `payment.recheck` with before and
after. Customer names link to the customer page and the customer page's payments link here.

## 7. Step 3: Refunds

Page: `/console/refunds`; the refund dialog opens from a payment page.

| Method and path | Permission | What |
| --- | --- | --- |
| `GET /api/console/refunds` | `refunds.view` (new) | `status`, `from`, `to`, `page` |
| `POST /api/console/refunds` | `payments.refund` (password check) | `{ paymentId, amountPaise or null, reason, planAction }` |
| `POST /api/console/refunds/:id/recheck` | `payments.recheck` | Ask Razorpay about a pending refund (add `fetchRefund` to `src/razorpay.js`) |

- Uses `refund()` in `src/billing.js`, extended with an optional `planAction`
  (`auto`, `keep`, `end`). When it is not `auto`, a `refund_choices` row is written after
  Razorpay returns the refund id and before `settleRefund()` runs. `applyRefunds()` reads the
  choice of the latest processed refund through a query that tolerates a missing table:
  `keep` never ends the plan, `end` always does, `auto` ends it only on a full refund (as
  today). A plan already ended is not restored by a later `keep`.
- At most one refund request per payment per 10 seconds (429), so a double click cannot send
  two partial refunds.
- Reason: a preset (duplicate payment, customer request, technical problem, unauthorised,
  other) plus free text, stored together in `refunds.reason`.
- The dialog shows the customer, the amount still refundable and what happens to the plan.

## 8. Step 4: Subscriptions

Page: `/console/subscriptions`; the same actions on the customer page.

| Method and path | Permission | What |
| --- | --- | --- |
| `GET /api/console/subscriptions` | `subscriptions.view` (new) | `state` (`active`, `ending` = within 7 days, `expired`, `revoked`), `package`, `source`, `q`, `page` |
| `POST /api/console/customers/:id/subscriptions` | `subscriptions.manage` | Grant: `{ packageId, days or null, reason }` |
| `POST /api/console/subscriptions/:id/extend` | `subscriptions.manage` | `{ days 1–365, reason }`; clears `reminded_at` |
| `POST /api/console/subscriptions/:id/revoke` | `subscriptions.manage` | `{ reason }`; the dialog says it does not refund |
| `POST /api/console/subscriptions/extend-all` | `subscriptions.bulk` (new, off for Admin and Support, password check) | `{ days 1–30, reason }` for every active plan with an end date |

Only an active, unexpired plan can be extended; a lifetime plan cannot. Dates stay in the
exact `toISOString()` format (they are compared as text): in SQL use
`strftime('%Y-%m-%dT%H:%M:%fZ', expires_at, '+N days')`. No email is sent yet; the dialogs
say so. Rename the `subscriptions.manage` label to "Grant, extend and end plans".

## 9. Step 5: Learning access

Page: `/console/access`; the same actions on the customer page.

| Method and path | Permission | What |
| --- | --- | --- |
| `GET /api/console/access` | `access.view` (new) | `state` (`active`, `ended`), `q`, `page` |
| `POST /api/console/customers/:id/access` | `access.manage` (new) | `{ kind: lesson or game, target, effect: allow or deny, days or null, reason }` |
| `POST /api/console/access/:id/end` | `access.manage` | End an exception |

- Targets: the 78 lesson ids in `shared/course-meta.js`, and the eight games in
  `shared/rewards-rules.js` (`daily` stays open for everyone). At most 50 active per customer.
- **Customer-facing change, the only one in Phase 2.** `entitlementsFor()` in
  `src/entitlements.js` adds `overrides: { lessons: { allow, deny }, games: { allow, deny } }`
  from a separate query that tolerates a missing table. `lessonAllowed()` and `gameAllowed()`
  check deny, then allow, then the plan; `placement`, `review` and `daily` are never locked.
  The same three lines go into `Plan.lessonAllowed` and `Plan.gameAllowed` in `js/app.js`,
  with a lock message for a denied lesson that does not talk about plans. Bump `VERSION` in
  `sw.js`. Add cases to `tests/app-plan.test.mjs`.

## 10. Step 6: Packages

Pages: `/console/packages`, `/console/packages/new`, `/console/packages/:id`.

| Method and path | Permission | What |
| --- | --- | --- |
| `GET /api/console/packages` | `packages.view` | Every package with active subscribers and sales in the last 30 days |
| `POST /api/console/packages` | `packages.manage` | Create (id: lower-case letters, digits, hyphens) |
| `PUT /api/console/packages/:id` | `packages.manage` | Update |

Share the validation with `putPackage` in `src/admin-api.js` (move it into one function).
No delete: a package goes off sale. Free stays ₹0, without an end date and on. Only one
package is highlighted. A price change touches new purchases only (subscriptions keep a copy
of features and limits); changing Free changes what every free user gets at once, and the
dialog says so. Confirm when a price changes by more than half. Audit with before and after.

## 11. Step 7: Dashboard

Page: `/console/dashboard`. `GET /api/console/dashboard?range=today|7d|30d`
(`dashboard.view`), one `DB.batch`.

- Customers: new in the range, total, active learners. Plans: active per package, ending in
  7 days. Payments: paid, failed, pending. Money (gross, refunds, net) only with
  `revenue.view`. The previous period beside each figure.
- Needs attention, each a link to a filtered page: orders pending over 15 minutes, pending
  or failed refunds, failed emails, new messages, setup items that are off.
- Chart of daily net revenue and sign-ups for 7 and 30 days: drawn as SVG by the page's
  script, with a table for screen readers. No chart library.
- A Refresh button. No automatic polling.
- The Home page notice (what is ready here, what is still in `/admin`) is read from
  `src/console/modules.js`: giving a module a `path` is all it needs.

## 12. Step 8: Search box

`GET /api/console/search?q=` (2 to 80 characters): customers (with `customers.view`, up to
5) and payments by exact or starting id (with `payments.view`, up to 5). Page names are
matched in the browser from the sidebar. 60 searches a minute per session. The search text
is not logged.

A field above Home in the sidebar, opened with Ctrl+K or Cmd+K, built as a combobox with a
listbox (arrow keys, Enter, Escape), 250 ms pause before asking, older answers ignored.

## 13. Step 9: Finish

- All test files pass; a browser walk-through on desktop and phone, in both themes, with no
  script errors and no Content-Security-Policy violations.
- `docs/ADMIN-CONSOLE.md` updated (phase table, new modules), `docs/LAUNCH.md` gets the
  0006 bookmark line.
- Pull request with: what is built, what changed for customers (step 5), what is not done,
  and the go-live steps of section 4.
