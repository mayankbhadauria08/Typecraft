// Coupons and promotions (docs/ADMIN-PHASE-4.md §7). Console-only endpoints: a console session is required.
//
//   GET    /api/console/coupons                coupons.view       list: q, status (live | scheduled | ended | used_up | off), page
//   POST   /api/console/coupons                coupons.manage     { code, note, kind, value, plans, startsAt, endsAt, maxUses, oncePerCustomer }
//   GET    /api/console/coupons/:id            coupons.view       one coupon, with the orders that used it
//   PUT    /api/console/coupons/:id            coupons.manage     the same fields, or only { active }
//   DELETE /api/console/coupons/:id            coupons.manage     only if never used
//   GET    /api/console/promotions             promotions.view    list: status (live | scheduled | ended | off), page
//   POST   /api/console/promotions             promotions.manage  { name, kind, value, plans, startsAt, endsAt }
//   PUT    /api/console/promotions/:id         promotions.manage  the same fields, or only { active }
//   DELETE /api/console/promotions/:id         promotions.manage  only if no order used it
//
// coupons.manage and promotions.manage change what customers pay: Super Admin always; Admin only when a
// Super Admin switches it on in Roles and permissions. Both ask for the password again.
// Value: kind 'percent' → a whole number from 1 to 90; kind 'fixed' → rupees (stored as paise).
// What customers pay is worked out in src/pricing.js.
import { HttpError, json, readJson, fieldError, clientIp, nowIso } from '../http.js';
import { uuid } from '../crypto.js';
import { audit } from '../billing.js';
import { requireAdmin } from './session.js';
import { can } from './permissions.js';
import { Binder, PAGE_SIZE, DAY_MS, pageOf, offsetOf, paged, like, oneOf, idParam, parseJson } from './lib.js';
import { CODE_RE, cleanCode, offText, PAID_STATUSES, discountPaise } from '../pricing.js';

const FIXED_MAX = 10000000; // ₹1,00,000
const iso = () => nowIso();

/* ---------- shared input ---------- */
function oneLine(v) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : ''; }
function timeOf(v, field, fields) {
  if (v == null || v === '') return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) { fields[field] = 'Choose a date and time.'; return null; }
  return new Date(t).toISOString();
}
/** kind and value: percent 1–90, or a fixed amount in rupees (₹1 to ₹1,00,000). → { kind, value (percent or paise) } */
function amountOf(body, fields) {
  const kind = body.kind === 'fixed' ? 'fixed' : body.kind === 'percent' ? 'percent' : null;
  if (!kind) { fields.kind = 'Choose a percentage or an amount in rupees.'; return {}; }
  const n = typeof body.value === 'number' ? body.value : Number(String(body.value == null ? '' : body.value).replace(/[₹,\s%]/g, ''));
  if (kind === 'percent') {
    if (!Number.isInteger(n) || n < 1 || n > 90) { fields.value = 'Give a whole number from 1 to 90.'; return { kind }; }
    return { kind, value: n };
  }
  const paise = Math.round(n * 100);
  if (!Number.isFinite(n) || paise < 100 || paise > FIXED_MAX) { fields.value = 'Give an amount from ₹1 to ₹1,00,000.'; return { kind }; }
  return { kind, value: paise };
}
async function paidPlans(env) {
  return (await env.DB.prepare("SELECT id, name, price_paise, active FROM packages WHERE id <> 'free' ORDER BY display_order, name").all()).results;
}
function plansOf(body, plans, fields) {
  const list = Array.isArray(body.plans) ? [...new Set(body.plans.filter((x) => typeof x === 'string'))] : [];
  const known = new Set(plans.map((p) => p.id));
  if (list.some((id) => !known.has(id))) fields.plans = 'Choose plans from the list.';
  return list.filter((id) => known.has(id));
}
const planNames = (ids, plans) => (ids.length ? ids.map((id) => (plans.find((p) => p.id === id) || { name: id }).name).join(', ') : 'Every paid plan');
/** The lowest price this discount gives across the plans it covers, to warn about a plan that would cost ₹1. */
function examples(kind, value, ids, plans) {
  return plans.filter((p) => !ids.length || ids.includes(p.id)).map((p) => ({ id: p.id, name: p.name, listPaise: p.price_paise, pricePaise: p.price_paise - discountPaise(kind, value, p.price_paise) }));
}

/* ---------- coupons ---------- */
const couponState = (r, now, uses) => (!r.active ? 'off' : r.ends_at && r.ends_at <= now ? 'ended' : r.starts_at && r.starts_at > now ? 'scheduled'
  : r.max_uses != null && uses >= r.max_uses ? 'used_up' : 'live');
function couponView(r, now, plans, uses = 0) {
  const ids = parseJson(r.plans, []);
  return { id: r.id, code: r.code, note: r.note, kind: r.kind, value: r.value, off: offText(r.kind, r.value), plans: ids, plansLabel: planNames(ids, plans),
    startsAt: r.starts_at || null, endsAt: r.ends_at || null, maxUses: r.max_uses, oncePerCustomer: !!r.once_per_customer, active: !!r.active,
    uses, state: couponState(r, now, uses), createdAt: r.created_at, updatedAt: r.updated_at, examples: examples(r.kind, r.value, ids, plans) };
}
const USES = `(SELECT COUNT(*) FROM order_discounts d JOIN orders o ON o.id = d.order_id WHERE d.coupon_id = c.id AND o.status IN ${PAID_STATUSES})`;
function couponWhere(b, state, term, now) {
  const w = [];
  if (term) w.push(`(c.code LIKE ${b.p(like(cleanCode(term) || term))} ESCAPE '\\' OR c.note LIKE ${b.p(like(term))} ESCAPE '\\')`);
  const n = () => b.once('now', now);
  if (state === 'off') w.push('c.active = 0');
  if (state === 'ended') w.push(`c.active = 1 AND c.ends_at IS NOT NULL AND c.ends_at <= ${n()}`);
  if (state === 'scheduled') w.push(`c.active = 1 AND c.starts_at > ${n()} AND (c.ends_at IS NULL OR c.ends_at > ${n()})`);
  if (state === 'used_up') w.push(`c.active = 1 AND (c.ends_at IS NULL OR c.ends_at > ${n()}) AND c.max_uses IS NOT NULL AND ${USES} >= c.max_uses`);
  if (state === 'live') w.push(`c.active = 1 AND (c.starts_at IS NULL OR c.starts_at <= ${n()}) AND (c.ends_at IS NULL OR c.ends_at > ${n()}) AND (c.max_uses IS NULL OR ${USES} < c.max_uses)`);
  return w.length ? 'WHERE ' + w.join(' AND ') : '';
}

export async function getCoupons(request, env) {
  const who = await requireAdmin(env, request, 'coupons.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q), DB = env.DB, now = iso();
  const state = oneOf(q.get('status'), ['live', 'scheduled', 'ended', 'used_up', 'off']);
  const term = (q.get('q') || '').trim().slice(0, 40);
  const list = new Binder(), count = new Binder();
  const lw = couponWhere(list, state, term, now), cw = couponWhere(count, state, term, now);
  const [rows, total, plans, saved] = await DB.batch([
    DB.prepare(`SELECT c.*, ${USES} AS uses FROM coupons c ${lw} ORDER BY c.active DESC, c.created_at DESC, c.id LIMIT ${PAGE_SIZE} OFFSET ${offsetOf(page)}`).bind(...list.args),
    DB.prepare(`SELECT COUNT(*) AS n FROM coupons c ${cw}`).bind(...count.args),
    DB.prepare("SELECT id, name, price_paise, active FROM packages WHERE id <> 'free' ORDER BY display_order, name"),
    DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(d.discount_paise), 0) AS paise FROM order_discounts d JOIN orders o ON o.id = d.order_id
                 WHERE d.source = 'coupon' AND o.status IN ${PAID_STATUSES}`),
  ]);
  return json({ ...paged(rows.results.map((r) => couponView(r, now, plans.results, r.uses)), page, total.results[0].n),
    plans: plans.results.map((p) => ({ id: p.id, name: p.name, pricePaise: p.price_paise, onSale: !!p.active })),
    totals: { orders: saved.results[0].n, discountPaise: saved.results[0].paise },
    can: { manage: await can(env, who.role, 'coupons.manage') } });
}

async function couponFrom(env, body, { id = null } = {}) {
  const fields = {};
  const code = cleanCode(body.code);
  if (!CODE_RE.test(code)) fields.code = 'Use 3 to 24 letters, numbers or dashes, starting with a letter or number.';
  const note = oneLine(body.note);
  if (note.length > 120) fields.note = 'Keep the note under 120 characters.';
  const amount = amountOf(body, fields);
  const plans = await paidPlans(env);
  const ids = plansOf(body, plans, fields);
  const startsAt = timeOf(body.startsAt, 'startsAt', fields), endsAt = timeOf(body.endsAt, 'endsAt', fields);
  if (startsAt && endsAt && endsAt <= startsAt) fields.endsAt = 'Make it end after it starts.';
  let maxUses = null;
  if (body.maxUses != null && body.maxUses !== '') {
    maxUses = Number(body.maxUses);
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100000) fields.maxUses = 'Give a whole number from 1 to 1,00,000, or leave it empty for no limit.';
  }
  if (CODE_RE.test(code) && !fields.code) {
    const clash = await env.DB.prepare('SELECT id FROM coupons WHERE code = ?1').bind(code).first();
    if (clash && clash.id !== id) fields.code = 'Another coupon already has this code.';
  }
  if (Object.keys(fields).length) throw fieldError(fields);
  return { code, note, kind: amount.kind, value: amount.value, plans: ids, startsAt, endsAt, maxUses, oncePerCustomer: body.oncePerCustomer !== false };
}
const log = (env, who, action, target, detail, request) => audit(env, { actorId: who.user.id, action, target, detail, ip: clientIp(request) });

export async function postCoupon(request, env) {
  const who = await requireAdmin(env, request, 'coupons.manage');
  const c = await couponFrom(env, await readJson(request, 8 * 1024));
  const id = `cpn_${uuid().replace(/-/g, '').slice(0, 16)}`, now = iso();
  await env.DB.prepare(`INSERT INTO coupons (id, code, note, kind, value, plans, starts_at, ends_at, max_uses, once_per_customer, active, created_by, updated_by, created_at, updated_at)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, ?11, ?12, ?12)`)
    .bind(id, c.code, c.note, c.kind, c.value, JSON.stringify(c.plans), c.startsAt, c.endsAt, c.maxUses, c.oncePerCustomer ? 1 : 0, who.user.id, now).run();
  await log(env, who, 'coupon.create', `coupon:${id}`, { code: c.code, kind: c.kind, value: c.value }, request);
  return json({ id, message: `Coupon ${c.code} saved.` }, 201);
}

async function couponRow(env, id) {
  const r = await env.DB.prepare(`SELECT c.*, ${USES} AS uses FROM coupons c WHERE c.id = ?1`).bind(idParam(id, 'Coupon not found.')).first();
  if (!r) throw new HttpError(404, 'not_found', 'Coupon not found.');
  return r;
}

export async function getCoupon(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'coupons.view');
  const DB = env.DB, now = iso();
  const r = await couponRow(env, params.id);
  const [orders, plans, history] = await DB.batch([
    DB.prepare(`SELECT o.id, o.status, o.amount_paise, o.paid_at, o.created_at, d.discount_paise, d.list_price_paise, u.id AS user_id, u.full_name, u.email, p.name AS package_name
                  FROM order_discounts d JOIN orders o ON o.id = d.order_id JOIN users u ON u.id = d.user_id JOIN packages p ON p.id = o.package_id
                 WHERE d.coupon_id = ?1 AND o.status IN ('paid', 'partially_refunded', 'refunded') ORDER BY o.paid_at DESC LIMIT 100`).bind(r.id),
    DB.prepare("SELECT id, name, price_paise, active FROM packages WHERE id <> 'free' ORDER BY display_order, name"),
    DB.prepare(`SELECT l.action, l.detail, l.created_at, u.full_name AS actor FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
                 WHERE l.target = ?1 ORDER BY l.created_at DESC LIMIT 30`).bind(`coupon:${r.id}`),
  ]);
  const paid = orders.results.filter((o) => o.status !== 'refunded');
  return json({
    coupon: couponView(r, now, plans.results, r.uses),
    orders: orders.results.map((o) => ({ id: o.id, status: o.status, amountPaise: o.amount_paise, listPaise: o.list_price_paise, discountPaise: o.discount_paise,
      paidAt: o.paid_at, packageName: o.package_name, customer: { id: o.user_id, fullName: o.full_name, email: o.email } })),
    totals: { orders: paid.length, salesPaise: paid.reduce((s, o) => s + o.amount_paise, 0), discountPaise: paid.reduce((s, o) => s + o.discount_paise, 0) },
    plans: plans.results.map((p) => ({ id: p.id, name: p.name, pricePaise: p.price_paise, onSale: !!p.active })),
    history: history.results.map((h) => ({ action: h.action, actor: h.actor || 'Staff', createdAt: h.created_at })),
    can: { manage: await can(env, who.role, 'coupons.manage') },
  });
}

export async function putCoupon(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'coupons.manage');
  const body = await readJson(request, 8 * 1024);
  const r = await couponRow(env, params.id);
  const now = iso();
  if (Object.keys(body).length === 1 && typeof body.active === 'boolean') {
    await env.DB.prepare('UPDATE coupons SET active = ?2, updated_by = ?3, updated_at = ?4 WHERE id = ?1').bind(r.id, body.active ? 1 : 0, who.user.id, now).run();
    await log(env, who, body.active ? 'coupon.on' : 'coupon.off', `coupon:${r.id}`, { code: r.code }, request);
    return json({ id: r.id, message: body.active ? `${r.code} works again.` : `${r.code} is turned off. Nobody can use it now.` });
  }
  const c = await couponFrom(env, body, { id: r.id });
  if (c.code !== r.code && r.uses > 0) throw fieldError({ code: "This code has been used, so it can't be renamed. Make a new coupon instead." });
  await env.DB.prepare(`UPDATE coupons SET code = ?2, note = ?3, kind = ?4, value = ?5, plans = ?6, starts_at = ?7, ends_at = ?8, max_uses = ?9, once_per_customer = ?10,
                               updated_by = ?11, updated_at = ?12 WHERE id = ?1`)
    .bind(r.id, c.code, c.note, c.kind, c.value, JSON.stringify(c.plans), c.startsAt, c.endsAt, c.maxUses, c.oncePerCustomer ? 1 : 0, who.user.id, now).run();
  await log(env, who, 'coupon.update', `coupon:${r.id}`, { code: c.code, kind: c.kind, value: c.value }, request);
  return json({ id: r.id, message: `Coupon ${c.code} saved.` });
}

export async function deleteCoupon(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'coupons.manage');
  const r = await couponRow(env, params.id);
  const any = await env.DB.prepare('SELECT COUNT(*) AS n FROM order_discounts WHERE coupon_id = ?1').bind(r.id).first();
  if (any.n > 0) throw new HttpError(409, 'used', 'Someone has checked out with this code, so it stays as a record. Turn it off instead.');
  await env.DB.prepare('DELETE FROM coupons WHERE id = ?1').bind(r.id).run();
  await log(env, who, 'coupon.delete', `coupon:${r.id}`, { code: r.code }, request);
  return json({ deleted: true, message: `Coupon ${r.code} deleted.` });
}

/* ---------- promotions ---------- */
const promoState = (r, now) => (!r.active ? 'off' : r.ends_at <= now ? 'ended' : r.starts_at > now ? 'scheduled' : 'live');
function promoView(r, now, plans, orders = 0) {
  const ids = parseJson(r.plans, []);
  return { id: r.id, name: r.name, kind: r.kind, value: r.value, off: offText(r.kind, r.value), plans: ids, plansLabel: planNames(ids, plans),
    startsAt: r.starts_at, endsAt: r.ends_at, active: !!r.active, state: promoState(r, now), orders, createdAt: r.created_at, updatedAt: r.updated_at,
    examples: examples(r.kind, r.value, ids, plans) };
}

export async function getPromotions(request, env) {
  const who = await requireAdmin(env, request, 'promotions.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q), DB = env.DB, now = iso();
  const state = oneOf(q.get('status'), ['live', 'scheduled', 'ended', 'off']);
  const where = (b) => {
    const n = () => b.once('now', now);
    if (state === 'off') return 'WHERE m.active = 0';
    if (state === 'ended') return `WHERE m.active = 1 AND m.ends_at <= ${n()}`;
    if (state === 'scheduled') return `WHERE m.active = 1 AND m.starts_at > ${n()} AND m.ends_at > ${n()}`;
    if (state === 'live') return `WHERE m.active = 1 AND m.starts_at <= ${n()} AND m.ends_at > ${n()}`;
    return '';
  };
  const list = new Binder(), count = new Binder();
  const lw = where(list), cw = where(count);
  const [rows, total, plans] = await DB.batch([
    DB.prepare(`SELECT m.*, (SELECT COUNT(*) FROM order_discounts d JOIN orders o ON o.id = d.order_id WHERE d.promotion_id = m.id AND o.status IN ${PAID_STATUSES}) AS orders
                  FROM promotions m ${lw} ORDER BY m.active DESC, m.starts_at DESC, m.id LIMIT ${PAGE_SIZE} OFFSET ${offsetOf(page)}`).bind(...list.args),
    DB.prepare(`SELECT COUNT(*) AS n FROM promotions m ${cw}`).bind(...count.args),
    DB.prepare("SELECT id, name, price_paise, active FROM packages WHERE id <> 'free' ORDER BY display_order, name"),
  ]);
  return json({ ...paged(rows.results.map((r) => promoView(r, now, plans.results, r.orders)), page, total.results[0].n),
    plans: plans.results.map((p) => ({ id: p.id, name: p.name, pricePaise: p.price_paise, onSale: !!p.active })),
    can: { manage: await can(env, who.role, 'promotions.manage') } });
}

async function promoFrom(env, body, { creating }) {
  const fields = {};
  const name = oneLine(body.name);
  if (name.length < 3) fields.name = 'Give the sale a name customers will see, like "Diwali sale".';
  else if (name.length > 40) fields.name = 'Keep the name under 40 characters.';
  const amount = amountOf(body, fields);
  const plans = await paidPlans(env);
  const ids = plansOf(body, plans, fields);
  const startsAt = timeOf(body.startsAt, 'startsAt', fields) || (body.startsAt ? null : iso());
  const endsAt = timeOf(body.endsAt, 'endsAt', fields);
  if (!endsAt && !fields.endsAt) fields.endsAt = 'A sale needs an end. Choose when it ends.';
  if (startsAt && endsAt && endsAt <= startsAt) fields.endsAt = 'Make it end after it starts.';
  else if (endsAt && creating && Date.parse(endsAt) <= Date.now()) fields.endsAt = 'Choose an end that is still to come.';
  if (startsAt && endsAt && Date.parse(endsAt) - Date.parse(startsAt) > 366 * DAY_MS) fields.endsAt = 'Keep a sale under a year. For a lasting change, change the plan’s price in Packages.';
  if (Object.keys(fields).length) throw fieldError(fields);
  return { name, kind: amount.kind, value: amount.value, plans: ids, startsAt, endsAt };
}

async function promoRow(env, id) {
  const r = await env.DB.prepare('SELECT * FROM promotions WHERE id = ?1').bind(idParam(id, 'Sale not found.')).first();
  if (!r) throw new HttpError(404, 'not_found', 'Sale not found.');
  return r;
}

export async function postPromotion(request, env) {
  const who = await requireAdmin(env, request, 'promotions.manage');
  const m = await promoFrom(env, await readJson(request, 8 * 1024), { creating: true });
  const id = `prm_${uuid().replace(/-/g, '').slice(0, 16)}`, now = iso();
  await env.DB.prepare(`INSERT INTO promotions (id, name, kind, value, plans, starts_at, ends_at, active, created_by, updated_by, created_at, updated_at)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8, ?9, ?9)`)
    .bind(id, m.name, m.kind, m.value, JSON.stringify(m.plans), m.startsAt, m.endsAt, who.user.id, now).run();
  await log(env, who, 'promotion.create', `promotion:${id}`, { name: m.name, kind: m.kind, value: m.value, startsAt: m.startsAt, endsAt: m.endsAt }, request);
  return json({ id, message: m.startsAt <= now ? `${m.name} is on now.` : `${m.name} is saved. It starts ${m.startsAt}.` }, 201);
}

export async function putPromotion(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'promotions.manage');
  const body = await readJson(request, 8 * 1024);
  const r = await promoRow(env, params.id);
  const now = iso();
  if (Object.keys(body).length === 1 && typeof body.active === 'boolean') {
    await env.DB.prepare('UPDATE promotions SET active = ?2, updated_by = ?3, updated_at = ?4 WHERE id = ?1').bind(r.id, body.active ? 1 : 0, who.user.id, now).run();
    await log(env, who, body.active ? 'promotion.on' : 'promotion.off', `promotion:${r.id}`, { name: r.name }, request);
    return json({ id: r.id, message: body.active ? `${r.name} is back on.` : `${r.name} is turned off. Prices are back to normal.` });
  }
  const m = await promoFrom(env, body, { creating: false });
  await env.DB.prepare('UPDATE promotions SET name = ?2, kind = ?3, value = ?4, plans = ?5, starts_at = ?6, ends_at = ?7, updated_by = ?8, updated_at = ?9 WHERE id = ?1')
    .bind(r.id, m.name, m.kind, m.value, JSON.stringify(m.plans), m.startsAt, m.endsAt, who.user.id, now).run();
  await log(env, who, 'promotion.update', `promotion:${r.id}`, { name: m.name, kind: m.kind, value: m.value, startsAt: m.startsAt, endsAt: m.endsAt }, request);
  return json({ id: r.id, message: `${m.name} saved.` });
}

export async function deletePromotion(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'promotions.manage');
  const r = await promoRow(env, params.id);
  const any = await env.DB.prepare('SELECT COUNT(*) AS n FROM order_discounts WHERE promotion_id = ?1').bind(r.id).first();
  if (any.n > 0) throw new HttpError(409, 'used', 'Customers have checked out at this sale price, so it stays as a record. Turn it off instead.');
  await env.DB.prepare('DELETE FROM promotions WHERE id = ?1').bind(r.id).run();
  await log(env, who, 'promotion.delete', `promotion:${r.id}`, { name: r.name }, request);
  return json({ deleted: true, message: `${r.name} deleted.` });
}

export const ROUTES = {
  'GET /api/console/coupons': getCoupons,
  'POST /api/console/coupons': postCoupon,
  'GET /api/console/promotions': getPromotions,
  'POST /api/console/promotions': postPromotion,
};
const CPN = /^\/api\/console\/coupons\/(cpn_[a-z0-9]{16})$/, PRM = /^\/api\/console\/promotions\/(prm_[a-z0-9]{16})$/;
export const PATTERNS = [
  ['GET', CPN, ['id'], getCoupon], ['PUT', CPN, ['id'], putCoupon], ['DELETE', CPN, ['id'], deleteCoupon],
  ['PUT', PRM, ['id'], putPromotion], ['DELETE', PRM, ['id'], deletePromotion],
];
