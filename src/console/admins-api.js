// Administrators: who can use the admin console, and with which role (docs/ADMIN-PHASE-5.md §9).
// Console-only endpoints: a console session is required.
//
//   GET    /api/console/administrators          roles.view     → { staff, ownersWithoutAccount, can }
//   POST   /api/console/administrators          admins.manage  { email, role: 'admin' | 'support' }
//   PUT    /api/console/administrators/:id      admins.manage  { role: 'admin' | 'support' }
//   DELETE /api/console/administrators/:id      admins.manage
//
// Administrators are existing TypeCraft accounts only: the person signs up on the site first. Super Admins
// are the accounts in OWNER_EMAILS (a Cloudflare setting) and can't be changed here. Nobody changes their own
// role. Each change is logged as 'user.role' (as in the old /admin) and the person gets an email about it;
// taking the role away also ends their console sessions. admins.manage is for Super Admins only and asks
// for the password again.
import { HttpError, json, readJson, fieldError, clientIp, nowIso, cleanEmail } from '../http.js';
import { audit } from '../billing.js';
import { sendLater } from '../mail.js';
import { isOwner } from '../admin.js';
import { roleFrom } from '../roles.js';
import { requireAdmin, endAdminSessionsFor } from './session.js';
import { can } from './permissions.js';
import { ROLE_LABELS, CONSOLE_BASE } from './config.js';
import { idParam } from './lib.js';

const GRANTABLE = ['admin', 'support'];
const ROLE_WORDS = { admin: 'Runs day-to-day operations: customers, plans, payments, the course, campaigns.', support: 'Helps customers: can look things up and answer messages.' };

async function staffList(env, meId) {
  const owners = [...new Set(String(env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
  const fields = `u.id, u.full_name, u.email, u.email_verified, u.account_status,
    (SELECT MAX(s.created_at) FROM admin_sessions s WHERE s.user_id = u.id) AS last_sign_in,
    (SELECT COUNT(*) FROM admin_sessions s WHERE s.user_id = u.id AND s.ended_at IS NULL AND s.expires_at > ?1) AS open_sessions`;
  const now = nowIso();
  const [ownerRows, staffRows] = await env.DB.batch([
    owners.length
      ? env.DB.prepare(`SELECT ${fields}, NULL AS role, NULL AS added_at, NULL AS added_by FROM users u WHERE u.email IN (${owners.map((_, i) => `?${i + 2}`).join(', ')})`).bind(now, ...owners)
      : env.DB.prepare('SELECT NULL AS id WHERE 0'),
    env.DB.prepare(`SELECT ${fields}, a.role, a.created_at AS added_at, b.full_name AS added_by
                      FROM admin_users a JOIN users u ON u.id = a.user_id LEFT JOIN users b ON b.id = a.created_by
                     ORDER BY CASE a.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.full_name LIMIT 200`).bind(now),
  ]);
  const ownerIds = new Set(ownerRows.results.map((r) => r.id));
  const view = (r, fromSetting) => {
    const role = fromSetting ? 'owner' : roleFrom(env, r.email, r.role);
    return { id: r.id, fullName: r.full_name, email: r.email, role, roleLabel: ROLE_LABELS[role] || role,
      source: fromSetting ? 'setting' : 'console', changeable: !fromSetting && r.id !== meId,
      active: r.account_status === 'active', emailVerified: !!r.email_verified, addedAt: r.added_at || null, addedBy: r.added_by || null,
      lastSignIn: r.last_sign_in || null, openSessions: r.open_sessions || 0, you: r.id === meId };
  };
  return {
    staff: [...ownerRows.results.map((r) => view(r, true)), ...staffRows.results.filter((r) => !ownerIds.has(r.id)).map((r) => view(r, false))],
    ownersWithoutAccount: owners.length - ownerRows.results.length,
  };
}

export async function getAdministrators(request, env) {
  const who = await requireAdmin(env, request, 'roles.view');
  return json({ ...(await staffList(env, who.user.id)), roles: GRANTABLE.map((r) => ({ value: r, label: ROLE_LABELS[r], hint: ROLE_WORDS[r] })),
    can: { manage: await can(env, who.role, 'admins.manage') } });
}

const roleOfBody = (body) => {
  if (!GRANTABLE.includes(body.role)) throw fieldError({ role: 'Choose Admin or Support.' });
  return body.role;
};
async function tell(env, ctx, u, title, message, withLink) {
  await sendLater(env, ctx, { to: u.email, userId: u.id, template: 'account_update', category: 'security',
    data: { name: u.full_name, title, message, ...(withLink ? { ctaLabel: 'Open the admin console', ctaUrl: CONSOLE_BASE } : {}) } });
}
const log = (env, who, u, from, to, request) =>
  audit(env, { actorId: who.user.id, action: 'user.role', target: `user:${u.id}`, detail: { from, to, via: 'console' }, ip: clientIp(request) });

export async function postAdministrator(request, env, ctx) {
  const who = await requireAdmin(env, request, 'admins.manage');
  const body = await readJson(request, 4096);
  const email = cleanEmail(body.email);
  if (email.error) throw fieldError({ email: 'Enter the email address of their TypeCraft account.' });
  const role = roleOfBody(body);
  const u = await env.DB.prepare('SELECT u.id, u.full_name, u.email, u.account_status, a.role FROM users u LEFT JOIN admin_users a ON a.user_id = u.id WHERE u.email = ?1')
    .bind(email.value).first();
  if (!u) throw fieldError({ email: "There's no TypeCraft account with this email. Ask them to sign up on the site first, then add them here." });
  if (isOwner(env, u.email)) throw fieldError({ email: 'This account is a Super Admin through the OWNER_EMAILS setting already.' });
  if (u.role) throw fieldError({ email: `This account is already ${ROLE_LABELS[u.role] || u.role}. Change its role in the list instead.` });
  if (u.account_status !== 'active') throw fieldError({ email: 'This account is disabled. Switch it back on under Customers first.' });
  await env.DB.prepare('INSERT INTO admin_users (user_id, role, created_by, created_at) VALUES (?1, ?2, ?3, ?4)').bind(u.id, role, who.user.id, nowIso()).run();
  await log(env, who, u, null, role, request);
  await tell(env, ctx, u, 'You can now use the TypeCraft admin console',
    `${who.user.fullName} gave your account the ${ROLE_LABELS[role]} role in TypeCraft's admin console. Sign in there with your usual email and password.\n\nIf you didn't expect this, reply to this email.`, true);
  return json({ ...(await staffList(env, who.user.id)), message: `${u.full_name} is now ${ROLE_LABELS[role]}. We emailed them.` }, 201);
}

async function staffRow(env, who, id) {
  const u = await env.DB.prepare('SELECT u.id, u.full_name, u.email, u.account_status, a.role FROM users u LEFT JOIN admin_users a ON a.user_id = u.id WHERE u.id = ?1')
    .bind(idParam(id, 'Administrator not found.')).first();
  if (u && isOwner(env, u.email)) throw new HttpError(403, 'forbidden', 'This Super Admin comes from the OWNER_EMAILS setting in Cloudflare. Change it there.');
  if (!u || !u.role) throw new HttpError(404, 'not_found', 'Administrator not found.');
  if (u.id === who.user.id) throw new HttpError(403, 'forbidden', "You can't change your own role. Ask another Super Admin.");
  return u;
}

export async function putAdministrator(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'admins.manage');
  const role = roleOfBody(await readJson(request, 4096));
  const u = await staffRow(env, who, params.id);
  if (u.role === role) return json({ ...(await staffList(env, who.user.id)), message: 'Nothing changed.' });
  await env.DB.prepare('UPDATE admin_users SET role = ?2 WHERE user_id = ?1').bind(u.id, role).run();
  await log(env, who, u, u.role, role, request);
  await tell(env, ctx, u, 'Your role in the TypeCraft admin console changed',
    `${who.user.fullName} changed your role in TypeCraft's admin console from ${ROLE_LABELS[u.role] || u.role} to ${ROLE_LABELS[role]}. It applies straight away.`, true);
  return json({ ...(await staffList(env, who.user.id)), message: `${u.full_name} is now ${ROLE_LABELS[role]}.` });
}

export async function deleteAdministrator(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'admins.manage');
  const u = await staffRow(env, who, params.id);
  await env.DB.prepare('DELETE FROM admin_users WHERE user_id = ?1').bind(u.id).run();
  await endAdminSessionsFor(env, u.id, 'role_removed');
  await log(env, who, u, u.role, null, request);
  await tell(env, ctx, u, 'Your access to the TypeCraft admin console ended',
    `${who.user.fullName} removed your role in TypeCraft's admin console, so you can no longer sign in there. Your TypeCraft account itself is unchanged.`, false);
  return json({ ...(await staffList(env, who.user.id)), message: `${u.full_name} can no longer use the admin console. Their TypeCraft account stays as it is.` });
}

export const ROUTES = {
  'GET /api/console/administrators': getAdministrators,
  'POST /api/console/administrators': postAdministrator,
};
export const PATTERNS = [
  ['PUT', /^\/api\/console\/administrators\/([\w-]{1,64})$/, ['id'], putAdministrator],
  ['DELETE', /^\/api\/console\/administrators\/([\w-]{1,64})$/, ['id'], deleteAdministrator],
];
