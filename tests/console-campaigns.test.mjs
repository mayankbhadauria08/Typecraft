// Admin console, Phase 4b: email campaigns, the email log and notifications for learners (docs/ADMIN-PHASE-4.md §4–5).
//   node --test tests/console-campaigns.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, assertNoInlineCode } from './console-kit.mjs';
import { runCampaigns } from '../src/console/campaigns-api.js';
import { forgetAll } from '../src/memo.js';

const realFetch = globalThis.fetch;
const DAY = 86400000;
let S, K, owner, admin, support, outbox;
const C = {};

before(async () => {
  outbox = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) { outbox.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 're_' + outbox.length }), { status: 200 }); }
    return realFetch(url, init);
  };
  const env = makeEnv({ OWNER_EMAILS: 'boss@example.com', SITE_URL: 'https://typecraft.test', RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'TypeCraft <hello@typecraft.test>',
    SESSION_SECRET: undefined });
  S = { env, srv: await startServer(env, 8772) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.72.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));
  const old = new Date(Date.now() - 40 * DAY).toISOString();
  // free and practising; free and away for 40 days; on Starter; not confirmed; turned off news; closed
  C.active = await K.customer({ name: 'Asha Verma', email: 'asha@example.com', createdAt: old });
  C.away = await K.customer({ name: 'Ravi Kumar', email: 'ravi@example.com', createdAt: old });
  C.paid = await K.customer({ name: 'Neha Shah', email: 'neha@example.com' });
  C.unconfirmed = await K.customer({ name: 'Not Confirmed', email: 'nc@example.com', verified: 0 });
  C.noNews = await K.customer({ name: 'No News', email: 'nonews@example.com' });
  C.closed = await K.customer({ name: 'Closed Account', email: 'closed@example.com', status: 'disabled' });
  await K.subscription(C.paid, 'starter', { days: 30, source: 'purchase' });
  await K.run("INSERT INTO events (user_id, id, type, day, server_at) VALUES (?1, 'ev1', 'run', '2026-11-19', ?2)", C.active, new Date().toISOString());
  await K.run('INSERT INTO email_preferences (user_id, announcements, test_results, login_alerts, updated_at) VALUES (?1, 0, 0, 1, ?2)', C.noNews, new Date().toISOString());
});
after(() => { S.srv.server.close(); globalThis.fetch = realFetch; });

const count = async (c, audience) => {
  const r = await c('GET', '/api/console/campaigns/audience?audience=' + encodeURIComponent(audience));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.count;
};
const draft = async (c, body) => {
  const r = await c('POST', '/api/console/campaigns', { name: 'Test', subject: 'Hello', body: 'New lessons are ready for you.', audience: 'all', ...body });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id;
};
const setCap = async (n) => assert.equal((await owner('PUT', '/api/console/campaigns/limit', { dailyCap: n })).status, 200);

/* ---------------- audiences ---------------- */
test('audiences: confirmed, active people who get product news, narrowed by plan or by not practising lately', async () => {
  assert.equal(await count(support, 'all'), 3, 'Asha, Ravi and Neha: not the unconfirmed, the one who turned news off, or the closed account');
  assert.equal(await count(support, 'free'), 2);
  assert.equal(await count(support, 'paid'), 1);
  assert.equal(await count(support, 'plan:starter'), 1);
  assert.equal(await count(support, 'plan:pro'), 0);
  assert.equal(await count(support, 'inactive:30'), 1, 'only Ravi: Asha practised today and Neha joined today');
  const r = await support('GET', '/api/console/campaigns/audience?audience=all');
  assert.equal(r.body.dailyCap, 80);
  assert.equal(r.body.days, 1);
  for (const bad of ['everyone', 'inactive:5', 'plan:', 'plan:x y']) assert.equal((await support('GET', '/api/console/campaigns/audience?audience=' + encodeURIComponent(bad))).status, 400, bad);
});

/* ---------------- drafts ---------------- */
let A;
test('a draft: written, changed and tested by Admin; Support may look but not write', async () => {
  const empty = await admin('POST', '/api/console/campaigns', { name: '', subject: '', body: 'short', audience: 'nobody' });
  assert.equal(empty.status, 400);
  assert.deepEqual(Object.keys(empty.body.error.fields).sort(), ['audience', 'body', 'name', 'subject']);
  assert.equal((await admin('POST', '/api/console/campaigns', { name: 'X', subject: 'Y', body: 'Long enough text.', audience: 'plan:gold' })).body.error.fields.audience,
    'That plan no longer exists. Choose another.');
  assert.equal((await support('POST', '/api/console/campaigns', { name: 'X', subject: 'Y', body: 'Long enough text.', audience: 'all' })).status, 403);

  A = await draft(admin, { name: 'Come back offer', subject: 'We miss you', body: 'Hi there.\n\nYour lessons are waiting.', audience: 'free' });
  const changed = await admin('PUT', `/api/console/campaigns/${A}`, { name: 'Come back offer', subject: 'We miss you at TypeCraft', body: 'Your lessons are waiting.\n\nPick up where you left off.', audience: 'free' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));

  outbox.length = 0;
  const t = await admin('POST', `/api/console/campaigns/${A}/test`, {});
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(outbox.length, 1);
  assert.deepEqual(outbox[0].to, [admin.who.email]);
  assert.equal(outbox[0].subject, '[Test] We miss you at TypeCraft');
  assert.match(outbox[0].text, /Pick up where you left off\./);
  assert.match(outbox[0].html, /Unsubscribe from announcements/);

  const one = await support('GET', `/api/console/campaigns/${A}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.campaign.status, 'draft');
  assert.equal(one.body.campaign.audienceLabel, 'People on Free');
  assert.equal(one.body.reach, 2);
  assert.deepEqual(one.body.can, { write: false, send: false });
  assert.deepEqual(one.body.history.map((h) => h.action).sort(), ['campaign.create', 'campaign.test', 'campaign.update']);
  assert.equal((await support('GET', '/api/console/campaigns/cmp_nothere1')).status, 404);
  assert.equal((await support('POST', `/api/console/campaigns/${A}/schedule`, {})).status, 403, 'Support cannot send');
});

/* ---------------- sending ---------------- */
test('the daily limit: only a Super Admin changes it, and it must be a sensible number', async () => {
  assert.equal((await admin('PUT', '/api/console/campaigns/limit', { dailyCap: 500 })).status, 403);
  assert.equal((await owner('PUT', '/api/console/campaigns/limit', { dailyCap: 0 })).status, 400);
  assert.equal((await owner('PUT', '/api/console/campaigns/limit', { dailyCap: 9999 })).status, 400);
  await K.stale(owner);
  const stale = await owner('PUT', '/api/console/campaigns/limit', { dailyCap: 50 });
  assert.equal(stale.status, 403); assert.equal(stale.body.error.code, 'reauth_required');
  assert.equal((await owner('POST', '/api/admin/auth/reauth', { password: 'correct horse 9' })).status, 200);
  await setCap(1);
  const list = await support('GET', '/api/console/campaigns');
  assert.deepEqual(list.body.limit, { dailyCap: 1, usedToday: 0 });
  assert.deepEqual(list.body.can, { write: false, send: false, limit: false });
  assert.deepEqual((await K.audits('campaign.limit')).map((a) => JSON.parse(a.detail)), [{ from: 80, to: 1 }]);
});

test('send now: the people are fixed, emails go within the daily limit, anyone who turns news off before their turn is skipped', async () => {
  outbox.length = 0;
  const r = await admin('POST', `/api/console/campaigns/${A}/schedule`, { sendAt: null });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await K.settle();
  let c = (await admin('GET', `/api/console/campaigns/${A}`)).body;
  assert.equal(c.campaign.status, 'sending');
  assert.equal(c.campaign.total, 2);
  assert.deepEqual(c.progress, { waiting: 1, sent: 1, failed: 0, skipped: 0, cancelled: 0 }, 'the limit is 1 a day');
  assert.equal(outbox.length, 1);
  assert.ok(['asha@example.com', 'ravi@example.com'].includes(outbox[0].to[0]));
  assert.equal(outbox[0].subject, 'We miss you at TypeCraft');
  assert.ok(outbox[0].headers['List-Unsubscribe']);
  // the next run: the limit is used up
  assert.deepEqual(await runCampaigns(S.env), { started: 0, sent: 0, failed: 0, skipped: 0 });
  assert.equal((await admin('GET', '/api/console/campaigns')).body.limit.usedToday, 1);
  // both turn news off; with room again, the one still waiting is skipped, and the campaign is done
  for (const id of [C.active, C.away]) {
    await K.run(`INSERT INTO email_preferences (user_id, announcements, test_results, login_alerts, updated_at) VALUES (?1, 0, 0, 1, ?2)
                 ON CONFLICT (user_id) DO UPDATE SET announcements = 0`, id, new Date().toISOString());
  }
  await setCap(80);
  assert.deepEqual(await runCampaigns(S.env), { started: 0, sent: 0, failed: 0, skipped: 1 });
  c = (await admin('GET', `/api/console/campaigns/${A}`)).body;
  assert.equal(c.campaign.status, 'sent');
  assert.ok(c.campaign.finishedAt);
  assert.deepEqual(c.progress, { waiting: 0, sent: 1, failed: 0, skipped: 1, cancelled: 0 });
  assert.equal(outbox.length, 1);
  assert.deepEqual(JSON.parse((await K.audits('campaign.start'))[0].detail), { total: 2 });
  // a sent campaign is a record: it can't be changed or deleted
  assert.equal((await admin('PUT', `/api/console/campaigns/${A}`, { name: 'x', subject: 'y', body: 'long enough', audience: 'all' })).status, 409);
  assert.equal((await admin('DELETE', `/api/console/campaigns/${A}`, {})).status, 409);
  assert.equal((await admin('POST', `/api/console/campaigns/${A}/cancel`, {})).status, 409);
  // put their news back on for the next tests
  await K.run('UPDATE email_preferences SET announcements = 1 WHERE user_id IN (?1, ?2)', C.active, C.away);
});

test('scheduled for later: nothing goes before its time; it can be taken off the schedule, or stopped while sending', async () => {
  const B = await draft(admin, { name: 'Starter news', audience: 'plan:starter' });
  assert.equal((await admin('POST', `/api/console/campaigns/${B}/schedule`, { sendAt: new Date(Date.now() - 10 * 60000).toISOString() })).status, 400);
  assert.equal((await admin('POST', `/api/console/campaigns/${B}/schedule`, { sendAt: new Date(Date.now() + 100 * DAY).toISOString() })).status, 400);
  const at = new Date(Date.now() + DAY).toISOString();
  const s = await admin('POST', `/api/console/campaigns/${B}/schedule`, { sendAt: at });
  assert.equal(s.status, 200); assert.equal(s.body.message, 'Scheduled.');
  assert.equal((await admin('PUT', `/api/console/campaigns/${B}`, { name: 'x', subject: 'y', body: 'long enough', audience: 'all' })).status, 409, 'take it off the schedule first');
  assert.equal((await runCampaigns(S.env)).started, 0);
  assert.equal((await admin('POST', `/api/console/campaigns/${B}/unschedule`, {})).status, 200);
  assert.equal((await admin('GET', `/api/console/campaigns/${B}`)).body.campaign.status, 'draft');
  assert.equal((await admin('DELETE', `/api/console/campaigns/${B}`, {})).status, 200);
  assert.equal((await admin('GET', `/api/console/campaigns/${B}`)).status, 404);

  // the time comes (the cron's clock is moved on a day)
  const D = await draft(admin, { name: 'Everyone news', audience: 'all' });
  assert.equal((await admin('POST', `/api/console/campaigns/${D}/schedule`, { sendAt: at })).status, 200);
  await setCap(1);
  outbox.length = 0;
  const later = new Date(Date.now() + DAY + 60000).toISOString();
  const run = await runCampaigns(S.env, { now: later });
  assert.equal(run.started, 1);
  let c = (await admin('GET', `/api/console/campaigns/${D}`)).body;
  assert.equal(c.campaign.status, 'sending');
  assert.equal(c.campaign.total, 3);
  // stop it: the people still waiting never get it
  const stop = await admin('POST', `/api/console/campaigns/${D}/cancel`, {});
  assert.equal(stop.status, 200, JSON.stringify(stop.body));
  c = (await admin('GET', `/api/console/campaigns/${D}`)).body;
  assert.equal(c.campaign.status, 'cancelled');
  assert.equal(c.progress.cancelled, stop.body.notSent);
  assert.equal(c.progress.cancelled + c.progress.sent, 3);
  await setCap(80);
  const sentBefore = outbox.length;
  await runCampaigns(S.env);
  assert.equal(outbox.length, sentBefore, 'nothing more after it was stopped');
  const list = await admin('GET', '/api/console/campaigns?status=cancelled');
  assert.deepEqual(list.body.items.map((x) => x.id), [D]);
  assert.equal(list.body.items[0].progress.cancelled, stop.body.notSent);
});

test('the old /admin announcement now goes out as a campaign, so it keeps to the daily limit', async () => {
  outbox.length = 0;
  const r = await owner('POST', '/api/admin/announcements', { subject: 'Big news', body: 'We have new lessons.', audience: 'all' });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  assert.equal(r.body.queued, 3);
  assert.match(r.body.campaignId, /^cmp_/);
  await K.settle();
  const c = (await owner('GET', `/api/console/campaigns/${r.body.campaignId}`)).body;
  assert.equal(c.campaign.name, 'Announcement: Big news');
  assert.equal(c.campaign.status, 'sent');
  assert.equal(c.progress.sent, 3);
  assert.deepEqual(outbox.map((m) => m.to[0]).sort(), ['asha@example.com', 'neha@example.com', 'ravi@example.com']);
});

/* ---------------- the email log ---------------- */
test('the email log: every email with filters; a failed one can be sent again, a code never', async () => {
  const all = await support('GET', '/api/console/emails');
  assert.equal(all.status, 200);
  assert.ok(all.body.total >= 5);
  assert.equal(all.body.kinds.announcement, 'Campaign or announcement');
  assert.equal(all.body.can.retry, false);
  const ann = await support('GET', '/api/console/emails?kind=announcement&q=neha');
  assert.ok(ann.body.items.length >= 1 && ann.body.items.every((e) => e.to === 'neha@example.com' && e.template === 'announcement'));
  assert.ok(ann.body.items.every((e) => e.retryable === false), 'Support cannot retry');

  const now = new Date().toISOString();
  await K.run(`INSERT INTO email_logs (id, user_id, to_email, template, category, subject, payload, status, provider, attempts, last_error, created_at, updated_at)
               VALUES ('em_failed_1', ?1, 'ravi@example.com', 'announcement', 'platform', 'Hello', ?2, 'failed', 'resend', 5, 'http_500', ?3, ?3)`,
  C.away, JSON.stringify({ data: { name: 'Ravi', subject: 'Hello', body: 'Again please.' } }), now);
  await K.run(`INSERT INTO email_logs (id, user_id, to_email, template, category, subject, payload, status, provider, attempts, last_error, created_at, updated_at)
               VALUES ('em_code_1', ?1, 'ravi@example.com', 'otp_login', 'auth', 'Your code', '{}', 'failed', 'resend', 1, 'http_500', ?2, ?2)`, C.away, now);
  const failed = await admin('GET', '/api/console/emails?status=failed');
  assert.ok(failed.body.items.find((e) => e.id === 'em_failed_1').retryable);
  assert.equal(failed.body.items.find((e) => e.id === 'em_code_1').retryable, false);
  assert.equal((await support('POST', '/api/console/emails/em_failed_1/retry', {})).status, 403);
  assert.equal((await admin('POST', '/api/console/emails/em_code_1/retry', {})).status, 409);
  outbox.length = 0;
  const again = await admin('POST', '/api/console/emails/em_failed_1/retry', {});
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.result, 'sent');
  assert.equal(again.body.email.status, 'sent');
  assert.deepEqual(outbox[0].to, ['ravi@example.com']);
  assert.equal((await admin('POST', '/api/console/emails/em_failed_1/retry', {})).status, 409, 'only failed emails');
});

/* ---------------- notifications ---------------- */
let N1, N2, N3;
test('notifications: written by Admin, checked carefully; Support may only look', async () => {
  const bad = await admin('POST', '/api/console/notices', { message: 'x', linkUrl: 'javascript:alert(1)', tone: 'loud', audience: 'martians', place: 'moon' });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['audience', 'linkUrl', 'message', 'place', 'tone']);
  assert.equal((await admin('POST', '/api/console/notices', { message: 'Hello learners', linkLabel: 'Go', audience: 'everyone', place: 'both' })).body.error.fields.linkUrl,
    'Add the address the link goes to, or clear the link text.');
  assert.equal((await admin('POST', '/api/console/notices', { message: 'Hello learners', linkUrl: '//evil.example', audience: 'everyone', place: 'both' })).status, 400);
  assert.equal((await admin('POST', '/api/console/notices', { message: 'Hello learners', audience: 'everyone', place: 'both',
    startsAt: new Date(Date.now() + DAY).toISOString(), endsAt: new Date().toISOString() })).body.error.fields.endsAt, 'Make it end after it starts.');
  assert.equal((await support('POST', '/api/console/notices', { message: 'Hello learners', audience: 'everyone', place: 'both' })).status, 403);

  const one = await admin('POST', '/api/console/notices', { message: 'Diwali offer: 30% off every plan <b>this week</b>.', linkUrl: '/pricing', linkLabel: 'See the plans', tone: 'offer', audience: 'everyone', place: 'both' });
  assert.equal(one.status, 201, JSON.stringify(one.body));
  N1 = one.body.notice.id;
  assert.match(N1, /^ntc_[a-z0-9]{12}$/);
  assert.equal(one.body.notice.state, 'live');
  N2 = (await admin('POST', '/api/console/notices', { message: 'Thanks for being a paying learner.', tone: 'info', audience: 'paid', place: 'trainer' })).body.notice.id;
  const later = await admin('POST', '/api/console/notices', { message: 'Coming soon: new games.', audience: 'guests', place: 'site', startsAt: new Date(Date.now() + DAY).toISOString() });
  N3 = later.body.notice.id;
  assert.equal(later.body.notice.state, 'scheduled');

  const list = await support('GET', '/api/console/notices');
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 3);
  assert.equal(list.body.can.manage, false);
  assert.deepEqual((await support('GET', '/api/console/notices?status=scheduled')).body.items.map((n) => n.id), [N3]);
  assert.equal((await support('PUT', `/api/console/notices/${N1}`, { active: false })).status, 403);
});

test('learners see the right notices: on the website under the header, in the trainer, and a closed one stays closed', async () => {
  const guest = K.client();
  const site = await guest('GET', '/api/notices?place=site');
  assert.deepEqual(site.body.notices.map((n) => n.id), [N1], 'not the paid one (trainer only) nor the one that starts tomorrow');
  assert.deepEqual(site.body.notices[0], { id: N1, message: 'Diwali offer: 30% off every plan <b>this week</b>.', linkUrl: '/pricing', linkLabel: 'See the plans', tone: 'offer' });
  const home = await guest('GET', '/pricing');
  assert.equal(home.status, 200);
  assert.ok(home.text.includes(`data-notice="${N1}"`));
  assert.ok(home.text.includes('Diwali offer: 30% off every plan &lt;b&gt;this week&lt;/b&gt;.'), 'escaped');
  assert.ok(home.text.includes('href="/pricing">See the plans'));
  assert.ok(home.text.indexOf('class="notice-bars"') > home.text.indexOf('<header') && home.text.indexOf('class="notice-bars"') < home.text.indexOf('<main'));
  // closed in this browser: gone from every page and from the trainer
  const closed = await guest('GET', '/pricing', undefined, { Cookie: `tc_nd=ntc_aaaaaaaa.${N1}` });
  assert.ok(!closed.text.includes('data-notice='));
  assert.deepEqual((await guest('GET', '/api/notices?place=site', undefined, { Cookie: `tc_nd=${N1}` })).body.notices, []);

  const paidLearner = await K.account({ email: 'paid.learner@example.com', name: 'Paid Learner' });
  await K.subscription(paidLearner.id, 'starter', { days: 30, source: 'purchase' });
  const freeLearner = await K.account({ email: 'free.learner@example.com', name: 'Free Learner' });
  assert.deepEqual((await paidLearner.learner('GET', '/api/notices?place=trainer')).body.notices.map((n) => n.id).sort(), [N1, N2].sort());
  assert.deepEqual((await freeLearner.learner('GET', '/api/notices?place=trainer')).body.notices.map((n) => n.id), [N1]);
  const app = await freeLearner.learner('GET', '/app');
  assert.equal(app.status, 200);
  assert.ok(app.text.includes('id="noticeSlot"'));

  // turned off: gone at once
  const off = await admin('PUT', `/api/console/notices/${N1}`, { active: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.notice.state, 'off');
  assert.deepEqual((await guest('GET', '/api/notices?place=site')).body.notices, []);
  assert.ok(!(await guest('GET', '/pricing')).text.includes('data-notice='));
  // changed: the scheduled one starts now
  const now = await admin('PUT', `/api/console/notices/${N3}`, { message: 'New games are here.', audience: 'guests', place: 'site', tone: 'info' });
  assert.equal(now.body.notice.state, 'live');
  assert.deepEqual((await guest('GET', '/api/notices?place=site')).body.notices.map((n) => n.id), [N3]);
  assert.deepEqual((await freeLearner.learner('GET', '/api/notices?place=site')).body.notices, [], 'for people who are not signed in only');
  assert.equal((await admin('DELETE', `/api/console/notices/${N2}`, {})).status, 200);
  assert.deepEqual((await K.audits('notice.%')).map((a) => a.action), ['notice.create', 'notice.create', 'notice.create', 'notice.off', 'notice.update', 'notice.delete']);
});

/* ---------------- pages ---------------- */
test('pages: frames without inline code; Support sees campaigns and notifications without the buttons to write', async () => {
  const D = await draft(admin, { name: 'Page check' });
  for (const p of ['/console/campaigns', `/console/campaigns/${D}`, '/console/email-log', '/console/notifications']) {
    const r = await owner('GET', p);
    assert.equal(r.status, 200, p);
    assertNoInlineCode(r.text);
  }
  const list = (await owner('GET', '/console/campaigns')).text;
  assert.ok(list.includes('id="newCampaign"') && list.includes('id="limitBar"') && list.includes('/site/console/campaigns.js?v='));
  assert.match(list, /<a class="nav-item is-current" href="\/console\/campaigns" aria-current="page">/);
  const asSupport = (await support('GET', '/console/campaigns')).text;
  assert.ok(!asSupport.includes('id="newCampaign"'));
  assert.ok((await owner('GET', '/console/notifications')).text.includes('id="newNotice"'));
  assert.ok(!(await support('GET', '/console/notifications')).text.includes('id="newNotice"'));
  await K.setPermission('support', 'notices.view', false);
  try {
    assert.equal((await support('GET', '/console/notifications')).status, 403);
    assert.equal((await support('GET', '/api/console/notices')).status, 403);
  } finally { await K.run("DELETE FROM role_permissions WHERE permission = 'notices.view'"); }
});

/* ---------------- before the migration ---------------- */
test('before migration 0010: the console says so, learners see no notices, the cron does nothing, announcements go the old way', async () => {
  await K.run('DROP TABLE campaign_sends');
  await K.run('DROP TABLE email_campaigns');
  await K.run('DROP TABLE site_notices');
  forgetAll(S.env);
  const r = await admin('GET', '/api/console/campaigns');
  assert.equal(r.status, 503);
  assert.match(r.body.error.message, /0010/);
  assert.equal((await admin('GET', '/api/console/notices')).status, 503);
  assert.deepEqual((await K.client()('GET', '/api/notices?place=site')).body.notices, []);
  assert.equal((await K.client()('GET', '/pricing')).status, 200);
  const { cron } = await import('../src/console/campaigns-api.js');
  await cron(S.env, null, '*/10 * * * *');
  const a = await owner('POST', '/api/admin/announcements', { subject: 'Old way', body: 'Still works.', audience: 'all' });
  assert.equal(a.status, 202, JSON.stringify(a.body));
  assert.equal(a.body.campaignId, undefined);
  await K.settle();
});
