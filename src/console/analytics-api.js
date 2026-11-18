// Learning analytics (docs/ADMIN-PHASE-3.md, step 5): how learners as a whole are getting on.
//
//   GET /api/console/learning-analytics?range=7d|30d|90d    analytics.view
//
// Read only, from the tables practice already fills. Staff (admin_users and the OWNER_EMAILS
// accounts) are left out everywhere. Practice figures cover the chosen period, each with the same
// figure for the period just before; how far learners get, the hardest lessons, placement, speed
// and weak keys are counted over all time (the tables keep each learner's best, not a history).
import '../../shared/course-meta.js';
import { json, nowIso } from '../http.js';
import { loadCourse, lessonTitle, levelName } from '../course-store.js';
import { requireAdmin } from './session.js';
import { Binder, oneOf, istDay, istDayStart, istDayEnd, DAY_MS } from './lib.js';
import { STUCK_TRIES, workingOn } from './progress-api.js';

const META = globalThis.TC_META;
const RANGES = { '7d': 7, '30d': 30, '90d': 90 };
export const MIN_TRIED = 5;      // a lesson is ranked once this many learners have tried it
export const KEY_MIN = 200;      // a key is ranked once it has been typed this often, by everyone together
export const SPEED_BANDS = [[0, 20], [20, 30], [30, 40], [40, 50], [50, null]];
const ORD_SQL = `CASE lesson_id ${META.ORDER.map((id, i) => `WHEN '${id}' THEN ${i}`).join(' ')} END`;
const LEVEL_SQL = `CASE lesson_id ${META.ORDER.map((id) => `WHEN '${id}' THEN ${META.BY_ID[id].level}`).join(' ')} END`;
const LEVEL_SIZE = Object.fromEntries(META.LEVELS.map((L) => [L.n, META.ORDER.filter((id) => META.BY_ID[id].level === L.n).length]));
const SIZE_SQL = `CASE lvl ${META.LEVELS.map((L) => `WHEN ${L.n} THEN ${LEVEL_SIZE[L.n]}`).join(' ')} END`;

const ownersOf = (env) => [...new Set(String(env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
/** SQL that leaves staff out, for a column holding a user id. */
function learnersOnly(b, col, owners) {
  // NOT IN, not NOT EXISTS: a bare column name inside the subquery would mean the subquery's own column
  const parts = [`${col} NOT IN (SELECT user_id FROM admin_users WHERE user_id IS NOT NULL)`];
  if (owners.length) parts.push(`${col} NOT IN (SELECT id FROM users WHERE LOWER(email) IN (${owners.map((e) => b.p(e)).join(', ')}))`);
  return parts.join(' AND ');
}
const round1 = (x) => Math.round(x * 10) / 10;

export async function getLearningAnalytics(request, env) {
  await requireAdmin(env, request, 'analytics.view');
  const range = oneOf(new URL(request.url).searchParams.get('range'), Object.keys(RANGES), '30d');
  const n = RANGES[range];
  const today = istDay(), first = istDay(Date.now() - (n - 1) * DAY_MS), before = istDay(Date.now() - (2 * n - 1) * DAY_MS);
  const owners = ownersOf(env), DB = env.DB;
  const stmt = (fn) => { const b = new Binder(); const sql = fn(b); return DB.prepare(sql).bind(...b.args); };

  const [learners, practice, chart, finished, funnel, far, hardest, placement, speed, keys] = await DB.batch([
    stmt((b) => `SELECT COUNT(*) AS n FROM users u WHERE ${learnersOnly(b, 'u.id', owners)}`),
    stmt((b) => `SELECT COUNT(DISTINCT CASE WHEN day >= ${b.once('first', first)} THEN user_id END) AS cur,
                        COUNT(DISTINCT CASE WHEN day < ${b.once('first', first)} THEN user_id END) AS prev,
                        COALESCE(SUM(CASE WHEN day >= ${b.once('first', first)} THEN seconds END), 0) AS secs,
                        COALESCE(SUM(CASE WHEN day < ${b.once('first', first)} THEN seconds END), 0) AS prev_secs
                   FROM daily_totals WHERE seconds > 0 AND day >= ${b.p(before)} AND day <= ${b.once('today', today)} AND ${learnersOnly(b, 'user_id', owners)}`),
    stmt((b) => `SELECT day, COUNT(*) AS learners, SUM(seconds) AS secs FROM daily_totals
                  WHERE seconds > 0 AND day >= ${b.p(first)} AND day <= ${b.p(today)} AND ${learnersOnly(b, 'user_id', owners)} GROUP BY day ORDER BY day`),
    stmt((b) => `SELECT COALESCE(SUM(completed_at >= ${b.once('c0', istDayStart(first))} AND completed_at < ${b.once('c1', istDayEnd(today))}), 0) AS cur,
                        COALESCE(SUM(completed_at >= ${b.p(istDayStart(before))} AND completed_at < ${b.once('c0', istDayStart(first))}), 0) AS prev
                   FROM lesson_scores WHERE completed_at IS NOT NULL AND ${learnersOnly(b, 'user_id', owners)}`),
    // per level: learners who started it (any lesson tried) and who finished every lesson of it
    stmt((b) => `SELECT lvl, COUNT(*) AS started, SUM(done >= ${SIZE_SQL}) AS finished FROM (
                   SELECT user_id, ${LEVEL_SQL} AS lvl, SUM(status = 'completed') AS done FROM lesson_scores
                    WHERE (status <> 'not_started' OR attempts > 0) AND ${learnersOnly(b, 'user_id', owners)} GROUP BY user_id, lvl
                 ) WHERE lvl IS NOT NULL GROUP BY lvl`),
    // the furthest lesson each learner has finished, counted: gives the level they are working on
    stmt((b) => `SELECT far, COUNT(*) AS n, SUM(done >= ${META.ORDER.length}) AS all_done FROM (
                   SELECT user_id, MAX(CASE WHEN status = 'completed' THEN ${ORD_SQL} END) AS far, SUM(status = 'completed') AS done
                     FROM lesson_scores WHERE ${learnersOnly(b, 'user_id', owners)} GROUP BY user_id
                 ) WHERE far IS NOT NULL GROUP BY far`),
    stmt((b) => `SELECT lesson_id, COUNT(*) AS tried, SUM(status = 'completed') AS finished,
                        SUM(status <> 'completed' AND attempts >= ${STUCK_TRIES}) AS stuck, AVG(attempts) AS tries
                   FROM lesson_scores WHERE attempts > 0 AND ${learnersOnly(b, 'user_id', owners)} GROUP BY lesson_id`),
    stmt((b) => `SELECT level, COUNT(*) AS n, AVG(wpm) AS wpm FROM placement WHERE ${learnersOnly(b, 'user_id', owners)} GROUP BY level ORDER BY level`),
    stmt((b) => `SELECT ${SPEED_BANDS.map(([lo, hi], i) => `SUM(best >= ${lo}${hi == null ? '' : ` AND best < ${hi}`}) AS b${i}`).join(', ')} FROM (
                   SELECT user_id, MAX(best_wpm) AS best FROM lesson_scores WHERE best_wpm > 0 AND ${learnersOnly(b, 'user_id', owners)} GROUP BY user_id)`),
    stmt((b) => `SELECT k, SUM(attempts) AS attempts, SUM(errors) AS errors, COUNT(*) AS learners FROM key_stats
                  WHERE ${learnersOnly(b, 'user_id', owners)} GROUP BY k HAVING SUM(attempts) >= ${KEY_MIN}
                  ORDER BY CAST(SUM(errors) AS REAL) / SUM(attempts) DESC, SUM(attempts) DESC LIMIT 10`),
  ]);
  const { edits } = await loadCourse(env);
  const total = learners.results[0].n;
  const p = practice.results[0], f = finished.results[0];

  // how far learners get
  const started = new Map(funnel.results.map((r) => [r.lvl, r]));
  const working = Object.fromEntries(META.LEVELS.map((L) => [L.n, 0]));
  let withLessons = 0, allDone = 0;
  for (const r of far.results) {
    withLessons += r.n; allDone += r.all_done;
    working[workingOn(r.far)] += r.n - (META.LEVELS.at(-1).n === workingOn(r.far) ? r.all_done : 0);
  }
  working[1] += total - withLessons; // no lesson finished yet: working on Level 1
  const levels = META.LEVELS.map((L) => {
    const s = started.get(L.n) || { started: 0, finished: 0 };
    return { n: L.n, name: levelName(edits, L.n), lessons: LEVEL_SIZE[L.n], started: s.started, finished: s.finished, workingOn: working[L.n] };
  });

  const byDay = new Map(chart.results.map((r) => [r.day, r]));
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = istDay(Date.now() - i * DAY_MS), r = byDay.get(day);
    days.push({ day, learners: r ? r.learners : 0, minutes: r ? Math.round(r.secs / 60) : 0 });
  }
  const minutes = Math.round(p.secs / 60), prevMinutes = Math.round(p.prev_secs / 60);
  const hard = hardest.results.filter((r) => r.tried >= MIN_TRIED && META.BY_ID[r.lesson_id])
    .map((r) => ({ id: r.lesson_id, n: META.BY_ID[r.lesson_id].n, level: META.BY_ID[r.lesson_id].level, title: lessonTitle(edits, r.lesson_id),
      tried: r.tried, finished: r.finished, stuck: r.stuck, tries: round1(r.tries), stuckShare: r.stuck / r.tried, finishShare: r.finished / r.tried }))
    .filter((r) => r.stuck > 0)   // a lesson someone is still on is not hard by itself: being stuck on it is
    .sort((a, b) => b.stuckShare - a.stuckShare || b.tries - a.tries || a.finishShare - b.finishShare)
    .slice(0, 10)
    .map(({ stuckShare, finishShare, ...r }) => r);
  const sp = speed.results[0] || {};

  return json({
    range, from: first, to: today, previous: { from: before, to: istDay(Date.now() - n * DAY_MS) },
    learners: total,
    practice: {
      learners: { now: p.cur, before: p.prev },
      minutes: { now: minutes, before: prevMinutes },
      perLearner: { now: p.cur ? Math.round(minutes / p.cur) : 0, before: p.prev ? Math.round(prevMinutes / p.prev) : 0 },
      lessonsFinished: { now: f.cur, before: f.prev },
    },
    days,
    levels, notStarted: total - withLessons, finishedCourse: allDone,
    hardest: hard, minTried: MIN_TRIED, stuckTries: STUCK_TRIES,
    placement: { taken: placement.results.reduce((s, r) => s + r.n, 0), byLevel: META.LEVELS.map((L) => {
      const r = placement.results.find((x) => x.level === L.n);
      return { n: L.n, name: levelName(edits, L.n), learners: r ? r.n : 0, wpm: r ? Math.round(r.wpm) : null };
    }) },
    speed: SPEED_BANDS.map(([lo, hi], i) => ({ from: lo, to: hi, learners: sp['b' + i] || 0 })),
    weakKeys: keys.results.map((k) => ({ key: k.k, attempts: k.attempts, errors: k.errors, learners: k.learners, rate: round1((k.errors / k.attempts) * 100) })),
    keyMin: KEY_MIN,
    at: nowIso(),
  });
}

export const ROUTES = { 'GET /api/console/learning-analytics': getLearningAnalytics };
