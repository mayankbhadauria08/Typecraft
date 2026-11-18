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
2. **[You] Merge the Phase 2 PR.** Learners see "Update ready, reload" once (`sw.js` changed).
3. Refunds stay a Super Admin task until you switch `payments.refund` on for Admin in Roles and
   permissions. Real refunds and "Check with Razorpay" need the Razorpay keys; test them in Test
   Mode first.

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
