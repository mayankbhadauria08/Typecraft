// Institutes in the console (docs/INSTITUTES.md §7): TypeCraft staff set up an institute, invite its admin,
// record the money it pays, and change its seats and term.
//
//   GET  /api/console/institutes                         institutes.view      list: q, status, page
//   POST /api/console/institutes                         institutes.manage    create (starts 'pending'); { …fields, adminEmail? }
//   GET  /api/console/institutes/:id                     institutes.view      one: batches, staff, payments, history
//   PUT  /api/console/institutes/:id                     institutes.manage    name, city, contact, GSTIN, notes
//   POST /api/console/institutes/:id/term                institutes.manage    { seats, startDate, endDate, pricePaise, reason }
//   POST /api/console/institutes/:id/status              institutes.manage    { status: active | suspended | closed, reason }
//   POST /api/console/institutes/:id/payments            institutes.payments  record money received; switches a pending institute on
//   POST /api/console/institutes/:id/payments/:pid/remove institutes.payments  { reason } a payment recorded by mistake
//   POST /api/console/institutes/:id/staff               institutes.manage    { email, role } invite (sends the email)
//   POST /api/console/institutes/:id/staff/:sid/resend   institutes.manage    the invitation email again
//   POST /api/console/institutes/:id/staff/:sid/remove   institutes.manage    { reason }
//
// Money (price, payments) is shown to roles with institutes.payments or revenue.view only. Every change is
// in the activity log (target 'institute:<id>'). Seats only give a plan while the institute is active:
// recording a payment is what switches a new institute on (docs/INSTITUTES.md §3).
import { HttpError, json, readJson, fieldError, nowIso, clientIp, cleanEmail, cleanPhone } from '../http.js';
import { audit } from '../billing.js';
import { requireAdmin } from './session.js';
import { permissionsFor } from './permissions.js';
import { Binder, pageOf, offsetOf, paged, like, oneOf, parseJson, isDay, istDay, istDayStart, istDayEnd, reasonOf, PAGE_SIZE, DAY_MS } from './lib.js';
import { newId, isId, showJoinCode, ready } from '../institute-access.js';
import { inviteStaff, sendInvite, removeStaff } from '../institute-staff.js';

const STATUSES = ['pending', 'active', 'suspended', 'closed'];
const METHODS = ['bank_transfer', 'upi', 'cheque', 'cash', 'other'];
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const MAX_SEATS = 10000;
const MAX_TERM_DAYS = 3 * 366;
const NOT_FOUND = 'There is no institute with this ID.';

const moneyOk = (perms) => perms.includes('institutes.payments') || perms.includes('revenue.view');
const target = (id) => `institute:${id}`;
/** The last day of a term, in India, from the stored end (the moment the next day starts). */
const lastDay = (endsAt) => istDay(Date.parse(endsAt) - 1);

function instituteId(value) {
  if (!isId(value, 'ins')) throw new HttpError(404, 'not_found', NOT_FOUND);
  return value;
}
async function instituteRow(env, id) {
  const row = await env.DB.prepare('SELECT i.*, p.name AS package_name FROM institutes i JOIN packages p ON p.id = i.package_id WHERE i.id = ?1')
    .bind(instituteId(id)).first();
  if (!row) throw new HttpError(404, 'not_found', NOT_FOUND);
  return row;
}

/* ---------- input ---------- */
const text = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max + 1) : '');
/** The details any institute has; `partial` checks only the keys present. → { v, fields } */
function checkDetails(body, partial) {
  const v = {}, fields = {};
  const has = (k) => !partial || body[k] !== undefined;
  if (has('name')) {
    v.name = text(body.name, 120);
    if (v.name.length < 2) fields.name = "Enter the institute's name.";
    else if (v.name.length > 120) fields.name = 'Keep the name under 120 characters.';
  }
  if (has('city')) { v.city = text(body.city, 80); if (v.city.length > 80) fields.city = 'Keep the city under 80 characters.'; }
  if (has('contactName')) { v.contactName = text(body.contactName, 120); if (v.contactName.length > 120) fields.contactName = 'Keep the name under 120 characters.'; }
  if (has('contactEmail')) {
    const e = cleanEmail(body.contactEmail);
    if (e.error) fields.contactEmail = 'Enter a valid email address for invoices and reminders.'; else v.contactEmail = e.value;
  }
  if (has('contactPhone')) {
    const raw = text(body.contactPhone, 30);
    if (!raw) v.contactPhone = '';
    else { const ph = cleanPhone(raw); if (ph.error) fields.contactPhone = ph.error; else v.contactPhone = ph.value; }
  }
  if (has('gstin')) {
    v.gstin = text(body.gstin, 20).toUpperCase().replace(/\s+/g, '');
    if (v.gstin && !GSTIN_RE.test(v.gstin)) fields.gstin = 'A GSTIN has 15 characters, like 23ABCDE1234F1Z5. Leave it empty if they have none.';
  }
  if (has('notes')) {
    v.notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2001) : '';
    if (v.notes.length > 2000) fields.notes = 'Keep the notes under 2,000 characters.';
  }
  return { v, fields };
}
/** Seats, term and price. → { v: { seats, startsAt, endsAt, pricePaise }, fields } */
function checkTerm(body, { seatsUsed = 0 } = {}) {
  const v = {}, fields = {};
  const seats = Number(body.seats);
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) fields.seats = `Enter a whole number of seats from 1 to ${MAX_SEATS.toLocaleString('en-IN')}.`;
  else if (seats < seatsUsed) fields.seats = `${seatsUsed} students are using seats now. Keep at least ${seatsUsed}, or remove students first.`;
  else v.seats = seats;
  const price = Number(body.pricePaise);
  if (!Number.isInteger(price) || price < 0 || price > 10000000) fields.pricePaise = 'Enter the price per seat in rupees (0 for free), up to ₹1,00,000.';
  else v.pricePaise = price;
  if (!isDay(body.startDate)) fields.startDate = 'Choose the first day.';
  if (!isDay(body.endDate)) fields.endDate = 'Choose the last day.';
  if (!fields.startDate && !fields.endDate) {
    v.startsAt = istDayStart(body.startDate);
    v.endsAt = istDayEnd(body.endDate);
    const days = (Date.parse(v.endsAt) - Date.parse(v.startsAt)) / DAY_MS;
    if (days < 1) fields.endDate = 'The last day must be on or after the first day.';
    else if (days > MAX_TERM_DAYS) fields.endDate = 'A term can be at most three years. Renew it when it ends.';
  }
  return { v, fields };
}

/* ---------- views ---------- */
function listView(r, money) {
  return {
    id: r.id, name: r.name, city: r.city, status: r.status, packageName: r.package_name,
    seats: r.seats, seatsUsed: r.seats_used, startsAt: r.starts_at, endsAt: r.ends_at, lastDay: lastDay(r.ends_at),
    admin: r.admin_email || null, paidPaise: money ? r.paid : null, duePaise: money ? r.seats * r.price_paise : null, createdAt: r.created_at,
  };
}
function fullView(i, money, used) {
  return {
    id: i.id, name: i.name, city: i.city, status: i.status, packageId: i.package_id, packageName: i.package_name,
    contactName: i.contact_name, contactEmail: i.contact_email, contactPhone: i.contact_phone, gstin: i.gstin, notes: i.notes,
    seats: i.seats, seatsUsed: used, startsAt: i.starts_at, endsAt: i.ends_at, startDate: istDay(Date.parse(i.starts_at)), lastDay: lastDay(i.ends_at),
    pricePaise: money ? i.price_paise : null, createdAt: i.created_at, updatedAt: i.updated_at,
  };
}

/* ---------- GET /api/console/institutes ---------- */
function whereOf(b, q) {
  const parts = [];
  const status = oneOf(q.get('status'), STATUSES.concat(['ending']));
  const now = nowIso();
  if (status === 'ending') parts.push(`i.status = 'active' AND i.ends_at > ${b.once('now', now)} AND i.ends_at <= ${b.p(new Date(Date.now() + 30 * DAY_MS).toISOString())}`);
  else if (status) parts.push(`i.status = ${b.p(status)}`);
  const s = text(q.get('q'), 80);
  if (s) {
    const pat = b.p(like(s.toLowerCase()));
    parts.push(`(LOWER(i.name) LIKE ${pat} ESCAPE '\\' OR LOWER(i.city) LIKE ${pat} ESCAPE '\\' OR LOWER(i.contact_email) LIKE ${pat} ESCAPE '\\'
                 OR i.id = ${b.p(s)} OR EXISTS (SELECT 1 FROM institute_staff st WHERE st.institute_id = i.id AND st.status <> 'removed' AND st.email LIKE ${pat} ESCAPE '\\'))`);
  }
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}
export async function getInstitutes(request, env) {
  const who = await requireAdmin(env, request, 'institutes.view');
  const perms = await permissionsFor(env, who.role);
  return ready(async () => {
    const q = new URL(request.url).searchParams;
    const page = pageOf(q), DB = env.DB;
    const list = new Binder(), count = new Binder();
    const lw = whereOf(list, q), cw = whereOf(count, q);
    const [rows, total, packages] = await DB.batch([
      DB.prepare(`SELECT i.*, p.name AS package_name,
                         (SELECT COUNT(*) FROM institute_students s WHERE s.institute_id = i.id AND s.status = 'active') AS seats_used,
                         (SELECT COALESCE(SUM(amount_paise), 0) FROM institute_payments x WHERE x.institute_id = i.id) AS paid,
                         (SELECT st.email FROM institute_staff st WHERE st.institute_id = i.id AND st.role = 'admin' AND st.status <> 'removed'
                           ORDER BY st.status = 'active' DESC, st.invited_at LIMIT 1) AS admin_email
                    FROM institutes i JOIN packages p ON p.id = i.package_id ${lw}
                   ORDER BY i.status = 'closed', i.created_at DESC, i.id LIMIT ${PAGE_SIZE} OFFSET ${offsetOf(page)}`).bind(...list.args),
      DB.prepare(`SELECT COUNT(*) AS n FROM institutes i ${cw}`).bind(...count.args),
      DB.prepare("SELECT id, name, active FROM packages WHERE id <> 'free' ORDER BY display_order, name"),
    ]);
    return json({
      ...paged(rows.results.map((r) => listView(r, moneyOk(perms))), page, total.results[0].n),
      packages: packages.results.map((p) => ({ id: p.id, name: p.name, active: !!p.active })),
      money: moneyOk(perms), today: istDay(),
    });
  });
}

/* ---------- POST /api/console/institutes ---------- */
export async function postInstitute(request, env, ctx) {
  const who = await requireAdmin(env, request, 'institutes.manage');
  const body = await readJson(request);
  return ready(async () => {
    const DB = env.DB;
    const d = checkDetails(body, false), t = checkTerm(body);
    const fields = { ...d.fields, ...t.fields };
    const pkg = typeof body.packageId === 'string' && body.packageId !== 'free'
      ? await DB.prepare("SELECT id, name FROM packages WHERE id = ?1 AND id <> 'free'").bind(body.packageId).first() : null;
    if (!pkg) fields.packageId = 'Choose the plan a seat gives.';
    let admin = null;
    if (body.adminEmail != null && String(body.adminEmail).trim()) {
      const e = cleanEmail(body.adminEmail);
      if (e.error) fields.adminEmail = "Enter the admin's email, or leave it empty to invite them later."; else admin = e.value;
    }
    if (Object.keys(fields).length) throw fieldError(fields);
    const id = newId('ins'), now = nowIso();
    await DB.prepare(`INSERT INTO institutes (id, name, city, contact_name, contact_email, contact_phone, gstin, package_id, seats, price_paise, starts_at, ends_at,
                                             status, notes, created_by, created_at, updated_at)
                      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'pending', ?13, ?14, ?15, ?15)`)
      .bind(id, d.v.name, d.v.city, d.v.contactName, d.v.contactEmail, d.v.contactPhone, d.v.gstin, pkg.id, t.v.seats, t.v.pricePaise, t.v.startsAt, t.v.endsAt,
        d.v.notes, who.user.id, now).run();
    await audit(env, { actorId: who.user.id, action: 'institute.create', target: target(id),
      detail: { name: d.v.name, packageId: pkg.id, seats: t.v.seats, startsAt: t.v.startsAt, endsAt: t.v.endsAt, pricePaise: t.v.pricePaise }, ip: clientIp(request) });
    let invite = null;
    if (admin) {
      invite = await inviteStaff(env, ctx, { institute: { id, name: d.v.name }, email: admin, role: 'admin', invitedById: who.user.id, invitedBy: 'TypeCraft' });
      await audit(env, { actorId: who.user.id, action: 'institute.staff_invite', target: target(id), detail: { email: invite.email, role: 'admin', emailStatus: invite.emailStatus }, ip: clientIp(request) });
    }
    return json({ institute: { id }, invite }, 201);
  });
}

/* ---------- GET /api/console/institutes/:id ---------- */
export async function getInstitute(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'institutes.view');
  const perms = await permissionsFor(env, who.role);
  return ready(async () => {
    const i = await instituteRow(env, params.id);
    const DB = env.DB, money = moneyOk(perms);
    const [used, batches, staff, payments, history] = await DB.batch([
      DB.prepare("SELECT COUNT(*) AS n FROM institute_students WHERE institute_id = ?1 AND status = 'active'").bind(i.id),
      DB.prepare(`SELECT b.id, b.name, b.join_code, b.archived_at, b.created_at,
                         (SELECT COUNT(*) FROM institute_students s WHERE s.batch_id = b.id AND s.status = 'active') AS students,
                         (SELECT GROUP_CONCAT(COALESCE(u.full_name, st.email), ', ') FROM batch_teachers t JOIN institute_staff st ON st.id = t.staff_id
                            LEFT JOIN users u ON u.id = st.user_id WHERE t.batch_id = b.id AND st.status = 'active') AS teachers
                    FROM batches b WHERE b.institute_id = ?1 ORDER BY b.archived_at IS NOT NULL, b.name`).bind(i.id),
      DB.prepare(`SELECT st.id, st.email, st.role, st.status, st.invited_at, st.joined_at, st.removed_at, u.full_name
                    FROM institute_staff st LEFT JOIN users u ON u.id = st.user_id WHERE st.institute_id = ?1
                   ORDER BY st.status = 'removed', st.role, st.invited_at`).bind(i.id),
      DB.prepare(`SELECT x.*, u.full_name AS recorder FROM institute_payments x LEFT JOIN users u ON u.id = x.recorded_by
                   WHERE x.institute_id = ?1 ORDER BY x.paid_on DESC, x.created_at DESC`).bind(i.id),
      perms.includes('audit.view')
        ? DB.prepare(`SELECT a.action, a.detail, a.created_at, x.full_name AS actor FROM audit_logs a LEFT JOIN users x ON x.id = a.actor_id
                       WHERE a.target = ?1 ORDER BY a.created_at DESC, a.rowid DESC LIMIT 50`).bind(target(i.id))
        : DB.prepare('SELECT 1 WHERE 0'),
    ]);
    const paid = payments.results.reduce((s, p) => s + p.amount_paise, 0);
    return json({
      institute: fullView(i, money, used.results[0].n),
      money: money ? { pricePaise: i.price_paise, duePaise: i.seats * i.price_paise, paidPaise: paid } : null,
      batches: batches.results.map((b) => ({ id: b.id, name: b.name, students: b.students, joinCode: b.archived_at ? null : showJoinCode(b.join_code),
        archived: !!b.archived_at, teachers: b.teachers || '', createdAt: b.created_at })),
      staff: staff.results.map((s) => ({ id: s.id, email: s.email, name: s.full_name || null, role: s.role, status: s.status,
        invitedAt: s.invited_at, joinedAt: s.joined_at, removedAt: s.removed_at })),
      payments: money ? payments.results.map((p) => ({ id: p.id, amountPaise: p.amount_paise, method: p.method, reference: p.reference, paidOn: p.paid_on,
        note: p.note, recordedBy: p.recorder || 'Unknown', createdAt: p.created_at })) : null,
      history: perms.includes('audit.view') ? history.results.map((a) => {
        const d = parseJson(a.detail, {});
        return { action: a.action, reason: d.reason || null, note: historyNote(a.action, d, money), actor: a.actor || 'System', createdAt: a.created_at };
      }) : null,
      can: { manage: perms.includes('institutes.manage'), payments: perms.includes('institutes.payments') },
      today: istDay(),
    });
  });
}
const STATUS_WORDS = { pending: 'Not paid yet', active: 'On', suspended: 'Paused', closed: 'Closed' };
const rupees = (p) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
function historyNote(action, d, money) {
  if (action === 'institute.term') {
    const parts = [];
    if (d.seats) parts.push(`seats ${d.seats.from} → ${d.seats.to}`);
    if (d.endsAt) parts.push(`last day ${lastDay(d.endsAt.from)} → ${lastDay(d.endsAt.to)}`);
    if (d.startsAt) parts.push(`first day ${istDay(Date.parse(d.startsAt.from))} → ${istDay(Date.parse(d.startsAt.to))}`);
    if (d.pricePaise && money) parts.push(`price ${rupees(d.pricePaise.from)} → ${rupees(d.pricePaise.to)} a seat`);
    return parts.join(', ') || null;
  }
  if (action === 'institute.status') return d.from && d.to ? `${STATUS_WORDS[d.from] || d.from} → ${STATUS_WORDS[d.to] || d.to}` : null;
  if ((action === 'institute.payment' || action === 'institute.payment_remove') && money && d.amountPaise) return `${rupees(d.amountPaise)}${d.reference ? ` · ${d.reference}` : ''}`;
  if (action === 'institute.staff_invite' || action === 'institute.staff_resend' || action === 'institute.staff_remove') return [d.email, d.role].filter(Boolean).join(' · ') || null;
  if (action === 'institute.update' && Array.isArray(d.changed)) return `changed ${d.changed.join(', ')}`;
  if (action === 'institute.staff_accept' || action === 'institute.staff_decline') return [d.email, d.role].filter(Boolean).join(' · ') || null;
  if (action === 'institute.batch_create' || action === 'institute.batch_code') return d.name || null;
  if (action === 'institute.batch_update') return [d.name, Array.isArray(d.changed) ? d.changed.join(', ') : null, d.freed ? `${d.freed} seats freed` : null].filter(Boolean).join(' · ') || null;
  if (action === 'institute.student_remove') return [d.student, d.batch].filter(Boolean).join(' · ') || null;
  if (action === 'institute.student_move') return d.student ? `${d.student}: ${d.from} → ${d.to}` : null;
  if (action === 'institute.create') return d.seats ? `${d.seats} seats` : null;
  return null;
}

/* ---------- PUT /api/console/institutes/:id ---------- */
const COLUMN = { name: 'name', city: 'city', contactName: 'contact_name', contactEmail: 'contact_email', contactPhone: 'contact_phone', gstin: 'gstin', notes: 'notes' };
export async function putInstitute(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'institutes.manage');
  const body = await readJson(request);
  return ready(async () => {
    const i = await instituteRow(env, params.id);
    const { v, fields } = checkDetails(body, true);
    if (Object.keys(fields).length) throw fieldError(fields);
    const changed = Object.keys(v).filter((k) => v[k] !== i[COLUMN[k]]);
    if (!changed.length) return json({ changed });
    const sets = changed.map((k, n) => `${COLUMN[k]} = ?${n + 2}`).join(', ');
    await env.DB.prepare(`UPDATE institutes SET ${sets}, updated_at = ?${changed.length + 2} WHERE id = ?1`).bind(i.id, ...changed.map((k) => v[k]), nowIso()).run();
    await audit(env, { actorId: who.user.id, action: 'institute.update', target: target(i.id), detail: { changed }, ip: clientIp(request) });
    return json({ changed });
  });
}

/* ---------- POST /api/console/institutes/:id/term ---------- */
export async function postTerm(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'institutes.manage');
  const body = await readJson(request);
  const perms = await permissionsFor(env, who.role);
  return ready(async () => {
    const i = await instituteRow(env, params.id);
    if (i.status === 'closed') throw new HttpError(409, 'closed', 'This institute is closed. Its seats and term can no longer change.');
    // a role that doesn't see money keeps the price as it is
    if (!moneyOk(perms) || body.pricePaise === undefined) body.pricePaise = i.price_paise;
    const used = (await env.DB.prepare("SELECT COUNT(*) AS n FROM institute_students WHERE institute_id = ?1 AND status = 'active'").bind(i.id).first()).n;
    const t = checkTerm(body, { seatsUsed: used });
    let reason = null;
    try { reason = reasonOf(body); } catch (err) { t.fields.reason = err.fields.reason; }
    if (Object.keys(t.fields).length) throw fieldError(t.fields);
    const cur = { seats: i.seats, startsAt: i.starts_at, endsAt: i.ends_at, pricePaise: i.price_paise };
    const changed = Object.keys(cur).filter((k) => cur[k] !== t.v[k]);
    if (!changed.length) return json({ changed });
    await env.DB.prepare('UPDATE institutes SET seats = ?2, starts_at = ?3, ends_at = ?4, price_paise = ?5, updated_at = ?6 WHERE id = ?1')
      .bind(i.id, t.v.seats, t.v.startsAt, t.v.endsAt, t.v.pricePaise, nowIso()).run();
    await audit(env, { actorId: who.user.id, action: 'institute.term', target: target(i.id),
      detail: { reason, changed, ...Object.fromEntries(changed.map((k) => [k, { from: cur[k], to: t.v[k] }])) }, ip: clientIp(request) });
    return json({ changed });
  });
}

/* ---------- POST /api/console/institutes/:id/status ---------- */
const MOVES = { pending: ['active', 'closed'], active: ['suspended', 'closed'], suspended: ['active', 'closed'], closed: [] };
export async function postStatus(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'institutes.manage');
  const body = await readJson(request);
  return ready(async () => {
    const i = await instituteRow(env, params.id);
    const to = oneOf(body.status, STATUSES.filter((s) => s !== 'pending'));
    if (!to) throw fieldError({ status: 'Choose on, paused or closed.' });
    const reason = reasonOf(body);
    if (to === i.status) return json({ status: i.status, changed: false });
    if (!MOVES[i.status].includes(to)) {
      throw new HttpError(409, 'bad_status', i.status === 'closed' ? 'A closed institute stays closed. Set up a new one instead.' : `An institute can't go from ${i.status} to ${to}.`);
    }
    const r = await env.DB.prepare('UPDATE institutes SET status = ?3, updated_at = ?4 WHERE id = ?1 AND status = ?2').bind(i.id, i.status, to, nowIso()).run();
    if (!r.meta || r.meta.changes !== 1) throw new HttpError(409, 'changed', 'Someone else changed this institute just now. Reload the page.');
    await audit(env, { actorId: who.user.id, action: 'institute.status', target: target(i.id), detail: { from: i.status, to, reason }, ip: clientIp(request) });
    return json({ status: to, changed: true });
  });
}

/* ---------- payments ---------- */
export async function postPayment(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'institutes.payments');
  const body = await readJson(request);
  return ready(async () => {
    const i = await instituteRow(env, params.id);
    if (i.status === 'closed') throw new HttpError(409, 'closed', 'This institute is closed. Record money for it outside TypeCraft.');
    const fields = {};
    const amount = Number(body.amountPaise);
    if (!Number.isInteger(amount) || amount < 100 || amount > 1000000000) fields.amountPaise = 'Enter the amount received in rupees, at least ₹1.';
    const method = oneOf(body.method, METHODS);
    if (!method) fields.method = 'Choose how they paid.';
    const reference = text(body.reference, 80);
    if (reference.length > 80) fields.reference = 'Keep the reference under 80 characters.';
    if (method && method !== 'cash' && !reference) fields.reference = 'Enter the UTR, UPI reference or cheque number, so the payment can be found in the bank statement.';
    const today = istDay();
    if (!isDay(body.paidOn)) fields.paidOn = 'Choose the day the money arrived.';
    else if (body.paidOn > today) fields.paidOn = "That day hasn't come yet.";
    else if (body.paidOn < '2024-01-01') fields.paidOn = 'Choose a day from 2024 on.';
    const note = text(body.note, 300);
    if (note.length > 300) fields.note = 'Keep the note under 300 characters.';
    if (Object.keys(fields).length) throw fieldError(fields);
    const id = newId('ipay'), now = nowIso();
    const DB = env.DB;
    // a new institute is switched on by its first payment; a paused one stays paused until someone switches it on
    const [, on] = await DB.batch([
      DB.prepare(`INSERT INTO institute_payments (id, institute_id, amount_paise, method, reference, paid_on, note, recorded_by, created_at)
                  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`).bind(id, i.id, amount, method, reference, body.paidOn, note, who.user.id, now),
      DB.prepare("UPDATE institutes SET status = 'active', updated_at = ?2 WHERE id = ?1 AND status = 'pending'").bind(i.id, now),
    ]);
    const switchedOn = !!(on.meta && on.meta.changes === 1);
    await audit(env, { actorId: who.user.id, action: 'institute.payment', target: target(i.id),
      detail: { paymentId: id, amountPaise: amount, method, reference, paidOn: body.paidOn, switchedOn }, ip: clientIp(request) });
    if (switchedOn) {
      await audit(env, { actorId: who.user.id, action: 'institute.status', target: target(i.id), detail: { from: 'pending', to: 'active', reason: 'First payment recorded.' }, ip: clientIp(request) });
    }
    return json({ payment: { id }, switchedOn }, 201);
  });
}
export async function postPaymentRemove(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'institutes.payments');
  const body = await readJson(request);
  return ready(async () => {
    const i = await instituteRow(env, params.id);
    if (!isId(params.pid, 'ipay')) throw new HttpError(404, 'not_found', 'There is no payment with this ID.');
    const reason = reasonOf(body);
    const p = await env.DB.prepare('SELECT * FROM institute_payments WHERE id = ?1 AND institute_id = ?2').bind(params.pid, i.id).first();
    if (!p) throw new HttpError(404, 'not_found', 'There is no payment with this ID.');
    await env.DB.prepare('DELETE FROM institute_payments WHERE id = ?1').bind(p.id).run();
    // the activity log keeps everything the row said
    await audit(env, { actorId: who.user.id, action: 'institute.payment_remove', target: target(i.id),
      detail: { reason, paymentId: p.id, amountPaise: p.amount_paise, method: p.method, reference: p.reference, paidOn: p.paid_on, note: p.note, recordedBy: p.recorded_by }, ip: clientIp(request) });
    return json({ removed: true });
  });
}

/* ---------- staff ---------- */
export async function postStaff(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'institutes.manage');
  const body = await readJson(request);
  return ready(async () => {
    const i = await instituteRow(env, params.id);
    if (i.status === 'closed') throw new HttpError(409, 'closed', 'This institute is closed.');
    const invite = await inviteStaff(env, ctx, { institute: i, email: body.email, role: body.role || 'admin', invitedById: who.user.id, invitedBy: 'TypeCraft' });
    await audit(env, { actorId: who.user.id, action: 'institute.staff_invite', target: target(i.id), detail: { email: invite.email, role: invite.role, emailStatus: invite.emailStatus }, ip: clientIp(request) });
    return json({ invite }, 201);
  });
}
async function staffRow(env, i, sid) {
  if (!isId(sid, 'stf')) throw new HttpError(404, 'not_found', 'This person is not part of this institute.');
  const s = await env.DB.prepare('SELECT * FROM institute_staff WHERE id = ?1 AND institute_id = ?2').bind(sid, i.id).first();
  if (!s) throw new HttpError(404, 'not_found', 'This person is not part of this institute.');
  return s;
}
export async function postStaffResend(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'institutes.manage');
  return ready(async () => {
    const i = await instituteRow(env, params.id);
    const s = await staffRow(env, i, params.sid);
    if (s.status !== 'invited') throw new HttpError(409, 'not_invited', s.status === 'active' ? 'They have already accepted.' : 'This invitation was withdrawn.');
    const emailStatus = await sendInvite(env, ctx, { email: s.email, role: s.role, instituteName: i.name, invitedBy: 'TypeCraft' });
    await audit(env, { actorId: who.user.id, action: 'institute.staff_resend', target: target(i.id), detail: { email: s.email, role: s.role, emailStatus }, ip: clientIp(request) });
    return json({ emailStatus });
  });
}
export async function postStaffRemove(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'institutes.manage');
  const body = await readJson(request);
  return ready(async () => {
    const i = await instituteRow(env, params.id);
    const s = await staffRow(env, i, params.sid);
    const reason = reasonOf(body);
    if (!(await removeStaff(env, { instituteId: i.id, staffId: s.id, removedById: who.user.id }))) throw new HttpError(409, 'already_removed', 'They were already removed.');
    await audit(env, { actorId: who.user.id, action: 'institute.staff_remove', target: target(i.id), detail: { email: s.email, role: s.role, reason }, ip: clientIp(request) });
    return json({ removed: true });
  });
}

const ID = '([a-z]{3,4}_[0-9a-f]{20})';
const P = (method, tail, names, fn) => [method, new RegExp(`^/api/console/institutes/${ID}${tail}$`), ['id', ...names], fn];
export const ROUTES = {
  'GET /api/console/institutes': getInstitutes,
  'POST /api/console/institutes': postInstitute,
};
export const PATTERNS = [
  P('GET', '', [], getInstitute),
  P('PUT', '', [], putInstitute),
  P('POST', '/term', [], postTerm),
  P('POST', '/status', [], postStatus),
  P('POST', '/payments', [], postPayment),
  P('POST', `/payments/${ID}/remove`, ['pid'], postPaymentRemove),
  P('POST', '/staff', [], postStaff),
  P('POST', `/staff/${ID}/resend`, ['sid'], postStaffResend),
  P('POST', `/staff/${ID}/remove`, ['sid'], postStaffRemove),
];
