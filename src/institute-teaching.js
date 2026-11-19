// Teaching tools for a batch: a target, assignments, exam practice results, and a leaderboard
// (docs/INSTITUTES.md §12). Migration 0010.
//
//   GET  /api/institutes/:id/batches/:bid/teaching                 staff of the batch   target (who met it), assignments (who did them),
//                                                                                      exam practice per student, leaderboard
//   PUT  /api/institutes/:id/batches/:bid/target                   staff of the batch   { wpm, accuracy, dueDay?, note? } or { clear: true }
//   POST /api/institutes/:id/batches/:bid/assignments              staff of the batch   { kind: 'lesson'|'exam', ref, dueDay, note? }
//   POST /api/institutes/:id/batches/:bid/assignments/:aid/remove  staff of the batch
//   PUT  /api/institutes/:id/batches/:bid/leaderboard              staff of the batch   { on }
//   GET  /api/me/batches                                           signed in            for each of my seats: target, my assignments,
//                                                                                      the leaderboard if it is on, scheduled tests
//
// Results come from what the student's own practice saved: lesson runs (events), typing tests and exam practice.
import '../shared/course-meta.js';
import '../shared/exam-rules.js';
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from './http.js';
import { requireSession } from './session.js';
import { audit } from './billing.js';
import { newId, isId, requireBatch, ready } from './institute-access.js';
import { loadCourse, lessonTitle } from './course-store.js';
import { testsForStudent } from './institute-tests.js';

const META = globalThis.TC_META;
const X = globalThis.TC_EXAMS;
const IST_MS = 330 * 60000, DAY_MS = 86400000;
const istDay = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);
/** The moment after an India day ends. */
const dayEnd = (day) => new Date(Date.parse(day + 'T00:00:00Z') - IST_MS + DAY_MS).toISOString();
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z'));
const firstName = (name, email) => (String(name || '').trim().split(/\s+/)[0] || String(email || '').split('@')[0]).slice(0, 30);
const log = (env, request, user, instituteId, action, detail) =>
  audit(env, { actorId: user.id, action, target: `institute:${instituteId}`, detail: { ...detail, by: 'institute' }, ip: clientIp(request) });
const NOT_READY = "Targets and assignments aren't switched on yet.";
const later = async (fn) => {
  try { return await fn(); } catch (err) {
    if (/no such (table|column)/i.test(String(err && err.message))) throw new HttpError(503, 'teaching_not_ready', NOT_READY);
    throw err;
  }
};

function assignmentTitle(a, edits) {
  if (a.kind === 'lesson') { const m = META.BY_ID[a.ref]; return m ? `Lesson ${m.n}: ${lessonTitle(edits, a.ref)}` : a.ref; }
  return (X.MODES[a.ref] || { name: a.ref }).name;
}

/* ---------------- what the students did ---------------- */
/**
 * For the given students (user ids), the facts the tools need, in four reads:
 *   best[userId] = best speed at or above `accuracy` (lesson runs, typing tests, exam practice net speed)
 *   lessons[userId] = Map lessonId → completed_at
 *   exams[userId] = [{ mode, net, passed, mistakesPct, at }] newest first
 *   week[userId] = best speed of the last 7 days (for the leaderboard)
 */
async function factsFor(env, batchId, { accuracy = null, lessonIds = [], exams = true, week = false } = {}) {
  const DB = env.DB;
  const who = "(SELECT user_id FROM institute_students WHERE batch_id = ?1 AND status = 'active')";
  const stmts = [];
  if (accuracy != null) {
    stmts.push(DB.prepare(`SELECT user_id, MAX(w) AS best FROM (
        SELECT user_id, wpm AS w FROM events WHERE type = 'run' AND accuracy >= ?2 AND user_id IN ${who}
        UNION ALL SELECT user_id, wpm FROM typing_tests WHERE accuracy >= ?2 AND user_id IN ${who}
        UNION ALL SELECT user_id, net_wpm FROM exam_results WHERE 100 - mistakes_pct >= ?2 AND user_id IN ${who}
      ) GROUP BY user_id`).bind(batchId, accuracy));
  }
  if (lessonIds.length) {
    stmts.push(DB.prepare(`SELECT user_id, lesson_id, completed_at FROM lesson_scores WHERE status = 'completed' AND user_id IN ${who}
                            AND lesson_id IN (${lessonIds.map((_, i) => `?${i + 2}`).join(', ')})`).bind(batchId, ...lessonIds));
  }
  if (exams) stmts.push(DB.prepare(`SELECT user_id, mode, net_wpm, passed, mistakes_pct, created_at FROM exam_results WHERE user_id IN ${who} ORDER BY created_at DESC`).bind(batchId));
  if (week) stmts.push(DB.prepare(`SELECT user_id, MAX(best_wpm) AS best FROM daily_totals WHERE day >= ?2 AND user_id IN ${who} GROUP BY user_id`).bind(batchId, istDay(Date.now() - 6 * DAY_MS)));
  const res = stmts.length ? await DB.batch(stmts) : [];
  let i = 0;
  const out = { best: new Map(), lessons: new Map(), exams: new Map(), week: new Map() };
  if (accuracy != null) for (const r of res[i++].results) out.best.set(r.user_id, r.best);
  if (lessonIds.length) for (const r of res[i++].results) { const m = out.lessons.get(r.user_id) || new Map(); m.set(r.lesson_id, r.completed_at); out.lessons.set(r.user_id, m); }
  if (exams) for (const r of res[i++].results) { const l = out.exams.get(r.user_id) || []; l.push({ mode: r.mode, net: r.net_wpm, passed: !!r.passed, mistakesPct: r.mistakes_pct, at: r.created_at }); out.exams.set(r.user_id, l); }
  if (week) for (const r of res[i++].results) out.week.set(r.user_id, r.best);
  return out;
}
/** 'done' | 'late' (done after the due day) | 'overdue' (not done, day passed) | 'todo'. */
function stateOf(a, facts, userId, now) {
  let at = null;
  if (a.kind === 'lesson') at = (facts.lessons.get(userId) || new Map()).get(a.ref) || null;
  else { const hit = (facts.exams.get(userId) || []).filter((e) => e.mode === a.ref && e.at >= a.created_at).pop(); at = hit ? hit.at : null; }
  const end = dayEnd(a.due_day);
  if (at) return { state: at > end && a.kind === 'exam' ? 'late' : (a.kind === 'lesson' && at > end && at > a.created_at ? 'late' : 'done'), at };
  return { state: now > end ? 'overdue' : 'todo', at: null };
}
const targetView = (t) => (t ? { wpm: t.wpm, accuracy: t.accuracy, dueDay: t.due_day, note: t.note, setAt: t.set_at } : null);

/* ---------------- GET …/teaching ---------------- */
export async function getTeaching(request, env, ctx, params) {
  const { staff, batch } = await requireBatch(env, request, params.id, params.bid);
  return later(async () => {
    const DB = env.DB;
    const [students, target, assignments, board] = await DB.batch([
      DB.prepare(`SELECT s.id, s.user_id, u.full_name, u.email FROM institute_students s JOIN users u ON u.id = s.user_id
                   WHERE s.batch_id = ?1 AND s.status = 'active' ORDER BY u.full_name COLLATE NOCASE, u.email`).bind(batch.id),
      DB.prepare('SELECT * FROM batch_targets WHERE batch_id = ?1').bind(batch.id),
      DB.prepare('SELECT * FROM assignments WHERE batch_id = ?1 AND removed_at IS NULL ORDER BY due_day, created_at').bind(batch.id),
      DB.prepare('SELECT 1 AS leaderboard FROM batch_leaderboards WHERE batch_id = ?1').bind(batch.id),
    ]);
    const t = target.results[0] || null;
    const list = assignments.results;
    const facts = await factsFor(env, batch.id, { accuracy: t ? t.accuracy : null, lessonIds: [...new Set(list.filter((a) => a.kind === 'lesson').map((a) => a.ref))], week: true });
    const { edits } = await loadCourse(env);
    const now = nowIso();
    const people = students.results;
    const name = (s) => s.full_name || s.email;
    return json({
      role: staff.role,
      target: targetView(t),
      targetStudents: t ? people.map((s) => { const best = facts.best.get(s.user_id) || 0; return { id: s.id, name: name(s), best: Math.floor(best), met: best >= t.wpm }; }) : [],
      assignments: list.map((a) => {
        const each = people.map((s) => ({ id: s.id, name: name(s), ...stateOf(a, facts, s.user_id, now) }));
        const count = (k) => each.filter((x) => x.state === k).length;
        return { id: a.id, kind: a.kind, ref: a.ref, title: assignmentTitle(a, edits), dueDay: a.due_day, note: a.note, createdAt: a.created_at,
          done: count('done'), late: count('late'), overdue: count('overdue'), todo: count('todo'), students: each };
      }),
      exams: people.map((s) => {
        const mine = facts.exams.get(s.user_id) || [];
        const byMode = {};
        for (const mode of X.ORDER) {
          const of = mine.filter((e) => e.mode === mode);
          if (!of.length) continue;
          const best = of.reduce((b, e) => (e.net > b.net ? e : b), of[0]);
          byMode[mode] = { tries: of.length, best: Math.floor(best.net), passed: of.some((e) => e.passed), latest: of[0].at };
        }
        return { id: s.id, name: name(s), modes: byMode };
      }),
      examModes: X.ORDER.map((m) => ({ id: m, name: X.MODES[m].name, short: X.MODES[m].short })),
      leaderboard: { on: !!(board.results[0] && board.results[0].leaderboard), rows: leaderboardRows(people, facts) },
      lessons: META.ORDER.map((id) => ({ id, label: `Lesson ${META.BY_ID[id].n}: ${lessonTitle(edits, id)}`, level: META.BY_ID[id].level })),
      today: istDay(),
    });
  });
}
function leaderboardRows(people, facts) {
  return people.map((s) => ({ name: firstName(s.full_name, s.email), wpm: Math.round(facts.week.get(s.user_id) || 0) }))
    .filter((r) => r.wpm > 0).sort((a, b) => b.wpm - a.wpm).slice(0, 10);
}

/* ---------------- changes ---------------- */
export async function putTarget(request, env, ctx, params) {
  const { user, institute, batch } = await requireBatch(env, request, params.id, params.bid);
  const body = await readJson(request);
  return later(async () => {
    if (body.clear === true) {
      await env.DB.prepare('DELETE FROM batch_targets WHERE batch_id = ?1').bind(batch.id).run();
      await log(env, request, user, institute.id, 'institute.target_clear', { batch: batch.name });
      return json({ target: null });
    }
    const fields = {};
    const wpm = Number(body.wpm), acc = Number(body.accuracy);
    if (!Number.isInteger(wpm) || wpm < 5 || wpm > 150) fields.wpm = 'Enter a speed from 5 to 150 words a minute.';
    if (!Number.isInteger(acc) || acc < 50 || acc > 100) fields.accuracy = 'Enter an accuracy from 50 to 100 percent.';
    const due = body.dueDay == null || body.dueDay === '' ? null : body.dueDay;
    if (due !== null && (!isDay(due) || due < istDay())) fields.dueDay = 'Choose today or a later day, or leave it empty.';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 201) : '';
    if (note.length > 200) fields.note = 'Keep the note under 200 characters.';
    if (Object.keys(fields).length) throw fieldError(fields);
    await env.DB.prepare(`INSERT INTO batch_targets (batch_id, wpm, accuracy, due_day, note, set_by, set_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                          ON CONFLICT (batch_id) DO UPDATE SET wpm = excluded.wpm, accuracy = excluded.accuracy, due_day = excluded.due_day, note = excluded.note,
                          set_by = excluded.set_by, set_at = excluded.set_at`).bind(batch.id, wpm, acc, due, note, user.id, nowIso()).run();
    await log(env, request, user, institute.id, 'institute.target_set', { batch: batch.name, wpm, accuracy: acc, dueDay: due });
    return json({ target: { wpm, accuracy: acc, dueDay: due, note } });
  });
}

export async function postAssignment(request, env, ctx, params) {
  const { user, institute, batch } = await requireBatch(env, request, params.id, params.bid);
  const body = await readJson(request);
  return later(async () => {
    const fields = {};
    const kind = body.kind === 'lesson' || body.kind === 'exam' ? body.kind : null;
    if (!kind) fields.kind = 'Choose a lesson or an exam practice test.';
    else if (kind === 'lesson' && !META.BY_ID[body.ref]) fields.ref = 'Choose a lesson.';
    else if (kind === 'exam' && !X.MODES[body.ref]) fields.ref = 'Choose a test.';
    if (!isDay(body.dueDay) || body.dueDay < istDay()) fields.dueDay = 'Choose today or a later day.';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 201) : '';
    if (note.length > 200) fields.note = 'Keep the note under 200 characters.';
    if (Object.keys(fields).length) throw fieldError(fields);
    const open = (await env.DB.prepare('SELECT COUNT(*) AS n FROM assignments WHERE batch_id = ?1 AND removed_at IS NULL').bind(batch.id).first()).n;
    if (open >= 50) throw new HttpError(409, 'too_many', 'A batch can have 50 open assignments. Remove finished ones first.');
    const id = newId('asg');
    await env.DB.prepare('INSERT INTO assignments (id, batch_id, kind, ref, due_day, note, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
      .bind(id, batch.id, kind, body.ref, body.dueDay, note, user.id, nowIso()).run();
    await log(env, request, user, institute.id, 'institute.assignment_add', { batch: batch.name, kind, ref: body.ref, dueDay: body.dueDay });
    return json({ assignment: { id } }, 201);
  });
}
export async function postAssignmentRemove(request, env, ctx, params) {
  const { user, institute, batch } = await requireBatch(env, request, params.id, params.bid);
  if (!isId(params.aid, 'asg')) throw new HttpError(404, 'not_found', 'There is no such assignment in this batch.');
  return later(async () => {
    const r = await env.DB.prepare('UPDATE assignments SET removed_at = ?3 WHERE id = ?1 AND batch_id = ?2 AND removed_at IS NULL').bind(params.aid, batch.id, nowIso()).run();
    if (!r.meta || r.meta.changes !== 1) throw new HttpError(404, 'not_found', 'There is no such assignment in this batch.');
    await log(env, request, user, institute.id, 'institute.assignment_remove', { batch: batch.name, assignmentId: params.aid });
    return json({ removed: true });
  });
}
export async function putLeaderboard(request, env, ctx, params) {
  const { user, institute, batch } = await requireBatch(env, request, params.id, params.bid);
  const body = await readJson(request);
  if (typeof body.on !== 'boolean') throw fieldError({ on: 'Say on or off.' });
  return later(async () => {
    await (body.on
      ? env.DB.prepare('INSERT INTO batch_leaderboards (batch_id, on_by, on_at) VALUES (?1, ?2, ?3) ON CONFLICT (batch_id) DO NOTHING').bind(batch.id, user.id, nowIso())
      : env.DB.prepare('DELETE FROM batch_leaderboards WHERE batch_id = ?1').bind(batch.id)).run();
    await log(env, request, user, institute.id, 'institute.leaderboard', { batch: batch.name, on: body.on });
    return json({ on: body.on });
  });
}

/* ---------------- GET /api/me/batches (the student's side) ---------------- */
export async function getMyBatches(request, env) {
  const { user } = await requireSession(env, request);
  return ready(async () => {
    const DB = env.DB;
    const seats = (await DB.prepare(
      `SELECT s.id, s.batch_id, b.name AS batch_name, i.name AS institute_name FROM institute_students s
         JOIN batches b ON b.id = s.batch_id JOIN institutes i ON i.id = s.institute_id
        WHERE s.user_id = ?1 AND s.status = 'active' AND i.status <> 'closed' ORDER BY s.joined_at`
    ).bind(user.id).all()).results;
    if (!seats.length) return json({ batches: [] });
    let teaching = true;
    const { edits } = await loadCourse(env);
    const now = nowIso(), out = [];
    for (const seat of seats) {
      let t = null, list = [], on = false;
      if (teaching) {
        try {
          const [tr, ar, br] = await DB.batch([
            DB.prepare('SELECT * FROM batch_targets WHERE batch_id = ?1').bind(seat.batch_id),
            DB.prepare('SELECT * FROM assignments WHERE batch_id = ?1 AND removed_at IS NULL ORDER BY due_day, created_at').bind(seat.batch_id),
            DB.prepare('SELECT 1 AS leaderboard FROM batch_leaderboards WHERE batch_id = ?1').bind(seat.batch_id),
          ]);
          t = tr.results[0] || null; list = ar.results; on = !!(br.results[0] && br.results[0].leaderboard);
        } catch (err) {
          if (!/no such (table|column)/i.test(String(err && err.message))) throw err;
          teaching = false; // before migration 0010: just the batch
        }
      }
      // my own results only, except for the leaderboard (first names and speeds of the batch)
      const mineFacts = await factsFor(env, seat.batch_id, { accuracy: t ? t.accuracy : null, lessonIds: [...new Set(list.filter((a) => a.kind === 'lesson').map((a) => a.ref))],
        exams: list.some((a) => a.kind === 'exam'), week: on });
      const myBest = t ? Math.floor(mineFacts.best.get(user.id) || 0) : null;
      out.push({
        id: seat.id, institute: { name: seat.institute_name }, batch: { name: seat.batch_name },
        target: t ? { ...targetView(t), myBest, met: myBest >= t.wpm } : null,
        assignments: list.map((a) => ({ id: a.id, kind: a.kind, title: assignmentTitle(a, edits), dueDay: a.due_day, note: a.note, ...stateOf(a, mineFacts, user.id, now),
          link: a.kind === 'lesson' ? '/app' : `/exam-practice?test=${encodeURIComponent(a.ref)}` })),
        leaderboard: on ? leaderboardRows(await boardPeople(env, seat.batch_id), mineFacts) : null,
        tests: await testsForStudent(env, seat.batch_id, user.id), // scheduled mock tests (src/institute-tests.js)
      });
    }
    return json({ batches: out, today: istDay() });
  });
}
const boardPeople = async (env, batchId) => (await env.DB.prepare(
  `SELECT s.user_id, u.full_name, u.email FROM institute_students s JOIN users u ON u.id = s.user_id WHERE s.batch_id = ?1 AND s.status = 'active'`
).bind(batchId).all()).results;

const ID = '([a-z]{3,4}_[0-9a-f]{20})';
const B = (method, tail, names, fn) => [method, new RegExp(`^/api/institutes/${ID}/batches/${ID}${tail}$`), ['id', 'bid', ...names], fn];
export const ROUTES = { 'GET /api/me/batches': getMyBatches };
export const PATTERNS = [
  B('GET', '/teaching', [], getTeaching),
  B('PUT', '/target', [], putTarget),
  B('POST', '/assignments', [], postAssignment),
  B('POST', `/assignments/${ID}/remove`, ['aid'], postAssignmentRemove),
  B('PUT', '/leaderboard', [], putLeaderboard),
];
