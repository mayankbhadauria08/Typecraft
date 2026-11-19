# Admin console, Phase 4: Business growth

The work order for Phase 4. Read `docs/ADMIN-CONSOLE.md` and `docs/ADMIN-PHASE-2.md` first: the
rules and conventions there hold here too.

Phase 4 ships as three stacked pull requests, merged in order. Each is cut from the one before, so
merging 4a, then 4b, then 4c gives the whole phase. Nothing is merged, and nothing is applied to the
live database, without the owner's yes.

| PR | Branch | Contents | Migration |
| --- | --- | --- | --- |
| 4a | `console/phase4a-support-reports` | Support inbox, Business reports | `0014_support.sql` |
| 4b | `console/phase4b-campaigns` | Email campaigns, learner notifications | `0015_campaigns.sql` |
| 4c | `console/phase4c-coupons` | Coupons, promotions, checkout | `0016_coupons.sql` |

## Status

| Step | What | Status |
| --- | --- | --- |
| 4a | Support: inbox, message page, reply by email, notes, status, who looks after it | built |
| 4a | Business reports: sales, refunds, sign-ups, buyers, plans ending, CSV | built |
| 4b | Email campaigns: audiences, test send, schedule, daily limit, stop; the email log | built |
| 4b | Notifications: messages for learners on the site and in the trainer | built |
| 4c | Coupons and promotions, applied at checkout | see the 4c PR |

## 1. Decisions

- **Email stays on the Resend free plan.** Campaigns respect a daily cap set in the console
  (default 80 a day, leaving room for sign-in codes and receipts inside Resend's 100 a day).
  Bigger campaigns spread over several days on their own. Raising the cap is one setting once the
  plan is upgraded.
- **Notifications are for learners**: short messages shown on the site and in the trainer, managed
  in the console. They are not staff alerts.
- **Coupons**: Super Admin always; Admin only if `coupons.manage` is switched on for Admin. When a
  coupon and a promotion both apply, the customer gets the better of the two, never both.
- **Support replies go out by email from the console**, from the normal sending address with
  `reply_to` set to the support address, so the customer's answer lands in the support inbox and
  not in a no-reply box.

## 2. Support (4a)

Pages: `/console/support` (inbox) and `/console/support/msg_…` (one message).
API: `src/console/support-api.js`. Data: `contact_messages` (already there) plus
`support_replies` and `support_assignments` (`migrations/0014_support.sql`).

- **Inbox**: search by name, email, words in the message or the message ID; filter by status
  (new, answered, closed, or "still open" = new or answered), topic, and who looks after it (me,
  nobody, a named person). New first, then priority (customers whose plan includes priority
  support), then newest. Counts by status above the list.
- **Message page**: the message, the thread of replies and staff notes, the sender (with a link
  to the customer when they were signed in), status and who looks after it, the history of
  changes, and earlier messages from the same email address.
- **Reply by email** (`support.reply`): uses the `support_reply` template with the customer's
  original message quoted. The reply is saved only if the email was accepted; if sending fails the
  typed text stays in the box. "Then mark it answered" or "Then close it" (closing also needs
  `support.manage`). Limits: one reply per message every 5 seconds (stops double clicks), 60
  replies an hour per staff member. If email isn't set up, the box says so and nothing is sent.
- **Notes** (`support.manage`): staff only, up to 2,000 characters, never emailed.
- **Status and who looks after it** (`support.manage`): anyone with console access who is active
  can be picked. Each change is written to the activity log (`support.status`, `support.assign`).
- The activity log stores the length of a reply, not its text.
- Support's default permissions: Admin and Support can see, reply and manage.

## 3. Business reports (4a)

Page: `/console/reports`. API: `src/console/reports-api.js`. Needs `revenue.view` (Admin yes,
Support no by default). No new tables.

- Periods: last 7 days, 30 days, 90 days (by week), 12 months (by month). Days are India days.
- **Money**: net sales, sales (orders and average), refunds, buyers (and first-time buyers), each
  compared with the period before. A sale counts on the day it was paid (orders that were later
  refunded still count as sales; the refund counts on the day it was sent).
- **Net sales chart** and **sales by plan**; **why money went back** groups refund reasons by the
  text before the first colon.
- **Customers**: sign-ups (staff left out), how many of them bought a plan, paying now, ever paid.
- **Plans ending soon**: counts for 7 and 30 days, the next ten, and plans that ended in the
  period with no new plan after.
- **Download**: by day or by plan, as CSV in rupees. No names or emails in the files.

## 4. Email campaigns and the email log (4b)

Pages: `/console/campaigns`, `/console/campaigns/cmp_…`, `/console/email-log`.
API: `src/console/campaigns-api.js`. Data: `email_campaigns`, `campaign_sends` (`migrations/0015_campaigns.sql`);
the daily limit is `platform_settings` key `campaigns` (`{"dailyCap": 80}`).

- **Audiences**: everyone who gets product news; people on Free; people with any paid plan; people on
  one plan; people who haven't practised for 7, 14 or 30 days (joined before then, and no lesson,
  game or test since). Always only active accounts with a confirmed email address whose product-news
  setting is on (the same switch as the unsubscribe link). The editor shows how many people that is now.
- **A draft** (`campaigns.write`, Admin yes, Support no): name (for the team), subject, the email in
  plain text (blank line = new paragraph), audience. "Send a test to me" sends it to yourself with
  `[Test]` in the subject. A draft can be changed or deleted; nothing else can.
- **Sending** (`emails.announce`, now called "Send campaigns"; Admin yes, Support no): start now, or
  at a set time up to 90 days ahead. A scheduled campaign can be taken off the schedule (back to a
  draft) or cancelled. When its time comes, the people are fixed (`campaign_sends`), and the
  10-minute cron hands up to 40 at a time to Resend, never more than the daily limit in any 24 hours.
  Each person is checked again just before their turn: closed accounts and people who turned off
  product news in the meantime are skipped. Every email is an ordinary `announcement` email in
  `email_logs`, with the unsubscribe link and the normal retries.
- **Stop sending**: people not reached yet never get it. Sent campaigns are kept as a record; "Copy into
  a new draft" starts a new one from it.
- **Daily limit** (`campaigns.limit`, Super Admin only, asks for the password again): default 80, because
  Resend's free plan allows 100 emails a day in all and sign-in codes, receipts and support replies must
  still go through. Raise it after upgrading the Resend plan.
- **The old `/admin` Announcement** now creates a campaign that starts at once, so it also keeps to the
  daily limit (until migration 0015 is applied it works the old way).
- **Email log** (`emails.view`; "Send again" needs `emails.retry`): every email, newest first, by
  status, kind, address or subject, with the counts for the last 24 hours. Sign-in codes and links are
  never sent again.

## 5. Notifications for learners (4b)

Page: `/console/notifications`. API: `src/console/notices-api.js` (`notices.view`: Admin and Support;
`notices.manage`: Admin). Learners: `src/notices.js`, `GET /api/notices?place=site|trainer`.
Data: `site_notices` (`migrations/0015_campaigns.sql`).

- A notification is one line (up to 200 characters) with an optional link (a page on the site such as
  `/pricing`, or an `https://` address), a kind (information, offer, warning: green, gold, red), who
  sees it (everyone, people not signed in, everyone signed in, signed in on Free, signed in with a paid
  plan), where (website, trainer, or both), and optional start and end times. It can be turned off
  and on, changed and deleted.
- **On the website** it is a bar under the header, drawn with the page (no extra request; the list is
  remembered for a minute per Worker and cleared on every console change). **In the trainer** it is a
  note at the top of the home screen, fetched once the trainer has started.
- At most two show at a time, newest first. A learner can close one: it is remembered for 60 days in
  the `tc_nd` cookie, shared by the site and the trainer, so it stays closed in both.

## 6. Going live

Same pattern as before: a restore bookmark first, then the migration by hand (never
`wrangler d1 migrations apply`), then merge. Steps with the checks: `docs/LAUNCH.md` §1k and §1l.

1. Bookmark, then apply `migrations/0014_support.sql` (two new tables; changes no rows).
2. Merge 4a. Until the migration is applied, the Support pages answer "not switched on yet" (503)
   and Business reports work (they need no new table).
3. Bookmark, then apply `migrations/0015_campaigns.sql` (three new tables; changes no rows).
4. Merge 4b. Learners see "Update ready, reload" once (`sw.js` changed). Until 0015 is applied, the
   campaign and notification pages answer "not switched on yet", learners see no notices, and the old
   `/admin` Announcement works as before.
