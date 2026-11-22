// Platform settings (platform_settings rows 'seller', 'support', 'payments' and 'signups'): what each holds,
// how a change is checked, and saving it with an activity-log entry. Used by the admin console's Settings page
// (src/console/settings-api.js). docs/ADMIN-PHASE-5.md §1.
//
// Where they are read: seller → every new invoice (src/invoices.js copies it at issue time); support → the
// reply-to of every email and the contact page; payments.enabled → checkout (src/billing.js); signups.open →
// creating an account (src/auth.js).
//
// There is no "test mode" switch: test or live follows the Razorpay key installed in Cloudflare (rzp_test_… or
// rzp_live_…). An old stored testMode value is dropped the next time payments are saved.
import { fieldError, nowIso } from './http.js';
import { audit } from './billing.js';

export const SECTIONS = {
  seller: ['name', 'legalName', 'address', 'email', 'phone', 'gstin'],
  support: ['email', 'hours', 'replyDays'],
  payments: ['enabled'],
  signups: ['open'],
};
export const DEFAULTS = { seller: {}, support: {}, payments: { enabled: true }, signups: { open: true } };
const REQUIRED = { seller: ['name', 'legalName', 'email'], support: ['email'] };
const MAX = { name: 120, legalName: 200, address: 300, email: 200, phone: 30, hours: 200 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/; // a new line is fine (the address), other control characters are not
const PLACEHOLDER = /\[Your /;

const parse = (text, def) => { try { const v = JSON.parse(text); return v && typeof v === 'object' && !Array.isArray(v) ? v : def; } catch { return def; } };

/** Every section, with who changed it last: { settings: { seller, … }, changed: { seller: { at, by } | null, … } } */
export async function readSettings(env) {
  const keys = Object.keys(SECTIONS);
  const rows = (await env.DB.prepare(`SELECT s.key, s.value, s.updated_at, u.full_name, u.email FROM platform_settings s LEFT JOIN users u ON u.id = s.updated_by
                                       WHERE s.key IN (${keys.map((_, i) => `?${i + 1}`).join(', ')})`).bind(...keys).all()).results;
  const settings = {}, changed = {};
  for (const k of keys) {
    const r = rows.find((x) => x.key === k);
    settings[k] = r ? { ...DEFAULTS[k], ...parse(r.value, {}) } : { ...DEFAULTS[k] };
    if (k === 'payments') delete settings[k].testMode;
    changed[k] = r && r.updated_at ? { at: r.updated_at, by: r.full_name || r.email || null } : null;
  }
  return { settings, changed };
}

/** True while the seller's legal name or address still holds the "[Your …]" text from the first install. */
export const sellerIncomplete = (seller) => !seller.name || !seller.legalName || !seller.email || PLACEHOLDER.test(`${seller.legalName || ''} ${seller.address || ''}`);

/** Test or live follows the installed Razorpay key; null when there is none. */
export function paymentsMode(env) {
  const id = String(env.RAZORPAY_KEY_ID || '');
  if (!id) return null;
  return id.startsWith('rzp_live_') ? 'live' : 'test';
}

/** Whether new accounts may be created (Settings → Sign-ups). Open unless a Super Admin or Admin closed it. */
export async function signupsOpen(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM platform_settings WHERE key = 'signups'").first();
    return !row || parse(row.value, {}).open !== false;
  } catch { return true; } // a database hiccup must not look like "closed"
}

/**
 * Checks the fields given for one section; fields left out are not touched.
 * → { values, errors } with errors { field: plain words } (empty when all is well).
 */
export function checkSection(section, input) {
  const allowed = SECTIONS[section];
  const values = {}, errors = {};
  if (!allowed) return { values, errors: { section: 'This setting does not exist.' } };
  for (const [k, raw] of Object.entries(input || {})) {
    if (!allowed.includes(k)) { errors[k] = 'This setting does not exist.'; continue; }
    if (k === 'enabled' || k === 'open') {
      if (typeof raw !== 'boolean') errors[k] = 'Choose on or off.'; else values[k] = raw;
      continue;
    }
    if (k === 'replyDays') {
      const n = typeof raw === 'string' && /^\d{1,2}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
      if (!Number.isInteger(n) || n < 0 || n > 30) errors[k] = 'Enter a number of working days from 0 to 30.'; else values[k] = n;
      continue;
    }
    if (k === 'gstin') {
      const g = typeof raw === 'string' ? raw.replace(/\s+/g, '').toUpperCase() : raw;
      if (g === null || g === '' || g === undefined) values[k] = null;
      else if (typeof g !== 'string' || !/^[0-9A-Z]{15}$/.test(g)) errors[k] = 'A GSTIN has 15 letters and digits. Leave it empty if you are not registered for GST.';
      else values[k] = g;
      continue;
    }
    if (raw !== null && raw !== undefined && typeof raw !== 'string') { errors[k] = 'Enter text.'; continue; }
    const v = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').trim();
    if (CONTROL.test(v) || (k !== 'address' && v.includes('\n'))) { errors[k] = 'Use plain text on one line.'; continue; }
    if (v.length > MAX[k]) { errors[k] = `At most ${MAX[k]} characters.`; continue; }
    if (!v && (REQUIRED[section] || []).includes(k)) { errors[k] = 'This is needed.'; continue; }
    if (k === 'email' && v && !EMAIL.test(v)) { errors[k] = 'Enter an email address, like hello@example.com.'; continue; }
    values[k] = v;
  }
  return { values, errors };
}

/**
 * Saves checked values: { section: values }. Only fields that really change are written and logged.
 * → { changed: [section …], diff: { section: { field: { from, to } } } }
 */
export async function saveSettings(env, changes, { actorId = null, ip = null } = {}) {
  const { settings: before } = await readSettings(env);
  const diff = {}, writes = [], now = nowIso();
  for (const [k, v] of Object.entries(changes)) {
    const d = {};
    for (const [f, to] of Object.entries(v)) {
      const from = before[k][f] === undefined ? null : before[k][f];
      if (JSON.stringify(from) !== JSON.stringify(to)) d[f] = { from, to };
    }
    if (!Object.keys(d).length) continue;
    diff[k] = d;
    const after = { ...before[k], ...v };
    if (k === 'payments') delete after.testMode;
    writes.push(env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(k, JSON.stringify(after), actorId, now));
  }
  if (!writes.length) return { changed: [], diff };
  await env.DB.batch(writes);
  await audit(env, { actorId, action: 'settings.update', target: `settings:${Object.keys(diff).join(',')}`, detail: diff, ip });
  return { changed: Object.keys(diff), diff };
}
