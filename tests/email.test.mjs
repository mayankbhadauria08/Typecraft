// Email + auth additions: templates, sendTemplate lifecycle and retries, OTP sign-in and
// confirmation, contact form, preferences, admin access, webhook. node --test tests/email.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { makeEnv, startServer } from './server.mjs';
import { renderTemplate, TEMPLATE_NAMES } from '../src/mail-templates.js';
import { sendTemplate, cron, processQueue, RETRY_DELAYS_MS } from '../src/mail.js';
import { generateCode } from '../src/otp.js';

const WEBHOOK_KEY = Buffer.from('a-test-webhook-signing-key-32byte').toString('base64');
let env, srv, base, outbox, mode;
const realFetch = globalThis.fetch;
let providerSeq = 0;
before(async () => {
  env = makeEnv({
    RESEND_API_KEY: 'test-key', SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    OWNER_EMAILS: 'boss@example.com', RESEND_WEBHOOK_SECRET: `whsec_${WEBHOOK_KEY}`,
  });
  outbox = []; mode = 'ok';
  // Resend is mocked: 'ok' accepts, 'fail' answers 500 (worth a retry), 'reject' answers 422
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) {
      const body = JSON.parse(init.body);
      body._headers = init.headers;
      if (mode === 'fail') return new Response('{"message":"down"}', { status: 500 });
      if (mode === 'reject') return new Response('{"message":"bad"}', { status: 422 });
      outbox.push(body);
      return new Response(JSON.stringify({ id: `re_${++providerSeq}` }), { status: 200 });
    }
    return realFetch(url, init);
  };
  srv = await startServer(env, 8798);
  base = `http://localhost:${srv.port}`;
});
after(() => { srv.server.close(); globalThis.fetch = realFetch; });

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
let ipN = 0;
function client(ua = CHROME_WIN) {
  let cookie = null;
  const ip = `10.20.0.${++ipN}`;
  const c = async (method, path, body) => {
    env.__ip = ip;
    const headers = { Origin: base, 'User-Agent': ua };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await realFetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of res.headers.getSetCookie()) cookie = /Max-Age=0/.test(sc) ? null : sc.split(';')[0];
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, body: json, text, setCookie: res.headers.getSetCookie() };
  };
  c.cookie = () => cookie;
  return c;
}
const pw = 'correct horse 9';
async function signup(email, ua) {
  const c = client(ua);
  const r = await c('POST', '/api/auth/signup', { fullName: 'Test Person', email, phoneNumber: '+91 98765 43210', password: pw, confirmPassword: pw });
  assert.equal(r.status, 201);
  c.user = r.body.user;
  await settle();
  return c;
}
const settle = async () => { while (srv.pending.length) await Promise.all(srv.pending.splice(0)); };
const mailsTo = (email) => outbox.filter((m) => m.to.includes(email));
const codeIn = (mail) => { const m = mail.text.match(/Your code: (\d{6})/); return m && m[1]; };
const lastCode = (email) => codeIn([...mailsTo(email)].reverse().find((m) => /Your code: \d{6}/.test(m.text)));
async function clearCooldown() {
  await env.DB.prepare("DELETE FROM rate_limits WHERE key LIKE 'otp-cool:%'").run();
  await env.DB.prepare("UPDATE otp_verifications SET created_at = '2000-01-01T00:00:00.000Z'").run();
}
const log = (id) => env.DB.prepare('SELECT * FROM email_logs WHERE id = ?1').bind(id).first();

/* ---------------- templates ---------------- */
const EVIL = '<script>alert(1)</script>';
const SAMPLE = {
  welcome: {}, verify_email: { link: 'https://typecrafttyping.in/verify-email#token=abc', code: '123456' },
  otp_login: { code: '654321' }, admin_otp: { code: '112233', device: 'Chrome on Windows' }, login_alert: { device: 'Chrome on Windows', time: '2026-11-15T10:00:00Z', location: 'IN' },
  password_reset: { link: 'https://typecrafttyping.in/reset-password#token=abc' }, password_changed: { time: '2026-11-15T10:00:00Z' },
  security_alert: { title: 'Odd activity', message: `Something ${EVIL} happened` }, email_changed: { oldEmail: 'a@example.com', newEmail: 'b@example.com' },
  payment_success: { packageName: `Pro ${EVIL}`, amountPaise: 19900, orderId: 'ord_1', invoiceNumber: 'TC-2026-000001', startsAt: '2026-11-15T00:00:00Z', expiresAt: '2027-02-13T00:00:00Z' },
  payment_failed: { packageName: 'Pro', amountPaise: 19900, reason: `Card declined ${EVIL}` },
  invoice: { invoiceNumber: 'TC-2026-000001', amountPaise: 19900, issuedAt: '2026-11-15T00:00:00Z', lines: [{ description: `Pro ${EVIL}`, amountPaise: 19900 }] },
  subscription_renewal_reminder: { packageName: 'Pro', expiresAt: '2026-11-18T00:00:00Z' },
  subscription_expired: { packageName: 'Pro', expiredAt: '2026-11-15T00:00:00Z' },
  refund_processed: { amountPaise: 9950, orderId: 'ord_1', reason: EVIL },
  announcement: { subject: `New packs ${EVIL}`, body: `Hello ${EVIL}\n\nSee https://typecrafttyping.in/practice` },
  account_update: { title: 'Plan granted', message: `You got Pro ${EVIL}`, ctaLabel: 'Open', ctaUrl: 'javascript:alert(1)' },
  test_completed: { wpm: 52.4, accuracy: 97.2, duration: 60, errors: 3, best: true },
  contact_received: { topic: 'billing', message: `Help ${EVIL}` },
  contact_forward: { email: 'x@example.com', topic: 'billing', message: `Help ${EVIL}`, priority: true },
  institute_invite: { instituteName: `Sharma Typing ${EVIL}`, role: 'admin', invitedBy: 'TypeCraft', email: 'boss@example.com', link: '/institute' },
  student_invite: { instituteName: `Sharma ${EVIL}`, batchName: 'Morning', batchCode: 'KQ7M-PX3D', joinPath: '/join/KQ7M-PX3D' },
  institute_reminder: { instituteName: 'Sharma', kind: 'ends', lastDay: '30 Nov 2026', days: 7, link: '/institute', online: true },
  institute_payment: { instituteName: `Sharma ${EVIL}`, kind: 'new', what: `TypeCraft Pro plan for 20 students ${EVIL}`, amountPaise: 1998000, invoiceNumber: 'TC-2026-000009',
    invoiceUrl: '/institute/ins_00000000000000000000/invoices/TC-2026-000009', link: 'javascript:alert(1)', seats: 20, lastDay: '2027-11-18' },
};

test('every template renders a subject, escaped HTML and a text part', () => {
  assert.equal(TEMPLATE_NAMES.length, 24);
  const site = { siteUrl: 'https://typecrafttyping.in', supportEmail: 'hello@typecrafttyping.com', unsubscribeUrl: 'https://typecrafttyping.in/api/email/unsubscribe?u=1&t=2' };
  for (const name of TEMPLATE_NAMES) {
    assert.ok(SAMPLE[name], `sample data for ${name}`);
    const out = renderTemplate(name, { name: EVIL, ...SAMPLE[name] }, site);
    assert.ok(out.subject && out.subject.trim().length > 0, `${name}: subject`);
    assert.ok(!/[\r\n]/.test(out.subject), `${name}: one-line subject`);
    assert.ok(!out.html.includes('<script>'), `${name}: html escapes user data`);
    assert.ok(!out.html.includes('javascript:'), `${name}: no unsafe links`);
    assert.ok(out.text && out.text.length > 20, `${name}: text part`);
    assert.match(out.html, /type<em[^>]*>craft<\/em>/, `${name}: wordmark`);
    assert.match(out.html, /hello@typecrafttyping\.com/, `${name}: support email`);
    assert.match(out.html, /https:\/\/typecrafttyping\.in/, `${name}: site link`);
    assert.equal(/Unsubscribe/i.test(out.html), name === 'announcement', `${name}: unsubscribe only on announcements`);
  }
  assert.match(renderTemplate('contact_forward', { name: EVIL, ...SAMPLE.contact_forward }, site).html, /&lt;script&gt;/);
  assert.match(renderTemplate('payment_success', { name: 'A', ...SAMPLE.payment_success }, site).text, /₹199/);
  assert.match(renderTemplate('verify_email', { name: 'A', ...SAMPLE.verify_email }, site).text, /Your code: 123456/);
  assert.throws(() => renderTemplate('nope', {}, site));
});

test('codes are 6 digits and spread over the whole range', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) { const c = generateCode(); assert.match(c, /^\d{6}$/); seen.add(c[0]); }
  assert.equal(seen.size, 10);
});

/* ---------------- sendTemplate lifecycle ---------------- */
test('sendTemplate logs a sent email with the provider id, and never stores codes or links', async () => {
  const r = await sendTemplate(env, {}, { to: 'Log@Example.com', template: 'verify_email', data: { name: 'L', link: 'https://x.test/verify-email#token=SECRET', code: '111222' } });
  assert.equal(r.status, 'sent');
  const row = await log(r.id);
  assert.equal(row.status, 'sent'); assert.equal(row.to_email, 'log@example.com'); assert.equal(row.category, 'auth');
  assert.match(row.provider_id, /^re_/); assert.equal(row.attempts, 1); assert.ok(row.sent_at);
  assert.ok(!row.payload.includes('SECRET') && !row.payload.includes('111222'));
  const mail = outbox[outbox.length - 1];
  assert.equal(mail.from, 'TypeCraft <hello@typecrafttyping.com>');
  assert.equal(mail.reply_to, 'hello@typecrafttyping.com');
  assert.ok(mail.html && mail.text && mail.subject);
});

test('sendTemplate never throws: unknown template, bad address and missing key are logged as failed', async () => {
  assert.equal((await sendTemplate(env, {}, { to: 'x@example.com', template: 'nope' })).status, 'failed');
  assert.equal((await sendTemplate(env, {}, { to: 'not an email', template: 'welcome' })).status, 'failed');
  const saved = env.RESEND_API_KEY; delete env.RESEND_API_KEY;
  const before = outbox.length;
  const r = await sendTemplate(env, {}, { to: 'nokey@example.com', template: 'welcome', data: { name: 'N' } });
  env.RESEND_API_KEY = saved;
  assert.equal(r.status, 'failed'); assert.equal(outbox.length, before);
  const row = await log(r.id);
  assert.equal(row.last_error, 'not_configured'); assert.equal(row.next_attempt_at, null);
});

test('failed emails are retried by the 10-minute cron at +5m, +30m, +2h, +12h, then stay failed', async () => {
  mode = 'fail';
  const r = await sendTemplate(env, {}, { to: 'retry@example.com', template: 'welcome', data: { name: 'R' } });
  assert.equal(r.status, 'failed');
  let row = await log(r.id);
  assert.equal(row.status, 'failed'); assert.equal(row.last_error, 'http_500'); assert.equal(row.attempts, 1);
  const wait = Date.parse(row.next_attempt_at) - Date.now();
  assert.ok(Math.abs(wait - RETRY_DELAYS_MS[0]) < 5000, 'first retry in 5 minutes');
  // not due yet: nothing happens
  await cron(env, {}, '*/10 * * * *');
  assert.equal((await log(r.id)).attempts, 1);
  // the nightly cron kind does not retry
  await env.DB.prepare("UPDATE email_logs SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1").bind(r.id).run();
  await cron(env, {}, '17 21 * * *');
  assert.equal((await log(r.id)).attempts, 1);
  for (let i = 1; i <= 4; i++) {
    await env.DB.prepare("UPDATE email_logs SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1").bind(r.id).run();
    await cron(env, {}, '*/10 * * * *');
    row = await log(r.id);
    assert.equal(row.attempts, i + 1);
    if (i < 4) assert.ok(Math.abs(Date.parse(row.next_attempt_at) - Date.now() - RETRY_DELAYS_MS[i]) < 5000, `retry ${i + 1} delay`);
  }
  assert.equal(row.status, 'failed'); assert.equal(row.next_attempt_at, null); // gave up after 5 tries
  await cron(env, {}, '*/10 * * * *');
  assert.equal((await log(r.id)).attempts, 5);

  // a failed one that becomes deliverable is sent by the next run
  const r2 = await sendTemplate(env, {}, { to: 'retry2@example.com', template: 'welcome', data: { name: 'R2' } });
  mode = 'ok';
  await env.DB.prepare("UPDATE email_logs SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1").bind(r2.id).run();
  await cron(env, {}, '*/10 * * * *');
  const sent = await log(r2.id);
  assert.equal(sent.status, 'sent'); assert.equal(sent.attempts, 2);
  assert.equal(mailsTo('retry2@example.com').length, 1);
});

test('OTP, reset and verification emails are never retried; 4xx rejections are not retried', async () => {
  mode = 'fail';
  const otp = await sendTemplate(env, {}, { to: 'otpfail@example.com', template: 'otp_login', data: { code: '123456' } });
  const reset = await sendTemplate(env, {}, { to: 'otpfail@example.com', template: 'password_reset', data: { link: 'https://x.test/reset-password#token=t' } });
  mode = 'reject';
  const bad = await sendTemplate(env, {}, { to: 'otpfail@example.com', template: 'welcome', data: {} });
  mode = 'ok';
  for (const r of [otp, reset, bad]) {
    const row = await log(r.id);
    assert.equal(row.status, 'failed'); assert.equal(row.next_attempt_at, null);
  }
  assert.ok(!(await log(otp.id)).payload.includes('123456'));
  assert.ok(!(await log(otp.id)).subject.includes('123456'));
  await processQueue(env);
  assert.equal(mailsTo('otpfail@example.com').length, 0);
});

/* ---------------- OTP sign-in and confirmation ---------------- */
test('OTP request gives the same answer for unknown emails and only mails real accounts', async () => {
  await signup('otp-known@example.com');
  const before = outbox.length;
  const known = await client()('POST', '/api/auth/otp/request', { email: 'otp-known@example.com', purpose: 'login' });
  const unknown = await client()('POST', '/api/auth/otp/request', { email: 'otp-nobody@example.com', purpose: 'login' });
  await settle();
  assert.equal(known.status, 200); assert.equal(unknown.status, 200);
  assert.equal(known.body.message, unknown.body.message);
  assert.equal(outbox.length, before + 1);
  assert.match(lastCode('otp-known@example.com'), /^\d{6}$/);
  const stored = await env.DB.prepare("SELECT code_hash FROM otp_verifications WHERE email = 'otp-known@example.com' AND purpose = 'login'").first();
  assert.match(stored.code_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(stored.code_hash, lastCode('otp-known@example.com'));
  const logRow = await env.DB.prepare("SELECT payload FROM email_logs WHERE template = 'otp_login' AND to_email = 'otp-known@example.com'").first();
  assert.ok(!logRow.payload.includes(lastCode('otp-known@example.com')));
  assert.equal((await client()('POST', '/api/auth/otp/request', { email: 'x@example.com', purpose: 'reset' })).status, 400);
});

test('OTP verify (login) creates a session cookie like password sign-in', async () => {
  await clearCooldown();
  const c = client();
  await c('POST', '/api/auth/otp/request', { email: 'otp-known@example.com', purpose: 'login' });
  await settle();
  const code = lastCode('otp-known@example.com');
  const r = await c('POST', '/api/auth/otp/verify', { email: 'otp-known@example.com', code, purpose: 'login' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.email, 'otp-known@example.com');
  assert.match(r.setCookie[0], /^__Host-tc_session=[\w-]{40,};.*HttpOnly; Secure; SameSite=Lax; Max-Age=2592000/);
  assert.equal((await c('GET', '/api/auth/me')).body.user.email, 'otp-known@example.com');
  // single use
  const again = await client()('POST', '/api/auth/otp/verify', { email: 'otp-known@example.com', code, purpose: 'login' });
  assert.equal(again.status, 400);
});

test('five wrong codes burn the code, even for the right one afterwards', async () => {
  await clearCooldown();
  await client()('POST', '/api/auth/otp/request', { email: 'otp-known@example.com', purpose: 'login' });
  await settle();
  const code = lastCode('otp-known@example.com');
  const wrong = code === '000000' ? '000001' : '000000';
  const c = client();
  let r;
  for (let i = 0; i < 5; i++) r = await c('POST', '/api/auth/otp/verify', { email: 'otp-known@example.com', code: wrong, purpose: 'login' });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'code_burned');
  r = await c('POST', '/api/auth/otp/verify', { email: 'otp-known@example.com', code, purpose: 'login' });
  assert.equal(r.status, 400);
  assert.equal(c.cookie(), null);
});

test('an expired code is refused', async () => {
  await clearCooldown();
  await client()('POST', '/api/auth/otp/request', { email: 'otp-known@example.com', purpose: 'login' });
  await settle();
  const code = lastCode('otp-known@example.com');
  await env.DB.prepare("UPDATE otp_verifications SET expires_at = '2000-01-01T00:00:00.000Z' WHERE email = 'otp-known@example.com'").run();
  const r = await client()('POST', '/api/auth/otp/verify', { email: 'otp-known@example.com', code, purpose: 'login' });
  assert.equal(r.status, 400); assert.equal(r.body.error.code, 'code_expired');
});

test('a new code can only be asked for once a minute, for known and unknown emails alike', async () => {
  await clearCooldown();
  const c = client();
  assert.equal((await c('POST', '/api/auth/otp/request', { email: 'otp-known@example.com' })).status, 200);
  const again = await c('POST', '/api/auth/otp/request', { email: 'otp-known@example.com' });
  assert.equal(again.status, 429); assert.equal(again.body.error.code, 'otp_cooldown');
  assert.equal((await c('POST', '/api/auth/otp/request', { email: 'cool-nobody@example.com' })).status, 200);
  assert.equal((await c('POST', '/api/auth/otp/request', { email: 'cool-nobody@example.com' })).status, 429);
  await settle();
});

test('signup sends welcome + a verification email with a link and a code; the code confirms the email', async () => {
  const c = await signup('verify-code@example.com');
  const mails = mailsTo('verify-code@example.com');
  assert.deepEqual(mails.map((m) => m.subject).sort(), ['Confirm your TypeCraft email', 'Welcome to TypeCraft']);
  const verify = mails.find((m) => /Confirm/.test(m.subject));
  assert.match(verify.text, /https:\/\/typecrafttyping\.in\/verify-email#token=[\w-]{40,}/);
  const code = codeIn(verify);
  assert.match(code, /^\d{6}$/);
  assert.equal((await c('GET', '/api/auth/me')).body.user.emailVerified, false);
  const r = await client()('POST', '/api/auth/otp/verify', { email: 'verify-code@example.com', code, purpose: 'verify_email' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.emailVerified, true);
  assert.equal((await c('GET', '/api/auth/me')).body.user.emailVerified, true);
});

test('password reset emails use the new link format', async () => {
  await client()('POST', '/api/auth/forgot-password', { email: 'verify-code@example.com' });
  await settle();
  const mail = mailsTo('verify-code@example.com').pop();
  assert.equal(mail.subject, 'Reset your TypeCraft password');
  assert.match(mail.text, /https:\/\/typecrafttyping\.in\/reset-password#token=[\w-]{40,}/);
});

/* ---------------- security notices ---------------- */
test('a sign-in from a new device sends a login alert; known devices and opted-out users get none', async () => {
  await signup('device@example.com', CHROME_WIN);
  const count = () => mailsTo('device@example.com').filter((m) => /New sign-in/.test(m.subject)).length;
  await client(CHROME_WIN)('POST', '/api/auth/login', { email: 'device@example.com', password: pw });
  await settle();
  assert.equal(count(), 0);
  const phone = client(SAFARI_IOS);
  await phone('POST', '/api/auth/login', { email: 'device@example.com', password: pw });
  await settle();
  assert.equal(count(), 1);
  assert.match(mailsTo('device@example.com').pop().text, /Safari on iOS/);
  const devices = await env.DB.prepare("SELECT ua_hash, label FROM known_devices k JOIN users u ON u.id = k.user_id WHERE u.email = 'device@example.com'").all();
  assert.equal(devices.results.length, 2);
  assert.ok(devices.results.every((d) => /^[0-9a-f]{64}$/.test(d.ua_hash)));
  // switched off: no alert for another new device
  assert.equal((await phone('PUT', '/api/me/email-preferences', { loginAlerts: false })).status, 200);
  await client('Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0')('POST', '/api/auth/login', { email: 'device@example.com', password: pw });
  await settle();
  assert.equal(count(), 1);
});

test('password change sends password_changed', async () => {
  const c = await signup('pwmail@example.com');
  const r = await c('POST', '/api/auth/change-password', { currentPassword: pw, newPassword: 'new pass 123', confirmPassword: 'new pass 123' });
  assert.equal(r.status, 200);
  await settle();
  assert.ok(mailsTo('pwmail@example.com').some((m) => m.subject === 'Your TypeCraft password was changed'));
});

/* ---------------- contact and preferences ---------------- */
test('contact form stores the message and sends a forward to support and an auto-reply', async () => {
  const before = outbox.length;
  const r = await client()('POST', '/api/contact', { name: 'Asha <b>K</b>', email: 'Asha@Example.com', topic: 'billing', message: 'My payment went through but the plan is not active.' });
  assert.equal(r.status, 201);
  await settle();
  const row = await env.DB.prepare('SELECT * FROM contact_messages WHERE id = ?1').bind(r.body.id).first();
  assert.equal(row.email, 'asha@example.com'); assert.equal(row.topic, 'billing'); assert.equal(row.status, 'new'); assert.equal(row.priority, 0);
  const sent = outbox.slice(before);
  assert.equal(sent.length, 2);
  const forward = sent.find((m) => m.to[0] === 'hello@typecrafttyping.com');
  const reply = sent.find((m) => m.to[0] === 'asha@example.com');
  assert.ok(forward && reply);
  assert.equal(forward.reply_to, 'asha@example.com');
  assert.ok(!forward.html.includes('<b>K</b>'));
  assert.match(reply.subject, /We got your message/);
  const bad = await client()('POST', '/api/contact', { name: '', email: 'x', message: 'hi' });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.error.fields).sort(), ['email', 'message', 'name']);
});

test('contact form is limited to 5 messages an hour per address', async () => {
  const c = client();
  const body = { name: 'Spammy', email: 'spam@example.com', message: 'Hello there, this is a message.' };
  for (let i = 0; i < 5; i++) assert.equal((await c('POST', '/api/contact', body)).status, 201);
  assert.equal((await c('POST', '/api/contact', body)).status, 429);
  await settle();
});

test('email preferences: defaults, round-trip, validation, sign-in required', async () => {
  const c = await signup('prefs@example.com');
  assert.deepEqual((await c('GET', '/api/me/email-preferences')).body.preferences, { announcements: true, testResults: false, loginAlerts: true });
  const put = await c('PUT', '/api/me/email-preferences', { announcements: false, testResults: true });
  assert.deepEqual(put.body.preferences, { announcements: false, testResults: true, loginAlerts: true });
  assert.deepEqual((await c('GET', '/api/me/email-preferences')).body.preferences, { announcements: false, testResults: true, loginAlerts: true });
  assert.equal((await c('PUT', '/api/me/email-preferences', { announcements: 'yes' })).status, 400);
  assert.equal((await client()('GET', '/api/me/email-preferences')).status, 401);
});

/* ---------------- admin ---------------- */
test('admin email list and retry: 404 for learners, list for support, retry for owners', async () => {
  const learner = await signup('learner-x@example.com');
  assert.equal((await learner('GET', '/api/admin/emails')).status, 404);
  assert.equal((await learner('GET', '/api/admin/contact')).status, 404);
  assert.equal((await learner('POST', '/api/admin/announcements', { subject: 'x', body: 'y', test: true })).status, 404);
  assert.equal((await client()('GET', '/api/admin/emails')).status, 404);

  const support = await signup('support-x@example.com');
  await env.DB.prepare("INSERT INTO admin_users (user_id, role, created_at) VALUES (?1, 'support', '2026-11-15T00:00:00Z')").bind(support.user.id).run();
  const list = await support('GET', '/api/admin/emails?status=failed');
  assert.equal(list.status, 200);
  assert.ok(list.body.emails.length > 0 && list.body.emails.every((e) => e.status === 'failed'));
  assert.ok(list.body.emails.every((e) => !('payload' in e)));
  const failedWelcome = list.body.emails.find((e) => e.template === 'welcome' && e.retryable);
  assert.equal((await support('POST', `/api/admin/emails/${failedWelcome.id}/retry`, {})).status, 403);

  const owner = await signup('boss@example.com');
  const search = await owner('GET', '/api/admin/emails?q=retry%40example');
  assert.ok(search.body.emails.length >= 1 && search.body.emails.every((e) => e.to.includes('retry@example')));
  const otpRow = (await owner('GET', '/api/admin/emails?q=otp_login')).body.emails.find((e) => e.status === 'failed');
  assert.equal((await owner('POST', `/api/admin/emails/${otpRow.id}/retry`, {})).status, 400);
  const retried = await owner('POST', `/api/admin/emails/${failedWelcome.id}/retry`, {});
  assert.equal(retried.status, 200); assert.equal(retried.body.email.status, 'sent');
  const audit = await env.DB.prepare("SELECT * FROM audit_logs WHERE action = 'email.retry'").first();
  assert.equal(audit.actor_id, owner.user.id);

  const msgs = await support('GET', '/api/admin/contact?status=new');
  assert.equal(msgs.status, 200); assert.ok(msgs.body.messages.length >= 1);
  const upd = await support('POST', `/api/admin/contact/${msgs.body.messages[0].id}`, { status: 'answered' });
  assert.equal(upd.status, 200);
});

test('announcements: a test goes to the admin; the real one is batched to opted-in, verified users with an unsubscribe link', async () => {
  const owner = client();
  await owner('POST', '/api/auth/login', { email: 'boss@example.com', password: pw });
  const t = await owner('POST', '/api/admin/announcements', { subject: 'New packs', body: 'Hello!\n\nTry them.', audience: 'all', test: true });
  assert.equal(t.status, 200); assert.equal(t.body.status, 'sent');
  assert.equal(mailsTo('boss@example.com').pop().subject, 'New packs');

  await env.DB.prepare("UPDATE users SET email_verified = 1 WHERE email IN ('prefs@example.com', 'learner-x@example.com', 'device@example.com')").run();
  const before = outbox.length;
  const r = await owner('POST', '/api/admin/announcements', { subject: 'Big news', body: 'We have new packs.', audience: 'all' });
  assert.equal(r.status, 202);
  await settle();
  const sent = outbox.slice(before);
  const to = sent.map((m) => m.to[0]);
  assert.ok(to.includes('learner-x@example.com') && to.includes('device@example.com'));
  assert.ok(!to.includes('prefs@example.com'), 'opted out');
  assert.equal(sent.length, r.body.queued);
  const mail = sent.find((m) => m.to[0] === 'learner-x@example.com');
  assert.match(mail.html, /Unsubscribe from announcements/);
  assert.match(mail._headers['Content-Type'], /json/);
  const link = mail.text.match(/Unsubscribe from announcements: (\S+)/)[1];
  const u = new URL(link);
  assert.equal(u.pathname, '/api/email/unsubscribe');
  // the page itself changes nothing; the POST does
  const page = await realFetch(`${base}${u.pathname}${u.search}`);
  assert.equal(page.status, 200);
  const un = await client()('POST', '/api/email/unsubscribe', { u: u.searchParams.get('u'), t: u.searchParams.get('t') });
  assert.equal(un.status, 200);
  const learnerPrefs = await env.DB.prepare("SELECT announcements FROM email_preferences p JOIN users u ON u.id = p.user_id WHERE u.email = 'learner-x@example.com'").first();
  assert.equal(learnerPrefs.announcements, 0);
  assert.equal((await client()('POST', '/api/email/unsubscribe', { u: u.searchParams.get('u'), t: 'f'.repeat(40) })).status, 400);
  assert.equal((await owner('POST', '/api/admin/announcements', { subject: '', body: '', audience: 'everyone' })).status, 400);
  // nobody has a paid plan in this database: 'paid' reaches no one, 'free' reaches the opted-in
  assert.equal((await owner('POST', '/api/admin/announcements', { subject: 'Paid only', body: 'Thanks.', audience: 'paid' })).body.queued, 0);
  const free = await owner('POST', '/api/admin/announcements', { subject: 'Free only', body: 'Upgrade.', audience: 'free' });
  assert.equal(free.status, 202); assert.ok(free.body.queued >= 1);
  await settle();
});

/* ---------------- Resend webhook ---------------- */
function svix(body, { secret = WEBHOOK_KEY, ts = Math.floor(Date.now() / 1000) } = {}) {
  const id = 'msg_test_1';
  const sig = createHmac('sha256', Buffer.from(secret, 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}`, 'Content-Type': 'application/json' };
}

test('Resend webhook: verified events mark delivered/bounced; bad or old signatures are refused', async () => {
  const r = await sendTemplate(env, {}, { to: 'hook@example.com', template: 'welcome', data: {} });
  const providerId = (await log(r.id)).provider_id;
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: providerId } });
  const bad = await realFetch(`${base}/api/webhooks/resend`, { method: 'POST', headers: svix(body, { secret: Buffer.from('wrong').toString('base64') }), body });
  assert.equal(bad.status, 401);
  const old = await realFetch(`${base}/api/webhooks/resend`, { method: 'POST', headers: svix(body, { ts: Math.floor(Date.now() / 1000) - 3600 }), body });
  assert.equal(old.status, 401);
  const ok = await realFetch(`${base}/api/webhooks/resend`, { method: 'POST', headers: svix(body), body });
  assert.equal(ok.status, 200);
  assert.equal((await log(r.id)).status, 'delivered');
  const bounce = JSON.stringify({ type: 'email.bounced', data: { email_id: providerId } });
  await realFetch(`${base}/api/webhooks/resend`, { method: 'POST', headers: svix(bounce), body: bounce });
  assert.equal((await log(r.id)).status, 'bounced');
});
