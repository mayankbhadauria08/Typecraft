// The institute's own pages: its admin and teachers run their batches (docs/INSTITUTES.md §8).
//
//   POST /api/me/institute-invites/:sid/accept                  signed in   accept an invitation to my verified email
//   POST /api/me/institute-invites/:sid/decline                 signed in
//   GET  /api/institutes/:id/staff                              admin       the institute's admin and teachers
//   POST /api/institutes/:id/staff                              admin       { email, role } invite (sends the email)
//   POST /api/institutes/:id/staff/:sid/resend                  admin
//   POST /api/institutes/:id/staff/:sid/remove                  admin       never the last admin
//   POST /api/institutes/:id/batches                            admin       { name, teacherIds? } a batch with a new join code
//   PUT  /api/institutes/:id/batches/:bid                       admin       { name?, teacherIds?, joining?: 'on'|'off', archived?, removeStudents? }
//   POST /api/institutes/:id/batches/:bid/code                  admin       a new join code (the old one stops working)
//   GET  /api/institutes/:id/batches/:bid/students              staff       the batch's students (admins; the batch's teachers)
//   POST /api/institutes/:id/students/:mid/remove               admin       end a seat (frees it)
//   POST /api/institutes/:id/students/:mid/move                 admin       { batchId } to another batch of the institute
//
// Every request is checked on the server by requireStaff / requireBatch (src/institute-access.js).
// Changes go to the activity log with the institute as target, so TypeCraft staff see them in the console.
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from './http.js';
import { requireSession } from './session.js';
import { audit } from './billing.js';
import { newId, isId, newJoinCode, showJoinCode, ready, requireStaff, requireBatch } from './institute-access.js';
import { inviteStaff, sendInvite, removeStaff } from './institute-staff.js';

const target = (id) => `institute:${id}`;
const log = (env, request, user, instituteId, action, detail) =>
  audit(env, { actorId: user.id, action, target: target(instituteId), detail: { ...detail, by: 'institute' }, ip: clientIp(request) });
const IST_MS = 330 * 60000;
const istDay = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const NOT_OPEN = { closed: 'This institute is closed.' };
function assertOpen(institute) {
  if (NOT_OPEN[institute.status]) throw new HttpError(409, 'closed', NOT_OPEN[institute.status]);
}

/* ---------------- invitations ---------------- */
async function inviteRow(env, user, sid) {
  if (!isId(sid, 'stf')) throw new HttpError(404, 'not_found', 'There is no invitation here for you.');
  const row = await env.DB.prepare(
    `SELECT st.*, i.name AS institute_name, i.status AS institute_status FROM institute_staff st JOIN institutes i ON i.id = st.institute_id
      WHERE st.id = ?1 AND st.email = ?2 AND st.status = 'invited' AND i.status <> 'closed'`
  ).bind(sid, user.email).first();
  if (!row) throw new HttpError(404, 'not_found', 'There is no invitation here for you. It may have been withdrawn, or sent to another email address.');
  return row;
}
export async function postAccept(request, env, ctx, params) {
  const { user } = await requireSession(env, request);
  return ready(async () => {
    const row = await inviteRow(env, user, params.sid);
    // the invitation went to an email address: only the account that proved it owns that address can take it
    if (!user.emailVerified) throw new HttpError(403, 'verify_email', 'Confirm your email address first: open the link we emailed you when you signed up, or send it again from Settings.');
    const r = await env.DB.prepare("UPDATE institute_staff SET user_id = ?2, status = 'active', joined_at = ?3 WHERE id = ?1 AND status = 'invited'")
      .bind(row.id, user.id, nowIso()).run();
    if (!r.meta || r.meta.changes !== 1) throw new HttpError(404, 'not_found', 'This invitation was already answered.');
    await log(env, request, user, row.institute_id, 'institute.staff_accept', { email: row.email, role: row.role });
    return json({ institute: { id: row.institute_id, name: row.institute_name }, role: row.role });
  });
}
export async function postDecline(request, env, ctx, params) {
  const { user } = await requireSession(env, request);
  return ready(async () => {
    const row = await inviteRow(env, user, params.sid);
    await env.DB.prepare("UPDATE institute_staff SET status = 'removed', removed_by = ?2, removed_at = ?3 WHERE id = ?1 AND status = 'invited'")
      .bind(row.id, user.id, nowIso()).run();
    await log(env, request, user, row.institute_id, 'institute.staff_decline', { email: row.email, role: row.role });
    return json({ declined: true });
  });
}

/* ---------------- staff ---------------- */
export async function getStaff(request, env, ctx, params) {
  const { institute, staff } = await requireStaff(env, request, params.id, { admin: true });
  const rows = (await env.DB.prepare(
    `SELECT st.id, st.email, st.role, st.status, st.invited_at, st.joined_at, u.full_name,
            (SELECT COUNT(*) FROM batch_teachers t WHERE t.staff_id = st.id) AS batches
       FROM institute_staff st LEFT JOIN users u ON u.id = st.user_id
      WHERE st.institute_id = ?1 AND st.status <> 'removed' ORDER BY st.role, st.status DESC, COALESCE(u.full_name, st.email)`
  ).bind(institute.id).all()).results;
  return json({ me: staff.id, staff: rows.map((s) => ({ id: s.id, email: s.email, name: s.full_name || null, role: s.role, status: s.status,
    invitedAt: s.invited_at, joinedAt: s.joined_at, batches: s.batches })) });
}
export async function postStaff(request, env, ctx, params) {
  const { user, institute } = await requireStaff(env, request, params.id, { admin: true });
  assertOpen(institute);
  const body = await readJson(request);
  const invite = await inviteStaff(env, ctx, { institute, email: body.email, role: body.role === 'admin' ? 'admin' : 'teacher', invitedById: user.id, invitedBy: user.fullName || institute.name });
  await log(env, request, user, institute.id, 'institute.staff_invite', { email: invite.email, role: invite.role, emailStatus: invite.emailStatus });
  return json({ invite }, 201);
}
async function staffOf(env, institute, sid) {
  if (!isId(sid, 'stf')) throw new HttpError(404, 'not_found', 'This person is not part of your institute.');
  const s = await env.DB.prepare("SELECT * FROM institute_staff WHERE id = ?1 AND institute_id = ?2 AND status <> 'removed'").bind(sid, institute.id).first();
  if (!s) throw new HttpError(404, 'not_found', 'This person is not part of your institute.');
  return s;
}
export async function postStaffResend(request, env, ctx, params) {
  const { user, institute } = await requireStaff(env, request, params.id, { admin: true });
  const s = await staffOf(env, institute, params.sid);
  if (s.status !== 'invited') throw new HttpError(409, 'not_invited', 'They have already accepted.');
  const emailStatus = await sendInvite(env, ctx, { email: s.email, role: s.role, instituteName: institute.name, invitedBy: user.fullName || institute.name });
  await log(env, request, user, institute.id, 'institute.staff_resend', { email: s.email, role: s.role, emailStatus });
  return json({ emailStatus });
}
export async function postStaffRemove(request, env, ctx, params) {
  const { user, institute } = await requireStaff(env, request, params.id, { admin: true });
  const s = await staffOf(env, institute, params.sid);
  if (s.role === 'admin' && s.status === 'active') {
    const admins = (await env.DB.prepare("SELECT COUNT(*) AS n FROM institute_staff WHERE institute_id = ?1 AND role = 'admin' AND status = 'active'").bind(institute.id).first()).n;
    if (admins <= 1) throw new HttpError(409, 'last_admin', 'An institute needs an admin. Invite another admin first, or ask TypeCraft.');
  }
  await removeStaff(env, { instituteId: institute.id, staffId: s.id, removedById: user.id });
  await log(env, request, user, institute.id, 'institute.staff_remove', { email: s.email, role: s.role });
  return json({ removed: true, self: s.user_id === user.id });
}

/* ---------------- batches ---------------- */
function batchName(value, fields) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2) fields.name = 'Give the batch a name, like "Morning SSC batch".';
  else if (name.length > 60) fields.name = 'Keep the name under 60 characters.';
  return name;
}
async function nameTaken(env, instituteId, name, exceptId = null) {
  return !!(await env.DB.prepare('SELECT 1 FROM batches WHERE institute_id = ?1 AND LOWER(name) = LOWER(?2) AND archived_at IS NULL AND id <> ?3')
    .bind(instituteId, name, exceptId || '').first());
}
/** Teachers to put on a batch: active teachers or admins of this institute. → staff ids, or throws. */
async function teachersOf(env, institute, ids) {
  if (ids == null) return null;
  if (!Array.isArray(ids) || ids.length > 50 || !ids.every((x) => isId(x, 'stf'))) throw fieldError({ teacherIds: 'Choose teachers from the list.' });
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = (await env.DB.prepare(`SELECT id FROM institute_staff WHERE institute_id = ?1 AND status = 'active' AND id IN (${unique.map((_, i) => `?${i + 2}`).join(', ')})`)
    .bind(institute.id, ...unique).all()).results;
  if (rows.length !== unique.length) throw fieldError({ teacherIds: 'Someone you chose is no longer part of the institute.' });
  return unique;
}
/** A fresh join code that no batch uses yet. */
async function freshCode(env) {
  for (let i = 0; i < 8; i++) {
    const code = newJoinCode();
    if (!(await env.DB.prepare('SELECT 1 FROM batches WHERE join_code = ?1').bind(code).first())) return code;
  }
  throw new HttpError(503, 'busy', 'Could not make a new code just now. Try again.');
}
const teacherStatements = (env, batchId, teacherIds, userId, now) => [
  env.DB.prepare('DELETE FROM batch_teachers WHERE batch_id = ?1').bind(batchId),
  ...teacherIds.map((sid) => env.DB.prepare('INSERT INTO batch_teachers (batch_id, staff_id, assigned_by, assigned_at) VALUES (?1, ?2, ?3, ?4)').bind(batchId, sid, userId, now)),
];

export async function postBatch(request, env, ctx, params) {
  const { user, institute } = await requireStaff(env, request, params.id, { admin: true });
  assertOpen(institute);
  const body = await readJson(request);
  const fields = {};
  const name = batchName(body.name, fields);
  if (Object.keys(fields).length) throw fieldError(fields);
  if (await nameTaken(env, institute.id, name)) throw fieldError({ name: 'Another batch already has this name.' });
  const teacherIds = (await teachersOf(env, institute, body.teacherIds)) || [];
  const id = newId('bat'), now = nowIso(), code = await freshCode(env);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO batches (id, institute_id, name, join_code, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)')
      .bind(id, institute.id, name, code, user.id, now),
    ...teacherStatements(env, id, teacherIds, user.id, now),
  ]);
  await log(env, request, user, institute.id, 'institute.batch_create', { batchId: id, name, teachers: teacherIds.length });
  return json({ batch: { id, name, joinCode: showJoinCode(code) } }, 201);
}

export async function putBatch(request, env, ctx, params) {
  const { user, institute, batch } = await requireBatch(env, request, params.id, params.bid, { admin: true });
  assertOpen(institute);
  const body = await readJson(request);
  const fields = {}, now = nowIso(), stmts = [], changed = [];
  const DB = env.DB;
  if (body.name !== undefined) {
    const name = batchName(body.name, fields);
    if (!fields.name && name !== batch.name) {
      if (await nameTaken(env, institute.id, name, batch.id)) fields.name = 'Another batch already has this name.';
      else { stmts.push(DB.prepare('UPDATE batches SET name = ?2, updated_at = ?3 WHERE id = ?1').bind(batch.id, name, now)); changed.push('name'); }
    }
  }
  const teacherIds = await teachersOf(env, institute, body.teacherIds);
  if (Object.keys(fields).length) throw fieldError(fields);
  if (teacherIds) { stmts.push(...teacherStatements(env, batch.id, teacherIds, user.id, now)); changed.push('teachers'); }
  if (body.joining === 'off' && batch.join_code) { stmts.push(DB.prepare('UPDATE batches SET join_code = NULL, updated_at = ?2 WHERE id = ?1').bind(batch.id, now)); changed.push('joining'); }
  if (body.joining === 'on' && !batch.join_code && !batch.archived_at) {
    stmts.push(DB.prepare('UPDATE batches SET join_code = ?2, updated_at = ?3 WHERE id = ?1').bind(batch.id, await freshCode(env), now)); changed.push('joining');
  }
  let freed = 0;
  if (body.archived === true && !batch.archived_at) {
    const active = (await DB.prepare("SELECT COUNT(*) AS n FROM institute_students WHERE batch_id = ?1 AND status = 'active'").bind(batch.id).first()).n;
    if (active && body.removeStudents !== true) {
      throw new HttpError(409, 'has_students', `${active} student${active === 1 ? ' is' : 's are'} in this batch. Archive it and free their seats, or move them first.`);
    }
    if (active) {
      stmts.push(DB.prepare("UPDATE institute_students SET status = 'removed', ended_at = ?2, ended_by = ?3 WHERE batch_id = ?1 AND status = 'active'").bind(batch.id, now, user.id));
      freed = active;
    }
    // an archived batch can't be joined: its code goes
    stmts.push(DB.prepare('UPDATE batches SET archived_at = ?2, join_code = NULL, updated_at = ?2 WHERE id = ?1').bind(batch.id, now));
    changed.push('archived');
  } else if (body.archived === false && batch.archived_at) {
    stmts.push(DB.prepare('UPDATE batches SET archived_at = NULL, updated_at = ?2 WHERE id = ?1').bind(batch.id, now));
    changed.push('archived');
  }
  if (!stmts.length) return json({ changed: [] });
  await DB.batch(stmts);
  await log(env, request, user, institute.id, 'institute.batch_update', { batchId: batch.id, name: batch.name, changed, freed });
  return json({ changed, freed });
}

export async function postBatchCode(request, env, ctx, params) {
  const { user, institute, batch } = await requireBatch(env, request, params.id, params.bid, { admin: true });
  assertOpen(institute);
  if (batch.archived_at) throw new HttpError(409, 'archived', 'This batch is archived. Bring it back first.');
  const code = await freshCode(env);
  await env.DB.prepare('UPDATE batches SET join_code = ?2, updated_at = ?3 WHERE id = ?1').bind(batch.id, code, nowIso()).run();
  await log(env, request, user, institute.id, 'institute.batch_code', { batchId: batch.id, name: batch.name });
  return json({ joinCode: showJoinCode(code) });
}

/* ---------------- students ---------------- */
export async function getStudents(request, env, ctx, params) {
  const { staff, batch } = await requireBatch(env, request, params.id, params.bid);
  const since = istDay(Date.now() - 6 * 86400000);
  const rows = (await env.DB.prepare(
    `SELECT s.id, s.joined_at, u.id AS user_id, u.full_name, u.email,
            (SELECT MAX(day) FROM daily_totals d WHERE d.user_id = s.user_id AND d.seconds > 0) AS last_day
       FROM institute_students s JOIN users u ON u.id = s.user_id
      WHERE s.batch_id = ?1 AND s.status = 'active' ORDER BY u.full_name, u.email`
  ).bind(batch.id).all()).results;
  return json({
    role: staff.role, since,
    students: rows.map((r) => ({ id: r.id, name: r.full_name || null, email: r.email, joinedAt: r.joined_at, lastDay: r.last_day || null,
      activeThisWeek: !!(r.last_day && r.last_day >= since) })),
  });
}
async function seatOf(env, institute, mid) {
  if (!isId(mid, 'mem')) throw new HttpError(404, 'not_found', 'This student is not in your institute.');
  const s = await env.DB.prepare(
    `SELECT s.*, u.full_name, u.email, b.name AS batch_name FROM institute_students s JOIN users u ON u.id = s.user_id JOIN batches b ON b.id = s.batch_id
      WHERE s.id = ?1 AND s.institute_id = ?2 AND s.status = 'active'`
  ).bind(mid, institute.id).first();
  if (!s) throw new HttpError(404, 'not_found', 'This student is not in your institute.');
  return s;
}
export async function postStudentRemove(request, env, ctx, params) {
  const { user, institute } = await requireStaff(env, request, params.id, { admin: true });
  const s = await seatOf(env, institute, params.mid);
  await env.DB.prepare("UPDATE institute_students SET status = 'removed', ended_at = ?2, ended_by = ?3 WHERE id = ?1 AND status = 'active'").bind(s.id, nowIso(), user.id).run();
  await log(env, request, user, institute.id, 'institute.student_remove', { seatId: s.id, student: s.email, batch: s.batch_name });
  return json({ removed: true });
}
export async function postStudentMove(request, env, ctx, params) {
  const { user, institute } = await requireStaff(env, request, params.id, { admin: true });
  assertOpen(institute);
  const s = await seatOf(env, institute, params.mid);
  const body = await readJson(request);
  if (!isId(body.batchId, 'bat')) throw fieldError({ batchId: 'Choose a batch.' });
  const to = await env.DB.prepare('SELECT id, name FROM batches WHERE id = ?1 AND institute_id = ?2 AND archived_at IS NULL').bind(body.batchId, institute.id).first();
  if (!to) throw fieldError({ batchId: 'Choose one of your batches that is not archived.' });
  if (to.id === s.batch_id) return json({ moved: false });
  await env.DB.prepare('UPDATE institute_students SET batch_id = ?2 WHERE id = ?1 AND status = ?3').bind(s.id, to.id, 'active').run();
  await log(env, request, user, institute.id, 'institute.student_move', { seatId: s.id, student: s.email, from: s.batch_name, to: to.name });
  return json({ moved: true, batch: { id: to.id, name: to.name } });
}

const ID = '([a-z]{3,4}_[0-9a-f]{20})';
const I = (method, tail, names, fn) => [method, new RegExp(`^/api/institutes/${ID}${tail}$`), ['id', ...names], fn];
export const ROUTES = {};
export const PATTERNS = [
  ['POST', new RegExp(`^/api/me/institute-invites/${ID}/accept$`), ['sid'], postAccept],
  ['POST', new RegExp(`^/api/me/institute-invites/${ID}/decline$`), ['sid'], postDecline],
  I('GET', '/staff', [], getStaff),
  I('POST', '/staff', [], postStaff),
  I('POST', `/staff/${ID}/resend`, ['sid'], postStaffResend),
  I('POST', `/staff/${ID}/remove`, ['sid'], postStaffRemove),
  I('POST', '/batches', [], postBatch),
  I('PUT', `/batches/${ID}`, ['bid'], putBatch),
  I('POST', `/batches/${ID}/code`, ['bid'], postBatchCode),
  I('GET', `/batches/${ID}/students`, ['bid'], getStudents),
  I('POST', `/students/${ID}/remove`, ['mid'], postStudentRemove),
  I('POST', `/students/${ID}/move`, ['mid'], postStudentMove),
];
