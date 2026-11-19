# Admin console, Phase 5: Infrastructure

Phase 5 builds the console's fourth layer, in two pull requests:

- **5a** (this part): Settings, Integrations, System health, the background-job record with failure
  emails, email template previews, and smaller batches for Workers Free.
- **5b**: Administrators, Activity logs, Security, and the nightly retention clean-up.

Decisions behind it (November 2026):

- TypeCraft stays on **Workers Free** until there is cash flow or traffic. Everything below works on
  the free plan; moving to Workers Paid needs one variable (§3).
- No Cloudflare API token and no usage numbers from Cloudflare's API: System health reads only what
  the Worker itself can see.
- No separate backup system: D1's restore points (7 days on Free, 30 on Paid) plus a bookmark before
  every database update. The job record and its emails make sure a problem is noticed well inside
  those 7 days.
- Administrators are existing TypeCraft accounts only (5b).
- IP addresses in the activity and security logs are kept 90 days; email records 1 year (5b).

## 1. Settings (`/console/settings`)

Business details (printed on every new invoice and on the legal pages), the support contact (reply-to
of every email, shown on the contact page), and two switches:

- **Payments** on or paused. Paused: checkout answers "Payments are not available right now", nobody
  is charged, plans already bought keep working.
- **Sign-ups** open or closed. Closed: `POST /api/auth/signup` answers 403 `signups_closed` with
  "New accounts can't be created right now. If you already have an account, sign in." Everyone with an
  account still signs in. This switch existed in the old `/admin` but nothing enforced it; it does now.

There is no "test mode" switch any more. It never did anything: test or live always followed the
Razorpay key installed in Cloudflare (`rzp_test_…` or `rzp_live_…`). The page shows which one is
installed. An old stored `testMode` value is dropped the next time payments are saved.

Each section is saved on its own (`PUT /api/console/settings/:section`, the whole section each time),
checked field by field, and recorded in the activity log as `settings.update` with what changed from
what. Saving the same values again changes nothing and logs nothing.

| Permission | Who by default |
| --- | --- |
| `settings.view` | Super Admin, Admin |
| `settings.manage` (asks for the password again) | Super Admin only; can be given to Admin |

Checking and saving are shared with the old `/admin/settings` page (`src/settings.js`), so both always
agree. The campaign daily limit is shown here and changed under Email campaigns (Super Admin).

## 2. Integrations (`/console/integrations`)

One card per outside service: Razorpay, Resend, the emailed codes (`SESSION_SECRET`), Cloudflare (plan
and restore points), Cloudflare Web Analytics, Google Fonts and Google Search Console. Each says what
the service does for TypeCraft, whether it is set up, the last time it was used where the Worker can
tell, and what to do when something is missing. **Secret values are never read out**, only whether
each is installed (tested).

Web Analytics and Search Console can't be checked from inside the Worker, and the cards say so.

The Home page's Setup checklist gains **Email delivery reports** (`RESEND_WEBHOOK_SECRET`). Without it
the email log can't tell delivered from bounced, and someone who marks an email as spam keeps getting
announcements. To set it up: in Resend, Webhooks, add `https://typecrafttyping.in/api/webhooks/resend`
with the delivered, bounced and complained events, then add its signing secret in Cloudflare as
`RESEND_WEBHOOK_SECRET`.

Permission `integrations.view`: Super Admin and Admin.

## 3. Background jobs: the record, the alerts, and Workers Free

The Worker has two cron runs: every 10 minutes, and nightly at 02:47 India time. Each run is now made of
named parts (clean-up, payments, email, institute reminders, institute payments, institute Monday email,
console campaigns and old sign-ins; nightly also learner totals and the record's own clean-up). Each
part runs on its own, so one failing never stops the next, as before.

**The record** (`job_runs`, migration 0017): one row per run with each part's result, how long it took,
and whether it finished. A row that never gets a finish time was stopped part-way (on Workers Free the
usual cause is the 10 ms processor-time limit). Rows older than 30 days are removed nightly.

**Alerts**: when a part fails, every Super Admin (the `OWNER_EMAILS` accounts) gets the `system_alert`
email with the failed parts and a link to System health. At most one per schedule every 6 hours. Email
must be set up for alerts to go out; the failure is recorded either way.

**Batch sizes** (`src/limits.js`). On Workers Free one run may make 50 outside calls (Razorpay and
Resend). The 10-minute run shares them:

| Each 10-minute run handles at most | Workers Free | Workers Paid |
| --- | --- | --- |
| Payments checked with Razorpay | 6 | 25 |
| Institute payments checked | 4 | 25 |
| Institute invoices made | 4 | 25 |
| Failed emails tried again | 6 | 50 |
| Announcement emails | 10 | 100 |
| Campaign emails | 10 | 40 |

That is 40 calls at most, leaving room for alerts and receipts. Nothing is lost when a batch is small:
the rest waits ten minutes. Database queries count separately from the 50 (Cloudflare's Workers limits
page gives 1,000 calls to its own services per run on Free, though its D1 page still says 50 queries).
If System health ever shows "Too many API requests" or "Too many subrequests" for a part, lower the
batches in `src/limits.js`.

**Moving to Workers Paid**: add the variable `WORKERS_PLAN` with the value `paid` in Cloudflare (Workers
& Pages, typecraft, Settings, Variables and secrets). The larger batches apply from the next run, and
System health and Integrations show the Paid limits.

Before migration 0017 the jobs run exactly as before, and nothing is recorded (tested).

## 4. System health (`/console/system-health`)

Problems first, worst first, then:

- **Background jobs**: each schedule's last run (finished, had a problem, stopped before finishing),
  runs and problems in the last 24 hours, problems in the last 7 days, and the latest runs. A schedule
  that hasn't run for 3 of its intervals (10-minute job) or 26 hours (nightly) is flagged: check
  Triggers in Cloudflare.
- **Email**: sent in the last 24 hours and 30 days against Resend's free plan (100 a day, 3,000 a
  month; set `RESEND_PLAN=paid` after upgrading Resend to drop these), waiting, failed for good,
  bounced, last sent, last delivery report.
- **Payments**: orders the bank approved but Razorpay hasn't confirmed for over an hour, the last
  payment, the last Razorpay message, failed Razorpay messages.
- **Database**: size against the plan's limit (500 MB on Free), and how many days of restore points.
- **Plan and limits**: what Workers Free allows, and the batch sizes above.
- **Database updates**: every migration, and whether its tables and indexes exist here. Built from
  `src/console/migration-list.js`; a test fails when a migration file isn't listed there.
- **Practice saving**: the numbers the old `/admin` overview showed (active learners, results saved,
  turned away, couldn't be saved because the database was busy, the nightly totals check).

Warnings: a missing database update; a job that failed, was stopped or stopped running; 80% and 100%
of the free email allowance; emails that failed for good; payments waiting over an hour; failed
Razorpay messages; the database 80% and 95% full; practice that couldn't be saved.

Read-only. Each load is a few batched queries. Permission `health.view`: Super Admin and Admin.

## 5. Email templates (`/console/email-templates`, under Email campaigns)

Every email TypeCraft sends (27), grouped (sign-in and security, payments and plans, learning and news,
support, institutes, for the team), each filled with sample data from `src/mail-samples.js`, with its
subject, who gets it and when, and a plain-text view. Nothing is sent.

The email is shown in a frame from `/console/email-preview/:name`, because an email needs inline styles
and the console allows none. That address has its own policy: no scripts at all, sandboxed, and only
the console may frame it (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`). The console's own
policy gains only `frame-src 'self'`. Permission `emails.view`.

A test fails when a template has no sample data or description.

## 6. Permissions added or changed in 5a

| Key | Layer | Admin | Support | Note |
| --- | --- | --- | --- | --- |
| `integrations.view` | Infrastructure | on | off | new |
| `health.view` | Infrastructure | on | off | new |
| `settings.manage` | Infrastructure | off | off | now asks for the password again |

## 7. Going live with 5a

1. **[Claude, after your OK] Database**: take a restore bookmark in the D1 console (write it down in
   `docs/LAUNCH.md` §1n), then apply `migrations/0017_job_runs.sql` (one new table, `job_runs`; adds
   only, no row changes, safe to run twice). Never `wrangler d1 migrations apply`.
2. **[You] Merge the 5a pull request.** Nothing changes for learners.
3. Open System health after 10 minutes: the first run should show "Finished".
4. Optional, recommended: set up `RESEND_WEBHOOK_SECRET` (§2).

## 8. Tests

`node --test tests/console-system.test.mjs`: the free-plan budget, settings (who may change what, the
password check, field checks, the activity log, nothing logged for no change), the payments and
sign-ups switches end to end, the old `/admin` settings without the test-mode switch, integrations
(and that no secret value is ever in an answer), the job record from the real `scheduled()` handler,
a failing part with its single alert email, runs stopped part-way and jobs that stop running, the
email and payment warnings, the state before migration 0017, the migration list against the folder,
and the email previews with their headers. `tests/email.test.mjs` checks every template has preview
data and a description.
