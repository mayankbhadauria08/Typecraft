// Customers (docs/ADMIN-PHASE-2.md §5). Console-only endpoints: a console session is required.
//
//   GET    /api/console/customers              customers.view    list: q, plan, status, verified, joined, sort, page
//   GET    /api/console/customers/export.csv   customers.export  the same filters as a spreadsheet (password check)
//   GET    /api/console/customers/:id          customers.view    profile; payments, emails and admin activity only
//                                                                with payments.view, emails.view, audit.view
//   POST   /api/console/customers/:id/status   customers.manage  { status: 'active' | 'disabled', reason }
//   POST   /api/console/customers/:id/sign-out customers.manage  end every site session of the customer
//   POST   /api/console/customers/:id/notes    customers.notes   { body }
//   DELETE /api/console/notes/:id              customers.notes   the author or a Super Admin
//
// A customer and an administrator are the same kind of account; `role` says which accounts are staff.
// Nothing here returns a password hash, a session id or a token.
import '../../shared/course-meta.js';
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from '../http.js';
import { uuid } from '../crypto.js';
import { roleFrom } from '../roles.js';
import { entitlementsFor } from '../entitlements.js';
import { audit } from '../billing.js';
import { requireAdmin, endAdminSessionsFor } from './session.js';
import { subView } from './subscriptions-api.js';
import { ACCESS_SELECT, accessView, TARGETS } from './learning-access-api.js';
import { permissionsFor } from './permissions.js';
import { ROLE_LABELS } from './config.js';
import { PAGE_SIZE, EXPORT_MAX, DAY_MS, Binder, pageOf, offsetOf, paged, like, oneOf, idParam, istDay, istDayStart, istStamp, reasonOf, csvResponse } from './lib.js';

const META = globalThis.TC_META;
const NOTE_MAX = 2000;
const NOTES_PER_CUSTOMER = 200;

/* ---------- the list ---------- */
const SORTS = {
  newest: 'u.created_at DESC',
  oldest: 'u.created_at ASC',
  login: 'u.last_login_at IS NULL, u.last_login_at DESC',
  name: 'u.full_name COLLATE NOCASE ASC',
};
// phone numbers are stored as typed ("+91 98765 43210"): compare digits with digits
const PHONE_DIGITS = "replace(replace(replace(replace(replace(replace(u.phone_number, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '')";

/** WHERE for the list, its COUNT and the export: built against one binder per statement. */
function whereOf(b, q, now) {
  const where = [];
  const activeSub = () => `s.user_id = u.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ${b.once('now', now)})`;

  const term = (q.get('q') || '').trim().slice(0, 80);
  if (term) {
    const parts = [`u.email LIKE ${b.p(like(term.toLowerCase()))} ESCAPE '\\'`, `u.full_name LIKE ${b.p(like(term))} ESCAPE '\\'`];
    const digits = term.replace(/\D/g, '');
    if (digits.length >= 4 && /^[\d\s().+-]+$/.test(term)) parts.push(`${PHONE_DIGITS} LIKE ${b.p(like(digits))} ESCAPE '\\'`);
    if (/^[\w-]{8,64}$/.test(term)) parts.push(`u.id = ${b.p(term)}`);
    where.push(`(${parts.join(' OR ')})`);
  }
  const plan = q.get('plan') || '';
  if (plan === 'free') where.push(`NOT EXISTS (SELECT 1 FROM user_subscriptions s WHERE ${activeSub()})`);
  else if (plan === 'paid') where.push(`EXISTS (SELECT 1 FROM user_subscriptions s WHERE ${activeSub()})`);
  else if (/^[a-z][a-z0-9-]{0,30}$/.test(plan)) where.push(`EXISTS (SELECT 1 FROM user_subscriptions s WHERE ${activeSub()} AND s.package_id = ${b.p(plan)})`);

  const status = oneOf(q.get('status'), ['active', 'disabled']);
  if (status) where.push(`u.account_status = ${b.p(status)}`);
  const verified = oneOf(q.get('verified'), ['1', '0']);
  if (verified) where.push(`u.email_verified = ${b.p(Number(verified))}`);
  const joined = oneOf(q.get('joined'), ['today', '7d', '30d']);
  if (joined) {
    const back = joined === 'today' ? 0 : joined === '7d' ? 6 : 29;
    where.push(`u.created_at >= ${b.p(istDayStart(istDay(Date.now() - back * DAY_MS)))}`);
  }
  return where.length ? 'WHERE ' + where.join(' AND ') : '';
}

// the plan a customer is on now: the active subscription of the highest package; none = Free
const planColumn = (b, now) => `(SELECT json_object('id', s.package_id, 'name', p.name, 'expiresAt', s.expires_at)
     FROM user_subscriptions s JOIN packages p ON p.id = s.package_id
    WHERE s.user_id = u.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ${b.once('now', now)})
    ORDER BY p.display_order DESC, s.expires_at IS NULL DESC, s.expires_at DESC LIMIT 1) AS plan`;

function listStatement(env, q, now, { limit, offset }) {
  const b = new Binder();
  const plan = planColumn(b, now);
  const where = whereOf(b, q, now);
  const sort = SORTS[oneOf(q.get('sort'), Object.keys(SORTS), 'newest')];
  return env.DB.prepare(
    `SELECT u.id, u.full_name, u.email, u.phone_number, u.email_verified, u.account_status, u.created_at, u.last_login_at, a.role AS staff_role, ${plan}
       FROM users u LEFT JOIN admin_users a ON a.user_id = u.id ${where}
      ORDER BY ${sort}, u.id LIMIT ${limit} OFFSET ${offset}`
  ).bind(...b.args);
}
function countStatement(env, q, now) {
  const b = new Binder();
  const where = whereOf(b, q, now);
  return env.DB.prepare(`SELECT COUNT(*) AS n FROM users u ${where}`).bind(...b.args);
}
const planOf = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
const listItem = (env, u) => ({
  id: u.id, fullName: u.full_name, email: u.email, phone: u.phone_number, emailVerified: !!u.email_verified, status: u.account_status,
  role: roleFrom(env, u.email, u.staff_role), plan: planOf(u.plan), createdAt: u.created_at, lastLoginAt: u.last_login_at,
});

export async function getCustomers(request, env) {
  await requireAdmin(env, request, 'customers.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q), now = nowIso(), DB = env.DB;
  const [rows, count, packages] = await DB.batch([
    listStatement(env, q, now, { limit: PAGE_SIZE, offset: offsetOf(page) }),
    countStatement(env, q, now),
    DB.prepare("SELECT id, name FROM packages WHERE id <> 'free' ORDER BY display_order, name"),
  ]);
  return json({ ...paged(rows.results.map((u) => listItem(env, u)), page, count.results[0].n), packages: packages.results });
}

export async function exportCustomers(request, env) {
  const who = await requireAdmin(env, request, 'customers.export');
  const q = new URL(request.url).searchParams;
  const now = nowIso();
  const rows = (await listStatement(env, q, now, { limit: EXPORT_MAX + 1, offset: 0 }).all()).results;
  const more = rows.length > EXPORT_MAX;
  const out = rows.slice(0, EXPORT_MAX).map((u) => {
    const c = listItem(env, u);
    return [c.fullName, c.email, c.phone, c.emailVerified ? 'Yes' : 'No', c.status === 'active' ? 'Active' : 'Disabled', c.plan ? c.plan.name : 'Free',
      c.plan && c.plan.expiresAt ? istStamp(c.plan.expiresAt) : '', istStamp(c.createdAt), c.lastLoginAt ? istStamp(c.lastLoginAt) : ''];
  });
  const filters = Object.fromEntries(['q', 'plan', 'status', 'verified', 'joined', 'sort'].filter((k) => q.get(k)).map((k) => [k, k === 'q' ? '(search text)' : q.get(k)]));
  await audit(env, { actorId: who.user.id, action: 'customers.export', target: 'customers', detail: { rows: out.length, cutOff: more, filters }, ip: clientIp(request) });
  return csvResponse(`typecraft-customers-${istDay()}.csv`,
    ['Name', 'Email', 'Phone', 'Email verified', 'Account', 'Plan', 'Plan ends (India time)', 'Joined (India time)', 'Last sign-in (India time)'], out);
}

/* ---------- one customer ---------- */
async function customerRow(env, id) {
  const u = await env.DB.prepare(
    `SELECT u.id, u.full_name, u.email, u.phone_number, u.email_verified, u.account_status, u.created_at, u.last_login_at, u.password_changed_at, a.role AS staff_role
       FROM users u LEFT JOIN admin_users a ON a.user_id = u.id WHERE u.id = ?1`
  ).bind(idParam(id, 'Customer not found.')).first();
  if (!u) throw new HttpError(404, 'not_found', 'Customer not found.');
  return { ...u, role: roleFrom(env, u.email, u.staff_role) };
}
/** Why `who` may not disable, restore or sign out this account; null when they may. */
function manageBlock(who, target) {
  if (target.id === who.user.id) return "You can't do this to your own account.";
  if (target.role === 'owner') return 'A Super Admin account cannot be changed here.';
  if (target.role && who.role !== 'owner') return 'Only a Super Admin can change another staff account.';
  return null;
}
const noteView = (who, n) => ({ id: n.id, body: n.body, author: n.author || 'Deleted account', createdAt: n.created_at, canDelete: who.role === 'owner' || n.created_by === who.user.id });
const NOTES_SQL = `SELECT n.id, n.body, n.created_by, n.created_at, x.full_name AS author
                     FROM customer_notes n LEFT JOIN users x ON x.id = n.created_by WHERE n.user_id = ?1 ORDER BY n.created_at DESC, n.id LIMIT ${NOTES_PER_CUSTOMER}`;

export async function getCustomer(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'customers.view');
  const u = await customerRow(env, params.id);
  const perms = await permissionsFor(env, who.role);
  const has = (k) => perms.includes(k);
  const DB = env.DB, now = nowIso();
  const firstDay = istDay(Date.now() - 13 * DAY_MS);

  const stmts = {
    subs: DB.prepare(`SELECT s.id, s.package_id, p.name AS package_name, s.order_id, s.status, s.source, s.starts_at, s.expires_at, s.created_at
                        FROM user_subscriptions s JOIN packages p ON p.id = s.package_id WHERE s.user_id = ?1 ORDER BY s.created_at DESC LIMIT 50`).bind(u.id),
    totals: DB.prepare('SELECT xp, streak_count, streak_best FROM user_totals WHERE user_id = ?1').bind(u.id),
    lessons: DB.prepare(`SELECT COALESCE(SUM(status = 'completed'), 0) AS done, COALESCE(SUM(stars), 0) AS stars, COALESCE(SUM(crown), 0) AS crowns,
                                COALESCE(MAX(best_wpm), 0) AS best, MAX(last_played) AS last_played FROM lesson_scores WHERE user_id = ?1`).bind(u.id),
    tests: DB.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(wpm), 0) AS best FROM typing_tests WHERE user_id = ?1').bind(u.id),
    days: DB.prepare('SELECT day, seconds FROM daily_totals WHERE user_id = ?1 AND day >= ?2 ORDER BY day').bind(u.id, firstDay),
    certificates: DB.prepare('SELECT level, wpm, accuracy, at FROM certificates WHERE user_id = ?1 ORDER BY level').bind(u.id),
    placement: DB.prepare('SELECT level, wpm, accuracy, at FROM placement WHERE user_id = ?1').bind(u.id),
    devices: DB.prepare('SELECT label, first_seen, last_seen FROM known_devices WHERE user_id = ?1 ORDER BY last_seen DESC LIMIT 10').bind(u.id),
    sessions: DB.prepare('SELECT COUNT(*) AS n, MAX(last_seen_at) AS last_seen FROM sessions WHERE user_id = ?1 AND expires_at > ?2').bind(u.id, now),
    notes: DB.prepare(NOTES_SQL).bind(u.id),
  };
  if (has('payments.view')) {
    stmts.orders = DB.prepare(`SELECT o.id, p.name AS package_name, o.amount_paise, o.currency, o.status, o.created_at, o.paid_at, i.number AS invoice_number
                                 FROM orders o JOIN packages p ON p.id = o.package_id LEFT JOIN invoices i ON i.order_id = o.id
                                WHERE o.user_id = ?1 ORDER BY o.created_at DESC LIMIT 10`).bind(u.id);
  }
  if (has('access.view')) {
    // the exceptions in force first, then the latest that ended
    stmts.access = DB.prepare(`${ACCESS_SELECT} WHERE a.user_id = ?1
      ORDER BY (a.ended_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > ?2)) DESC, a.created_at DESC LIMIT 60`).bind(u.id, now);
  }
  if (has('subscriptions.manage')) {
    stmts.packages = DB.prepare("SELECT id, name, validity_days, active FROM packages WHERE id <> 'free' ORDER BY display_order, name");
  }
  if (has('emails.view')) {
    stmts.emails = DB.prepare('SELECT template, subject, status, created_at FROM email_logs WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 10').bind(u.id);
  }
  if (has('audit.view')) {
    stmts.activity = DB.prepare(`SELECT a.action, a.detail, a.created_at, x.full_name AS actor FROM audit_logs a LEFT JOIN users x ON x.id = a.actor_id
                                  WHERE a.target = ?1 ORDER BY a.created_at DESC LIMIT 20`).bind(`user:${u.id}`);
  }
  const keys = Object.keys(stmts);
  const answers = await DB.batch(keys.map((k) => stmts[k]));
  const R = Object.fromEntries(keys.map((k, i) => [k, answers[i].results]));
  const ent = await entitlementsFor(env, u.id, now);

  const totals = R.totals[0] || {}, lessons = R.lessons[0] || {}, tests = R.tests[0] || {}, sess = R.sessions[0] || {};
  const seconds = new Map(R.days.map((d) => [d.day, d.seconds]));
  const days = Array.from({ length: 14 }, (_, i) => {
    const day = istDay(Date.now() - (13 - i) * DAY_MS);
    return { day, minutes: Math.round((seconds.get(day) || 0) / 60) };
  });
  const reasonIn = (detail) => { try { const d = JSON.parse(detail); return d && typeof d.reason === 'string' ? d.reason : null; } catch { return null; } };

  return json({
    customer: {
      id: u.id, fullName: u.full_name, email: u.email, phone: u.phone_number, emailVerified: !!u.email_verified, status: u.account_status,
      role: u.role, roleLabel: u.role ? ROLE_LABELS[u.role] : null, createdAt: u.created_at, lastLoginAt: u.last_login_at, passwordChangedAt: u.password_changed_at,
    },
    plan: { id: ent.plan, name: ent.planName, expiresAt: ent.expiresAt },
    subscriptions: R.subs.map((s) => subView(s, now)),
    packages: R.packages ? R.packages.map((p) => ({ id: p.id, name: p.name, validityDays: p.validity_days, onSale: !!p.active })) : null,
    access: R.access ? R.access.map((a) => accessView(a, now)) : null,
    accessTargets: has('access.manage') ? TARGETS : null,
    orders: R.orders ? R.orders.map((o) => ({ id: o.id, packageName: o.package_name, amountPaise: o.amount_paise, currency: o.currency, status: o.status,
      createdAt: o.created_at, paidAt: o.paid_at, invoiceNumber: o.invoice_number })) : null,
    progress: {
      lessonsDone: lessons.done || 0, lessonsTotal: META.LESSONS.length, stars: lessons.stars || 0, crowns: lessons.crowns || 0,
      bestLessonWpm: Math.round(lessons.best || 0), lastPractised: lessons.last_played || null,
      xp: totals.xp || 0, rank: META.rankFor(totals.xp || 0).name, streak: totals.streak_count || 0, bestStreak: totals.streak_best || 0,
      tests: tests.n || 0, bestTestWpm: Math.round(tests.best || 0),
      placement: R.placement[0] ? { level: R.placement[0].level, wpm: Math.round(R.placement[0].wpm), accuracy: Math.round(R.placement[0].accuracy), at: R.placement[0].at } : null,
      certificates: R.certificates.map((c) => ({ level: c.level, wpm: Math.round(c.wpm), accuracy: Math.round(c.accuracy), at: c.at })),
      days,
    },
    devices: R.devices.map((d) => ({ label: d.label || 'Unknown device', firstSeen: d.first_seen, lastSeen: d.last_seen })),
    sessions: { active: sess.n || 0, lastSeenAt: sess.last_seen || null },
    notes: R.notes.map((n) => noteView(who, n)),
    emails: R.emails ? R.emails.map((e) => ({ template: e.template, subject: e.subject, status: e.status, createdAt: e.created_at })) : null,
    activity: R.activity ? R.activity.map((a) => ({ action: a.action, reason: reasonIn(a.detail), actor: a.actor || 'System', createdAt: a.created_at })) : null,
    can: { manage: has('customers.manage') && !manageBlock(who, u), manageBlock: has('customers.manage') ? manageBlock(who, u) : null, notes: has('customers.notes'),
      plans: has('subscriptions.manage'), access: has('access.manage') },
  });
}

export async function postStatus(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'customers.manage');
  const u = await customerRow(env, params.id);
  const body = await readJson(request);
  const status = oneOf(body.status, ['active', 'disabled'], null);
  if (!status) throw fieldError({ status: 'Choose active or disabled.' });
  const reason = reasonOf(body);
  const block = manageBlock(who, u);
  if (block) throw new HttpError(403, 'forbidden', block);
  if (u.account_status === status) return json({ status, changed: false });

  const DB = env.DB, now = nowIso();
  const stmts = [DB.prepare('UPDATE users SET account_status = ?2, updated_at = ?3 WHERE id = ?1').bind(u.id, status, now)];
  if (status === 'disabled') stmts.push(DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(u.id));
  await DB.batch(stmts);
  if (status === 'disabled') await endAdminSessionsFor(env, u.id, 'account_disabled');
  await audit(env, { actorId: who.user.id, action: status === 'disabled' ? 'user.disable' : 'user.enable', target: `user:${u.id}`, detail: { reason }, ip: clientIp(request) });
  return json({ status, changed: true });
}

export async function postSignOut(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'customers.manage');
  const u = await customerRow(env, params.id);
  const block = manageBlock(who, u);
  if (block) throw new HttpError(403, 'forbidden', block);
  const r = await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(u.id).run();
  const ended = (r.meta && r.meta.changes) || 0;
  await audit(env, { actorId: who.user.id, action: 'user.sign_out', target: `user:${u.id}`, detail: { sessions: ended }, ip: clientIp(request) });
  return json({ ended });
}

export async function postNote(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'customers.notes');
  const u = await customerRow(env, params.id);
  const body = await readJson(request);
  const text = typeof body.body === 'string' ? body.body.replace(/\r\n?/g, '\n').trim() : '';
  if (!text) throw fieldError({ body: 'Write the note first.' });
  if (text.length > NOTE_MAX) throw fieldError({ body: `Keep a note under ${NOTE_MAX.toLocaleString('en-IN')} characters.` });
  const DB = env.DB;
  const have = (await DB.prepare('SELECT COUNT(*) AS n FROM customer_notes WHERE user_id = ?1').bind(u.id).first()).n;
  if (have >= NOTES_PER_CUSTOMER) throw new HttpError(400, 'too_many_notes', `A customer can have at most ${NOTES_PER_CUSTOMER} notes. Delete an old one first.`);
  const id = uuid();
  await DB.prepare('INSERT INTO customer_notes (id, user_id, body, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, u.id, text, who.user.id, nowIso()).run();
  await audit(env, { actorId: who.user.id, action: 'user.note_add', target: `user:${u.id}`, detail: { noteId: id, length: text.length }, ip: clientIp(request) });
  const notes = (await DB.prepare(NOTES_SQL).bind(u.id).all()).results;
  return json({ notes: notes.map((n) => noteView(who, n)) }, 201);
}

export async function deleteNote(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'customers.notes');
  const DB = env.DB;
  const n = await DB.prepare('SELECT id, user_id, created_by FROM customer_notes WHERE id = ?1').bind(idParam(params.id, 'Note not found.')).first();
  if (!n) throw new HttpError(404, 'not_found', 'Note not found.');
  if (who.role !== 'owner' && n.created_by !== who.user.id) throw new HttpError(403, 'forbidden', 'Only the person who wrote a note, or a Super Admin, can delete it.');
  await DB.prepare('DELETE FROM customer_notes WHERE id = ?1').bind(n.id).run();
  await audit(env, { actorId: who.user.id, action: 'user.note_delete', target: `user:${n.user_id}`, detail: { noteId: n.id }, ip: clientIp(request) });
  const notes = (await DB.prepare(NOTES_SQL).bind(n.user_id).all()).results;
  return json({ notes: notes.map((x) => noteView(who, x)) });
}

export const ROUTES = {
  'GET /api/console/customers': getCustomers,
  'GET /api/console/customers/export.csv': exportCustomers,
};
export const PATTERNS = [
  ['GET', /^\/api\/console\/customers\/([\w-]{1,64})$/, ['id'], getCustomer],
  ['POST', /^\/api\/console\/customers\/([\w-]{1,64})\/status$/, ['id'], postStatus],
  ['POST', /^\/api\/console\/customers\/([\w-]{1,64})\/sign-out$/, ['id'], postSignOut],
  ['POST', /^\/api\/console\/customers\/([\w-]{1,64})\/notes$/, ['id'], postNote],
  ['DELETE', /^\/api\/console\/notes\/([\w-]{1,64})$/, ['id'], deleteNote],
];
