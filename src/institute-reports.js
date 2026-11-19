// What an institute's staff see about their students' typing (docs/INSTITUTES.md §9).
//
//   GET /api/institutes/:id/batches/:bid/report          staff of the batch   one row per student: lessons, level, speed, accuracy,
//                                                                              practice this week, last practised, weak keys
//   GET /api/institutes/:id/batches/:bid/report.csv      staff of the batch   the same as a spreadsheet
//   GET /api/institutes/:id/students/:mid                staff of the batch   one student: every lesson, practice by day, weak keys,
//                                                                              recent exam practice
//   GET /api/institutes/:id/batches/:bid/certificates    staff of the batch   the certificate to print for each student
//
// Only numbers TypeCraft saved from the student's own practice: nothing here can be typed in by staff.
// A teacher sees the students of their batches only (src/institute-access.js).
import '../shared/course-meta.js';
import '../shared/exam-rules.js';
import { HttpError, json, nowIso } from './http.js';
import { isId, requireStaff, requireBatch } from './institute-access.js';
import { keyStatsManySql } from './key-stats.js';
import { loadCourse, levelName } from './course-store.js';
import { progressOf, workingOn, ORDER_SQL } from './console/progress-api.js';
import { csvResponse } from './console/lib.js';
import { codeFor, levelView, examView } from './exams.js';

const META = globalThis.TC_META;
const X = globalThis.TC_EXAMS;
const IST_MS = 330 * 60000, DAY_MS = 86400000;
const istDay = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const KEY_MIN = 20; // a key counts as weak once typed this often (as in the console)
const r1 = (x) => Math.round(x * 10) / 10;

/* ---------------- the batch report ---------------- */
async function batchReport(env, batch) {
  const DB = env.DB;
  const since = istDay(Date.now() - 6 * DAY_MS);
  const inBatch = (col) => `${col} IN (SELECT user_id FROM institute_students WHERE batch_id = ?1 AND status = 'active')`;
  const [rows, keys] = await DB.batch([
    DB.prepare(`SELECT s.id AS seat_id, s.joined_at, u.id AS user_id, u.full_name, u.email,
                       (SELECT COUNT(*) FROM lesson_scores l WHERE l.user_id = s.user_id AND l.status = 'completed') AS done,
                       (SELECT MAX(${ORDER_SQL}) FROM lesson_scores l WHERE l.user_id = s.user_id AND l.status = 'completed') AS far,
                       (SELECT MAX(best_wpm) FROM lesson_scores l WHERE l.user_id = s.user_id) AS best,
                       (SELECT AVG(best_accuracy) FROM lesson_scores l WHERE l.user_id = s.user_id AND l.status = 'completed') AS acc,
                       (SELECT COALESCE(SUM(seconds), 0) FROM daily_totals d WHERE d.user_id = s.user_id AND d.day >= ?2) AS week_secs,
                       (SELECT MAX(day) FROM daily_totals d WHERE d.user_id = s.user_id AND d.seconds > 0) AS last_day
                  FROM institute_students s JOIN users u ON u.id = s.user_id
                 WHERE s.batch_id = ?1 AND s.status = 'active' ORDER BY u.full_name COLLATE NOCASE, u.email`).bind(batch.id, since),
    DB.prepare(`SELECT user_id, k, attempts, errors FROM (${keyStatsManySql(inBatch)}) WHERE attempts >= ${KEY_MIN}`).bind(batch.id),
  ]);
  const weak = new Map();
  for (const k of keys.results) {
    const list = weak.get(k.user_id) || [];
    list.push({ key: k.k, rate: r1((k.errors / k.attempts) * 100) });
    weak.set(k.user_id, list);
  }
  const { edits } = await loadCourse(env);
  return {
    since, totalLessons: META.ORDER.length,
    students: rows.results.map((r) => {
      const level = workingOn(r.far);
      // the three keys with the most mistakes, worst first; a key with no mistakes isn't weak
      const keysOf = (weak.get(r.user_id) || []).filter((k) => k.rate > 0).sort((a, b) => b.rate - a.rate).slice(0, 3);
      return {
        id: r.seat_id, name: r.full_name || null, email: r.email, joinedAt: r.joined_at,
        lessonsDone: r.done, level, levelName: levelName(edits, level), bestWpm: Math.round(r.best || 0), accuracy: r.acc == null ? null : r1(r.acc),
        minutesThisWeek: Math.round(r.week_secs / 60), lastDay: r.last_day || null, weakKeys: keysOf,
      };
    }),
  };
}

export async function getReport(request, env, ctx, params) {
  const { staff, institute, batch } = await requireBatch(env, request, params.id, params.bid);
  const report = await batchReport(env, batch);
  return json({ role: staff.role, institute: { id: institute.id, name: institute.name }, batch: { id: batch.id, name: batch.name }, ...report, today: istDay() });
}

const keyWord = (k) => (k === ' ' ? 'space' : k);
export async function getReportCsv(request, env, ctx, params) {
  const { institute, batch } = await requireBatch(env, request, params.id, params.bid);
  const report = await batchReport(env, batch);
  const header = ['Name', 'Email', 'Joined', 'Lessons done', `Of ${report.totalLessons}`, 'Working on', 'Best speed (wpm)', 'Accuracy (%)',
    'Minutes in the last 7 days', 'Last practised', 'Weak keys (mistakes %)'];
  const rows = report.students.map((s) => [s.name || '', s.email, istDay(Date.parse(s.joinedAt)), s.lessonsDone, report.totalLessons,
    `Level ${s.level}: ${s.levelName}`, s.bestWpm, s.accuracy == null ? '' : s.accuracy, s.minutesThisWeek, s.lastDay || '',
    s.weakKeys.map((k) => `${keyWord(k.key)} ${k.rate}%`).join(', ')]);
  const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'batch';
  return csvResponse(`typecraft-${slug(institute.name)}-${slug(batch.name)}-${istDay()}.csv`, header, rows);
}

/* ---------------- one student ---------------- */
export async function getStudent(request, env, ctx, params) {
  const { staff, institute } = await requireStaff(env, request, params.id);
  const NOT_FOUND = 'This student is not in your batches.';
  if (!isId(params.mid, 'mem')) throw new HttpError(404, 'not_found', NOT_FOUND);
  const DB = env.DB;
  const seat = await DB.prepare(
    `SELECT s.*, b.name AS batch_name, EXISTS (SELECT 1 FROM batch_teachers t WHERE t.batch_id = s.batch_id AND t.staff_id = ?3) AS mine
       FROM institute_students s JOIN batches b ON b.id = s.batch_id WHERE s.id = ?1 AND s.institute_id = ?2 AND s.status = 'active'`
  ).bind(params.mid, institute.id, staff.id).first();
  if (!seat || (staff.role !== 'admin' && !seat.mine)) throw new HttpError(404, 'not_found', NOT_FOUND);
  const p = await progressOf(env, seat.user_id);
  if (!p) throw new HttpError(404, 'not_found', NOT_FOUND);
  let exams = [];
  try {
    exams = (await DB.prepare('SELECT * FROM exam_results WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 10').bind(seat.user_id).all()).results.map((e) => {
      const M = X.MODES[e.mode] || { name: e.mode };
      return { mode: e.mode, modeName: M.name, netWpm: e.net_wpm, grossWpm: e.gross_wpm, kdph: e.kdph, mistakesPct: e.mistakes_pct, passed: !!e.passed, at: e.created_at };
    });
  } catch (err) { if (!/no such table/i.test(String(err && err.message))) throw err; }
  const { user, ...view } = p;
  return json({
    role: staff.role, institute: { id: institute.id, name: institute.name },
    student: { id: seat.id, name: user.full_name || null, email: user.email, joinedAt: seat.joined_at, batch: { id: seat.batch_id, name: seat.batch_name } },
    ...view, exams,
  });
}

/* ---------------- certificates to print ---------------- */
/**
 * For each student, the certificate to print: their highest course speed certificate, or else their best
 * passed exam-practice result that has a certificate. Course certificates get their code here if they have
 * none yet (as when the student opens Certificates); a code the student stopped sharing isn't printed.
 */
export async function getCertificates(request, env, ctx, params) {
  const { institute, batch } = await requireBatch(env, request, params.id, params.bid);
  const DB = env.DB;
  const [students, levels] = await DB.batch([
    DB.prepare(`SELECT s.id, u.id AS user_id, u.full_name, u.email FROM institute_students s JOIN users u ON u.id = s.user_id
                 WHERE s.batch_id = ?1 AND s.status = 'active' ORDER BY u.full_name COLLATE NOCASE, u.email`).bind(batch.id),
    DB.prepare(`SELECT c.* FROM certificates c WHERE c.user_id IN (SELECT user_id FROM institute_students WHERE batch_id = ?1 AND status = 'active')
                 ORDER BY c.level DESC`).bind(batch.id),
  ]);
  let examRows = [];
  try {
    examRows = (await DB.prepare(
      `SELECT e.*, c.code, c.shared FROM exam_results e JOIN certificate_codes c ON c.kind = 'exam' AND c.ref = e.id AND c.user_id = e.user_id
        WHERE e.passed = 1 AND e.user_id IN (SELECT user_id FROM institute_students WHERE batch_id = ?1 AND status = 'active')
        ORDER BY e.net_wpm DESC`).bind(batch.id).all()).results;
  } catch (err) { if (!/no such table/i.test(String(err && err.message))) throw err; }
  const best = new Map(), bestExam = new Map();
  for (const l of levels.results) if (!best.has(l.user_id)) best.set(l.user_id, l);
  for (const e of examRows) if (!bestExam.has(e.user_id)) bestExam.set(e.user_id, e);
  const out = [];
  for (const s of students.results) {
    let cert = null;
    const l = best.get(s.user_id);
    if (l) {
      let code = null;
      try { code = await codeFor(env, s.user_id, 'level', String(l.level)); } catch (err) { if (!/no such table/i.test(String(err && err.message))) throw err; }
      cert = levelView(l, code);
    } else if (bestExam.has(s.user_id)) {
      const e = bestExam.get(s.user_id);
      cert = examView(e, { code: e.code, shared: e.shared });
    }
    if (cert && !cert.shared) cert.code = null; // the student stopped sharing it: printed without a code
    out.push({ id: s.id, name: s.full_name || s.email, certificate: cert ? { kind: cert.kind, title: cert.title, test: cert.test, wpm: cert.wpm, accuracy: cert.accuracy,
      seconds: cert.seconds, at: cert.at, code: cert.code } : null });
  }
  return json({ institute: { id: institute.id, name: institute.name }, batch: { id: batch.id, name: batch.name }, students: out, checkedAt: nowIso() });
}

const ID = '([a-z]{3,4}_[0-9a-f]{20})';
const I = (method, tail, names, fn) => [method, new RegExp(`^/api/institutes/${ID}${tail}$`), ['id', ...names], fn];
export const ROUTES = {};
export const PATTERNS = [
  I('GET', `/batches/${ID}/report`, ['bid'], getReport),
  I('GET', `/batches/${ID}/report\\.csv`, ['bid'], getReportCsv),
  I('GET', `/batches/${ID}/certificates`, ['bid'], getCertificates),
  I('GET', `/students/${ID}`, ['mid'], getStudent),
];
