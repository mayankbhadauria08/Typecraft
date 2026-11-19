// Invoices: one per paid order, numbered TC-YYYY-000001 from one sequence
// (platform_settings 'invoice_seq', taken atomically). The seller details are
// copied from platform_settings 'seller' at issue time, so later edits never change
// an issued invoice. No GST is charged for now; the gstin fields are kept.
import { nowIso } from './http.js';
import { uuid } from './crypto.js';

const parse = (text, def) => { try { const v = JSON.parse(text); return v == null ? def : v; } catch { return def; } };

export function formatNumber(seq, issuedAt) {
  return `TC-${issuedAt.slice(0, 4)}-${String(seq).padStart(6, '0')}`;
}

/** Takes the next number from the sequence in one statement (no two callers get the same). */
export async function nextSeq(env) {
  const now = nowIso();
  const row = await env.DB.prepare(
    `UPDATE platform_settings SET value = json_set(value, '$.next', COALESCE(json_extract(value, '$.next'), 1) + 1), updated_at = ?1
      WHERE key = 'invoice_seq' RETURNING json_extract(value, '$.next') - 1 AS seq`
  ).bind(now).first();
  if (row && Number.isInteger(row.seq)) return row.seq;
  // the settings row is missing: start it (after any invoice already issued)
  const max = await env.DB.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM invoices').first();
  await env.DB.prepare("INSERT OR IGNORE INTO platform_settings (key, value, updated_at) VALUES ('invoice_seq', ?1, ?2)")
    .bind(JSON.stringify({ next: max.m + 1 }), now).run();
  return nextSeq(env);
}

/**
 * The invoice of a paid order, created if it does not exist yet. Safe to call
 * more than once (invoices.order_id is unique). Returns the invoice row.
 */
export async function ensureInvoice(env, orderId) {
  const DB = env.DB;
  const existing = await DB.prepare('SELECT * FROM invoices WHERE order_id = ?1').bind(orderId).first();
  if (existing) return existing;
  const o = await DB.prepare(
    `SELECT o.id, o.user_id, o.amount_paise, o.currency, o.paid_at, o.status, p.name AS package_name, p.validity_days,
            u.full_name, u.email
       FROM orders o JOIN packages p ON p.id = o.package_id JOIN users u ON u.id = o.user_id WHERE o.id = ?1`
  ).bind(orderId).first();
  if (!o) return null;
  const sellerRow = await DB.prepare("SELECT value FROM platform_settings WHERE key = 'seller'").first();
  const seller = parse(sellerRow && sellerRow.value, {});
  if (!('gstin' in seller)) seller.gstin = null;
  const issuedAt = nowIso();
  const seq = await nextSeq(env);
  const number = formatNumber(seq, issuedAt);
  const period = o.validity_days ? `${o.validity_days} days` : 'lifetime access';
  let lines = [{ description: `TypeCraft ${o.package_name} plan (${period})`, quantity: 1, amountPaise: o.amount_paise }];
  // a coupon or a sale (migration 0016): the plan at its own price, then the discount, adding up to what was paid
  let d = null;
  try { d = await DB.prepare('SELECT list_price_paise, discount_paise, label FROM order_discounts WHERE order_id = ?1').bind(orderId).first(); } catch { d = null; }
  if (d && d.list_price_paise - d.discount_paise === o.amount_paise) {
    lines = [{ description: `TypeCraft ${o.package_name} plan (${period})`, quantity: 1, amountPaise: d.list_price_paise },
      { description: `Discount: ${d.label}`, quantity: 1, amountPaise: -d.discount_paise }];
  }
  await DB.prepare(
    `INSERT INTO invoices (id, number, seq, order_id, user_id, amount_paise, currency, billed_name, billed_email, seller, lines, issued_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) ON CONFLICT (order_id) DO NOTHING`
  ).bind(uuid(), number, seq, o.id, o.user_id, o.amount_paise, o.currency, o.full_name, o.email, JSON.stringify(seller), JSON.stringify(lines), issuedAt).run();
  return DB.prepare('SELECT * FROM invoices WHERE order_id = ?1').bind(orderId).first();
}

/** The JSON shape the invoice page and the account pages read. */
export function invoiceView(row, extra = {}) {
  const seller = parse(row.seller, {});
  return {
    number: row.number,
    orderId: row.order_id,
    issuedAt: row.issued_at,
    amountPaise: row.amount_paise,
    currency: row.currency,
    billedTo: { name: row.billed_name, email: row.billed_email, gstin: null },
    seller: { name: seller.name || 'TypeCraft', legalName: seller.legalName || '', address: seller.address || '', email: seller.email || '', phone: seller.phone || '', gstin: seller.gstin || null },
    lines: parse(row.lines, []),
    subtotalPaise: row.amount_paise,
    tax: { gstin: seller.gstin || null, ratePercent: 0, amountPaise: 0, note: seller.gstin ? '' : 'GST not applicable.' },
    totalPaise: row.amount_paise,
    ...extra,
  };
}
