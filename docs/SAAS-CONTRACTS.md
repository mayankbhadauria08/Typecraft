# TypeCraft SaaS — contracts for the build (15 Nov 2026)

The commercial version of TypeCraft: public site, accounts, plans, Razorpay payments,
business email, admin. Every part follows this file so the parts fit together.
Branch base: `saas/base`. Integration branch: `saas/integration`.

## 0. Ground rules (all parts)

- **Stack stays as it is:** plain HTML/CSS/JS, no build step, classic scripts on globals in
  the browser; Cloudflare Worker (ES modules) + D1. No frameworks, no npm packages at runtime.
- **Keep everything that works:** the trainer app (`index.html`, `js/app.js`, games, rewards),
  events/state API, the `typingMaster*` storage keys, lesson ids l1–l78, existing tables.
- **Secrets only via `env`** (Cloudflare secrets). Never in code, HTML, logs or responses.
  Never log OTP codes, tokens, signatures or full webhook bodies with personal data.
- **No deploying, no live data, no real money.** Razorpay calls are mocked in tests
  (replace `globalThis.fetch`). Nothing in tests talks to the network.
- **Money in paise (INTEGER).** Times ISO-8601 UTC. IDs: `crypto.randomUUID()` or prefixed random.
- **Errors:** throw `HttpError(status, code, message)` / `fieldError({...})` from `src/http.js`;
  messages are plain English the learner can act on.
- **Writes:** non-GET `/api/*` already require same-origin JSON (`assertSameOriginWrite`),
  except `/api/webhooks/*` (they verify their own signatures).
- **Tests:** `node --test tests/<part>.test.mjs` with the D1 shim (`tests/d1-shim.mjs`,
  `tests/server.mjs` → `makeEnv()`), which applies every migration. Keep tests focused:
  the money paths, signatures, idempotency, access control. No browser tests needed per part.
- **Server module shape:** each module exports `ROUTES` (`{'METHOD /path': handler}`),
  `PATTERNS` (`[method, regex, ['param'], handler]`) and optionally `cron(env, ctx, kind)`.
  `src/index.js` merges them (already wired). Handler signature:
  `handler(request, env, ctx, params)`. Use `requireSession(env, request)` → `{ user }`
  (user: `{ id, fullName, email, phoneNumber, emailVerified, … }`, see `publicUser`).
- **Crons** (`wrangler.jsonc`): `"*/10 * * * *"` (every 10 min) and `"17 21 * * *"` (nightly,
  02:47 IST). `cron(env, ctx, kind)` gets `kind` = the cron string.

## 1. Database (migrations/0003_saas.sql — done, read it)

New tables: `packages`, `package_features`, `user_subscriptions`, `orders`, `payments`,
`refunds`, `invoices`, `webhook_events`, `email_logs`, `otp_verifications`, `known_devices`,
`admin_users`, `audit_logs`, `platform_settings`, `typing_tests`, `contact_messages`,
`email_preferences`. Seeded: 5 packages, 13 feature keys, settings (`seller`, `support`,
`payments`, `invoice_seq`, `signups`).

Existing tables keep their roles (names in the brief → actual tables):
users → `users`; user_sessions → `sessions`; email_verifications → `email_tokens` (+ OTP);
password_resets → `password_reset_tokens`; user_profiles → `users` + `user_settings`;
typing_history → `events` + `typing_tests`; typing_statistics → `lesson_scores`,
`daily_totals`, `user_totals`, `key_stats`, `bigram_stats`, `error_classes`.

A later migration may only ADD tables/columns/indexes (`0004_*.sql`), never drop or rewrite.

## 2. Plans and what Free includes

| id | price | validity | grants |
|---|---|---|---|
| free | ₹0 | — | `lessons.first5`, `arcade.daily`, `tests.basic` (3 tests/day, 7-day history) |
| starter | ₹99 | 30 days | all lessons, all arcade, 20 tests/day, full history, basic analytics |
| pro | ₹199 | 90 days | Starter + unlimited tests, advanced analytics, custom practice, premium packs |
| premium | ₹399 | 180 days | Pro + insights, certificates, priority support |
| lifetime | ₹799 | never expires | everything in Premium |

- **First 5 lessons** = the first five ids in course order (`TC_META.ORDER.slice(0, 5)`);
  the placement test and the review drill are free too.
- Free arcade = the Daily Challenge only.
- Plans are stored in `packages` (editable in admin). Code never hard-codes a price;
  it reads the package. Feature checks use feature keys only.
- **Buying while a plan is active stacks:** the new period starts when the latest active
  period ends (renewal = buying again). Lifetime has `expires_at = NULL`.
- Entitlements = union of the user's `active` subscriptions whose `expires_at` is NULL or in
  the future, plus Free. `limits`: numbers take the most generous (null = unlimited).

## 3. Entitlements (owner: billing part) — `src/entitlements.js`

```js
entitlementsFor(env, userId) → {
  plan: 'pro', planName: 'Pro',             // the best active package (by display_order)
  expiresAt: '2027-02-13T…Z' | null,         // latest expiry; null = free or lifetime
  features: ['lessons.all', …],
  limits: { lessons: 'all'|'first5'|{levels,lessons}, dailyTests: 20|null, historyDays: 7|null },
  lessonsWords: { text, Text, short, count, all },   // the lessons in words ("Level 1 (16 lessons)")
  subscriptions: [{ id, packageId, packageName, status, startsAt, expiresAt, source }],
  overrides: { lessons: { allow, deny }, games: { allow, deny } },   // exceptions for this learner
  rules: { closed, open, progress, placement },      // rules for everyone (docs/UNLOCK-RULES.md)
}
has(ent, 'analytics.advanced') → boolean
lessonAllowed(ent, lessonId) → boolean      // shared/lesson-access.js access(): docs/UNLOCK-RULES.md §1
gameAllowed(ent, gameId) → boolean          // 'daily' always; others need arcade.all
```

`GET /api/me/entitlements` → the object above (signed in), 401 otherwise.

**Enforcement on the server:**
- `POST /api/user/events` (src/api.js): a `run`/`step` event for a lesson the user may not
  open, or a `game` event for a locked game, is rejected per event with reason
  `plan_required` (the rest of the batch still counts), or `closed` when staff closed it for this
  learner or for everyone. The billing part adds this check.
- Typing tests: `POST /api/me/tests` refuses with 402 `plan_limit` past `dailyTests`.
- Premium content (`/api/content/*`) and advanced analytics return 402 `plan_required`.
- 402 body: `{ error: { code: 'plan_required'|'plan_limit', message, feature, upgradeUrl: '/pricing' } }`.

Honest limit (write it in the report): lesson texts for the 78 lessons are generated by
public JavaScript, so a technical user could read them; what is enforced server-side is
saving progress/stars/XP/certificates for locked lessons, premium packs, analytics and tests.

## 4. Email (owner: email part) — `src/mail.js` (+ `src/mail-templates.js`)

```js
sendTemplate(env, ctx, { to, userId?, template, data, category }) → { id, status }
```
- Never throws. Writes an `email_logs` row (`queued`), renders the template, sends through
  the provider, marks `sent` (with provider id) or `failed` + `next_attempt_at`
  (retries at +5 min, +30 min, +2 h, +12 h, then stays `failed`). `ctx.waitUntil` may be used
  for non-critical sends; OTP and password reset send inline.
- Provider: **Resend HTTP API** (`RESEND_API_KEY`). From: `EMAIL_FROM`
  (default `TypeCraft <hello@typecrafttyping.com>`), Reply-To: `EMAIL_REPLY_TO`
  (default `hello@typecrafttyping.com`). If no key: log row `failed` with `not_configured`,
  and auth flows that need email answer 503 `email_not_configured` like today.
- `payload` in `email_logs` must never hold OTP codes or tokens; a retry of an OTP/reset
  email is not done (they are re-requested by the user instead) — mark them `failed`.
- Rate limits (via `hitLimit`): per recipient per template (OTP 5/h, reset 5/h, verify 5/h),
  global 300/10 min.
- Templates (HTML + text, responsive, table layout, inline styles, brand header/footer,
  support email, unsubscribe link only for announcements):
  `welcome, verify_email (link + 6-digit code), otp_login, login_alert, password_reset,
  password_changed, security_alert, email_changed, payment_success (activation + receipt
  summary + invoice link), payment_failed, invoice, subscription_renewal_reminder,
  subscription_expired, refund_processed, announcement, account_update, test_completed,
  contact_received (auto-reply), contact_forward (to support)`.
  `data` keys are documented at the top of `src/mail-templates.js`.
- Site links in emails use `SITE_URL` (var, default `https://typecrafttyping.in`).

**Auth additions (email part owns src/auth.js changes):**
- `POST /api/auth/otp/request {email, purpose:'login'|'verify_email'}` → always
  `{ ok:true, message }` (no account enumeration); 60 s resend cooldown; 6 digits; 10 min;
  stored as HMAC-SHA256(code, `SESSION_SECRET`); 5 wrong tries burns it.
- `POST /api/auth/otp/verify {email, code, purpose, remember}` → login: creates a session
  (same cookie as password login) → `{ user }`; verify_email: marks email verified.
- Verification email = link **and** code. Links: `${SITE_URL}/verify-email#token=…`,
  reset: `${SITE_URL}/reset-password#token=…`. The old `/#verify=`/`/#reset=` links keep working.
- Signup sends `welcome` + `verify_email`. Password change/reset sends `password_changed`.
  Login from a new device (known_devices) sends `login_alert` (respects preference).
- `GET/PUT /api/me/email-preferences {announcements, testResults, loginAlerts}`.
- `POST /api/contact {name, email, topic, message}` → `contact_messages` + `contact_forward`
  to support + `contact_received` auto-reply; 5/h per IP; `priority` = 1 if `support.priority`.
- `POST /api/webhooks/resend` (optional, `RESEND_WEBHOOK_SECRET`, Svix signature) →
  `delivered` / `bounced` on `email_logs`.
- Admin (email part): `GET /api/admin/emails?status&q&page`, `POST /api/admin/emails/:id/retry`,
  `POST /api/admin/announcements {subject, body, audience:'all'|'paid'|'free', test:true}`,
  `GET /api/admin/contact?status`, `POST /api/admin/contact/:id {status}`.

## 5. Payments (owner: billing part) — `src/billing.js`, `src/razorpay.js`, `src/invoices.js`

Secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.

- `GET /api/packages` (public) → `{ packages:[{id,name,description,pricePaise,currency,
  validityDays,features:[{key,label}],lessons:{text,Text,short,count,all},limits,highlight}],
  features:[{key,label,description}] }`. The first item of each package's `features` is
  `{ key:'lessons', label }` (its lessons in words); the two lesson features are left out of both
  lists (docs/UNLOCK-RULES.md §2).
- `GET /api/learning-rules` (public) → `{ rules: { closed, open, progress, placement } }`
- `GET /api/course` (public, cached 60 s) → `{ version, edits, publishedAt }`: the published course
  changes (lesson names, tips, keys, words, sentences; level and unit names), applied by the app
  between lessons through `shared/course-edits.js`. Practice packs are not in it (they stay behind
  `/api/content/packs`). Version 0 with `{}` = the course as in the code (docs/ADMIN-PHASE-3.md).
- `POST /api/checkout/order {packageId}` (signed in) → creates `orders` row + Razorpay order
  (`POST https://api.razorpay.com/v1/orders`, Basic auth, `receipt` = our order id,
  `notes` = {orderId, userId, packageId}) → `{ orderId, razorpayOrderId, amountPaise,
  currency, keyId, packageName, prefill:{name,email,contact} }`. Free package → 400.
  Payments disabled in settings or keys missing → 503 `payments_unavailable`.
  Reuses an unpaid `created` order of the same package from the last 30 min.
- `POST /api/checkout/verify {orderId, razorpay_order_id, razorpay_payment_id,
  razorpay_signature}` → HMAC-SHA256(`order_id|payment_id`, KEY_SECRET) compared in
  constant time; then `GET /v1/payments/:id` to confirm amount/currency/order and status
  (`authorized` → capture via `POST /v1/payments/:id/capture`) → fulfil →
  `{ status:'paid'|'pending'|'failed', orderId, invoiceNumber? }`.
- `POST /api/checkout/failed {orderId, code, description}` → records the failure text on the
  order (status `failed` only if no captured payment); display only, nothing activated.
- `GET /api/checkout/orders/:id` (owner of order) → `{ orderId, status, packageName,
  amountPaise, invoiceNumber?, failureReason? }` (the pending page polls this).
- `POST /api/webhooks/razorpay` → verifies `X-Razorpay-Signature` = HMAC-SHA256(raw body,
  WEBHOOK_SECRET); idempotent on `X-Razorpay-Event-Id` (`webhook_events`). Handles
  `payment.authorized` (capture), `payment.captured`, `order.paid`, `payment.failed`,
  `refund.processed`, `refund.failed`. Always 200 for verified events already processed.
- **Fulfil once:** `UPDATE orders SET status='paid' … WHERE id=? AND status!='paid'`; only the
  call that changed the row creates the subscription (unique `order_id`), the invoice
  (sequence from `invoice_seq`, `TC-YYYY-000001`), sends `payment_success`, audit log.
  Never activate on a browser message alone.
- Cron (10 min): orders `created/attempted/pending` older than 15 min with a Razorpay order →
  `GET /v1/orders/:id/payments` reconcile. Nightly: expire subscriptions
  (`subscription_expired` email), 3-day renewal reminders (`subscription_renewal_reminder`).
- Me: `GET /api/me/subscriptions`, `GET /api/me/orders` (payment history),
  `GET /api/me/invoices`, `GET /api/me/invoices/:number` (JSON). Invoice page HTML:
  `/account/invoices/:number` (printable, served by site part, data from that API).
- Typing tests: `POST /api/me/tests {id,duration,wpm,rawWpm,accuracy,errors,chars,textKind}`,
  `GET /api/me/tests?limit`. Analytics: `GET /api/me/analytics` (basic: daily speed/accuracy
  series; advanced fields only with `analytics.advanced`: key heatmap from `key_stats`,
  slow pairs from `bigram_stats`, `error_classes`; `insights` with `insights`).
- Admin (billing part; role check from §7): `GET /api/admin/overview`,
  `GET /api/admin/users?q&page`, `GET /api/admin/users/:id`, `POST /api/admin/users/:id
  {status?, grant:{packageId, days?}?, revoke:subscriptionId?, role?}`,
  `GET /api/admin/packages`, `PUT /api/admin/packages/:id {name, description, pricePaise,
  validityDays, features, limits, highlight, active, displayOrder}`,
  `GET /api/admin/payments?status&q&page`, `POST /api/admin/payments/:id/refund
  {amountPaise?, reason}`, `GET /api/admin/revenue?from&to` (daily series, by package,
  totals, refunds), `GET/PUT /api/admin/settings` (`seller`, `support`, `payments`,
  `signups`), `GET /api/admin/audit?page`. Every admin write → `audit_logs`.

## 6. Content (owner: app part) — `src/content.js`

- `GET /api/content/packs` → list (title, description, locked) for everyone signed in. The packs
  are the ones in the code with the published course changes on top (edited, hidden, added,
  reordered in Console, Exercises: docs/ADMIN-PHASE-3.md).
- `GET /api/content/packs/:id` → texts only with `exercises.premium` (402 otherwise).
  Packs: numbers & data entry, code (JS/Python/HTML snippets written by us), business
  writing, exam passages (SSC/clerk style paragraphs written by us). Original text only.
- Custom practice (`practice.custom`) runs in the app engine with the learner's own text
  (client side) and saves as events with `lessonId: 'custom'`; the server accepts
  `custom` only with the feature.

## 6b. Exam practice and certificates — `src/exams.js` (docs/EXAM-MODES.md)

- `POST /api/exams/results` (signed in) `{ id: 'ex-…', mode, passageId, typed, seconds, path?, today }`
  → 201 `{ saved, result, verdict, today }`; the Worker marks `typed` with `shared/exam-rules.js`
  (checking `path`), stores the numbers only. 400 implausible (over 200 gross wpm), 409 id taken,
  429 daily_limit (20 a day), 503 exams_not_ready before migration 0008.
- `GET /api/exams/results` (signed in) → `{ results: [30 newest], best: { mode: … }, limit }`.
- `POST /api/exams/results/:id/certificate` (signed in, passed only) → `{ code: 'XXXX-XXXX-XXXX', shared }`.
- `GET /api/me/certificates` (signed in) → `{ ready, certificates: [{ kind: 'level'|'exam', title, test, wpm,
  accuracy, seconds, at, code, shared, … }] }`; course certificates get their code here.
- `PUT /api/me/certificates/:code` (signed in) `{ shared }`.
- `GET /api/certificates/:code` (public, 60 a 10 minutes per address, `noindex`) → `{ certificate: { holder,
  kind, title, test, wpm, accuracy, seconds, at, code, checkedAt } }`; 404 for unknown, unshared or a
  disabled account (the same message for all three).

## 6c. Institutes — `src/institutes.js`, `src/institute-access.js` (docs/INSTITUTES.md)

- `GET /api/institutes/join?code=` (signed in; 20 an hour per account, 60 per address) → `{ code, institute: { name },
  batch: { name }, plan: { name }, endsAt, joined, canJoin, problem: { code, message } | null }`; 404 `bad_code`.
- `POST /api/institutes/join` (signed in) `{ code, adult: true }` → 201 `{ joined, already: false, institute, batch,
  plan, endsAt }` or 200 `already: true`; 400 fields `code` / `adult`; 409 `not_open`, `ended`, `seats_full`,
  `other_batch`.
- `GET /api/me/institutes` (signed in) → `{ seats: [{ id, institute: { name }, batch: { name }, plan: { name },
  joinedAt, endsAt, givesPlan }], staff: [{ institute: { id, name, status }, role }] }`.
- `POST /api/me/institutes/:id/leave` (signed in, own seat) → `{ left: true }`.
- `GET /api/institutes/:id` (active staff) → `{ role, institute: { id, name, city, status, seats, seatsUsed, startsAt,
  endsAt }, batches: [{ id, name, students, archived }] }` (teachers: their batches only).
- `GET /api/institutes/:id/batches/:bid` (admin, or a teacher of that batch) → `{ role, institute: { id, name },
  batch: { id, name, archived, students, joinCode, teachers: [{ id, name }] } }`.
- Not staff, not their batch, closed institute, unknown id: 404 (one answer for all). Before migration 0009: 503
  `institutes_not_ready`.
- Console (`src/console/institutes-api.js`, docs/INSTITUTES.md §7): `GET/POST /api/console/institutes`,
  `GET/PUT /api/console/institutes/:id`, `POST …/:id/term`, `…/:id/status`, `…/:id/payments`,
  `…/:id/payments/:pid/remove`, `…/:id/staff`, `…/:id/staff/:sid/resend`, `…/:id/staff/:sid/remove`;
  permissions `institutes.view`, `institutes.manage`, `institutes.payments` (sensitive).
- Institute pages API (`src/institute-portal.js`, docs/INSTITUTES.md §8): `POST /api/me/institute-invites/:sid/accept|decline`;
  admin: `GET/POST /api/institutes/:id/staff`, `POST …/staff/:sid/resend|remove`, `POST /api/institutes/:id/batches`,
  `PUT …/batches/:bid` `{ name?, teacherIds?, joining?, archived?, removeStudents? }`, `POST …/batches/:bid/code`,
  `POST /api/institutes/:id/students/:mid/remove`, `…/move { batchId }`; staff of the batch: `GET …/batches/:bid/students`.
  `GET /api/me/institutes` also lists `invites` and `emailVerified`. Pages `/institute`, `/institute/:id`,
  `/institute/:id/batches/:bid` (user, account layout).
- Reports (`src/institute-reports.js`, docs/INSTITUTES.md §9), staff of the batch: `GET /api/institutes/:id/batches/:bid/report`,
  `…/report.csv`, `…/certificates`; `GET /api/institutes/:id/students/:mid`. `GET /api/certificates/:code` adds `institute`
  (name or null). Page `/institute/:id/students/:mid`.
- Console capacity: `GET /api/console/institutes/capacity` (institutes.view) → `{ today, lessonsToday, learnersToday, seatsInUse,
  databaseBytes | null, freeDatabaseBytes, freeLessonsADay, writesALesson, freeWritesADay }`.
- Teaching (`src/institute-teaching.js`, docs/INSTITUTES.md §12), staff of the batch: `GET /api/institutes/:id/batches/:bid/teaching`,
  `PUT …/target` `{ wpm, accuracy, dueDay?, note? }` or `{ clear: true }`, `POST …/assignments` `{ kind, ref, dueDay, note? }`,
  `POST …/assignments/:aid/remove`, `PUT …/leaderboard` `{ on }`; signed in: `GET /api/me/batches`.
- Students by email (`src/institute-mail.js`, docs/INSTITUTES.md §13), admins: `POST /api/institutes/:id/batches/:bid/invites`
  `{ students: [{ name, email }] }` (≤ 25) → `{ sent, skipped: [{ email, why }] }`; `GET …/invites`. Nightly reminders.
- Email templates `student_invite` `{ name, instituteName*, batchName*, batchCode*, joinPath* }`, `institute_reminder`
  `{ name, instituteName*, kind*, seats, seatsUsed, lastDay, days, link }`.
- Institute invoices (`src/institute-invoices.js`, docs/INSTITUTES.md §14): `POST /api/console/institutes/:id/payments/:pid/invoice`
  (institutes.payments), `GET /api/console/institutes/:id/invoices/:number`; admins: `GET /api/institutes/:id/invoices`,
  `GET /api/institutes/:id/invoices/:number`. Page `/institute/:id/invoices/:number` (public, bare, noindex; data via the APIs).
- Seats bought online (`src/institute-checkout.js`, docs/INSTITUTES.md §15): signed in: `GET /api/institutes/buy` → `{ open, packageId,
  packageName, minSeats, terms: [{ months, pricePerSeatPaise }], maxSeats, maxPaise, emailVerified, you }`; admins: `GET /api/institutes/:id/buy`
  → `{ open, why, seats, seatsUsed, lastDay, addSeats: { available, days, pricePerSeatPaise, from, to }, renew: { available, opensOn | from,
  minSeats, terms } }`; email confirmed: `POST /api/institutes/checkout` `{ kind: 'new', seats, months, name, city, contactName, contactEmail,
  contactPhone, gstin, agree }` | `{ kind: 'seats', instituteId, seats }` | `{ kind: 'renew', instituteId, seats, months }` → `{ orderId,
  razorpayOrderId, amountPaise, currency, keyId, description, prefill }` (503 `buying_closed`, 403 `verify_email`, 409 `not_for_sale` /
  `ended` / `too_early`); the payer: `POST /api/institutes/checkout/verify` → `{ status, instituteId?, invoiceNumber? }`, `POST …/failed`,
  `GET /api/institutes/checkout/orders/:id`. Console: `GET /api/console/institutes/pricing` (institutes.view), `PUT` (institutes.payments)
  `{ on, packageId, minSeats, prices: { 6, 12 } }`. Webhooks: through `POST /api/webhooks/razorpay`. Page `/institute/buy` (user, account).
- Email template `institute_payment` `{ name, instituteName*, kind, what*, amountPaise*, invoiceNumber, invoiceUrl, link, seats, lastDay }`
  (billing); `institute_reminder` also takes `online`.
- Scheduled tests (`src/institute-tests.js`, docs/INSTITUTES.md §16), staff of the batch: `GET /api/institutes/:id/batches/:bid/tests`
  → `{ tests: [{ id, mode, modeName, short, minutes, passageId, passageTitle, opensAt, closesAt, note, state, started, submitted, passed }],
  students, modes, windows, today, now }`; `POST …/tests` `{ mode, passageId, day, time, windowMinutes, note? }` → 201 `{ test }` (409 `too_many`,
  `archived`); `GET …/tests/:tid` → `{ test, rows: [{ name, email, inBatch, state, starts, startedAt, submittedAt, result }] }`;
  `GET …/tests/:tid/results.csv`; `POST …/tests/:tid/cancel`. Students of the batch: `GET /api/me/batch-tests/:tid` → `{ test, batch, institute,
  mine: { starts, submittedAt, result } }`; `POST …/start` (409 `test_upcoming` / `test_closed` / `test_cancelled` / `already`).
  `POST /api/exams/results` takes `batchTestId` → `batchTest: { counted, why?: already | late | not_started | other_test | cancelled | not_yours }`.
  `GET /api/me/batches` adds `tests: [{ id, title, opensAt, closesAt, note, state, mine, link }]`.
- The Monday email (`src/institute-weekly.js`, docs/INSTITUTES.md §17): `GET /api/me/institute-email` → `{ weekly }` (503 `weekly_not_ready`
  before migration 0013), `PUT` `{ weekly: boolean }`. Template `institute_weekly` `{ name, from*, to*, institutes*: [{ name, link, batches:
  [{ name, students, practised, time, top, quiet, quietMore, link }] }], settingsUrl }` (transactional).
- Email template `institute_invite` `{ name, instituteName*, role*, invitedBy, email*, link* }`.
- Entitlements: `seats: [{ id, instituteId, instituteName, batchName, packageId, packageName, joinedAt, expiresAt }]`;
  a seat in an active institute inside its term counts like a plan period of its package.

## 7. Roles and route protection (site + billing)

- `src/roles.js`: `roleOf(env, user)` → `'owner'|'admin'|'support'|null`
  (OWNER_EMAILS → owner; else `admin_users`). What each role may do is no longer a list of
  roles per handler: every admin handler names a permission and
  `requirePermission(env, request, '<permission>')` (`src/console/session.js`) decides, from the
  catalogue and the Super Admin's switches. See `docs/ADMIN-CONSOLE.md` §4. People without a
  role still get 404 from the admin API.
- Pages: `public` (anyone), `guest` (signed-out only; signed-in → `/dashboard`),
  `user` (signed in; else 302 `/login?next=<path>`), `admin` (role; else 404).

## 8. Pages and routing (owner: site part) — `src/site.js`, `src/layout.js`, `src/pages/*.js`

Clean URLs, server-rendered layout (header, footer, `<title>`, meta description, canonical,
Open Graph, JSON-LD) around a page body. Page bodies are JS modules exporting a template
string (`export default \`…\``) so Node tests can import them. Page scripts are static files
`site/js/<name>.js`; shared styles `site/site.css`, shared helpers `site/site.js`
(`TC.api(method, path, body)`, `TC.toast`, `TC.formErrors`, `TC.money(paise)`, `TC.date`,
`TC.me()` cached session+entitlements).

Each page module also exports `meta = { path, title, description, access, nav?, noindex? }`.
Registries (so parts don't edit the same file):
`src/pages/public.js` (site part), `src/pages/auth.js` (site part),
`src/pages/account.js`, `src/pages/payment.js`, `src/pages/admin.js` (pages part).
Each exports `PAGES = [ { meta, body, scripts:['/site/js/x.js'] } ]`.

| Path | Access | Page |
|---|---|---|
| `/` | public | Home (conversion) |
| `/about` `/features` `/faq` `/contact` | public | |
| `/practice` | public | Typing Practice (explains course; CTA → `/app`) |
| `/typing-test` | public | Typing test (works signed out; saved + limited when signed in) |
| `/pricing` | public | Plans from `GET /api/packages` |
| `/privacy` `/terms` `/refund-policy` `/institute-terms` | public | legal (seller details from settings) |
| `/institute-guide` | public | how an institute runs its batches (docs/INSTITUTES.md §10) |
| `/signup` `/login` `/forgot-password` | guest | |
| `/reset-password` `/verify-email` `/verify-otp` | public | token/code in `#hash` |
| `/app` | user | the trainer (`index.html`), with plan locks |
| `/dashboard` | user | |
| `/account/profile` `/account/history` `/account/analytics` `/account/plans` `/account/payments` `/account/invoices` `/account/invoices/:number` `/account/settings` `/account/certificates` | user | |
| `/join` `/join/:code` | user | join an institute's batch with its code (docs/INSTITUTES.md §4) |
| `/checkout?plan=<id>` | user | |
| `/payment/processing` `/payment/success` `/payment/failure` `/payment/pending` | user | `?order=<id>` |
| `/admin` `/admin/users` `/admin/packages` `/admin/payments` `/admin/revenue` `/admin/emails` `/admin/settings` | admin | |
| `/sitemap.xml` `/robots.txt` | public | generated from the public registry |

- `/index.html`, `/login.html` → 301 to `/app`, `/login`. Old `/#reset=…` / `/#verify=…`
  links: Home page script forwards them to `/reset-password#token=…` / `/verify-email#token=…`.
- Host: `www.typecrafttyping.in` → 301 `https://typecrafttyping.in` (same path+query).
  `*.workers.dev` keeps working but sends `X-Robots-Tag: noindex` and canonical = SITE_URL.
- Headers on pages: CSP allowing self, `https://checkout.razorpay.com` (script),
  `https://api.razorpay.com` + `https://*.razorpay.com` (frame/connect), Google Fonts;
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Cache-Control: no-store` for user/admin pages, short cache for public pages.
- The service worker (`sw.js`) caches only the app (`X-TC-Page: app`) and its files.

## 9. Design system

One system for site, account, admin and the app: tokens from `css/next.css` (dark default;
`paper` light theme), fonts Fraunces (display), IBM Plex Sans (text), IBM Plex Mono (numbers,
labels). Read `docs/design-preview.html`. Premium, calm SaaS look: restrained colour (teal
accent, brass for paid/"recommended"), generous spacing, 12–16 px radii, subtle borders,
no heavy gradients, real empty/loading/error states, mobile-first (360 px up), visible focus,
WCAG AA contrast. Icons: inline SVG (one consistent 1.5 px stroke set, in `site/site.js`
`TC.icon(name)` or inline in templates). Money shown as `₹199`.

## 10. Secrets and settings checklist

Secrets: `RESEND_API_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
`SESSION_SECRET` (random 32+ bytes, used for OTP HMAC), `OWNER_EMAILS` (set),
optional `RESEND_WEBHOOK_SECRET`.
Vars (wrangler.jsonc `vars`, not secret): `SITE_URL=https://typecrafttyping.in`,
`EMAIL_FROM=TypeCraft <hello@typecrafttyping.com>`, `EMAIL_REPLY_TO=hello@typecrafttyping.com`.
`RAZORPAY_KEY_ID` is public by design (sent to checkout) but still set as a secret so test
and live keys can be swapped without a code change.

## 11. Shared UI vocabulary (site part builds it; every page uses only this)

Layouts (chosen by `meta.layout`): `site` (top nav + footer, public pages), `auth` (centred card,
small header), `account` (top bar + left side nav: Dashboard, Practice (/app), History, Analytics,
Plans, Payments, Invoices, Profile, Settings; becomes a top scroller on mobile), `admin` (same
shell, nav: Overview, Users, Packages, Payments, Revenue, Emails, Settings), `bare` (no chrome:
invoice print view, payment processing).

CSS classes in `site/site.css` (pages add their own small `<style>` only if needed):
`.container` `.narrow` · `.page-head` (h1 + `.lede` + actions) · `.section` · `.grid` `.grid-2`
`.grid-3` `.grid-4` · `.card` `.card-head` `.card-foot` · `.btn` `.btn-primary` `.btn-ghost`
`.btn-danger` `.btn-sm` `.btn-block` `[aria-busy=true]` · `.field` (label, input/select/textarea,
`.hint`, `.err`) `.field-row` `.check` · `.table-wrap` `.table` (th, td, `.num`) ·
`.badge` `.badge-ok` `.badge-warn` `.badge-bad` `.badge-muted` `.badge-brand` · `.stat`
(`.stat-label` `.stat-value` `.stat-sub`) · `.tabs` (buttons with `aria-selected`) · `.empty`
(icon, title, text, action) · `.skeleton` · `.alert` `.alert-ok` `.alert-bad` `.alert-info` ·
`.price` · `.plan-card` `.plan-card.recommended` · `.chart` (inline SVG charts) · `.kbd` ·
`.muted` `.mono` `.sr-only`.

`site/site.js` → global `TC`:
`TC.api(method, path, body?) → {ok, status, data, error}` (JSON, same-origin, never throws),
`TC.me() → Promise<{user, entitlements, role} | null>` (cached per page),
`TC.toast(text, kind?)`, `TC.formValues(form)`, `TC.formErrors(form, fields|null, message?)`,
`TC.busy(button, on)`, `TC.money(paise) → '₹199'`, `TC.date(iso) / TC.dateTime(iso)`,
`TC.qs(name)` (query param), `TC.icon(name) → svg string`, `TC.esc(text)` (HTML-escape),
`TC.chart.line(el, series, opts)` / `TC.chart.bars(el, rows, opts)` (small SVG charts),
`TC.paginate(el, {page, pages, onPage})`. Pages never use `innerHTML` with unescaped data.
