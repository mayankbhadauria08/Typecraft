// Student progress (docs/ADMIN-PHASE-3.md, step 4): how each learner is getting on.
//
//   GET /api/console/progress?q=&level=&activity=&stuck=&sort=&page=   progress.view   learners (staff left out)
//   GET /api/console/progress/:id                                      progress.view   one learner: every lesson, weak keys, practice by day
//
// Read from the tables the practice pipeline keeps (migration 0002): lesson_scores (each lesson),
// daily_totals (each learner's day, in their own time zone), key_stats, placement, user_totals.
// "Working on" a level: the level of the lesson after the furthest one finished, in course order.
// "Stuck": a lesson tried STUCK_TRIES times or more and not finished.
import '../../shared/course-meta.js';
import { HttpError, json } from '../http.js';
import { loadCourse, lessonTitle, levelName } from '../course-store.js';
import { entitlementsFor } from '../entitlements.js';
import { keyStatsSql } from '../key-stats.js';
import { requireAdmin } from './session.js';
import { permissionsFor } from './permissions.js';
import { Binder, pageOf, offsetOf, paged, like, oneOf, idParam, istDay, DAY_MS, PAGE_SIZE } from './lib.js';

const META = globalThis.TC_META;
export const STUCK_TRIES = 5;
const KEY_MIN = 20;            // a key's error rate counts once it has been typed this often
// course order and level of each lesson, as SQL (built from the course in code: no input in it)
const ORD_SQL = `CASE lesson_id ${META.ORDER.map((id, i) => `WHEN '${id}' THEN ${i}`).join(' ')} END`;
/** The order index range of the lessons of a level. */
const LEVEL_RANGE = Object.fromEntries(META.LEVELS.map((L) => {
  const idx = META.ORDER.map((id, i) => [id, i]).filter(([id]) => META.BY_ID[id].level === L.n).map(([, i]) => i);
  return [L.n, [Math.min(...idx), Math.max(...idx)]];
}));
/** The level a learner is working on, from the index of the furthest lesson finished (null: none). */
export const workingOn = (far) => (far == null ? 1 : far + 1 >= META.ORDER.length ? META.LEVELS[META.LEVELS.length - 1].n : META.BY_ID[META.ORDER[far + 1]].level);
export const ORDER_SQL = ORD_SQL;
export const allDone = (done) => done >= META.ORDER.length;

const SORTS = {
  recent: 'last_day IS NULL, last_day DESC, u.created_at DESC',
  done: 'done DESC, last_day DESC',
  speed: 'best DESC, last_day DESC',
  name: "COALESCE(NULLIF(u.full_name, ''), u.email) COLLATE NOCASE",
};

export async function getProgressList(request, env) {
  await requireAdmin(env, request, 'progress.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q);
  const text = (q.get('q') || '').trim().slice(0, 80);
  const level = oneOf(q.get('level') || '', META.LEVELS.map((L) => String(L.n)));
  const activity = oneOf(q.get('activity') || '', ['active7', 'quiet30', 'never']);
  const stuck = q.get('stuck') === '1';
  const sort = oneOf(q.get('sort') || '', Object.keys(SORTS), 'recent');
  const owners = [...new Set(String(env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
  const today = istDay(), d7 = istDay(Date.now() - 6 * DAY_MS), d30 = istDay(Date.now() - 29 * DAY_MS);

  const build = (b) => {
    // staff are left out: a row in admin_users, or a Super Admin email (OWNER_EMAILS)
    const where = ['NOT EXISTS (SELECT 1 FROM admin_users a WHERE a.user_id = u.id)'];
    if (owners.length) where.push(`LOWER(u.email) NOT IN (${owners.map((e) => b.p(e)).join(', ')})`);
    if (text) where.push(`(u.full_name LIKE ${b.once('q', like(text))} ESCAPE '\\' OR u.email LIKE ${b.once('q', like(text))} ESCAPE '\\')`);
    if (level) {
      const [lo, hi] = LEVEL_RANGE[Number(level)];
      // working on this level: the furthest lesson finished is just before it, or inside it (not its last)
      // (the last level also keeps those who finished its last lesson: there is nothing after it)
      const last = Number(level) === META.LEVELS[META.LEVELS.length - 1].n;
      where.push(level === '1' ? `(ls.far IS NULL OR ls.far < ${b.p(hi)})` : last ? `ls.far >= ${b.p(lo - 1)}` : `(ls.far >= ${b.p(lo - 1)} AND ls.far < ${b.p(hi)})`);
    }
    if (activity === 'active7') where.push(`dt.last_day >= ${b.p(d7)}`);
    if (activity === 'quiet30') where.push(`dt.last_day < ${b.p(d30)}`);
    if (activity === 'never') where.push('dt.last_day IS NULL');
    if (stuck) where.push('ls.stuck > 0');
    return `FROM users u
      LEFT JOIN (SELECT user_id, SUM(status = 'completed') AS done, MAX(best_wpm) AS best,
                        AVG(CASE WHEN status = 'completed' THEN best_accuracy END) AS acc,
                        MAX(CASE WHEN status = 'completed' THEN ${ORD_SQL} END) AS far,
                        SUM(CASE WHEN status <> 'completed' AND attempts >= ${STUCK_TRIES} THEN 1 ELSE 0 END) AS stuck
                   FROM lesson_scores GROUP BY user_id) ls ON ls.user_id = u.id
      LEFT JOIN (SELECT user_id, MAX(day) AS last_day, SUM(CASE WHEN day >= ${b.once('d30', d30)} THEN seconds ELSE 0 END) AS secs30
                   FROM daily_totals WHERE seconds > 0 GROUP BY user_id) dt ON dt.user_id = u.id
      WHERE ${where.join(' AND ')}`;
  };
  const lb = new Binder(), cb = new Binder();
  const listSql = `SELECT u.id, u.full_name, u.email, u.created_at, COALESCE(ls.done, 0) AS done, COALESCE(ls.best, 0) AS best, ls.acc, ls.far,
      COALESCE(ls.stuck, 0) AS stuck, dt.last_day, COALESCE(dt.secs30, 0) AS secs30 ${build(lb)}
      ORDER BY ${SORTS[sort]} LIMIT ${PAGE_SIZE} OFFSET ${offsetOf(page)}`;
  const countSql = `SELECT COUNT(*) AS n ${build(cb)}`;
  const [rows, count] = await env.DB.batch([env.DB.prepare(listSql).bind(...lb.args), env.DB.prepare(countSql).bind(...cb.args)]);
  const { edits } = await loadCourse(env);
  return json({
    ...paged(rows.results.map((r) => ({
      id: r.id, fullName: r.full_name, email: r.email, joinedAt: r.created_at,
      lessonsDone: r.done, finished: allDone(r.done), level: workingOn(r.far), levelName: levelName(edits, workingOn(r.far)),
      bestWpm: Math.round(r.best), accuracy: r.acc == null ? null : Math.round(r.acc * 10) / 10,
      stuck: r.stuck, lastPractice: r.last_day, minutes30: Math.round(r.secs30 / 60),
    })), page, count.results[0].n),
    today, levels: META.LEVELS.map((L) => ({ id: String(L.n), name: `Level ${L.n}: ${levelName(edits, L.n)}` })), totalLessons: META.ORDER.length,
  });
}

export async function getProgressOne(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'progress.view');
  const id = idParam(params.id, 'There is no learner with this ID.');
  const p = await progressOf(env, id);
  if (!p) throw new HttpError(404, 'not_found', 'There is no learner with this ID.');
  const perms = await permissionsFor(env, who.role);
  let plan = null;
  try { const ent = await entitlementsFor(env, id); plan = { name: ent.planName, lessons: ent.lessonsWords.Text }; } catch { plan = null; }
  const { user, ...view } = p;
  return json({
    learner: { id: user.id, fullName: user.full_name, email: user.email, joinedAt: user.created_at, disabled: user.account_status !== 'active' },
    plan,
    ...view,
    can: { customer: perms.includes('customers.view') },
  });
}

/**
 * One learner's progress: every lesson, a summary, weak keys and practice by day for 30 days. Shared by the
 * console (Student progress) and an institute's student page (src/institute-reports.js). → null when there is
 * no such learner. The numbers are the same wherever they are shown.
 */
export async function progressOf(env, id) {
  const DB = env.DB;
  const since = istDay(Date.now() - 29 * DAY_MS);
  const [u, scores, keys, days, place, totals, all] = await DB.batch([
    DB.prepare('SELECT id, full_name, email, created_at, account_status FROM users WHERE id = ?1').bind(id),
    DB.prepare('SELECT lesson_id, status, stars, crown, best_wpm, best_accuracy, attempts, last_played, completed_at FROM lesson_scores WHERE user_id = ?1').bind(id),
    DB.prepare(`SELECT k, attempts, errors FROM (${keyStatsSql('?1')}) WHERE attempts >= ${KEY_MIN} ORDER BY CAST(errors AS REAL) / attempts DESC, attempts DESC LIMIT 10`).bind(id),
    DB.prepare('SELECT day, seconds, best_wpm, acc_sum, acc_count FROM daily_totals WHERE user_id = ?1 AND day >= ?2 ORDER BY day').bind(id, since),
    DB.prepare('SELECT level, wpm, accuracy, at FROM placement WHERE user_id = ?1').bind(id),
    DB.prepare('SELECT xp, streak_count, streak_best FROM user_totals WHERE user_id = ?1').bind(id),
    DB.prepare('SELECT COALESCE(SUM(seconds), 0) AS secs, MAX(CASE WHEN seconds > 0 THEN day END) AS last_day FROM daily_totals WHERE user_id = ?1').bind(id),
  ]);
  const user = u.results[0];
  if (!user) return null;
  const { edits } = await loadCourse(env);
  const by = new Map(scores.results.map((s) => [s.lesson_id, s]));
  let far = null, done = 0, stars = 0, crowns = 0, best = 0, accSum = 0;
  const lessons = META.ORDER.map((lid, i) => {
    const s = by.get(lid), m = META.BY_ID[lid];
    if (s && s.status === 'completed') { far = i; done++; accSum += s.best_accuracy; }
    if (s) { stars += s.stars; crowns += s.crown; best = Math.max(best, s.best_wpm); }
    return { id: lid, n: m.n, level: m.level, kind: m.kind, title: lessonTitle(edits, lid), status: s ? s.status : 'not_started',
      stars: s ? s.stars : 0, crown: !!(s && s.crown), bestWpm: s ? Math.round(s.best_wpm) : 0, bestAccuracy: s ? Math.round(s.best_accuracy * 10) / 10 : 0,
      attempts: s ? s.attempts : 0, lastPlayed: s ? s.last_played : null, stuck: !!(s && s.status !== 'completed' && s.attempts >= STUCK_TRIES) };
  });
  const xp = totals.results[0] ? totals.results[0].xp : 0;
  return {
    user,
    summary: {
      lessonsDone: done, totalLessons: META.ORDER.length, level: workingOn(far), levelName: levelName(edits, workingOn(far)), finished: allDone(done),
      bestWpm: Math.round(best), accuracy: done ? Math.round((accSum / done) * 10) / 10 : null, stars, crowns,
      minutes: Math.round(all.results[0].secs / 60), lastPractice: all.results[0].last_day,
      xp, rank: META.rankFor(xp).name, streak: totals.results[0] ? { now: totals.results[0].streak_count, best: totals.results[0].streak_best } : { now: 0, best: 0 },
      stuck: lessons.filter((l) => l.stuck).length,
    },
    placement: place.results[0] ? { level: place.results[0].level, wpm: Math.round(place.results[0].wpm), accuracy: Math.round(place.results[0].accuracy), at: place.results[0].at } : null,
    lessons,
    levels: META.LEVELS.map((L) => ({ n: L.n, name: levelName(edits, L.n) })),
    weakKeys: keys.results.map((k) => ({ key: k.k, attempts: k.attempts, errors: k.errors, rate: Math.round((k.errors / k.attempts) * 1000) / 10 })),
    days: days.results.map((d) => ({ day: d.day, minutes: Math.round((d.seconds / 60) * 10) / 10, bestWpm: Math.round(d.best_wpm), accuracy: d.acc_count ? Math.round(d.acc_sum / d.acc_count) : null })),
    since, today: istDay(),
  };
}

export const ROUTES = { 'GET /api/console/progress': getProgressList };
export const PATTERNS = [['GET', /^\/api\/console\/progress\/([\w-]{1,64})$/, ['id'], getProgressOne]];
