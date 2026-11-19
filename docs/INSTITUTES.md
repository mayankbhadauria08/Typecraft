# Institutes (group mode)

TypeCraft sells seats to typing and exam coaching centres. A student who joins a batch with its code
gets the institute's plan until the institute's end date. The institute's staff see their students'
progress. The full plan, with every component and what is built when, is the doc
"Institute group mode: full version plan".

Release 1 is built in five pull requests. This file grows with each one.

| Part | What | State |
|---|---|---|
| 1. Foundations (A1–A6) | tables, seat → plan, join codes, seat count and end date, staff checks, weak keys | pull request #28 |
| 2. Console (B1–B3, B5) | create institutes, record payments, renew and add seats, invite their admin | pull request #30 |
| 3. Institute portal (C1–C4) | institute home, teachers, batches, students | pull request #31 |
| 4. Reports and certificates (D1, D2, E1, E2) | batch report and CSV, student page, batch certificates | pull request #32 |
| 5. Terms, capacity, final check (G1, G4, G5) | institute terms, privacy lines, capacity card, guide | pull request #34 |
| Release 2 (D3–D5, D7, C5, G2, B4) | targets, assignments, exam results by batch, leaderboard, invitations, reminders, invoices | pull requests #35, #37, #38 |
| Release 3 (F1–F3) | buying seats online: new institutes, more seats, renewals, invoice by email (§15) | this pull request |

Nobody can join anything until an institute is created in the console and its payment recorded, or its
seats are bought online and Razorpay confirms the payment (§15).

## 1. Words

- **Institute**: one customer organisation. Has a plan (`package_id`), a number of seats, a term
  (`starts_at` to `ends_at`) and a status: `pending` (set up, not paid), `active`, `suspended`
  (paused by TypeCraft), `closed`.
- **Batch**: a class inside an institute, with a join code. A batch is archived, never deleted.
- **Seat**: one student in one batch (`institute_students`, status `active`). Leaving or being
  removed ends the row (status `left` or `removed`, kept as history) and frees the seat. Seats are
  reusable: a coaching centre with two-month batches removes one batch and the next one joins.
- **Staff**: the institute's `admin`(s) and `teacher`s, invited by email.

## 2. Tables — `migrations/0009_institutes.sql`

Adds six tables, changes nothing that exists: `institutes`, `institute_staff`, `batches`,
`batch_teachers`, `institute_students`, `institute_payments`. Every statement is
`CREATE … IF NOT EXISTS`. Until it is applied, the site works exactly as before: plans ignore seats,
and the institute API answers 503 `institutes_not_ready`.

Deleting a learner's account removes their seats and staff rows (foreign keys, `ON DELETE CASCADE`);
the institute's own records stay. The account export (`GET /api/user/export`) lists
`institute_seats` and `institute_roles`.

## 3. A seat gives the plan — `src/entitlements.js`, `src/institute-access.js` `seatsFor`

A seat counts like a plan period when the institute is `active` and today is inside its term. It
gives the institute's package as that package is today. It is merged with the learner's own plan
periods the usual way: features and limits together, the highest plan's name, the latest end date.
So a student who also bought a plan keeps whichever lasts longer.

`entitlements.seats` lists the seats (`instituteName`, `batchName`, `packageName`, `expiresAt`);
they are not in `entitlements.subscriptions`, which stays the list of bought or granted periods.
On the Plans page a plan that only comes from seats shows "Through <institute>" and no Renew button.

When the term ends, or the institute is suspended or closed, the seat stops giving the plan the same
moment. Nothing is deleted: progress stays the learner's. Renewing (a later end date) brings the plan
back for the same seats.

The nightly "your plan has ended" email checks entitlements, so a student whose own plan ends while
they have a seat isn't told they are back on Free.

## 4. Joining, leaving, staff views — `src/institutes.js`

| Request | Who | What |
|---|---|---|
| `GET /api/institutes/join?code=` | signed in | what the code is for: institute, batch, plan, end date; `canJoin`, `problem` |
| `POST /api/institutes/join` `{ code, adult: true }` | signed in | take a seat; 201, or 200 `already` |
| `GET /api/me/institutes` | signed in | my seats (`givesPlan`), and the institutes I help run |
| `POST /api/me/institutes/:id/leave` | signed in | give my seat back |
| `GET /api/institutes/:id` | staff | the institute, seats used, the batches I may see |
| `GET /api/institutes/:id/batches/:bid` | staff | one batch: student count, join code, teachers |

**Codes**: 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I, O, 0, 1), shown as `ABCD-EFGH`,
typed any way. A code opens a batch only while the batch is not archived and the institute is not
closed. Join attempts (preview and join) are limited to 20 an hour per account and 60 an hour per
network address, right or wrong.

**Joining** needs: the box "I am 18 or older" (seats are for adult learners for now; stored as
`adult_confirmed_at`), an `active` institute inside its term, a free seat, and not already being in
another batch of the same institute (409 `other_batch`: a teacher moves students). Refusals:
404 `bad_code`, 409 `not_open`, `ended`, `seats_full`, `other_batch`. The seat count, term and
"not already in" are checked inside the one `INSERT … SELECT … WHERE` that writes the seat, and a
unique index allows one active seat per student per institute: two students taking the last seat at
the same moment can't both get it.

**Pages**: `/join` and `/join/ABCD-EFGH` (signed out: sign in or sign up, then back). The page shows
what the code is for, asks for the 18+ box, joins. It says what the institute's staff will see.
The Plans page lists seats with "Leave the batch" (an in-page confirmation) and links to `/join`.

## 5. Who sees what — `src/institute-access.js`

Every institute request goes through `requireStaff` or `requireBatch` on the server:

- the signed-in account must be **active staff** of that institute (`institute_staff.user_id`,
  status `active`); invited-but-not-accepted and removed staff get nothing;
- the institute must not be `closed` (pending, active and suspended institutes stay visible to their
  staff, so they can prepare batches before paying);
- **admins** see every batch; a **teacher** sees only batches they are assigned to (`batch_teachers`);
- anything else is **404**, the same answer as for an institute that does not exist, so ids can't be
  probed; an admin-only action asked by a teacher is 403;
- private notes and prices on the institute row never leave the console.

Tests (`tests/institutes.test.mjs`) cover a teacher opening another batch, another institute, a batch
of another institute under their own, removed and invited staff, students, signed-out requests, and a
closed institute.

## 6. Weak keys — `src/key-stats.js`

The trainer saves each learner's running totals per key as `user_state` `keyStats`
(`PUT /api/user/progress/state`). The `key_stats` table is filled only by `POST /api/user/stats`,
which the app doesn't call, and by a one-time copy for older accounts. Reading `key_stats` alone left
weak keys empty in the console (learner page, learning analytics) and in the learner's own Analytics
key map. They now read both, the larger total for each key winning (they hold the same running
totals, never parts to add). Nothing new is written, so this costs no database writes.

## 7. The console — `src/console/institutes-api.js`, Core operations › Institutes

TypeCraft staff run institutes from the console. Three permissions (Roles and permissions grid):

| Permission | Admin | Support | What |
|---|---|---|---|
| `institutes.view` | yes | yes | the list and each institute, without money for roles that lack the next one or `revenue.view` |
| `institutes.manage` | yes | no | create, edit details, change seats and term, switch on, pause, close, invite and remove staff |
| `institutes.payments` | yes | no | record and remove payments; asks for the password again |

- **Create** (New institute): name, city, contact, GSTIN (checked: 15 characters), the plan a seat gives
  (any paid package), seats (1 to 10,000), price per seat for the term (₹), first and last day (India
  days; a term is at most three years), their admin's email (optional), private notes. It starts
  **Not paid yet** (`pending`).
- **Record payment**: amount, how (bank transfer, UPI, cheque, cash, other), reference (required except
  for cash), the day the money arrived (not in the future), note. **The first payment switches a
  pending institute on.** A payment recorded by mistake can be removed with a reason; the activity log
  keeps everything it said. Money is never taken from a page in the browser: only staff record it.
- **Change seats or term**: seats (never below the seats in use), first and last day, price per seat,
  with a reason. Renewing = moving the last day on. Every change is logged with from and to.
- **Status**: Not paid yet → On or Closed; On → Paused or Closed; Paused → On or Closed. Closed is final
  (students lose the plan, staff lose access). Each change needs a reason.
- **Admin and teachers**: invite by email (admin or teacher), send the email again, remove (their batches
  go back to the admins). The invitation email (`institute_invite`) links to `/institute`, where the
  invited account accepts (part 3). It carries no secret: only the account with that verified email can
  accept.
- **History**: every change, by whom and when (`audit_logs`, target `institute:<id>`), for roles with
  `audit.view`.

## 8. The institute's own pages — `src/institute-portal.js`, `/institute`

For the institute's admins and teachers, in the account area. "Institute" appears in the account menu and
sidebar for anyone who helps run an institute or is invited to (one small lookup per page).

- **`/institute`**: invitations (Accept needs the account's email confirmed: the invitation went to an
  email address, so only the account that proved it owns that address takes it), and the institutes
  this account helps run. With exactly one institute it opens that one.
- **`/institute/:id`**: seats in use and free, last day and days left, a note when it isn't paid yet,
  paused or ended. **Batches** (admins: all; teachers: theirs) with students, how many haven't
  practised in the last 7 days, teachers, join code and a "Copy link" button. Admins: **New batch**
  and **Admins and teachers** (invite a teacher or another admin, send again, remove; an institute
  always keeps one admin; an admin can leave when another admin exists).
- **`/institute/:id/batches/:bid`**: the join code, large, with its link (`/join/ABCD-EFGH`), "Copy the
  link", "Copy the code". **Students** with the day they joined and last practised ("Not this week"
  marked). Admins also: **New code** (the old one stops working), **Switch joining off / on**, **Move**
  a student to another batch (keeps the seat and progress), **Remove** (frees the seat; the student's
  plan from it ends; progress stays), rename, choose the batch's teachers, and **Archive** when it
  finishes (removes its students and frees their seats; the code goes) or bring it back.
- Teachers can open their batches and students; everything that changes seats, codes or teachers is
  for admins (403 for a teacher). Everything is checked on the server (§5).
- Every change by an institute is in the activity log with the institute as target and `by: 'institute'`,
  so TypeCraft staff see it in the console's history: `institute.staff_accept`, `staff_decline`,
  `staff_invite`, `staff_resend`, `staff_remove`, `batch_create`, `batch_update`, `batch_code`,
  `student_remove`, `student_move`.
- A pending (not paid) institute can be prepared: batches made, teachers invited, codes handed out;
  students can join once it is switched on. A closed institute is out of reach for its staff.

## 9. Reports and certificates — `src/institute-reports.js`

Only numbers TypeCraft saved from the student's own practice; staff can't type any in.

- **Batch report** (the Students table on a batch's page; `GET …/batches/:bid/report`): one row per
  student: lessons done of 78, the level they are working on, best speed, average accuracy of finished
  lessons, minutes practised in the last 7 days (India days), last practised, and their three weakest keys
  (typed 20 times or more, with at least one mistake; worst first). A student's name opens their page.
- **CSV** (`…/report.csv`, "Download CSV"): the same rows, with a byte-order mark so Excel shows names
  correctly; a cell starting with = + - @ gets a leading apostrophe so it is never run as a formula.
- **A student's page** (`/institute/:id/students/:mid`): summary, minutes by day for 30 days, lessons
  finished in each level, weak keys, lessons they are stuck on (tried 5 times or more), recent exam
  practice. The same numbers as the console's Student progress (`progressOf` in
  `src/console/progress-api.js`, used by both).
- **Certificates** (a batch's page, "Print N certificates"; `…/certificates`): for each student, their
  highest course speed certificate, or else their best passed exam-practice test they made a
  certificate of. A course certificate gets its verify code here if it has none yet (as when the
  student opens Certificates). A code the student stopped sharing is left off the print. Printing uses
  the browser: one certificate a page; "Save as PDF" gives one PDF for the batch.
- **"Trained at <institute>"** is printed on the certificate, and the verify page says "Earned while at
  <institute>" when the holder had a seat there on the day they earned it (`instituteAt` in
  `src/exams.js`).
- Admins see every batch; a teacher only theirs (§5). Everything else is 404.

## 10. Terms, privacy, capacity, guide

- **`/institute-terms`** (Terms for institutes, linked in the footer and from `/institute`): seats and term,
  payment before seats switch on, admins and teachers, students 18 or older, what staff see and that it
  stops when a student leaves or the term ends, certificates, pausing and closing, law. **A starting
  point, not legal advice: read it with a lawyer or CA before the first institute signs.** It uses the
  seller details from console Settings and the same `[Your city]` placeholder as the other legal pages.
- **Privacy policy**: two lines (what we keep about seats and roles; what an institute's staff see and
  when that stops), linking the institute terms. The `/join` page links the privacy policy.
- **`/institute-guide`** (Guide for institutes): nine short steps for an institute's admin, from getting
  seats to archiving a batch.
- **Capacity today** (console › Institutes): lessons finished today (from today's `events`, by their
  index), learners, institute seats in use, and the database size D1 reports. It compares lessons with
  about 2,083 a day: the free plan's 100,000 rows written a day ÷ about 48 rows a lesson (measured on a
  test copy, index updates included). The bar turns red past half. **Before the first institute starts,
  move to Workers Paid ($5 a month)** in the Cloudflare dashboard (Workers & Pages › Plans): that is your
  step; nothing in the code changes it.
- **End to end** (`tests/institute-e2e.test.mjs`): set up in the console with the admin's email →
  admin accepts (after confirming their email) → batch prepared before payment, nobody can join →
  payment recorded, institute on → teacher invited, accepts, given the batch → student joins with the
  code, gets the plan, practises → teacher sees the report, CSV and the student's page → certificate
  printed with the institute's name and checked on the verify page → console shows seats, payment and
  the institute's own changes → batch archived, seat freed, student back on Free with their progress.

## 11. Before the first institute (your steps)

1. Merge the five pull requests in order (#28, #30, #31, #32, then part 5).
2. Let Claude apply `migrations/0009_institutes.sql` on the live database after a restore bookmark
   (`docs/LAUNCH.md` §1g). Deploy.
3. Move to Workers Paid ($5 a month) in the Cloudflare dashboard.
4. Read `/institute-terms` and the privacy lines with a lawyer or CA; fill the `[Your city]` placeholder
   and the seller details in console Settings if not done yet.
5. Make sure `RESEND_API_KEY` is set so invitation emails go out (without it, tell the admin to sign in
   at `/institute` with the invited email).
6. Console › Institutes › New institute, with their admin's email. Record their payment when it reaches
   your bank.

## 12. Release 2: targets, assignments, exam practice by batch, leaderboard — `src/institute-teaching.js`

Migration `0010_institutes_teaching.sql` holds every table Release 2 needs (`batch_leaderboards`,
`batch_targets`, `assignments`, `student_invites`, `institute_reminders`, `institute_invoices`); all
`CREATE … IF NOT EXISTS`. Before it is applied, the batch page leaves this part out and students see
their batch without targets (503 `teaching_not_ready` for the staff API).

On a batch's page, under **Target and assignments** (admins and the batch's teachers):
- **Target**: a speed at an accuracy, by a day (optional), with a note for students. A student has reached
  it when any lesson run, typing test or exam practice result (net speed, 100 − mistakes %) was at least
  that fast at that accuracy or better. Speeds are rounded down.
- **Assignments**: a course lesson or an exam practice test, by a day. Done = the lesson finished (at any
  time) / a test of that kind saved after the assignment was given. "Done late" when it happened after
  the day; "Not done" when the day has passed. At most 50 open a batch; removing keeps what students did.
- **Exam practice**: each student's best net speed for each test, "Passed" or how many tries.
- **Leaderboard**: off until staff turn it on (a row in `batch_leaderboards`). Top 10 best speeds of the
  last 7 days, first names only. Staff see it while it is off; students only when it is on.

Students see **Your batch** on their dashboard (`GET /api/me/batches`): the target and their own best,
assignments with links (the trainer, or that exam practice test) and their state, and the leaderboard if
it is on. Only their own results, plus first names and speeds on the leaderboard. The privacy policy and
the institute terms say so.

Every change is in the institute's history: `institute.target_set`, `target_clear`, `assignment_add`,
`assignment_remove`, `leaderboard`.

## 13. Release 2: students invited by email, reminders — `src/institute-mail.js`

- **Invite students by email** (a batch's page, admins): choose a spreadsheet saved as CSV, or paste
  names and emails, one student a line (an email anywhere on the line; the rest is the name). The page
  sends them in parts of 25; each student gets the `student_invite` email with the batch's code and link.
  Skipped, with the reason: not an email, twice in the list, already in the institute, already invited to
  this batch, the daily limit (500 an institute). Needs joining on (the email carries the code). The list
  shows who was invited and who has joined. The code and link are stored with the email as `batchCode` and
  `joinPath` so a retry carries them (a batch code is not a password: anyone with it can join, as on the
  batch's page).
- **Reminders** (nightly, 2:47 am India time): when 90% of an institute's seats are in use (institutes of 5
  seats or more), 30 days before its last day, and 7 days before. Each once a term (`institute_reminders`,
  keyed by the term's end, so a renewal starts them again), to its active admins and its contact email,
  `institute_reminder` template, "reply to this email" to add seats or renew.

## 14. Release 2: invoices for institute payments — `src/institute-invoices.js`

- Console › an institute › Payments: **Make invoice** on a recorded payment (`institutes.payments`, asks for
  the password again). It takes the next number of the one TypeCraft series (`TC-YYYY-NNNNNN`, shared
  with customers' invoices), and copies the institute's details (name, contact, city, email, phone,
  GSTIN) and the seller's (console Settings) as they are then. Made once per payment; an invoice can't
  be deleted, and its payment can no longer be removed (ask your CA about a credit note).
- The line says the plan, seats and term, and "(part payment)" when the payment is less than seats ×
  price. Like every TypeCraft invoice for now, **no GST is added**: "GST not applicable" while the seller
  has no GSTIN; with one, the invoice says GST is not added. Charging GST (rate, CGST/SGST or IGST by
  state) is for your CA to decide before it is built.
- The printable page `/institute/:id/invoices/:number` ("Print or save as PDF") holds no data: it asks the
  institute's API (its admins) or the console's (TypeCraft staff with a money permission). The institute's
  admins see **Invoices** on their institute page.

## 15. Release 3: buying seats online — `src/institute-checkout.js`, migration 0011

Built against **Razorpay test mode**. Nothing is sold online until you switch it on in the console, and it
needs Razorpay's keys (test keys first). Bank transfer stays as it was.

- **Prices** — Console › Institutes › *Seats sold online* › Change (`institutes.payments`): on or off, the plan
  a seat gives, the fewest seats, and a price per seat for 6 and/or 12 months (leave one empty to not sell it).
  Saved in `platform_settings` 'institute_pricing' and in the activity log. Buying is open only when it is
  on, a plan and a price are set, Razorpay is connected and payments aren't paused in Settings.
- **A new institute** — `/institute/buy` (signed in, email confirmed): name, city, contact, GSTIN, seats (at
  least the minimum), term, and "I accept the terms for institutes". The page's total is a preview; the
  server works out the amount. Once Razorpay confirms, the institute is created **active** with the term
  starting that day, the payer is its admin, the payment is recorded (method "Online (Razorpay)", reference
  = Razorpay payment ID), the invoice is made, and it is emailed to the payer and the contact email
  (template `institute_payment`).
- **More seats** — an admin's institute page, *Add seats*: for the days left to the last day, at the longest
  term's price for those days (a month = 365/12 days), rounded up to the rupee per seat.
- **Renewal** — opens 60 days before the last day and stays open after it. The new term starts the day after
  the current last day (or today, if that has passed); the seat count changes at once and must be at least the
  students in batches now.
- Online top-ups and renewals are offered only to **active** institutes on the plan sold online; others write
  to you. One payment goes up to ₹5,00,000; above that, bank transfer.
- **Money rules** (as for plans): seats change only when Razorpay itself confirms: the payment fetched from
  Razorpay after a valid checkout signature, a signed webhook (billing.js hands events for unknown plan orders
  to `instituteWebhook`), or the 10-minute check, which also cancels orders unpaid for a day and repairs a
  missing invoice or email. The change happens once: the call that moves the order to 'paid' writes a
  `claim_id`, and every change in the same transaction requires it, so the page, the webhook and the check
  arriving together still create one institute, one payment and one invoice.
- If an institute was **closed** between checkout and payment, the money is recorded but nothing changes; the
  order says "refund it from the Razorpay dashboard" and the history says *NOT APPLIED*. Refunds of online
  institute payments are made in the Razorpay dashboard.
- The console shows online payments as "Online (Razorpay)", recorded by "Paid online", and the history as
  *Checkout started online* and *Paid online*. Reminder emails say the institute can add seats or renew
  online when it can.
- API: `GET /api/institutes/buy`, `GET /api/institutes/:id/buy` (admins), `POST /api/institutes/checkout`
  `{ kind: 'new' | 'seats' | 'renew', … }`, `POST /api/institutes/checkout/verify`, `POST …/checkout/failed`,
  `GET /api/institutes/checkout/orders/:id`; console `GET/PUT /api/console/institutes/pricing`.

