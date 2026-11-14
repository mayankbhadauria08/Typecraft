// Roles and admin route protection — docs/SAAS-CONTRACTS.md §7.
// OWNER_EMAILS (secret, comma-separated) are always 'owner'; everyone else gets the
// role in admin_users, or none. Admin areas answer "not found" to anyone without a role.
import { HttpError } from './http.js';
import { getSession } from './session.js';
import { isOwner } from './admin.js';

export const ROLES = ['owner', 'admin', 'support'];

export async function roleOf(env, user) {
  if (!user) return null;
  if (isOwner(env, user.email)) return 'owner';
  const row = await env.DB.prepare('SELECT role FROM admin_users WHERE user_id = ?1').bind(user.id).first();
  return row && ROLES.includes(row.role) ? row.role : null;
}

const notFound = () => new HttpError(404, 'not_found', 'Not found.');

/** { user, role } when the signed-in user has one of `roles`; 404 for everyone else. */
export async function requireRole(env, request, roles = ['owner', 'admin']) {
  const s = await getSession(env, request);
  if (!s) throw notFound();
  const role = await roleOf(env, s.user);
  if (!role) throw notFound();
  // staff without the needed role learn that the action is not theirs (the area itself is not secret to them)
  if (!roles.includes(role)) throw new HttpError(403, 'forbidden', 'Your role does not allow this action.');
  return { user: s.user, role, setCookie: s.setCookie };
}
