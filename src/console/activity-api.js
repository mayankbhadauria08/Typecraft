// Activity logs: who changed what, and when (docs/ADMIN-PHASE-5.md §10). Reads audit_logs, which every part of
// the admin (and payments, sign-ins and a few customer actions) writes to. Console-only; read-only.
//
//   GET /api/console/activity          audit.view  q, actor (user id | 'system'), kind, from, to (India days), page
//                                                  → { items, page, pageSize, pages, total, kinds, actors }
//   GET /api/console/activity/export   audit.view  the same filters, as a spreadsheet (up to 5,000 rows); asks for
//                                                  the password again, and the download itself is logged
//
// IP addresses are removed from entries older than 90 days by the nightly clean-up (src/retention.js).
import { json, clientIp, cleanEmail } from '../http.js';
import { audit } from '../billing.js';
import { roleFrom } from '../roles.js';
import { requireAdmin } from './session.js';
import { ROLE_LABELS, CONSOLE_BASE } from './config.js';
import { Binder, PAGE_SIZE, EXPORT_MAX, pageOf, offsetOf, paged, like, isDay, istDayStart, istDayEnd, istDay, istStamp, parseJson, csvResponse } from './lib.js';

// What each kind of entry covers: an action matches a kind when it starts with one of its prefixes (ending in '.')
// or equals one of its names; `not` takes names back out. The first kind that matches wins.
export const KINDS = [
  ['signin', 'Admin sign-ins', ['admin.'], []],
  ['access', 'Roles and administrators', ['user.role', 'permission.', 'security.'], []],
  ['settings', 'Settings', ['settings.', 'setting.', 'campaign.limit'], []],
  ['customers', 'Customers', ['user.', 'customers.'], ['user.role']],
  ['plans', 'Plans and learning access', ['subscription.', 'access.'], []],
  ['payments', 'Payments and refunds', ['payment.', 'payments.', 'refund.', 'order.', 'checkout.'], []],
  ['packages', 'Packages', ['package.'], []],
  ['course', 'Course and unlock conditions', ['course.', 'unlock.'], []],
  ['growth', 'Campaigns, notifications, coupons and sales', ['campaign.', 'email.', 'announcement.', 'notice.', 'coupon.', 'promotion.'], ['campaign.limit']],
  ['support', 'Support', ['support.', 'contact.'], []],
  ['institutes', 'Institutes', ['institute.'], []],
  ['other', 'Everything else', [], []],
];
const matches = (action, list) => list.some((p) => (p.endsWith('.') ? action.startsWith(p) : action === p));
export const kindOf = (action) => (KINDS.find(([, , inc, not]) => matches(action, inc) && !matches(action, not)) || KINDS[KINDS.length - 1])[0];

export const LABELS = {
  'admin.login': 'Signed in to the admin console', 'admin.logout': 'Signed out of the admin console',
  'admin.login_failed': 'Failed admin sign-in', 'admin.reauth_failed': 'Wrong password when confirming a change',
  'security.session_end': "Ended someone's admin sign-in", 'security.sessions_end_others': 'Signed everyone else out of the admin console',
  'security.unlock': 'Unlocked an account',
  'user.role': 'Changed an administrator role', 'permission.update': 'Changed a permission', 'permission.reset': 'Put a role back to its defaults',
  'settings.update': 'Changed settings', 'campaign.limit': 'Changed the daily campaign limit',
  'user.disable': 'Disabled an account', 'user.enable': 'Switched an account back on', 'user.sign_out': 'Signed a customer out everywhere',
  'user.note_add': 'Wrote a note on a customer', 'user.note_delete': 'Deleted a note on a customer', 'customers.export': 'Downloaded the customer list',
  'subscription.grant': 'Gave a plan', 'subscription.extend': 'Extended a plan', 'subscription.extend_all': 'Extended every active plan',
  'subscription.revoke': 'Ended a plan', 'access.add': 'Opened or closed a lesson or game for a customer', 'access.end': 'Removed a learning access exception',
  'payment.refund': 'Sent a refund', 'payment.recheck': 'Checked a payment with Razorpay', 'payments.export': 'Downloaded the payments list',
  'refund.processed': 'A refund reached the customer', 'refund.failed': 'A refund failed', 'refund.recheck': 'Checked a refund with Razorpay',
  'order.paid': 'A payment was confirmed', 'checkout.bad_signature': 'A payment came back with a wrong signature', 'checkout.discount': 'A discount was used at checkout',
  'package.create': 'Created a package', 'package.update': 'Changed a package',
  'course.draft': 'Changed a course draft', 'course.publish': 'Published course changes', 'course.discard': 'Threw away course drafts',
  'course.restore': 'Went back to an earlier course version', 'unlock.rule': 'Changed an unlock condition', 'unlock.progress': 'Changed when levels open',
  'campaign.create': 'Created a campaign', 'campaign.update': 'Changed a campaign', 'campaign.delete': 'Deleted a campaign', 'campaign.test': 'Sent a test campaign email',
  'campaign.schedule': 'Scheduled a campaign', 'campaign.unschedule': 'Took a campaign off the schedule', 'campaign.start': 'Started sending a campaign',
  'campaign.cancel': 'Stopped a campaign', 'email.retry': 'Sent a failed email again', 'announcement.send': 'Sent an announcement',
  'notice.create': 'Created a notification', 'notice.update': 'Changed a notification', 'notice.delete': 'Deleted a notification',
  'notice.on': 'Turned a notification on', 'notice.off': 'Turned a notification off',
  'coupon.create': 'Created a coupon', 'coupon.update': 'Changed a coupon', 'coupon.delete': 'Deleted a coupon', 'coupon.on': 'Turned a coupon on', 'coupon.off': 'Turned a coupon off',
  'promotion.create': 'Created a sale', 'promotion.update': 'Changed a sale', 'promotion.delete': 'Deleted a sale', 'promotion.on': 'Started a sale', 'promotion.off': 'Ended a sale',
  'support.reply': 'Replied to a customer', 'support.status': "Changed a message's status", 'support.assign': 'Gave a message to someone',
  'support.note': 'Wrote a note on a message', 'contact.status': "Changed a message's status",
  'institute.create': 'Created an institute', 'institute.update': 'Changed an institute', 'institute.status': "Changed an institute's status",
  'institute.term': "Changed an institute's term", 'institute.pricing': 'Changed institute pricing', 'institute.payment': 'Recorded an institute payment',
  'institute.payment_remove': 'Removed an institute payment', 'institute.invoice': 'Made an institute invoice', 'institute.order': 'An institute started an online payment',
  'institute.order_paid': 'An institute paid online', 'institute.staff_invite': 'Invited institute staff', 'institute.staff_resend': 'Sent an institute invitation again',
  'institute.staff_remove': 'Removed institute staff', 'institute.students_invite': 'Invited students to a batch',
  'audit.export': 'Downloaded the activity log',
};
const readable = (key) => { const s = String(key || '').replace(/[._]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
export const labelOf = (action) => LABELS[action] || readable(action);

// Where an entry's subject lives in the console
const LINKS = { user: '/customers/', order: '/payments/', institute: '/institutes/', campaign: '/campaigns/', coupon: '/coupons/', package: '/packages/' };
function about(target, names) {
  const m = String(target || '').match(/^([a-z_]+):(.+)$/);
  if (!m) return { text: target || null, link: null };
  const [, type, id] = m;
  if (type === 'user') return { text: names.get(id) || 'An account that no longer exists', link: names.has(id) ? CONSOLE_BASE + LINKS.user + id : null };
  if (type === 'contact' && /^msg_[\w-]+$/.test(id)) return { text: 'Support message', link: `${CONSOLE_BASE}/support/${id}` };
  if (type === 'settings' || type === 'setting') return { text: `Settings: ${id.split(',').join(', ')}`, link: `${CONSOLE_BASE}/settings` };
  if (type === 'role') return { text: `${ROLE_LABELS[id] || id} role`, link: `${CONSOLE_BASE}/roles` };
  const words = { order: 'Order', payment: 'Payment', institute: 'Institute', institute_order: 'Institute order', campaign: 'Campaign', coupon: 'Coupon',
    promotion: 'Sale', package: 'Package', notice: 'Notification', course: 'Course', email: 'Email' }[type] || readable(type);
  return { text: `${words} ${id}`, link: LINKS[type] && /^[\w-]{1,64}$/.test(id) ? CONSOLE_BASE + LINKS[type] + id : null };
}

/* ---------- filters ---------- */
function kindWhere(b, kind) {
  const k = KINDS.find((x) => x[0] === kind);
  if (!k) return null;
  const cond = (p) => (p.endsWith('.') ? `substr(a.action, 1, ${p.length}) = ${b.p(p)}` : `a.action = ${b.p(p)}`);
  if (kind === 'other') {
    const all = KINDS.slice(0, -1).flatMap(([, , inc]) => inc);
    return `NOT (${all.map(cond).join(' OR ')})`;
  }
  const inc = `(${k[2].map(cond).join(' OR ')})`;
  return k[3].length ? `${inc} AND NOT (${k[3].map(cond).join(' OR ')})` : inc;
}

async function whereOf(env, q) {
  const b = new Binder();
  const where = [];
  const kind = q.get('kind');
  if (kind) { const w = kindWhere(b, kind); if (w) where.push(w); }
  const actor = q.get('actor');
  if (actor === 'system') where.push('a.actor_id IS NULL');
  else if (actor && /^[\w-]{1,64}$/.test(actor)) where.push(`a.actor_id = ${b.p(actor)}`);
  const from = q.get('from'), to = q.get('to');
  if (isDay(from)) where.push(`a.created_at >= ${b.p(istDayStart(from))}`);
  if (isDay(to)) where.push(`a.created_at < ${b.p(istDayEnd(to))}`);
  const text = String(q.get('q') || '').trim().slice(0, 80);
  if (text) {
    const email = cleanEmail(text);
    const u = !email.error ? await env.DB.prepare('SELECT id FROM users WHERE email = ?1').bind(email.value).first() : null;
    if (u) where.push(`(a.target = ${b.p('user:' + u.id)} OR a.actor_id = ${b.p(u.id)})`);
    else { const pat = b.p(like(text)); where.push(`(a.target LIKE ${pat} ESCAPE '\\' OR a.action LIKE ${pat} ESCAPE '\\')`); }
  }
  return { b, sql: where.length ? 'WHERE ' + where.join(' AND ') : '' };
}

async function rowsOf(env, q, { limit, offset }) {
  const { b, sql } = await whereOf(env, q);
  const list = env.DB.prepare(`SELECT a.id, a.actor_id, a.action, a.target, a.detail, a.ip, a.created_at, u.full_name AS actor_name, u.email AS actor_email, s.role AS actor_role
                                 FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN admin_users s ON s.user_id = a.actor_id
                                 ${sql} ORDER BY a.created_at DESC, a.rowid DESC LIMIT ${limit} OFFSET ${offset}`).bind(...b.args);
  const count = env.DB.prepare(`SELECT COUNT(*) AS n FROM audit_logs a ${sql}`).bind(...b.args);
  const [rows, total] = await env.DB.batch([list, count]);
  const userIds = [...new Set(rows.results.map((r) => (/^user:([\w-]{1,64})$/.exec(r.target || '') || [])[1]).filter(Boolean))];
  const names = new Map();
  for (let i = 0; i < userIds.length; i += 90) {
    const part = userIds.slice(i, i + 90);
    const found = (await env.DB.prepare(`SELECT id, full_name, email FROM users WHERE id IN (${part.map((_, j) => `?${j + 1}`).join(', ')})`).bind(...part).all()).results;
    for (const u of found) names.set(u.id, `${u.full_name} (${u.email})`);
  }
  const items = rows.results.map((r) => {
    const role = r.actor_id ? roleFrom(env, r.actor_email || '', r.actor_role) : null;
    const a = about(r.target, names);
    return { id: r.id, action: r.action, label: labelOf(r.action), kind: kindOf(r.action), createdAt: r.created_at,
      actor: r.actor_id ? { id: r.actor_id, name: r.actor_name || 'A deleted account', email: r.actor_email || null, role, roleLabel: role ? ROLE_LABELS[role] : 'Customer' } : null,
      target: r.target, about: a.text, link: a.link, detail: parseJson(r.detail, null), ip: r.ip || null };
  });
  return { items, total: total.results[0].n };
}

async function actorsOf(env) {
  const owners = String(env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).slice(0, 50);
  const rows = (await env.DB.prepare(`SELECT u.id, u.full_name, u.email FROM users u WHERE u.id IN (SELECT user_id FROM admin_users)
                                       ${owners.length ? `OR u.email IN (${owners.map((_, i) => `?${i + 1}`).join(', ')})` : ''} ORDER BY u.full_name LIMIT 200`).bind(...owners).all()).results;
  return [{ id: 'system', name: 'TypeCraft itself (payments, scheduled jobs)' }, ...rows.map((r) => ({ id: r.id, name: `${r.full_name} (${r.email})` }))];
}

export async function getActivity(request, env) {
  await requireAdmin(env, request, 'audit.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q);
  const { items, total } = await rowsOf(env, q, { limit: PAGE_SIZE, offset: offsetOf(page) });
  return json({ ...paged(items, page, total), kinds: KINDS.map(([id, name]) => ({ id, name })), actors: await actorsOf(env) });
}

export async function exportActivity(request, env) {
  const who = await requireAdmin(env, request, 'audit.view', { fresh: true });
  const q = new URL(request.url).searchParams;
  const { items, total } = await rowsOf(env, q, { limit: EXPORT_MAX, offset: 0 });
  const filters = Object.fromEntries(['kind', 'actor', 'from', 'to', 'q'].filter((k) => q.get(k)).map((k) => [k, k === 'q' ? '(search text)' : q.get(k)]));
  await audit(env, { actorId: who.user.id, action: 'audit.export', target: 'activity', detail: { rows: items.length, cutOff: total > items.length, filters }, ip: clientIp(request) });
  return csvResponse(`typecraft-activity-${istDay()}.csv`,
    ['When (India time)', 'Who', 'Role', 'What', 'Action', 'About', 'Details', 'IP address'],
    items.map((i) => [istStamp(i.createdAt), i.actor ? `${i.actor.name}${i.actor.email ? ` (${i.actor.email})` : ''}` : 'TypeCraft', i.actor ? i.actor.roleLabel : 'System',
      i.label, i.action, i.about || '', i.detail == null ? '' : JSON.stringify(i.detail), i.ip || '']));
}

export const ROUTES = {
  'GET /api/console/activity': getActivity,
  'GET /api/console/activity/export': exportActivity,
};
