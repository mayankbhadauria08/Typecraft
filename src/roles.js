// Admin roles (docs/SAAS-CONTRACTS.md §7). Minimal version made by the email part; the
// billing part owns this file and its version wins at integration (same API).
import { HttpError } from './http.js';
import { getSession } from './session.js';

export async function roleOf(env, user) {
  if (!user) return null;
  const owners = String(env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (user.email && owners.includes(String(user.email).toLowerCase())) return 'owner';
  const row = await env.DB.prepare('SELECT role FROM admin_users WHERE user_id = ?1').bind(user.id).first();
  return row ? row.role : null;
}

/** → { user, role } when the signed-in user has one of `roles`; otherwise 404 (admin areas stay hidden). */
export async function requireRole(env, request, roles) {
  const s = await getSession(env, request);
  const role = s ? await roleOf(env, s.user) : null;
  if (!role || !roles.includes(role)) throw new HttpError(404, 'not_found', 'Not found.');
  return { user: s.user, role };
}
