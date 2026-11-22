// Security: who is signed in to the admin console, failed sign-ins, accounts locked after wrong passwords, and
// a short list of checks (docs/ADMIN-PHASE-5.md §11). Console-only endpoints.
//
//   GET  /api/console/security                          security.view    → { sessions, locks, failed, checks, rules, can }
//   POST /api/console/security/sessions/:ref/end        security.manage  ends one admin console session (not your own)
//   POST /api/console/security/sessions/end-others      security.manage  ends every console session but yours
//   POST /api/console/security/unlock                   security.manage  { ref } lifts a sign-in lock before its 15 minutes run out
//   POST /api/console/security/session-length           security.manage  { length: '30m' | '2h' | '8h' | '1d' } how long an admin
//                                                                         sign-in lasts (SESSION_LENGTHS in ./config.js); applies at once
//
// security.manage asks for the password again. A session is named by `ref`, the first 16 characters of its id
// (itself a SHA-256 of the cookie), so the full id never leaves the server. Locks are rows in rate_limits.
import { HttpError, json, readJson, clientIp, nowIso } from '../http.js';
import { audit } from '../billing.js';
import { otpEnabled } from '../otp.js';
import { roleFrom } from '../roles.js';
import { requireAdmin, endAdminSession } from './session.js';
import { can } from './permissions.js';
import { emailCodeOn } from './auth.js';
import { ROLE_LABELS, FRESH_MS, SESSION_LENGTHS, SESSION_SETTING } from './config.js';

// The sign-in locks in src/auth.js and ./auth.js: key prefix, who it is for, how many tries, over how long
const LOCKS = [
  { prefix: 'login-fail:', kind: 'learner', label: 'Site sign-in', limit: 8, window: 900 },
  { prefix: 'adm-login-fail:', kind: 'admin', label: 'Admin console sign-in', limit: 5, window: 900 },
  { prefix: 'adm-code-fail:', kind: 'code', label: 'Admin sign-in code', limit: 10, window: 3600 },
];
const STALE_STAFF_DAYS = 90;
const ref = (id) => String(id).slice(0, 16);

async function sessions(env, meSessionId, length) {
  const now = Date.now();
  const rows = (await env.DB.prepare(
    `SELECT s.id, s.user_id, s.second_factor, s.created_at, s.last_seen_at, s.ip, s.device, u.full_name, u.email, a.role
       FROM admin_sessions s JOIN users u ON u.id = s.user_id LEFT JOIN admin_users a ON a.user_id = u.id
      WHERE s.ended_at IS NULL AND s.created_at > ?1 AND s.last_seen_at > ?2 ORDER BY s.last_seen_at DESC LIMIT 100`
  ).bind(new Date(now - length.maxMs).toISOString(), new Date(now - length.idleMs).toISOString()).all()).results;
  return rows.map((r) => {
    const role = roleFrom(env, r.email, r.role);
    return { ref: ref(r.id), userId: r.user_id, name: r.full_name, email: r.email, role, roleLabel: ROLE_LABELS[role] || 'No role',
      device: r.device || 'Unknown device', ip: r.ip || null, secondFactor: !!r.second_factor, startedAt: r.created_at, lastSeenAt: r.last_seen_at,
      endsAt: new Date(Math.min(Date.parse(r.last_seen_at) + length.idleMs, Date.parse(r.created_at) + length.maxMs)).toISOString(), you: r.id === meSessionId };
  });
}

async function locks(env) {
  const nowS = Math.floor(Date.now() / 1000);
  const conds = LOCKS.map((l, i) => `(substr(key, 1, ${l.prefix.length}) = ?${i * 2 + 1} AND window_start > ?${i * 2 + 2})`).join(' OR ');
  const rows = (await env.DB.prepare(`SELECT key, window_start, count FROM rate_limits WHERE ${conds} ORDER BY count DESC LIMIT 100`)
    .bind(...LOCKS.flatMap((l) => [l.prefix, nowS - l.window])).all()).results;
  const out = [];
  const userIds = [];
  for (const r of rows) {
    const l = LOCKS.find((x) => r.key.startsWith(x.prefix));
    if (!l || r.count < 3) continue; // one or two typos aren't worth showing
    const rest = r.key.slice(l.prefix.length);
    let email = null, ip = null, userId = null;
    if (l.kind === 'learner') email = rest;
    else if (l.kind === 'admin') { // email:ip (an IPv6 address has colons of its own; an email has none)
      const cut = rest.indexOf(':');
      email = cut === -1 ? rest : rest.slice(0, cut);
      ip = cut === -1 ? null : rest.slice(cut + 1);
    }
    else { userId = rest; userIds.push(rest); }
    out.push({ ref: r.key, kind: l.kind, label: l.label, email, ip, userId, tries: r.count, limit: l.limit, locked: r.count >= l.limit,
      until: new Date((r.window_start + l.window) * 1000).toISOString() });
  }
  if (userIds.length) {
    const found = (await env.DB.prepare(`SELECT id, email FROM users WHERE id IN (${userIds.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...userIds).all()).results;
    for (const o of out) if (o.userId) o.email = (found.find((u) => u.id === o.userId) || {}).email || null;
  }
  return out;
}

async function failed(env) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const rows = (await env.DB.prepare(
    `SELECT a.action, a.detail, a.ip, a.created_at, u.full_name, u.email FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.created_at >= ?1 AND a.action IN ('admin.login_failed', 'admin.reauth_failed') ORDER BY a.created_at DESC LIMIT 50`
  ).bind(since).all()).results;
  const why = { wrong_password: 'Wrong password', account_disabled: 'Account disabled', too_many_wrong_codes: 'Too many wrong codes' };
  return rows.map((r) => {
    let d = {}; try { d = JSON.parse(r.detail || '{}') || {}; } catch { d = {}; }
    return { name: r.full_name || 'Unknown', email: r.email || null, what: r.action === 'admin.reauth_failed' ? 'Wrong password when confirming a change' : why[d.reason] || 'Failed sign-in',
      ip: r.ip || null, at: r.created_at };
  });
}

async function checks(env) {
  const owners = [...new Set(String(env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const staleBefore = new Date(Date.now() - STALE_STAFF_DAYS * 86400000).toISOString();
  const [ownerRows, staff] = await env.DB.batch([
    owners.length ? env.DB.prepare(`SELECT email FROM users WHERE email IN (${owners.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...owners) : env.DB.prepare('SELECT NULL AS email WHERE 0'),
    env.DB.prepare(`SELECT u.full_name, u.email, u.email_verified, u.account_status, a.created_at,
                           (SELECT MAX(s.created_at) FROM admin_sessions s WHERE s.user_id = u.id) AS last_sign_in
                      FROM admin_users a JOIN users u ON u.id = a.user_id LIMIT 200`),
  ]);
  const missingOwners = owners.length - ownerRows.results.length;
  const unverified = staff.results.filter((s) => !s.email_verified).map((s) => s.full_name);
  const disabled = staff.results.filter((s) => s.account_status !== 'active').map((s) => s.full_name);
  const quiet = staff.results.filter((s) => s.account_status === 'active' && (s.last_sign_in || s.created_at) < staleBefore).map((s) => s.full_name);
  const codeOff = String(env.ADMIN_EMAIL_CODE || '').trim().toLowerCase() === 'off';
  const list = (names) => (names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', '));
  return [
    { ok: emailCodeOn(env), label: 'Emailed code at admin sign-in',
      detail: emailCodeOn(env) ? 'Signing in to the console needs the password and a code sent by email.'
        : codeOff ? 'Switched off with ADMIN_EMAIL_CODE=off. Remove that setting in Cloudflare as soon as email works again.'
          : 'Off until email sending and SESSION_SECRET are both set up. Until then the password alone opens the console.' },
    { ok: otpEnabled(env), label: 'Secret for emailed codes', detail: otpEnabled(env) ? 'SESSION_SECRET is installed.' : 'SESSION_SECRET is missing: add it in Cloudflare (40 random characters or more).' },
    { ok: owners.length > 0 && missingOwners === 0, label: 'Super Admin accounts',
      detail: !owners.length ? 'OWNER_EMAILS is empty, so nobody is Super Admin.'
        : missingOwners ? `${missingOwners} ${missingOwners === 1 ? 'email' : 'emails'} in OWNER_EMAILS ${missingOwners === 1 ? 'has' : 'have'} no account yet. Whoever signs up with ${missingOwners === 1 ? 'it' : 'one of them'} first becomes Super Admin: create the account now, or take the email out.`
          : `${owners.length} Super ${owners.length === 1 ? 'Admin' : 'Admins'}, each with an account.` },
    { ok: !unverified.length, label: 'Administrators confirmed their email', detail: unverified.length ? `Not confirmed yet: ${list(unverified)}. Sign-in codes go to that address.` : 'Every administrator has confirmed their email address.' },
    { ok: !quiet.length, label: 'Administrators still using the console',
      detail: quiet.length ? `No admin sign-in for ${STALE_STAFF_DAYS} days: ${list(quiet)}. Consider removing their role under Administrators.` : `Everyone with a role has signed in within ${STALE_STAFF_DAYS} days, or was added recently.` },
    { ok: !disabled.length, label: 'No disabled accounts with a role', detail: disabled.length ? `Disabled but still holding a role: ${list(disabled)}. They can't sign in; remove the role to tidy up.` : 'None.' },
  ];
}

export async function getSecurity(request, env) {
  const who = await requireAdmin(env, request, 'security.view');
  const len = who.session.length;
  const [s, l, f, c, changed] = await Promise.all([sessions(env, who.session.id, len), locks(env), failed(env), checks(env), lengthChanged(env)]);
  return json({ sessions: s, locks: l, failed: f, checks: c,
    rules: { length: len.key, idle: len.idle, max: len.max, idleMinutes: Math.round(len.idleMs / 60000), maxHours: Math.round(len.maxMs / 3600000),
      lengths: Object.entries(SESSION_LENGTHS).map(([key, x]) => ({ key, idle: x.idle, max: x.max })), lengthChanged: changed,
      emailCode: emailCodeOn(env), freshMinutes: Math.round(FRESH_MS / 60000),
      learnerLock: { tries: LOCKS[0].limit, minutes: LOCKS[0].window / 60 }, adminLock: { tries: LOCKS[1].limit, minutes: LOCKS[1].window / 60 } },
    can: { manage: await can(env, who.role, 'security.manage') } });
}

export async function postEndSession(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'security.manage');
  if (params.ref === ref(who.session.id)) throw new HttpError(400, 'own_session', 'This is your own sign-in. Use Sign out instead.');
  const row = await env.DB.prepare('SELECT s.id, s.user_id, s.device FROM admin_sessions s WHERE substr(s.id, 1, 16) = ?1 AND s.ended_at IS NULL').bind(params.ref).first();
  if (!row) throw new HttpError(404, 'not_found', 'That sign-in has already ended.');
  await endAdminSession(env, row.id, 'ended_by_admin');
  await audit(env, { actorId: who.user.id, action: 'security.session_end', target: `user:${row.user_id}`, detail: { device: row.device }, ip: clientIp(request) });
  return json({ ended: 1, message: 'Signed out. They need to sign in again to use the console.' });
}

export async function postEndOthers(request, env) {
  const who = await requireAdmin(env, request, 'security.manage');
  const r = await env.DB.prepare("UPDATE admin_sessions SET ended_at = ?2, ended_reason = 'ended_by_admin' WHERE ended_at IS NULL AND id <> ?1")
    .bind(who.session.id, nowIso()).run();
  const n = (r.meta && r.meta.changes) || 0;
  await audit(env, { actorId: who.user.id, action: 'security.sessions_end_others', target: 'admin_sessions', detail: { ended: n }, ip: clientIp(request) });
  return json({ ended: n, message: n ? `${n} ${n === 1 ? 'sign-in' : 'sign-ins'} ended. Everyone else must sign in again; you stay signed in.` : 'Nobody else was signed in.' });
}

export async function postUnlock(request, env) {
  const who = await requireAdmin(env, request, 'security.manage');
  const body = await readJson(request, 2048);
  const key = typeof body.ref === 'string' ? body.ref : '';
  const l = LOCKS.find((x) => key.startsWith(x.prefix));
  if (!l || key.length > 300) throw new HttpError(400, 'invalid_input', 'That lock is not known.');
  const r = await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?1').bind(key).run();
  if (!r.meta || !r.meta.changes) throw new HttpError(404, 'not_found', 'That lock has already been lifted.');
  await audit(env, { actorId: who.user.id, action: 'security.unlock', target: l.kind === 'code' ? `user:${key.slice(l.prefix.length)}` : 'sign-in',
    detail: { lock: l.label, account: l.kind === 'code' ? null : key.slice(l.prefix.length).split(':')[0] }, ip: clientIp(request) });
  return json({ message: 'Unlocked. They can try again straight away.' });
}

async function lengthChanged(env) {
  const r = await env.DB.prepare(`SELECT s.updated_at, u.full_name, u.email FROM platform_settings s LEFT JOIN users u ON u.id = s.updated_by WHERE s.key = ?1`)
    .bind(SESSION_SETTING).first();
  return r && r.updated_at ? { at: r.updated_at, by: r.full_name || r.email || null } : null;
}

export async function postSessionLength(request, env) {
  const who = await requireAdmin(env, request, 'security.manage');
  const body = await readJson(request, 1024);
  const key = typeof body.length === 'string' ? body.length : '';
  if (!Object.prototype.hasOwnProperty.call(SESSION_LENGTHS, key)) {
    throw new HttpError(400, 'invalid_input', 'Choose one of the lengths shown.', { length: 'Choose one of the lengths shown.' });
  }
  const before = who.session.length.key;
  const to = SESSION_LENGTHS[key];
  if (key === before) return json({ length: key, message: `No change: admin sign-ins already end after ${to.idle} without activity.` });
  await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(SESSION_SETTING, JSON.stringify({ length: key }), who.user.id, nowIso()).run();
  await audit(env, { actorId: who.user.id, action: 'security.session_length', target: 'admin_sessions',
    detail: { from: SESSION_LENGTHS[before].idle, to: to.idle }, ip: clientIp(request) });
  return json({ length: key,
    message: `Saved. Admin sign-ins now end after ${to.idle} without activity, and after ${to.max} at the latest. This applies straight away, to everyone signed in now too.` });
}

export const ROUTES = {
  'GET /api/console/security': getSecurity,
  'POST /api/console/security/session-length': postSessionLength,
  'POST /api/console/security/sessions/end-others': postEndOthers,
  'POST /api/console/security/unlock': postUnlock,
};
export const PATTERNS = [
  ['POST', /^\/api\/console\/security\/sessions\/([0-9a-f]{16})\/end$/, ['ref'], postEndSession],
];
