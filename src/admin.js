// Who is a Super Admin (OWNER_EMAILS) and the saving-health numbers that System health shows
// (src/console/system-api.js). The old owner page and its /api/admin/health went with the Phase 6 cutover.
import { nowIso } from './http.js';

export function isOwner(env, email) {
  const list = String(env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(String(email).toLowerCase());
}

/** The saving-health numbers (System health in the console). */
export async function healthNumbers(env) {
  const DB = env.DB;
  const now = nowIso();
  const today = now.slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const res = await DB.batch([
    DB.prepare('SELECT COUNT(*) AS n FROM users').bind(),
    DB.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE server_at >= ?1').bind(today),
    DB.prepare("SELECT COUNT(*) AS n FROM events WHERE server_at >= ?1 AND type IN ('run', 'game')").bind(today),
    DB.prepare('SELECT COUNT(*) AS n FROM events WHERE server_at >= ?1').bind(today),
    DB.prepare("SELECT COALESCE(SUM(CASE WHEN reason = 'busy' THEN 0 ELSE n END), 0) AS rejected, COALESCE(SUM(CASE WHEN reason = 'busy' THEN n ELSE 0 END), 0) AS failed FROM event_rejects WHERE day = ?1").bind(today),
    DB.prepare("SELECT COALESCE(SUM(CASE WHEN reason = 'busy' THEN 0 ELSE n END), 0) AS rejected, COALESCE(SUM(CASE WHEN reason = 'busy' THEN n ELSE 0 END), 0) AS failed FROM event_rejects WHERE day >= ?1").bind(weekAgo),
    DB.prepare('SELECT reason, SUM(n) AS n FROM event_rejects WHERE day >= ?1 GROUP BY reason ORDER BY n DESC').bind(weekAgo),
    DB.prepare('SELECT * FROM rebuild_runs ORDER BY id DESC LIMIT 1').bind(),
    DB.prepare('SELECT COUNT(*) AS n FROM feedback WHERE at >= ?1').bind(weekAgo),
  ]);
  const one = (i) => res[i].results[0] || {};
  const last = res[7].results[0] || null;
  let lastDiffs = [];
  if (last) {
    lastDiffs = (await DB.prepare('SELECT table_name, COUNT(*) AS n FROM rebuild_diffs WHERE run_id = ?1 GROUP BY table_name ORDER BY n DESC').bind(last.id).all()).results;
  }
  return {
    at: now,
    learners: one(0).n,
    activeToday: one(1).n,
    runsToday: one(2).n,
    eventsToday: one(3).n,
    rejectedToday: one(4).rejected, failedToday: one(4).failed,
    rejected7d: one(5).rejected, failed7d: one(5).failed,
    rejectReasons7d: res[6].results,
    feedback7d: one(8).n,
    lastRebuild: last ? { at: last.started_at, finishedAt: last.finished_at, users: last.users, differences: last.differences, errors: last.errors, byTable: lastDiffs } : null,
  };
}
