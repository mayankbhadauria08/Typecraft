// Invoices for money an institute paid (docs/INSTITUTES.md §14). Migration 0010.
//
//   POST /api/console/institutes/:id/payments/:pid/invoice   institutes.payments   make the invoice of a recorded payment (once)
//   GET  /api/console/institutes/:id/invoices/:number        institutes.payments   one invoice (or revenue.view)
//   GET  /api/institutes/:id/invoices                        institute admin       its invoices
//   GET  /api/institutes/:id/invoices/:number                institute admin       one invoice
//   page /institute/:id/invoices/:number                     printable; the page asks whichever of the two APIs lets you in
//
// Numbered from the same sequence as every other TypeCraft invoice (src/invoices.js nextSeq), so the numbers
// stay one series. The institute's and the seller's details are copied when the invoice is made: later edits
// never change it. Like every TypeCraft invoice for now, no GST is charged unless the seller has a GSTIN in
// Settings; then the rate and how to split it are for your CA to set (the invoice says GST is not added).
import { HttpError, json, nowIso, clientIp } from './http.js';
import { audit } from './billing.js';
import { nextSeq, formatNumber } from './invoices.js';
import { requireAdmin } from './console/session.js';
import { permissionsFor } from './console/permissions.js';
import { isId, requireStaff } from './institute-access.js';
import { uuid } from './crypto.js';

const parse = (t, d) => { try { const v = JSON.parse(t); return v == null ? d : v; } catch { return d; } };
const IST_MS = 330 * 60000;
const lastDay = (endsAt) => new Date(Date.parse(endsAt) - 1 + IST_MS).toISOString().slice(0, 10);
const firstDay = (startsAt) => new Date(Date.parse(startsAt) + IST_MS).toISOString().slice(0, 10);
const METHOD = { bank_transfer: 'Bank transfer', upi: 'UPI', cheque: 'Cheque', cash: 'Cash', other: 'Other' };
const NUMBER_RE = /^TC-\d{4}-\d{6}$/;
const NOT_READY = "Institute invoices aren't switched on yet.";
const later = async (fn) => {
  try { return await fn(); } catch (err) {
    if (/no such table/i.test(String(err && err.message))) throw new HttpError(503, 'invoices_not_ready', NOT_READY);
    throw err;
  }
};

export function invoiceView(row, payment = null) {
  const seller = parse(row.seller, {});
  const billed = parse(row.billed_to, {});
  return {
    number: row.number, issuedAt: row.issued_at, amountPaise: row.amount_paise, currency: 'INR',
    billedTo: { name: billed.name || '', contactName: billed.contactName || '', email: billed.email || '', phone: billed.phone || '', city: billed.city || '', gstin: billed.gstin || null },
    seller: { name: seller.name || 'TypeCraft', legalName: seller.legalName || '', address: seller.address || '', email: seller.email || '', phone: seller.phone || '', gstin: seller.gstin || null },
    lines: parse(row.lines, []),
    subtotalPaise: row.amount_paise,
    tax: { gstin: seller.gstin || null, ratePercent: 0, amountPaise: 0, note: seller.gstin ? 'GST is not added to this invoice.' : 'GST not applicable.' },
    totalPaise: row.amount_paise,
    // the payment as recorded; if it was removed later, as the invoice's line kept it
    payment: payment ? { method: METHOD[payment.method] || payment.method, reference: payment.reference || '', paidOn: payment.paid_on } : (parse(row.lines, [])[0] || {}).payment || null,
  };
}

/* ---------------- making one (console) ---------------- */
export async function postInvoice(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'institutes.payments');
  if (!isId(params.id, 'ins') || !isId(params.pid, 'ipay')) throw new HttpError(404, 'not_found', 'There is no payment with this ID.');
  return later(async () => {
    const DB = env.DB;
    const p = await DB.prepare(`SELECT x.*, i.name, i.contact_name, i.contact_email, i.contact_phone, i.city, i.gstin, i.seats, i.price_paise, i.starts_at, i.ends_at, k.name AS package_name
                                  FROM institute_payments x JOIN institutes i ON i.id = x.institute_id JOIN packages k ON k.id = i.package_id
                                 WHERE x.id = ?1 AND x.institute_id = ?2`).bind(params.pid, params.id).first();
    if (!p) throw new HttpError(404, 'not_found', 'There is no payment with this ID.');
    const have = await DB.prepare('SELECT * FROM institute_invoices WHERE payment_id = ?1').bind(p.id).first();
    if (have) return json({ invoice: invoiceView(have, p), made: false });
    const sellerRow = await DB.prepare("SELECT value FROM platform_settings WHERE key = 'seller'").first();
    const seller = parse(sellerRow && sellerRow.value, {});
    const issuedAt = nowIso(), seq = await nextSeq(env), number = formatNumber(seq, issuedAt);
    const billed = { name: p.name, contactName: p.contact_name, email: p.contact_email, phone: p.contact_phone, city: p.city, gstin: p.gstin || null };
    const part = p.price_paise > 0 && p.amount_paise < p.seats * p.price_paise ? ' (part payment)' : '';
    const lines = [{ description: `TypeCraft ${p.package_name} plan for ${p.seats} students (seats), ${firstDay(p.starts_at)} to ${lastDay(p.ends_at)}${part}`, quantity: 1, amountPaise: p.amount_paise,
      payment: { method: METHOD[p.method] || p.method, reference: p.reference || '', paidOn: p.paid_on } }];
    await DB.prepare(`INSERT INTO institute_invoices (id, number, seq, institute_id, payment_id, amount_paise, billed_to, seller, lines, issued_at)
                      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT (payment_id) DO NOTHING`)
      .bind(uuid(), number, seq, p.institute_id, p.id, p.amount_paise, JSON.stringify(billed), JSON.stringify(seller), JSON.stringify(lines), issuedAt).run();
    const row = await DB.prepare('SELECT * FROM institute_invoices WHERE payment_id = ?1').bind(p.id).first();
    await audit(env, { actorId: who.user.id, action: 'institute.invoice', target: `institute:${p.institute_id}`, detail: { number: row.number, amountPaise: row.amount_paise, paymentId: p.id }, ip: clientIp(request) });
    return json({ invoice: invoiceView(row, p), made: true }, 201);
  });
}

async function oneInvoice(env, instituteId, number) {
  if (!NUMBER_RE.test(String(number || ''))) throw new HttpError(404, 'not_found', 'There is no invoice with this number.');
  const row = await env.DB.prepare('SELECT * FROM institute_invoices WHERE institute_id = ?1 AND number = ?2').bind(instituteId, number).first();
  if (!row) throw new HttpError(404, 'not_found', 'There is no invoice with this number.');
  const p = row.payment_id ? await env.DB.prepare('SELECT * FROM institute_payments WHERE id = ?1').bind(row.payment_id).first() : null;
  return invoiceView(row, p);
}
export async function getConsoleInvoice(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'institutes.view');
  const perms = await permissionsFor(env, who.role);
  if (!perms.includes('institutes.payments') && !perms.includes('revenue.view')) throw new HttpError(403, 'forbidden', 'Your role does not allow this action.');
  if (!isId(params.id, 'ins')) throw new HttpError(404, 'not_found', 'There is no invoice with this number.');
  return later(async () => json({ invoice: await oneInvoice(env, params.id, params.number) }));
}

/* ---------------- the institute's own copies ---------------- */
export async function getInvoices(request, env, ctx, params) {
  const { institute } = await requireStaff(env, request, params.id, { admin: true });
  return later(async () => {
    const rows = (await env.DB.prepare('SELECT number, amount_paise, issued_at FROM institute_invoices WHERE institute_id = ?1 ORDER BY seq DESC').bind(institute.id).all()).results;
    return json({ invoices: rows.map((r) => ({ number: r.number, amountPaise: r.amount_paise, issuedAt: r.issued_at })) });
  });
}
export async function getInvoice(request, env, ctx, params) {
  const { institute } = await requireStaff(env, request, params.id, { admin: true });
  return later(async () => json({ invoice: await oneInvoice(env, institute.id, params.number) }));
}

const ID = '([a-z]{3,4}_[0-9a-f]{20})', NUM = '(TC-\\d{4}-\\d{6})';
export const ROUTES = {};
export const PATTERNS = [
  ['POST', new RegExp(`^/api/console/institutes/${ID}/payments/${ID}/invoice$`), ['id', 'pid'], postInvoice],
  ['GET', new RegExp(`^/api/console/institutes/${ID}/invoices/${NUM}$`), ['id', 'number'], getConsoleInvoice],
  ['GET', new RegExp(`^/api/institutes/${ID}/invoices$`), ['id'], getInvoices],
  ['GET', new RegExp(`^/api/institutes/${ID}/invoices/${NUM}$`), ['id', 'number'], getInvoice],
];
