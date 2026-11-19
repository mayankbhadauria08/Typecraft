// Roles and permissions, who has admin access, and the setup checklist
// (docs/ADMIN-CONSOLE.md §4). Console-only endpoints: a console session is required.
//
//   GET  /api/admin/permissions          roles.view    the grid
//   PUT  /api/admin/permissions          roles.manage  { role, permission, allowed }
//   POST /api/admin/permissions/reset    roles.manage  { role } → that role back to the defaults
//   GET  /api/admin/staff                roles.view    accounts with a role
//   GET  /api/admin/console/setup        settings.view which services are set up (never their values)
import { json, readJson, clientIp } from '../http.js';
import { emailEnabled } from '../session.js';
import { otpEnabled } from '../otp.js';
import { audit } from '../billing.js';
import * as mail from '../mail.js';
import { LAYERS, EDITABLE_ROLES, matrix, setPermission, resetRole } from './permissions.js';
import { requireAdmin } from './session.js';
import { emailCodeOn } from './auth.js';
import { ROLE_LABELS, IDLE_MS, MAX_MS } from './config.js';

const grid = async (env, who) => ({
  roles: [{ key: 'owner', label: ROLE_LABELS.owner, editable: false }, ...EDITABLE_ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r], editable: true }))],
  layers: LAYERS,
  permissions: await matrix(env),
  canEdit: who.role === 'owner',
});

export async function getPermissions(request, env) {
  const who = await requireAdmin(env, request, 'roles.view');
  return json(await grid(env, who));
}

export async function putPermission(request, env) {
  const who = await requireAdmin(env, request, 'roles.manage');
  const body = await readJson(request, 4096);
  const change = await setPermission(env, { role: body.role, permission: body.permission, allowed: body.allowed, actorId: who.user.id });
  if (change.before !== change.after) {
    await audit(env, { actorId: who.user.id, action: 'permission.update', target: `role:${body.role}`,
      detail: { permission: body.permission, before: change.before, after: change.after }, ip: clientIp(request) });
  }
  return json({ changed: change.before !== change.after, ...(await grid(env, who)) });
}

export async function postReset(request, env) {
  const who = await requireAdmin(env, request, 'roles.manage');
  const body = await readJson(request, 4096);
  const removed = await resetRole(env, body.role);
  if (removed.length) {
    await audit(env, { actorId: who.user.id, action: 'permission.reset', target: `role:${body.role}`, detail: { removed }, ip: clientIp(request) });
  }
  return json({ changed: removed.length > 0, ...(await grid(env, who)) });
}

/** Accounts with a role: Super Admins come from the OWNER_EMAILS secret, the rest from admin_users. */
export async function getStaff(request, env) {
  await requireAdmin(env, request, 'roles.view');
  const owners = [...new Set(String(env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
  const lastSignIn = "(SELECT MAX(s.created_at) FROM admin_sessions s WHERE s.user_id = u.id) AS last_admin_sign_in";
  const ownerRows = owners.length
    ? (await env.DB.prepare(
      `SELECT u.id, u.full_name, u.email, u.account_status, u.created_at AS since, ${lastSignIn}
         FROM users u WHERE u.email IN (${owners.map((_, i) => `?${i + 1}`).join(', ')}) ORDER BY u.email`
    ).bind(...owners).all()).results
    : [];
  const staffRows = (await env.DB.prepare(
    `SELECT u.id, u.full_name, u.email, u.account_status, a.role, a.created_at AS since, ${lastSignIn}
       FROM admin_users a JOIN users u ON u.id = a.user_id ORDER BY CASE a.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.email LIMIT 200`
  ).all()).results;
  const view = (r, role) => ({ id: r.id, fullName: r.full_name, email: r.email, role, roleLabel: ROLE_LABELS[role] || role,
    active: r.account_status === 'active', since: r.since, lastAdminSignIn: r.last_admin_sign_in || null });
  const ownerIds = new Set(ownerRows.map((r) => r.id));
  return json({
    staff: [...ownerRows.map((r) => view(r, 'owner')), ...staffRows.filter((r) => !ownerIds.has(r.id)).map((r) => view(r, r.role))],
    ownersWithoutAccount: owners.length - ownerRows.length, // an owner email that hasn't signed up yet
  });
}

/** Which services are set up: yes or no, and the names of settings. Never a secret's value. Also used by the dashboard. */
export function setupItems(env) {
  const smtpSupported = typeof mail.providerOf === 'function'; // sending through Google Workspace arrives with src/smtp.js
  const emailOn = emailEnabled(env);
  const provider = smtpSupported ? mail.providerOf(env) : (env.RESEND_API_KEY ? 'resend' : null);
  const codeOn = emailCodeOn(env);
  const codeSwitchOff = String(env.ADMIN_EMAIL_CODE || '').trim().toLowerCase() === 'off';
  const keyId = String(env.RAZORPAY_KEY_ID || '');
  const items = [
    { key: 'owner', label: 'Super Admin email', ready: String(env.OWNER_EMAILS || '').trim().length > 0,
      detail: 'The accounts that are always Super Admin.', fix: 'Add OWNER_EMAILS.' },
    { key: 'email', label: 'Sending email', ready: emailOn,
      detail: emailOn ? `Sending through ${provider === 'smtp' ? 'Google Workspace' : 'Resend'}.` : 'Sign-in codes, receipts and password resets are not being sent.',
      fix: smtpSupported ? 'Add SMTP_USER and SMTP_PASS (Google Workspace), or RESEND_API_KEY.' : 'Add RESEND_API_KEY.' },
    { key: 'emailWebhook', label: 'Email delivery reports', ready: !!env.RESEND_WEBHOOK_SECRET,
      detail: env.RESEND_WEBHOOK_SECRET ? 'Resend tells us which emails were delivered or bounced.' : "The email log can't tell delivered from bounced, and someone who marks an email as spam keeps getting announcements.",
      fix: 'In Resend, add a webhook to /api/webhooks/resend (delivered, bounced and complained), then add its signing secret as RESEND_WEBHOOK_SECRET.' },
    { key: 'secret', label: 'Secret for emailed codes', ready: otpEnabled(env),
      detail: 'Signs the 6-digit codes and the unsubscribe links.', fix: 'Add SESSION_SECRET: any random text of 40 characters or more.' },
    { key: 'adminCode', label: 'Emailed code at admin sign-in', ready: codeOn,
      detail: codeOn ? 'Admin sign-in asks for the password and a code sent by email.' : 'Admin sign-in asks for the password only.',
      fix: codeSwitchOff ? 'ADMIN_EMAIL_CODE is set to off. Remove it to ask for a code again.' : 'Switches on by itself once sending email and the secret for emailed codes are both on.' },
    { key: 'razorpay', label: 'Razorpay keys', ready: !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
      detail: env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET ? 'Customers can pay.' : 'Customers cannot pay yet.',
      fix: 'Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (Test Mode keys first).',
      mode: keyId ? (keyId.startsWith('rzp_live_') ? 'live' : 'test') : null },
    { key: 'webhook', label: 'Razorpay webhook secret', ready: !!env.RAZORPAY_WEBHOOK_SECRET,
      detail: 'Lets Razorpay confirm a payment even if the customer closes the page.', fix: 'Add RAZORPAY_WEBHOOK_SECRET.' },
  ];
  return items;
}

export async function getSetup(request, env) {
  await requireAdmin(env, request, 'settings.view');
  return json({ items: setupItems(env), session: { idleMinutes: Math.round(IDLE_MS / 60000), maxHours: Math.round(MAX_MS / 3600000) } });
}

export const ROUTES = {
  'GET /api/admin/permissions': getPermissions,
  'PUT /api/admin/permissions': putPermission,
  'POST /api/admin/permissions/reset': postReset,
  'GET /api/admin/staff': getStaff,
  'GET /api/admin/console/setup': getSetup,
};
