// Central email service (docs/SAAS-CONTRACTS.md §4): templated sending through the Resend
// HTTP API with a log row per email (email_logs), retries, rate limits; plus the contact
// form, email preferences, unsubscribe, the Resend webhook and the admin email screens.
//
// Lifecycle of an email_logs row: queued → sent (→ delivered | bounced, from the webhook)
//                                        → failed (+ next_attempt_at: retried by the 10-minute
//                                          cron at +5 min, +30 min, +2 h, +12 h, then stays failed)
//                                        → cancelled (per-recipient rate limit)
// OTP, password reset and verification emails are never retried and their codes/links are
// never stored: the person asks for a new one instead.
import { HttpError, json, readJson, clientIp, fieldError, cleanName, cleanEmail, nowIso } from './http.js';
import { uuid } from './crypto.js';
import { getSession, requireSession, hitLimit, tooMany, emailEnabled } from './session.js';
import { requirePermission } from './console/session.js';
import { renderTemplate, TEMPLATE_NAMES } from './mail-templates.js';
import * as auth from './auth.js';
import * as entitlements from './entitlements.js';

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'TypeCraft <hello@typecrafttyping.com>';
const DEFAULT_REPLY_TO = 'hello@typecrafttyping.com';
const DEFAULT_SITE = 'https://typecrafttyping.in';
const MIN = 60 * 1000;
export const RETRY_DELAYS_MS = [5 * MIN, 30 * MIN, 120 * MIN, 720 * MIN];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // first try + 4 retries
const STALE_MS = 15 * MIN;                       // a 'queued' row this old was cut off mid-send
const RETRY_BATCH = 50;                          // failed emails retried per cron run
export const ANNOUNCE_BATCH = 100;               // announcement emails sent per run (request or cron)
const ANNOUNCE_MAX_AUDIENCE = 20000;

/** Templates whose content is a secret (code or link): no retry, nothing secret in the log. */
export const SENSITIVE = new Set(['otp_login', 'admin_otp', 'password_reset', 'verify_email']);
const SECRET_KEYS = ['code', 'link', 'token', 'otp', 'resetLink', 'verifyLink'];
const CATEGORY = {
  welcome: 'auth', verify_email: 'auth', otp_login: 'auth', admin_otp: 'security', password_reset: 'auth',
  login_alert: 'security', password_changed: 'security', security_alert: 'security', email_changed: 'security',
  payment_success: 'billing', payment_failed: 'billing', invoice: 'billing', subscription_renewal_reminder: 'billing',
  subscription_expired: 'billing', refund_processed: 'billing',
  announcement: 'platform', account_update: 'transactional', test_completed: 'transactional',
  contact_received: 'support', contact_forward: 'support', support_reply: 'support',
};
const CATEGORIES = ['auth', 'security', 'transactional', 'billing', 'platform', 'support'];
// per recipient per template, per hour
const PER_RECIPIENT = { otp_login: 5, admin_otp: 10, password_reset: 5, verify_email: 5 };
const PER_RECIPIENT_DEFAULT = 20;
const GLOBAL_LIMIT = 300;      // emails per 10 minutes, all templates
const GLOBAL_WINDOW = 600;

/* ---------- configuration ---------- */
export function siteUrl(env) {
  return String(env.SITE_URL || DEFAULT_SITE).replace(/\/+$/, '');
}

export async function getSetting(env, key, fallback = {}) {
  try {
    const row = await env.DB.prepare('SELECT value FROM platform_settings WHERE key = ?1').bind(key).first();
    return row ? { ...fallback, ...JSON.parse(row.value) } : fallback;
  } catch { return fallback; }
}

async function supportEmail(env) {
  const s = await getSetting(env, 'support', {});
  const e = cleanEmail(s.email);
  return e.value || DEFAULT_REPLY_TO;
}

const enc = new TextEncoder();
async function hmac(secretBytes, message) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Signed unsubscribe token for announcements (needs SESSION_SECRET). */
async function unsubscribeToken(env, userId) {
  if (!env.SESSION_SECRET || !userId) return null;
  return hex(await hmac(enc.encode(env.SESSION_SECRET), `unsubscribe:v1:${userId}`)).slice(0, 40);
}
async function unsubscribeUrl(env, userId) {
  const t = await unsubscribeToken(env, userId);
  if (!t) return `${siteUrl(env)}/account/settings`;
  return `${siteUrl(env)}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${t}`;
}

/** What may be kept in email_logs.payload: everything except codes, links and tokens. */
function storedData(template, data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (SECRET_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

async function renderFor(env, template, data, userId) {
  const site = { siteUrl: siteUrl(env), supportEmail: await supportEmail(env) };
  if (template === 'announcement') site.unsubscribeUrl = await unsubscribeUrl(env, userId);
  return { rendered: renderTemplate(template, data, site), unsubscribe: site.unsubscribeUrl || null };
}

/* ---------- provider ---------- */
async function callResend(env, { id, attempt: n, to, replyTo, rendered, template, unsubscribe }) {
  const body = {
    from: env.EMAIL_FROM || DEFAULT_FROM,
    to: [to],
    reply_to: replyTo || env.EMAIL_REPLY_TO || DEFAULT_REPLY_TO,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    tags: [{ name: 'template', value: template }],
  };
  if (unsubscribe) body.headers = { 'List-Unsubscribe': `<${unsubscribe}>` };
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `${id}/${n}` },
      body: JSON.stringify(body),
    });
    let providerId = null;
    try { providerId = (await res.json()).id || null; } catch { providerId = null; }
    if (res.ok) return { ok: true, providerId };
    // 429 and 5xx are worth retrying; other 4xx (bad address, bad request) are not
    return { ok: false, error: `http_${res.status}`, transient: res.status === 429 || res.status >= 500 };
  } catch (err) {
    return { ok: false, error: 'network_error', transient: true };
  }
}

/* ---------- the log row and one delivery attempt ---------- */
async function setRow(env, id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `${k} = ?${i + 2}`).join(', ');
  await env.DB.prepare(`UPDATE email_logs SET ${sets}, updated_at = ?${keys.length + 2} WHERE id = ?1`)
    .bind(id, ...keys.map((k) => fields[k]), nowIso()).run();
}

/**
 * Claims the row (only one sender wins: attempts must still be `seenAttempts`), sends, and
 * records the result. → 'sent' | 'failed' | 'skipped' (someone else claimed it).
 */
async function attempt(env, row, rendered, replyTo, unsubscribe, { manual = false } = {}) {
  const now = nowIso();
  const claim = await env.DB.prepare(
    `UPDATE email_logs SET status = 'queued', attempts = attempts + 1, last_error = NULL, next_attempt_at = NULL, updated_at = ?4
      WHERE id = ?1 AND status = ?2 AND attempts = ?3`
  ).bind(row.id, row.status, row.attempts, now).run();
  if (!claim.meta || claim.meta.changes !== 1) return 'skipped';
  const attempts = row.attempts + 1;
  const r = await callResend(env, { id: row.id, attempt: attempts, to: row.to_email, replyTo, rendered, template: row.template, unsubscribe });
  if (r.ok) {
    await setRow(env, row.id, { status: 'sent', provider_id: r.providerId, sent_at: nowIso(), last_error: null, next_attempt_at: null });
    return 'sent';
  }
  const delay = !SENSITIVE.has(row.template) && r.transient && !manual ? RETRY_DELAYS_MS[attempts - 1] : undefined;
  await setRow(env, row.id, {
    status: 'failed', last_error: r.error,
    next_attempt_at: delay ? new Date(Date.now() + delay).toISOString() : null,
  });
  console.error('email not sent:', row.template, r.error); // no address, no content
  return 'failed';
}

/**
 * Queue and send one templated email. Never throws; returns { id, status }
 * (status: 'sent' | 'failed' | 'cancelled'). See the contract §4.
 */
export async function sendTemplate(env, ctx, { to, userId = null, template, data = {}, category, replyTo = null } = {}) {
  let id = null;
  try {
    const email = cleanEmail(to);
    if (email.error) return { id: null, status: 'failed' };
    const { rendered, unsubscribe } = await renderFor(env, template, data, userId);
    id = `em_${uuid()}`;
    const now = nowIso();
    const cat = CATEGORIES.includes(category) ? category : (CATEGORY[template] || 'transactional');
    const payload = JSON.stringify({ data: storedData(template, data), replyTo: replyTo || undefined });
    await env.DB.prepare(
      `INSERT INTO email_logs (id, user_id, to_email, template, category, subject, payload, status, provider, attempts, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'queued', 'resend', 0, ?8, ?8)`
    ).bind(id, userId || null, email.value, template, cat, rendered.subject, payload, now).run();

    if (!env.RESEND_API_KEY) {
      await setRow(env, id, { status: 'failed', last_error: 'not_configured' });
      return { id, status: 'failed' };
    }
    const perRecipient = PER_RECIPIENT[template] || PER_RECIPIENT_DEFAULT;
    if (!(await hitLimit(env, `mail:${template}:${email.value}`, perRecipient, 3600))) {
      await setRow(env, id, { status: 'cancelled', last_error: 'rate_limited_recipient' });
      return { id, status: 'cancelled' };
    }
    if (!(await hitLimit(env, 'mail:global', GLOBAL_LIMIT, GLOBAL_WINDOW))) {
      await setRow(env, id, {
        status: 'failed', last_error: 'rate_limited',
        next_attempt_at: SENSITIVE.has(template) ? null : new Date(Date.now() + RETRY_DELAYS_MS[0]).toISOString(),
      });
      return { id, status: 'failed' };
    }
    const row = { id, to_email: email.value, template, status: 'queued', attempts: 0 };
    const status = await attempt(env, row, rendered, replyTo, unsubscribe);
    return { id, status: status === 'sent' ? 'sent' : 'failed' };
  } catch (err) {
    console.error('sendTemplate error:', template, err && err.message);
    if (id) { try { await setRow(env, id, { status: 'failed', last_error: 'internal_error' }); } catch { /* ignore */ } }
    return { id, status: 'failed' };
  }
}

/** For non-critical emails: sends after the response when the runtime allows it. */
export function sendLater(env, ctx, args) {
  const p = sendTemplate(env, ctx, args);
  if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(p); return Promise.resolve({ id: null, status: 'pending' }); }
  return p;
}

/** Re-sends a logged email from its stored payload (never for sensitive templates). */
export async function resendRow(env, row, opts = {}) {
  if (SENSITIVE.has(row.template)) return 'skipped';
  if (!env.RESEND_API_KEY) return 'skipped';
  let payload = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { payload = {}; }
  let rendered, unsubscribe;
  try { ({ rendered, unsubscribe } = await renderFor(env, row.template, payload.data || {}, row.user_id)); }
  catch {
    await setRow(env, row.id, { status: 'failed', last_error: 'render_failed', next_attempt_at: null });
    return 'failed';
  }
  return attempt(env, row, rendered, payload.replyTo || null, unsubscribe, opts);
}

/* ---------- cron: retries and announcement batches ---------- */
export async function cron(env, ctx, kind) {
  if (kind !== '*/10 * * * *') return;
  await processQueue(env, { cap: RETRY_BATCH + ANNOUNCE_BATCH });
}

/** One pass over due work. Returns counts. Exported for tests. */
export async function processQueue(env, { cap = RETRY_BATCH + ANNOUNCE_BATCH, onlyAnnouncements = false } = {}) {
  const now = nowIso();
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  const sensitive = [...SENSITIVE].map((t) => `'${t}'`).join(', ');
  // codes/links cut off mid-send are not retried
  await env.DB.prepare(
    `UPDATE email_logs SET status = 'failed', last_error = 'abandoned', next_attempt_at = NULL, updated_at = ?1
      WHERE status = 'queued' AND template IN (${sensitive}) AND updated_at <= ?2`
  ).bind(now, stale).run();
  // rows cut off mid-send after their last allowed attempt stay failed
  await env.DB.prepare(
    `UPDATE email_logs SET status = 'failed', last_error = COALESCE(last_error, 'abandoned'), next_attempt_at = NULL, updated_at = ?1
      WHERE status = 'queued' AND attempts >= ?3 AND updated_at <= ?2`
  ).bind(now, stale, MAX_ATTEMPTS).run();
  const where = onlyAnnouncements
    ? "status = 'queued' AND template = 'announcement' AND attempts = 0"
    : `template NOT IN (${sensitive}) AND (
         (status = 'failed' AND next_attempt_at IS NOT NULL AND next_attempt_at <= ?1)
         OR (status = 'queued' AND template = 'announcement' AND attempts = 0)
         OR (status = 'queued' AND updated_at <= ?2 AND attempts < ${MAX_ATTEMPTS}))`;
  const rows = (await env.DB.prepare(
    `SELECT * FROM email_logs WHERE ${where} ORDER BY created_at LIMIT ${Math.max(1, Math.min(500, cap | 0))}`
  ).bind(...(onlyAnnouncements ? [] : [now, stale])).all()).results;
  const counts = { sent: 0, failed: 0, skipped: 0, limited: 0 };
  for (const row of rows) {
    if (!env.RESEND_API_KEY) break;
    if (!(await hitLimit(env, 'mail:global', GLOBAL_LIMIT, GLOBAL_WINDOW))) { counts.limited++; break; }
    const r = await resendRow(env, row);
    counts[r] = (counts[r] || 0) + 1;
  }
  return counts;
}

/* ---------- small shared helpers ---------- */
function runLater(ctx, promise) {
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(promise);
  else return promise;
  return null;
}

export async function audit(env, actorId, action, target, detail, request) {
  try {
    await env.DB.prepare('INSERT INTO audit_logs (id, actor_id, action, target, detail, ip, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
      .bind(uuid(), actorId || null, action, target || null, detail ? JSON.stringify(detail) : null, request ? clientIp(request) : null, nowIso()).run();
  } catch (err) { console.error('audit log failed:', err && err.message); }
}

const PAGE_SIZE = 50;
function pageOf(url) {
  const p = parseInt(url.searchParams.get('page') || '1', 10);
  return Number.isFinite(p) && p > 0 ? Math.min(p, 10000) : 1;
}

/* ---------- email preferences ---------- */
const PREF_DEFAULTS = { announcements: true, testResults: false, loginAlerts: true };

export async function getPreferences(env, userId) {
  const row = await env.DB.prepare('SELECT announcements, test_results, login_alerts, updated_at FROM email_preferences WHERE user_id = ?1').bind(userId).first();
  if (!row) return { ...PREF_DEFAULTS };
  return { announcements: !!row.announcements, testResults: !!row.test_results, loginAlerts: !!row.login_alerts };
}

async function savePreferences(env, userId, prefs) {
  await env.DB.prepare(
    `INSERT INTO email_preferences (user_id, announcements, test_results, login_alerts, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (user_id) DO UPDATE SET announcements = ?2, test_results = ?3, login_alerts = ?4, updated_at = ?5`
  ).bind(userId, prefs.announcements ? 1 : 0, prefs.testResults ? 1 : 0, prefs.loginAlerts ? 1 : 0, nowIso()).run();
}

export async function getEmailPreferences(request, env) {
  const { user } = await requireSession(env, request);
  return json({ preferences: await getPreferences(env, user.id) });
}

export async function putEmailPreferences(request, env) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request, 4096);
  const prefs = await getPreferences(env, user.id);
  const fields = {};
  for (const k of Object.keys(PREF_DEFAULTS)) {
    if (!(k in body)) continue;
    if (typeof body[k] !== 'boolean') fields[k] = 'Choose on or off.';
    else prefs[k] = body[k];
  }
  if (Object.keys(fields).length) throw fieldError(fields);
  await savePreferences(env, user.id, prefs);
  return json({ preferences: prefs, message: 'Email preferences saved.' });
}

/* ---------- unsubscribe (link in announcements) ---------- */
async function checkUnsubscribe(env, u, t) {
  if (typeof u !== 'string' || typeof t !== 'string' || u.length > 64 || t.length > 64) return false;
  const want = await unsubscribeToken(env, u);
  return !!want && sameText(want, t);
}

export async function unsubscribePage(request, env) {
  const url = new URL(request.url);
  const u = url.searchParams.get('u') || '', t = url.searchParams.get('t') || '';
  const ok = await checkUnsubscribe(env, u, t);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // A GET never changes anything (link scanners open links); the button sends the JSON POST.
  const body = ok
    ? `<h1>Unsubscribe from announcements?</h1><p>You'll still get emails about your account, security and payments.</p>
<button id="b" type="button">Unsubscribe</button><p id="m" role="status"></p>
<script>document.getElementById('b').onclick=async function(){this.disabled=true;var r=await fetch('/api/email/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({u:${JSON.stringify(esc(u))},t:${JSON.stringify(esc(t))}})});document.getElementById('m').textContent=r.ok?'Done. You won\\'t get announcements any more.':'That didn\\'t work. Please try again or change it in your account settings.';};</script>`
    : '<h1>This link has expired</h1><p>You can change which emails you get in your account settings.</p>';
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Email preferences · TypeCraft</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 20px;color:#14201e;background:#f3f6f5}button{background:#0b6e63;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:16px;cursor:pointer}a{color:#0b6e63}</style></head>
<body>${body}<p><a href="${esc(siteUrl(env))}/account/settings">Email settings</a></p></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Frame-Options': 'DENY' } });
}

export async function unsubscribe(request, env) {
  const body = await readJson(request, 1024);
  if (!(await hitLimit(env, `unsub-ip:${clientIp(request)}`, 30, 3600))) throw tooMany(60);
  if (!(await checkUnsubscribe(env, body.u, body.t))) throw new HttpError(400, 'invalid_token', 'This unsubscribe link is invalid. Change your email settings in your account instead.');
  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE id = ?1').bind(body.u).first();
  if (exists) {
    const prefs = await getPreferences(env, body.u);
    await savePreferences(env, body.u, { ...prefs, announcements: false });
  }
  return json({ message: "You're unsubscribed from announcements." });
}

/* ---------- contact form ---------- */
const TOPICS = ['general', 'institutes', 'billing', 'technical', 'account', 'feedback', 'other'];

export async function contact(request, env, ctx) {
  const body = await readJson(request, 32 * 1024);
  const fields = {};
  const name = cleanName(body.name); if (name.error) fields.name = name.error;
  const email = cleanEmail(body.email); if (email.error) fields.email = email.error;
  const topic = TOPICS.includes(body.topic) ? body.topic : 'general';
  const message = typeof body.message === 'string' ? body.message.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
  if (message.length < 10) fields.message = 'Write a little more so we can help (at least 10 characters).';
  else if (message.length > 5000) fields.message = 'Keep your message under 5,000 characters.';
  if (Object.keys(fields).length) throw fieldError(fields);
  if (!(await hitLimit(env, `contact-ip:${clientIp(request)}`, 5, 3600))) throw tooMany(60);
  const support = await getSetting(env, 'support', { email: DEFAULT_REPLY_TO, replyDays: 2 });
  const thanks = `Thanks, we've got your message and will reply to ${email.value} within ${support.replyDays || 2} working days.`;
  // a hidden field real people leave empty: bots get the same answer, nothing is stored
  if (typeof body.website === 'string' && body.website.trim()) return json({ message: thanks });

  let session = null;
  try { session = await getSession(env, request); } catch { session = null; }
  let priority = 0, plan = null;
  if (session && typeof entitlements.entitlementsFor === 'function') {
    try {
      const ent = await entitlements.entitlementsFor(env, session.user.id);
      plan = ent && ent.planName || null;
      const has = typeof entitlements.has === 'function' ? entitlements.has(ent, 'support.priority') : (ent && (ent.features || []).includes('support.priority'));
      priority = has ? 1 : 0;
    } catch { priority = 0; }
  }
  const id = `msg_${uuid()}`;
  await env.DB.prepare(
    `INSERT INTO contact_messages (id, user_id, name, email, topic, message, priority, status, ip, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'new', ?8, ?9)`
  ).bind(id, session ? session.user.id : null, name.value, email.value, topic, message, priority, clientIp(request), nowIso()).run();

  const to = cleanEmail(support.email).value || DEFAULT_REPLY_TO;
  const sends = Promise.all([
    sendTemplate(env, ctx, { to, template: 'contact_forward', category: 'support', replyTo: email.value,
      data: { name: name.value, email: email.value, topic, message, userId: session ? session.user.id : null, priority: !!priority, plan, messageId: id } }),
    sendTemplate(env, ctx, { to: email.value, userId: session ? session.user.id : null, template: 'contact_received', category: 'support',
      data: { name: name.value, topic, message, replyDays: support.replyDays || 2 } }),
  ]);
  await runLater(ctx, sends);
  return json({ message: thanks, id }, 201);
}

/* ---------- Resend webhook (Svix signatures) ---------- */
function b64decode(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64encode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Svix: base64(HMAC-SHA256(`${id}.${timestamp}.${body}`, base64-decoded secret after "whsec_")). */
export async function verifySvix(secret, headers, rawBody, nowSeconds = Math.floor(Date.now() / 1000)) {
  const id = headers.get('svix-id'), ts = headers.get('svix-timestamp'), sigs = headers.get('svix-signature');
  if (!secret || !id || !ts || !sigs) return false;
  const t = parseInt(ts, 10);
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > 300) return false;
  let key;
  try { key = b64decode(String(secret).replace(/^whsec_/, '')); } catch { return false; }
  const expected = b64encode(await hmac(key, `${id}.${ts}.${rawBody}`));
  return sigs.split(' ').some((part) => {
    const [version, sig] = part.split(',');
    return version === 'v1' && sameText(sig, expected);
  });
}

export async function resendWebhook(request, env) {
  if (!env.RESEND_WEBHOOK_SECRET) throw new HttpError(404, 'not_found', 'Not found.');
  const raw = await request.text();
  if (raw.length > 256 * 1024) throw new HttpError(413, 'too_large', 'Too large.');
  if (!(await verifySvix(env.RESEND_WEBHOOK_SECRET, request.headers, raw))) throw new HttpError(401, 'bad_signature', 'Signature check failed.');
  let event;
  try { event = JSON.parse(raw); } catch { throw new HttpError(400, 'bad_json', 'The request could not be read.'); }
  const providerId = event && event.data && event.data.email_id;
  if (!providerId || typeof providerId !== 'string') return json({ ignored: true });
  const now = nowIso();
  if (event.type === 'email.delivered') {
    await env.DB.prepare("UPDATE email_logs SET status = 'delivered', updated_at = ?2 WHERE provider_id = ?1 AND status = 'sent'").bind(providerId, now).run();
  } else if (event.type === 'email.bounced' || event.type === 'email.complained') {
    const row = await env.DB.prepare('SELECT id, user_id FROM email_logs WHERE provider_id = ?1').bind(providerId).first();
    if (row) {
      await env.DB.prepare("UPDATE email_logs SET status = 'bounced', last_error = ?3, next_attempt_at = NULL, updated_at = ?2 WHERE id = ?1")
        .bind(row.id, now, event.type === 'email.complained' ? 'complained' : 'bounced').run();
      // someone who marked us as spam gets no more announcements
      if (event.type === 'email.complained' && row.user_id) {
        const prefs = await getPreferences(env, row.user_id);
        await savePreferences(env, row.user_id, { ...prefs, announcements: false });
      }
    }
  } else {
    return json({ ignored: true });
  }
  return json({ received: true });
}

/* ---------- admin: emails ---------- */
export function publicLog(r) {
  return {
    id: r.id, userId: r.user_id, to: r.to_email, template: r.template, category: r.category, subject: r.subject,
    status: r.status, attempts: r.attempts, lastError: r.last_error, nextAttemptAt: r.next_attempt_at,
    sentAt: r.sent_at, providerId: r.provider_id, createdAt: r.created_at, updatedAt: r.updated_at,
    retryable: !SENSITIVE.has(r.template) && ['failed', 'bounced', 'cancelled'].includes(r.status),
  };
}

export async function adminEmails(request, env) {
  await requirePermission(env, request, 'emails.view');
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const q = (url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
  const page = pageOf(url);
  const where = [], args = [];
  if (status) {
    if (!['queued', 'sent', 'failed', 'bounced', 'delivered', 'cancelled'].includes(status)) throw fieldError({ status: 'Unknown status.' });
    args.push(status); where.push(`status = ?${args.length}`);
  }
  if (q) {
    args.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(to_email LIKE ?${args.length} ESCAPE '\\' OR template LIKE ?${args.length} ESCAPE '\\' OR subject LIKE ?${args.length} ESCAPE '\\')`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM email_logs ${w}`).bind(...args).first()).n;
  const rows = (await env.DB.prepare(`SELECT * FROM email_logs ${w} ORDER BY created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`).bind(...args).all()).results;
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const stats = (await env.DB.prepare('SELECT status, COUNT(*) AS n FROM email_logs WHERE created_at >= ?1 GROUP BY status').bind(dayAgo).all()).results;
  return json({
    emails: rows.map(publicLog), page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total,
    last24h: Object.fromEntries(stats.map((s) => [s.status, s.n])), templates: TEMPLATE_NAMES, configured: emailEnabled(env),
  });
}

export async function adminRetryEmail(request, env, ctx, params) {
  const { user } = await requirePermission(env, request, 'emails.retry');
  const row = await env.DB.prepare('SELECT * FROM email_logs WHERE id = ?1').bind(params.id).first();
  if (!row) throw new HttpError(404, 'not_found', 'That email was not found.');
  if (SENSITIVE.has(row.template)) throw new HttpError(400, 'not_retryable', "Codes and links can't be sent again. Ask the person to request a new one.");
  if (!['failed', 'bounced', 'cancelled'].includes(row.status)) throw new HttpError(400, 'not_retryable', 'Only failed, bounced or cancelled emails can be retried.');
  if (!emailEnabled(env)) throw new HttpError(503, 'email_not_configured', "Email sending isn't set up for this site yet.");
  const result = await resendRow(env, row, { manual: true });
  await audit(env, user.id, 'email.retry', `email:${row.id}`, { template: row.template, result }, request);
  const after = await env.DB.prepare('SELECT * FROM email_logs WHERE id = ?1').bind(row.id).first();
  return json({ email: publicLog(after), result });
}

/** Sends a logged email again from its stored payload (the console's email log). */
export const sendAgain = (env, row, opts) => resendRow(env, row, opts);

/* ---------- admin: announcements ---------- */
function audienceSql(audience) {
  const active = "(s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?1))";
  const paid = `EXISTS (SELECT 1 FROM user_subscriptions s WHERE s.user_id = u.id AND ${active})`;
  const filter = audience === 'paid' ? `AND ${paid}` : audience === 'free' ? `AND NOT ${paid}` : '';
  return `SELECT u.id, u.full_name, u.email FROM users u LEFT JOIN email_preferences p ON p.user_id = u.id
           WHERE u.account_status = 'active' AND u.email_verified = 1 AND COALESCE(p.announcements, 1) = 1 ${filter}
           ORDER BY u.created_at LIMIT ${ANNOUNCE_MAX_AUDIENCE}`;
}

export async function adminAnnouncement(request, env, ctx) {
  const { user } = await requirePermission(env, request, 'emails.announce');
  const body = await readJson(request, 64 * 1024);
  const fields = {};
  const subject = typeof body.subject === 'string' ? body.subject.trim().replace(/\s+/g, ' ') : '';
  const text = typeof body.body === 'string' ? body.body.replace(/\r\n/g, '\n').trim() : '';
  const audience = body.audience || 'all';
  if (!subject) fields.subject = 'Write a subject.'; else if (subject.length > 150) fields.subject = 'Keep the subject under 150 characters.';
  if (!text) fields.body = 'Write the message.'; else if (text.length > 20000) fields.body = 'Keep the message under 20,000 characters.';
  if (!['all', 'paid', 'free'].includes(audience)) fields.audience = 'Choose all, paid or free.';
  if (Object.keys(fields).length) throw fieldError(fields);
  if (!emailEnabled(env)) throw new HttpError(503, 'email_not_configured', "Email sending isn't set up for this site yet.");

  if (body.test === true) {
    const r = await sendTemplate(env, ctx, { to: user.email, userId: user.id, template: 'announcement', data: { name: user.fullName, subject, body: text } });
    return json({ test: true, status: r.status, to: user.email });
  }
  if (!(await hitLimit(env, `announce:${user.id}`, 5, 3600))) throw tooMany(60);
  // With email campaigns switched on (migration 0012) an announcement is a campaign that starts now, so it
  // keeps to the daily limit (docs/ADMIN-PHASE-4.md §4). Before that, the old way below.
  try {
    const { campaignFromAnnouncement } = await import('./console/campaigns-api.js');
    const c = await campaignFromAnnouncement(env, ctx, user, { subject, body: text, audience });
    await audit(env, user.id, 'announcement.send', `audience:${audience}`, { subject, recipients: c.total, campaign: c.id }, request);
    return json({ queued: c.total, audience, campaignId: c.id, dailyCap: c.dailyCap,
      message: `Queued for ${c.total} people as a campaign. Up to ${c.dailyCap} campaign emails are sent a day; follow it in the admin console under Email campaigns.` }, 202);
  } catch (err) {
    if (!/no such table/i.test(String(err && err.message))) throw err;
  }
  const recipients = (await env.DB.prepare(audienceSql(audience)).bind(...(audience === 'all' ? [] : [nowIso()])).all()).results;
  const now = nowIso();
  const stmts = recipients.map((r) => env.DB.prepare(
    `INSERT INTO email_logs (id, user_id, to_email, template, category, subject, payload, status, provider, attempts, created_at, updated_at)
     VALUES (?1, ?2, ?3, 'announcement', 'platform', ?4, ?5, 'queued', 'resend', 0, ?6, ?6)`
  ).bind(`em_${uuid()}`, r.id, r.email, subject, JSON.stringify({ data: { name: r.full_name, subject, body: text } }), now));
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  await audit(env, user.id, 'announcement.send', `audience:${audience}`, { subject, recipients: recipients.length }, request);
  // the first batch goes now (after the response); the 10-minute cron sends the rest
  const first = processQueue(env, { cap: ANNOUNCE_BATCH, onlyAnnouncements: true }).catch(() => {});
  await runLater(ctx, first);
  return json({ queued: recipients.length, audience, batchSize: ANNOUNCE_BATCH, message: `Queued for ${recipients.length} people. Up to ${ANNOUNCE_BATCH} are sent every 10 minutes.` }, 202);
}

/* ---------- admin: contact messages ---------- */
export async function adminContact(request, env) {
  await requirePermission(env, request, 'support.view');
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || '';
  const page = pageOf(url);
  if (status && !['new', 'answered', 'closed'].includes(status)) throw fieldError({ status: 'Unknown status.' });
  const w = status ? 'WHERE status = ?1' : '';
  const args = status ? [status] : [];
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM contact_messages ${w}`).bind(...args).first()).n;
  const rows = (await env.DB.prepare(
    `SELECT id, user_id, name, email, topic, message, priority, status, created_at FROM contact_messages ${w}
      ORDER BY priority DESC, created_at DESC LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`
  ).bind(...args).all()).results;
  return json({
    messages: rows.map((r) => ({ id: r.id, userId: r.user_id, name: r.name, email: r.email, topic: r.topic, message: r.message, priority: !!r.priority, status: r.status, createdAt: r.created_at })),
    page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total,
  });
}

export async function adminContactUpdate(request, env, ctx, params) {
  const { user } = await requirePermission(env, request, 'support.manage');
  const body = await readJson(request, 1024);
  if (!['new', 'answered', 'closed'].includes(body.status)) throw fieldError({ status: 'Choose new, answered or closed.' });
  const r = await env.DB.prepare('UPDATE contact_messages SET status = ?2 WHERE id = ?1').bind(params.id, body.status).run();
  if (!r.meta || r.meta.changes !== 1) throw new HttpError(404, 'not_found', 'That message was not found.');
  await audit(env, user.id, 'contact.status', `contact:${params.id}`, { status: body.status }, request);
  return json({ id: params.id, status: body.status });
}

/* ---------- routes ---------- */
export const ROUTES = {
  // auth handlers live in src/auth.js (wrapped: auth.js imports this module too)
  'POST /api/auth/otp/request': (...a) => auth.requestOtp(...a),
  'POST /api/auth/otp/verify': (...a) => auth.verifyOtpCode(...a),
  'POST /api/contact': contact,
  'GET /api/me/email-preferences': getEmailPreferences,
  'PUT /api/me/email-preferences': putEmailPreferences,
  'GET /api/email/unsubscribe': unsubscribePage,
  'POST /api/email/unsubscribe': unsubscribe,
  'POST /api/webhooks/resend': resendWebhook,
  'GET /api/admin/emails': adminEmails,
  'POST /api/admin/announcements': adminAnnouncement,
  'GET /api/admin/contact': adminContact,
};

export const PATTERNS = [
  ['POST', /^\/api\/admin\/emails\/(em_[\w-]{1,60})\/retry$/, ['id'], adminRetryEmail],
  ['POST', /^\/api\/admin\/contact\/(msg_[\w-]{1,60})$/, ['id'], adminContactUpdate],
];
