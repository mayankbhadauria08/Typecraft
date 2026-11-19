// Institutes for learners and institute staff (docs/INSTITUTES.md §4).
//
//   GET  /api/institutes/join?code=          signed in   what a join code is for: institute, batch, plan, end date
//   POST /api/institutes/join                signed in   { code, adult: true } take a seat in that batch
//   GET  /api/me/institutes                  signed in   my seats, and the institutes I help run
//   POST /api/me/institutes/:id/leave        signed in   give my seat back
//   GET  /api/institutes/:id                 staff       the institute, its seats and the batches I may see
//   GET  /api/institutes/:id/batches/:bid    staff       one batch (admins: any; teachers: their own)
//
// The console's institute pages (TypeCraft staff) live in src/console/. Every check here is made on
// the server: src/institute-access.js.
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from './http.js';
import { requireSession, hitLimit, tooMany } from './session.js';
import { newId, isId, cleanJoinCode, showJoinCode, ready, instituteOpen, requireStaff, requireBatch, visibleBatchSql } from './institute-access.js';

/** Join attempts: per account and per network, counted whether or not the code is right. */
const JOIN_LIMIT = { user: 20, ip: 60, seconds: 3600 };
const BAD_CODE = 'No batch uses this code. Check it with your institute: it has eight letters and numbers, like ABCD-EFGH.';

async function limitJoin(env, request, userId) {
  const okUser = await hitLimit(env, `join:${userId}`, JOIN_LIMIT.user, JOIN_LIMIT.seconds);
  const okIp = await hitLimit(env, `join-ip:${clientIp(request)}`, JOIN_LIMIT.ip, JOIN_LIMIT.seconds);
  if (!okUser || !okIp) throw tooMany(60);
}

/** The batch a code opens, with its institute and plan; null when no open batch uses it. */
async function batchByCode(env, code) {
  return env.DB.prepare(
    `SELECT b.id AS batch_id, b.name AS batch_name, i.id AS institute_id, i.name AS institute_name, i.status, i.starts_at, i.ends_at, i.seats,
            p.name AS package_name,
            (SELECT COUNT(*) FROM institute_students s WHERE s.institute_id = i.id AND s.status = 'active') AS used
       FROM batches b JOIN institutes i ON i.id = b.institute_id JOIN packages p ON p.id = i.package_id
      WHERE b.join_code = ?1 AND b.archived_at IS NULL AND i.status <> 'closed'`
  ).bind(code).first();
}

/** Why this learner can't join (or null when they can). */
function refusal(b, now, mine) {
  if (mine && mine.batch_id === b.batch_id) return null; // already in: joining again changes nothing
  if (mine) return new HttpError(409, 'other_batch', `You're already in ${mine.batch_name} at ${b.institute_name}. Ask your teacher to move you to another batch.`);
  if (b.ends_at <= now) return new HttpError(409, 'ended', `${b.institute_name}'s seats have ended. Ask your institute about renewing.`);
  if (!instituteOpen(b, now)) return new HttpError(409, 'not_open', `${b.institute_name} isn't open for joining yet. Ask your institute when to try again.`);
  if (b.used >= b.seats) return new HttpError(409, 'seats_full', `${b.institute_name} has no seats left. Ask your institute to add seats.`);
  return null;
}

const myActiveSeat = (env, instituteId, userId) => env.DB.prepare(
  `SELECT s.id, s.batch_id, b.name AS batch_name FROM institute_students s JOIN batches b ON b.id = s.batch_id
    WHERE s.institute_id = ?1 AND s.user_id = ?2 AND s.status = 'active'`
).bind(instituteId, userId).first();

/* ---------------- GET /api/institutes/join?code= ---------------- */
export async function getJoin(request, env) {
  const { user } = await requireSession(env, request);
  await limitJoin(env, request, user.id);
  const code = cleanJoinCode(new URL(request.url).searchParams.get('code'));
  if (!code) throw new HttpError(404, 'bad_code', BAD_CODE);
  return ready(async () => {
    const b = await batchByCode(env, code);
    if (!b) throw new HttpError(404, 'bad_code', BAD_CODE);
    const now = nowIso();
    const mine = await myActiveSeat(env, b.institute_id, user.id);
    const why = refusal(b, now, mine);
    return json({
      code: showJoinCode(code),
      institute: { name: b.institute_name }, batch: { name: b.batch_name }, plan: { name: b.package_name }, endsAt: b.ends_at,
      joined: !!(mine && mine.batch_id === b.batch_id),
      canJoin: !why && !mine, problem: why ? { code: why.code, message: why.message } : null,
    });
  });
}

/* ---------------- POST /api/institutes/join ---------------- */
export async function postJoin(request, env) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request);
  await limitJoin(env, request, user.id);
  const code = cleanJoinCode(body.code);
  if (!code) throw fieldError({ code: BAD_CODE });
  if (body.adult !== true) throw fieldError({ adult: 'Please confirm that you are 18 or older. Institute seats are for adult learners for now.' });
  return ready(async () => {
    const DB = env.DB;
    const b = await batchByCode(env, code);
    if (!b) throw fieldError({ code: BAD_CODE });
    const now = nowIso();
    const mine = await myActiveSeat(env, b.institute_id, user.id);
    const why = refusal(b, now, mine);
    if (why) throw why;
    if (mine) return json({ joined: true, already: true, institute: { name: b.institute_name }, batch: { name: b.batch_name }, endsAt: b.ends_at });
    // one statement: the seat count, the term and "not already in" are checked as the row is written,
    // so two students taking the last seat at the same moment can't both get it
    const id = newId('mem');
    let r;
    try {
      r = await DB.prepare(
        `INSERT INTO institute_students (id, institute_id, batch_id, user_id, status, adult_confirmed_at, joined_at)
         SELECT ?1, i.id, b.id, ?3, 'active', ?4, ?4
           FROM batches b JOIN institutes i ON i.id = b.institute_id
          WHERE b.id = ?2 AND b.join_code = ?5 AND b.archived_at IS NULL
            AND i.status = 'active' AND i.starts_at <= ?4 AND i.ends_at > ?4
            AND (SELECT COUNT(*) FROM institute_students s WHERE s.institute_id = i.id AND s.status = 'active') < i.seats
            AND NOT EXISTS (SELECT 1 FROM institute_students s WHERE s.institute_id = i.id AND s.user_id = ?3 AND s.status = 'active')`
      ).bind(id, b.batch_id, user.id, now, code).run();
    } catch (err) {
      if (!/UNIQUE/i.test(String(err && err.message))) throw err;
      r = { meta: { changes: 0 } };
    }
    if (!r.meta || r.meta.changes !== 1) {
      // something changed since the checks above: say what it is now
      const again = await batchByCode(env, code);
      const why2 = again ? refusal(again, nowIso(), await myActiveSeat(env, again.institute_id, user.id)) : null;
      if (why2) throw why2;
      if (!again) throw fieldError({ code: BAD_CODE });
      return json({ joined: true, already: true, institute: { name: b.institute_name }, batch: { name: b.batch_name }, endsAt: b.ends_at });
    }
    return json({ joined: true, already: false, institute: { name: b.institute_name }, batch: { name: b.batch_name }, plan: { name: b.package_name }, endsAt: b.ends_at }, 201);
  });
}

/* ---------------- GET /api/me/institutes ---------------- */
export async function getMine(request, env) {
  const { user } = await requireSession(env, request);
  return ready(async () => {
    const DB = env.DB;
    const now = nowIso();
    const [seats, staff, invites] = await DB.batch([
      DB.prepare(`SELECT s.id, s.joined_at, i.id AS institute_id, i.name AS institute_name, i.status, i.starts_at, i.ends_at,
                         b.name AS batch_name, p.name AS package_name
                    FROM institute_students s JOIN institutes i ON i.id = s.institute_id JOIN batches b ON b.id = s.batch_id
                    JOIN packages p ON p.id = i.package_id
                   WHERE s.user_id = ?1 AND s.status = 'active' ORDER BY s.joined_at`).bind(user.id),
      DB.prepare(`SELECT st.role, i.id, i.name, i.status FROM institute_staff st JOIN institutes i ON i.id = st.institute_id
                   WHERE st.user_id = ?1 AND st.status = 'active' AND i.status <> 'closed' ORDER BY i.name`).bind(user.id),
      DB.prepare(`SELECT st.id, st.role, st.invited_at, i.name FROM institute_staff st JOIN institutes i ON i.id = st.institute_id
                   WHERE st.email = ?1 AND st.status = 'invited' AND i.status <> 'closed' ORDER BY st.invited_at`).bind(user.email),
    ]);
    return json({
      seats: seats.results.map((s) => ({
        id: s.id, institute: { name: s.institute_name }, batch: { name: s.batch_name }, plan: { name: s.package_name },
        joinedAt: s.joined_at, endsAt: s.ends_at, givesPlan: instituteOpen(s, now),
      })),
      staff: staff.results.map((s) => ({ institute: { id: s.id, name: s.name, status: s.status }, role: s.role })),
      // invitations to help run an institute, sent to this account's email (accepting needs it verified)
      invites: invites.results.map((x) => ({ id: x.id, institute: { name: x.name }, role: x.role, invitedAt: x.invited_at })),
      emailVerified: !!user.emailVerified,
    });
  });
}

/* ---------------- POST /api/me/institutes/:id/leave ---------------- */
export async function postLeave(request, env, ctx, params) {
  const { user } = await requireSession(env, request);
  if (!isId(params.id, 'mem')) throw new HttpError(404, 'not_found', 'You have no seat with this ID.');
  return ready(async () => {
    const r = await env.DB.prepare(
      `UPDATE institute_students SET status = 'left', ended_at = ?3, ended_by = NULL WHERE id = ?1 AND user_id = ?2 AND status = 'active'`
    ).bind(params.id, user.id, nowIso()).run();
    if (!r.meta || r.meta.changes !== 1) throw new HttpError(404, 'not_found', 'You have no seat with this ID.');
    return json({ left: true });
  });
}

/* ---------------- staff views ---------------- */
/** The first India day of the last seven (practice on or after it counts as "this week"). */
const weekAgo = () => new Date(Date.now() + 330 * 60000 - 6 * 86400000).toISOString().slice(0, 10);
function instituteView(i, used) {
  return { id: i.id, name: i.name, city: i.city, status: i.status, seats: i.seats, seatsUsed: used, startsAt: i.starts_at, endsAt: i.ends_at };
}

/** GET /api/institutes/:id — admins see every batch, a teacher only theirs. */
export async function getInstitute(request, env, ctx, params) {
  const { staff, institute } = await requireStaff(env, request, params.id);
  const DB = env.DB;
  const [used, batches] = await DB.batch([
    DB.prepare("SELECT COUNT(*) AS n FROM institute_students WHERE institute_id = ?1 AND status = 'active'").bind(institute.id),
    DB.prepare(`SELECT b.id, b.name, b.archived_at, b.join_code,
                       (SELECT COUNT(*) FROM institute_students s WHERE s.batch_id = b.id AND s.status = 'active') AS students,
                       (SELECT COUNT(*) FROM institute_students s WHERE s.batch_id = b.id AND s.status = 'active'
                           AND NOT EXISTS (SELECT 1 FROM daily_totals d WHERE d.user_id = s.user_id AND d.day >= ?3 AND (d.seconds > 0 OR d.runs > 0 OR d.steps > 0))) AS quiet,
                       (SELECT GROUP_CONCAT(COALESCE(u.full_name, st.email), ', ') FROM batch_teachers t JOIN institute_staff st ON st.id = t.staff_id
                          LEFT JOIN users u ON u.id = st.user_id WHERE t.batch_id = b.id AND st.status = 'active') AS teachers
                  FROM batches b WHERE b.institute_id = ?1 AND ${visibleBatchSql(staff.role, '?2')}
                 ORDER BY b.archived_at IS NOT NULL, b.name`).bind(institute.id, staff.id, weekAgo()),
  ]);
  return json({
    role: staff.role,
    institute: instituteView(institute, used.results[0].n),
    batches: batches.results.map((b) => ({ id: b.id, name: b.name, students: b.students, quietThisWeek: b.quiet, teachers: b.teachers || '',
      joinCode: b.archived_at ? null : showJoinCode(b.join_code), archived: !!b.archived_at })),
  });
}

/** GET /api/institutes/:id/batches/:bid */
export async function getBatch(request, env, ctx, params) {
  const { staff, institute, batch } = await requireBatch(env, request, params.id, params.bid);
  const DB = env.DB;
  const [students, teachers] = await DB.batch([
    DB.prepare("SELECT COUNT(*) AS n FROM institute_students WHERE batch_id = ?1 AND status = 'active'").bind(batch.id),
    DB.prepare(`SELECT st.id, COALESCE(u.full_name, st.email) AS name FROM batch_teachers t JOIN institute_staff st ON st.id = t.staff_id
                LEFT JOIN users u ON u.id = st.user_id WHERE t.batch_id = ?1 AND st.status = 'active' ORDER BY name`).bind(batch.id),
  ]);
  return json({
    role: staff.role,
    institute: { id: institute.id, name: institute.name },
    batch: {
      id: batch.id, name: batch.name, archived: !!batch.archived_at, students: students.results[0].n,
      joinCode: batch.archived_at ? null : showJoinCode(batch.join_code),
      teachers: teachers.results.map((t) => ({ id: t.id, name: t.name })),
    },
  });
}

const ID = '([a-z]{3,4}_[0-9a-f]{20})';
export const ROUTES = {
  'GET /api/institutes/join': getJoin,
  'POST /api/institutes/join': postJoin,
  'GET /api/me/institutes': getMine,
};
export const PATTERNS = [
  ['POST', new RegExp(`^/api/me/institutes/${ID}/leave$`), ['id'], postLeave],
  ['GET', new RegExp(`^/api/institutes/${ID}$`), ['id'], getInstitute],
  ['GET', new RegExp(`^/api/institutes/${ID}/batches/${ID}$`), ['id', 'bid'], getBatch],
];
