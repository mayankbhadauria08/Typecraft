// Admin console, Phase 5a: Settings, Integrations, System health, the job record and its alerts, email previews,
// the sign-ups switch, and the smaller batches on Workers Free (docs/ADMIN-PHASE-5.md).
//   node --test tests/console-system.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { makeEnv, startServer } from './server.mjs';
import { kit, assertNoInlineCode, pw } from './console-kit.mjs';
import worker from '../src/index.js';
import { runJobs } from '../src/jobs.js';
import { perRun, paidPlan, freePlanBudget, FREE_OUTSIDE_CALLS } from '../src/limits.js';
import { MIGRATIONS } from '../src/console/migration-list.js';
import { TEMPLATE_NAMES } from '../src/mail-templates.js';

const SECRETS = { RAZORPAY_KEY_ID: 'rzp_test_sys123', RAZORPAY_KEY_SECRET: 'rzp-secret-value-xyz', RESEND_API_KEY: 're_secret_value_abc' };
const realFetch = globalThis.fetch;
const outbox = [];
let S, K, owner, admin, support, ownerWho;
const ctx = { waitUntil: (p) => S.srv.pending.push(p) };

before(async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) { outbox.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: `re_${outbox.length}` }), { status: 200 }); }
    if (String(url).startsWith('https://api.razorpay.com/')) return new Response(JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'test' } }), { status: 400 });
    return realFetch(url, init);
  };
  const env = makeEnv({ OWNER_EMAILS: 'boss@example.com', SITE_URL: 'https://typecraft.test', EMAIL_FROM: 'TypeCraft <test@typecraft.test>', ...SECRETS });
  S = { env, srv: await startServer(env, 8774) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.74.0.' });
  ownerWho = await K.owner();
  owner = await K.consoleLogin(ownerWho);
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));
});
after(() => { S.srv.server.close(); globalThis.fetch = realFetch; });

const noSecrets = (text) => { for (const v of Object.values(SECRETS)) assert.ok(!text.includes(v), 'no secret value in the answer'); };

/* ---------------- limits ---------------- */
test('Workers Free: every 10-minute run stays inside 50 outside calls; WORKERS_PLAN=paid makes the batches larger', () => {
  assert.equal(paidPlan({}), false);
  assert.equal(paidPlan({ WORKERS_PLAN: ' Paid ' }), true);
  assert.ok(freePlanBudget() <= FREE_OUTSIDE_CALLS - 5, `free plan batches add up to ${freePlanBudget()}`);
  const free = perRun({}), paid = perRun({ WORKERS_PLAN: 'paid' });
  for (const k of Object.keys(free)) assert.ok(paid[k] > free[k], k);
  assert.equal(free.reconcile, 6);
  assert.equal(free.campaigns + free.announcements + free.emailRetries <= 30, true);
});

/* ---------------- settings ---------------- */
test('settings: Admin may look, only a Super Admin may change (password confirmed); each change is logged', async () => {
  assert.equal((await support('GET', '/api/console/settings')).status, 403);
  const a = await admin('GET', '/api/console/settings');
  assert.equal(a.status, 200);
  assert.equal(a.body.can.manage, false);
  assert.equal(a.body.payments.mode, 'test');
  assert.equal(a.body.settings.payments.testMode, undefined, 'no test-mode switch');
  assert.equal(typeof a.body.campaigns.dailyCap, 'number');
  noSecrets(a.text);
  assert.equal((await admin('PUT', '/api/console/settings/support', { email: 'help@example.com', hours: '', replyDays: 2 })).status, 403);

  // checked field by field
  const bad = await owner('PUT', '/api/console/settings/seller', { name: 'TypeCraft', legalName: '', address: '', email: 'nope', phone: '', gstin: 'abc' });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['email', 'gstin', 'legalName']);
  assert.equal((await owner('PUT', '/api/console/settings/seller', { name: 'TypeCraft' })).status, 400, 'the whole section is sent');
  assert.equal((await owner('PUT', '/api/console/settings/secrets', { a: 1 })).status, 404);
  assert.equal((await owner('PUT', '/api/console/settings/payments', { enabled: 'yes' })).status, 400);

  const seller = { name: 'TypeCraft', legalName: 'Mayank Bhadauria (sole proprietor)', address: '12 MG Road\nGwalior 474001', email: 'billing@typecraft.test', phone: '', gstin: '' };
  const ok = await owner('PUT', '/api/console/settings/seller', seller);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.saved, true);
  assert.match(ok.body.message, /New invoices use these details/);
  assert.equal(ok.body.settings.seller.address, '12 MG Road\nGwalior 474001');
  assert.equal(ok.body.settings.seller.gstin, null);
  assert.equal(ok.body.changed.seller.by, 'Mayank Owner');
  const trail = await K.audits('settings.update');
  assert.equal(trail.length, 1);
  assert.deepEqual(JSON.parse(trail[0].detail).seller.legalName.to, 'Mayank Bhadauria (sole proprietor)');
  // the same values again: nothing written, nothing logged
  const same = await owner('PUT', '/api/console/settings/seller', seller);
  assert.equal(same.body.saved, false); assert.equal(same.body.message, 'Nothing changed.');
  assert.equal((await K.audits('settings.update')).length, 1);
  // the legal pages show the new seller straight away
  assert.match((await K.client()('GET', '/terms')).text, /Mayank Bhadauria \(sole proprietor\)/);

  // sensitive: the password must have been confirmed in the last 10 minutes
  await K.stale(owner);
  const again = await owner('PUT', '/api/console/settings/support', { email: 'help@typecraft.test', hours: 'Mon to Sat', replyDays: '3' });
  assert.equal(again.status, 403); assert.equal(again.body.error.code, 'reauth_required');
  assert.equal((await owner('POST', '/api/admin/auth/reauth', { password: pw })).status, 200);
  const sup = await owner('PUT', '/api/console/settings/support', { email: 'help@typecraft.test', hours: 'Mon to Sat', replyDays: '3' });
  assert.equal(sup.status, 200, JSON.stringify(sup.body));
  assert.equal(sup.body.settings.support.replyDays, 3);
});

test('payments switch: paused means no new orders; test mode follows the installed key, and the old switch is gone', async () => {
  const learner = (await K.account({ email: 'buyer@example.com', name: 'Asha Buyer' })).learner;
  const off = await owner('PUT', '/api/console/settings/payments', { enabled: false });
  assert.equal(off.status, 200); assert.match(off.body.message, /paused/);
  const order = await learner('POST', '/api/checkout/order', { packageId: 'pro' });
  assert.equal(order.status, 503); assert.equal(order.body.error.code, 'payments_unavailable');
  assert.equal((await owner('PUT', '/api/console/settings/payments', { enabled: true })).status, 200);

  // the old /admin page: test mode follows the key, and a testMode sent back is ignored and dropped
  await K.run("UPDATE platform_settings SET value = '{\"enabled\":true,\"testMode\":true}' WHERE key = 'payments'");
  const old = await ownerWho.learner('GET', '/api/admin/settings');
  assert.equal(old.status, 200); assert.equal(old.body.paymentsMode, 'test'); assert.equal(old.body.settings.payments.testMode, undefined);
  const put = await ownerWho.learner('PUT', '/api/admin/settings', { payments: { enabled: false, testMode: false } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.deepEqual(JSON.parse((await K.one("SELECT value FROM platform_settings WHERE key = 'payments'")).value), { enabled: false });
  const fields = await ownerWho.learner('PUT', '/api/admin/settings', { seller: { email: 'nope' } });
  assert.equal(fields.status, 400); assert.ok(fields.body.error.fields['seller.email']);
  await ownerWho.learner('PUT', '/api/admin/settings', { payments: { enabled: true } });
  assert.ok(!readFileSync(new URL('../site/js/admin-settings.js', import.meta.url), 'utf8').includes('pay.testMode'), 'the old page no longer reads a test-mode switch');
});

test('sign-ups switch: closed means no new accounts; everyone with one still signs in', async () => {
  const closed = await owner('PUT', '/api/console/settings/signups', { open: false });
  assert.equal(closed.status, 200); assert.match(closed.body.message, /closed/);
  const c = K.client();
  const r = await c('POST', '/api/auth/signup', { fullName: 'New Person', email: 'new.person@example.com', phoneNumber: '+91 98765 43210', password: pw, confirmPassword: pw });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'signups_closed');
  assert.match(r.body.error.message, /can't be created right now/);
  assert.equal(await K.one("SELECT COUNT(*) AS n FROM users WHERE email = 'new.person@example.com'").then((x) => x.n), 0);
  const login = await K.client()('POST', '/api/auth/login', { email: 'buyer@example.com', password: pw });
  assert.equal(login.status, 200, 'existing accounts sign in as usual');
  assert.equal((await owner('PUT', '/api/console/settings/signups', { open: true })).status, 200);
  const again = await c('POST', '/api/auth/signup', { fullName: 'New Person', email: 'new.person@example.com', phoneNumber: '+91 98765 43210', password: pw, confirmPassword: pw });
  assert.equal(again.status, 201);
  await K.settle();
});

/* ---------------- integrations ---------------- */
test('integrations: says what is connected and what to do, never a secret value', async () => {
  assert.equal((await support('GET', '/api/console/integrations')).status, 403);
  const r = await admin('GET', '/api/console/integrations');
  assert.equal(r.status, 200);
  noSecrets(r.text);
  const by = Object.fromEntries(r.body.items.map((i) => [i.key, i]));
  assert.deepEqual(Object.keys(by), ['razorpay', 'resend', 'codes', 'cloudflare', 'analytics', 'fonts', 'search']);
  assert.equal(by.razorpay.status, 'warn'); assert.match(by.razorpay.statusLabel, /Test mode, webhook missing/);
  assert.match(by.razorpay.fix, /RAZORPAY_WEBHOOK_SECRET/);
  assert.equal(by.resend.status, 'warn'); assert.match(by.resend.fix, /RESEND_WEBHOOK_SECRET/);
  assert.match(by.resend.fix, /https:\/\/typecraft\.test\/api\/webhooks\/resend/);
  assert.equal(by.codes.status, 'off'); assert.match(by.codes.fix, /SESSION_SECRET/);
  assert.equal(by.cloudflare.statusLabel, 'Workers Free'); assert.match(by.cloudflare.fix, /WORKERS_PLAN/);
  for (const i of r.body.items) assert.ok(['ok', 'warn', 'off', 'info'].includes(i.status) && i.what && i.facts.length, i.key);
  // the Home checklist has the email delivery reports too
  const setup = await owner('GET', '/api/admin/console/setup');
  assert.equal(setup.body.items.find((i) => i.key === 'emailWebhook').ready, false);
});

/* ---------------- the job record and System health ---------------- */
test('every cron run is recorded part by part; nightly adds the learner totals and the record clean-up', async () => {
  assert.equal((await support('GET', '/api/console/health')).status, 403);
  const before = await admin('GET', '/api/console/health');
  assert.equal(before.status, 200);
  assert.equal(before.body.jobs.ready, true);
  assert.ok(before.body.jobs.schedules.every((s) => s.last === null));

  await worker.scheduled({ cron: '*/10 * * * *' }, S.env, ctx); await K.settle();
  await worker.scheduled({ cron: '17 21 * * *' }, S.env, ctx); await K.settle();
  const runs = await K.many('SELECT * FROM job_runs ORDER BY id');
  assert.equal(runs.length, 2);
  const ten = JSON.parse(runs[0].parts), night = JSON.parse(runs[1].parts);
  assert.deepEqual(Object.keys(ten), ['clean-up', 'payments', 'email', 'institute reminders', 'institute payments', 'institute Monday email', 'console (campaigns, old sign-ins)']);
  assert.ok(Object.values(ten).every((v) => v === 'ok'), JSON.stringify(ten));
  assert.deepEqual(Object.keys(night).slice(-3), ['learner totals', 'privacy clean-up', 'job record']);
  assert.ok(runs.every((r) => r.ok === 1 && r.failed === 0 && r.finished_at && r.ms >= 0));
  assert.ok(!Object.keys(ten).some((k) => /^part \d+$/.test(k)), 'every part has a name');

  const h = (await admin('GET', '/api/console/health')).body;
  assert.deepEqual(h.jobs.schedules.map((s) => [s.schedule, s.last && s.last.state, s.runs24h]), [['*/10 * * * *', 'ok', 1], ['17 21 * * *', 'ok', 1]]);
  assert.equal(h.jobs.problems.length, 0);
  assert.equal(h.migrations.length, MIGRATIONS.length);
  assert.ok(h.migrations.every((m) => m.applied), 'every update is applied on the test database');
  assert.ok(h.database.size > 0); assert.equal(h.database.limit, 500 * 1024 * 1024); assert.equal(h.database.restoreDays, 7);
  assert.equal(h.plan.label, 'Workers Free');
  assert.deepEqual(h.plan.perRun[0], ['Payments checked with Razorpay', 6]);
  assert.equal(h.email.dayLimit, 100); assert.ok(h.email.sent24h >= 1);
  assert.ok(h.learning && typeof h.learning.activeToday === 'number');
  assert.ok(!h.warnings.some((w) => /job|update/i.test(w.text)), JSON.stringify(h.warnings));
});

test('a failing part: the others still run, the run is marked, and the Super Admins get one email per 6 hours', async () => {
  outbox.length = 0;
  let after = false;
  const r = await runJobs(S.env, ctx, '*/10 * * * *', [['payments', async () => { throw new Error('Razorpay did not answer'); }], ['email', async () => { after = true; }]]);
  await K.settle();
  assert.equal(r.ok, false); assert.equal(after, true, 'the next part still ran');
  const row = await K.one('SELECT * FROM job_runs ORDER BY id DESC LIMIT 1');
  assert.equal(row.ok, 0); assert.equal(row.failed, 1);
  assert.deepEqual(JSON.parse(row.parts), { payments: 'Razorpay did not answer', email: 'ok' });
  const alerts = outbox.filter((m) => /background job failed/i.test(m.subject));
  assert.equal(alerts.length, 1);
  assert.deepEqual(alerts[0].to, ['boss@example.com']);
  assert.match(alerts[0].text, /payments/); assert.match(alerts[0].text, /Razorpay did not answer/);
  assert.match(alerts[0].html, /https:\/\/typecraft\.test\/console\/system-health/);
  assert.equal((await K.one("SELECT category FROM email_logs WHERE template = 'system_alert'")).category, 'security');
  // again within 6 hours: recorded, but no second email
  await runJobs(S.env, ctx, '*/10 * * * *', [['payments', async () => { throw new Error('still down'); }]]);
  await K.settle();
  assert.equal(outbox.filter((m) => /background job failed/i.test(m.subject)).length, 1);
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM email_logs WHERE template = 'system_alert'")).n, 1);

  const h = (await admin('GET', '/api/console/health')).body;
  const ten = h.jobs.schedules.find((s) => s.schedule === '*/10 * * * *');
  assert.equal(ten.last.state, 'failed'); assert.deepEqual(ten.last.failed, [{ part: 'payments', error: 'still down' }]);
  assert.equal(ten.problems24h, 2);
  assert.equal(h.jobs.problems.length, 2);
  assert.ok(h.warnings.some((w) => w.level === 'bad' && /had a problem: payments/.test(w.text)));
});

test('a run stopped before it finished, and a job that stopped running, show as problems', async () => {
  const old = new Date(Date.now() - 20 * 60000).toISOString();
  await K.run("INSERT INTO job_runs (schedule, started_at) VALUES ('*/10 * * * *', ?1)", old);
  await K.run("INSERT INTO job_runs (schedule, started_at, finished_at, ok, failed, parts, ms) VALUES ('17 21 * * *', ?1, ?1, 1, 0, '{}', 5)",
    new Date(Date.now() - 30 * 3600000).toISOString());
  const h = (await admin('GET', '/api/console/health')).body;
  const ten = h.jobs.schedules.find((s) => s.schedule === '*/10 * * * *'), night = h.jobs.schedules.find((s) => s.schedule === '17 21 * * *');
  assert.equal(ten.last.state, 'cut_off');
  assert.equal(night.late, true);
  assert.ok(h.warnings.some((w) => /stopped before it finished/.test(w.text) && /10 ms/.test(w.text)));
  assert.ok(h.warnings.some((w) => /nightly .* job hasn't run since/i.test(w.text) && /India time/.test(w.text)));
  assert.equal(h.warnings[0].level, 'bad', 'the worst first');
  await K.run('DELETE FROM job_runs');
});

test('health warns about the free email limit, payments waiting for the bank, and failed emails', async () => {
  const now = new Date().toISOString(), hourAgo = new Date(Date.now() - 2 * 3600000).toISOString();
  for (let i = 0; i < 85; i++) {
    await K.run(`INSERT INTO email_logs (id, to_email, template, category, subject, status, provider, attempts, sent_at, created_at, updated_at)
                 VALUES (?1, 'x@example.com', 'announcement', 'platform', 'Hi', 'sent', 'resend', 1, ?2, ?2, ?2)`, `em_bulk_${i}`, now);
  }
  await K.run(`INSERT INTO email_logs (id, to_email, template, category, subject, status, provider, attempts, last_error, created_at, updated_at)
               VALUES ('em_dead', 'x@example.com', 'invoice', 'billing', 'Invoice', 'failed', 'resend', 5, 'http_422', ?1, ?1)`, now);
  const o = await K.order(await K.customer(), 'pro', { status: 'pending', createdAt: hourAgo });
  const h = (await admin('GET', '/api/console/health')).body;
  assert.ok(h.email.sent24h >= 85);
  assert.ok(h.warnings.some((w) => /of 100 emails used in the last 24 hours/.test(w.text)), JSON.stringify(h.warnings));
  assert.ok(h.warnings.some((w) => /failed for good/.test(w.text)));
  assert.equal(h.payments.waiting, 1);
  assert.ok(h.warnings.some((w) => /1 payment has waited more than an hour/.test(w.text)));
  await K.run("DELETE FROM email_logs WHERE id LIKE 'em_bulk_%' OR id = 'em_dead'");
  await K.run("UPDATE orders SET status = 'failed' WHERE id = ?1", o.id);
});

test('before update 0017: the jobs run exactly as before, and System health says the update is missing', async () => {
  await K.run('DROP TABLE job_runs');
  try {
    await worker.scheduled({ cron: '*/10 * * * *' }, S.env, ctx); await K.settle();
    const h = await admin('GET', '/api/console/health');
    assert.equal(h.status, 200);
    assert.equal(h.body.jobs.ready, false);
    const m = h.body.migrations.find((x) => x.id === '0017');
    assert.equal(m.applied, false); assert.deepEqual(m.missing, ['job_runs', 'job_runs_recent']);
    assert.ok(h.body.warnings.some((w) => /Database update 0017 hasn't been applied/.test(w.text)));
    await runJobs(S.env, ctx, '*/10 * * * *', [['payments', async () => { throw new Error('x'); }]]); // no table: no record, no crash
  } finally {
    S.env.DB.db.exec(readFileSync(new URL('../migrations/0017_job_runs.sql', import.meta.url), 'utf8'));
    S.env.DB.db.exec(readFileSync(new URL('../migrations/0017_job_runs.sql', import.meta.url), 'utf8')); // safe to run twice
  }
  assert.ok((await admin('GET', '/api/console/health')).body.migrations.every((m) => m.applied));
});

test('the migration list matches the migrations folder', () => {
  const dir = new URL('../migrations/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  assert.deepEqual(MIGRATIONS.map((m) => `${m[0]}.sql`), files, 'add each new migration to src/console/migration-list.js');
  for (const [file, title, tables, indexes] of MIGRATIONS) {
    const sql = readFileSync(new URL(`${file}.sql`, dir), 'utf8').replace(/--[^\n]*/g, '');
    assert.deepEqual(tables, [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map((m) => m[1]), `${file}: tables`);
    assert.deepEqual(indexes, [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+(\w+)/gi)].map((m) => m[1]), `${file}: indexes`);
    assert.ok(title && title.length < 60, file);
  }
});

/* ---------------- email previews ---------------- */
test('email templates: every email with sample data, in a sandboxed frame the console alone may show', async () => {
  const list = await support('GET', '/api/console/email-templates');
  assert.equal(list.status, 200);
  assert.equal(list.body.templates.length, TEMPLATE_NAMES.length);
  assert.equal(list.body.templates[0].group, 'Sign-in and security');
  assert.ok(list.body.templates.some((t) => t.name === 'system_alert' && t.group === 'For the team'));
  const one = await support('GET', '/api/console/email-templates/payment_success');
  assert.equal(one.status, 200);
  assert.match(one.body.subject, /payment/i); assert.match(one.body.text, /₹199/);
  assert.equal(one.body.previewUrl, '/console/email-preview/payment_success');
  assert.equal((await support('GET', '/api/console/email-templates/nope')).status, 404);

  const page = await support('GET', '/console/email-preview/payment_success');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const csp = page.headers.get('content-security-policy');
  for (const part of ["default-src 'none'", "frame-ancestors 'self'", 'sandbox', "style-src 'unsafe-inline'"]) assert.ok(csp.includes(part), part);
  assert.ok(!/script-src/.test(csp));
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(page.text, /₹199/); assert.ok(!/<script/i.test(page.text));
  assert.equal((await support('GET', '/console/email-preview/nope')).status, 404);
  const anon = await K.client()('GET', '/console/email-preview/payment_success');
  assert.equal(anon.status, 302);
  await K.setPermission('support', 'emails.view', false);
  try {
    assert.equal((await support('GET', '/console/email-preview/payment_success')).status, 403);
    assert.equal((await support('GET', '/api/console/email-templates')).status, 403);
  } finally { await K.setPermission('support', 'emails.view', true); }

  const frame = await support('GET', '/console/email-templates');
  assert.equal(frame.status, 200);
  assertNoInlineCode(frame.text);
  assert.match(frame.text, /<iframe id="tplFrame" class="tpl-frame" title="Email preview" sandbox=""/);
  assert.ok(frame.headers.get('content-security-policy').includes("frame-src 'self'"));
  assert.match(frame.text, /<a class="nav-item is-current" href="\/console\/campaigns"/);
  assert.match((await support('GET', '/console/campaigns')).text, /href="\/console\/email-templates"/);
});

/* ---------------- pages ---------------- */
test('the Settings, Integrations and System health pages: in the menu by permission, no inline code', async () => {
  for (const [path, perm, script] of [['/console/settings', 'settings.view', 'settings.js'], ['/console/integrations', 'integrations.view', 'integrations.js'], ['/console/system-health', 'health.view', 'health.js']]) {
    const page = await admin('GET', path);
    assert.equal(page.status, 200, path);
    assertNoInlineCode(page.text);
    assert.ok(page.text.includes(`/site/console/${script}?v=`), script);
    assert.match(page.text, new RegExp(`<a class="nav-item is-current" href="${path.replace(/\//g, '\\/')}"`));
    assert.equal((await support('GET', path)).status, 403, `${path}: Support has no ${perm} by default`);
  }
  const side = (await support('GET', '/console')).text;
  assert.ok(!side.includes('href="/console/settings"') && !side.includes('href="/console/system-health"'));
  const home = (await admin('GET', '/console')).text;
  assert.match(home, /href="\/console\/settings">Settings<\/a>/);
  assert.ok(!/[Ss]ettings[^.<]* still managed in the current admin/.test(home));
});
