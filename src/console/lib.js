// Helpers shared by the console's module APIs (docs/ADMIN-PHASE-2.md §3): paging, safe
// search patterns, India-time days, reasons, and CSV downloads.
import { HttpError, fieldError } from '../http.js';

export const PAGE_SIZE = 25;
export const EXPORT_MAX = 5000;
export const DAY_MS = 86400000;
/** The business runs on India time (UTC+5:30, no daylight saving). */
export const IST_MIN = 330;
const IST_MS = IST_MIN * 60000;

export const parseJson = (text, def) => { try { const v = JSON.parse(text); return v == null ? def : v; } catch { return def; } };

/* ---------- paging and search ---------- */
export const pageOf = (q) => Math.max(1, Math.min(10000, parseInt(q.get('page') || '1', 10) || 1));
export const offsetOf = (page) => (page - 1) * PAGE_SIZE;
export const paged = (items, page, total) => ({ items, page, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total });
/** A LIKE pattern that finds `text` anywhere; % and _ in the text are matched literally. Use with ESCAPE '\'. */
export const like = (text) => `%${String(text).replace(/[\\%_]/g, (c) => '\\' + c)}%`;
/** One of the allowed values, or the fallback. */
export const oneOf = (value, allowed, fallback = '') => (allowed.includes(value) ? value : fallback);
/** A row id from the address: anything else is "not found", never an error from the database. */
export function idParam(value, message = 'Not found.') {
  if (typeof value !== 'string' || !/^[\w-]{1,64}$/.test(value)) throw new HttpError(404, 'not_found', message);
  return value;
}

/**
 * Numbers the values of one SQL statement: b.p(value) → '?3'. A list and its COUNT are built
 * with a binder each, so every statement is bound with exactly the values it uses.
 */
export class Binder {
  constructor() { this.args = []; this.named = new Map(); }
  p(value) { this.args.push(value); return '?' + this.args.length; }
  /** One number for a value that appears in several places (b.once('now', iso)). */
  once(name, value) {
    if (!this.named.has(name)) this.named.set(name, this.p(value));
    return this.named.get(name);
  }
}

/** ₹1,499 or ₹99.50 from an amount in paise. */
export const money = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/* ---------- India-time days ---------- */
export const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z'));
/** 'YYYY-MM-DD' in India for a moment (default: now). */
export const istDay = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);
/** The moment an India day starts, as the ISO text stored in the database. */
export const istDayStart = (day) => new Date(Date.parse(day + 'T00:00:00Z') - IST_MS).toISOString();
/** The moment the next India day starts (use with <). */
export const istDayEnd = (day) => new Date(Date.parse(day + 'T00:00:00Z') - IST_MS + DAY_MS).toISOString();
/** 'YYYY-MM-DD HH:MM' in India time, for spreadsheets. */
export const istStamp = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + IST_MS).toISOString().slice(0, 16).replace('T', ' ') : '';
};

/* ---------- input ---------- */
/** The reason an administrator gives for a change: 3 to 300 characters. */
export function reasonOf(body, { required = true } = {}) {
  const text = body && typeof body.reason === 'string' ? body.reason.trim().replace(/\s+/g, ' ') : '';
  if (!text) { if (required) throw fieldError({ reason: 'Give a reason. It is kept in the activity log.' }); return null; }
  if (text.length < 3) throw fieldError({ reason: 'Make the reason a little longer.' });
  if (text.length > 300) throw fieldError({ reason: 'Keep the reason under 300 characters.' });
  return text;
}

/* ---------- CSV ---------- */
// Every cell is quoted. A cell that a spreadsheet would run as a formula (= + - @, tab, return) gets a leading apostrophe.
const cell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
};
/** A spreadsheet download. `rows` are arrays in the order of `header`. */
export function csvResponse(name, header, rows) {
  const text = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  return new Response(text, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${String(name).replace(/[^\w.-]/g, '')}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
