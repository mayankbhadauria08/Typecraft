// The Monday email to an institute's teachers and admins (docs/INSTITUTES.md §17). Migration 0013.
// One email a week per person, covering every batch they teach (admins: every batch of their institute):
// how many students practised last week (Monday to Sunday, India time), who practised most, who didn't.
//
//   GET /api/me/institute-email      signed in   { weekly } (on unless switched off)
//   PUT /api/me/institute-email      signed in   { weekly: true | false }
//   Cron '17 21 * * *' (02:47 on Monday in India, from the nightly run): sendWeekly.
import { HttpError, json, readJson, fieldError, nowIso } from './http.js';
import { requireSession } from './session.js';
import { sendTemplate, siteUrl } from './mail.js';

const IST_MS = 330 * 60000, DAY_MS = 86400000;
const istDay = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
const words = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const NOT_READY = "The weekly email isn't switched on yet.";
const noTable = (err) => /no such table/i.test(String(err && err.message));
export const TOP = 3, QUIET = 12;

/** "4 h 10 min", "35 min" */
export function duration(seconds) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}

/* ---------------- the setting ---------------- */
export async function getSetting(request, env) {
  const { user } = await requireSession(env, request);
  try {
    const row = await env.DB.prepare('SELECT weekly FROM institute_email_settings WHERE user_id = ?1').bind(user.id).first();
    return json({ weekly: !row || !!row.weekly });
  } catch (err) { if (noTable(err)) throw new HttpError(503, 'weekly_not_ready', NOT_READY); throw err; }
}
export async function putSetting(request, env) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request, 1024);
  if (typeof body.weekly !== 'boolean') throw fieldError({ weekly: 'Choose on or off.' });
  try {
    await env.DB.prepare(`INSERT INTO institute_email_settings (user_id, weekly, updated_at) VALUES (?1, ?2, ?3)
                          ON CONFLICT (user_id) DO UPDATE SET weekly = excluded.weekly, updated_at = excluded.updated_at`).bind(user.id, body.weekly ? 1 : 0, nowIso()).run();
  } catch (err) { if (noTable(err)) throw new HttpError(503, 'weekly_not_ready', NOT_READY); throw err; }
  return json({ weekly: body.weekly });
}

/* ---------------- the email ---------------- */
/**
 * Sends last week's summary, once per person per week (the claim row in institute_weekly_emails). Only on a
 * Monday in India unless `force`. → { week, sent, skipped }
 */
export async function sendWeekly(env, ctx, now = Date.now(), { force = false } = {}) {
  const today = istDay(now);
  const out = { week: today, sent: 0, skipped: 0 };
  if (!force && new Date(today + 'T12:00:00Z').getUTCDay() !== 1) return out;
  const from = addDays(today, -7), to = addDays(today, -1);
  const DB = env.DB, nowText = new Date(now).toISOString();
  let institutes;
  try {
    await DB.prepare('SELECT 1 FROM institute_weekly_emails LIMIT 1').first();
    institutes = (await DB.prepare(`SELECT id, name FROM institutes WHERE status = 'active' AND starts_at <= ?1 AND ends_at > ?1 ORDER BY name LIMIT 500`).bind(nowText).all()).results;
  } catch (err) { if (noTable(err)) return out; throw err; }
  // person → { user, institutes: [{ name, link, batches: [...] }] }
  const people = new Map();
  for (const i of institutes) {
    const [staff, batches, teach, students] = await DB.batch([
      DB.prepare(`SELECT st.id, st.role, st.user_id, u.email, u.full_name FROM institute_staff st JOIN users u ON u.id = st.user_id
                   WHERE st.institute_id = ?1 AND st.status = 'active' AND u.account_status = 'active'`).bind(i.id),
      DB.prepare('SELECT id, name FROM batches WHERE institute_id = ?1 AND archived_at IS NULL ORDER BY name').bind(i.id),
      DB.prepare('SELECT t.batch_id, t.staff_id FROM batch_teachers t JOIN batches b ON b.id = t.batch_id WHERE b.institute_id = ?1').bind(i.id),
      DB.prepare(`SELECT s.batch_id, u.full_name, u.email, COALESCE(SUM(d.seconds), 0) AS seconds, COUNT(d.day) AS days
                    FROM institute_students s JOIN users u ON u.id = s.user_id
                    LEFT JOIN daily_totals d ON d.user_id = s.user_id AND d.day >= ?2 AND d.day <= ?3 AND (d.seconds > 0 OR d.runs > 0 OR d.steps > 0)
                   WHERE s.institute_id = ?1 AND s.status = 'active' GROUP BY s.id`).bind(i.id, from, to),
    ]);
    const byBatch = new Map(batches.results.map((b) => [b.id, { name: b.name, rows: [] }]));
    for (const s of students.results) if (byBatch.has(s.batch_id)) byBatch.get(s.batch_id).rows.push(s);
    const summary = new Map();
    for (const [id, b] of byBatch) {
      if (!b.rows.length) continue;
      const busy = b.rows.filter((r) => r.days > 0).sort((x, y) => y.seconds - x.seconds);
      const quiet = b.rows.filter((r) => !r.days).map((r) => r.full_name || r.email.split('@')[0]).sort((x, y) => x.localeCompare(y));
      summary.set(id, { name: b.name, students: b.rows.length, practised: busy.length, time: duration(busy.reduce((t, r) => t + r.seconds, 0)),
        top: busy.slice(0, TOP).map((r) => `${r.full_name || r.email.split('@')[0]} (${duration(r.seconds)})`),
        quiet: quiet.slice(0, QUIET), quietMore: Math.max(0, quiet.length - QUIET), link: `${siteUrl(env)}/institute/${i.id}/batches/${id}` });
    }
    if (!summary.size) continue;
    const mine = new Map();
    for (const t of teach.results) { if (!mine.has(t.staff_id)) mine.set(t.staff_id, []); mine.get(t.staff_id).push(t.batch_id); }
    for (const st of staff.results) {
      const ids = st.role === 'admin' ? [...summary.keys()] : (mine.get(st.id) || []).filter((b) => summary.has(b));
      if (!ids.length) continue;
      if (!people.has(st.user_id)) people.set(st.user_id, { email: st.email, name: st.full_name, institutes: [] });
      people.get(st.user_id).institutes.push({ name: i.name, link: `${siteUrl(env)}/institute/${i.id}`, batches: ids.map((b) => summary.get(b)) });
    }
  }
  if (!people.size) return out;
  const off = new Set((await DB.prepare('SELECT user_id FROM institute_email_settings WHERE weekly = 0').all()).results.map((r) => r.user_id));
  for (const [userId, p] of people) {
    if (off.has(userId)) { out.skipped++; continue; }
    const claim = await DB.prepare('INSERT INTO institute_weekly_emails (user_id, week, sent_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING').bind(userId, today, nowIso()).run();
    if (!claim.meta || claim.meta.changes !== 1) { out.skipped++; continue; }
    try {
      await sendTemplate(env, ctx, { to: p.email, userId, template: 'institute_weekly',
        data: { name: p.name, from: words(from), to: words(to), institutes: p.institutes, settingsUrl: `${siteUrl(env)}/institute` } });
      out.sent++;
    } catch (err) { console.error('weekly institute email failed:', err && err.name); }
  }
  return out;
}

export async function cron(env, ctx, kind) {
  if (kind !== '17 21 * * *') return;
  const r = await sendWeekly(env, ctx);
  if (r.sent || r.skipped) console.log('institute weekly email:', JSON.stringify(r));
}

export const ROUTES = {
  'GET /api/me/institute-email': getSetting,
  'PUT /api/me/institute-email': putSetting,
};
export const PATTERNS = [];
