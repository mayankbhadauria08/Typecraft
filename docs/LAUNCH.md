# TypeCraft paid launch: what's built and what to do

Branch `saas/integration` (PR "TypeCraft SaaS"). Nothing here is live until the PR is merged.
Who does what: **[You]** = needs your login (GoDaddy, Google Workspace, Resend, Razorpay, Cloudflare);
**[Claude]** = I can do it once you say go.

## 1. Order of go-live

1. **[You] Domain hold.** GoDaddy has typecrafttyping.in on *Registrar Hold* (usually the .IN eKYC or an
   unconfirmed registrant email). Finish the verification or ask GoDaddy support to lift it.
2. **[You] Nameservers** (GoDaddy → typecrafttyping.in → DNS → Nameservers → "I'll use my own"):
   `elly.ns.cloudflare.com`, `hans.ns.cloudflare.com` (remove `ns43/ns44.domaincontrol.com`; DNSSEC off).
   The zone already exists in Cloudflare (Free plan). typecrafttyping.com stays at GoDaddy untouched.
3. **[You] Razorpay Test Mode keys** → Cloudflare → Workers & Pages → **typecraft** → Settings →
   Variables and secrets → Add (type **Secret**):
   `RAZORPAY_KEY_ID` (rzp_test_…), `RAZORPAY_KEY_SECRET`.
4. **[You] Razorpay webhook**: Razorpay Dashboard (Test Mode) → Settings → Webhooks → Add:
   URL `https://typecrafttyping.in/api/webhooks/razorpay` (until the domain works:
   `https://typecraft.mayankbhadauria08.workers.dev/api/webhooks/razorpay`), a secret you make up,
   events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`,
   `refund.processed`, `refund.failed`. Put the same secret in Cloudflare as `RAZORPAY_WEBHOOK_SECRET`.
5. **[You] `SESSION_SECRET`** (Secret): any random 40+ characters (e.g. a password-manager
   generated string). Turns on email sign-in codes and signed unsubscribe links.
6. **[You] Resend** (resend.com, sign up with hello@typecrafttyping.com) → Domains → add
   `typecrafttyping.com`. Resend shows 3–4 records (an MX + TXT on a `send` subdomain, a DKIM TXT
   `resend._domainkey`). Add them in **GoDaddy DNS for typecrafttyping.com**. They don't touch your
   Google Workspace records (Google's MX and the root SPF stay as they are). Then add a DMARC
   record if there isn't one: TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:hello@typecrafttyping.com`.
   API Keys → Create (Sending access) → Cloudflare secret `RESEND_API_KEY`.
7. **[Claude] Database**: apply `migrations/0003_saas.sql` to the live D1 (adds tables only; I take a
   restore bookmark first, as before).
8. **[You/Claude] Merge the PR** → Workers Builds deploys to the `typecraft` Worker.
9. **[Claude] Custom domain** (after step 2 shows "Active" in Cloudflare): Worker → Settings →
   Domains & Routes → add `typecrafttyping.in` and `www.typecrafttyping.in` (the Worker sends www to
   the apex). Then test the full journey in Razorpay Test Mode with Razorpay's test card/UPI.
10. **[You] Seller details**: /admin/settings → your legal name and address (shown on invoices and
    the legal pages; placeholders until then).
11. **[You] Go live with real money**: after Razorpay activates your account (KYC + website review),
    replace the two key secrets with the `rzp_live_…` pair and add a Live-mode webhook with the same
    URL. Nothing else changes.

## 1b. The new admin console (Phase 1)

Lives at `/console` beside the current `/admin`. Full notes: `docs/ADMIN-CONSOLE.md`.

1. **[Claude] Database**: apply `migrations/0005_admin_console.sql` to the live D1 (adds two
   tables only; restore bookmark first). Until then `/console/login` says the console isn't
   switched on and nothing else changes.
2. **[You] Merge the Phase 1 PR.** Check the build on `main` is green (the PR also changes how
   static files are served, `docs/ADMIN-CONSOLE.md` §8).
3. Sign in at `/console/login` with your TypeCraft email and password. With `SESSION_SECRET` and
   email sending set up, it also asks for a code sent to your email; until then it is password only.

## 1c. The admin console, Phase 2 (core operations)

Full notes: `docs/ADMIN-PHASE-2.md`.

1. **[Claude] Database**: take a restore bookmark in the D1 console (`/bookmark`, write it down
   here), then apply `migrations/0006_admin_core.sql` (three new tables, plus three indexes on existing tables; adds only, no row changes).
   The live database has no `d1_migrations` table: never run `wrangler d1 migrations apply`.
   Check with `SELECT name FROM sqlite_master WHERE name IN ('customer_notes', 'access_overrides', 'refund_choices')`.
   **Done 19 Nov 2026, 00:50 IST.** Restore bookmark taken just before:
   `0000025b-00000004-00005127-a9f38cd8e4f349ba5bd941b62dc57df7` (D1 console:
   `/restore <bookmark>`). Checked after: the three tables and six indexes exist; users 2,
   refunds 0, audit_logs 1, the same as before.
2. **[You] Merge the Phase 2 PR.** Learners see "Update ready, reload" once (`sw.js` changed).
3. Refunds stay a Super Admin task until you switch `payments.refund` on for Admin in Roles and
   permissions. Real refunds and "Check with Razorpay" need the Razorpay keys; test them in Test
   Mode first.

## 1d. Unlock conditions (which lessons learners can open)

Full notes: `docs/UNLOCK-RULES.md`. No database change: the rules live in the existing
`platform_settings` table, and nothing changes for learners until someone sets a rule.

1. **[You] Merge the pull request.** Learners see "Update ready, reload" once (`sw.js` changed).
2. To change what a plan includes: Console, Packages, open the plan, Lessons. To close or open a
   lesson or level for everyone, or switch on unlock by progress: Console, Unlock conditions.
3. If you change what Free includes, also check Free's description on its package page (it is your
   own text, and says "the first five lessons" today). The site's other wording follows by itself.

## 1e. The admin console, Phase 3 (learning operations)

Full notes: `docs/ADMIN-PHASE-3.md`. Merge the Unlock conditions pull request (§1d) first: this
one builds on it.

1. **[Claude, after your OK] Database**: take a restore bookmark in the D1 console (write it down
   here), then apply `migrations/0007_course.sql` (two new tables, `course_drafts` and
   `course_releases`; adds only, no row changes). Never `wrangler d1 migrations apply`.
   Check with `SELECT name FROM sqlite_master WHERE name IN ('course_drafts', 'course_releases')`.
   **Done 19 Nov 2026, 02:50 IST.** Restore bookmark taken just before:
   `00000271-00000000-00005127-32b399a69ed595eccfa208e1a1804266` (D1 console:
   `/restore <bookmark>`). Checked after: both tables exist and are empty; users 2,
   lesson_scores 2, audit_logs 2, the same as before; 57 tables became 59. Live site answered
   normally afterwards.
2. **[You] Merge the Phase 3 pull request.** Learners see "Update ready, reload" once (`sw.js`
   changed). Until someone publishes a change, learners get the course exactly as today.
3. Course changes reach learners only when a Super Admin publishes them (Console, Courses), with a
   note; each published version can be looked at and gone back to. Admin can write drafts;
   publishing stays a Super Admin task unless you switch `course.publish` on for Admin.

## 1f. Exam practice and verifiable certificates

Full notes: `docs/EXAM-MODES.md`.

1. **[Claude, after your OK] Database**: take a restore bookmark in the D1 console (write it down
   here), then apply `migrations/0008_exams.sql` (two new tables, `exam_results` and
   `certificate_codes`; adds only, no row changes). Never `wrangler d1 migrations apply`.
   Check with `SELECT name FROM sqlite_master WHERE name IN ('exam_results', 'certificate_codes')`.
   Before this, exam practice still marks tests on the page but can't save them, and certificates
   print without a code.
   **Done 19 Nov 2026, 03:55 IST.** Restore bookmark taken just before:
   `00000283-00000000-00005127-b29994f2730f7bef7641ca485fc6b735` (D1 console:
   `/restore <bookmark>`). Checked after: both tables and both indexes exist and are empty; users 2,
   certificates 0, lesson_scores 2, audit_logs 2, the same as before; 59 tables became 61. Live
   site answered normally afterwards.
2. **[You] Merge the pull request.** Learners see "Update ready, reload" once (`sw.js` changed).
3. Read the two new lines in the Privacy policy (section 1 and 2); its date is now 19 November 2026.

## 1g. The admin console, Phase 4a (Support and Business reports)

Full notes: `docs/ADMIN-PHASE-4.md`. Phase 4 comes as three pull requests (4a, 4b, 4c); merge them
in that order.

1. **[Claude, after your OK] Database**: take a restore bookmark in the D1 console (write it down
   here), then apply `migrations/0009_support.sql` (two new tables, `support_replies` and
   `support_assignments`; adds only, no row changes). Never `wrangler d1 migrations apply`.
   Check with `SELECT name FROM sqlite_master WHERE name IN ('support_replies', 'support_assignments')`.
2. **[You] Merge the 4a pull request.** Nothing changes for learners.
3. Replies from the console are emailed from the normal sending address with "reply to" set to
   the support address in Settings, so the customer's answer comes back to that inbox.

## 1h. The admin console, Phase 4b (Email campaigns and Notifications)

Full notes: `docs/ADMIN-PHASE-4.md` §4–5. Merge 4a (§1g) first: this builds on it.

1. **[Claude, after your OK] Database**: take a restore bookmark in the D1 console (write it down
   here), then apply `migrations/0010_campaigns.sql` (three new tables, `email_campaigns`,
   `campaign_sends` and `site_notices`; adds only, no row changes). Never `wrangler d1 migrations apply`.
   Check with `SELECT name FROM sqlite_master WHERE name IN ('email_campaigns', 'campaign_sends', 'site_notices')`.
2. **[You] Merge the 4b pull request.** Learners see "Update ready, reload" once (`sw.js` changed).
3. Campaigns send at most 80 emails a day (Resend's free plan allows 100 a day for everything). After
   upgrading Resend, raise the limit in Console › Email campaigns › Change the limit.

## 2. Secrets and settings checklist

| Name | Where | Required | What |
|---|---|---|---|
| `RAZORPAY_KEY_ID` | Cloudflare secret | for payments | `rzp_test_…` now, `rzp_live_…` later |
| `RAZORPAY_KEY_SECRET` | Cloudflare secret | for payments | from Razorpay → API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | Cloudflare secret | for payments | the secret typed in the Razorpay webhook |
| `RESEND_API_KEY` | Cloudflare secret | for email | Resend → API Keys |
| `SESSION_SECRET` | Cloudflare secret | for codes | random 40+ characters |
| `OWNER_EMAILS` | Cloudflare secret | set ✓ | mayankbhadauria08@gmail.com |
| `RESEND_WEBHOOK_SECRET` | Cloudflare secret | optional | Resend webhook (delivered/bounced) |
| `ADMIN_EMAIL_CODE` | Cloudflare variable | optional | `off` = admin sign-in without the emailed code (only if email is down) |
| `SITE_URL` | wrangler.jsonc var | set ✓ | https://typecrafttyping.in |
| `EMAIL_FROM` / `EMAIL_REPLY_TO` | wrangler.jsonc vars | set ✓ | TypeCraft <hello@typecrafttyping.com> |

Without the Razorpay secrets the site works but "Pay" answers "Payments are not available right now".
Without `RESEND_API_KEY` emails are logged as failed (visible in /admin/emails) and sign-up still works.

## 3. Known limits (honest)

- Lesson texts are generated by public JavaScript, so a technical user could read locked lessons'
  text. What the server enforces: saving progress/stars/XP for locked lessons and games, premium
  exercise packs, advanced analytics, insights, certificates printing and typing-test limits.
- Plans are one-time payments for a period (no automatic renewal). Renewing = buying again; time
  is added after the current period.
- Deleting an account currently also deletes its orders and invoices (decision pending).
