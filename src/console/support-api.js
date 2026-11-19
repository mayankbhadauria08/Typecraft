// Support inbox (docs/ADMIN-PHASE-4.md §2). Console-only endpoints: a console session is required.
//
//   GET  /api/console/support                 support.view    list: q, status, topic, who (me | none | <user id>), page
//   GET  /api/console/support/:id             support.view    one message: the thread (replies and notes), the customer, the team
//   POST /api/console/support/:id/reply       support.reply   email a reply to the sender { body, then: 'answered' | 'closed' }
//   POST /api/console/support/:id/note        support.manage  a note only staff see { body }
//   PUT  /api/console/support/:id             support.manage  { status?, assignedTo? (user id | null) }
//
// Messages arrive through the contact form (POST /api/contact, src/mail.js) into contact_messages.
// A reply goes out as the support_reply email with Reply-To set to the support address, so the
// customer's answer lands in the support inbox (Gmail). Replies and notes: support_replies (migration 0014).
import { HttpError, json, readJson, fieldError, clientIp, nowIso } from '../http.js';
import { uuid } from '../crypto.js';
import { hitLimit, emailEnabled } from '../session.js';
import { audit } from '../billing.js';
import { sendTemplate, getSetting } from '../mail.js';
import { requireAdmin, assertCan } from './session.js';
import { ROLE_LABELS } from './config.js';
import { can } from './permissions.js';
import { Binder, PAGE_SIZE, pageOf, offsetOf, paged, like, oneOf, idParam } from './lib.js';

export const STATUSES = ['new', 'answered', 'closed'];
export const TOPICS = { general: 'General question', institutes: 'Institutes', billing: 'Payments and plans', technical: 'Something not working',
  account: 'My account', feedback: 'Feedback', other: 'Other' };
const BODY_MAX = 5000;

/** Everyone who can be given a message: Super Admins (OWNER_EMAILS) and admin_users, active accounts only. */
export async function staffList(env) {
  const owners = [...new Set(String(env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
  const ownerRows = owners.length
    ? (await env.DB.prepare(`SELECT id, full_name, email FROM users WHERE account_status = 'active' AND email IN (${owners.map((_, i) => `?${i + 1}`).join(', ')})`)
      .bind(...owners).all()).results
    : [];
  const rows = (await env.DB.prepare(`SELECT u.id, u.full_name, u.email, a.role FROM admin_users a JOIN users u ON u.id = a.user_id
                                       WHERE u.account_status = 'active' ORDER BY u.full_name LIMIT 200`).all()).results;
  const seen = new Set();
  const out = [];
  for (const r of ownerRows) { seen.add(r.id); out.push({ id: r.id, name: r.full_name || r.email, role: ROLE_LABELS.owner || 'Super Admin' }); }
  for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); out.push({ id: r.id, name: r.full_name || r.email, role: ROLE_LABELS[r.role] || r.role }); }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function textOf(body, field, { min = 2, max = BODY_MAX } = {}) {
  const t = body && typeof body[field] === 'string' ? body[field].replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
  if (t.length < min) throw fieldError({ [field]: 'Write a little more.' });
  if (t.length > max) throw fieldError({ [field]: `Keep it under ${max.toLocaleString('en-IN')} characters.` });
  return t;
}

/* ---------- the list ---------- */
const FROM = `FROM contact_messages m LEFT JOIN support_assignments a ON a.message_id = m.id LEFT JOIN users x ON x.id = a.assigned_to`;

function whereOf(b, q, who) {
  const where = [];
  const term = (q.get('q') || '').trim().slice(0, 80);
  if (term) {
    const parts = [`m.email LIKE ${b.p(like(term.toLowerCase()))} ESCAPE '\\'`, `m.name LIKE ${b.p(like(term))} ESCAPE '\\'`, `m.message LIKE ${b.p(like(term))} ESCAPE '\\'`];
    if (/^msg_[\w-]{6,64}$/.test(term)) parts.push(`m.id = ${b.p(term)}`);
    where.push(`(${parts.join(' OR ')})`);
  }
  const status = oneOf(q.get('status'), [...STATUSES, 'open']);
  if (status === 'open') where.push("m.status <> 'closed'");
  else if (status) where.push(`m.status = ${b.p(status)}`);
  const topic = oneOf(q.get('topic'), Object.keys(TOPICS));
  if (topic) where.push(`m.topic = ${b.p(topic)}`);
  const assigned = q.get('who') || '';
  if (assigned === 'me') where.push(`a.assigned_to = ${b.p(who.user.id)}`);
  else if (assigned === 'none') where.push('a.assigned_to IS NULL');
  else if (/^[\w-]{6,64}$/.test(assigned)) where.push(`a.assigned_to = ${b.p(assigned)}`);
  return where.length ? 'WHERE ' + where.join(' AND ') : '';
}

export async function getSupport(request, env) {
  const who = await requireAdmin(env, request, 'support.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q), DB = env.DB;
  const list = new Binder(), count = new Binder();
  const listWhere = whereOf(list, q, who), countWhere = whereOf(count, q, who);
  const [rows, total, counts] = await DB.batch([
    DB.prepare(`SELECT m.id, m.user_id, m.name, m.email, m.topic, substr(m.message, 1, 160) AS snippet, m.priority, m.status, m.created_at,
                       a.assigned_to, x.full_name AS assignee,
                       (SELECT COUNT(*) FROM support_replies r WHERE r.message_id = m.id AND r.kind = 'reply') AS replies,
                       (SELECT MAX(r.created_at) FROM support_replies r WHERE r.message_id = m.id) AS last_activity
                  ${FROM} ${listWhere}
                 ORDER BY CASE m.status WHEN 'new' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, m.priority DESC, m.created_at DESC, m.id
                 LIMIT ${PAGE_SIZE} OFFSET ${offsetOf(page)}`).bind(...list.args),
    DB.prepare(`SELECT COUNT(*) AS n ${FROM} ${countWhere}`).bind(...count.args),
    DB.prepare("SELECT status, COUNT(*) AS n FROM contact_messages GROUP BY status"),
  ]);
  const items = rows.results.map((r) => ({
    id: r.id, name: r.name, email: r.email, topic: r.topic, topicLabel: TOPICS[r.topic] || r.topic, snippet: r.snippet, priority: !!r.priority,
    status: r.status, createdAt: r.created_at, lastActivity: r.last_activity || r.created_at, replies: r.replies,
    customerId: r.user_id || null, assignedTo: r.assigned_to ? { id: r.assigned_to, name: r.assignee || 'Staff' } : null,
  }));
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const c of counts.results) byStatus[c.status] = c.n;
  return json({ ...paged(items, page, total.results[0].n), counts: byStatus, topics: TOPICS, staff: await staffList(env) });
}

/* ---------- one message ---------- */
async function messageRow(env, id) {
  const row = await env.DB.prepare(`SELECT m.*, a.assigned_to, x.full_name AS assignee, u.full_name AS account_name, u.account_status
                                      FROM contact_messages m LEFT JOIN support_assignments a ON a.message_id = m.id
                                      LEFT JOIN users x ON x.id = a.assigned_to LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?1`)
    .bind(idParam(id, 'Message not found.')).first();
  if (!row) throw new HttpError(404, 'not_found', 'Message not found.');
  return row;
}

export async function getMessage(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'support.view');
  const DB = env.DB;
  const m = await messageRow(env, params.id);
  const [thread, history, others] = await DB.batch([
    DB.prepare(`SELECT r.id, r.kind, r.body, r.email_id, r.created_at, u.full_name AS author, e.status AS email_status
                  FROM support_replies r LEFT JOIN users u ON u.id = r.author_id LEFT JOIN email_logs e ON e.id = r.email_id
                 WHERE r.message_id = ?1 ORDER BY r.created_at, r.id`).bind(m.id),
    DB.prepare(`SELECT l.action, l.detail, l.created_at, u.full_name AS actor FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
                 WHERE l.target = ?1 AND l.action IN ('support.status', 'support.assign') ORDER BY l.created_at DESC LIMIT 20`).bind(`contact:${m.id}`),
    DB.prepare(`SELECT id, topic, status, created_at FROM contact_messages WHERE email = ?1 AND id <> ?2 ORDER BY created_at DESC LIMIT 10`).bind(m.email, m.id),
  ]);
  const [canReply, canManage] = await Promise.all([can(env, who.role, 'support.reply'), can(env, who.role, 'support.manage')]);
  return json({
    message: { id: m.id, name: m.name, email: m.email, topic: m.topic, topicLabel: TOPICS[m.topic] || m.topic, body: m.message, priority: !!m.priority,
      status: m.status, createdAt: m.created_at, assignedTo: m.assigned_to ? { id: m.assigned_to, name: m.assignee || 'Staff' } : null },
    customer: m.user_id ? { id: m.user_id, fullName: m.account_name || m.name, active: m.account_status === 'active' } : null,
    thread: thread.results.map((r) => ({ id: r.id, kind: r.kind, body: r.body, author: r.author || 'Staff', createdAt: r.created_at,
      email: r.kind === 'reply' ? (r.email_status || (r.email_id ? 'queued' : 'failed')) : null })),
    history: history.results.map((h) => {
      let d = {}; try { d = JSON.parse(h.detail || '{}'); } catch { d = {}; }
      return { action: h.action, actor: h.actor || 'Staff', createdAt: h.created_at, note: h.action === 'support.status' ? `Marked ${d.status}` : (d.toName ? `Given to ${d.toName}` : 'Unassigned') };
    }),
    earlier: others.results.map((o) => ({ id: o.id, topic: TOPICS[o.topic] || o.topic, status: o.status, createdAt: o.created_at })),
    staff: await staffList(env),
    emailOn: emailEnabled(env),
    can: { reply: canReply, manage: canManage },
  });
}

/* ---------- replying ---------- */
export async function postReply(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'support.reply');
  const body = await readJson(request, 32 * 1024);
  const m = await messageRow(env, params.id);
  const text = textOf(body, 'body', { min: 2 });
  const then = oneOf(body.then == null ? 'answered' : body.then, ['answered', 'closed'], null);
  if (!then) throw fieldError({ then: 'Choose what happens to the message after the reply.' });
  if (then === 'closed') await assertCan(env, who, 'support.manage');
  if (!emailEnabled(env)) throw new HttpError(503, 'email_not_configured', "Email sending isn't set up, so a reply can't be sent. Reply from the support inbox instead.");
  // a double click sends one reply; a person sends at most 60 replies an hour
  if (!(await hitLimit(env, `support-reply:${m.id}`, 1, 5))) throw new HttpError(429, 'rate_limited', 'A reply to this message was sent a moment ago. Look at the thread before sending another.');
  if (!(await hitLimit(env, `support-reply-by:${who.user.id}`, 60, 3600))) throw new HttpError(429, 'rate_limited', 'You have sent a lot of replies in the last hour. Wait a little and try again.');

  const support = await getSetting(env, 'support', { email: 'hello@typecrafttyping.com' });
  const sent = await sendTemplate(env, ctx, {
    to: m.email, userId: m.user_id || null, template: 'support_reply', category: 'support', replyTo: support.email || null,
    data: { name: m.name, body: text, staffName: String(who.user.fullName || '').trim().split(/\s+/)[0] || null, original: String(m.message).slice(0, 1500),
      subject: `Re: your message to TypeCraft (${(TOPICS[m.topic] || m.topic).toLowerCase()})` },
  });
  if (sent.status !== 'sent') throw new HttpError(502, 'email_failed', "The reply couldn't be sent just now. Nothing was saved; try again in a minute.");
  const now = nowIso(), id = `rep_${uuid()}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO support_replies (id, message_id, author_id, kind, body, email_id, created_at) VALUES (?1, ?2, ?3, 'reply', ?4, ?5, ?6)`)
      .bind(id, m.id, who.user.id, text, sent.id, now),
    env.DB.prepare('UPDATE contact_messages SET status = ?2 WHERE id = ?1').bind(m.id, then),
  ]);
  await audit(env, { actorId: who.user.id, action: 'support.reply', target: `contact:${m.id}`, detail: { chars: text.length, status: then }, ip: clientIp(request) });
  return json({ id, status: then, email: 'sent' }, 201);
}

export async function postNote(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'support.manage');
  const body = await readJson(request, 16 * 1024);
  const m = await messageRow(env, params.id);
  const text = textOf(body, 'body', { min: 2, max: 2000 });
  const id = `rep_${uuid()}`;
  await env.DB.prepare(`INSERT INTO support_replies (id, message_id, author_id, kind, body, created_at) VALUES (?1, ?2, ?3, 'note', ?4, ?5)`)
    .bind(id, m.id, who.user.id, text, nowIso()).run();
  await audit(env, { actorId: who.user.id, action: 'support.note', target: `contact:${m.id}`, detail: { chars: text.length }, ip: clientIp(request) });
  return json({ id }, 201);
}

/* ---------- status and who looks after it ---------- */
export async function putMessage(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'support.manage');
  const body = await readJson(request, 2048);
  const m = await messageRow(env, params.id);
  const out = { id: m.id };
  if (body.status !== undefined) {
    const status = oneOf(body.status, STATUSES, null);
    if (!status) throw fieldError({ status: 'Choose new, answered or closed.' });
    if (status !== m.status) {
      await env.DB.prepare('UPDATE contact_messages SET status = ?2 WHERE id = ?1').bind(m.id, status).run();
      await audit(env, { actorId: who.user.id, action: 'support.status', target: `contact:${m.id}`, detail: { status, before: m.status }, ip: clientIp(request) });
    }
    out.status = status;
  }
  if (body.assignedTo !== undefined) {
    const to = body.assignedTo === null || body.assignedTo === '' ? null : body.assignedTo;
    let toName = null;
    if (to !== null) {
      const staff = await staffList(env);
      const s = staff.find((x) => x.id === to);
      if (!s) throw fieldError({ assignedTo: 'Choose someone on the team.' });
      toName = s.name;
    }
    if ((m.assigned_to || null) !== to) {
      await env.DB.prepare(`INSERT INTO support_assignments (message_id, assigned_to, assigned_by, updated_at) VALUES (?1, ?2, ?3, ?4)
                            ON CONFLICT (message_id) DO UPDATE SET assigned_to = excluded.assigned_to, assigned_by = excluded.assigned_by, updated_at = excluded.updated_at`)
        .bind(m.id, to, who.user.id, nowIso()).run();
      await audit(env, { actorId: who.user.id, action: 'support.assign', target: `contact:${m.id}`, detail: { to, toName }, ip: clientIp(request) });
    }
    out.assignedTo = to ? { id: to, name: toName } : null;
  }
  if (Object.keys(out).length === 1) throw fieldError({ status: 'Nothing to change.' });
  return json(out);
}

export const ROUTES = {
  'GET /api/console/support': getSupport,
};
export const PATTERNS = [
  ['GET', /^\/api\/console\/support\/(msg_[\w-]{1,64})$/, ['id'], getMessage],
  ['PUT', /^\/api\/console\/support\/(msg_[\w-]{1,64})$/, ['id'], putMessage],
  ['POST', /^\/api\/console\/support\/(msg_[\w-]{1,64})\/reply$/, ['id'], postReply],
  ['POST', /^\/api\/console\/support\/(msg_[\w-]{1,64})\/note$/, ['id'], postNote],
];
