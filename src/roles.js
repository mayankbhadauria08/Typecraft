// Who has which role (docs/SAAS-CONTRACTS.md §7, docs/ADMIN-CONSOLE.md §3).
// OWNER_EMAILS (secret, comma-separated) are always 'owner'; everyone else gets the
// role in admin_users, or none. What a role may do is decided in one place only:
// src/console/permissions.js, through requireAdmin() in src/console/session.js.
import { isOwner } from './admin.js';

export const ROLES = ['owner', 'admin', 'support'];

/** The role for an account, given its email and its admin_users.role (or null). One rule, used everywhere. */
export function roleFrom(env, email, staffRole) {
  if (isOwner(env, email)) return 'owner';
  return staffRole && ROLES.includes(staffRole) ? staffRole : null;
}

export async function roleOf(env, user) {
  if (!user) return null;
  if (isOwner(env, user.email)) return 'owner';
  const row = await env.DB.prepare('SELECT role FROM admin_users WHERE user_id = ?1').bind(user.id).first();
  return roleFrom(env, user.email, row && row.role);
}
