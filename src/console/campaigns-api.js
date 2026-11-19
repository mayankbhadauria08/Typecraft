// Email campaigns and the email log (docs/ADMIN-PHASE-4.md §4). Console-only endpoints: a console session is required.
//
//   GET    /api/console/campaigns                   emails.view      list: q, status, page; + the daily limit and how much of it is used
//   GET    /api/console/campaigns/audience          emails.view      ?audience=all|free|paid|plan:<id>|inactive:<7|14|30> → how many people now
//   POST   /api/console/campaigns                   campaigns.write  a new draft { name, subject, body, audience }
//   PUT    /api/console/campaigns/limit             campaigns.limit  { dailyCap } (Super Admin; asks for the password again)
//   GET    /api/console/campaigns/:id               emails.view      one campaign: progress and history
//   PUT    /api/console/campaigns/:id               campaigns.write  change a draft
//   DELETE /api/console/campaigns/:id               campaigns.write  delete a draft
//   POST   /api/console/campaigns/:id/test          campaigns.write  send it to yourself
//   POST   /api/console/campaigns/:id/schedule      emails.announce  { sendAt: ISO time | null (now) }
//   POST   /api/console/campaigns/:id/unschedule    emails.announce  a scheduled campaign goes back to a draft
//   POST   /api/console/campaigns/:id/cancel        emails.announce  stop: nobody else gets it
//   GET    /api/console/emails                      emails.view      the email log: q, status, kind, page
//   POST   /api/console/emails/:id/retry            emails.retry     send a failed email again
//
// How a campaign goes out: when its time comes, the people in its audience are fixed (campaign_sends);
// every 10 minutes the cron hands the next few to Resend as 'announcement' emails, never more than the
// daily limit in any 24 hours (Resend's free plan allows 100 emails a day for everything, sign-in codes
// and receipts included, so the default limit of 80 leaves room for those). Each person is checked
// again just before their turn: closed accounts and people who turned off product news are skipped.
// Each email is an email_logs row like any other, with retries and the unsubscribe link.
import { HttpError, json, readJson, fieldError, clientIp, nowIso } from '../http.js';
import { perRun } from '../limits.js';
import { uuid } from '../crypto.js';
import { hitLimit, emailEnabled, tooMany } from '../session.js';
import { audit } from '../billing.js';
import { sendTemplate, getSetting, publicLog, sendAgain, SENSITIVE } from '../mail.js';
import { requireAdmin } from './session.js';
import { can } from './permissions.js';
import { Binder, PAGE_SIZE, DAY_MS, pageOf, offsetOf, paged, like, oneOf, idParam, parseJson } from './lib.js';

export const STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'cancelled'];
export const DEFAULT_CAP = 80;
const CAP_MAX = 5000;
export const BATCH = 40;                 // the most campaign emails handed to Resend per run on Workers Paid; Free: src/limits.js
const STUCK_MS = 15 * 60000;             // a person claimed this long ago with no result: the run was cut off
const INACTIVE_DAYS = [7, 14, 30];
const NAME_MAX = 80, SUBJECT_MAX = 150, BODY_MAX = 20000;

/* ---------- the daily limit ---------- */
export async function dailyCap(env) {
  const s = await getSetting(env, 'campaigns', {});
  const n = parseInt(s.dailyCap, 10);
  return Number.isFinite(n) && n >= 1 && n <= CAP_MAX ? n : DEFAULT_CAP;
}
async function usedToday(env, now) {
  const since = new Date(Date.parse(now) - DAY_MS).toISOString();
  return (await env.DB.prepare('SELECT COUNT(*) AS n FROM campaign_sends WHERE sent_at > ?1').bind(since).first()).n;
}

/* ---------- audiences ---------- */
/** 'all' | 'free' | 'paid' | 'plan:<package id>' | 'inactive:<days>' → { kind, plan?, days? } or null. */
export function parseAudience(text) {
  const s = typeof text === 'string' ? text.trim() : '';
  if (['all', 'free', 'paid'].includes(s)) return { kind: s };
  let m = /^plan:([a-z0-9_-]{1,40})$/.exec(s);
  if (m) return m[1] === 'free' ? { kind: 'free' } : { kind: 'plan', plan: m[1] };
  m = /^inactive:(\d{1,3})$/.exec(s);
  if (m && INACTIVE_DAYS.includes(Number(m[1]))) return { kind: 'inactive', days: Number(m[1]) };
  return null;
}
export const audienceKey = (a) => (a.kind === 'plan' ? `plan:${a.plan}` : a.kind === 'inactive' ? `inactive:${a.days}` : a.kind);
const storedAudience = (text) => {
  const a = parseJson(text, null);
  return a && a.kind ? parseAudience(audienceKey(a)) || { kind: 'all' } : { kind: 'all' };
};
export function audienceLabel(a, plans = {}) {
  switch (a.kind) {
    case 'free': return 'People on Free';
    case 'paid': return 'People with any paid plan';
    case 'plan': return `People on ${plans[a.plan] || a.plan}`;
    case 'inactive': return `People who haven't practised for ${a.days} days`;
    default: return 'Everyone who gets product news';
  }
}

/**
 * FROM and WHERE for the people a campaign reaches: active accounts with a confirmed email address who
 * get product news (email_preferences.announcements, on unless turned off), narrowed by the audience.
 * "Paid" is an active plan other than Free. "Inactive" is: joined before the cut-off and no practice
 * (lessons, games, tests) since.
 */
function audienceFrom(b, a, now) {
  const where = ["u.account_status = 'active'", 'u.email_verified = 1', 'COALESCE(p.announcements, 1) = 1'];
  const onPlan = (extra) => `EXISTS (SELECT 1 FROM user_subscriptions s WHERE s.user_id = u.id AND s.status = 'active'
                                  AND (s.expires_at IS NULL OR s.expires_at > ${b.once('now', now)}) AND ${extra})`;
  if (a.kind === 'paid') where.push(onPlan("s.package_id <> 'free'"));
  if (a.kind === 'free') where.push(`NOT ${onPlan("s.package_id <> 'free'")}`);
  if (a.kind === 'plan') where.push(onPlan(`s.package_id = ${b.p(a.plan)}`));
  if (a.kind === 'inactive') {
    const cut = b.once('cut', new Date(Date.parse(now) - a.days * DAY_MS).toISOString());
    where.push(`u.created_at < ${cut}`,
      `u.id NOT IN (SELECT user_id FROM events WHERE server_at >= ${cut})`,
      `u.id NOT IN (SELECT user_id FROM typing_tests WHERE created_at >= ${cut})`);
  }
  return `FROM users u LEFT JOIN email_preferences p ON p.user_id = u.id WHERE ${where.join(' AND ')}`;
}
async function audienceCount(env, a, now = nowIso()) {
  const b = new Binder();
  const sql = `SELECT COUNT(*) AS n ${audienceFrom(b, a, now)}`;
  return (await env.DB.prepare(sql).bind(...b.args).first()).n;
}

/* ---------- input ---------- */
const clean = (v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '');
async function draftFrom(env, body) {
  const fields = {};
  const name = clean(body.name).replace(/\s+/g, ' ');
  const subject = clean(body.subject).replace(/\s+/g, ' ');
  const text = clean(body.body);
  if (!name) fields.name = 'Give it a name the team will recognise.'; else if (name.length > NAME_MAX) fields.name = `Keep the name under ${NAME_MAX} characters.`;
  if (!subject) fields.subject = 'Write a subject.'; else if (subject.length > SUBJECT_MAX) fields.subject = `Keep the subject under ${SUBJECT_MAX} characters.`;
  if (text.length < 10) fields.body = 'Write the email (at least 10 characters).'; else if (text.length > BODY_MAX) fields.body = 'Keep the email under 20,000 characters.';
  const audience = parseAudience(body.audience);
  if (!audience) fields.audience = 'Choose who it goes to.';
  else if (audience.kind === 'plan') {
    const plan = await env.DB.prepare('SELECT id FROM packages WHERE id = ?1').bind(audience.plan).first();
    if (!plan) fields.audience = 'That plan no longer exists. Choose another.';
  }
  if (Object.keys(fields).length) throw fieldError(fields);
  return { name, subject, body: text, audience };
}

/* ---------- reading ---------- */
async function campaignRow(env, id) {
  const row = await env.DB.prepare(`SELECT c.*, cu.full_name AS created_name, uu.full_name AS updated_name FROM email_campaigns c
                                      LEFT JOIN users cu ON cu.id = c.created_by LEFT JOIN users uu ON uu.id = c.updated_by WHERE c.id = ?1`)
    .bind(idParam(id, 'Campaign not found.')).first();
  if (!row) throw new HttpError(404, 'not_found', 'Campaign not found.');
  return row;
}
function shape(r, plans) {
  const a = storedAudience(r.audience);
  return {
    id: r.id, name: r.name, subject: r.subject, body: r.body, audience: audienceKey(a), audienceLabel: audienceLabel(a, plans),
    status: r.status, sendAt: r.send_at, total: r.total, startedAt: r.started_at, finishedAt: r.finished_at,
    createdAt: r.created_at, updatedAt: r.updated_at, createdBy: r.created_name || null, updatedBy: r.updated_name || null,
  };
}
const planMap = (rows) => Object.fromEntries(rows.map((p) => [p.id, p.name]));

export async function getCampaigns(request, env) {
  const who = await requireAdmin(env, request, 'emails.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q), DB = env.DB, now = nowIso();
  const where = (b) => {
    const w = [];
    const term = (q.get('q') || '').trim().slice(0, 80);
    if (term) w.push(`(c.name LIKE ${b.once('q', like(term))} ESCAPE '\\' OR c.subject LIKE ${b.once('q', like(term))} ESCAPE '\\')`);
    const status = oneOf(q.get('status'), STATUSES);
    if (status) w.push(`c.status = ${b.p(status)}`);
    return w.length ? 'WHERE ' + w.join(' AND ') : '';
  };
  const list = new Binder(), count = new Binder();
  const lw = where(list), cw = where(count);
  const since = new Date(Date.parse(now) - DAY_MS).toISOString();
  const [rows, total, progress, used, plans] = await DB.batch([
    DB.prepare(`SELECT c.*, NULL AS created_name, NULL AS updated_name FROM email_campaigns c ${lw}
                 ORDER BY CASE c.status WHEN 'sending' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
                          COALESCE(c.send_at, c.updated_at) DESC, c.id LIMIT ${PAGE_SIZE} OFFSET ${offsetOf(page)}`).bind(...list.args),
    DB.prepare(`SELECT COUNT(*) AS n FROM email_campaigns c ${cw}`).bind(...count.args),
    DB.prepare(`SELECT s.campaign_id, s.status, COUNT(*) AS n FROM campaign_sends s
                 WHERE s.campaign_id IN (SELECT c.id FROM email_campaigns c ${lw} ORDER BY CASE c.status WHEN 'sending' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
                          COALESCE(c.send_at, c.updated_at) DESC, c.id LIMIT ${PAGE_SIZE} OFFSET ${offsetOf(page)})
                 GROUP BY s.campaign_id, s.status`).bind(...list.args),
    DB.prepare('SELECT COUNT(*) AS n FROM campaign_sends WHERE sent_at > ?1').bind(since),
    DB.prepare("SELECT id, name, active FROM packages WHERE id <> 'free' ORDER BY display_order, name"),
  ]);
  const byCampaign = {};
  for (const p of progress.results) (byCampaign[p.campaign_id] = byCampaign[p.campaign_id] || {})[p.status] = p.n;
  const names = planMap(plans.results);
  const items = rows.results.map((r) => ({ ...shape(r, names), body: undefined, progress: countsOf(byCampaign[r.id]) }));
  const [canWrite, canSend, canLimit] = await Promise.all([can(env, who.role, 'campaigns.write'), can(env, who.role, 'emails.announce'), can(env, who.role, 'campaigns.limit')]);
  return json({
    ...paged(items, page, total.results[0].n),
    limit: { dailyCap: await dailyCap(env), usedToday: used.results[0].n },
    emailOn: emailEnabled(env),
    plans: plans.results.map((p) => ({ id: p.id, name: p.name, onSale: !!p.active })),
    inactiveDays: INACTIVE_DAYS,
    can: { write: canWrite, send: canSend, limit: canLimit },
  });
}
function countsOf(c = {}) {
  const n = (k) => c[k] || 0;
  return { waiting: n('waiting') + n('sending'), sent: n('sent'), failed: n('failed'), skipped: n('skipped'), cancelled: n('cancelled') };
}

export async function getAudience(request, env) {
  await requireAdmin(env, request, 'emails.view');
  const a = parseAudience(new URL(request.url).searchParams.get('audience'));
  if (!a) throw fieldError({ audience: 'Choose who it goes to.' });
  const [count, cap] = await Promise.all([audienceCount(env, a), dailyCap(env)]);
  return json({ audience: audienceKey(a), count, dailyCap: cap, days: Math.max(1, Math.ceil(count / cap)) });
}

export async function getCampaign(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'emails.view');
  const DB = env.DB;
  const r = await campaignRow(env, params.id);
  const [progress, mail, history, plans] = await DB.batch([
    DB.prepare('SELECT status, COUNT(*) AS n FROM campaign_sends WHERE campaign_id = ?1 GROUP BY status').bind(r.id),
    DB.prepare(`SELECT e.status, COUNT(*) AS n FROM campaign_sends s JOIN email_logs e ON e.id = s.email_id WHERE s.campaign_id = ?1 GROUP BY e.status`).bind(r.id),
    DB.prepare(`SELECT l.action, l.detail, l.created_at, u.full_name AS actor FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
                 WHERE l.target = ?1 ORDER BY l.created_at DESC LIMIT 30`).bind(`campaign:${r.id}`),
    DB.prepare("SELECT id, name, active FROM packages WHERE id <> 'free' ORDER BY display_order, name"),
  ]);
  const counts = {};
  for (const p of progress.results) counts[p.status] = p.n;
  const delivery = {};
  for (const m of mail.results) delivery[m.status] = m.n;
  const names = planMap(plans.results);
  const a = storedAudience(r.audience);
  const [canWrite, canSend, cap] = await Promise.all([can(env, who.role, 'campaigns.write'), can(env, who.role, 'emails.announce'), dailyCap(env)]);
  // before sending starts, how many it would reach now; after, who it was fixed to
  const reach = ['draft', 'scheduled'].includes(r.status) ? await audienceCount(env, a) : r.total;
  return json({
    campaign: shape(r, names),
    reach, dailyCap: cap, days: Math.max(1, Math.ceil(reach / cap)),
    progress: countsOf(counts),
    delivery: { delivered: delivery.delivered || 0, bounced: delivery.bounced || 0, waitingForResend: (delivery.queued || 0) },
    history: history.results.map((h) => ({ action: h.action, actor: h.actor || (h.action === 'campaign.start' ? 'TypeCraft, on its own' : 'Staff'), createdAt: h.created_at, note: historyNote(h) })),
    plans: plans.results.map((p) => ({ id: p.id, name: p.name, onSale: !!p.active })),
    inactiveDays: INACTIVE_DAYS,
    emailOn: emailEnabled(env),
    can: { write: canWrite, send: canSend },
  });
}
function historyNote(h) {
  const d = parseJson(h.detail, {});
  if (h.action === 'campaign.schedule') return d.sendAt ? `For ${d.sendAt}` : 'To send now';
  if (h.action === 'campaign.start') return `${(d.total || 0).toLocaleString('en-IN')} people`;
  if (h.action === 'campaign.test') return d.to ? `To ${d.to}` : null;
  if (h.action === 'campaign.cancel' && d.notSent) return `${d.notSent.toLocaleString('en-IN')} people not sent to`;
  return null;
}

/* ---------- writing ---------- */
const log = (env, who, action, id, detail, request) =>
  audit(env, { actorId: who.user.id, action, target: `campaign:${id}`, detail, ip: clientIp(request) });

export async function postCampaign(request, env) {
  const who = await requireAdmin(env, request, 'campaigns.write');
  const d = await draftFrom(env, await readJson(request, 64 * 1024));
  const id = `cmp_${uuid()}`, now = nowIso();
  await env.DB.prepare(`INSERT INTO email_campaigns (id, name, subject, body, audience, status, created_by, updated_by, created_at, updated_at)
                        VALUES (?1, ?2, ?3, ?4, ?5, 'draft', ?6, ?6, ?7, ?7)`)
    .bind(id, d.name, d.subject, d.body, JSON.stringify(d.audience), who.user.id, now).run();
  await log(env, who, 'campaign.create', id, { name: d.name, audience: audienceKey(d.audience) }, request);
  return json({ id, message: 'Draft saved.' }, 201);
}

export async function putCampaign(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'campaigns.write');
  const r = await campaignRow(env, params.id);
  if (r.status !== 'draft') throw new HttpError(409, 'not_draft', r.status === 'scheduled' ? 'Take it off the schedule first, then change it.' : 'This campaign has been sent. Copy it into a new draft instead.');
  const d = await draftFrom(env, await readJson(request, 64 * 1024));
  const now = nowIso();
  const res = await env.DB.prepare(`UPDATE email_campaigns SET name = ?2, subject = ?3, body = ?4, audience = ?5, updated_by = ?6, updated_at = ?7
                                     WHERE id = ?1 AND status = 'draft'`)
    .bind(r.id, d.name, d.subject, d.body, JSON.stringify(d.audience), who.user.id, now).run();
  if (!res.meta || res.meta.changes !== 1) throw new HttpError(409, 'changed', 'Someone changed this campaign just now. Reload the page.');
  await log(env, who, 'campaign.update', r.id, { audience: audienceKey(d.audience) }, request);
  return json({ id: r.id, message: 'Draft saved.' });
}

export async function deleteCampaign(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'campaigns.write');
  const r = await campaignRow(env, params.id);
  if (r.status !== 'draft') throw new HttpError(409, 'not_draft', 'Only a draft can be deleted. A sent campaign stays in the list as a record.');
  await env.DB.prepare("DELETE FROM email_campaigns WHERE id = ?1 AND status = 'draft'").bind(r.id).run();
  await log(env, who, 'campaign.delete', r.id, { name: r.name }, request);
  return json({ deleted: true, message: 'Draft deleted.' });
}

export async function testCampaign(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'campaigns.write');
  const r = await campaignRow(env, params.id);
  if (!emailEnabled(env)) throw new HttpError(503, 'email_not_configured', "Email sending isn't set up for this site yet.");
  if (!(await hitLimit(env, `campaign-test:${who.user.id}`, 10, 3600))) throw tooMany(60);
  const sent = await sendTemplate(env, null, { to: who.user.email, userId: who.user.id, template: 'announcement',
    data: { name: who.user.fullName, subject: `[Test] ${r.subject}`, body: r.body } });
  if (sent.status !== 'sent') throw new HttpError(502, 'not_sent', "The test email couldn't be sent. Look in the email log, then try again.");
  await log(env, who, 'campaign.test', r.id, { to: who.user.email }, request);
  return json({ to: who.user.email, message: `Test sent to ${who.user.email}.` });
}

export async function scheduleCampaign(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'emails.announce');
  const body = await readJson(request, 1024);
  const r = await campaignRow(env, params.id);
  if (r.status !== 'draft') throw new HttpError(409, 'not_draft', 'Only a draft can be scheduled.');
  const now = nowIso();
  let sendAt = now;
  if (body.sendAt != null && body.sendAt !== '') {
    const t = Date.parse(body.sendAt);
    if (!Number.isFinite(t)) throw fieldError({ sendAt: 'Choose a date and time.' });
    if (t < Date.now() - 60000) throw fieldError({ sendAt: 'Choose a time from now on.' });
    if (t > Date.now() + 90 * DAY_MS) throw fieldError({ sendAt: 'Choose a time within the next 90 days.' });
    sendAt = new Date(t).toISOString();
  }
  const a = storedAudience(r.audience);
  if (a.kind === 'plan' && !(await env.DB.prepare('SELECT 1 FROM packages WHERE id = ?1').bind(a.plan).first())) {
    throw new HttpError(409, 'plan_gone', 'The plan this campaign is for no longer exists. Change the audience first.');
  }
  const res = await env.DB.prepare(`UPDATE email_campaigns SET status = 'scheduled', send_at = ?2, updated_by = ?3, updated_at = ?4 WHERE id = ?1 AND status = 'draft'`)
    .bind(r.id, sendAt, who.user.id, now).run();
  if (!res.meta || res.meta.changes !== 1) throw new HttpError(409, 'changed', 'Someone changed this campaign just now. Reload the page.');
  const later = sendAt > now;
  await log(env, who, 'campaign.schedule', r.id, { sendAt: later ? sendAt : null }, request);
  // sending now: the first emails go after this answer; the cron sends the rest every 10 minutes
  if (!later) {
    const run = runCampaigns(env).catch((err) => console.error('campaign run failed:', err && err.message));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(run); else await run;
  }
  return json({ id: r.id, status: 'scheduled', sendAt, message: later ? 'Scheduled.' : 'Sending has started. Up to ' + perRun(env).campaigns + ' emails go every 10 minutes, within the daily limit.' });
}

export async function unscheduleCampaign(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'emails.announce');
  const r = await campaignRow(env, params.id);
  const res = await env.DB.prepare(`UPDATE email_campaigns SET status = 'draft', send_at = NULL, updated_by = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'scheduled'`)
    .bind(r.id, who.user.id, nowIso()).run();
  if (!res.meta || res.meta.changes !== 1) throw new HttpError(409, 'not_scheduled', r.status === 'sending' ? 'Sending has started. Stop it instead.' : 'This campaign is not scheduled.');
  await log(env, who, 'campaign.unschedule', r.id, null, request);
  return json({ id: r.id, status: 'draft', message: 'Taken off the schedule. It is a draft again.' });
}

export async function cancelCampaign(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'emails.announce');
  const r = await campaignRow(env, params.id);
  if (!['scheduled', 'sending'].includes(r.status)) throw new HttpError(409, 'not_sending', 'Only a scheduled campaign or one that is sending can be stopped.');
  const now = nowIso(), DB = env.DB;
  const [res, , left] = await DB.batch([
    DB.prepare(`UPDATE email_campaigns SET status = 'cancelled', finished_at = ?2, updated_by = ?3, updated_at = ?2 WHERE id = ?1 AND status IN ('scheduled', 'sending')`).bind(r.id, now, who.user.id),
    DB.prepare("UPDATE campaign_sends SET status = 'cancelled' WHERE campaign_id = ?1 AND status = 'waiting'").bind(r.id),
    DB.prepare("SELECT COUNT(*) AS n FROM campaign_sends WHERE campaign_id = ?1 AND status = 'cancelled'").bind(r.id),
  ]);
  if (!res.meta || res.meta.changes !== 1) throw new HttpError(409, 'changed', 'This campaign has just finished or been stopped. Reload the page.');
  const notSent = left.results[0].n;
  await log(env, who, 'campaign.cancel', r.id, { notSent }, request);
  return json({ id: r.id, status: 'cancelled', notSent, message: notSent ? `Stopped. ${notSent.toLocaleString('en-IN')} people won't get it.` : 'Stopped.' });
}

export async function putLimit(request, env) {
  const who = await requireAdmin(env, request, 'campaigns.limit');
  const body = await readJson(request, 1024);
  const n = typeof body.dailyCap === 'number' ? body.dailyCap : parseInt(body.dailyCap, 10);
  if (!Number.isInteger(n) || n < 1 || n > CAP_MAX) throw fieldError({ dailyCap: `Choose a whole number from 1 to ${CAP_MAX.toLocaleString('en-IN')}.` });
  const before = await dailyCap(env);
  const current = await getSetting(env, 'campaigns', {});
  await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ('campaigns', ?1, ?2, ?3)
                        ON CONFLICT (key) DO UPDATE SET value = ?1, updated_by = ?2, updated_at = ?3`)
    .bind(JSON.stringify({ ...current, dailyCap: n }), who.user.id, nowIso()).run();
  await audit(env, { actorId: who.user.id, action: 'campaign.limit', target: 'settings:campaigns', detail: { from: before, to: n }, ip: clientIp(request) });
  return json({ dailyCap: n, message: `The daily limit is now ${n.toLocaleString('en-IN')} campaign emails.` });
}

/* ---------- sending (the cron, and "send now") ---------- */
/** Fixes who a due campaign goes to and starts it. Only one caller wins the change to 'sending'. */
async function startCampaign(env, c, now) {
  const DB = env.DB;
  const claim = await DB.prepare(`UPDATE email_campaigns SET status = 'sending', started_at = ?2, updated_at = ?2 WHERE id = ?1 AND status = 'scheduled'`).bind(c.id, now).run();
  if (!claim.meta || claim.meta.changes !== 1) return false;
  const b = new Binder();
  const cid = b.p(c.id);
  const from = audienceFrom(b, storedAudience(c.audience), now);
  await DB.prepare(`INSERT OR IGNORE INTO campaign_sends (campaign_id, user_id, status) SELECT ${cid}, u.id, 'waiting' ${from}`).bind(...b.args).run();
  const total = (await DB.prepare('SELECT COUNT(*) AS n FROM campaign_sends WHERE campaign_id = ?1').bind(c.id).first()).n;
  await DB.prepare('UPDATE email_campaigns SET total = ?2 WHERE id = ?1').bind(c.id, total).run();
  await audit(env, { action: 'campaign.start', target: `campaign:${c.id}`, detail: { total } });
  return true;
}

/** One pass: start what is due, send the next few within the daily limit, close what is done. → counts. */
export async function runCampaigns(env, { now = nowIso() } = {}) {
  const DB = env.DB;
  const out = { started: 0, sent: 0, failed: 0, skipped: 0 };
  const due = (await DB.prepare("SELECT id, audience FROM email_campaigns WHERE status = 'scheduled' AND send_at <= ?1 ORDER BY send_at, id LIMIT 5").bind(now).all()).results;
  for (const c of due) if (await startCampaign(env, c, now)) out.started++;
  // a person claimed by a run that was cut off: not sent again (it may have gone), counted as failed
  await DB.prepare("UPDATE campaign_sends SET status = 'failed' WHERE status = 'sending' AND sent_at <= ?1")
    .bind(new Date(Date.parse(now) - STUCK_MS).toISOString()).run();

  if (emailEnabled(env)) {
    const room = Math.min(perRun(env).campaigns, (await dailyCap(env)) - (await usedToday(env, now)));
    const rows = room > 0 ? (await DB.prepare(`SELECT s.campaign_id, s.user_id, c.subject, c.body, u.email, u.full_name, u.account_status, u.email_verified,
                                                      COALESCE(p.announcements, 1) AS news
                                                 FROM campaign_sends s JOIN email_campaigns c ON c.id = s.campaign_id JOIN users u ON u.id = s.user_id
                                                 LEFT JOIN email_preferences p ON p.user_id = s.user_id
                                                WHERE s.status = 'waiting' AND c.status = 'sending'
                                                ORDER BY c.started_at, c.id, s.user_id LIMIT ?1`).bind(room).all()).results : [];
    for (const r of rows) {
      const at = nowIso();
      const claim = await DB.prepare("UPDATE campaign_sends SET status = 'sending', sent_at = ?3 WHERE campaign_id = ?1 AND user_id = ?2 AND status = 'waiting'")
        .bind(r.campaign_id, r.user_id, at).run();
      if (!claim.meta || claim.meta.changes !== 1) continue; // another run has them
      if (r.account_status !== 'active' || !r.email_verified || !r.news) {
        await DB.prepare("UPDATE campaign_sends SET status = 'skipped', sent_at = NULL WHERE campaign_id = ?1 AND user_id = ?2").bind(r.campaign_id, r.user_id).run();
        out.skipped++;
        continue;
      }
      const res = await sendTemplate(env, null, { to: r.email, userId: r.user_id, template: 'announcement', data: { name: r.full_name, subject: r.subject, body: r.body } });
      // a failed email is retried by the email cron like any other; here it only counts
      const status = res.status === 'sent' ? 'sent' : 'failed';
      await DB.prepare('UPDATE campaign_sends SET status = ?3, email_id = ?4 WHERE campaign_id = ?1 AND user_id = ?2').bind(r.campaign_id, r.user_id, status, res.id).run();
      out[status]++;
    }
  }
  await DB.prepare(`UPDATE email_campaigns SET status = 'sent', finished_at = ?1, updated_at = ?1
                     WHERE status = 'sending' AND NOT EXISTS (SELECT 1 FROM campaign_sends s WHERE s.campaign_id = email_campaigns.id AND s.status IN ('waiting', 'sending'))`)
    .bind(now).run();
  return out;
}

/** The old /admin "Announcement" goes through here too, so it keeps to the daily limit. → { id, total } */
export async function campaignFromAnnouncement(env, ctx, user, { subject, body, audience }) {
  const a = parseAudience(audience) || { kind: 'all' };
  const id = `cmp_${uuid()}`, now = nowIso();
  await env.DB.prepare(`INSERT INTO email_campaigns (id, name, subject, body, audience, status, send_at, created_by, updated_by, created_at, updated_at)
                        VALUES (?1, ?2, ?3, ?4, ?5, 'scheduled', ?6, ?7, ?7, ?6, ?6)`)
    .bind(id, `Announcement: ${subject}`.slice(0, NAME_MAX), subject, body, JSON.stringify(a), now, user.id).run();
  await startCampaign(env, { id, audience: JSON.stringify(a) }, now);
  const total = (await env.DB.prepare('SELECT total FROM email_campaigns WHERE id = ?1').bind(id).first()).total;
  const run = runCampaigns(env).catch((err) => console.error('campaign run failed:', err && err.message));
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(run); else await run;
  return { id, total, dailyCap: await dailyCap(env) };
}

/* ---------- the email log ---------- */
export const EMAIL_KINDS = {
  welcome: 'Welcome', verify_email: 'Confirm email address', otp_login: 'Sign-in code', admin_otp: 'Admin sign-in code', password_reset: 'Password reset',
  login_alert: 'New sign-in', password_changed: 'Password changed', security_alert: 'Security alert', email_changed: 'Email address changed',
  payment_success: 'Payment received', payment_failed: 'Payment failed', invoice: 'Invoice', subscription_renewal_reminder: 'Plan ending soon',
  subscription_expired: 'Plan ended', refund_processed: 'Refund sent', announcement: 'Campaign or announcement', account_update: 'Account update',
  test_completed: 'Typing test result', contact_received: 'Contact form: copy to sender', contact_forward: 'Contact form: to support', support_reply: 'Support reply',
};
const EMAIL_STATUSES = ['queued', 'sent', 'delivered', 'failed', 'bounced', 'cancelled'];

export async function getEmails(request, env) {
  const who = await requireAdmin(env, request, 'emails.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q), DB = env.DB;
  const where = (b) => {
    const w = [];
    const term = (q.get('q') || '').trim().slice(0, 80);
    if (term) w.push(`(e.to_email LIKE ${b.once('q', like(term.toLowerCase()))} ESCAPE '\\' OR e.subject LIKE ${b.once('qs', like(term))} ESCAPE '\\')`);
    const status = oneOf(q.get('status'), EMAIL_STATUSES);
    if (status) w.push(`e.status = ${b.p(status)}`);
    const kind = oneOf(q.get('kind'), Object.keys(EMAIL_KINDS));
    if (kind) w.push(`e.template = ${b.p(kind)}`);
    return w.length ? 'WHERE ' + w.join(' AND ') : '';
  };
  const list = new Binder(), count = new Binder();
  const lw = where(list), cw = where(count);
  const dayAgo = new Date(Date.now() - DAY_MS).toISOString();
  const [rows, total, last24h] = await DB.batch([
    DB.prepare(`SELECT e.* FROM email_logs e ${lw} ORDER BY e.created_at DESC, e.id LIMIT ${PAGE_SIZE} OFFSET ${offsetOf(page)}`).bind(...list.args),
    DB.prepare(`SELECT COUNT(*) AS n FROM email_logs e ${cw}`).bind(...count.args),
    DB.prepare('SELECT status, COUNT(*) AS n FROM email_logs WHERE created_at >= ?1 GROUP BY status').bind(dayAgo),
  ]);
  const canRetry = await can(env, who.role, 'emails.retry');
  const items = rows.results.map((r) => {
    const e = publicLog(r);
    return { ...e, kind: EMAIL_KINDS[r.template] || r.template, retryable: canRetry && e.retryable };
  });
  return json({ ...paged(items, page, total.results[0].n), last24h: Object.fromEntries(last24h.results.map((s) => [s.status, s.n])),
    kinds: EMAIL_KINDS, emailOn: emailEnabled(env), can: { retry: canRetry } });
}

export async function retryEmail(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'emails.retry');
  const row = await env.DB.prepare('SELECT * FROM email_logs WHERE id = ?1').bind(idParam(params.id, 'Email not found.')).first();
  if (!row) throw new HttpError(404, 'not_found', 'Email not found.');
  if (SENSITIVE.has(row.template)) throw new HttpError(409, 'not_retryable', "Codes and links can't be sent again. Ask the person to request a new one.");
  if (!['failed', 'bounced', 'cancelled'].includes(row.status)) throw new HttpError(409, 'not_retryable', 'Only a failed, bounced or cancelled email can be sent again.');
  if (!emailEnabled(env)) throw new HttpError(503, 'email_not_configured', "Email sending isn't set up for this site yet.");
  if (!(await hitLimit(env, `email-retry:${who.user.id}`, 30, 3600))) throw tooMany(60);
  const result = await sendAgain(env, row, { manual: true });
  await audit(env, { actorId: who.user.id, action: 'email.retry', target: `email:${row.id}`, detail: { template: row.template, result }, ip: clientIp(request) });
  const after = await env.DB.prepare('SELECT * FROM email_logs WHERE id = ?1').bind(row.id).first();
  return json({ email: { ...publicLog(after), kind: EMAIL_KINDS[after.template] || after.template }, result,
    message: result === 'sent' ? 'Sent again.' : "It didn't go this time either. Check the address, or try again later." });
}

/* ---------- the cron (every 10 minutes) ---------- */
export async function cron(env, ctx, kind) {
  if (kind !== '*/10 * * * *') return;
  try { await runCampaigns(env); } catch (err) {
    if (!/no such table/i.test(String(err && err.message))) throw err; // before migration 0015: nothing to send
  }
}

export const ROUTES = {
  'GET /api/console/campaigns': getCampaigns,
  'POST /api/console/campaigns': postCampaign,
  'GET /api/console/campaigns/audience': getAudience,
  'PUT /api/console/campaigns/limit': putLimit,
  'GET /api/console/emails': getEmails,
};
const ID = '(cmp_[\\w-]{1,64})';
export const PATTERNS = [
  ['GET', new RegExp(`^/api/console/campaigns/${ID}$`), ['id'], getCampaign],
  ['PUT', new RegExp(`^/api/console/campaigns/${ID}$`), ['id'], putCampaign],
  ['DELETE', new RegExp(`^/api/console/campaigns/${ID}$`), ['id'], deleteCampaign],
  ['POST', new RegExp(`^/api/console/campaigns/${ID}/test$`), ['id'], testCampaign],
  ['POST', new RegExp(`^/api/console/campaigns/${ID}/schedule$`), ['id'], scheduleCampaign],
  ['POST', new RegExp(`^/api/console/campaigns/${ID}/unschedule$`), ['id'], unscheduleCampaign],
  ['POST', new RegExp(`^/api/console/campaigns/${ID}/cancel$`), ['id'], cancelCampaign],
  ['POST', /^\/api\/console\/emails\/(em_[\w-]{1,64})\/retry$/, ['id'], retryEmail],
];
