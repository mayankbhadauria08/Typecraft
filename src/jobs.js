// The background jobs' record (docs/ADMIN-PHASE-5.md §3): every cron run writes one job_runs row with how each
// part did, so System health can show "last run, all fine" or what failed. When a part fails, the Super Admins
// get an email (at most one every 6 hours for each schedule), so a problem is noticed long before restore
// points run out (7 days on Workers Free).
//
// Before migration 0017 there is no job_runs table: the jobs run exactly as before and nothing is recorded.
import { nowIso } from './http.js';
import { hitLimit, emailEnabled } from './session.js';
import { sendTemplate } from './mail.js';
import { CONSOLE_BASE } from './console/config.js';

export const SCHEDULES = {
  '*/10 * * * *': { label: 'Every 10 minutes', everyMin: 10 },
  '17 21 * * *': { label: 'Nightly (02:47 India time)', everyMin: 24 * 60 },
};
const ALERT_EVERY_S = 6 * 3600;
const clip = (v) => String((v && v.message) || v || 'failed').replace(/\s+/g, ' ').slice(0, 300);
export const ownerEmails = (env) => [...new Set(String(env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean))];

async function start(env, schedule, at) {
  try {
    const r = await env.DB.prepare('INSERT INTO job_runs (schedule, started_at) VALUES (?1, ?2)').bind(schedule, at).run();
    return r.meta && r.meta.last_row_id != null ? r.meta.last_row_id : null;
  } catch { return null; } // before migration 0017
}

/**
 * Runs the parts of one cron run in order, each on its own (one failing never stops the next), and records them.
 * parts: [[name, async () => …]]. → { ok, failed, parts: { name: 'ok' | error } }
 */
export async function runJobs(env, ctx, schedule, parts) {
  const t0 = Date.now(), startedAt = nowIso();
  const id = await start(env, schedule, startedAt);
  const out = {};
  const failures = [];
  for (const [name, fn] of parts) {
    try { await fn(); out[name] = 'ok'; } catch (err) {
      const msg = clip(err);
      out[name] = msg;
      failures.push({ part: name, error: msg });
      console.error(`cron part failed (${name}):`, msg);
    }
  }
  if (id != null) {
    try {
      await env.DB.prepare('UPDATE job_runs SET finished_at = ?2, ok = ?3, failed = ?4, parts = ?5, ms = ?6 WHERE id = ?1')
        .bind(id, nowIso(), failures.length ? 0 : 1, failures.length, JSON.stringify(out), Date.now() - t0).run();
    } catch (err) { console.error('job record failed:', err && err.message); }
  }
  if (failures.length) await alertOwners(env, ctx, schedule, failures);
  return { ok: !failures.length, failed: failures.length, parts: out };
}

/** Tells the Super Admins a background job failed: once per schedule every 6 hours, never more. */
export async function alertOwners(env, ctx, schedule, failures) {
  try {
    if (!emailEnabled(env)) return false;
    const to = ownerEmails(env);
    if (!to.length) return false;
    if (!(await hitLimit(env, `job-alert:${schedule}`, 1, ALERT_EVERY_S))) return false;
    for (const email of to) {
      await sendTemplate(env, null, { to: email, template: 'system_alert', category: 'security',
        data: { title: `A background job failed: ${(SCHEDULES[schedule] || { label: schedule }).label.toLowerCase()}`,
          failures, link: `${CONSOLE_BASE}/system-health` } });
    }
    return true;
  } catch (err) {
    console.error('job alert failed:', err && err.message);
    return false;
  }
}

/** Nightly: the record keeps 30 days. */
export async function pruneJobRuns(env) {
  try {
    await env.DB.prepare('DELETE FROM job_runs WHERE started_at < ?1').bind(new Date(Date.now() - 30 * 86400000).toISOString()).run();
  } catch (err) {
    if (!/no such table/i.test(String(err && err.message))) throw err;
  }
}
