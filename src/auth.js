// Sign up, sign in (password or emailed code), sign out, password reset and change,
// email confirmation (link or code) and new-device sign-in alerts.
import {
  HttpError, json, readJson, clientIp, fieldError, cleanName, cleanEmail, cleanPhone, checkPassword,
  clearSessionCookie, nowIso,
} from './http.js';
import { hashPassword, verifyPassword, burnPasswordCheck, randomToken, sha256Hex, uuid } from './crypto.js';
import {
  createSession, getSession, requireSession, endSession, publicUser, hitLimit, isLimited, clearLimit, tooMany,
  emailEnabled,
} from './session.js';
import { sendTemplate, sendLater, siteUrl, getPreferences } from './mail.js';
import { createOtp, verifyOtp, otpEnabled } from './otp.js';
import { endAdminSessionsFor } from './console/session.js';

const HOUR = 60 * 60 * 1000;
const WRONG_LOGIN = 'Email or password is incorrect.';

function requireMatch(password, confirm, fields, key = 'confirmPassword') {
  if (password !== confirm) fields[key] = "The two passwords don't match.";
}

/* ---------- email links ---------- */
/**
 * Sends the confirmation email: a link (24 h) and, for the account's own address, a 6-digit
 * code (10 min). Throws 503 when email isn't set up and 502 when the provider refused it.
 */
export async function sendVerificationEmail(env, request, user, newEmail = null, ctx = null) {
  if (!emailEnabled(env)) throw new HttpError(503, 'email_not_configured', "Email sending isn't set up for this site yet, so no email could be sent.");
  const token = randomToken();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO email_tokens (id, user_id, purpose, new_email, token_hash, expires_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(uuid(), user.id, newEmail ? 'change' : 'verify', newEmail, await sha256Hex(token),
    new Date(Date.now() + 24 * HOUR).toISOString(), now).run();
  const link = `${siteUrl(env)}/verify-email#token=${token}`;
  let code = null;
  if (!newEmail && otpEnabled(env)) {
    const otp = await createOtp(env, { email: user.email, userId: user.id, purpose: 'verify_email' });
    code = otp.code || null; // within the 60 s cooldown the email carries the link only
  }
  const sent = await sendTemplate(env, ctx, {
    to: newEmail || user.email, userId: user.id, template: 'verify_email',
    data: { name: user.fullName, link, code, newEmail },
  });
  if (sent.status !== 'sent') throw new HttpError(502, 'email_failed', "We couldn't send the email just now. Please try again in a few minutes.");
}

/* ---------- devices (for "new sign-in" alerts) ---------- */
/** "Chrome on Windows": browser and OS family only, so updates don't count as a new device. */
export function deviceLabel(ua) {
  const s = String(ua || '');
  const browser =
    /Edg(e|A|iOS)?\//.test(s) ? 'Edge'
      : /OPR\/|Opera/.test(s) ? 'Opera'
        : /SamsungBrowser\//.test(s) ? 'Samsung Internet'
          : /Firefox\/|FxiOS\//.test(s) ? 'Firefox'
            : /Chrome\/|CriOS\/|Chromium\//.test(s) ? 'Chrome'
              : /Safari\//.test(s) && /Version\//.test(s) ? 'Safari'
                : 'Unknown browser';
  const os =
    /Windows/.test(s) ? 'Windows'
      : /Android/.test(s) ? 'Android'
        : /iPhone|iPad|iPod/.test(s) ? 'iOS'
          : /CrOS/.test(s) ? 'ChromeOS'
            : /Mac OS X|Macintosh/.test(s) ? 'macOS'
              : /Linux/.test(s) ? 'Linux'
                : 'Unknown OS';
  return `${browser} on ${os}`;
}

/**
 * Remembers the device; on a sign-in from a device not seen before (and not the first one
 * ever recorded for the account) sends a login_alert, unless the user turned alerts off.
 */
export async function noteDevice(env, ctx, request, user, { alert = true } = {}) {
  try {
    const label = deviceLabel(request.headers.get('User-Agent'));
    const hash = await sha256Hex(`device:v1:${label}`);
    const now = nowIso();
    const seen = await env.DB.prepare('SELECT 1 AS x FROM known_devices WHERE user_id = ?1 AND ua_hash = ?2').bind(user.id, hash).first();
    if (seen) {
      await env.DB.prepare('UPDATE known_devices SET last_seen = ?3 WHERE user_id = ?1 AND ua_hash = ?2').bind(user.id, hash, now).run();
      return;
    }
    const hadAny = await env.DB.prepare('SELECT 1 AS x FROM known_devices WHERE user_id = ?1 LIMIT 1').bind(user.id).first();
    await env.DB.prepare('INSERT OR IGNORE INTO known_devices (user_id, ua_hash, label, first_seen, last_seen) VALUES (?1, ?2, ?3, ?4, ?4)')
      .bind(user.id, hash, label, now).run();
    if (!alert || !hadAny) return; // the first device we record is not "new"
    if (!(await getPreferences(env, user.id)).loginAlerts) return;
    const country = request.cf && typeof request.cf.country === 'string' ? request.cf.country : null;
    await sendLater(env, ctx, { to: user.email, userId: user.id, template: 'login_alert', data: { name: user.fullName, device: label, time: now, location: country } });
  } catch (err) {
    console.error('device check failed:', err && err.message);
  }
}

/* ---------- routes ---------- */
export async function signup(request, env, ctx) {
  const body = await readJson(request);
  const fields = {};
  const name = cleanName(body.fullName); if (name.error) fields.fullName = name.error;
  const email = cleanEmail(body.email); if (email.error) fields.email = email.error;
  const phone = cleanPhone(body.phoneNumber); if (phone.error) fields.phoneNumber = phone.error;
  const pw = checkPassword(body.password, { email: email.value }); if (pw) fields.password = pw;
  requireMatch(body.password, body.confirmPassword, fields);
  if (Object.keys(fields).length) throw fieldError(fields);

  if (!(await hitLimit(env, `signup-ip:${clientIp(request)}`, 10, 3600))) throw tooMany(60);

  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?1').bind(email.value).first();
  const takenError = () => fieldError({ email: 'An account with this email already exists. Sign in, or reset your password.' });
  if (taken) throw takenError();

  const id = uuid();
  const now = nowIso();
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, full_name, email, phone_number, password_hash, created_at, updated_at, last_login_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)`
    ).bind(id, name.value, email.value, phone.value, await hashPassword(body.password), now).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) throw takenError(); // two sign-ups for one email at once
    throw e;
  }
  const cookie = await createSession(env, id, body.remember !== false);
  const user = { id, fullName: name.value, email: email.value, phoneNumber: phone.value, emailVerified: false, createdAt: now, lastLoginAt: now };

  await noteDevice(env, ctx, request, user, { alert: false });
  let verificationSent = false;
  if (emailEnabled(env)) {
    await sendLater(env, ctx, { to: user.email, userId: id, template: 'welcome', data: { name: user.fullName } });
    try { await sendVerificationEmail(env, request, user, null, ctx); verificationSent = true; } catch { /* the account still works; they can resend from the profile */ }
  }
  return json({ user, verificationSent }, 201, { 'Set-Cookie': cookie });
}

export async function login(request, env, ctx) {
  const body = await readJson(request);
  const email = cleanEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  if (email.error || !password) throw fieldError(email.error ? { email: email.error } : { password: 'Enter your password.' });

  if (!(await hitLimit(env, `login-ip:${clientIp(request)}`, 30, 900))) throw tooMany(15);
  const failKey = `login-fail:${email.value}`;
  if (await isLimited(env, failKey, 8, 900)) throw tooMany(15);

  const row = await env.DB.prepare(
    'SELECT id, full_name, email, phone_number, email_verified, created_at, password_hash, account_status FROM users WHERE email = ?1'
  ).bind(email.value).first();
  const ok = row ? await verifyPassword(password, row.password_hash) : (await burnPasswordCheck(password), false);
  if (!ok) {
    await hitLimit(env, failKey, 8, 900);
    throw new HttpError(401, 'wrong_credentials', WRONG_LOGIN);
  }
  if (row.account_status !== 'active') throw new HttpError(403, 'account_disabled', 'This account has been disabled.');

  await clearLimit(env, failKey);
  await endSession(env, request); // a fresh session id on every sign-in
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET last_login_at = ?2 WHERE id = ?1').bind(row.id, now),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1 AND expires_at <= ?2').bind(row.id, now),
  ]);
  const cookie = await createSession(env, row.id, body.remember !== false);
  const user = publicUser({ ...row, last_login_at: now });
  await noteDevice(env, ctx, request, user);
  return json({ user }, 200, { 'Set-Cookie': cookie });
}

export async function logout(request, env) {
  await endSession(env, request);
  return json({}, 200, { 'Set-Cookie': clearSessionCookie() });
}

export async function logoutEverywhere(request, env) {
  const { user } = await requireSession(env, request);
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(user.id).run();
  await endAdminSessionsFor(env, user.id, 'signed_out_everywhere'); // "everywhere" includes the admin console
  return json({}, 200, { 'Set-Cookie': clearSessionCookie() });
}

export async function me(request, env) {
  const s = await getSession(env, request);
  const headers = s && s.setCookie ? { 'Set-Cookie': s.setCookie } : {};
  return json({ user: s ? s.user : null, emailEnabled: emailEnabled(env) }, 200, headers);
}

export async function forgotPassword(request, env, ctx) {
  const body = await readJson(request);
  const email = cleanEmail(body.email);
  if (email.error) throw fieldError({ email: email.error });
  // Said the same way for every address, so it never reveals whether an account exists.
  if (!emailEnabled(env)) throw new HttpError(503, 'email_not_configured', "Password reset emails aren't set up for this site yet.");
  if (!(await hitLimit(env, `forgot-ip:${clientIp(request)}`, 10, 3600))) throw tooMany(60);

  const message = "If an account uses that email, we've sent it a link to reset the password. The link expires in 1 hour.";
  if (!(await hitLimit(env, `forgot-email:${email.value}`, 3, 3600))) return json({ message });

  const user = await env.DB.prepare("SELECT id, full_name FROM users WHERE email = ?1 AND account_status = 'active'").bind(email.value).first();
  if (user) {
    const token = randomToken();
    const now = nowIso();
    await env.DB.batch([
      // only the newest link works
      env.DB.prepare('UPDATE password_reset_tokens SET used_at = ?2 WHERE user_id = ?1 AND used_at IS NULL').bind(user.id, now),
      env.DB.prepare('INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
        .bind(uuid(), user.id, await sha256Hex(token), new Date(Date.now() + HOUR).toISOString(), now),
    ]);
    const link = `${siteUrl(env)}/reset-password#token=${token}`;
    // sent in the background so the response takes the same time whether or not the account exists
    const send = sendTemplate(env, ctx, {
      to: email.value, userId: user.id, template: 'password_reset', data: { name: user.full_name, link, minutes: 60 },
    }).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(send); else await send;
  }
  return json({ message });
}

export async function resetPassword(request, env, ctx) {
  const body = await readJson(request);
  const token = typeof body.token === 'string' ? body.token : '';
  const invalid = new HttpError(400, 'invalid_token', 'This reset link is invalid, already used, or expired. Request a new one.');
  if (!token || token.length > 100) throw invalid;

  const row = await env.DB.prepare(
    `SELECT t.id AS token_id, t.expires_at, t.used_at, u.id, u.email, u.full_name FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?1`
  ).bind(await sha256Hex(token)).first();
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) throw invalid;

  const fields = {};
  const pw = checkPassword(body.password, { email: row.email }); if (pw) fields.password = pw;
  requireMatch(body.password, body.confirmPassword, fields);
  if (Object.keys(fields).length) throw fieldError(fields);

  const now = nowIso();
  // claim the token first: if two requests race, only one gets changes = 1
  const claim = await env.DB.prepare('UPDATE password_reset_tokens SET used_at = ?2 WHERE id = ?1 AND used_at IS NULL').bind(row.token_id, now).run();
  if (!claim.meta || claim.meta.changes !== 1) throw invalid;

  await env.DB.batch([
    // a reset link proves the person reads this inbox, so the email counts as verified
    env.DB.prepare('UPDATE users SET password_hash = ?2, password_changed_at = ?3, updated_at = ?3, email_verified = 1 WHERE id = ?1')
      .bind(row.id, await hashPassword(body.password), now),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(row.id),
    env.DB.prepare('UPDATE password_reset_tokens SET used_at = ?2 WHERE user_id = ?1 AND used_at IS NULL').bind(row.id, now),
    env.DB.prepare('DELETE FROM rate_limits WHERE key = ?1').bind(`login-fail:${row.email}`),
  ]);
  await endAdminSessionsFor(env, row.id, 'password_changed'); // admin console sign-ins end with the old password
  await sendLater(env, ctx, { to: row.email, userId: row.id, template: 'password_changed', data: { name: row.full_name, time: now } });
  return json({ message: 'Your password has been changed. Sign in with your new password.' }, 200, { 'Set-Cookie': clearSessionCookie() });
}

export async function changePassword(request, env, ctx) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request);
  if (!(await hitLimit(env, `pw-change:${user.id}`, 10, 3600))) throw tooMany(60);

  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?1').bind(user.id).first();
  if (!(await verifyPassword(String(body.currentPassword || ''), row.password_hash))) {
    throw fieldError({ currentPassword: "That isn't your current password." });
  }
  const fields = {};
  const pw = checkPassword(body.newPassword, { email: user.email }); if (pw) fields.newPassword = pw;
  else if (body.newPassword === body.currentPassword) fields.newPassword = 'Choose a password different from your current one.';
  requireMatch(body.newPassword, body.confirmPassword, fields);
  if (Object.keys(fields).length) throw fieldError(fields);

  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?2, password_changed_at = ?3, updated_at = ?3 WHERE id = ?1')
      .bind(user.id, await hashPassword(body.newPassword), now),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(user.id), // signs out every other device
  ]);
  const cookie = await createSession(env, user.id, true); // and keeps this one signed in, with a new session id
  await endAdminSessionsFor(env, user.id, 'password_changed');
  await sendLater(env, ctx, { to: user.email, userId: user.id, template: 'password_changed', data: { name: user.fullName, time: now } });
  return json({ message: 'Password changed. Other devices have been signed out.' }, 200, { 'Set-Cookie': cookie });
}

export async function verifyEmail(request, env, ctx) {
  const body = await readJson(request);
  const token = typeof body.token === 'string' ? body.token : '';
  const invalid = new HttpError(400, 'invalid_token', 'This confirmation link is invalid, already used, or expired.');
  if (!token || token.length > 100) throw invalid;
  const row = await env.DB.prepare('SELECT id, user_id, purpose, new_email, expires_at, used_at FROM email_tokens WHERE token_hash = ?1')
    .bind(await sha256Hex(token)).first();
  if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) throw invalid;

  const now = nowIso();
  const claim = await env.DB.prepare('UPDATE email_tokens SET used_at = ?2 WHERE id = ?1 AND used_at IS NULL').bind(row.id, now).run();
  if (!claim.meta || claim.meta.changes !== 1) throw invalid;

  if (row.purpose === 'verify') {
    await env.DB.prepare('UPDATE users SET email_verified = 1, updated_at = ?2 WHERE id = ?1').bind(row.user_id, now).run();
    return json({ message: 'Email confirmed.' });
  }
  const before = await env.DB.prepare('SELECT email, full_name FROM users WHERE id = ?1').bind(row.user_id).first();
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET email = ?2, email_verified = 1, updated_at = ?3 WHERE id = ?1').bind(row.user_id, row.new_email, now),
      env.DB.prepare("UPDATE email_tokens SET used_at = ?2 WHERE user_id = ?1 AND purpose = 'change' AND used_at IS NULL").bind(row.user_id, now),
    ]);
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) throw new HttpError(409, 'email_taken', 'Another account started using that email in the meantime.');
    throw e;
  }
  // tell the old address, in case someone else made the change
  if (before && before.email !== row.new_email) {
    await sendLater(env, ctx, { to: before.email, userId: row.user_id, template: 'email_changed', data: { name: before.full_name, oldEmail: before.email, newEmail: row.new_email, time: now } });
  }
  return json({ message: `Your email is now ${row.new_email}.` });
}

export async function resendVerification(request, env, ctx) {
  const { user } = await requireSession(env, request);
  if (user.emailVerified) return json({ message: 'Your email is already confirmed.' });
  if (!(await hitLimit(env, `verify-send:${user.id}`, 3, 3600))) throw tooMany(60);
  await sendVerificationEmail(env, request, user, null, ctx);
  return json({ message: `We've sent a confirmation link to ${user.email}.` });
}

/* ---------- one-time codes by email ---------- */
const OTP_REQUEST_PURPOSES = ['login', 'verify_email'];

function otpPurpose(value) {
  const p = value == null ? 'login' : value;
  if (!OTP_REQUEST_PURPOSES.includes(p)) throw fieldError({ purpose: 'Unknown purpose.' });
  return p;
}

/** POST /api/auth/otp/request {email, purpose} → the same answer whether or not the account exists. */
export async function requestOtp(request, env, ctx) {
  const body = await readJson(request, 4096);
  const email = cleanEmail(body.email);
  if (email.error) throw fieldError({ email: email.error });
  const purpose = otpPurpose(body.purpose);
  if (!emailEnabled(env)) throw new HttpError(503, 'email_not_configured', "Email codes aren't set up for this site yet.");
  if (!otpEnabled(env)) throw new HttpError(503, 'otp_not_configured', "Email codes aren't set up for this site yet.");
  if (!(await hitLimit(env, `otp-ip:${clientIp(request)}`, 20, 3600))) throw tooMany(60);
  // one request a minute per address, known or not, so the cooldown reveals nothing
  if (!(await hitLimit(env, `otp-cool:${purpose}:${email.value}`, 1, 60))) {
    throw new HttpError(429, 'otp_cooldown', 'Please wait a minute before asking for another code.');
  }
  const message = purpose === 'login'
    ? "If an account uses that email, we've sent it a 6-digit sign-in code. It expires in 10 minutes."
    : "If that email belongs to an account that still needs confirming, we've sent it a 6-digit code. It expires in 10 minutes.";
  const row = await env.DB.prepare(
    "SELECT id, full_name, email, phone_number, email_verified, created_at, last_login_at FROM users WHERE email = ?1 AND account_status = 'active'"
  ).bind(email.value).first();
  if (row && (purpose === 'login' || !row.email_verified)) {
    const work = (async () => {
      if (purpose === 'verify_email') return sendVerificationEmail(env, request, publicUser(row), null, ctx);
      const otp = await createOtp(env, { email: row.email, userId: row.id, purpose: 'login' });
      if (otp.code) await sendTemplate(env, ctx, { to: row.email, userId: row.id, template: 'otp_login', data: { name: row.full_name, code: otp.code, minutes: 10 } });
    })().catch((err) => console.error('otp send failed:', err && err.code));
    // in the background so known and unknown addresses take the same time
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work); else await work;
  }
  return json({ message, cooldownSeconds: 60 });
}

/** POST /api/auth/otp/verify {email, code, purpose, remember} → login: session cookie + { user }; verify_email: confirmed. */
export async function verifyOtpCode(request, env, ctx) {
  const body = await readJson(request, 4096);
  const email = cleanEmail(body.email);
  const code = typeof body.code === 'string' || typeof body.code === 'number' ? String(body.code).replace(/\s+/g, '') : '';
  const fields = {};
  if (email.error) fields.email = email.error;
  if (!/^\d{6}$/.test(code)) fields.code = 'Enter the 6-digit code from the email.';
  if (Object.keys(fields).length) throw fieldError(fields);
  const purpose = otpPurpose(body.purpose);
  if (!otpEnabled(env)) throw new HttpError(503, 'otp_not_configured', "Email codes aren't set up for this site yet.");
  if (!(await hitLimit(env, `otp-verify-ip:${clientIp(request)}`, 30, 900))) throw tooMany(15);

  const result = await verifyOtp(env, { email: email.value, purpose, code });
  if (!result.ok) {
    if (result.reason === 'expired') throw new HttpError(400, 'code_expired', 'That code has expired. Ask for a new one.');
    if (result.reason === 'burned') throw new HttpError(400, 'code_burned', 'Too many wrong tries, so that code no longer works. Ask for a new one.');
    throw new HttpError(400, 'invalid_code', "That code isn't right. Check the latest email and try again.");
  }
  const row = await env.DB.prepare(
    'SELECT id, full_name, email, phone_number, email_verified, created_at, last_login_at, account_status FROM users WHERE id = ?1'
  ).bind(result.userId).first();
  if (!row || row.email !== result.email) throw new HttpError(400, 'invalid_code', "That code isn't right. Check the latest email and try again.");
  if (row.account_status !== 'active') throw new HttpError(403, 'account_disabled', 'This account has been disabled.');
  const now = nowIso();

  if (purpose === 'verify_email') {
    await env.DB.prepare('UPDATE users SET email_verified = 1, updated_at = ?2 WHERE id = ?1').bind(row.id, now).run();
    return json({ message: 'Email confirmed.', user: publicUser({ ...row, email_verified: 1 }) });
  }
  await endSession(env, request);
  // a code from the inbox proves the address, so it counts as confirmed too
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET last_login_at = ?2, email_verified = 1 WHERE id = ?1').bind(row.id, now),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1 AND expires_at <= ?2').bind(row.id, now),
    env.DB.prepare('DELETE FROM rate_limits WHERE key = ?1').bind(`login-fail:${row.email}`),
  ]);
  const cookie = await createSession(env, row.id, body.remember !== false);
  const user = publicUser({ ...row, email_verified: 1, last_login_at: now });
  await noteDevice(env, ctx, request, user);
  return json({ user }, 200, { 'Set-Cookie': cookie });
}
