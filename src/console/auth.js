// Admin console sign-in (docs/ADMIN-CONSOLE.md §3).
//
//   POST /api/admin/auth/login    { email, password }  → { step: 'code' } (a code was emailed) or { step: 'done' }
//   POST /api/admin/auth/verify   { code }             → { step: 'done' }
//   POST /api/admin/auth/resend   {}                   → a new code (one a minute)
//   POST /api/admin/auth/logout   {}
//   GET  /api/admin/auth/me                            → who is signed in, their role and permissions
//   POST /api/admin/auth/reauth   { password }         → confirms the password for sensitive actions
//
// One account system: an administrator is an ordinary TypeCraft account that has a role
// (OWNER_EMAILS → Super Admin, or a row in admin_users). Signing in here needs the
// password and, when email and SESSION_SECRET are set up, a 6-digit code sent to the
// account's email. It starts a console session only; the learner session is untouched.
import { HttpError, json, readJson, readCookie, clientIp, fieldError, cleanEmail, nowIso } from '../http.js';
import { verifyPassword, burnPasswordCheck } from '../crypto.js';
import { hitLimit, isLimited, clearLimit, tooMany, emailEnabled } from '../session.js';
import { roleFrom } from '../roles.js';
import { createOtp, verifyOtp, otpEnabled } from '../otp.js';
import { sendTemplate, sendLater } from '../mail.js';
import { audit } from '../billing.js';
import { permissionsFor, BY_KEY } from './permissions.js';
import { createAdminSession, endAdminSession, getAdminSession, requireAdmin, clearAdminCookie, deviceOf } from './session.js';
import { STEP_COOKIE, STEP_MS, IDLE_MS, FRESH_MS, ROLE_LABELS } from './config.js';

const WRONG = "Those details don't match an administrator account.";
const OTP_PURPOSE = 'sensitive'; // only this file creates codes with this purpose
const STEP_ATTRS = 'Path=/; HttpOnly; Secure; SameSite=Strict';
const enc = new TextEncoder();

/** True when admin sign-in asks for an emailed code. ADMIN_EMAIL_CODE=off is the emergency switch. */
export function emailCodeOn(env) {
  return otpEnabled(env) && emailEnabled(env) && String(env.ADMIN_EMAIL_CODE || '').trim().toLowerCase() !== 'off';
}

/* ---------- the "password was right, now the code" cookie ---------- */
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function stepCookie(env, userId) {
  const exp = Date.now() + STEP_MS;
  const sig = await hmacHex(env.SESSION_SECRET, `admin-step:v1:${userId}:${exp}`);
  return `${STEP_COOKIE}=${userId}.${exp}.${sig}; ${STEP_ATTRS}; Max-Age=${Math.floor(STEP_MS / 1000)}`;
}
const clearStepCookie = () => `${STEP_COOKIE}=; ${STEP_ATTRS}; Max-Age=0`;
/** The user id from a valid, unexpired step cookie, or null. */
async function stepUser(env, request) {
  const raw = readCookie(request, STEP_COOKIE);
  if (!raw || raw.length > 200 || !otpEnabled(env)) return null;
  const [userId, exp, sig] = raw.split('.');
  if (!userId || !/^\d{10,16}$/.test(exp || '') || Number(exp) <= Date.now()) return null;
  return sameHex(await hmacHex(env.SESSION_SECRET, `admin-step:v1:${userId}:${exp}`), sig) ? userId : null;
}

const maskEmail = (email) => String(email).replace(/^(.{1,2})[^@]*(@.*)$/, '$1•••$2');
const staffRow = (env, where, value) => env.DB.prepare(
  `SELECT u.id, u.full_name, u.email, u.password_hash, u.account_status, a.role AS staff_role
     FROM users u LEFT JOIN admin_users a ON a.user_id = u.id WHERE ${where} = ?1`
).bind(value).first();

async function sendCode(env, ctx, request, row, device) {
  const otp = await createOtp(env, { email: row.email, userId: row.id, purpose: OTP_PURPOSE });
  if (otp.cooldown) return { cooldown: otp.retryAfter }; // the code sent under a minute ago still works
  const sent = await sendTemplate(env, ctx, { to: row.email, userId: row.id, template: 'admin_otp', data: { name: row.full_name, code: otp.code, minutes: 10, device } });
  if (sent.status !== 'sent') throw new HttpError(502, 'email_failed', "We couldn't email your sign-in code just now. Try again in a minute.");
  return { cooldown: 0 };
}

async function finish(env, ctx, request, row, role, secondFactor) {
  const s = await createAdminSession(env, request, row.id, { secondFactor });
  const ip = clientIp(request);
  await audit(env, { actorId: row.id, action: 'admin.login', target: `user:${row.id}`, detail: { role, secondFactor, device: s.device }, ip });
  // without an emailed code the account is told about the sign-in afterwards
  if (!secondFactor && emailEnabled(env)) {
    await sendLater(env, ctx, { to: row.email, userId: row.id, template: 'security_alert', data: {
      name: row.full_name, title: 'Admin sign-in', time: nowIso(),
      message: `Your account was used to sign in to the TypeCraft admin from ${s.device}.`,
    } });
  }
  return json({ step: 'done', role, expiresAt: s.expiresAt }, 200, { 'Set-Cookie': [s.cookie, clearStepCookie()] });
}

/* ---------- POST /api/admin/auth/login ---------- */
export async function login(request, env, ctx) {
  const body = await readJson(request, 4096);
  const email = cleanEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  if (email.error || !password) throw fieldError(email.error ? { email: email.error } : { password: 'Enter your password.' });

  await env.DB.prepare('SELECT 1 FROM admin_sessions LIMIT 1').first(); // fails clearly before migration 0005 (see ./index.js)
  const ip = clientIp(request);
  if (!(await hitLimit(env, `adm-login-ip:${ip}`, 20, 900))) throw tooMany(15);
  // counted per account and address, so someone guessing can't lock the real administrator out
  const failKey = `adm-login-fail:${email.value}:${ip}`;
  if (await isLimited(env, failKey, 5, 900)) throw tooMany(15);

  const row = await staffRow(env, 'u.email', email.value);
  const passwordOk = row ? await verifyPassword(password, row.password_hash) : (await burnPasswordCheck(password), false);
  const role = row ? roleFrom(env, row.email, row.staff_role) : null;
  if (!passwordOk || !role || row.account_status !== 'active') {
    await hitLimit(env, failKey, 5, 900);
    if (row && role) { // a real administrator account: keep a trace (bounded by the limits above)
      await audit(env, { actorId: row.id, action: 'admin.login_failed', target: `user:${row.id}`, detail: { reason: passwordOk ? 'account_disabled' : 'wrong_password' }, ip });
    }
    throw new HttpError(401, 'wrong_credentials', WRONG); // the same answer whatever was wrong
  }
  await clearLimit(env, failKey);

  if (emailCodeOn(env)) {
    const r = await sendCode(env, ctx, request, row, deviceOf(request));
    return json({ step: 'code', sentTo: maskEmail(row.email), minutes: 10, resendIn: r.cooldown || 60 }, 200, { 'Set-Cookie': await stepCookie(env, row.id) });
  }
  return finish(env, ctx, request, row, role, false);
}

/* ---------- POST /api/admin/auth/verify ---------- */
export async function verify(request, env, ctx) {
  const body = await readJson(request, 4096);
  const code = typeof body.code === 'string' || typeof body.code === 'number' ? String(body.code).replace(/\s+/g, '') : '';
  if (!/^\d{6}$/.test(code)) throw fieldError({ code: 'Enter the 6-digit code from the email.' });
  if (!(await hitLimit(env, `adm-code-ip:${clientIp(request)}`, 30, 900))) throw tooMany(15);
  const expired = new HttpError(401, 'step_expired', 'That took too long. Enter your email and password again.');
  const userId = await stepUser(env, request);
  if (!userId) throw expired;
  const row = await staffRow(env, 'u.id', userId);
  const role = row ? roleFrom(env, row.email, row.staff_role) : null;
  if (!row || !role || row.account_status !== 'active') throw expired;
  // Only someone who already knows the password gets this far, so wrong codes are counted per account,
  // from any address: 10 in an hour and the code step is closed for the rest of that hour.
  const failKey = `adm-code-fail:${row.id}`;
  if (await isLimited(env, failKey, 10, 3600)) throw tooMany(60);

  const result = await verifyOtp(env, { email: row.email, purpose: OTP_PURPOSE, code });
  if (!result.ok || result.userId !== row.id) {
    await hitLimit(env, failKey, 10, 3600);
    if (result.reason === 'expired') throw new HttpError(400, 'code_expired', 'That code has expired. Ask for a new one.');
    if (result.reason === 'burned') {
      await audit(env, { actorId: row.id, action: 'admin.login_failed', target: `user:${row.id}`, detail: { reason: 'too_many_wrong_codes' }, ip: clientIp(request) });
      throw new HttpError(400, 'code_burned', 'Too many wrong tries, so that code no longer works. Ask for a new one.');
    }
    throw new HttpError(400, 'invalid_code', "That code isn't right. Check the latest email and try again.");
  }
  await clearLimit(env, failKey);
  return finish(env, ctx, request, row, role, true);
}

/* ---------- POST /api/admin/auth/resend ---------- */
export async function resend(request, env, ctx) {
  await readJson(request, 1024);
  if (!(await hitLimit(env, `adm-code-ip:${clientIp(request)}`, 30, 900))) throw tooMany(15);
  const userId = await stepUser(env, request);
  const row = userId ? await staffRow(env, 'u.id', userId) : null;
  if (!row || !roleFrom(env, row.email, row.staff_role) || row.account_status !== 'active') {
    throw new HttpError(401, 'step_expired', 'That took too long. Enter your email and password again.');
  }
  const r = await sendCode(env, ctx, request, row, deviceOf(request));
  if (r.cooldown) throw new HttpError(429, 'otp_cooldown', `Please wait ${r.cooldown} seconds before asking for another code.`);
  return json({ sentTo: maskEmail(row.email), minutes: 10, resendIn: 60 });
}

/* ---------- POST /api/admin/auth/logout ---------- */
export async function logout(request, env) {
  let who = null;
  try { who = await getAdminSession(env, request); } catch { who = null; }
  if (who) {
    await endAdminSession(env, who.session.id, 'signed_out');
    await audit(env, { actorId: who.user.id, action: 'admin.logout', target: `user:${who.user.id}`, ip: clientIp(request) });
  }
  return json({}, 200, { 'Set-Cookie': [clearAdminCookie(), clearStepCookie()] });
}

/** What the console needs to know about the signed-in administrator. */
export async function describe(env, who) {
  const keys = await permissionsFor(env, who.role);
  return {
    user: { id: who.user.id, fullName: who.user.fullName, email: who.user.email },
    role: who.role,
    roleLabel: ROLE_LABELS[who.role] || who.role,
    permissions: keys,
    granted: keys.map((k) => { const p = BY_KEY.get(k); return { key: k, label: p.label, layer: p.layer, module: p.module }; }),
    session: {
      secondFactor: who.session.secondFactor, device: who.session.device, createdAt: who.session.createdAt,
      expiresAt: who.session.expiresAt, idleExpiresAt: who.session.idleExpiresAt,
      idleMinutes: Math.round(IDLE_MS / 60000), fresh: who.session.fresh, freshMinutes: Math.round(FRESH_MS / 60000),
    },
    emailCodes: emailCodeOn(env),
  };
}

/* ---------- GET /api/admin/auth/me ---------- */
export async function me(request, env) {
  return json(await describe(env, await requireAdmin(env, request)));
}

/* ---------- POST /api/admin/auth/reauth ---------- */
export async function reauth(request, env) {
  const who = await requireAdmin(env, request);
  const body = await readJson(request, 4096);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) throw fieldError({ password: 'Enter your password.' });
  if (!(await hitLimit(env, `adm-reauth:${who.user.id}`, 10, 900))) throw tooMany(15);
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?1').bind(who.user.id).first();
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    await audit(env, { actorId: who.user.id, action: 'admin.reauth_failed', target: `user:${who.user.id}`, ip: clientIp(request) });
    throw fieldError({ password: "That isn't your password." });
  }
  await env.DB.prepare('UPDATE admin_sessions SET reauth_at = ?2 WHERE id = ?1').bind(who.session.id, nowIso()).run();
  return json({ fresh: true, freshMinutes: Math.round(FRESH_MS / 60000) });
}

export const ROUTES = {
  'POST /api/admin/auth/login': login,
  'POST /api/admin/auth/verify': verify,
  'POST /api/admin/auth/resend': resend,
  'POST /api/admin/auth/logout': logout,
  'GET /api/admin/auth/me': me,
  'POST /api/admin/auth/reauth': reauth,
};
