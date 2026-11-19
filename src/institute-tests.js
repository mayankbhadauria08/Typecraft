// A scheduled mock test for a batch (docs/INSTITUTES.md §16). Migration 0012.
// The whole batch takes the same exam practice passage inside a time window; the teacher sees the results
// in one table (and as a spreadsheet). The test is the exam practice page with the passage fixed.
//
//   GET  /api/institutes/:id/batches/:bid/tests                   staff of the batch   the batch's tests, with counts
//   POST /api/institutes/:id/batches/:bid/tests                   staff of the batch   { mode, passageId ('' = pick one), day, time, windowMinutes, note? }
//   GET  /api/institutes/:id/batches/:bid/tests/:tid              staff of the batch   one test: a row per student
//   GET  /api/institutes/:id/batches/:bid/tests/:tid/results.csv  staff of the batch   the same as a spreadsheet
//   POST /api/institutes/:id/batches/:bid/tests/:tid/cancel       staff of the batch
//   GET  /api/me/batch-tests/:tid                                 a student of the batch   the test, and where I am with it
//   POST /api/me/batch-tests/:tid/start                           a student of the batch   counts an opening of the passage (while open)
//   POST /api/exams/results { …, batchTestId }                    (src/exams.js) the first result submitted in time counts
//
// Rules: a student starts while the window is open and has the test's own time to finish (plus two minutes
// to submit). The first result submitted in time is the one that counts; the teacher also sees how many
// times each student opened the passage. Results are marked on the server like every exam practice result.
import '../shared/exam-passages.js';
import '../shared/exam-rules.js';
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from './http.js';
import { requireSession } from './session.js';
import { audit } from './billing.js';
import { newId, isId, requireBatch } from './institute-access.js';
import { csvResponse } from './console/lib.js';

const X = globalThis.TC_EXAMS;
const IST_MS = 330 * 60000, MIN_MS = 60000, DAY_MS = 86400000;
export const WINDOWS = [30, 60, 120, 180, 360, 720, 1440];
export const SUBMIT_GRACE_MS = 2 * MIN_MS;
export const MAX_OPEN = 20;
const NOT_FOUND = 'There is no such test in this batch.';
const NOT_READY = "Scheduled tests aren't switched on yet.";
const istDay = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const istStamp = (iso) => (iso ? new Date(Date.parse(iso) + IST_MS).toISOString().slice(0, 16).replace('T', ' ') : '');
const later = async (fn) => {
  try { return await fn(); } catch (err) {
    if (/no such (table|column)/i.test(String(err && err.message))) throw new HttpError(503, 'tests_not_ready', NOT_READY);
    throw err;
  }
};
const log = (env, request, user, instituteId, action, detail) =>
  audit(env, { actorId: user.id, action, target: `institute:${instituteId}`, detail: { ...detail, by: 'institute' }, ip: clientIp(request) });

export function stateOf(t, now = nowIso()) {
  if (t.cancelled_at) return 'cancelled';
  if (now < t.opens_at) return 'upcoming';
  if (now < t.closes_at) return 'open';
  return 'closed';
}

function testView(t, now) {
  const M = X.MODES[t.mode] || { name: t.mode, short: t.mode, minutes: 0 };
  const p = X.passage(t.mode, t.passage_id);
  return { id: t.id, mode: t.mode, modeName: M.name, short: M.short, minutes: M.minutes, goal: M.goal, passageId: t.passage_id, passageTitle: p ? p.title : t.passage_id,
    opensAt: t.opens_at, closesAt: t.closes_at, note: t.note, state: stateOf(t, now), cancelledAt: t.cancelled_at || null, createdAt: t.created_at };
}
const resultView = (r) => (r && r.id ? { netWpm: r.net_wpm, grossWpm: r.gross_wpm, strokes: r.strokes, correctStrokes: r.correct_strokes, kdph: r.kdph,
  mistakesPct: r.mistakes_pct, seconds: r.seconds, passed: !!r.passed } : null);

/* ---------------- the teacher's side ---------------- */
export async function getTests(request, env, ctx, params) {
  const { batch } = await requireBatch(env, request, params.id, params.bid);
  return later(async () => {
    const DB = env.DB, now = nowIso();
    const [tests, students] = await DB.batch([
      DB.prepare(`SELECT t.*, (SELECT COUNT(*) FROM batch_test_attempts a WHERE a.test_id = t.id AND a.starts > 0) AS started,
                         (SELECT COUNT(*) FROM batch_test_attempts a WHERE a.test_id = t.id AND a.result_id IS NOT NULL) AS submitted,
                         (SELECT COUNT(*) FROM batch_test_attempts a JOIN exam_results r ON r.id = a.result_id WHERE a.test_id = t.id AND r.passed = 1) AS passed
                    FROM batch_tests t WHERE t.batch_id = ?1 ORDER BY t.opens_at DESC LIMIT 100`).bind(batch.id),
      DB.prepare("SELECT COUNT(*) AS n FROM institute_students WHERE batch_id = ?1 AND status = 'active'").bind(batch.id),
    ]);
    return json({
      tests: tests.results.map((t) => ({ ...testView(t, now), started: t.started, submitted: t.submitted, passed: t.passed })),
      students: students.results[0].n,
      modes: X.ORDER.map((m) => ({ id: m, name: X.MODES[m].name, short: X.MODES[m].short, minutes: X.MODES[m].minutes,
        passages: X.passages(m).map((p) => ({ id: p.id, title: p.title })) })),
      windows: WINDOWS, today: istDay(), now,
    });
  });
}

export async function postTest(request, env, ctx, params) {
  const { user, institute, batch } = await requireBatch(env, request, params.id, params.bid);
  const body = await readJson(request);
  return later(async () => {
    if (batch.archived_at) throw new HttpError(409, 'archived', 'This batch is archived. Bring it back to schedule a test.');
    const fields = {};
    const M = X.MODES[body.mode];
    if (!M) fields.mode = 'Choose a test.';
    let passageId = typeof body.passageId === 'string' ? body.passageId : '';
    if (M) {
      const list = X.passages(body.mode);
      if (!passageId) passageId = list[Math.floor(Math.random() * list.length)].id;
      else if (!X.passage(body.mode, passageId)) fields.passageId = 'Choose a passage of this test.';
    }
    const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null;
    const time = typeof body.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ? body.time : null;
    const opens = day && time ? Date.parse(`${day}T${time}:00+05:30`) : NaN;
    if (!day) fields.day = 'Choose the day.';
    if (!time) fields.time = 'Choose the time it opens (India time).';
    else if (Number.isFinite(opens) && opens < Date.now() - 5 * MIN_MS) fields.time = 'That time has passed. Choose now or later.';
    else if (Number.isFinite(opens) && opens > Date.now() + 90 * DAY_MS) fields.day = 'Schedule it within the next 90 days.';
    const windowMinutes = Number(body.windowMinutes);
    if (!WINDOWS.includes(windowMinutes)) fields.windowMinutes = 'Choose how long it stays open.';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 201) : '';
    if (note.length > 200) fields.note = 'Keep the note under 200 characters.';
    if (Object.keys(fields).length) throw fieldError(fields);
    const DB = env.DB, now = nowIso();
    const open = (await DB.prepare('SELECT COUNT(*) AS n FROM batch_tests WHERE batch_id = ?1 AND cancelled_at IS NULL AND closes_at > ?2').bind(batch.id, now).first()).n;
    if (open >= MAX_OPEN) throw new HttpError(409, 'too_many', `A batch can have ${MAX_OPEN} tests waiting or open. Cancel one first.`);
    const id = newId('btst');
    const opensAt = new Date(Math.max(opens, Date.now() - 5 * MIN_MS)).toISOString();
    const closesAt = new Date(Date.parse(opensAt) + windowMinutes * MIN_MS).toISOString();
    await DB.prepare(`INSERT INTO batch_tests (id, institute_id, batch_id, mode, passage_id, opens_at, closes_at, note, created_by, created_at)
                      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(id, institute.id, batch.id, body.mode, passageId, opensAt, closesAt, note, user.id, now).run();
    await log(env, request, user, institute.id, 'institute.test_add', { batch: batch.name, mode: body.mode, opensAt, closesAt });
    return json({ test: testView({ id, mode: body.mode, passage_id: passageId, opens_at: opensAt, closes_at: closesAt, note, created_at: now }, now) }, 201);
  });
}

async function oneTest(env, batch, tid) {
  if (!isId(tid, 'btst')) throw new HttpError(404, 'not_found', NOT_FOUND);
  const t = await env.DB.prepare('SELECT * FROM batch_tests WHERE id = ?1 AND batch_id = ?2').bind(tid, batch.id).first();
  if (!t) throw new HttpError(404, 'not_found', NOT_FOUND);
  return t;
}
/** A row for each student of the batch now, and for anyone who took the test and has left since. */
async function rowsOf(env, t) {
  const rows = (await env.DB.prepare(
    `SELECT u.id AS user_id, u.full_name, u.email, s.status AS seat, a.starts, a.first_started_at, a.last_started_at, a.submitted_at,
            r.id, r.net_wpm, r.gross_wpm, r.strokes, r.correct_strokes, r.kdph, r.mistakes_pct, r.seconds, r.passed
       FROM users u
       LEFT JOIN institute_students s ON s.user_id = u.id AND s.batch_id = ?2 AND s.status = 'active'
       LEFT JOIN batch_test_attempts a ON a.test_id = ?1 AND a.user_id = u.id
       LEFT JOIN exam_results r ON r.id = a.result_id
      WHERE u.id IN (SELECT user_id FROM institute_students WHERE batch_id = ?2 AND status = 'active'
                     UNION SELECT user_id FROM batch_test_attempts WHERE test_id = ?1)`
  ).bind(t.id, t.batch_id).all()).results;
  const out = rows.map((r) => ({
    name: r.full_name || '', email: r.email, inBatch: r.seat === 'active',
    state: r.submitted_at ? 'submitted' : r.starts ? 'started' : 'not_started', starts: r.starts || 0,
    startedAt: r.first_started_at || null, submittedAt: r.submitted_at || null, result: resultView(r),
  }));
  // who did best first: met the goal, then the test's own measure, then name
  const score = (x) => !x.result ? -1 : t.mode === 'ssc-dest' ? x.result.correctStrokes : t.mode === 'ssc-typing' ? x.result.strokes : x.result.netWpm;
  return out.sort((a, b) => (b.result && b.result.passed) - (a.result && a.result.passed) || score(b) - score(a) || a.name.localeCompare(b.name));
}

export async function getTest(request, env, ctx, params) {
  const { batch } = await requireBatch(env, request, params.id, params.bid);
  return later(async () => {
    const t = await oneTest(env, batch, params.tid);
    return json({ test: testView(t), rows: await rowsOf(env, t) });
  });
}

const STATE_WORD = { submitted: 'Submitted', started: 'Opened, not submitted', not_started: 'Not taken' };
export async function getTestCsv(request, env, ctx, params) {
  const { institute, batch } = await requireBatch(env, request, params.id, params.bid);
  return later(async () => {
    const t = await oneTest(env, batch, params.tid);
    const v = testView(t);
    const rows = await rowsOf(env, t);
    const header = ['Name', 'Email', 'In the batch', 'Result', 'Times opened', 'Submitted (India time)', 'Key depressions', 'Correct key depressions',
      'Net wpm', 'Gross wpm', 'Mistakes (%)', 'Time used (s)', 'Goal met'];
    const body = rows.map((r) => [r.name, r.email, r.inBatch ? 'Yes' : 'Left', STATE_WORD[r.state], r.starts, istStamp(r.submittedAt),
      r.result ? r.result.strokes : '', r.result ? r.result.correctStrokes : '', r.result ? r.result.netWpm : '', r.result ? r.result.grossWpm : '',
      r.result ? r.result.mistakesPct : '', r.result ? r.result.seconds : '', r.result ? (r.result.passed ? 'Yes' : 'No') : '']);
    const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'batch';
    return csvResponse(`typecraft-${slug(institute.name)}-${slug(batch.name)}-${slug(v.short)}-${istDay(Date.parse(t.opens_at))}.csv`, header, body);
  });
}

export async function postCancel(request, env, ctx, params) {
  const { user, institute, batch } = await requireBatch(env, request, params.id, params.bid);
  return later(async () => {
    const t = await oneTest(env, batch, params.tid);
    const r = await env.DB.prepare('UPDATE batch_tests SET cancelled_at = ?2, cancelled_by = ?3 WHERE id = ?1 AND cancelled_at IS NULL').bind(t.id, nowIso(), user.id).run();
    if (r.meta.changes !== 1) return json({ cancelled: true, already: true });
    await log(env, request, user, institute.id, 'institute.test_cancel', { batch: batch.name, mode: t.mode, opensAt: t.opens_at });
    return json({ cancelled: true });
  });
}

/* ---------------- the student's side ---------------- */
/** The test, if this learner is in its batch now. → { t, batch, institute } */
async function studentTest(env, userId, tid) {
  if (!isId(tid, 'btst')) throw new HttpError(404, 'not_found', NOT_FOUND);
  const row = await env.DB.prepare(
    `SELECT t.*, b.name AS batch_name, i.name AS institute_name FROM batch_tests t
       JOIN institute_students s ON s.batch_id = t.batch_id AND s.user_id = ?2 AND s.status = 'active'
       JOIN batches b ON b.id = t.batch_id JOIN institutes i ON i.id = t.institute_id
      WHERE t.id = ?1 AND i.status <> 'closed'`
  ).bind(tid, userId).first();
  if (!row) throw new HttpError(404, 'not_found', "This test isn't for you, or you're no longer in its batch.");
  return row;
}
async function mine(env, t, userId) {
  const a = await env.DB.prepare(`SELECT a.*, r.id, r.net_wpm, r.gross_wpm, r.strokes, r.correct_strokes, r.kdph, r.mistakes_pct, r.seconds, r.passed
                                    FROM batch_test_attempts a LEFT JOIN exam_results r ON r.id = a.result_id WHERE a.test_id = ?1 AND a.user_id = ?2`).bind(t.id, userId).first();
  return a ? { starts: a.starts, submittedAt: a.submitted_at || null, result: resultView(a) } : { starts: 0, submittedAt: null, result: null };
}
export async function getMyTest(request, env, ctx, params) {
  const { user } = await requireSession(env, request);
  return later(async () => {
    const t = await studentTest(env, user.id, params.tid);
    return json({ test: testView(t), batch: { name: t.batch_name }, institute: { name: t.institute_name }, mine: await mine(env, t, user.id), now: nowIso() });
  });
}
export async function postStart(request, env, ctx, params) {
  const { user } = await requireSession(env, request);
  return later(async () => {
    const t = await studentTest(env, user.id, params.tid);
    const state = stateOf(t);
    if (state !== 'open') {
      throw new HttpError(409, `test_${state}`, state === 'upcoming' ? 'This test has not opened yet.' : state === 'cancelled' ? 'Your teacher cancelled this test.' : 'This test has closed.');
    }
    const now = nowIso();
    const r = await env.DB.prepare(`INSERT INTO batch_test_attempts (test_id, user_id, starts, first_started_at, last_started_at) VALUES (?1, ?2, 1, ?3, ?3)
                                    ON CONFLICT (test_id, user_id) DO UPDATE SET starts = starts + 1, last_started_at = excluded.last_started_at
                                    WHERE batch_test_attempts.result_id IS NULL`).bind(t.id, user.id, now).run();
    if (r.meta.changes !== 1) throw new HttpError(409, 'already', 'You have already taken this test. Your first result is the one that counts.');
    return json({ test: testView(t), mine: await mine(env, t, user.id) });
  });
}

/**
 * Called by POST /api/exams/results with a batchTestId, after the result is saved: it counts for the test if
 * it is this learner's first result for it, for the same test and passage, submitted in time after opening
 * the test in its window. → { counted, why?, batch? }
 */
export async function countResult(env, userId, testId, result) {
  let t;
  try { t = await studentTest(env, userId, testId); } catch (err) {
    if (err instanceof HttpError) return { counted: false, why: 'not_yours' };
    if (/no such table/i.test(String(err && err.message))) return { counted: false, why: 'not_ready' };
    throw err;
  }
  const out = { batch: { name: t.batch_name } };
  if (t.cancelled_at) return { ...out, counted: false, why: 'cancelled' };
  if (result.mode !== t.mode || result.passage_id !== t.passage_id) return { ...out, counted: false, why: 'other_test' };
  const a = await env.DB.prepare('SELECT result_id, last_started_at FROM batch_test_attempts WHERE test_id = ?1 AND user_id = ?2').bind(t.id, userId).first();
  if (!a || !a.last_started_at) return { ...out, counted: false, why: 'not_started' };
  if (a.result_id) return { ...out, counted: a.result_id === result.id, ...(a.result_id === result.id ? {} : { why: 'already' }) };
  // opened while the test was open, and submitted within the test's own time (and two minutes) of opening it
  const minutes = X.MODES[t.mode] ? X.MODES[t.mode].minutes : 15;
  const inTime = a.last_started_at >= t.opens_at && a.last_started_at < t.closes_at
    && Date.now() <= Date.parse(a.last_started_at) + minutes * MIN_MS + SUBMIT_GRACE_MS;
  if (!inTime) return { ...out, counted: false, why: 'late' };
  const r = await env.DB.prepare(
    `UPDATE batch_test_attempts SET result_id = ?3, submitted_at = ?4 WHERE test_id = ?1 AND user_id = ?2 AND result_id IS NULL AND last_started_at = ?5`
  ).bind(t.id, userId, result.id, nowIso(), a.last_started_at).run();
  if (r.meta.changes === 1) return { ...out, counted: true };
  const now = await env.DB.prepare('SELECT result_id FROM batch_test_attempts WHERE test_id = ?1 AND user_id = ?2').bind(t.id, userId).first();
  return now && now.result_id === result.id ? { ...out, counted: true } : { ...out, counted: false, why: now && now.result_id ? 'already' : 'late' };
}

/** For GET /api/me/batches: this batch's tests from the last week on, with where the learner is. */
export async function testsForStudent(env, batchId, userId) {
  const now = nowIso();
  let rows;
  try {
    rows = (await env.DB.prepare(
      `SELECT t.*, a.starts, a.submitted_at, r.passed, r.net_wpm FROM batch_tests t
         LEFT JOIN batch_test_attempts a ON a.test_id = t.id AND a.user_id = ?2 LEFT JOIN exam_results r ON r.id = a.result_id
        WHERE t.batch_id = ?1 AND t.cancelled_at IS NULL AND t.closes_at > ?3 ORDER BY t.opens_at LIMIT 10`
    ).bind(batchId, userId, new Date(Date.now() - 7 * DAY_MS).toISOString()).all()).results;
  } catch (err) {
    if (/no such table/i.test(String(err && err.message))) return [];
    throw err;
  }
  // open first, then the ones to come, then the closed ones
  const ORDER = { open: 0, upcoming: 1, closed: 2 };
  return rows.sort((a, b) => ORDER[stateOf(a, now)] - ORDER[stateOf(b, now)]).map((t) => ({ id: t.id, title: (X.MODES[t.mode] || { name: t.mode }).name, opensAt: t.opens_at, closesAt: t.closes_at, note: t.note,
    state: stateOf(t, now), mine: t.submitted_at ? (t.passed ? 'passed' : 'submitted') : t.starts ? 'started' : 'not_started',
    link: `/exam-practice?batchTest=${encodeURIComponent(t.id)}` }));
}

const ID = '([a-z]{3,4}_[0-9a-f]{20})';
const B = (method, tail, names, fn) => [method, new RegExp(`^/api/institutes/${ID}/batches/${ID}/tests${tail}$`), ['id', 'bid', ...names], fn];
export const ROUTES = {};
export const PATTERNS = [
  B('GET', '', [], getTests),
  B('POST', '', [], postTest),
  B('GET', `/${ID}`, ['tid'], getTest),
  B('GET', `/${ID}/results\\.csv`, ['tid'], getTestCsv),
  B('POST', `/${ID}/cancel`, ['tid'], postCancel),
  ['GET', new RegExp(`^/api/me/batch-tests/${ID}$`), ['tid'], getMyTest],
  ['POST', new RegExp(`^/api/me/batch-tests/${ID}/start$`), ['tid'], postStart],
];
