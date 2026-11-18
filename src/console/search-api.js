// The search box (docs/ADMIN-PHASE-2.md §12). Console-only.
//
//   GET /api/console/search?q=   any console session; each part only with its permission
//     customers (customers.view): name, email or phone containing the text, or the customer ID; up to 5
//     payments  (payments.view):  an order, Razorpay order or payment ID, or an invoice number, starting with the text; up to 5
//   Pages are matched in the browser, from the sidebar the role sees.
//
// 60 searches a minute per person. What was searched for is never logged or stored.
import { HttpError, json, nowIso } from '../http.js';
import { hitLimit } from '../session.js';
import { requireAdmin } from './session.js';
import { permissionsFor } from './permissions.js';
import { like, Binder } from './lib.js';

const LIMIT = 5;
// phone numbers are stored as typed ("+91 98765 43210"): compare digits with digits
const PHONE_DIGITS = "replace(replace(replace(replace(replace(replace(u.phone_number, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '')";
/** Text that starts with `t`, as a range the indexes can use: [t, t + the highest character). */
const startsWith = (t) => [t, t + '\uffff'];

export async function getSearch(request, env) {
  const who = await requireAdmin(env, request);
  const q = (new URL(request.url).searchParams.get('q') || '').trim().replace(/\s+/g, ' ');
  if (q.length < 2 || q.length > 80) return json({ customers: null, payments: null, tooShort: q.length < 2 });
  if (!(await hitLimit(env, `search:${who.user.id}`, 60, 60))) throw new HttpError(429, 'rate_limited', 'That is a lot of searches in a minute. Wait a moment and try again.');
  const perms = await permissionsFor(env, who.role);
  const DB = env.DB, now = nowIso(), stmts = {};

  if (perms.includes('customers.view')) {
    const B = new Binder();   // every value bound is used: the statement asks only what applies
    const digits = q.replace(/\D/g, '');
    const parts = [`u.email LIKE ${B.p(like(q.toLowerCase()))} ESCAPE '\\'`, `u.full_name LIKE ${B.p(like(q))} ESCAPE '\\'`];
    if (digits.length >= 4 && /^[\d\s().+-]+$/.test(q)) parts.push(`${PHONE_DIGITS} LIKE ${B.p(like(digits))} ESCAPE '\\'`);
    const id = B.p(q);
    stmts.customers = DB.prepare(
      `SELECT u.id, u.full_name, u.email, u.account_status,
              (SELECT p.name FROM user_subscriptions s JOIN packages p ON p.id = s.package_id
                WHERE s.user_id = u.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ${B.p(now)})
                ORDER BY p.display_order DESC LIMIT 1) AS plan
         FROM users u
        WHERE ${parts.join(' OR ')} OR u.id = ${id}
        ORDER BY (u.id = ${id}) DESC, (lower(u.email) = lower(${id})) DESC, (u.email LIKE ${B.p(like(q.toLowerCase()).slice(1))} ESCAPE '\\') DESC,
                 u.last_login_at IS NULL, u.last_login_at DESC
        LIMIT ${LIMIT}`
    ).bind(...B.args);
  }
  if (perms.includes('payments.view') && /^[\w-]{4,64}$/.test(q)) {
    const [a, b] = startsWith(q), [A, B] = startsWith(q.toUpperCase());
    stmts.payments = DB.prepare(
      `SELECT o.id, o.amount_paise, o.currency, o.status, o.created_at, p.name AS package_name, u.full_name, u.email, i.number AS invoice_number
         FROM orders o JOIN users u ON u.id = o.user_id JOIN packages p ON p.id = o.package_id LEFT JOIN invoices i ON i.order_id = o.id
        WHERE (o.id >= ?1 AND o.id < ?2) OR (o.razorpay_order_id >= ?1 AND o.razorpay_order_id < ?2) OR (i.number >= ?3 AND i.number < ?4)
           OR o.id IN (SELECT y.order_id FROM payments y WHERE y.razorpay_payment_id >= ?1 AND y.razorpay_payment_id < ?2)
        ORDER BY o.created_at DESC LIMIT ${LIMIT}`
    ).bind(a, b, A, B);
  }
  const names = Object.keys(stmts);
  const answers = names.length ? await DB.batch(names.map((k) => stmts[k])) : [];
  const R = Object.fromEntries(names.map((k, i) => [k, answers[i].results]));
  return json({
    customers: R.customers ? R.customers.map((u) => ({ id: u.id, fullName: u.full_name, email: u.email, plan: u.plan || null, disabled: u.account_status !== 'active' })) : null,
    payments: R.payments ? R.payments.map((o) => ({ id: o.id, amountPaise: o.amount_paise, currency: o.currency, status: o.status, packageName: o.package_name,
      customer: o.full_name || o.email, invoiceNumber: o.invoice_number || null, createdAt: o.created_at })) : null,
  });
}

export const ROUTES = { 'GET /api/console/search': getSearch };
export const PATTERNS = [];
