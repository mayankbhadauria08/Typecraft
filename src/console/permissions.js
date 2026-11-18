// Roles and permissions for the admin console (docs/ADMIN-CONSOLE.md §4).
//
// One list of permissions, checked on the server by every admin API through
// requireAdmin() / requirePermission() in ./session.js. Each permission has a default
// for the Admin and Support roles; a Super Admin can change those in the console
// (stored in role_permissions, migration 0005). Super Admin always has every permission.
//
// Adding a module: add its permissions here (they appear in the grid by themselves)
// and name one in each of its API handlers and pages.
import { HttpError, nowIso } from '../http.js';

export const LAYERS = [
  { key: 'core', label: 'Core operations' },
  { key: 'learning', label: 'Learning operations' },
  { key: 'growth', label: 'Business growth' },
  { key: 'infra', label: 'Infrastructure' },
];

/** Roles whose permissions can be edited. */
export const EDITABLE_ROLES = ['admin', 'support'];

// ownerOnly: never grantable to Admin or Support (granting them would let a role raise itself).
// sensitive: in the console, the password must have been confirmed in the last 10 minutes.
const P = (key, layer, module, label, description, admin, support, extra = {}) =>
  ({ key, layer, module, label, description, defaults: { admin: !!admin, support: !!support }, ownerOnly: false, sensitive: false, ...extra });

export const PERMISSIONS = [
  // ----- Layer 1: core operations -----
  P('dashboard.view', 'core', 'Dashboard', 'See the business dashboard', 'Totals for users, plans, payments and email health.', 1, 1),
  P('customers.view', 'core', 'Customers', 'See customers', 'Customer list and profiles: plan, purchases and progress.', 1, 1),
  P('customers.manage', 'core', 'Customers', 'Suspend and restore accounts', 'Disable a customer account, switch it back on, or sign a customer out everywhere.', 1, 0),
  P('customers.notes', 'core', 'Customers', 'Write notes on a customer', 'Private notes on a customer profile. Only staff see them.', 1, 1),
  P('customers.export', 'core', 'Customers', 'Download the customer list', 'A spreadsheet of names, emails and phone numbers. Asks for your password again.', 1, 0, { sensitive: true }),
  P('subscriptions.manage', 'core', 'Subscriptions', 'Grant and revoke plans', 'Give a customer a plan by hand, or take a granted plan away.', 1, 0),
  P('packages.view', 'core', 'Packages', 'See packages and prices', 'The plans on sale and what each includes.', 1, 1),
  P('packages.manage', 'core', 'Packages', 'Change packages and prices', 'Edit price, validity, features and which plans are on sale.', 1, 0),
  P('payments.view', 'core', 'Payments', 'See payments', 'Orders, payment status and Razorpay references.', 1, 1),
  P('payments.refund', 'core', 'Payments', 'Issue refunds', 'Send money back through Razorpay. Asks for your password again.', 0, 0, { sensitive: true }),

  // ----- Layer 3: business growth -----
  P('revenue.view', 'growth', 'Business reports', 'See revenue reports', 'Revenue by day and by package, refunds and net totals.', 1, 0),
  P('emails.view', 'growth', 'Email', 'See the email log', 'Emails sent to customers and whether they were delivered.', 1, 1),
  P('emails.retry', 'growth', 'Email', 'Retry failed emails', 'Send a failed email again.', 1, 0),
  P('emails.announce', 'growth', 'Email', 'Send announcements', 'Email an announcement to all, paid or free customers.', 1, 0),
  P('support.view', 'growth', 'Support', 'See customer messages', 'Messages sent through the contact form.', 1, 1),
  P('support.manage', 'growth', 'Support', 'Update customer messages', 'Mark a message answered or closed.', 1, 1),

  // ----- Layer 4: infrastructure -----
  P('settings.view', 'infra', 'Settings', 'See platform settings', 'Business details, support contact and which services are set up.', 1, 0),
  P('settings.manage', 'infra', 'Settings', 'Change platform settings', 'Edit business details, support contact, payments and sign-up switches.', 0, 0),
  P('audit.view', 'infra', 'Activity logs', 'See the activity log', 'Who changed what in the admin, and when.', 1, 0),
  P('roles.view', 'infra', 'Roles and permissions', 'See roles and permissions', 'This table, and who has admin access.', 1, 0),
  P('roles.manage', 'infra', 'Roles and permissions', 'Change role permissions', 'Switch permissions on or off for Admin and Support.', 0, 0, { ownerOnly: true, sensitive: true }),
  P('admins.manage', 'infra', 'Administrators', 'Add and remove administrators', 'Give someone the Admin or Support role, or take it away.', 0, 0, { ownerOnly: true, sensitive: true }),
];

export const BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));

/** Overrides saved by a Super Admin: Map 'role:permission' → boolean. Unknown keys are ignored. */
async function overrides(env) {
  const out = new Map();
  let rows = [];
  try {
    rows = (await env.DB.prepare('SELECT role, permission, allowed FROM role_permissions').all()).results;
  } catch (err) {
    if (!/no such table/i.test(String(err && err.message))) throw err; // before migration 0005: the defaults apply
  }
  for (const r of rows) {
    const p = BY_KEY.get(r.permission);
    if (p && !p.ownerOnly && EDITABLE_ROLES.includes(r.role)) out.set(`${r.role}:${r.permission}`, !!r.allowed);
  }
  return out;
}

function effective(p, role, ov) {
  if (role === 'owner') return true;
  if (!EDITABLE_ROLES.includes(role) || p.ownerOnly) return false;
  const o = ov.get(`${role}:${p.key}`);
  return o === undefined ? p.defaults[role] : o;
}

/** The permission keys a role has right now. Read from the database on every call: never cached. */
export async function permissionsFor(env, role) {
  if (role === 'owner') return PERMISSIONS.map((p) => p.key);
  if (!EDITABLE_ROLES.includes(role)) return [];
  const ov = await overrides(env);
  return PERMISSIONS.filter((p) => effective(p, role, ov)).map((p) => p.key);
}

export async function can(env, role, key) {
  const p = BY_KEY.get(key);
  if (!p) throw new Error(`unknown permission: ${key}`); // a programming mistake, never a user's input
  if (role === 'owner') return true;
  if (!EDITABLE_ROLES.includes(role) || p.ownerOnly) return false;
  const row = await env.DB.prepare('SELECT allowed FROM role_permissions WHERE role = ?1 AND permission = ?2').bind(role, key).first()
    .catch((err) => { if (/no such table/i.test(String(err && err.message))) return null; throw err; });
  return row ? !!row.allowed : p.defaults[role];
}

/** Everything the permissions grid shows. */
export async function matrix(env) {
  const ov = await overrides(env);
  return PERMISSIONS.map((p) => ({
    key: p.key, layer: p.layer, module: p.module, label: p.label, description: p.description,
    ownerOnly: p.ownerOnly, sensitive: p.sensitive,
    roles: Object.fromEntries(EDITABLE_ROLES.map((role) => {
      const allowed = effective(p, role, ov);
      return [role, { allowed, default: p.ownerOnly ? false : p.defaults[role], changed: !p.ownerOnly && allowed !== p.defaults[role] }];
    })),
  }));
}

/**
 * Sets one permission for a role. Stores a row only while it differs from the default.
 * → { before, after } (booleans). Throws 400 for unknown or owner-only permissions.
 */
export async function setPermission(env, { role, permission, allowed, actorId }) {
  if (!EDITABLE_ROLES.includes(role)) throw new HttpError(400, 'invalid_input', 'Choose the Admin or Support role.', { role: 'Choose the Admin or Support role.' });
  const p = BY_KEY.get(permission);
  if (!p) throw new HttpError(400, 'invalid_input', 'Unknown permission.', { permission: 'Unknown permission.' });
  if (p.ownerOnly) throw new HttpError(400, 'owner_only', 'Only a Super Admin can have this permission.', { permission: 'Only a Super Admin can have this permission.' });
  if (typeof allowed !== 'boolean') throw new HttpError(400, 'invalid_input', 'Say whether the permission is on or off.', { allowed: 'Say whether the permission is on or off.' });
  const before = await can(env, role, permission);
  if (allowed === p.defaults[role]) {
    await env.DB.prepare('DELETE FROM role_permissions WHERE role = ?1 AND permission = ?2').bind(role, permission).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO role_permissions (role, permission, allowed, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (role, permission) DO UPDATE SET allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    ).bind(role, permission, allowed ? 1 : 0, actorId || null, nowIso()).run();
  }
  return { before, after: allowed };
}

/** Puts a role back to the defaults. → the changes that were removed: [{ permission, allowed }]. */
export async function resetRole(env, role) {
  if (!EDITABLE_ROLES.includes(role)) throw new HttpError(400, 'invalid_input', 'Choose the Admin or Support role.', { role: 'Choose the Admin or Support role.' });
  const rows = (await env.DB.prepare('SELECT permission, allowed FROM role_permissions WHERE role = ?1 ORDER BY permission').bind(role).all()).results;
  await env.DB.prepare('DELETE FROM role_permissions WHERE role = ?1').bind(role).run();
  return rows.map((r) => ({ permission: r.permission, allowed: !!r.allowed }));
}
