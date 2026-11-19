// Admin console, Phase 4a: the Support inbox and Business reports (docs/ADMIN-PHASE-4.md §2–3).
//   node --test tests/console-support.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, assertNoInlineCode } from './console-kit.mjs';

const realFetch = globalThis.fetch;
const DAY = 86400000;
let S, K, owner, admin, support, outbox, asha, ravi;

before(async () => {
  outbox = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) { outbox.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: 're_' + outbox.length }), { status: 200 }); }
    return realFetch(url, init);
  };
  // email on, no SESSION_SECRET: console sign-in is password only
  const env = makeEnv({ OWNER_EMAILS: 'boss@example.com', SITE_URL: 'https://typecraft.test', RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'TypeCraft <hello@typecraft.test>' });
  S = { env, srv: await startServer(env, 8771) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.71.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));
  asha = await K.account({ email: 'asha@example.com', name: 'Asha Verma' });
  ravi = await K.account({ email: 'ravi@example.com', name: 'Ravi Kumar' });
});
after(() => { S.srv.server.close(); globalThis.fetch = realFetch; });

async function contact(c, body) {
  const r = await c('POST', '/api/contact', body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await K.settle();
  return r.body.id;
}

/* ---------------- Support ---------------- */
let m1, m2, m3;
test('messages from the contact form show in the inbox, new first, with filters', async () => {
  m1 = await contact(asha.learner, { name: 'Asha Verma', email: 'asha@example.com', topic: 'billing', message: 'I paid but my plan still says Free. Please check.' });
  m2 = await contact(K.client(), { name: 'Sunrise Typing Institute', email: 'info@sunrise.example.com', topic: 'institutes', message: 'We have 40 lab PCs. What would it cost for our students?' });
  m3 = await contact(ravi.learner, { name: 'Ravi Kumar', email: 'ravi@example.com', topic: 'feedback', message: 'The arcade games are great fun, thank you!' });

  const all = await support('GET', '/api/console/support');
  assert.equal(all.status, 200);
  assert.equal(all.body.total, 3);
  assert.deepEqual(all.body.counts, { new: 3, answered: 0, closed: 0 });
  assert.ok(all.body.staff.some((s) => s.name === 'Kavita Ops' && s.role === 'Admin'));
  assert.ok(all.body.staff.some((s) => s.name === 'Mayank Owner' && s.role === 'Super Admin'));
  const inst = await support('GET', '/api/console/support?topic=institutes');
  assert.deepEqual(inst.body.items.map((x) => x.id), [m2]);
  assert.equal(inst.body.items[0].topicLabel, 'Institutes');
  assert.equal(inst.body.items[0].customerId, null, 'sent without signing in');
  const found = await support('GET', '/api/console/support?q=lab%20PCs');
  assert.deepEqual(found.body.items.map((x) => x.id), [m2]);
  const mine = await support('GET', '/api/console/support?q=asha@example');
  assert.equal(mine.body.items[0].customerId, asha.id);
});

test('a message page: the text, the sender, earlier messages and what this role can do', async () => {
  const r = await support('GET', `/api/console/support/${m1}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.message.body, 'I paid but my plan still says Free. Please check.');
  assert.equal(r.body.customer.id, asha.id);
  assert.deepEqual(r.body.thread, []);
  assert.deepEqual(r.body.can, { reply: true, manage: true }, 'Support replies and manages by default');
  assert.equal(r.body.emailOn, true);
  assert.equal((await support('GET', '/api/console/support/msg_nothere123')).status, 404);
});

test('a reply is emailed to the sender with the support address as Reply-To, and marks the message answered', async () => {
  outbox.length = 0;
  const r = await support('POST', `/api/console/support/${m1}/reply`, { body: 'Hi Asha, your payment went through. Your plan is active now.\n\nRahul' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, 'answered');
  assert.equal(outbox.length, 1);
  assert.deepEqual(outbox[0].to, ['asha@example.com']);
  assert.equal(outbox[0].reply_to, 'hello@typecrafttyping.com');
  assert.match(outbox[0].subject, /^Re: your message to TypeCraft \(payments and plans\)$/);
  assert.match(outbox[0].text, /your payment went through/);
  assert.match(outbox[0].text, /Rahul, TypeCraft support/);
  assert.match(outbox[0].text, /I paid but my plan still says Free/, 'their message is quoted');
  const page = await support('GET', `/api/console/support/${m1}`);
  assert.equal(page.body.message.status, 'answered');
  assert.equal(page.body.thread.length, 1);
  assert.equal(page.body.thread[0].kind, 'reply');
  assert.equal(page.body.thread[0].author, 'Rahul Help');
  assert.equal(page.body.thread[0].email, 'sent');
  const a = await K.audits('support.reply');
  assert.equal(a.length, 1); assert.equal(a[0].target, `contact:${m1}`);
  assert.doesNotMatch(a[0].detail, /payment went through/, 'the reply text is not copied into the activity log');
  // a double click sends one reply
  const again = await support('POST', `/api/console/support/${m1}/reply`, { body: 'One more thing.' });
  assert.equal(again.status, 429);
});

test('reply and close; notes stay with staff; wrong input is explained', async () => {
  outbox.length = 0;
  const r = await admin('POST', `/api/console/support/${m3}/reply`, { body: 'Thank you, Ravi!', then: 'closed' });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'closed');
  const n = await admin('POST', `/api/console/support/${m2}/note`, { body: 'Big institute. Offer the pilot price.' });
  assert.equal(n.status, 201);
  assert.equal(outbox.length, 1, 'a note is never emailed');
  const page = await admin('GET', `/api/console/support/${m2}`);
  assert.equal(page.body.thread[0].kind, 'note');
  assert.equal(page.body.thread[0].email, null);
  assert.equal(page.body.message.status, 'new', 'a note does not change the status');
  const empty = await admin('POST', `/api/console/support/${m2}/reply`, { body: ' ' });
  assert.equal(empty.status, 400); assert.ok(empty.body.error.fields.body);
  const long = await admin('POST', `/api/console/support/${m2}/note`, { body: 'x'.repeat(2001) });
  assert.equal(long.status, 400);
  const bad = await admin('POST', `/api/console/support/${m2}/reply`, { body: 'Hello', then: 'deleted' });
  assert.equal(bad.status, 400); assert.ok(bad.body.error.fields.then);
});

test('status and who looks after a message; only the team can be given one', async () => {
  const give = await owner('PUT', `/api/console/support/${m2}`, { assignedTo: admin.who.id });
  assert.equal(give.status, 200);
  assert.deepEqual(give.body.assignedTo, { id: admin.who.id, name: 'Kavita Ops' });
  const mineList = await admin('GET', '/api/console/support?who=me');
  assert.deepEqual(mineList.body.items.map((x) => x.id), [m2]);
  const none = await admin('GET', '/api/console/support?who=none');
  assert.ok(!none.body.items.some((x) => x.id === m2));
  const outsider = await owner('PUT', `/api/console/support/${m2}`, { assignedTo: asha.id });
  assert.equal(outsider.status, 400); assert.ok(outsider.body.error.fields.assignedTo);
  const closed = await owner('PUT', `/api/console/support/${m2}`, { status: 'closed' });
  assert.equal(closed.body.status, 'closed');
  const open = await owner('GET', '/api/console/support?status=open');
  assert.deepEqual(open.body.items.map((x) => x.id), [m1]);
  const page = await owner('GET', `/api/console/support/${m2}`);
  assert.deepEqual(page.body.history.map((h) => h.action), ['support.status', 'support.assign']);
  assert.equal((await owner('PUT', `/api/console/support/${m2}`, { status: 'gone' })).status, 400);
  assert.equal((await owner('PUT', `/api/console/support/${m2}`, {})).status, 400);
});

test('permissions: the grid decides who replies and who manages', async () => {
  await K.setPermission('support', 'support.reply', false);
  assert.equal((await support('POST', `/api/console/support/${m1}/reply`, { body: 'Hello again' })).status, 403);
  assert.deepEqual((await support('GET', `/api/console/support/${m1}`)).body.can, { reply: false, manage: true });
  await K.setPermission('support', 'support.reply', true);
  await K.setPermission('support', 'support.manage', false);
  assert.equal((await support('PUT', `/api/console/support/${m1}`, { status: 'closed' })).status, 403);
  assert.equal((await support('POST', `/api/console/support/${m1}/note`, { body: 'note' })).status, 403);
  // replying and closing at once needs both
  const both = await support('POST', `/api/console/support/${m1}/reply`, { body: 'Done here.', then: 'closed' });
  assert.equal(both.status, 403);
  await K.setPermission('support', 'support.manage', true);
  // a learner's normal sign-in is not enough
  assert.equal((await asha.learner('GET', '/api/console/support')).status, 401);
});

test('without email set up a reply is refused and nothing is saved', async () => {
  const key = S.env.RESEND_API_KEY;
  delete S.env.RESEND_API_KEY;
  try {
    const r = await admin('POST', `/api/console/support/${m1}/reply`, { body: 'Can you see this?' });
    assert.equal(r.status, 503);
    assert.equal((await admin('GET', `/api/console/support/${m1}`)).body.emailOn, false);
  } finally { S.env.RESEND_API_KEY = key; }
  const page = await admin('GET', `/api/console/support/${m1}`);
  assert.equal(page.body.thread.filter((t) => t.kind === 'reply').length, 1);
});

/* ---------------- Business reports ---------------- */
test('reports: sales, refunds and net for the period, the period before, plans, sign-ups and renewals', async () => {
  const pro = (await K.one("SELECT id FROM packages WHERE id <> 'free' AND active = 1 ORDER BY display_order LIMIT 1")).id;
  const now = Date.now();
  const c1 = await K.customer({ name: 'Meena Buyer', createdAt: new Date(now - 2 * DAY).toISOString() });
  const c2 = await K.customer({ name: 'Old Buyer', createdAt: new Date(now - 200 * DAY).toISOString() });
  const o1 = await K.order(c1, pro, { amountPaise: 19900, createdAt: new Date(now - 1 * DAY).toISOString() });
  await K.order(c2, pro, { amountPaise: 19900, createdAt: new Date(now - 3 * DAY).toISOString() });
  await K.order(c2, pro, { amountPaise: 49900, createdAt: new Date(now - 40 * DAY).toISOString() });     // the period before
  await K.order(c1, pro, { status: 'failed', amountPaise: 19900, createdAt: new Date(now - 1 * DAY).toISOString() }); // not a sale
  await K.refundRow(o1, { amountPaise: 5000, reason: 'Customer request: bought the wrong plan', createdAt: new Date(now - 1 * DAY).toISOString() });
  await K.subscription(c1, pro, { days: 5, source: 'purchase' });
  await K.subscription(c2, pro, { days: 20, source: 'purchase' });

  const r = await admin('GET', '/api/console/reports?range=30d');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const t = r.body.totals;
  assert.deepEqual(t.gross, { now: 39800, before: 49900 });
  assert.deepEqual(t.refunds, { now: 5000, before: 0 });
  assert.deepEqual(t.net, { now: 34800, before: 49900 });
  assert.deepEqual(t.orders, { now: 2, before: 1 });
  assert.equal(t.avgOrder, 19900);
  assert.equal(t.buyers, 2);
  assert.equal(t.firstTime, 1, 'Old Buyer had paid before');
  assert.equal(r.body.by, 'day');
  assert.equal(r.body.series.length, 30);
  assert.equal(r.body.series.reduce((s, b) => s + b.net, 0), 34800);
  assert.equal(r.body.byPlan.length, 1);
  assert.deepEqual([r.body.byPlan[0].orders, r.body.byPlan[0].gross, r.body.byPlan[0].refunds, r.body.byPlan[0].net], [2, 39800, 5000, 34800]);
  assert.deepEqual(r.body.refundReasons, [{ reason: 'Customer request', count: 1, amount: 5000 }]);
  // sign-ups: the two learners and Meena joined in the period; staff are left out
  assert.equal(t.signups.now, 3);
  assert.equal(t.converted, 1, 'Meena bought a plan');
  assert.equal(r.body.customers.payingNow, 2);
  assert.equal(r.body.customers.everPaid, 2);
  assert.equal(r.body.renewals.next7, 1);
  assert.equal(r.body.renewals.next30, 2);
  assert.deepEqual(r.body.renewals.upcoming.map((u) => u.name), ['Meena Buyer', 'Old Buyer']);

  const year = await admin('GET', '/api/console/reports?range=12m');
  assert.equal(year.body.by, 'month');
  assert.ok(year.body.series.length >= 12 && year.body.series.length <= 13);
  assert.equal(year.body.totals.gross.now, 39800 + 49900);
  const quarter = await admin('GET', '/api/console/reports?range=90d');
  assert.equal(quarter.body.by, 'week');
  assert.equal(quarter.body.series.reduce((s, b) => s + b.gross, 0), 39800 + 49900);
  assert.equal((await admin('GET', '/api/console/reports?range=nonsense')).body.range, '30d');
});

test('reports download as CSV, with totals only; Support cannot see them by default', async () => {
  const days = await admin('GET', '/api/console/reports/export?range=7d&kind=days');
  assert.equal(days.status, 200);
  assert.match(days.headers.get('content-type'), /text\/csv/);
  const lines = days.text.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], '"Day","Orders","Sales (INR)","Refunds (INR)","Net (INR)","Sign-ups"');
  assert.equal(lines.length, 8);
  assert.doesNotMatch(days.text, /@example\.com/, 'no emails');
  const plans = await admin('GET', '/api/console/reports/export?range=30d&kind=plans');
  assert.match(plans.text, /"348\.00"/);
  assert.equal((await support('GET', '/api/console/reports')).status, 403);
  assert.equal((await support('GET', '/api/console/reports/export')).status, 403);
});

test('the pages: frames with no inline code; a role without the permission gets the 403 page', async () => {
  for (const p of ['/console/support', `/console/support/${m1}`, '/console/reports']) {
    const r = await owner('GET', p);
    assert.equal(r.status, 200, p);
    assertNoInlineCode(r.text);
  }
  assert.match((await owner('GET', '/console/reports')).text, /id="netChart"/);
  assert.match((await owner('GET', `/console/support/${m1}`)).text, /id="replyForm"/);
  assert.equal((await support('GET', '/console/reports')).status, 403);
  // the sidebar links both modules for those who may open them
  const home = await owner('GET', '/console');
  assert.match(home.text, /href="\/console\/support"/);
  assert.match(home.text, /href="\/console\/reports"/);
});

test('before database update 0014 the support pages say so plainly', async () => {
  await K.run('DROP TABLE support_assignments');
  const r = await owner('GET', '/api/console/support');
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'console_not_ready');
  assert.match(r.body.error.message, /0014/);
});
