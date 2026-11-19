# Admin console, Phase 6: cutover and delivery report

Phase 6 makes the console the only admin. It moves to `/admin`, the old admin pages and their
API are removed, and a site sign-in no longer opens any admin endpoint. This file is the delivery
report for the whole console (sections A–H). The map for whoever works on it next is
`docs/ADMIN-CONSOLE.md`.

## A. What was built (Phases 1–6)

| Layer | Modules |
| --- | --- |
| Core operations | Dashboard, Customers, Payments, Refunds, Packages, Subscriptions, Learning access, Institutes |
| Learning operations | Courses, Modules, Levels, Lessons, Exercises, Unlock conditions, Student progress, Learning analytics |
| Business growth | Coupons, Promotions, Email campaigns (with the email log and templates), Support, Notifications, Business reports |
| Infrastructure | Administrators, Roles and permissions, Activity logs, System health, Integrations, Security, Settings |

Underneath:

- **Sign-in.** A separate admin sign-in at `/admin/login`: email and password, then a 6-digit
  code by email once email and `SESSION_SECRET` are set up. The admin session uses its own cookie
  (`__Host-tc_admin`, SameSite=Strict). It ends after 30 idle minutes or 8 hours, whichever comes
  first, and at once when the account loses its role or changes its password.
- **Permissions.** One permission engine with 52 permissions. Super Admin has all of them; Admin
  and Support have defaults that a Super Admin can switch per role. Refunds, roles and
  administrators also need the password confirmed in the last 10 minutes.
- **Audit and reports.** Every admin change is written to the activity log. Lists can be
  downloaded as CSV.
- **Database.** Migrations 0005–0017, all additive. Each page answers "not switched on yet"
  until its table exists.

Phases 2–5 have their own write-ups, which list every endpoint: `docs/ADMIN-PHASE-2.md` to
`docs/ADMIN-PHASE-5.md` and `docs/UNLOCK-RULES.md`.

## B. What the cutover changed

| Change | Where |
| --- | --- |
| The console lives at `/admin` | `CONSOLE_BASE` in `src/console/config.js` |
| `/console/…` → 301 to the same page under `/admin`, query kept; `/admin.html` → 301 to `/admin` | `src/site.js` |
| Old admin pages removed (overview, users, packages, payments, revenue, settings, emails) | `src/pages/admin.js`, `src/pages/admin/`, `site/js/admin-*.js`, `admin.html` |
| Old admin API removed (`/api/admin/overview`, `users`, `packages`, `payments`, `revenue`, `settings`, `audit`, `health`, `emails`, `announcements`, `contact`) | `src/admin-api.js`, the old handlers in `src/mail.js`, `GET /api/admin/health` in `src/index.js` |
| `requirePermission()` (which also accepted a site sign-in) removed; `requireAdmin()` is the only gate | `src/console/session.js` |
| Old admin registry, layout and navigation removed; the user menu's "Admin" link goes to `/admin` | `src/site.js`, `src/layout.js` |
| Links in job-failure emails, the dashboard's to-do list and institute invoices point at `/admin/…` | `src/jobs.js`, `src/console/dashboard-api.js`, `site/js/institute-invoice.js` |
| `robots.txt` no longer names `/admin` (listing it would advertise it; every console page sends `noindex`) | `src/site.js` |
| Asset versions bumped: `ASSET_VERSION` 13, `CONSOLE_ASSETS` 27 | `src/layout.js`, `src/console/shell.js` |

`sw.js` is unchanged on purpose. It already skips `/admin`, `/console` and `/site/console/`, and
changing its `VERSION` would show every learner an "Update ready" prompt for nothing of theirs.

What learners see does not change. The only change on a learner page is that the user menu's
"Admin" link, shown to staff only, now opens the console.

## C. Security review (re-run for the cutover)

| Check | Result |
| --- | --- |
| Every admin API checks for itself | **Pass.** `tests/admin-cutover.test.mjs` reads every `/api/admin/*` and `/api/console/*` route from the source (228 of them, sign-in steps excluded) and calls each one as a visitor, as a learner, and as the Super Admin signed in to the site only. Every call is refused (401 or 404), and none hands out an admin cookie. A new route is covered automatically. |
| Site sign-in no longer opens admin pages | **Pass.** The Super Admin signed in to the site only is sent to `/admin/login`, as is a visitor (tested). |
| No route hiding as protection | **Pass.** Hidden links are a courtesy. Every handler starts with `requireAdmin(env, request, '<permission>')`. |
| Redirects cannot be used to leave the site | **Pass.** `/console/…` redirects only to a path on this site. `?next=` after sign-in accepts console addresses only (`safeConsoleNext`: no `//`, no `..`, no other site). |
| An address that only starts with "admin" is not the admin | **Pass.** `/adminx` and `/admin.html` are not console addresses. `/consoles` is a 404 (tested). |
| Cross-site writes | **Pass.** Every non-GET API call must be JSON (415 otherwise) from this site's origin (403 otherwise). Webhooks are the only exception and check their own signatures. The admin cookie is SameSite=Strict. |
| Page headers | **Pass.** `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: DENY`, a CSP with `default-src 'none'`, and no inline script or style (tested in `tests/console.test.mjs`). |
| Secrets | **Pass.** A scan of the repo for Razorpay, Resend, private-key and live-key patterns finds nothing. Secrets are only read from Cloudflare settings. No admin password exists anywhere. |
| Logging | **Pass.** Passwords, codes, tokens and payment secrets are never logged or shown. The sign-in code is stored only as an HMAC. |
| Payments | **Pass.** Paid access comes only from the Razorpay webhook or a server-side check of the payment's signature, never from the browser's "success". Refunds need `payments.refund` plus a fresh password. |
| Sign-in limits | **Pass.** 5 wrong passwords per account and address in 15 minutes, 20 attempts per address, 10 wrong codes per hour. |

The known limits from `docs/ADMIN-CONSOLE.md` §3 still hold and are repeated in G.

## D. Tests

The full suite has **362 tests in 35 files, all passing**: `node --test tests/*.test.mjs`, or one
file at a time as in CI. For Phase 6:

- New: `tests/admin-cutover.test.mjs`. It walks every admin route as described in C, checks that
  the old files and API are gone, and checks the `/console` and `/admin.html` redirects, the
  console's `/admin` links, the user menu link and the job email link.
- Changed: the tests that used the old admin API now use the console's. Billing refunds go
  through `/api/console/refunds`; learning health comes from `/api/console/health`. Every test
  that opened console pages at `/console/…` now uses `/admin/…`.
- Removed: the tests of the old admin pages, announcements and `/api/admin/health`. What they
  covered is tested in the console's own files (`console-*.test.mjs`).

## E. Optimisation and clean-up

- In the code (`src/`, `site/`), 1,810 lines removed and 48 added; the rest of the change is tests
  and documentation.
- Dead code removed after the old admin went:
  - `checkBody` in `src/settings.js`;
  - `storedPackageView` in `src/package-view.js`;
  - `K.role` in `site/js/pages-kit.js`;
  - the old email, announcement and contact handlers and their helpers in `src/mail.js`;
  - the old admin layout and navigation in `src/layout.js`.
- `src/admin.js` keeps only `isOwner` and `healthNumbers`. System health uses `healthNumbers`.
- The console home no longer shows the "the old /admin still works" notice.
- No new tables and no new background work. The free-plan budget from `docs/ADMIN-PHASE-5.md`
  §3 is unchanged.

## F. Go-live steps

Full checklist: `docs/LAUNCH.md` §1p. In short:

1. **[Claude, after your OK]** Apply the waiting migrations 0009–0017 to live D1, one statement at
   a time in the D1 console, after a restore bookmark. Without 0014 there is no admin page that
   lists contact messages (they still arrive by email). Without 0015 there are no email campaigns.
2. **[You]** Merge the Phase 6 pull request.
3. **[You]** Open `typecrafttyping.in/admin` and sign in with the console sign-in. Update your
   bookmark. Old `/console` links keep working.
4. Recommended before relying on it: set up email and `SESSION_SECRET` so that the emailed
   sign-in code is on (G).

There is no database change in this pull request and nothing to set in Cloudflare.

## G. Known limits

- **An email in `OWNER_EMAILS` with no account yet is an open door.** Whoever signs up with it
  first becomes Super Admin. Add an email there only after its account exists. The Roles page
  warns when this is the case.
- Until email and `SESSION_SECRET` are set up, the password is the only factor, and it is the same
  password as the learner account.
- Whoever controls an administrator's inbox can reset the password and read the code. Protect
  those inboxes with two-step sign-in.
- Lesson texts are public JavaScript (`docs/LAUNCH.md` §3), so locked lessons can be read by a
  technical user. The server enforces saving, premium packs, analytics and certificates.
- System health shows only what the Worker can see. There are no usage numbers from Cloudflare's
  API, by decision (`docs/ADMIN-PHASE-5.md`).
- This is not "production-ready" until the waiting live migrations (0009–0017) are applied and
  Razorpay has been tested end to end in test mode on the live domain.

## H. What's next

- Apply migrations 0009–0017 to live (step F1), then run one test-mode purchase and one refund
  on the live domain.
- Turn on the emailed sign-in code (email plus `SESSION_SECRET`).
- With the next learner-facing release, drop the `/console` line from `sw.js` (harmless until then).
- The public exam pages and guides (build-sequence step 3) come in their own pull request.
