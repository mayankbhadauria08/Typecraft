// Admin roles (docs/SAAS-CONTRACTS.md §7). Emails in OWNER_EMAILS are always 'owner';
// everyone else gets the role stored in admin_users, or null. Admin areas answer
// "not found" to anyone without a role, so they don't reveal that they exist.
import { HttpError } from './http.js';
import { requireSession } from './session.js';

export const ROLES = ['owner', 'admin', 'support'];

function ownerEmails(env) {
  return String(env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/** 'owner' | 'admin' | 'support' | null */
export async function roleOf(env, user) {
  if (!user) return null;
  if (user.email && ownerEmails(env).includes(String(user.email).toLowerCase())) return 'owner';
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare('SELECT role FROM admin_users WHERE user_id = ?1').bind(user.id).first();
    return row && ROLES.includes(row.role) ? row.role : null;
  } catch {
    return null; // table missing (database not migrated): nobody has a stored role
  }
}

/** { user, role } for a signed-in user whose role is in `allowed`; otherwise 404. */
export async function requireRole(env, request, allowed = ['owner', 'admin']) {
  let s;
  try { s = await requireSession(env, request); } catch { throw new HttpError(404, 'not_found', 'Not found.'); }
  const role = await roleOf(env, s.user);
  if (!role || !allowed.includes(role)) throw new HttpError(404, 'not_found', 'Not found.');
  return { user: s.user, role, session: s };
}
