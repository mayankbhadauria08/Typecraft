// Buying seats online with Razorpay (docs/INSTITUTES.md §15). Migration 0011.
//
//   GET  /api/institutes/buy                      signed in        the online prices, and whether buying is open
//   GET  /api/institutes/:id/buy                  institute admin  prices for this institute: more seats now, or a renewal
//   POST /api/institutes/checkout                 signed in, email confirmed
//        { kind: 'new', seats, months, name, city, contactName, contactEmail, contactPhone, gstin, agree: true }
//        { kind: 'seats', instituteId, seats }            more seats until the current last day, at a part-term price
//        { kind: 'renew', instituteId, seats, months }    the next term, after the current last day
//        → { orderId, razorpayOrderId, amountPaise, currency, keyId, description, prefill }
//   POST /api/institutes/checkout/verify          the payer        { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }
//   POST /api/institutes/checkout/failed          the payer        { orderId, code, description } (shown back; changes nothing that was paid)
//   GET  /api/institutes/checkout/orders/:id      the payer        where the order stands
//   GET  /api/console/institutes/pricing          institutes.view
//   PUT  /api/console/institutes/pricing          institutes.payments   { on, packageId, minSeats, prices: { 6, 12 } } (paise per seat)
//   Razorpay webhooks for these orders come through POST /api/webhooks/razorpay (billing.js hands them to instituteWebhook).
//   Cron every 10 minutes: orders still waiting are checked with Razorpay; paid orders get their invoice and email.
//
// Money rules, as for plans (billing.js): seats change only when Razorpay itself confirms the payment, by the
// payment fetched from Razorpay after a valid checkout signature, or by a signed webhook, never on the
// browser's word. Amounts are worked out on the server. The seats switch on once: the one call that moves the
// order to 'paid' writes its claim_id, and every change in the same transaction requires that claim_id.
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from './http.js';
import { requireSession, hitLimit, tooMany } from './session.js';
import { audit, getSetting, paymentsAvailable } from './billing.js';
import * as rzp from './razorpay.js';
import { uuid } from './crypto.js';
import { newId, isId, ready, requireStaff } from './institute-access.js';
import { makeInvoice } from './institute-invoices.js';
import { sendTemplate } from './mail.js';
import { requireAdmin } from './console/session.js';
import { checkDetails } from './console/institutes-api.js';

const DAY_MS = 86400000;
const MIN_MS = 60000;
const IST_MS = 330 * MIN_MS;
export const TERMS = [6, 12];
export const MAX_SEATS = 10000;
/** Razorpay's usual limit for one payment; above it, pay by bank transfer. */
export const ONLINE_MAX_PAISE = 5_00_000 * 100;
/** Renewing opens this many days before the last day (and stays open after it). */
export const RENEW_WINDOW_DAYS = 60;
const RZP_ID_RE = /^[A-Za-z0-9_]{6,64}$/;
const KINDS = ['new', 'seats', 'renew'];
const NO_ORDER = 'There is no order with this ID.';

const istDay = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const istDayStart = (day) => new Date(Date.parse(day + 'T00:00:00Z') - IST_MS).toISOString();
const lastDayOf = (endsAt) => istDay(Date.parse(endsAt) - 1);
const nextDay = (day) => new Date(Date.parse(day + 'T00:00:00Z') + DAY_MS).toISOString().slice(0, 10);
/** The same date `months` later (the 31st becomes the month's last day). */
export function addMonths(day, months) {
  const [y, m, d] = day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
const money = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const siteUrl = (env) => String(env.SITE_URL || 'https://typecrafttyping.in').replace(/\/+$/, '');
const parse = (t, d) => { try { const v = JSON.parse(t); return v == null ? d : v; } catch { return d; } };
const noTable = (err) => /no such table/i.test(String(err && err.message));
const notReady = async (fn) => {
  try { return await fn(); } catch (err) {
    if (noTable(err)) throw new HttpError(503, 'buying_not_ready', "Buying seats online isn't switched on yet.");
    throw err;
  }
};

/* ---------------- prices ---------------- */
/**
 * The online prices, from platform_settings 'institute_pricing'. Buying is open only when it is switched on,
 * a paid plan and at least one term price are set, and payments are available.
 */
export async function pricing(env) {
  const s = await getSetting(env, 'institute_pricing', {});
  const prices = (s && typeof s.prices === 'object' && s.prices) || {};
  const terms = TERMS.map((months) => ({ months, pricePerSeatPaise: Number(prices[months]) }))
    .filter((t) => Number.isInteger(t.pricePerSeatPaise) && t.pricePerSeatPaise >= 100);
  const pkg = typeof s.packageId === 'string' && s.packageId !== 'free'
    ? await env.DB.prepare("SELECT id, name FROM packages WHERE id = ?1 AND id <> 'free'").bind(s.packageId).first() : null;
  const minSeats = Number.isInteger(s.minSeats) && s.minSeats >= 1 && s.minSeats <= 1000 ? s.minSeats : 10;
  const set = !!pkg && terms.length > 0;
  return {
    on: s.on === true && set, set, packageId: pkg ? pkg.id : null, packageName: pkg ? pkg.name : null, minSeats, terms,
    // seats added mid-term are priced by the day, at the longest term's rate
    rateTerm: terms.length ? terms[terms.length - 1] : null,
    updatedAt: s.updatedAt || null,
  };
}
async function openPricing(env) {
  const p = await pricing(env);
  return { ...p, open: p.on && (await paymentsAvailable(env)) };
}
/**
 * Price of one added seat from today to the last day: the longest term's price for those days (a month being
 * 365/12 days), rounded up to the rupee. Whole numbers only, so the same days always give the same price.
 */
export function topUpPerSeat(p, endsAt, now = Date.now()) {
  const days = Math.ceil((Date.parse(endsAt) - Date.parse(istDayStart(istDay(now)))) / DAY_MS);
  if (!p.rateTerm || days < 1) return { days: Math.max(0, days), pricePerSeatPaise: null };
  const num = p.rateTerm.pricePerSeatPaise * days * 12, den = p.rateTerm.months * 365;
  const paise = Math.floor((num + den - 1) / den);
  return { days, pricePerSeatPaise: Math.max(100, Math.floor((paise + 99) / 100) * 100) };
}

/* ---------------- what an institute can buy ---------------- */
/** Prices for one institute (its admin asks). → { open, why?, seats: {…}, renew: {…} } */
function quotesFor(p, i, used, now = Date.now()) {
  const nowIsoText = new Date(now).toISOString();
  const why = !p.open ? 'closed'
    : i.status !== 'active' ? 'status'
      : i.package_id !== p.packageId ? 'plan' : null;
  const out = { open: !why, why, packageName: p.packageName, seats: i.seats, seatsUsed: used, lastDay: lastDayOf(i.ends_at), maxPaise: ONLINE_MAX_PAISE };
  if (why) return out;
  const t = topUpPerSeat(p, i.ends_at, now);
  out.addSeats = i.ends_at > nowIsoText && t.pricePerSeatPaise
    ? { available: true, days: t.days, pricePerSeatPaise: t.pricePerSeatPaise, from: istDay(now), to: lastDayOf(i.ends_at) }
    : { available: false, why: 'ended' };
  const daysLeft = Math.ceil((Date.parse(i.ends_at) - now) / DAY_MS);
  const startDay = i.ends_at > nowIsoText ? nextDay(lastDayOf(i.ends_at)) : istDay(now);
  out.renew = daysLeft > RENEW_WINDOW_DAYS
    ? { available: false, why: 'early', opensOn: istDay(Date.parse(i.ends_at) - RENEW_WINDOW_DAYS * DAY_MS) }
    : { available: true, from: startDay, minSeats: Math.max(p.minSeats, used),
      terms: p.terms.map((x) => ({ ...x, to: lastDayOf(istDayStart(addMonths(startDay, x.months))) })) };
  return out;
}

/* ---------------- GET /api/institutes/buy ---------------- */
export async function getBuy(request, env) {
  const { user } = await requireSession(env, request);
  const p = await openPricing(env);
  return json({
    open: p.open, packageId: p.open ? p.packageId : null, packageName: p.open ? p.packageName : null, minSeats: p.minSeats,
    terms: p.open ? p.terms : [], maxSeats: MAX_SEATS, maxPaise: ONLINE_MAX_PAISE, emailVerified: !!user.emailVerified,
    you: { name: user.fullName, email: user.email, phone: user.phoneNumber || '' },
  });
}

/* ---------------- GET /api/institutes/:id/buy ---------------- */
export async function getInstituteBuy(request, env, ctx, params) {
  const { institute } = await requireStaff(env, request, params.id, { admin: true });
  const p = await openPricing(env);
  const used = (await env.DB.prepare("SELECT COUNT(*) AS n FROM institute_students WHERE institute_id = ?1 AND status = 'active'").bind(institute.id).first()).n;
  return json(quotesFor(p, institute, used));
}

/* ---------------- POST /api/institutes/checkout ---------------- */
function wholeSeats(v, min, fields, key = 'seats') {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SEATS) { fields[key] = `Enter a whole number of seats from ${min} to ${MAX_SEATS.toLocaleString('en-IN')}.`; return null; }
  if (n < min) { fields[key] = `Buy at least ${min} seats.`; return null; }
  return n;
}
function termOf(p, v, fields) {
  const t = p.terms.find((x) => x.months === Number(v));
  if (!t) fields.months = `Choose ${p.terms.map((x) => `${x.months} months`).join(' or ')}.`;
  return t || null;
}

export async function postCheckout(request, env) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request);
  return notReady(async () => {
    const kind = KINDS.includes(body.kind) ? body.kind : null;
    if (!kind) throw fieldError({ kind: 'Choose what to buy.' });
    const p = await openPricing(env);
    if (!p.open) throw new HttpError(503, 'buying_closed', "Buying seats online isn't open right now. Write to us and we'll set your institute up by bank transfer.");
    if (!user.emailVerified) throw new HttpError(403, 'verify_email', 'Confirm your email address first: open the link we emailed you when you signed up, or send it again from Settings.');
    if (!(await hitLimit(env, `icheckout:${user.id}`, 20, 3600))) throw tooMany(60);
    const DB = env.DB, fields = {};
    let order;
    if (kind === 'new') {
      const d = checkDetails(body, false);
      delete d.v.notes;
      Object.assign(fields, d.fields);
      delete fields.notes;
      const seats = wholeSeats(body.seats, p.minSeats, fields);
      const t = termOf(p, body.months, fields);
      if (body.agree !== true) fields.agree = 'Read and accept the terms for institutes.';
      if (Object.keys(fields).length) throw fieldError(fields);
      const today = istDay();
      order = { kind, instituteId: null, seats, months: t.months, amountPaise: seats * t.pricePerSeatPaise,
        details: { ...d.v, pricePerSeatPaise: t.pricePerSeatPaise, from: today, to: lastDayOf(istDayStart(addMonths(today, t.months))), agreedAt: nowIso() },
        description: `${t.months} months of TypeCraft for ${seats} students` };
    } else {
      // more seats or a renewal: only the institute's admin, for an institute on the plan sold online
      const { institute: i } = await requireStaff(env, request, body.instituteId, { admin: true });
      const used = (await DB.prepare("SELECT COUNT(*) AS n FROM institute_students WHERE institute_id = ?1 AND status = 'active'").bind(i.id).first()).n;
      const q = quotesFor(p, i, used);
      if (!q.open) {
        throw new HttpError(409, 'not_for_sale', q.why === 'plan' ? "Your institute's plan isn't sold online. Write to us to change your seats."
          : 'Your institute is not active, so seats can’t be bought online. Write to us.');
      }
      if (kind === 'seats') {
        if (!q.addSeats.available) throw new HttpError(409, 'ended', 'Your term has ended. Renew it instead.');
        const seats = wholeSeats(body.seats, 1, fields);
        if (Object.keys(fields).length) throw fieldError(fields);
        order = { kind, instituteId: i.id, seats, months: 1, amountPaise: seats * q.addSeats.pricePerSeatPaise,
          details: { pricePerSeatPaise: q.addSeats.pricePerSeatPaise, from: q.addSeats.from, to: q.addSeats.to, days: q.addSeats.days },
          description: `${seats} more seats until ${q.addSeats.to}` };
      } else {
        if (!q.renew.available) throw new HttpError(409, 'too_early', `Renewing opens on ${q.renew.opensOn}, ${RENEW_WINDOW_DAYS} days before your last day.`);
        const seats = wholeSeats(body.seats, q.renew.minSeats, fields);
        const t = termOf(p, body.months, fields);
        if (Object.keys(fields).length) throw fieldError(fields);
        const to = q.renew.terms.find((x) => x.months === t.months).to;
        order = { kind, instituteId: i.id, seats, months: t.months, amountPaise: seats * t.pricePerSeatPaise,
          details: { pricePerSeatPaise: t.pricePerSeatPaise, from: q.renew.from, to, seatsBefore: i.seats },
          description: `Renewal: ${t.months} months for ${seats} students` };
      }
    }
    if (order.amountPaise > ONLINE_MAX_PAISE) {
      throw fieldError({ seats: `Online payments go up to ${money(ONLINE_MAX_PAISE)}. For more, write to us and pay by bank transfer.` });
    }
    const out = (o) => json({
      orderId: o.id, razorpayOrderId: o.razorpay_order_id, amountPaise: o.amount_paise, currency: o.currency, keyId: env.RAZORPAY_KEY_ID,
      kind: o.kind, seats: o.seats, months: o.kind === 'seats' ? null : o.months, description: order.description,
      prefill: { name: user.fullName, email: user.email, contact: user.phoneNumber || '' },
    });
    // the same order again within half an hour (a second click, or Pay after closing the window) reuses it
    const detailsJson = JSON.stringify(order.details);
    const reuse = await DB.prepare(
      `SELECT * FROM institute_orders WHERE user_id = ?1 AND kind = ?2 AND institute_id IS ?3 AND seats = ?4 AND months = ?5 AND amount_paise = ?6
          AND status = 'created' AND razorpay_order_id IS NOT NULL AND created_at > ?7 AND json_extract(details, '$.to') = ?8
        ORDER BY created_at DESC LIMIT 1`
    ).bind(user.id, kind, order.instituteId, order.seats, order.months, order.amountPaise, new Date(Date.now() - 30 * MIN_MS).toISOString(), order.details.to).first();
    if (reuse && (kind !== 'new' || JSON.stringify({ ...parse(reuse.details, {}), agreedAt: null }) === JSON.stringify({ ...order.details, agreedAt: null }))) return out(reuse);

    const id = newId('iord'), now = nowIso();
    await DB.prepare(`INSERT INTO institute_orders (id, user_id, institute_id, kind, details, package_id, seats, months, amount_paise, currency, status, created_at, updated_at)
                      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'INR', 'created', ?10, ?10)`)
      .bind(id, user.id, order.instituteId, kind, detailsJson, p.packageId, order.seats, order.months, order.amountPaise, now).run();
    const fail = () => DB.prepare("UPDATE institute_orders SET status = 'failed', failure_reason = 'Could not start the payment.', updated_at = ?2 WHERE id = ?1").bind(id, nowIso()).run();
    let r;
    try {
      r = await rzp.createOrder(env, { amount: order.amountPaise, currency: 'INR', receipt: id, notes: { instituteOrderId: id, userId: user.id, kind } });
    } catch (err) { await fail(); throw err; }
    if (!r || typeof r.id !== 'string' || r.amount !== order.amountPaise) {
      await fail();
      throw new HttpError(502, 'payment_provider_error', 'The payment provider gave an unexpected answer. Please try again.');
    }
    await DB.prepare('UPDATE institute_orders SET razorpay_order_id = ?2, updated_at = ?3 WHERE id = ?1').bind(id, r.id, nowIso()).run();
    await audit(env, { actorId: user.id, action: 'institute.order', target: order.instituteId ? `institute:${order.instituteId}` : `institute_order:${id}`,
      detail: { orderId: id, kind, seats: order.seats, months: order.months, amountPaise: order.amountPaise }, ip: clientIp(request) });
    return out({ id, razorpay_order_id: r.id, amount_paise: order.amountPaise, currency: 'INR', kind, seats: order.seats, months: order.months });
  });
}

/* ---------------- confirming a payment ---------------- */
/** Marks an order failed if it isn't paid. */
async function markFailed(env, o, reason) {
  await env.DB.prepare(`UPDATE institute_orders SET status = 'failed', failure_reason = ?2, updated_at = ?3 WHERE id = ?1 AND status IN ('created', 'pending')`)
    .bind(o.id, String(reason || 'The payment did not go through.').slice(0, 300), nowIso()).run();
}

/**
 * Acts on a payment entity that came from Razorpay (API fetch or signed webhook): it must belong to the order
 * with the same amount; an authorized payment is captured; a captured one switches the seats on.
 * → { status: 'paid' | 'pending' | 'failed' | 'mismatch', instituteId?, invoiceNumber? }
 */
export async function handlePayment(env, ctx, o, p, via) {
  if (!p || p.order_id !== o.razorpay_order_id || p.amount !== o.amount_paise || (p.currency || 'INR') !== o.currency) {
    await env.DB.prepare("UPDATE institute_orders SET failure_reason = 'The payment did not match this order.', updated_at = ?2 WHERE id = ?1 AND status <> 'paid'")
      .bind(o.id, nowIso()).run();
    console.error('payment does not match its institute order:', o.id);
    return { status: 'mismatch' };
  }
  let status = p.status;
  if (status === 'authorized') {
    try {
      const c = await rzp.capturePayment(env, p.id, o.amount_paise, o.currency);
      status = c && c.id === p.id ? c.status : 'authorized';
    } catch {
      // captured meanwhile (auto-capture, or a parallel call)? ask again
      try { const again = await rzp.fetchPayment(env, p.id); status = again && again.order_id === o.razorpay_order_id ? again.status : 'authorized'; } catch { status = 'authorized'; }
    }
  }
  if (status === 'captured' || status === 'refunded') {
    const r = await fulfil(env, ctx, o.id, p.id, via);
    return { status: 'paid', ...r };
  }
  if (status === 'failed') {
    await markFailed(env, o, p.error_description);
    return { status: 'failed' };
  }
  await env.DB.prepare("UPDATE institute_orders SET status = 'pending', updated_at = ?2 WHERE id = ?1 AND status = 'created'").bind(o.id, nowIso()).run();
  return { status: 'pending' };
}

/** The invoice line for a paid order. */
function lineOf(o, pkgName) {
  const d = parse(o.details, {});
  if (o.kind === 'seats') return `${o.seats} more ${o.seats === 1 ? 'seat' : 'seats'} on the TypeCraft ${pkgName} plan, ${d.from} to ${d.to}`;
  return `TypeCraft ${pkgName} plan for ${o.seats} students (seats), ${d.from} to ${d.to}${o.kind === 'renew' ? ' (renewal)' : ''}`;
}

/**
 * Switches the seats on for a paid order, once. In one transaction: the order moves to 'paid' with a fresh
 * claim_id, then the institute is created (with the payer as its admin), gets its extra seats, or its next
 * term, and the payment is recorded; each of those statements runs only under that claim_id, so a second
 * call (webhook and browser at once) changes nothing. Then the invoice is made and emailed.
 * → { instituteId, invoiceNumber }
 */
export async function fulfil(env, ctx, orderId, rzpPaymentId, via = 'system') {
  const DB = env.DB;
  const o = await DB.prepare('SELECT o.*, k.name AS package_name FROM institute_orders o JOIN packages k ON k.id = o.package_id WHERE o.id = ?1').bind(orderId).first();
  if (!o) return {};
  if (o.status !== 'paid') {
    const d = parse(o.details, {});
    const now = nowIso(), today = istDay(), claim = uuid();
    const insId = o.institute_id || newId('ins');
    const payId = newId('ipay');
    // every statement after the claim runs only if this call made it: ?20 and ?21 are the order and the claim
    const claimed = 'EXISTS (SELECT 1 FROM institute_orders WHERE id = ?20 AND claim_id = ?21)';
    const under = (stmt, ...args) => { const a = args.slice(); while (a.length < 19) a.push(null); return stmt.bind(...a, o.id, claim); };
    const steps = [
      DB.prepare(`UPDATE institute_orders SET status = 'paid', claim_id = ?2, razorpay_payment_id = ?3, paid_at = ?4, failure_reason = NULL, updated_at = ?4
                   WHERE id = ?1 AND status <> 'paid'`).bind(o.id, claim, rzpPaymentId, now),
    ];
    let line;
    if (o.kind === 'new') {
      // the term starts the day it is paid
      const from = today, to = lastDayOf(istDayStart(addMonths(today, o.months)));
      line = lineOf({ ...o, details: JSON.stringify({ ...d, from, to }) }, o.package_name);
      steps.push(
        under(DB.prepare(`INSERT INTO institutes (id, name, city, contact_name, contact_email, contact_phone, gstin, package_id, seats, price_paise, starts_at, ends_at,
                                            status, notes, created_by, created_at, updated_at)
                    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'active', 'Bought online.', ?13, ?14, ?14 WHERE ${claimed}`),
          insId, d.name, d.city || '', d.contactName || '', d.contactEmail || '', d.contactPhone || '', d.gstin || '', o.package_id, o.seats, d.pricePerSeatPaise,
            istDayStart(from), istDayStart(nextDay(to)), o.user_id, now),
        under(DB.prepare(`INSERT INTO institute_staff (id, institute_id, user_id, email, role, status, invited_by, invited_at, joined_at)
                    SELECT ?1, ?2, u.id, LOWER(u.email), 'admin', 'active', u.id, ?3, ?3 FROM users u WHERE u.id = ?4 AND ${claimed}`), newId('stf'), insId, now, o.user_id),
      );
    } else if (o.kind === 'seats') {
      line = lineOf(o, o.package_name);
      steps.push(under(DB.prepare(`UPDATE institutes SET seats = seats + ?2, updated_at = ?3 WHERE id = ?1 AND status <> 'closed' AND ${claimed}`), insId, o.seats, now));
    } else {
      // the next term starts the day after the current last day (today, if that has passed); the seats change now
      const i = await DB.prepare('SELECT ends_at FROM institutes WHERE id = ?1').bind(insId).first();
      const from = i && i.ends_at > now ? nextDay(lastDayOf(i.ends_at)) : today;
      const to = lastDayOf(istDayStart(addMonths(from, o.months)));
      line = lineOf({ ...o, details: JSON.stringify({ ...d, from, to }) }, o.package_name);
      steps.push(under(DB.prepare(`UPDATE institutes SET seats = ?2, ends_at = ?3, price_paise = ?4, updated_at = ?5 WHERE id = ?1 AND status <> 'closed' AND ${claimed}`),
        insId, o.seats, istDayStart(nextDay(to)), d.pricePerSeatPaise, now));
    }
    steps.push(
      under(DB.prepare(`INSERT INTO institute_payments (id, institute_id, amount_paise, method, reference, paid_on, note, recorded_by, created_at)
                  SELECT ?1, ?2, ?3, 'other', ?4, ?5, ?6, NULL, ?7 WHERE ${claimed} AND EXISTS (SELECT 1 FROM institutes WHERE id = ?2)`),
        payId, insId, o.amount_paise, rzpPaymentId, today, `Paid online with Razorpay (order ${o.id}).`, now),
      DB.prepare(`UPDATE institute_orders SET institute_id = ?2, institute_payment_id = (SELECT id FROM institute_payments WHERE id = ?3), details = json_set(details, '$.line', ?4)
                   WHERE id = ?1 AND claim_id = ?5`).bind(o.id, insId, payId, line, claim),
    );
    const res = await DB.batch(steps);
    if (res[0].meta.changes === 1) {
      const applied = res[1].meta.changes === 1;
      const target = `institute:${insId}`;
      await audit(env, { actorId: o.user_id, action: 'institute.order_paid', target,
        detail: { orderId: o.id, kind: o.kind, seats: o.seats, months: o.kind === 'seats' ? null : o.months, amountPaise: o.amount_paise, paymentId: rzpPaymentId, via, applied } });
      if (!applied) {
        // paid, but the institute was closed meanwhile: TypeCraft refunds it from the Razorpay dashboard
        console.error('a paid institute order could not be applied:', o.id);
        await DB.prepare("UPDATE institute_orders SET failure_reason = 'Paid, but the institute is closed: refund it from the Razorpay dashboard.' WHERE id = ?1").bind(o.id).run();
      }
    }
  }
  return afterPaid(env, ctx, orderId);
}

/** For a paid order: its invoice, made and emailed once. Safe to repeat (the cron repairs with it). → { instituteId, invoiceNumber } */
export async function afterPaid(env, ctx, orderId) {
  const DB = env.DB;
  const o = await DB.prepare('SELECT * FROM institute_orders WHERE id = ?1').bind(orderId).first();
  if (!o || o.status !== 'paid') return {};
  if (!o.institute_payment_id) return { instituteId: o.institute_id };
  let inv = null;
  try {
    const d = parse(o.details, {});
    inv = await makeInvoice(env, o.institute_id, o.institute_payment_id, { description: d.line || null, method: 'Online (Razorpay)' });
  } catch (err) {
    if (!noTable(err)) throw err;
    console.error('institute invoices are not set up; the order is paid:', o.id);
    return { instituteId: o.institute_id };
  }
  if (!inv) return { instituteId: o.institute_id };
  if (inv.made) await audit(env, { actorId: o.user_id, action: 'institute.invoice', target: `institute:${o.institute_id}`, detail: { number: inv.row.number, amountPaise: inv.row.amount_paise, paymentId: o.institute_payment_id } });
  const mine = await DB.prepare('UPDATE institute_orders SET invoice_emailed_at = ?2 WHERE id = ?1 AND invoice_emailed_at IS NULL').bind(o.id, nowIso()).run();
  if (mine.meta.changes === 1) {
    const u = await DB.prepare('SELECT email, full_name FROM users WHERE id = ?1').bind(o.user_id).first();
    const i = await DB.prepare('SELECT name, contact_email, contact_name, seats, ends_at FROM institutes WHERE id = ?1').bind(o.institute_id).first();
    const lines = parse(inv.row.lines, []);
    const data = {
      instituteName: i ? i.name : '', kind: o.kind, what: (lines[0] && lines[0].description) || '', amountPaise: o.amount_paise, invoiceNumber: inv.row.number,
      invoiceUrl: `/institute/${o.institute_id}/invoices/${inv.row.number}`, link: `/institute/${o.institute_id}`, seats: i ? i.seats : null, lastDay: i ? lastDayOf(i.ends_at) : null,
    };
    const to = [];
    if (u) to.push([u.email.toLowerCase(), u.full_name, o.user_id]);
    if (i && i.contact_email && !to.some((t) => t[0] === i.contact_email.toLowerCase())) to.push([i.contact_email.toLowerCase(), i.contact_name, null]);
    for (const [email, name, userId] of to) {
      try { await sendTemplate(env, ctx, { to: email, userId, template: 'institute_payment', data: { ...data, name } }); }
      catch (err) { console.error('institute payment email failed:', err && err.name); }
    }
  }
  return { instituteId: o.institute_id, invoiceNumber: inv.row.number };
}

async function ownOrder(env, userId, orderId) {
  if (!isId(orderId, 'iord')) throw new HttpError(404, 'not_found', NO_ORDER);
  const o = await env.DB.prepare('SELECT * FROM institute_orders WHERE id = ?1 AND user_id = ?2').bind(orderId, userId).first();
  if (!o) throw new HttpError(404, 'not_found', NO_ORDER);
  return o;
}
async function invoiceOf(env, o) {
  if (!o.institute_payment_id) return null;
  try { return ((await env.DB.prepare('SELECT number FROM institute_invoices WHERE payment_id = ?1').bind(o.institute_payment_id).first()) || {}).number || null; }
  catch (err) { if (noTable(err)) return null; throw err; }
}

/* ---------------- POST /api/institutes/checkout/verify ---------------- */
export async function postVerify(request, env, ctx) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request);
  return notReady(async () => {
    const o = await ownOrder(env, user.id, body.orderId);
    if (!(await hitLimit(env, `iverify:${user.id}`, 30, 600))) throw tooMany(10);
    if (o.status === 'paid') return json({ status: 'paid', orderId: o.id, instituteId: o.institute_id, invoiceNumber: await invoiceOf(env, o) });
    const rPay = body.razorpay_payment_id, sig = body.razorpay_signature;
    if (typeof rPay !== 'string' || !RZP_ID_RE.test(rPay) || typeof sig !== 'string' || sig.length > 200 || body.razorpay_order_id !== o.razorpay_order_id
        || !(await rzp.verifyPaymentSignature(env, o.razorpay_order_id, rPay, sig))) {
      await audit(env, { actorId: user.id, action: 'checkout.bad_signature', target: `institute_order:${o.id}`, ip: clientIp(request) });
      throw new HttpError(400, 'bad_signature', "We couldn't confirm this payment. If money was taken, your seats switch on by themselves within a few minutes.");
    }
    // the browser's word is not enough: ask Razorpay what really happened
    const p = await rzp.fetchPayment(env, rPay);
    const r = await handlePayment(env, ctx, o, p, 'signature');
    if (r.status === 'mismatch') throw new HttpError(400, 'payment_mismatch', 'This payment does not match your order. Please write to us.');
    return json({ status: r.status, orderId: o.id, ...(r.instituteId ? { instituteId: r.instituteId } : {}), ...(r.invoiceNumber ? { invoiceNumber: r.invoiceNumber } : {}) });
  });
}

/* ---------------- POST /api/institutes/checkout/failed ---------------- */
export async function postFailed(request, env) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request);
  return notReady(async () => {
    const o = await ownOrder(env, user.id, body.orderId);
    const text = [body.code, body.description].filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim().replace(/[\u0000-\u001f]/g, ' ')).join(': ').slice(0, 300)
      || 'The payment did not go through.';
    // shown back only: this never switches seats on, and never fails an order Razorpay may still capture
    await env.DB.prepare("UPDATE institute_orders SET failure_reason = ?2, updated_at = ?3 WHERE id = ?1 AND status IN ('created', 'pending', 'failed')").bind(o.id, text, nowIso()).run();
    const now = await env.DB.prepare('SELECT status, failure_reason FROM institute_orders WHERE id = ?1').bind(o.id).first();
    return json({ orderId: o.id, status: now.status, failureReason: now.failure_reason });
  });
}

/* ---------------- GET /api/institutes/checkout/orders/:id ---------------- */
export async function getOrder(request, env, ctx, params) {
  const { user } = await requireSession(env, request);
  return notReady(async () => {
    const o = await ownOrder(env, user.id, params.id);
    return json({ orderId: o.id, status: o.status, kind: o.kind, seats: o.seats, months: o.kind === 'seats' ? null : o.months, amountPaise: o.amount_paise, currency: o.currency,
      createdAt: o.created_at, paidAt: o.paid_at, instituteId: o.status === 'paid' ? o.institute_id : (o.institute_id || null),
      ...(o.status === 'paid' ? { invoiceNumber: await invoiceOf(env, o) } : {}), ...(o.failure_reason && o.status !== 'paid' ? { failureReason: o.failure_reason } : {}) });
  });
}

/* ---------------- webhooks (from billing.js) ---------------- */
/** A Razorpay payment event for an order that isn't a plan order. → { status, note? } as billing.js records it. */
export async function instituteWebhook(env, ctx, type, pay, ord) {
  const rid = (pay && pay.order_id) || (ord && ord.id);
  if (typeof rid !== 'string' || !rid) return { status: 'ignored', note: 'unknown order' };
  let o = null;
  try { o = await env.DB.prepare('SELECT * FROM institute_orders WHERE razorpay_order_id = ?1').bind(rid).first(); }
  catch (err) { if (!noTable(err)) throw err; }
  if (!o) return { status: 'ignored', note: 'unknown order' };
  if (type === 'payment.failed') {
    if (pay.amount !== o.amount_paise) return { status: 'ignored', note: 'payment does not match order' };
    await markFailed(env, o, pay.error_description);
    return { status: 'processed' };
  }
  const r = await handlePayment(env, ctx, o, pay, 'webhook');
  return r.status === 'mismatch' ? { status: 'ignored', note: 'payment does not match order' } : { status: 'processed' };
}

/* ---------------- the scheduled check ---------------- */
/** Asks Razorpay about one waiting order. → 'paid' | 'pending' | 'failed' | 'cancelled' | 'waiting' | 'mismatch' */
export async function reconcileOrder(env, ctx, o, now = Date.now()) {
  const list = await rzp.fetchOrderPayments(env, o.razorpay_order_id);
  const items = (list && Array.isArray(list.items) ? list.items : []).filter((p) => p && p.order_id === o.razorpay_order_id);
  const good = items.find((p) => p.status === 'captured') || items.find((p) => p.status === 'authorized');
  if (good) return (await handlePayment(env, ctx, o, good, 'api')).status;
  if (items.length && items.every((p) => p.status === 'failed')) {
    await markFailed(env, o, items[items.length - 1].error_description);
    return 'failed';
  }
  if (!items.length && Date.parse(o.created_at) < now - DAY_MS) {
    await env.DB.prepare("UPDATE institute_orders SET status = 'cancelled', updated_at = ?2 WHERE id = ?1 AND status = 'created'").bind(o.id, nowIso()).run();
    return 'cancelled';
  }
  return 'waiting';
}

export async function reconcile(env, ctx, { olderThanMin = 15 } = {}) {
  const DB = env.DB, out = { checked: 0, paid: 0, failed: 0, cancelled: 0, repaired: 0 };
  let rows;
  try {
    const now = Date.now();
    rows = (await DB.prepare(
      `SELECT * FROM institute_orders WHERE status IN ('created', 'pending', 'failed') AND razorpay_order_id IS NOT NULL
          AND created_at < ?1 AND created_at > ?2 ORDER BY created_at LIMIT 25`
    ).bind(new Date(now - olderThanMin * MIN_MS).toISOString(), new Date(now - 7 * DAY_MS).toISOString()).all()).results;
  } catch (err) { if (noTable(err)) return out; throw err; }
  if (rzp.configured(env)) {
    for (const o of rows) {
      // a failed order is looked at again only if Razorpay might still have money for it (a retry in the same window)
      if (o.status === 'failed' && Date.parse(o.updated_at) < Date.now() - DAY_MS) continue;
      out.checked++;
      try {
        const r = await reconcileOrder(env, ctx, o);
        if (out[r] !== undefined && (r !== 'failed' || o.status !== 'failed')) out[r]++;
      } catch (err) { console.error('institute reconcile failed for an order:', err && err.code); }
    }
  }
  // repair: every paid order has its invoice, and its email
  const todo = (await DB.prepare(
    "SELECT id FROM institute_orders WHERE status = 'paid' AND institute_payment_id IS NOT NULL AND invoice_emailed_at IS NULL ORDER BY paid_at LIMIT 25"
  ).all()).results;
  for (const t of todo) {
    try { const r = await afterPaid(env, ctx, t.id); if (r.invoiceNumber) out.repaired++; } catch (err) { console.error('institute invoice repair failed:', err && err.name); }
  }
  return out;
}

export async function cron(env, ctx, kind) {
  if (kind !== '*/10 * * * *') return;
  const r = await reconcile(env, ctx);
  if (r.checked || r.repaired) console.log('institute orders reconcile:', JSON.stringify(r));
}

/* ---------------- console: the online prices ---------------- */
export async function getPricing(request, env) {
  await requireAdmin(env, request, 'institutes.view');
  const p = await pricing(env);
  const packages = (await env.DB.prepare("SELECT id, name, active FROM packages WHERE id <> 'free' ORDER BY display_order, name").all()).results;
  return json({ ...p, razorpay: rzp.configured(env), paymentsOn: await paymentsAvailable(env), terms: p.terms, allTerms: TERMS, maxPaise: ONLINE_MAX_PAISE, renewWindowDays: RENEW_WINDOW_DAYS,
    packages: packages.map((k) => ({ id: k.id, name: k.name, active: !!k.active })) });
}

export async function putPricing(request, env) {
  const who = await requireAdmin(env, request, 'institutes.payments');
  const body = await readJson(request);
  const fields = {};
  const on = body.on === true;
  const pkg = typeof body.packageId === 'string' && body.packageId !== 'free'
    ? await env.DB.prepare("SELECT id FROM packages WHERE id = ?1 AND id <> 'free'").bind(body.packageId).first() : null;
  if (!pkg) fields.packageId = 'Choose the plan a seat gives.';
  const minSeats = Number(body.minSeats);
  if (!Number.isInteger(minSeats) || minSeats < 1 || minSeats > 1000) fields.minSeats = 'Enter a whole number from 1 to 1,000.';
  const prices = {};
  for (const m of TERMS) {
    const v = body.prices && body.prices[m];
    if (v === null || v === undefined || v === '' || v === 0) continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 100 || n > 10000000) fields[`price${m}`] = 'Enter the price per seat in rupees, from ₹1 to ₹1,00,000, or leave it empty.';
    else prices[m] = n;
  }
  if (on && !Object.keys(prices).length && !fields.price6 && !fields.price12) fields.price12 = 'Set a price for at least one term before switching online buying on.';
  if (Object.keys(fields).length) throw fieldError(fields);
  const before = await getSetting(env, 'institute_pricing', {});
  const value = { on, packageId: pkg.id, minSeats, prices, updatedAt: nowIso() };
  await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ('institute_pricing', ?1, ?2, ?3)
                        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(JSON.stringify(value), who.user.id, value.updatedAt).run();
  await audit(env, { actorId: who.user.id, action: 'institute.pricing', target: 'setting:institute_pricing',
    detail: { from: { on: !!before.on, packageId: before.packageId || null, minSeats: before.minSeats || null, prices: before.prices || {} }, to: { on, packageId: pkg.id, minSeats, prices } }, ip: clientIp(request) });
  return json({ pricing: await pricing(env) });
}

const ID = '([a-z]{3,4}_[0-9a-f]{20})';
export const ROUTES = {
  'GET /api/institutes/buy': getBuy,
  'POST /api/institutes/checkout': postCheckout,
  'POST /api/institutes/checkout/verify': postVerify,
  'POST /api/institutes/checkout/failed': postFailed,
  'GET /api/console/institutes/pricing': getPricing,
  'PUT /api/console/institutes/pricing': putPricing,
};
export const PATTERNS = [
  ['GET', new RegExp(`^/api/institutes/${ID}/buy$`), ['id'], getInstituteBuy],
  ['GET', /^\/api\/institutes\/checkout\/orders\/(iord_[0-9a-f]{20})$/, ['id'], getOrder],
];
