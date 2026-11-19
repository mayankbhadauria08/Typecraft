// System health and Integrations (docs/ADMIN-PHASE-5.md §2–4). Console-only endpoints: a console session is required.
//
//   GET /api/console/health        health.view        → { warnings, jobs, email, payments, database, migrations, plan, learning }
//   GET /api/console/integrations  integrations.view  → { items: [{ key, name, what, status, statusLabel, facts, fix, link }] }
//
// Read-only. Secret values are never read out: only whether each one is set. Each answer is a few batched
// queries, so a page load stays far inside Workers Free's per-request limits.
import { json, nowIso } from '../http.js';
import { emailEnabled } from '../session.js';
import { otpEnabled } from '../otp.js';
import { healthNumbers } from '../admin.js';
import { paymentsMode, readSettings } from '../settings.js';
import { paidPlan, perRun } from '../limits.js';
import { SCHEDULES } from '../jobs.js';
import { requireAdmin } from './session.js';
import { emailCodeOn } from './auth.js';
import { MIGRATIONS } from './migration-list.js';

const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const MB = 1024 * 1024;
const CUT_OFF_MS = 15 * 60 * 1000;            // a run still without a finish this long after it started was cut off
const RESEND_FREE_DAY = 100, RESEND_FREE_MONTH = 3000;
const resendFree = (env) => String(env.RESEND_PLAN || '').trim().toLowerCase() !== 'paid';
const parse = (t) => { try { return JSON.parse(t); } catch { return {}; } };
const noTable = (err) => /no such table/i.test(String(err && err.message));
// "19 Nov, 2:47 pm" in India time, for the warnings' words
const shortTime = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/* ---------- the database: size and which updates are in ---------- */
async function databaseSize(env) {
  try {
    const r = await env.DB.prepare('SELECT 1 AS one').all();
    if (r && r.meta && Number.isFinite(r.meta.size_after)) return r.meta.size_after; // D1 reports the size after every query
  } catch { /* fall through */ }
  try {
    const pages = await env.DB.prepare('PRAGMA page_count').first();
    const size = await env.DB.prepare('PRAGMA page_size').first();
    const n = Number(pages && Object.values(pages)[0]) * Number(size && Object.values(size)[0]);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

/** Every migration with whether its tables and indexes exist here. */
export async function migrationStatus(env) {
  let names;
  try {
    names = new Set((await env.DB.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all()).results.map((r) => r.name));
  } catch { return null; } // this database does not let us look: say nothing rather than something wrong
  return MIGRATIONS.map(([file, title, tables, indexes]) => {
    const missing = [...tables, ...indexes].filter((n) => !names.has(n));
    return { id: file.slice(0, 4), file: `${file}.sql`, title, applied: missing.length === 0, partly: missing.length > 0 && missing.length < tables.length + indexes.length, missing };
  });
}

/* ---------- the background jobs ---------- */
function runView(r, now) {
  const parts = parse(r.parts || '{}');
  const failed = Object.entries(parts).filter(([, v]) => v !== 'ok').map(([part, error]) => ({ part, error }));
  const cutOff = !r.finished_at && now - Date.parse(r.started_at) > CUT_OFF_MS;
  return { id: r.id, schedule: r.schedule, label: (SCHEDULES[r.schedule] || { label: r.schedule }).label, startedAt: r.started_at, finishedAt: r.finished_at || null,
    state: r.finished_at ? (r.ok ? 'ok' : 'failed') : cutOff ? 'cut_off' : 'running', ms: r.ms, parts: Object.keys(parts), failed };
}

async function jobs(env, now) {
  const DB = env.DB;
  const day = new Date(now - DAY).toISOString(), week = new Date(now - 7 * DAY).toISOString(), stale = new Date(now - CUT_OFF_MS).toISOString();
  let res;
  try {
    res = await DB.batch([
      DB.prepare('SELECT * FROM job_runs WHERE id IN (SELECT MAX(id) FROM job_runs GROUP BY schedule)'),
      DB.prepare('SELECT schedule, MAX(started_at) AS at FROM job_runs WHERE ok = 1 GROUP BY schedule'),
      DB.prepare(`SELECT schedule, COUNT(*) AS runs, SUM(CASE WHEN ok = 0 OR (finished_at IS NULL AND started_at < ?2) THEN 1 ELSE 0 END) AS bad
                    FROM job_runs WHERE started_at >= ?1 GROUP BY schedule`).bind(day, stale),
      DB.prepare(`SELECT * FROM job_runs WHERE started_at >= ?1 AND (ok = 0 OR (finished_at IS NULL AND started_at < ?2)) ORDER BY id DESC LIMIT 20`).bind(week, stale),
      DB.prepare('SELECT * FROM job_runs ORDER BY id DESC LIMIT 12'),
    ]);
  } catch (err) {
    if (noTable(err)) return { ready: false, schedules: [], problems: [], recent: [] };
    throw err;
  }
  const [latest, lastOk, counts, problems, recent] = res.map((r) => r.results);
  const schedules = Object.entries(SCHEDULES).map(([schedule, s]) => {
    const row = latest.find((r) => r.schedule === schedule);
    const last = row ? runView(row, now) : null;
    const c = counts.find((r) => r.schedule === schedule) || { runs: 0, bad: 0 };
    const late = last ? now - Date.parse(last.startedAt) > (s.everyMin * 60 * 1000) * (s.everyMin >= 1440 ? 1.1 : 3) : false;
    return { schedule, label: s.label, everyMin: s.everyMin, last, lastOkAt: (lastOk.find((r) => r.schedule === schedule) || {}).at || null,
      runs24h: c.runs || 0, problems24h: c.bad || 0, late };
  });
  return { ready: true, schedules, problems: problems.map((r) => runView(r, now)), recent: recent.map((r) => runView(r, now)) };
}

/* ---------- email and payments ---------- */
async function emailNumbers(env, now) {
  const DB = env.DB;
  const day = new Date(now - DAY).toISOString(), month = new Date(now - 30 * DAY).toISOString(), week = new Date(now - 7 * DAY).toISOString();
  const res = await DB.batch([
    // sent_at has no index of its own: created_at (indexed) narrows the rows first; an email is sent within a day of being made
    DB.prepare("SELECT COUNT(*) AS n FROM email_logs WHERE created_at >= ?2 AND sent_at >= ?1").bind(day, new Date(now - 2 * DAY).toISOString()),
    DB.prepare("SELECT COUNT(*) AS n FROM email_logs WHERE created_at >= ?2 AND sent_at >= ?1").bind(month, new Date(now - 31 * DAY).toISOString()),
    DB.prepare("SELECT COUNT(*) AS n FROM email_logs WHERE status = 'queued' OR (status = 'failed' AND next_attempt_at IS NOT NULL)"),
    DB.prepare("SELECT COUNT(*) AS n FROM email_logs WHERE status = 'failed' AND next_attempt_at IS NULL AND created_at >= ?1").bind(day),
    DB.prepare("SELECT COUNT(*) AS n FROM email_logs WHERE status = 'bounced' AND created_at >= ?1").bind(week),
    DB.prepare('SELECT MAX(sent_at) AS at FROM email_logs WHERE created_at >= ?1').bind(month),
    DB.prepare("SELECT MAX(updated_at) AS at FROM email_logs WHERE status = 'delivered' AND created_at >= ?1").bind(month),
  ]);
  const n = (i) => res[i].results[0].n || 0;
  return { configured: emailEnabled(env), webhook: !!env.RESEND_WEBHOOK_SECRET, freePlan: resendFree(env),
    sent24h: n(0), sent30d: n(1), dayLimit: resendFree(env) ? RESEND_FREE_DAY : null, monthLimit: resendFree(env) ? RESEND_FREE_MONTH : null,
    waiting: n(2), failed24h: n(3), bounced7d: n(4), lastSentAt: res[5].results[0].at || null, lastDeliveredAt: res[6].results[0].at || null };
}

async function paymentNumbers(env, now) {
  const DB = env.DB;
  const hour = new Date(now - HOUR).toISOString(), week = new Date(now - 7 * DAY).toISOString();
  const res = await DB.batch([
    // 'pending': the bank said yes but Razorpay hasn't confirmed the money yet; checked every 10 minutes
    DB.prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM orders WHERE status = 'pending' AND updated_at < ?1 AND created_at >= ?2").bind(hour, week),
    DB.prepare("SELECT MAX(paid_at) AS at FROM orders WHERE status IN ('paid', 'partially_refunded', 'refunded')"),
    DB.prepare('SELECT MAX(received_at) AS at FROM webhook_events'),
    DB.prepare("SELECT COUNT(*) AS n FROM webhook_events WHERE status = 'failed' AND received_at >= ?1").bind(week),
  ]);
  return { configured: !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET), mode: paymentsMode(env), webhook: !!env.RAZORPAY_WEBHOOK_SECRET,
    waiting: res[0].results[0].n || 0, oldestWaiting: res[0].results[0].oldest || null, lastPaidAt: res[1].results[0].at || null,
    lastWebhookAt: res[2].results[0].at || null, webhookFailed7d: res[3].results[0].n || 0 };
}

/* ---------- the plan and its limits ---------- */
function planView(env) {
  const paid = paidPlan(env);
  const n = perRun(env);
  return {
    paid, label: paid ? 'Workers Paid' : 'Workers Free',
    restoreDays: paid ? 30 : 7, databaseLimit: (paid ? 10 * 1024 : 500) * MB,
    perRun: [
      ['Payments checked with Razorpay', n.reconcile], ['Institute payments checked', n.instituteReconcile], ['Institute invoices made', n.instituteInvoices],
      ['Failed emails tried again', n.emailRetries], ['Announcement emails', n.announcements], ['Campaign emails', n.campaigns],
    ],
    limits: paid ? [
      ['Requests', '10 million a month included, then billed'],
      ['Work per request', 'Up to 30 seconds of processor time'],
      ['Outside calls per request or job run', '10,000'],
      ['Database', '10 GB; 25 billion rows read and 50 million written a month included'],
      ['Restore points', '30 days'],
    ] : [
      ['Requests', '100,000 a day'],
      ['Work per request or job run', '10 ms of processor time'],
      ['Outside calls per request or job run', '50 (Razorpay, email)'],
      ['Database', '500 MB; 5 million rows read and 100,000 written a day'],
      ['Restore points', '7 days'],
    ],
  };
}

/* ---------- warnings: what needs someone's attention, worst first ---------- */
function warningsFor({ jobs: j, email, payments, size, plan, migrations, learning }) {
  const out = [];
  const add = (level, text, where = null) => out.push({ level, text, where });
  if (migrations) {
    const missing = migrations.filter((m) => !m.applied);
    if (missing.length) add('warn', `${missing.length === 1 ? 'Database update' : 'Database updates'} ${missing.map((m) => m.id).join(', ')} ${missing.length === 1 ? "hasn't" : "haven't"} been applied, so the parts that need ${missing.length === 1 ? 'it' : 'them'} are switched off. Apply after a restore bookmark (docs/LAUNCH.md).`, 'migrations');
  }
  if (j.ready) {
    for (const s of j.schedules) {
      if (!s.last) continue;
      if (s.last.state === 'cut_off') add('bad', `The last ${s.label.toLowerCase()} job was stopped before it finished. On Workers Free a run is stopped after 10 ms of processor time; if this keeps happening, lower the batch sizes or move to Workers Paid.`, 'jobs');
      else if (s.last.state === 'failed') add('bad', `The last ${s.label.toLowerCase()} job had a problem: ${s.last.failed.map((f) => f.part).join(', ')}.`, 'jobs');
      if (s.late) add('bad', `The ${s.label.toLowerCase()} job hasn't run since ${shortTime(s.last.startedAt)} (India time). Check Triggers in Cloudflare (Workers & Pages, typecraft, Settings).`, 'jobs');
    }
  }
  if (email.configured && email.dayLimit) {
    if (email.sent24h >= email.dayLimit) add('bad', `${email.sent24h} emails in the last 24 hours: Resend's free plan stops at ${email.dayLimit} a day, so more wait or fail.`, 'email');
    else if (email.sent24h >= email.dayLimit * 0.8) add('warn', `${email.sent24h} of ${email.dayLimit} emails used in the last 24 hours (Resend's free plan).`, 'email');
    if (email.sent30d >= email.monthLimit * 0.8) add('warn', `${email.sent30d.toLocaleString('en-IN')} of ${email.monthLimit.toLocaleString('en-IN')} emails used in the last 30 days (Resend's free plan).`, 'email');
  }
  if (email.failed24h) add('warn', `${email.failed24h} ${email.failed24h === 1 ? 'email' : 'emails'} failed for good in the last 24 hours. See the email log.`, 'email');
  if (email.waiting > 50) add('warn', `${email.waiting} emails are waiting to be sent. They go out a few at a time every 10 minutes.`, 'email');
  if (payments.waiting) add('warn', `${payments.waiting} ${payments.waiting === 1 ? 'payment has' : 'payments have'} waited more than an hour for Razorpay to confirm. Open Payments and check ${payments.waiting === 1 ? 'it' : 'them'} with Razorpay.`, 'payments');
  if (payments.webhookFailed7d) add('warn', `${payments.webhookFailed7d} Razorpay ${payments.webhookFailed7d === 1 ? 'message' : 'messages'} couldn't be handled in the last 7 days.`, 'payments');
  if (size != null) {
    const share = size / plan.databaseLimit;
    if (share >= 0.95) add('bad', `The database is ${Math.round(share * 100)}% full. When it is full, nothing new can be saved.`, 'database');
    else if (share >= 0.8) add('warn', `The database is ${Math.round(share * 100)}% full.`, 'database');
  }
  if (learning && learning.failedToday) add('warn', `${learning.failedToday} practice ${learning.failedToday === 1 ? 'result' : 'results'} couldn't be saved today because the database was busy.`, 'learning');
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
}

export async function getHealth(request, env) {
  await requireAdmin(env, request, 'health.view');
  const now = Date.now();
  const [j, email, payments, size, migrations, learning] = await Promise.all([
    jobs(env, now), emailNumbers(env, now), paymentNumbers(env, now), databaseSize(env), migrationStatus(env),
    healthNumbers(env).catch(() => null),
  ]);
  const plan = planView(env);
  return json({
    at: nowIso(),
    warnings: warningsFor({ jobs: j, email, payments, size, plan, migrations, learning }),
    jobs: j, email, payments,
    database: { size, limit: plan.databaseLimit, restoreDays: plan.restoreDays },
    migrations, plan, learning,
  });
}

/* ---------- Integrations ---------- */
const fact = (label, value, time = false) => ({ label, value, time });

export async function getIntegrations(request, env) {
  await requireAdmin(env, request, 'integrations.view');
  const now = Date.now();
  const [email, payments, { settings }] = await Promise.all([emailNumbers(env, now), paymentNumbers(env, now), readSettings(env)]);
  const site = String(env.SITE_URL || 'https://typecrafttyping.in').replace(/\/+$/, '');
  const items = [];

  // Razorpay
  items.push({ key: 'razorpay', name: 'Razorpay', what: 'Takes card, UPI and netbanking payments for plans and institute seats.',
    status: !payments.configured ? 'off' : !payments.webhook ? 'warn' : 'ok',
    statusLabel: !payments.configured ? 'Not set up' : `${payments.mode === 'live' ? 'Live' : 'Test mode'}${payments.webhook ? '' : ', webhook missing'}`,
    facts: [
      fact('Keys', payments.configured ? `Installed (${payments.mode === 'live' ? 'live: real money' : 'test: no real money'})` : 'Not installed'),
      fact('Webhook secret', payments.webhook ? 'Installed' : 'Not installed'),
      fact('Payments', settings.payments.enabled === false ? 'Paused in Settings' : 'On'),
      fact('Last payment', payments.lastPaidAt, true),
      fact('Last message from Razorpay', payments.lastWebhookAt, true),
    ],
    fix: !payments.configured ? 'Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET as secrets in Cloudflare (Workers & Pages, typecraft, Settings, Variables and secrets). Use the test keys first.'
      : !payments.webhook ? `In Razorpay (Settings, Webhooks), add ${site}/api/webhooks/razorpay with the payment and refund events, then add its secret as RAZORPAY_WEBHOOK_SECRET.` : null,
    link: { label: 'Open Razorpay', href: 'https://dashboard.razorpay.com/' } });

  // Resend
  items.push({ key: 'resend', name: 'Resend (email)', what: 'Sends sign-in codes, receipts, reminders, replies and campaigns.',
    status: !email.configured ? 'off' : !email.webhook ? 'warn' : 'ok',
    statusLabel: !email.configured ? 'Not set up' : email.webhook ? 'Sending, with delivery reports' : 'Sending, no delivery reports',
    facts: [
      fact('API key', email.configured ? 'Installed' : 'Not installed'),
      fact('Delivery reports (webhook)', email.webhook ? 'Installed' : 'Not installed'),
      fact('Sent in the last 24 hours', email.dayLimit ? `${email.sent24h} of ${email.dayLimit} (free plan)` : String(email.sent24h)),
      fact('Sent in the last 30 days', email.monthLimit ? `${email.sent30d.toLocaleString('en-IN')} of ${email.monthLimit.toLocaleString('en-IN')} (free plan)` : String(email.sent30d)),
      fact('Last sent', email.lastSentAt, true),
      fact('Last delivery report', email.lastDeliveredAt, true),
    ],
    fix: !email.configured ? 'Add RESEND_API_KEY as a secret in Cloudflare, and verify the sending domain in Resend.'
      : !email.webhook ? `In Resend (Webhooks), add ${site}/api/webhooks/resend with the delivered, bounced and complained events, then add its signing secret as RESEND_WEBHOOK_SECRET. Without it the email log can't tell delivered from bounced, and someone who marks an email as spam keeps getting announcements.` : null,
    link: { label: 'Open Resend', href: 'https://resend.com/emails' } });

  // emailed codes
  const secret = otpEnabled(env), code = emailCodeOn(env);
  items.push({ key: 'codes', name: 'Emailed codes', what: 'The 6-digit codes for signing in and confirming email, the admin sign-in code, and unsubscribe links.',
    status: secret && code ? 'ok' : secret ? 'warn' : 'off',
    statusLabel: !secret ? 'Not set up' : code ? 'On, also for admin sign-in' : 'On; admin sign-in uses the password only',
    facts: [fact('Secret (SESSION_SECRET)', secret ? 'Installed' : 'Not installed'), fact('Code at admin sign-in', code ? 'Asked for' : 'Not asked for')],
    fix: !secret ? 'Add SESSION_SECRET as a secret in Cloudflare: any random text of 40 characters or more.'
      : !code ? (String(env.ADMIN_EMAIL_CODE || '').trim().toLowerCase() === 'off' ? 'ADMIN_EMAIL_CODE is set to off. Remove it to ask for a code at admin sign-in again.' : 'Switches on by itself once email sending is set up.') : null,
    link: null });

  // Cloudflare
  const plan = planView(env);
  items.push({ key: 'cloudflare', name: 'Cloudflare', what: 'Runs the site and the database, and keeps restore points of the database.',
    status: 'ok', statusLabel: plan.label,
    facts: [fact('Plan', plan.label), fact('Restore points', `${plan.restoreDays} days`),
      fact('Plan setting (WORKERS_PLAN)', paidPlan(env) ? 'paid' : 'not set (free plan)')],
    fix: paidPlan(env) ? null : 'When you move to Workers Paid, add the variable WORKERS_PLAN with the value paid, so the background jobs send larger batches.',
    link: { label: 'Open Cloudflare', href: 'https://dash.cloudflare.com/' } });

  // not checked from here
  items.push({ key: 'analytics', name: 'Cloudflare Web Analytics', what: 'Counts visits to the website without cookies. The admin console is never counted.',
    status: 'info', statusLabel: "Can't be checked from here",
    facts: [fact('Where', 'Cloudflare: Analytics & Logs, Web Analytics')], fix: null, link: { label: 'Open Cloudflare', href: 'https://dash.cloudflare.com/' } });
  items.push({ key: 'fonts', name: 'Google Fonts', what: "The website's typefaces. Visitors' browsers load them from Google; the Privacy page says so.",
    status: 'ok', statusLabel: 'In use, no account needed', facts: [fact('Loaded from', 'fonts.googleapis.com and fonts.gstatic.com')], fix: null, link: null });
  items.push({ key: 'search', name: 'Google Search Console', what: 'Shows how the site appears in Google search.',
    status: 'info', statusLabel: "Can't be checked from here",
    facts: [fact('Where', 'search.google.com/search-console')], fix: null, link: { label: 'Open Search Console', href: 'https://search.google.com/search-console' } });

  return json({ items });
}

export const ROUTES = {
  'GET /api/console/health': getHealth,
  'GET /api/console/integrations': getIntegrations,
};
