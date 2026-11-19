// Admin console, Phase 5b: Administrators, Activity logs, Security, and the nightly privacy clean-up
// (docs/ADMIN-PHASE-5.md §9–12).
//   node --test tests/console-security.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, assertNoInlineCode, pw, OWNER } from './console-kit.mjs';
import worker from '../src/index.js';
import { retention, KEEP } from '../src/retention.js';
import { kindOf, labelOf } from '../src/console/activity-api.js';

let S, K, owner, admin, support, ownerWho, adminWho, supportWho;
const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8777) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.77.0.' });
  ownerWho = await K.owner();
  owner = await K.consoleLogin(ownerWho);
  adminWho = await K.account({ role: 'admin', name: 'Kavita Ops' });
  admin = await K.consoleLogin(adminWho);
  supportWho = await K.account({ role: 'support', name: 'Rahul Help' });
  support = await K.consoleLogin(supportWho);
});
after(() => S.srv.server.close());

/* ---------------- administrators ---------------- */
test('administrators: Admin may look, only a Super Admin may add, change or remove; never their own role', async () => {
  assert.equal((await support('GET', '/api/console/administrators')).status, 403);
  const a = await admin('GET', '/api/console/administrators');
  assert.equal(a.status, 200);
  assert.equal(a.body.can.manage, false);
  const byEmail = Object.fromEntries(a.body.staff.map((s) => [s.email, s]));
  assert.equal(byEmail[OWNER].role, 'owner'); assert.equal(byEmail[OWNER].source, 'setting'); assert.equal(byEmail[OWNER].changeable, false);
  assert.equal(byEmail[adminWho.email].you, true); assert.equal(byEmail[adminWho.email].changeable, false, 'not their own');
  assert.equal(byEmail[supportWho.email].role, 'support'); assert.ok(byEmail[supportWho.email].openSessions >= 1);
  assert.ok(!/"[a-f0-9]{64}"/.test(a.text) && !a.text.includes('password_hash'));
  assert.equal((await admin('POST', '/api/console/administrators', { email: 'x@example.com', role: 'support' })).status, 403);

  // adding: an existing, active account that has no role yet
  const neha = await K.account({ email: 'neha@example.com', name: 'Neha Shah' });
  const err = async (body) => (await owner('POST', '/api/console/administrators', body)).body.error;
  assert.match((await err({ email: 'nobody@example.com', role: 'support' })).fields.email, /sign up on the site first/);
  assert.match((await err({ email: OWNER, role: 'admin' })).fields.email, /OWNER_EMAILS/);
  assert.match((await err({ email: adminWho.email, role: 'support' })).fields.email, /already Admin/);
  assert.ok((await err({ email: 'neha@example.com', role: 'owner' })).fields.role, 'Super Admins come from OWNER_EMAILS only');
  const off = await K.customer({ email: 'disabled@example.com', status: 'disabled' });
  assert.ok(off);
  assert.match((await err({ email: 'disabled@example.com', role: 'support' })).fields.email, /disabled/);

  const added = await owner('POST', '/api/console/administrators', { email: 'NEHA@example.com', role: 'support' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.match(added.body.message, /Neha Shah is now Support/);
  await K.settle();
  assert.equal((await K.one('SELECT role, created_by FROM admin_users WHERE user_id = ?1', neha.id)).created_by, ownerWho.id);
  const mail = await K.one("SELECT template, category, subject FROM email_logs WHERE to_email = 'neha@example.com' AND template = 'account_update' ORDER BY created_at DESC");
  assert.equal(mail.category, 'security'); assert.match(mail.subject, /can now use the TypeCraft admin console/);
  const nehaConsole = await K.consoleLogin(neha);
  assert.equal((await nehaConsole('GET', '/api/console/notices')).status, 200, 'Support can work straight away');

  // changing, and the password check
  await K.stale(owner);
  const stale = await owner('PUT', `/api/console/administrators/${neha.id}`, { role: 'admin' });
  assert.equal(stale.status, 403); assert.equal(stale.body.error.code, 'reauth_required');
  assert.equal((await owner('POST', '/api/admin/auth/reauth', { password: pw })).status, 200);
  const up = await owner('PUT', `/api/console/administrators/${neha.id}`, { role: 'admin' });
  assert.equal(up.status, 200); assert.match(up.body.message, /now Admin/);
  assert.equal((await nehaConsole('GET', '/api/console/settings')).status, 200, 'the new role applies at once');
  assert.equal((await owner('PUT', `/api/console/administrators/${neha.id}`, { role: 'admin' })).body.message, 'Nothing changed.');
  assert.equal((await owner('PUT', `/api/console/administrators/${ownerWho.id}`, { role: 'admin' })).status, 403, 'OWNER_EMAILS is changed in Cloudflare');
  assert.equal((await owner('PUT', '/api/console/administrators/nope', { role: 'admin' })).status, 404);

  // a Super Admin given in the table can't change their own role either
  const other = await K.account({ email: 'second.boss@example.com', name: 'Second Boss' });
  await K.run("INSERT INTO admin_users (user_id, role, created_at) VALUES (?1, 'owner', ?2)", other.id, new Date().toISOString());
  const second = await K.consoleLogin(other);
  const self = await second('DELETE', `/api/console/administrators/${other.id}`, {});
  assert.equal(self.status, 403); assert.match(self.body.error.message, /your own role/);

  // removing ends their console sign-ins; the account stays
  const gone = await owner('DELETE', `/api/console/administrators/${neha.id}`, {});
  assert.equal(gone.status, 200); assert.match(gone.body.message, /can no longer use the admin console/);
  await K.settle();
  assert.equal((await nehaConsole('GET', '/api/console/notices')).status, 401);
  assert.equal((await K.one('SELECT ended_reason FROM admin_sessions WHERE user_id = ?1 ORDER BY created_at DESC', neha.id)).ended_reason, 'role_removed');
  assert.equal((await K.one('SELECT account_status FROM users WHERE id = ?1', neha.id)).account_status, 'active');
  const trail = (await K.audits('user.role')).filter((r) => r.target === `user:${neha.id}`).map((r) => JSON.parse(r.detail));
  assert.deepEqual(trail.map((d) => [d.from, d.to, d.via]), [[null, 'support', 'console'], ['support', 'admin', 'console'], ['admin', null, 'console']]);
  await K.run('DELETE FROM admin_users WHERE user_id = ?1', other.id);
});

/* ---------------- activity logs ---------------- */
test('activity logs: kinds, labels, who did it, and links to what it was about', () => {
  assert.equal(kindOf('user.role'), 'access');
  assert.equal(kindOf('user.disable'), 'customers');
  assert.equal(kindOf('campaign.limit'), 'settings');
  assert.equal(kindOf('campaign.start'), 'growth');
  assert.equal(kindOf('admin.login_failed'), 'signin');
  assert.equal(kindOf('weird.thing'), 'other');
  assert.equal(labelOf('settings.update'), 'Changed settings');
  assert.equal(labelOf('institute.batch_create'), 'Institute batch create', 'an action without a label still reads as words');
});

test('activity logs: filters, Admin may read, Support may not, and the download asks for the password', async () => {
  assert.equal((await support('GET', '/api/console/activity')).status, 403);
  const customer = await K.customer({ name: 'Asha Verma', email: 'asha@example.com' });
  await K.run(`INSERT INTO audit_logs (id, actor_id, action, target, detail, ip, created_at) VALUES ('al_sys', NULL, 'order.paid', 'order:ord_1', '{"via":"webhook"}', NULL, ?1)`, ago(1));
  await K.run(`INSERT INTO audit_logs (id, actor_id, action, target, detail, ip, created_at) VALUES ('al_cust', ?1, 'user.disable', ?2, '{"reason":"=HYPERLINK(1)"}', '10.1.2.3', ?3)`, adminWho.id, `user:${customer}`, ago(2));
  await K.run(`INSERT INTO audit_logs (id, actor_id, action, target, detail, ip, created_at) VALUES ('al_odd', ?1, 'weird.thing', NULL, NULL, NULL, ?2)`, ownerWho.id, ago(3));

  const all = await admin('GET', '/api/console/activity');
  assert.equal(all.status, 200);
  assert.ok(all.body.total >= 5);
  assert.ok(all.body.items.every((x, i, a) => i === 0 || a[i - 1].createdAt >= x.createdAt), 'newest first');
  assert.ok(all.body.kinds.some((k) => k.id === 'access') && all.body.actors[0].id === 'system');
  assert.ok(all.body.actors.some((x) => x.id === adminWho.id));

  const disabled = all.body.items.find((x) => x.id === 'al_cust');
  assert.equal(disabled.label, 'Disabled an account');
  assert.equal(disabled.about, 'Asha Verma (asha@example.com)');
  assert.equal(disabled.link, `/admin/customers/${customer}`);
  assert.equal(disabled.actor.roleLabel, 'Admin'); assert.equal(disabled.ip, '10.1.2.3');
  const sys = all.body.items.find((x) => x.id === 'al_sys');
  assert.equal(sys.actor, null); assert.equal(sys.link, '/admin/payments/ord_1');

  const q = (s) => admin('GET', '/api/console/activity?' + s).then((r) => r.body.items.map((x) => x.id));
  assert.deepEqual(await q('actor=system'), ['al_sys']);
  assert.deepEqual(await q('kind=other'), ['al_odd']);
  assert.ok((await q('kind=customers')).includes('al_cust'));
  assert.ok(!(await q('kind=customers')).some((id) => id === 'al_sys'));
  const access = (await admin('GET', '/api/console/activity?kind=access')).body.items;
  assert.ok(access.length >= 3 && access.every((x) => x.kind === 'access'), 'role changes are under Roles and administrators, not Customers');
  assert.deepEqual(await q('q=asha%40example.com'), ['al_cust'], "a customer's email finds what happened to them");
  const day = (iso) => new Date(Date.parse(iso) + 330 * 60000).toISOString().slice(0, 10);
  assert.deepEqual(await q(`from=${day(ago(2))}&to=${day(ago(2))}`), ['al_cust']);

  // the download: password confirmed within 10 minutes, logged, and safe to open in a spreadsheet
  await K.stale(admin);
  const stale = await admin('GET', '/api/console/activity/export?kind=customers');
  assert.equal(stale.status, 403); assert.equal(stale.body.error.code, 'reauth_required');
  assert.equal((await admin('POST', '/api/admin/auth/reauth', { password: pw })).status, 200);
  const csv = await admin('GET', '/api/console/activity/export?kind=customers');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /"When \(India time\)","Who","Role","What","Action","About","Details","IP address"/);
  assert.match(csv.text, /"Disabled an account","user\.disable","Asha Verma \(asha@example\.com\)"/);
  assert.ok(!/,"=HYPERLINK/.test(csv.text));
  const exp = await K.audits('audit.export');
  assert.equal(exp.length, 1); assert.deepEqual(JSON.parse(exp[0].detail).filters, { kind: 'customers' });
});

/* ---------------- security ---------------- */
test('security: who is signed in, locks and failed sign-ins; never a full session id', async () => {
  assert.equal((await support('GET', '/api/console/security')).status, 403);
  // a learner types a wrong password 8 times, someone tries the Admin's console sign-in 5 times
  const learner = await K.account({ email: 'ravi@example.com', name: 'Ravi Kumar' });
  const site = K.client();
  for (let i = 0; i < 8; i++) await site('POST', '/api/auth/login', { email: 'ravi@example.com', password: 'wrong password ' + i });
  assert.equal((await site('POST', '/api/auth/login', { email: 'ravi@example.com', password: pw })).status, 429, 'locked, even with the right password');
  const guess = K.client();
  for (let i = 0; i < 5; i++) await guess('POST', '/api/admin/auth/login', { email: adminWho.email, password: 'nope nope ' + i });

  const r = await admin('GET', '/api/console/security');
  assert.equal(r.status, 200);
  assert.ok(!/[a-f0-9]{64}/.test(r.text), 'no full session ids');
  assert.equal(r.body.can.manage, false);
  const me = r.body.sessions.find((x) => x.you);
  assert.equal(me.email, adminWho.email); assert.match(me.ref, /^[0-9a-f]{16}$/);
  assert.ok(r.body.sessions.some((x) => x.email === OWNER));
  const lockL = r.body.locks.find((l) => l.kind === 'learner' && l.email === 'ravi@example.com');
  assert.equal(lockL.locked, true); assert.equal(lockL.tries, 8);
  const lockA = r.body.locks.find((l) => l.kind === 'admin' && l.email === adminWho.email);
  assert.equal(lockA.locked, true); assert.equal(lockA.ip, guess.ip);
  assert.ok(r.body.failed.length >= 1 && r.body.failed.every((f) => f.email === adminWho.email && f.what === 'Wrong password'));
  const checks = Object.fromEntries(r.body.checks.map((c) => [c.label, c.ok]));
  assert.equal(checks['Emailed code at admin sign-in'], false);
  assert.equal(checks['Super Admin accounts'], true);
  assert.equal(r.body.rules.idleMinutes, 30);

  // only a Super Admin acts, with the password confirmed
  assert.equal((await admin('POST', '/api/console/security/unlock', { ref: lockL.ref })).status, 403);
  assert.equal((await owner('POST', '/api/console/security/unlock', { ref: 'rate:anything' })).status, 400);
  const un = await owner('POST', '/api/console/security/unlock', { ref: lockL.ref });
  assert.equal(un.status, 200, JSON.stringify(un.body));
  assert.equal((await owner('POST', '/api/console/security/unlock', { ref: lockL.ref })).status, 404);
  assert.equal((await site('POST', '/api/auth/login', { email: 'ravi@example.com', password: pw })).status, 200, 'unlocked');
  assert.equal((await owner('POST', '/api/console/security/unlock', { ref: lockA.ref })).status, 200);
  assert.ok(learner);
  const unlocks = await K.audits('security.unlock');
  assert.equal(unlocks.length, 2); assert.equal(JSON.parse(unlocks[0].detail).account, 'ravi@example.com');
});

test('security: ending one sign-in, and everyone else at once', async () => {
  const before = (await owner('GET', '/api/console/security')).body.sessions;
  const mine = before.find((x) => x.you), theirs = before.find((x) => x.email === supportWho.email);
  assert.equal((await owner('POST', `/api/console/security/sessions/${mine.ref}/end`, {})).status, 400, 'use Sign out for your own');
  assert.equal((await admin('POST', `/api/console/security/sessions/${theirs.ref}/end`, {})).status, 403);
  const end = await owner('POST', `/api/console/security/sessions/${theirs.ref}/end`, {});
  assert.equal(end.status, 200);
  assert.equal((await support('GET', '/api/console/notices')).status, 401);
  assert.equal((await owner('POST', `/api/console/security/sessions/${theirs.ref}/end`, {})).status, 404);
  support = await K.consoleLogin(supportWho);

  await K.stale(owner);
  const stale = await owner('POST', '/api/console/security/sessions/end-others', {});
  assert.equal(stale.status, 403); assert.equal(stale.body.error.code, 'reauth_required');
  assert.equal((await owner('POST', '/api/admin/auth/reauth', { password: pw })).status, 200);
  const all = await owner('POST', '/api/console/security/sessions/end-others', {});
  assert.equal(all.status, 200); assert.ok(all.body.ended >= 2);
  assert.equal((await admin('GET', '/api/console/settings')).status, 401);
  assert.equal((await support('GET', '/api/console/notices')).status, 401);
  assert.equal((await owner('GET', '/api/console/security')).status, 200, 'you stay signed in');
  assert.equal((await K.audits('security.sessions_end_others')).length, 1);
  admin = await K.consoleLogin(adminWho);
  support = await K.consoleLogin(supportWho);
});

/* ---------------- the nightly privacy clean-up ---------------- */
test('nightly privacy clean-up: IP addresses after 90 days, email records after a year, old devices and codes', async () => {
  const u = await K.customer({ email: 'old@example.com' });
  await K.run(`INSERT INTO audit_logs (id, actor_id, action, target, ip, created_at) VALUES ('al_old', NULL, 'order.paid', NULL, '1.1.1.1', ?1), ('al_new', NULL, 'order.paid', NULL, '2.2.2.2', ?2)`, ago(KEEP.ipDays + 1), ago(KEEP.ipDays - 1));
  await K.run(`INSERT INTO contact_messages (id, name, email, topic, message, ip, created_at) VALUES ('msg_old1', 'A', 'a@example.com', 'general', 'Hi', '3.3.3.3', ?1), ('msg_new1', 'B', 'b@example.com', 'general', 'Hi', '4.4.4.4', ?2)`, ago(100), ago(10));
  const mail = (id, days) => K.run(`INSERT INTO email_logs (id, to_email, template, category, subject, status, provider, attempts, created_at, updated_at)
                                    VALUES (?1, 'x@example.com', 'welcome', 'auth', 'Hi', 'sent', 'resend', 1, ?2, ?2)`, id, ago(days));
  await mail('em_old', KEEP.emailDays + 5); await mail('em_new', KEEP.emailDays - 5);
  await K.run(`INSERT INTO known_devices (user_id, ua_hash, label, first_seen, last_seen) VALUES (?1, 'old', 'Chrome on Windows', ?2, ?2), (?1, 'new', 'Firefox on Linux', ?3, ?3)`, u, ago(400), ago(5));
  await K.run(`INSERT INTO otp_verifications (id, user_id, email, purpose, code_hash, expires_at, created_at) VALUES ('otp_old', ?1, 'old@example.com', 'login', 'x', ?2, ?2)`, u, ago(3));

  const ctx = { waitUntil: (p) => S.srv.pending.push(p) };
  await worker.scheduled({ cron: '17 21 * * *' }, S.env, ctx); await K.settle();
  const run = await K.one('SELECT parts FROM job_runs ORDER BY id DESC LIMIT 1');
  assert.equal(JSON.parse(run.parts)['privacy clean-up'], 'ok');

  assert.equal((await K.one("SELECT ip FROM audit_logs WHERE id = 'al_old'")).ip, null);
  assert.equal((await K.one("SELECT ip FROM audit_logs WHERE id = 'al_new'")).ip, '2.2.2.2');
  assert.ok(await K.one("SELECT 1 AS x FROM audit_logs WHERE id = 'al_old'"), 'the entry itself stays');
  assert.equal((await K.one("SELECT ip FROM contact_messages WHERE id = 'msg_old1'")).ip, null);
  assert.equal((await K.one("SELECT ip FROM contact_messages WHERE id = 'msg_new1'")).ip, '4.4.4.4');
  assert.equal(await K.one("SELECT 1 AS x FROM email_logs WHERE id = 'em_old'"), null);
  assert.ok(await K.one("SELECT 1 AS x FROM email_logs WHERE id = 'em_new'"));
  assert.deepEqual((await K.many('SELECT ua_hash FROM known_devices WHERE user_id = ?1', u)).map((r) => r.ua_hash), ['new']);
  assert.equal(await K.one("SELECT 1 AS x FROM otp_verifications WHERE id = 'otp_old'"), null);
  // a second night finds nothing left to do
  assert.deepEqual(await retention(S.env), { auditIps: 0, contactIps: 0, emails: 0, devices: 0, codes: 0 });

  const privacy = (await K.client()('GET', '/privacy')).text;
  assert.match(privacy, /removed after 90 days/);
  assert.match(privacy, /kept for one year/);
  assert.ok(!/kept for a short period/.test(privacy));
});

/* ---------------- pages ---------------- */
test('the Administrators, Activity logs and Security pages: by permission, no inline code; every module is built', async () => {
  for (const [path, script] of [['/admin/administrators', 'administrators.js'], ['/admin/activity-logs', 'activity.js'], ['/admin/security', 'security.js']]) {
    const page = await admin('GET', path);
    assert.equal(page.status, 200, path);
    assertNoInlineCode(page.text);
    assert.ok(page.text.includes(`/site/console/${script}?v=`), script);
    assert.match(page.text, new RegExp(`<a class="nav-item is-current" href="${path.replace(/\//g, '\\/')}"`));
    assert.equal((await support('GET', path)).status, 403, path);
  }
  assert.ok(!(await admin('GET', '/admin/administrators')).text.includes('id="addAdmin"'), 'no Add button without admins.manage');
  assert.ok((await owner('GET', '/admin/administrators')).text.includes('id="addAdmin"'));
  const activity = (await admin('GET', '/admin/activity-logs')).text;
  for (const name of ['q', 'kind', 'actor', 'from', 'to']) assert.ok(activity.includes(`name="${name}"`), name);
  assert.ok(activity.includes('id="exportBtn"'));
  const roles = (await owner('GET', '/admin/roles')).text;
  assert.match(roles, /use <a href="\/admin\/administrators">Administrators<\/a>/);
  assert.ok(!roles.includes('/admin/users'));
  const home = (await owner('GET', '/admin')).text;
  assert.ok(!/Phase \d/.test(home.replace(/<script[\s\S]*?<\/script>/g, '')), 'no module waits for a later phase');
  assert.ok(!/still managed in the current admin/.test(home));
});
