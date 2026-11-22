// Admin console sessions and the one place every admin API checks who is asking
// (docs/ADMIN-CONSOLE.md §3–§4).
//
//   requireAdmin(env, request, 'payments.refund')      every admin endpoint: a console session is required
//                                                      (the learner sign-in never opens an admin endpoint)
//   assertCan(env, who, 'customers.manage')            a further permission inside a handler
//
// A console session is separate from the learner session: its own cookie (SameSite=Strict),
// 30 minutes idle, 8 hours at most, and it stops working the moment the account loses its
// role or is disabled. The role and its permissions are read on every request, never cached.
import { HttpError, readCookie, nowIso, clientIp } from '../http.js';
import { randomToken, sha256Hex } from '../crypto.js';
import { publicUser } from '../session.js';
import { roleFrom } from '../roles.js';
import { can, BY_KEY } from './permissions.js';
import { ADMIN_COOKIE, IDLE_MS, MAX_MS, FRESH_MS, TOUCH_MS } from './config.js';

const COOKIE_ATTRS = 'Path=/; HttpOnly; Secure; SameSite=Strict';
export const adminCookie = (token) => `${ADMIN_COOKIE}=${token}; ${COOKIE_ATTRS}; Max-Age=${Math.floor(MAX_MS / 1000)}`;
export const clearAdminCookie = () => `${ADMIN_COOKIE}=; ${COOKIE_ATTRS}; Max-Age=0`;

/** "Chrome on Windows" (browser and OS family only). */
export function deviceOf(request) {
  const s = String(request.headers.get('User-Agent') || '');
  const browser = /Edg(e|A|iOS)?\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\/|FxiOS\//.test(s) ? 'Firefox'
    : /Chrome\/|CriOS\/|Chromium\//.test(s) ? 'Chrome' : /Safari\//.test(s) && /Version\//.test(s) ? 'Safari' : 'Unknown browser';
  const os = /Windows/.test(s) ? 'Windows' : /Android/.test(s) ? 'Android' : /iPhone|iPad|iPod/.test(s) ? 'iOS'
    : /CrOS/.test(s) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}

/** Starts a console session. → { cookie, id, device, expiresAt } */
export async function createAdminSession(env, request, userId, { secondFactor = false } = {}) {
  const token = randomToken();
  const id = await sha256Hex(token);
  const now = Date.now();
  const nowS = new Date(now).toISOString();
  const expiresAt = new Date(now + MAX_MS).toISOString();
  const device = deviceOf(request);
  await env.DB.prepare(
    `INSERT INTO admin_sessions (id, user_id, second_factor, created_at, last_seen_at, expires_at, reauth_at, ip, device)
     VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?4, ?6, ?7)`
  ).bind(id, userId, secondFactor ? 1 : 0, nowS, expiresAt, clientIp(request), device).run();
  return { cookie: adminCookie(token), id, device, expiresAt };
}

export async function endAdminSession(env, id, reason) {
  await env.DB.prepare('UPDATE admin_sessions SET ended_at = ?2, ended_reason = ?3 WHERE id = ?1 AND ended_at IS NULL').bind(id, nowIso(), reason).run();
}
/** Ends every console session of an account (password changed, role removed, account disabled). */
export async function endAdminSessionsFor(env, userId, reason) {
  try {
    await env.DB.prepare('UPDATE admin_sessions SET ended_at = ?2, ended_reason = ?3 WHERE user_id = ?1 AND ended_at IS NULL').bind(userId, nowIso(), reason).run();
  } catch (err) {
    if (!/no such table/i.test(String(err && err.message))) throw err; // before migration 0005 there are none
  }
}

/**
 * The console session for this request: { user, role, session } or null.
 * Sessions that idled out, expired, or whose account lost its role or was disabled are ended here.
 */
export async function getAdminSession(env, request) {
  const token = readCookie(request, ADMIN_COOKIE);
  if (!token || token.length > 100) return null;
  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.second_factor, s.created_at AS session_created, s.last_seen_at, s.expires_at, s.reauth_at, s.device,
            u.id, u.full_name, u.email, u.phone_number, u.email_verified, u.created_at, u.last_login_at, u.account_status,
            a.role AS staff_role
       FROM admin_sessions s JOIN users u ON u.id = s.user_id LEFT JOIN admin_users a ON a.user_id = u.id
      WHERE s.id = ?1 AND s.ended_at IS NULL`
  ).bind(id).first();
  if (!row) return null;
  const now = Date.now();
  const end = async (reason) => { await endAdminSession(env, id, reason); return null; };
  if (Date.parse(row.expires_at) <= now) return end('expired');
  if (now - Date.parse(row.last_seen_at) > IDLE_MS) return end('idle');
  if (row.account_status !== 'active') return end('account_disabled');
  const role = roleFrom(env, row.email, row.staff_role);
  if (!role) return end('role_removed');
  let lastSeen = Date.parse(row.last_seen_at);
  if (now - lastSeen > TOUCH_MS) {
    lastSeen = now;
    await env.DB.prepare('UPDATE admin_sessions SET last_seen_at = ?2 WHERE id = ?1').bind(id, new Date(now).toISOString()).run();
  }
  return {
    user: publicUser(row),
    role,
    session: {
      id,
      secondFactor: !!row.second_factor,
      device: row.device,
      createdAt: row.session_created,
      expiresAt: row.expires_at,
      idleExpiresAt: new Date(Math.min(lastSeen + IDLE_MS, Date.parse(row.expires_at))).toISOString(),
      fresh: now - Date.parse(row.reauth_at) <= FRESH_MS,
    },
  };
}

/** Throws unless `who` has the permission (and, in the console, a recently confirmed password when it is sensitive). */
export async function assertCan(env, who, permission, { fresh = false } = {}) {
  const p = BY_KEY.get(permission);
  if (!p) throw new Error(`unknown permission: ${permission}`);
  if (!(await can(env, who.role, permission))) throw new HttpError(403, 'forbidden', 'Your role does not allow this action.');
  if ((p.sensitive || fresh) && who.session && !who.session.fresh) {
    throw new HttpError(403, 'reauth_required', 'Confirm your password to continue.');
  }
}

/** A console session is required. → { user, role, session } */
export async function requireAdmin(env, request, permission = null, opts = {}) {
  const who = await getAdminSession(env, request);
  if (!who) throw new HttpError(401, 'admin_sign_in', 'Your admin session has ended. Sign in again.');
  if (permission) await assertCan(env, who, permission, opts);
  return who;
}

