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
| 3. Institute portal (C1–C4) | institute home, teachers, batches, students | pull request 3 |
| 4. Reports and certificates (D1, D2, E1, E2) | batch report and CSV, student page, batch certificates | |
| 5. Terms, capacity, final check (G1, G4, G5) | institute terms, privacy lines, capacity card, guide | |

Nobody can join anything until part 2 is live: institutes are only created in the console.

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
