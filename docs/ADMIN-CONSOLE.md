# TypeCraft admin console

The new admin dashboard, built in six phases beside the current `/admin` pages. This file is the
map for whoever works on it next: what exists, how sign-in and permissions work, how to add a
module, and what has to happen before it replaces the current admin.

Status: **Phases 1 to 4 of 6 are built** (foundation; core operations; learning operations; business
growth). It lives at `/console`. The current `/admin` keeps working unchanged until
the cutover in §9. Work orders, endpoints and rules: `docs/ADMIN-PHASE-2.md`,
`docs/ADMIN-PHASE-3.md`, `docs/ADMIN-PHASE-4.md`.

| Phase | Contents | Status |
| --- | --- | --- |
| 1 | Audit, admin sign-in, roles and permissions, migrations, the four-layer frame | built |
| 2 | Core operations: dashboard, customers, payments, refunds, packages, subscriptions, learning access, the search box | built |
| 3 | Learning operations: courses, modules, levels, lessons, exercises, unlock conditions, progress, analytics | built (docs/ADMIN-PHASE-3.md, docs/UNLOCK-RULES.md) |
| 4 | Business growth: coupons, promotions, email campaigns, support, notifications, reports | built in three parts: 4a Support and Business reports, 4b Email campaigns and Notifications, 4c Coupons and Promotions (docs/ADMIN-PHASE-4.md) |
| 5 | Infrastructure: administrators, activity logs, system health, integrations, security, settings | not started |
| 6 | Optimisation, full test pass, cutover, delivery report | not started |

## 1. What the audit found (Phase 1)

The database is not empty and is never assumed to be. Live D1 has migrations 0001–0004 applied.

| Area | Tables that exist | Admin API that exists | Missing for the console |
| --- | --- | --- | --- |
| Accounts | `users`, `sessions`, `known_devices`, `email_tokens`, `password_reset_tokens` | `GET /api/admin/users`, `GET/POST /api/admin/users/:id` | filters, export, notes, sign-in history view |
| Plans and access | `packages`, `package_features`, `user_subscriptions` | `GET /api/admin/packages`, `PUT /api/admin/packages/:id`, grant/revoke through `POST /api/admin/users/:id` | creating a package, subscription list, access overrides per lesson |
| Money | `orders`, `payments`, `refunds`, `invoices`, `billing_archive`, `webhook_events` | `GET /api/admin/payments`, `POST /api/admin/payments/:id/refund`, `GET /api/admin/revenue` | refund list and reasons, reconciliation view, exports |
| Learning | `events`, `lesson_scores`, `user_totals`, `daily_totals`, `key_stats`, `badges`, `certificates`, `typing_tests` … | none | everything in Layer 2. The 78 lessons are JavaScript files (`shared/`, `js/course.js`), not database rows |
| Email and support | `email_logs`, `email_preferences`, `contact_messages` | `GET /api/admin/emails`, retry, announcements, `GET/POST /api/admin/contact` | campaigns, templates view, tickets with replies, notifications |
| Staff and audit | `admin_users`, `audit_logs`, `platform_settings` | `GET/PUT /api/admin/settings`, `GET /api/admin/audit`, role change through `POST /api/admin/users/:id` | administrators page, log filters, health, integrations, security |
| Growth | none | none | coupons, promotions (new tables) |

Other findings acted on in Phase 1:

- **Admin access had no permission layer.** Each handler listed the roles it accepted. Now every
  admin handler names one permission and a single engine decides (§4).
- **Admin used the learner session** (30 days when "remember me" is on, `SameSite=Lax`). The
  console has its own short session and stricter sign-in (§3).
- **Every static file went through the Worker** (`run_worker_first: true`), so each stylesheet,
  script and icon used one of the free plan's 100,000 daily Worker requests (the trainer loads
  about 25 files on a first visit). Public folders now skip the Worker (§8).

## 2. The four layers

The sidebar, the permission grid and the URL structure all follow these. The list lives in
`src/console/modules.js`; a module without a `path` is shown as a label with its phase, never as
a link.

1. **Core operations** (built): Dashboard, Customers, Payments, Refunds, Packages, Subscriptions, Learning access
2. **Learning operations** (built: docs/ADMIN-PHASE-3.md): Courses, Modules, Levels, Lessons, Exercises, Unlock conditions (docs/UNLOCK-RULES.md), Student progress, Learning analytics
3. **Business growth** (docs/ADMIN-PHASE-4.md): Coupons, Promotions, Email campaigns, Support, Notifications, Business reports (all built)
4. **Infrastructure**: Administrators, Roles and permissions (built), Activity logs, System health, Integrations, Security, Settings

## 3. Sign-in and sessions

One account system. An administrator is an ordinary TypeCraft account that has a role:

- **Super Admin** (`owner`): the emails in the `OWNER_EMAILS` secret, or `admin_users.role = 'owner'`.
- **Admin**, **Support**: a row in `admin_users`.

No admin password exists anywhere in the code or the configuration. Signing in at
`/console/login` (`src/console/auth.js`):

1. Email and password. Every failure gives the same answer, whether the email is unknown, the
   password is wrong, or the account has no role.
2. If email sending and `SESSION_SECRET` are set up: a 6-digit code is emailed to the account
   (`admin_otp` template) and must be entered within 10 minutes. Only an HMAC of the code is
   stored; it works once and five wrong tries burn it.
3. If they are not set up, sign-in is password only. The setup checklist on the console home
   says so. `ADMIN_EMAIL_CODE=off` forces password only (emergency switch if email is down);
   the account is then told about each sign-in by email when email works.

Limits: 5 wrong passwords per account and address in 15 minutes, 20 attempts per address,
10 wrong codes per account per hour, 10 wrong password confirmations in 15 minutes.

The console session (`admin_sessions`, `src/console/session.js`):

- its own cookie, `__Host-tc_admin`: `HttpOnly`, `Secure`, `SameSite=Strict`. Only the SHA-256 of
  the token is stored;
- ends after **30 minutes** without a request and after **8 hours** at the latest;
- ends at once when the account is disabled, loses its role, or changes its password;
- the role and its permissions are read from the database on every request. Nothing is cached
  in the session, so a change applies on the next click.

Sensitive permissions (`sensitive: true` in the catalogue: refunds, role permissions,
administrators) also need the password to have been confirmed in the last 10 minutes
(`POST /api/admin/auth/reauth`). The browser kit shows the dialog and retries by itself.

Audit entries: `admin.login`, `admin.login_failed`, `admin.logout`, `admin.reauth_failed`.
Passwords, codes and tokens are never logged.

Known limits, for the security review before launch:

- **An email in `OWNER_EMAILS` that has no account yet is an open door**: whoever signs up with
  it first is Super Admin (the rule is by email, and sign-up does not wait for the email to be
  confirmed). This is how the current admin has always worked. The Roles page shows a warning
  when it is the case; with emailed codes on, the console itself is safe from it because the
  code goes to the real inbox. Add an email to `OWNER_EMAILS` only after its account exists.
- Without emailed codes the password is the only factor, and it is the same password as the
  learner account. Set up email and `SESSION_SECRET` before relying on the console.
- Whoever controls an administrator's inbox can reset the password and read the code. Protect
  that inbox with two-step sign-in.

## 4. Permissions (the one access-control engine)

`src/console/permissions.js` holds the catalogue: one entry per permission with its layer,
module, label, description and the defaults for Admin and Support. Super Admin always has
everything. `role_permissions` stores only the switches a Super Admin changed from the default.

```js
import { requireAdmin, requirePermission, assertCan } from './console/session.js';

const who = await requireAdmin(env, request, 'payments.refund');     // console-only endpoints
const who = await requirePermission(env, request, 'customers.view'); // endpoints the current /admin also uses
await assertCan(env, who, 'customers.manage');                       // a second permission inside a handler
```

Rules that hold everywhere:

- **Every admin API checks for itself.** Hiding a link or a page is a courtesy; the handler is
  the protection.
- `ownerOnly` permissions (`roles.manage`, `admins.manage`) can never be given to another role,
  even by a row forced into the table.
- Unknown keys in `role_permissions` grant nothing. An unknown key in code throws (a
  programming mistake must not pass silently).
- Before migration 0005 exists, the defaults apply.

Defaults: Support can view the dashboard, customers, packages, payments, the email log and
customer messages, and can update messages. It cannot refund, manage administrators or roles,
or see or change settings. Admin runs daily operations but cannot refund or change settings
until a Super Admin switches that on, and can never manage roles or administrators.

`requirePermission()` also accepts the normal site sign-in of an account with a role, because
the current `/admin` pages still use it. That second way is removed at cutover (§9).

## 5. Pages

`src/site.js` hands every address at or below `CONSOLE_BASE` (`/console`) to
`src/console/router.js`:

- `/console/login` is public. Everything else needs a console session, otherwise the browser is
  sent to the sign-in page with a checked `next` address (console addresses only).
- A page whose permission the role lacks returns a 403 page inside the frame.
- Headers on every console page: `Cache-Control: private, no-store`, `X-Robots-Tag: noindex,
  nofollow`, `X-Frame-Options: DENY`, and a Content-Security-Policy with `default-src 'none'`,
  scripts and styles from this site only, **no inline scripts or styles**.
- The console is not listed in `robots.txt` (listing it would advertise it).

Files: `src/console/shell.js` (frame and sign-in HTML), `src/console/pages.js` and
`src/console/pages-core.js` (each page's frame; `src/console/page-kit.js` builds list pages and
record pages), `site/console/` (`console.css`, `console.js` the shared kit, `charts.js`,
`plan-actions.js`, `access-actions.js`, one script per page). Bump `CONSOLE_ASSETS` in
`shell.js` whenever a file in `site/console/` changes. A page with an id in its address has
`match` and `names`; an exact address wins over one with an id (`/packages/new`).

## 6. Adding a module (Phases 2–5)

1. **Permissions**: add them to `PERMISSIONS` in `src/console/permissions.js` with sensible
   defaults. They appear in the grid by themselves.
2. **API**: a file in `src/console/` exporting `ROUTES` / `PATTERNS`; merge it in
   `src/console/index.js`. Every handler starts with `requireAdmin(env, request, '<permission>')`.
   Lists are paginated (`?page`, 25 a page), filtered in SQL, and return only the columns the
   page shows. Write actions call `audit()`.
3. **Page**: an entry in `src/console/pages.js` (frame with loading rows) and its script in
   `site/console/`. Give the module its `path` and `permission` in `src/console/modules.js`.
4. **Data**: the page's script asks only for that module's data, when the page opens. No page
   loads another module's data "in case".
5. **Tests**: a `tests/console-*.test.mjs` file on its own port, using `tests/console-kit.mjs`:
   who is refused, who is allowed, what is audited, what a wrong input answers.
6. **Migration**, if the module needs tables: a new numbered file, `CREATE … IF NOT EXISTS` and
   `ALTER TABLE … ADD COLUMN` only. Never `DROP`, never rewrite a table in place.

The browser kit (`window.AC`): `AC.api(method, path, body)` (sends to sign-in when the session
ended, asks for the password when the server wants it confirmed), `AC.el`, `AC.icon`,
`AC.toast`, `AC.confirm`, `AC.formDialog`, `AC.fmt` (India time), `AC.money`, `AC.status`,
`AC.can(permission)`, `AC.listPage` (filters kept in the address, pager), `AC.record`,
`AC.download` (CSV through the password check), `AC.charts`. Data is placed as text, never as
HTML.

Rules every Phase 2 module follows: Admin and Support never change their own plan, access or
payments (a Super Admin may); a reason is required for changes to a customer; money moves only
through `src/billing.js`, and only what Razorpay confirms counts as paid.

## 7. Migrations

- `0011_coupons.sql` (Phase 4c): `coupons`, `promotions`, `order_discounts`. Three new tables, no row
  changes, safe to run twice. Before it is applied, prices are the plans' own, codes are refused politely
  at checkout, and the Coupons and Promotions pages answer "not switched on yet" (503).
  Go-live steps: `docs/ADMIN-PHASE-4.md` §6 and `docs/LAUNCH.md` §1i.
- `0010_campaigns.sql` (Phase 4b): `email_campaigns`, `campaign_sends`, `site_notices`. Three new tables,
  no row changes, safe to run twice. Before it is applied, the campaign and notification pages answer
  "not switched on yet" (503), learners see no notices, and the old Announcement works the old way.
  Go-live steps: `docs/ADMIN-PHASE-4.md` §6 and `docs/LAUNCH.md` §1h.
- `0009_support.sql` (Phase 4a): `support_replies`, `support_assignments`. Two new tables, no row
  changes, safe to run twice. Before it is applied, the Support pages answer "not switched on yet"
  (503); Business reports need no new table. Go-live steps: `docs/ADMIN-PHASE-4.md` §4 and
  `docs/LAUNCH.md` §1g.
- `0007_course.sql` (Phase 3): `course_drafts`, `course_releases`. Two new tables, no row
  changes, safe to run twice. Before it is applied, the course pages answer "not switched on yet"
  (503) and learners get the course exactly as it is in the code. Go-live steps:
  `docs/ADMIN-PHASE-3.md` §5 and `docs/LAUNCH.md` §1e.
- `0006_admin_core.sql` (Phase 2): `customer_notes`, `access_overrides`, `refund_choices`, and three
  indexes on existing tables. Additive only, safe to run twice. Before it is applied, the customer pages and the
  other parts that need it answer "not switched on yet" (503), lists still work, and nothing
  changes for customers. Go-live steps: `docs/ADMIN-PHASE-2.md` §4 and `docs/LAUNCH.md` §1c.
- `0005_admin_console.sql`: `admin_sessions`, `role_permissions`. Additive only.
- Apply to live D1 **before or right after** the Phase 1 merge. Until then `/console/login`
  says the console isn't switched on, and the rest of the site is unaffected (tested).
- Take a D1 bookmark first, as for 0002–0004, and note it in `docs/LAUNCH.md`.
- A nightly job removes console sign-ins older than 30 days.

## 8. Static files and the free plan

`wrangler.jsonc` now has `"run_worker_first": ["/*", "!/css/*", "!/js/*", "!/shared/*",
"!/icons/*", "!/site/*", "!/manifest.webmanifest"]`. Pages, `/api` and every `.html` file still
reach the Worker first; the listed folders hold only public files and are served by Cloudflare
directly, which does not count as a Worker request. The list fails closed: a new top-level
file or folder stays behind the Worker until someone adds it.

`_headers` adds `X-Robots-Tag: noindex` for those files on the `workers.dev` address (the
Worker used to add it).

After the first deploy with this change, check that the build on `main` is green and that
`/css/app.css` loads. If the build rejects the setting, put back `"run_worker_first": true`;
nothing else depends on it.

## 9. Cutover (when the console replaces `/admin`)

Not before Phases 2–5 cover everything the current admin does.

1. `CONSOLE_BASE` in `src/console/config.js` becomes `/admin`; remove the admin pages from
   `src/pages/admin/`, `site/js/admin-*.js` and the registry in `src/site.js`.
2. `requirePermission()` loses its site-sign-in path; every admin endpoint then needs a console
   session.
3. `sw.js`: the `/console` exclusion can go (`/admin` is already excluded); keep `/site/console/`.
4. Re-run the security review, then the delivery report (A–H).

## 10. Settings that affect the console

All are secrets or variables on the `typecraft` Worker in Cloudflare; none are in the repo.

| Setting | Effect |
| --- | --- |
| `OWNER_EMAILS` | who is Super Admin |
| `SESSION_SECRET` (16+ characters; use 40+) | needed for emailed sign-in codes |
| `RESEND_API_KEY`, or `SMTP_USER` + `SMTP_PASS` once `src/smtp.js` is merged | sending email |
| `ADMIN_EMAIL_CODE=off` | emergency switch: admin sign-in without the emailed code |

## 11. Tests

`node --test tests/console.test.mjs` (sign-in, codes, limits, sessions, the grid and its effect
on the older admin APIs, page headers, redirects, the not-yet-migrated state, static routing).
Phase 2: `tests/console-core.test.mjs` (customers), `console-payments` (payments, refunds,
with the fake Razorpay in `tests/fake-razorpay.mjs`), `console-plans` (subscriptions, learning
access, packages), `console-overview` (dashboard, search); `tests/app-plan.test.mjs` covers
what learning access changes for customers.
Unlock conditions: `tests/unlock-rules.test.mjs` (docs/UNLOCK-RULES.md §7).
Phase 3: `tests/console-course.test.mjs` (course edits, drafts, publishing, versions, practice
packs), `console-progress` (student progress), `console-analytics` (learning analytics).
The other test files still pass unchanged apart from two expectations that follow the new
defaults (an Admin cannot change settings or refund until allowed).
