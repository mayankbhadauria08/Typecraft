// Admin console, phase 1: sign-in (password, emailed code), console sessions, the
// permissions grid and its effect on every admin API, the console pages and their headers.
//   node --test tests/console.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeEnv, startServer } from './server.mjs';
import { D1Shim } from './d1-shim.mjs';
import worker from '../src/index.js';
import { PERMISSIONS, can, permissionsFor } from '../src/console/permissions.js';
import { safeConsoleNext } from '../src/console/router.js';
import { cron } from '../src/console/index.js';
import { LAYERS } from '../src/console/modules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realFetch = globalThis.fetch;
const OWNER = 'boss@example.com';
const pw = 'correct horse 9';
const SECRET_VALUES = ['key-secret-do-not-show', 'webhook-secret-do-not-show', 'session-secret-0123456789abcdef-do-not-show', 'resend-key-do-not-show'];

// A: the usual state today (no email set up) → password only.  B: email + SESSION_SECRET → password and emailed code.
let A, B, outbox;
before(async () => {
  outbox = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) { outbox.push(JSON.parse(init.body)); return new Response('{"id":"re_1"}', { status: 200 }); }
    return realFetch(url, init);
  };
  const envA = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test', RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: SECRET_VALUES[0], RAZORPAY_WEBHOOK_SECRET: SECRET_VALUES[1] });
  const envB = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test', SESSION_SECRET: SECRET_VALUES[2], RESEND_API_KEY: SECRET_VALUES[3], EMAIL_FROM: 'TypeCraft <test@example.com>' });
  A = { env: envA, srv: await startServer(envA, 8791) };
  B = { env: envB, srv: await startServer(envB, 8792) };
  A.base = `http://localhost:${A.srv.port}`; B.base = `http://localhost:${B.srv.port}`;
});
after(() => { A.srv.server.close(); B.srv.server.close(); globalThis.fetch = realFetch; });

/* ---------------- a browser stand-in that keeps every cookie ---------------- */
let ipN = 0;
function client(S, { ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } = {}) {
  const jar = new Map();
  const c = async (method, p, body, extra = {}) => {
    S.env.__ip = c.ip;
    const headers = { Origin: S.base, 'User-Agent': ua, ...extra };
    if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await realFetch(S.base + p, { method, headers, redirect: 'manual', body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
    const setCookie = res.headers.getSetCookie();
    for (const sc of setCookie) {
      const pair = sc.split(';')[0], i = pair.indexOf('=');
      if (/Max-Age=0/.test(sc) || !pair.slice(i + 1)) jar.delete(pair.slice(0, i)); else jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json, text, headers: res.headers, setCookie };
  };
  c.ip = `10.30.0.${++ipN}`;
  c.jar = jar;
  return c;
}
const settle = async (S) => { while (S.srv.pending.length) await Promise.all(S.srv.pending.splice(0)); };
let userN = 0;
/** A TypeCraft account. role: 'admin' | 'support' | null; pass email: OWNER for the Super Admin. → { email, id } */
async function account(S, { email = `person${++userN}@example.com`, role = null, name = 'Asha Admin' } = {}) {
  const c = client(S);
  const r = await c('POST', '/api/auth/signup', { fullName: name, email, phoneNumber: '+91 98765 43210', password: pw, confirmPassword: pw });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (role) await S.env.DB.prepare('INSERT INTO admin_users (user_id, role, created_by, created_at) VALUES (?1, ?2, NULL, ?3)').bind(r.body.user.id, role, new Date().toISOString()).run();
  await settle(S);
  return { email, id: r.body.user.id, learner: c };
}
const owners = new Map();
async function ownerOf(S) {
  if (!owners.has(S)) owners.set(S, await account(S, { email: OWNER, name: 'Mayank Owner' }));
  return owners.get(S);
}
/** Signs in to the console (server A: password only). → the client */
async function consoleLogin(S, who) {
  const c = client(S);
  const r = await c('POST', '/api/admin/auth/login', { email: who.email, password: pw });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.step, 'done');
  return c;
}
const one = (S, sql, ...args) => S.env.DB.prepare(sql).bind(...args).first();
const many = async (S, sql, ...args) => (await S.env.DB.prepare(sql).bind(...args).all()).results;
const lastCode = (email) => { const m = [...outbox].reverse().find((x) => x.to.includes(email) && /admin sign-in code/i.test(x.subject)); return m && m.text.match(/\b(\d{6})\b/)[1]; };

/* ---------------- sign-in: password only ---------------- */
test('admin sign-in: one answer for every failure; only accounts with a role get in; its own strict cookie', async () => {
  const owner = await ownerOf(A);
  const learner = await account(A);
  const c = client(A);

  const unknown = await c('POST', '/api/admin/auth/login', { email: 'nobody@example.com', password: pw });
  const wrongPw = await c('POST', '/api/admin/auth/login', { email: owner.email, password: 'not the password 1' });
  const noRole = await c('POST', '/api/admin/auth/login', { email: learner.email, password: pw });
  for (const r of [unknown, wrongPw, noRole]) {
    assert.equal(r.status, 401);
    assert.deepEqual(r.body.error, { code: 'wrong_credentials', message: "Those details don't match an administrator account." });
    assert.equal(r.setCookie.length, 0);
  }
  assert.equal((await c('POST', '/api/admin/auth/login', { email: 'not-an-email', password: pw })).status, 400);
  assert.equal((await c('POST', '/api/admin/auth/login', { email: owner.email })).status, 400);
  assert.equal((await c('GET', '/api/admin/auth/me')).status, 401);

  const ok = await c('POST', '/api/admin/auth/login', { email: owner.email, password: pw });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.step, 'done'); assert.equal(ok.body.role, 'owner');
  const cookie = ok.setCookie.find((s) => s.startsWith('__Host-tc_admin='));
  assert.match(cookie, /; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/);
  assert.ok(!c.jar.has('__Host-tc_session'), 'the learner session is not started by an admin sign-in');
  assert.ok(!JSON.stringify(ok.body).includes(c.jar.get('__Host-tc_admin')), 'the token is only in the cookie');

  const me = await c('GET', '/api/admin/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.role, 'owner'); assert.equal(me.body.roleLabel, 'Super Admin');
  assert.equal(me.body.user.email, owner.email);
  assert.equal(me.body.permissions.length, PERMISSIONS.length);
  assert.equal(me.body.session.secondFactor, false);
  assert.equal(me.body.session.device, 'Chrome on Windows');
  assert.equal(me.body.emailCodes, false);
  assert.ok(!('id' in me.body.session), 'the session id stays on the server');

  // only the hash of the token is stored
  const row = await one(A, 'SELECT id, second_factor, ip, device FROM admin_sessions WHERE user_id = ?1 AND ended_at IS NULL', owner.id);
  assert.notEqual(row.id, c.jar.get('__Host-tc_admin')); assert.match(row.id, /^[a-f0-9]{64}$/);
  assert.equal(row.ip, c.ip);

  const trail = (await many(A, "SELECT action, detail FROM audit_logs WHERE actor_id = ?1 AND action LIKE 'admin.%' ORDER BY created_at", owner.id)).map((a) => a.action);
  assert.deepEqual(trail, ['admin.login_failed', 'admin.login']);
  assert.equal((await one(A, "SELECT COUNT(*) AS n FROM audit_logs WHERE detail LIKE '%' || ?1 || '%'", pw)).n, 0, 'passwords are never logged');
});

test('five wrong passwords lock that account from that address for 15 minutes, and only from that address', async () => {
  const admin = await account(A, { role: 'admin' });
  const attacker = client(A);
  for (let i = 0; i < 5; i++) assert.equal((await attacker('POST', '/api/admin/auth/login', { email: admin.email, password: `wrong guess ${i}` })).status, 401);
  const locked = await attacker('POST', '/api/admin/auth/login', { email: admin.email, password: pw });
  assert.equal(locked.status, 429, 'even the right password is refused while locked');
  // the real administrator, somewhere else, is not locked out by someone else's guesses
  const real = await client(A)('POST', '/api/admin/auth/login', { email: admin.email, password: pw });
  assert.equal(real.status, 200);
});

/* ---------------- sign-in: password, then the emailed code ---------------- */
test('with email set up, the password is followed by a 6-digit code sent to the account', async () => {
  const owner = await ownerOf(B);
  const c = client(B);
  outbox.length = 0;
  const step1 = await c('POST', '/api/admin/auth/login', { email: owner.email, password: pw });
  await settle(B);
  assert.equal(step1.status, 200);
  assert.deepEqual({ step: step1.body.step, sentTo: step1.body.sentTo, minutes: step1.body.minutes }, { step: 'code', sentTo: 'bo•••@example.com', minutes: 10 });
  assert.ok(!c.jar.has('__Host-tc_admin'), 'no console session before the code');
  assert.match(step1.setCookie.find((s) => s.startsWith('__Host-tc_admin_step=')), /; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=600$/);
  assert.equal((await c('GET', '/api/admin/auth/me')).status, 401);

  const code = lastCode(owner.email);
  assert.match(code, /^\d{6}$/);
  const mail = outbox.find((m) => m.to.includes(owner.email));
  assert.equal(mail.subject, 'Your TypeCraft admin sign-in code');
  assert.ok(mail.text.includes('Chrome on Windows'));
  assert.ok(!JSON.stringify(step1.body).includes(code), 'the code is only in the email');
  const logged = await many(B, "SELECT subject, payload FROM email_logs WHERE template = 'admin_otp'");
  assert.equal(logged.length, 1);
  assert.ok(!JSON.stringify(logged).includes(code), 'the code is not kept in the email log');
  assert.equal((await one(B, "SELECT COUNT(*) AS n FROM otp_verifications WHERE code_hash = ?1", code)).n, 0, 'only a keyed hash of the code is stored');

  // a different browser that knows the code but never passed the password step
  assert.equal((await client(B)('POST', '/api/admin/auth/verify', { code })).status, 401);
  // a wrong code, then the right one
  const wrong = await c('POST', '/api/admin/auth/verify', { code: code === '000000' ? '000001' : '000000' });
  assert.equal(wrong.status, 400); assert.equal(wrong.body.error.code, 'invalid_code');
  assert.equal((await c('POST', '/api/admin/auth/verify', { code: '12ab' })).status, 400);
  const again = await c('POST', '/api/admin/auth/resend', {});
  assert.equal(again.status, 429, 'a new code at most once a minute'); assert.equal(again.body.error.code, 'otp_cooldown');

  const done = await c('POST', '/api/admin/auth/verify', { code: `${code.slice(0, 3)} ${code.slice(3)}` });
  assert.equal(done.status, 200); assert.equal(done.body.step, 'done');
  assert.ok(c.jar.has('__Host-tc_admin')); assert.ok(!c.jar.has('__Host-tc_admin_step'), 'the step cookie is cleared');
  const me = await c('GET', '/api/admin/auth/me');
  assert.equal(me.body.session.secondFactor, true); assert.equal(me.body.emailCodes, true);

  // the code worked once
  const replay = client(B);
  await replay('POST', '/api/admin/auth/login', { email: owner.email, password: pw }); // cooldown: no new code is made
  assert.notEqual((await replay('POST', '/api/admin/auth/verify', { code })).status, 200);
});

test('a forged or stale step cookie is refused; ADMIN_EMAIL_CODE=off is the emergency switch and warns the account by email', async () => {
  const owner = await ownerOf(B);
  const c = client(B);
  c.jar.set('__Host-tc_admin_step', `${owner.id}.${Date.now() + 60000}.${'0'.repeat(64)}`);
  assert.equal((await c('POST', '/api/admin/auth/verify', { code: '123456' })).status, 401);
  assert.equal((await c('POST', '/api/admin/auth/resend', {})).status, 401);

  B.env.ADMIN_EMAIL_CODE = 'off';
  try {
    outbox.length = 0;
    const d = client(B);
    const r = await d('POST', '/api/admin/auth/login', { email: owner.email, password: pw });
    await settle(B);
    assert.equal(r.body.step, 'done');
    assert.equal((await d('GET', '/api/admin/auth/me')).body.session.secondFactor, false);
    const alert = outbox.find((m) => m.to.includes(owner.email));
    assert.ok(alert && /admin/i.test(alert.text), 'the account is told about a sign-in without a code');
  } finally { delete B.env.ADMIN_EMAIL_CODE; }
});

test('ten wrong codes in an hour close the code step for that account, whichever address they come from', async () => {
  const admin = await account(B, { role: 'admin' });
  const newCode = async (c) => {
    await B.env.DB.prepare("UPDATE otp_verifications SET created_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?1").bind(admin.id).run(); // skip the one-minute wait
    outbox.length = 0;
    const r = await c('POST', '/api/admin/auth/login', { email: admin.email, password: pw });
    assert.equal(r.body.step, 'code');
    await settle(B);
    return lastCode(admin.email);
  };
  let wrong = 0;
  for (let round = 0; wrong < 10; round++) {
    const c = client(B); // a new address each time
    const code = await newCode(c);
    for (let i = 0; i < 4 && wrong < 10; i++, wrong++) {
      const guess = String((Number(code) + 1 + i) % 1000000).padStart(6, '0');
      assert.equal((await c('POST', '/api/admin/auth/verify', { code: guess })).status, 400);
    }
  }
  const c = client(B);
  const code = await newCode(c);
  const closed = await c('POST', '/api/admin/auth/verify', { code });
  assert.equal(closed.status, 429, 'even the right code is refused once the account has had ten wrong ones');
  assert.ok(!c.jar.has('__Host-tc_admin'));
  // an hour later it works again
  await B.env.DB.prepare('UPDATE rate_limits SET window_start = window_start - 3601 WHERE key = ?1').bind(`adm-code-fail:${admin.id}`).run();
  assert.equal((await c('POST', '/api/admin/auth/verify', { code })).status, 200);
});

/* ---------------- console sessions ---------------- */
test('a console session ends when idle, when it is too old, on sign-out, and the moment the role or account goes', async () => {
  const sessionOf = (c) => one(A, 'SELECT * FROM admin_sessions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1', c.who.id);
  const fresh = async (role = 'admin') => { const who = await account(A, { role }); const c = await consoleLogin(A, who); c.who = who; return c; };
  const ago = (ms) => new Date(Date.now() - ms).toISOString();

  let c = await fresh();
  await A.env.DB.prepare('UPDATE admin_sessions SET last_seen_at = ?2 WHERE user_id = ?1').bind(c.who.id, ago(29 * 60 * 1000)).run();
  assert.equal((await c('GET', '/api/admin/auth/me')).status, 200, '29 minutes idle is still in');
  await A.env.DB.prepare('UPDATE admin_sessions SET last_seen_at = ?2 WHERE user_id = ?1').bind(c.who.id, ago(31 * 60 * 1000)).run();
  const idle = await c('GET', '/api/admin/auth/me');
  assert.equal(idle.status, 401); assert.equal(idle.body.error.code, 'admin_sign_in');
  assert.equal((await sessionOf(c)).ended_reason, 'idle');

  c = await fresh();
  await A.env.DB.prepare('UPDATE admin_sessions SET expires_at = ?2 WHERE user_id = ?1').bind(c.who.id, ago(1000)).run();
  assert.equal((await c('GET', '/api/admin/auth/me')).status, 401);
  assert.equal((await sessionOf(c)).ended_reason, 'expired');

  c = await fresh();
  const token = c.jar.get('__Host-tc_admin');
  const out = await c('POST', '/api/admin/auth/logout', {});
  assert.equal(out.status, 200); assert.ok(!c.jar.has('__Host-tc_admin'));
  c.jar.set('__Host-tc_admin', token); // a copied cookie no longer works
  assert.equal((await c('GET', '/api/admin/auth/me')).status, 401);
  assert.equal((await sessionOf(c)).ended_reason, 'signed_out');

  c = await fresh('support');
  await A.env.DB.prepare('DELETE FROM admin_users WHERE user_id = ?1').bind(c.who.id).run();
  assert.equal((await c('GET', '/api/admin/auth/me')).status, 401);
  assert.equal((await sessionOf(c)).ended_reason, 'role_removed');

  c = await fresh();
  await A.env.DB.prepare("UPDATE users SET account_status = 'disabled' WHERE id = ?1").bind(c.who.id).run();
  assert.equal((await c('GET', '/api/admin/auth/me')).status, 401);
  assert.equal((await sessionOf(c)).ended_reason, 'account_disabled');

  // changing the password in the learner account ends every console session of that account
  c = await fresh();
  const learner = c.who.learner;
  const changed = await learner('POST', '/api/auth/change-password', { currentPassword: pw, newPassword: 'another horse 10', confirmPassword: 'another horse 10' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await c('GET', '/api/admin/auth/me')).status, 401);
  assert.equal((await sessionOf(c)).ended_reason, 'password_changed');

  // "sign out everywhere" in the learner account includes the console
  c = await fresh();
  assert.equal((await c.who.learner('POST', '/api/auth/logout-all', {})).status, 200);
  assert.equal((await c('GET', '/api/admin/auth/me')).status, 401);
  assert.equal((await sessionOf(c)).ended_reason, 'signed_out_everywhere');

  // a role change applies on the very next request (nothing is cached in the session)
  c = await fresh('admin');
  assert.equal((await c('GET', '/api/admin/auth/me')).body.role, 'admin');
  await A.env.DB.prepare("UPDATE admin_users SET role = 'support' WHERE user_id = ?1").bind(c.who.id).run();
  const now = await c('GET', '/api/admin/auth/me');
  assert.equal(now.body.role, 'support');
  assert.ok(!now.body.permissions.includes('customers.manage'));
});

test('the nightly job removes console sign-ins older than 30 days and keeps the rest', async () => {
  const who = await account(A, { role: 'admin' });
  await consoleLogin(A, who); await consoleLogin(A, who);
  const rows = await many(A, 'SELECT id FROM admin_sessions WHERE user_id = ?1', who.id);
  await A.env.DB.prepare('UPDATE admin_sessions SET expires_at = ?2 WHERE id = ?1').bind(rows[0].id, new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString()).run();
  await cron(A.env, {}, '*/10 * * * *');
  assert.equal((await many(A, 'SELECT id FROM admin_sessions WHERE user_id = ?1', who.id)).length, 2, 'only the nightly run cleans up');
  await cron(A.env, {}, '17 21 * * *');
  assert.deepEqual((await many(A, 'SELECT id FROM admin_sessions WHERE user_id = ?1', who.id)).map((r) => r.id), [rows[1].id]);
});

/* ---------------- roles and permissions ---------------- */
test('defaults: Support cannot refund, manage administrators, or touch settings; Admin runs operations; Super Admin has everything', async () => {
  const keys = (role) => permissionsFor(A.env, role);
  const support = await keys('support'), admin = await keys('admin'), owner = await keys('owner');
  assert.equal(owner.length, PERMISSIONS.length);
  for (const k of ['payments.refund', 'admins.manage', 'roles.manage', 'settings.view', 'settings.manage', 'audit.view', 'customers.manage', 'subscriptions.manage', 'packages.manage']) {
    assert.ok(!support.includes(k), `support must not have ${k}`);
  }
  assert.deepEqual(support.sort(), ['access.view', 'analytics.view', 'course.view', 'customers.notes', 'customers.view', 'dashboard.view', 'emails.view', 'packages.view', 'payments.recheck',
    'payments.view', 'progress.view', 'refunds.view', 'subscriptions.view', 'support.manage', 'support.view', 'unlock.view']);
  for (const k of ['course.edit', 'course.publish']) assert.ok(!support.includes(k), `support must not have ${k}`);
  for (const k of ['customers.export', 'customers.manage', 'payments.export']) assert.ok(!support.includes(k), `support must not have ${k}`);
  for (const k of ['payments.refund', 'settings.manage', 'roles.manage', 'admins.manage', 'unlock.manage', 'course.publish']) assert.ok(!admin.includes(k), `admin must not have ${k} by default`);
  assert.equal(admin.length, 29);
  assert.deepEqual(await keys('learner'), []); assert.deepEqual(await keys(null), []);
  await assert.rejects(() => can(A.env, 'admin', 'no.such.permission'), /unknown permission/);
  // every permission belongs to one of the four layers
  for (const p of PERMISSIONS) assert.ok(['core', 'learning', 'growth', 'infra'].includes(p.layer), p.key);
});

test('the grid: everyone with roles.view can read it, only a Super Admin can change it, and changes reach the old admin APIs at once', async () => {
  const owner = await consoleLogin(A, await ownerOf(A));
  const adminWho = await account(A, { role: 'admin' }), supportWho = await account(A, { role: 'support' });
  const admin = await consoleLogin(A, adminWho), support = await consoleLogin(A, supportWho);

  const grid = await owner('GET', '/api/admin/permissions');
  assert.equal(grid.status, 200);
  assert.equal(grid.body.canEdit, true);
  assert.deepEqual(grid.body.roles.map((r) => [r.key, r.label, r.editable]), [['owner', 'Super Admin', false], ['admin', 'Admin', true], ['support', 'Support', true]]);
  assert.deepEqual(grid.body.layers.map((l) => l.key), ['core', 'learning', 'growth', 'infra']);
  assert.equal(grid.body.permissions.length, PERMISSIONS.length);
  const refund = grid.body.permissions.find((p) => p.key === 'payments.refund');
  assert.deepEqual(refund.roles, { admin: { allowed: false, default: false, changed: false }, support: { allowed: false, default: false, changed: false } });
  assert.equal(refund.sensitive, true);

  const asAdmin = await admin('GET', '/api/admin/permissions');
  assert.equal(asAdmin.status, 200); assert.equal(asAdmin.body.canEdit, false);
  assert.equal((await support('GET', '/api/admin/permissions')).status, 403, 'Support does not see the grid by default');
  assert.equal((await support('GET', '/api/admin/staff')).status, 403);
  for (const c of [admin, support]) {
    const r = await c('PUT', '/api/admin/permissions', { role: 'support', permission: 'payments.refund', allowed: true });
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'forbidden');
    assert.equal((await c('POST', '/api/admin/permissions/reset', { role: 'admin' })).status, 403);
  }

  // bad input
  const put = (body) => owner('PUT', '/api/admin/permissions', body);
  assert.equal((await put({ role: 'owner', permission: 'payments.view', allowed: false })).status, 400);
  assert.equal((await put({ role: 'admin', permission: 'nope.nope', allowed: true })).status, 400);
  assert.equal((await put({ role: 'admin', permission: 'payments.view', allowed: 'yes' })).status, 400);
  for (const k of ['roles.manage', 'admins.manage']) {
    const r = await put({ role: 'admin', permission: k, allowed: true });
    assert.equal(r.status, 400); assert.equal(r.body.error.code, 'owner_only');
  }
  assert.equal((await many(A, 'SELECT * FROM role_permissions')).length, 0);

  // Support cannot see revenue by default (an endpoint the current /admin pages use)
  assert.equal((await support('GET', '/api/admin/revenue')).status, 403);
  const on = await put({ role: 'support', permission: 'revenue.view', allowed: true });
  assert.equal(on.status, 200); assert.equal(on.body.changed, true);
  assert.deepEqual(on.body.permissions.find((p) => p.key === 'revenue.view').roles.support, { allowed: true, default: false, changed: true });
  assert.equal((await support('GET', '/api/admin/revenue')).status, 200, 'the change applies on the next request');
  assert.ok((await support('GET', '/api/admin/auth/me')).body.permissions.includes('revenue.view'));
  // taking something away that a role has by default
  assert.equal((await admin('GET', '/api/admin/audit')).status, 200);
  await put({ role: 'admin', permission: 'audit.view', allowed: false });
  assert.equal((await admin('GET', '/api/admin/audit')).status, 403);
  // setting a switch to what it already is changes nothing and writes no audit entry
  const same = await put({ role: 'admin', permission: 'audit.view', allowed: false });
  assert.equal(same.body.changed, false);

  const stored = await many(A, 'SELECT role, permission, allowed, updated_by FROM role_permissions ORDER BY role');
  assert.deepEqual(stored.map((r) => [r.role, r.permission, r.allowed]), [['admin', 'audit.view', 0], ['support', 'revenue.view', 1]]);
  assert.equal(stored[0].updated_by, (await ownerOf(A)).id);
  // back to the default removes the stored row
  await put({ role: 'support', permission: 'revenue.view', allowed: false });
  assert.equal((await many(A, "SELECT * FROM role_permissions WHERE role = 'support'")).length, 0);

  const reset = await owner('POST', '/api/admin/permissions/reset', { role: 'admin' });
  assert.equal(reset.status, 200); assert.equal(reset.body.changed, true);
  assert.equal((await admin('GET', '/api/admin/audit')).status, 200);
  assert.equal((await owner('POST', '/api/admin/permissions/reset', { role: 'owner' })).status, 400);

  const audit = await many(A, "SELECT action, target, detail FROM audit_logs WHERE action LIKE 'permission.%' ORDER BY created_at, action");
  assert.deepEqual(audit.map((a) => [a.action, a.target]), [
    ['permission.update', 'role:support'], ['permission.update', 'role:admin'], ['permission.update', 'role:support'], ['permission.reset', 'role:admin'],
  ]);
  assert.deepEqual(JSON.parse(audit[0].detail), { permission: 'revenue.view', before: false, after: true });
  assert.deepEqual(JSON.parse(audit[3].detail), { removed: [{ permission: 'audit.view', allowed: false }] });
});

test('unknown rows in role_permissions never grant anything; owner-only stays owner-only even if a row is forced in', async () => {
  const now = new Date().toISOString();
  await A.env.DB.prepare("INSERT INTO role_permissions (role, permission, allowed, updated_at) VALUES ('admin', 'roles.manage', 1, ?1), ('support', 'made.up', 1, ?1), ('support', 'admins.manage', 1, ?1)").bind(now).run();
  try {
    assert.equal(await can(A.env, 'admin', 'roles.manage'), false);
    assert.equal(await can(A.env, 'support', 'admins.manage'), false);
    assert.ok(!(await permissionsFor(A.env, 'support')).includes('made.up'));
    const admin = await consoleLogin(A, await account(A, { role: 'admin' }));
    assert.equal((await admin('PUT', '/api/admin/permissions', { role: 'support', permission: 'payments.view', allowed: false })).status, 403);
  } finally {
    await A.env.DB.prepare("DELETE FROM role_permissions WHERE permission IN ('roles.manage', 'made.up', 'admins.manage')").run();
  }
});

test('sensitive changes need the password confirmed in the last 10 minutes', async () => {
  const who = await ownerOf(A);
  const owner = await consoleLogin(A, who);
  const change = () => owner('PUT', '/api/admin/permissions', { role: 'admin', permission: 'emails.announce', allowed: false });
  await A.env.DB.prepare('UPDATE admin_sessions SET reauth_at = ?2 WHERE user_id = ?1 AND ended_at IS NULL').bind(who.id, new Date(Date.now() - 11 * 60 * 1000).toISOString()).run();
  const stale = await change();
  assert.equal(stale.status, 403); assert.equal(stale.body.error.code, 'reauth_required');
  assert.equal((await owner('GET', '/api/admin/permissions')).status, 200, 'reading is not sensitive');
  assert.equal((await owner('GET', '/api/admin/auth/me')).body.session.fresh, false);

  const bad = await owner('POST', '/api/admin/auth/reauth', { password: 'not the password 1' });
  assert.equal(bad.status, 400); assert.equal(bad.body.error.fields.password, "That isn't your password.");
  assert.equal((await change()).status, 403);
  assert.equal((await owner('POST', '/api/admin/auth/reauth', {})).status, 400);
  const good = await owner('POST', '/api/admin/auth/reauth', { password: pw });
  assert.equal(good.status, 200); assert.equal(good.body.fresh, true);
  assert.equal((await change()).status, 200);
  await owner('POST', '/api/admin/permissions/reset', { role: 'admin' });
  assert.equal((await client(A)('POST', '/api/admin/auth/reauth', { password: pw })).status, 401, 'needs a console session');
});

test('console-only APIs need the console sign-in; the current /admin APIs still accept the site sign-in of an account with a role', async () => {
  const owner = await ownerOf(A);
  const learnerOnly = owner.learner; // signed in to the site, not to the console
  for (const [method, p, body] of [['GET', '/api/admin/permissions'], ['GET', '/api/admin/staff'], ['GET', '/api/admin/console/setup'], ['GET', '/api/admin/auth/me'],
    ['PUT', '/api/admin/permissions', { role: 'admin', permission: 'audit.view', allowed: false }], ['POST', '/api/admin/permissions/reset', { role: 'admin' }]]) {
    const r = await learnerOnly(method, p, body);
    assert.equal(r.status, 401, `${method} ${p}`); assert.equal(r.body.error.code, 'admin_sign_in');
  }
  assert.equal((await learnerOnly('GET', '/api/admin/overview')).status, 200);
  assert.equal((await learnerOnly('GET', '/api/admin/me')).body.role, 'owner');
  // someone without a role: the admin API does not exist for them
  const plain = (await account(A)).learner;
  assert.equal((await plain('GET', '/api/admin/overview')).status, 404);
  assert.equal((await plain('GET', '/api/admin/permissions')).status, 401);
  assert.equal((await client(A)('GET', '/api/admin/overview')).status, 404);
});

test('who has access: Super Admins from OWNER_EMAILS and the people in admin_users, nobody else', async () => {
  const owner = await consoleLogin(A, await ownerOf(A));
  const a = await account(A, { role: 'admin', name: 'Priya Ops' });
  const plain = await account(A);
  await consoleLogin(A, a);
  A.env.OWNER_EMAILS = `${OWNER}, second-owner@example.com`;
  try {
    const r = await owner('GET', '/api/admin/staff');
    assert.equal(r.status, 200);
    const emails = r.body.staff.map((s) => s.email);
    assert.equal(emails[0], OWNER);
    assert.ok(emails.includes(a.email)); assert.ok(!emails.includes(plain.email));
    const row = r.body.staff.find((s) => s.email === a.email);
    assert.deepEqual({ fullName: row.fullName, role: row.role, roleLabel: row.roleLabel, active: row.active }, { fullName: 'Priya Ops', role: 'admin', roleLabel: 'Admin', active: true });
    assert.ok(Date.parse(row.lastAdminSignIn) > Date.now() - 60000);
    assert.equal(r.body.ownersWithoutAccount, 1);
    assert.ok(!r.text.includes('password_hash') && !/"[a-f0-9]{64}"/.test(r.text), 'no hashes or session ids');
  } finally { A.env.OWNER_EMAILS = OWNER; }
});

test('the setup checklist says what is switched on and never shows a value', async () => {
  const ownerA = await consoleLogin(A, await ownerOf(A));
  const a = await ownerA('GET', '/api/admin/console/setup');
  assert.equal(a.status, 200);
  const flags = (r) => Object.fromEntries(r.body.items.map((i) => [i.key, i.ready]));
  assert.deepEqual(flags(a), { owner: true, email: false, secret: false, adminCode: false, razorpay: true, webhook: true });
  assert.equal(a.body.items.find((i) => i.key === 'razorpay').mode, 'test');
  // server B has email and the secret: sign in with the code
  const ownerB = client(B);
  await B.env.DB.prepare("UPDATE otp_verifications SET created_at = '2000-01-01T00:00:00.000Z'").run();
  outbox.length = 0;
  await ownerB('POST', '/api/admin/auth/login', { email: OWNER, password: pw });
  await ownerB('POST', '/api/admin/auth/verify', { code: lastCode(OWNER) });
  const b = await ownerB('GET', '/api/admin/console/setup');
  assert.deepEqual(flags(b), { owner: true, email: true, secret: true, adminCode: true, razorpay: false, webhook: false });
  for (const secret of [...SECRET_VALUES, 'rzp_test_abc']) assert.ok(!a.text.includes(secret) && !b.text.includes(secret), 'no setting values in the answer');
  const support = await consoleLogin(A, await account(A, { role: 'support' }));
  assert.equal((await support('GET', '/api/admin/console/setup')).status, 403);
});

/* ---------------- pages ---------------- */
const NO_REDIRECT = ['https://evil.example/', '//evil.example', '/\\evil.example', '/consolex', '/console/../login', '/console/login', '/account', '/console/a b', 'javascript:alert(1)', '/console#x', ''];
test('safeConsoleNext keeps only addresses inside the console', () => {
  for (const v of NO_REDIRECT) assert.equal(safeConsoleNext(v), null, v);
  for (const v of ['/console', '/console/roles', '/console/roles?tab=staff&x=1']) assert.equal(safeConsoleNext(v), v);
  assert.equal(safeConsoleNext('/console/' + 'a'.repeat(400)), null);
  assert.equal(safeConsoleNext(null), null);
});

test('console pages: sign-in first, strict headers, no inline code, and nothing sensitive in the page', async () => {
  const anon = client(A);
  for (const [p, to] of [['/console', '/console/login'], ['/console/roles', '/console/login?next=%2Fconsole%2Froles'], ['/console/roles?x=1', '/console/login?next=%2Fconsole%2Froles%3Fx%3D1'], ['/console/anything/else', '/console/login?next=%2Fconsole%2Fanything%2Felse']]) {
    const r = await anon('GET', p);
    assert.equal(r.status, 302, p); assert.equal(r.headers.get('location'), A.base + to);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
  }
  assert.equal((await anon('GET', '/console/')).headers.get('location'), A.base + '/console');
  assert.equal((await anon('POST', '/console', {})).status, 405);

  const login = await anon('GET', '/console/login?next=' + encodeURIComponent('/console/roles'));
  assert.equal(login.status, 200);
  const csp = login.headers.get('content-security-policy');
  assert.ok(csp.includes("default-src 'none'") && csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'") && csp.includes("form-action 'self'"));
  assert.ok(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'));
  assert.equal(login.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(login.headers.get('x-frame-options'), 'DENY');
  assert.equal(login.headers.get('cache-control'), 'private, no-store');
  assert.equal(login.headers.get('referrer-policy'), 'same-origin');
  assert.ok(login.text.includes('data-next="/console/roles"'));
  assert.ok(login.text.includes('Admin sign in'));
  for (const bad of NO_REDIRECT) {
    const r = await anon('GET', '/console/login?next=' + encodeURIComponent(bad));
    assert.ok(r.text.includes('data-next=""'), `next=${bad}`);
  }

  const owner = await consoleLogin(A, await ownerOf(A));
  const noInlineCode = (html) => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    for (const [, attrs, body] of scripts) assert.ok(/\bsrc="\/site\/console\/[\w.-]+\?v=\w+"/.test(attrs) ? body === '' : /type="application\/json"/.test(attrs), `inline script: ${attrs}`);
    assert.ok(!/\sstyle="/.test(html), 'no inline styles');
    assert.ok(!/\son[a-z]+="/.test(html), 'no inline event handlers');
    assert.ok(!/<style\b/.test(html), 'no style blocks');
  };
  noInlineCode(login.text);

  // signed in: the sign-in page sends you on, only to console addresses
  assert.equal((await owner('GET', '/console/login')).headers.get('location'), A.base + '/console');
  assert.equal((await owner('GET', '/console/login?next=%2Fconsole%2Froles')).headers.get('location'), A.base + '/console/roles');
  for (const bad of NO_REDIRECT) assert.equal((await owner('GET', '/console/login?next=' + encodeURIComponent(bad))).headers.get('location'), A.base + '/console', bad);

  const home = await owner('GET', '/console');
  assert.equal(home.status, 200);
  noInlineCode(home.text);
  assert.equal(home.headers.get('content-security-policy'), csp);
  for (const layer of LAYERS) assert.ok(home.text.includes(layer.label), layer.label);
  assert.ok(home.text.includes('href="/console/roles"'));
  assert.ok(home.text.includes('Mayank Owner') && home.text.includes('Super Admin'));
  assert.equal((home.text.match(/class="nav-item is-soon"/g) || []).length, LAYERS.flatMap((l) => l.modules).filter((m) => m.path === undefined).length, 'modules that are not built are labels, not links');
  // what the page carries about the session: no token, no session id, no password hash
  const boot = JSON.parse(home.text.match(/<script type="application\/json" id="console-boot">([\s\S]*?)<\/script>/)[1]);
  assert.equal(boot.me.role, 'owner');
  assert.ok(!home.text.includes(owner.jar.get('__Host-tc_admin')));
  const sid = (await one(A, 'SELECT id FROM admin_sessions WHERE user_id = ?1 AND ended_at IS NULL ORDER BY created_at DESC', (await ownerOf(A)).id)).id;
  assert.ok(!home.text.includes(sid) && !/pbkdf2|password_hash/i.test(home.text));

  const roles = await owner('GET', '/console/roles');
  assert.equal(roles.status, 200);
  noInlineCode(roles.text);
  assert.ok(roles.text.includes('aria-current="page"') && roles.text.includes('/site/console/roles.js'));
  const missing = await owner('GET', '/console/nope');
  assert.equal(missing.status, 404); assert.ok(missing.text.includes('Page not found'));
  const head = await owner('HEAD', '/console');
  assert.equal(head.status, 200); assert.equal(head.text, '');

  // Support: no Roles link, and the page itself says no (the API refuses separately, tested above)
  const support = await consoleLogin(A, await account(A, { role: 'support' }));
  const sHome = await support('GET', '/console');
  assert.ok(!sHome.text.includes('href="/console/roles"'));
  assert.ok(!sHome.text.includes('id="setupList"'), 'no setup checklist without settings.view');
  const refused = await support('GET', '/console/roles');
  assert.equal(refused.status, 403);
  assert.ok(refused.text.includes("Your role doesn&#39;t include this page"));
  assert.ok(!refused.text.includes('/site/console/roles.js'));

  // a learner signed in to the site (even the owner) is not signed in to the console
  assert.equal((await (await ownerOf(A)).learner('GET', '/console')).status, 302);
});

test('the sidebar remembers which layers you opened or closed; a made-up cookie changes nothing', async () => {
  const owner = await consoleLogin(A, await ownerOf(A));
  const openGroups = (html) => [...html.matchAll(/<details class="nav-group" data-group="(\w+)"( open)?>/g)].filter((m) => m[2]).map((m) => m[1]);
  assert.deepEqual(openGroups((await owner('GET', '/console')).text), ['core', 'learning', 'infra'], 'by default: the layers that have something built');
  owner.jar.set('tc_console_nav', 'core-shut.learning-shut.infra-shut');
  assert.deepEqual(openGroups((await owner('GET', '/console')).text), []);
  assert.deepEqual(openGroups((await owner('GET', '/console/roles')).text), ['infra'], 'the layer you are in is always open');
  owner.jar.set('tc_console_nav', 'core-shut.learning-open.infra-shut');
  assert.deepEqual(openGroups((await owner('GET', '/console')).text), ['learning']);
  owner.jar.set('tc_console_nav', 'core-shut"><script>.x-open.growth-maybe');
  const html = (await owner('GET', '/console')).text;
  assert.deepEqual(openGroups(html), ['core', 'learning', 'infra']);
  assert.ok(!html.includes('<script>.x'));
});

test('writes are refused from other sites and without a JSON body', async () => {
  const owner = await ownerOf(A);
  const c = client(A);
  const cross = await c('POST', '/api/admin/auth/login', { email: owner.email, password: pw }, { Origin: 'https://evil.example' });
  assert.equal(cross.status, 403); assert.equal(cross.body.error.code, 'bad_origin');
  const form = await c('POST', '/api/admin/auth/login', `email=${encodeURIComponent(owner.email)}&password=x`, { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 415);
  const signedIn = await consoleLogin(A, owner);
  const forged = await signedIn('PUT', '/api/admin/permissions', { role: 'support', permission: 'payments.refund', allowed: true }, { Origin: 'https://evil.example' });
  assert.equal(forged.status, 403); assert.equal(forged.body.error.code, 'bad_origin');
  assert.equal((await many(A, "SELECT * FROM role_permissions WHERE permission = 'payments.refund'")).length, 0);
});

test('before migration 0005 the console says it is not switched on, and the rest of the site is unaffected', async () => {
  const DB = new D1Shim();
  for (const f of ['0001_accounts.sql', '0002_next.sql', '0003_saas.sql', '0004_billing_archive.sql']) DB.db.exec(readFileSync(path.join(root, 'migrations', f), 'utf8'));
  const env = { ...makeEnv({ OWNER_EMAILS: OWNER }), DB };
  const call = async (method, p, body, cookie) => {
    const headers = { Origin: 'http://localhost:8793', 'CF-Connecting-IP': '10.40.0.1' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await worker.fetch(new Request('http://localhost:8793' + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil() {} });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, text, body: json, cookie: (res.headers.getSetCookie()[0] || '').split(';')[0] };
  };
  const signup = await call('POST', '/api/auth/signup', { fullName: 'Mayank Owner', email: OWNER, phoneNumber: '+91 98765 43210', password: pw, confirmPassword: pw });
  assert.equal(signup.status, 201);
  const page = await call('GET', '/console/login');
  assert.equal(page.status, 503); assert.ok(page.text.includes('Database update 0005'));
  assert.ok(!page.text.includes('login.js'));
  assert.equal((await call('GET', '/console')).status, 302);
  const login = await call('POST', '/api/admin/auth/login', { email: OWNER, password: pw });
  assert.equal(login.status, 503); assert.equal(login.body.error.code, 'console_not_ready');
  // the current admin and the site keep working exactly as before
  assert.equal((await call('GET', '/api/admin/overview', undefined, signup.cookie)).status, 200);
  assert.equal((await call('GET', '/api/admin/me', undefined, signup.cookie)).body.role, 'owner');
  assert.equal((await call('PUT', '/api/admin/settings', { support: { email: 'help@example.com' } }, signup.cookie)).status, 200);
  assert.equal((await call('GET', '/')).status, 200);
});

test('migration 0005 only adds tables: running every migration twice keeps existing rows', async () => {
  const DB = new D1Shim();
  DB.applyMigrations(path.join(root, 'migrations'));
  DB.db.exec("INSERT INTO users (id, full_name, email, phone_number, password_hash, created_at, updated_at) VALUES ('u1', 'Kept', 'kept@example.com', '+911234567890', 'x', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')");
  DB.db.exec("INSERT INTO role_permissions (role, permission, allowed, updated_at) VALUES ('support', 'revenue.view', 1, '2026-01-01T00:00:00Z')");
  DB.db.exec(readFileSync(path.join(root, 'migrations', '0005_admin_console.sql'), 'utf8'));
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM role_permissions').get().n, 1);
  const sql = readFileSync(path.join(root, 'migrations', '0005_admin_console.sql'), 'utf8').replace(/--.*$/gm, '');
  const statements = sql.split(';').map((x) => x.trim()).filter(Boolean);
  assert.ok(statements.length >= 2);
  for (const st of statements) assert.match(st, /^CREATE (TABLE|INDEX) IF NOT EXISTS /, 'nothing but CREATE … IF NOT EXISTS');
});

test('the console is not advertised to crawlers, stays out of the service worker, and its own files hold no data', async () => {
  const robots = await client(A)('GET', '/robots.txt');
  assert.ok(!robots.text.includes('/console'));
  const sw = readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.ok(sw.includes("url.pathname.startsWith('/console/')") && sw.includes("url.pathname.startsWith('/site/console/')"));
  for (const f of ['console.js', 'login.js', 'home.js', 'roles.js', 'theme.js', 'console.css']) {
    const r = await client(A)('GET', `/site/console/${f}`);
    assert.equal(r.status, 200, f);
    assert.ok(!/innerHTML|document\.write|eval\(/.test(r.text), `${f}: no HTML injection points`);
  }
});
test('static routing: everything goes through the Worker except the public folders', () => {
  const cfg = readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8');
  const list = JSON.parse(cfg.match(/"run_worker_first":\s*(\[[^\]]*\])/)[1]);
  assert.equal(list[0], '/*', 'everything goes through the Worker unless listed');
  const skipped = list.slice(1);
  assert.deepEqual(skipped.sort(), ['!/css/*', '!/icons/*', '!/js/*', '!/manifest.webmanifest', '!/shared/*', '!/site/*']);
  assert.ok(!skipped.some((p) => /html|admin|console|api|src|migrations/.test(p)));
  // nothing private lives in the folders that skip the Worker: only styles, scripts, icons
  const ignore = readFileSync(path.join(root, '.assetsignore'), 'utf8');
  for (const dir of ['src', 'migrations', 'tests', 'docs']) assert.match(ignore, new RegExp(`^${dir}$`, 'm'));
  // and no page hides in them: an .html file there would be served without the sign-in check
  const files = ['css', 'js', 'shared', 'icons', 'site'].flatMap((dir) => readdirSync(path.join(root, dir), { recursive: true }).map(String));
  assert.ok(files.length > 30);
  for (const f of files.filter((x) => x.includes('.'))) assert.match(f, /\.(css|js|svg|png|webp|ico|woff2)$/, f);
  const headers = readFileSync(path.join(root, '_headers'), 'utf8');
  assert.match(headers, /workers\.dev\/\*\n\s+X-Robots-Tag: noindex/);
});
