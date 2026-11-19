// What a plan costs right now (docs/ADMIN-PHASE-4.md §7): its price, lowered by a sale (promotions) or a
// coupon code typed at checkout, whichever takes more off. Never both. Written in the admin console
// (src/console/coupons-api.js); kept in migration 0011's tables. Until that migration is applied there are
// no sales, codes are refused politely, and every price is the plan's own.
//
// Discounts: a percentage (1 to 90) is rounded to whole rupees; a fixed amount is in paise. Whatever the
// discount, a paid plan costs at least ₹1 (Razorpay's smallest payment).
import { HttpError, fieldError, nowIso } from './http.js';
import { remember, PUBLIC_DATA_TTL } from './memo.js';

export const MIN_PRICE = 100;
export const PAID_STATUSES = "('paid', 'partially_refunded')"; // a fully refunded order gives its coupon use back
const parse = (text, def) => { try { const v = JSON.parse(text); return v == null ? def : v; } catch { return def; } };

/** Paise off `price` for a discount of `kind` ('percent' | 'fixed') and `value`. */
export function discountPaise(kind, value, price) {
  if (!(price > MIN_PRICE)) return 0;
  const raw = kind === 'percent' ? Math.round((price * value) / 10000) * 100 : value;
  return Math.max(0, Math.min(raw, price - MIN_PRICE));
}
export const coversPlan = (plans, packageId) => !plans.length || plans.includes(packageId);
/** "30% off" or "₹50 off". */
export const offText = (kind, value) => (kind === 'percent' ? `${value}% off` : `₹${(value / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} off`);

/* ---------- sales ---------- */
async function loadPromotions(env) {
  try {
    const rows = (await env.DB.prepare('SELECT id, name, kind, value, plans, starts_at, ends_at FROM promotions WHERE active = 1 AND ends_at > ?1 ORDER BY starts_at, id LIMIT 50')
      .bind(nowIso()).all()).results;
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, value: r.value, plans: parse(r.plans, []), startsAt: r.starts_at, endsAt: r.ends_at }));
  } catch {
    return []; // before migration 0011: no sales
  }
}
/** Sales switched on and not over yet (remembered for a minute; a console change clears it). */
export function livePromotions(env) {
  if (!env || !env.DB) return Promise.resolve([]);
  return remember(env, 'promotions', PUBLIC_DATA_TTL, () => loadPromotions(env)).catch(() => []);
}
/** The sale that takes most off this plan now, with how much: { promotion, paise } | null. */
export function bestPromotion(list, packageId, price, now = Date.now()) {
  let best = null;
  for (const p of list || []) {
    if (Date.parse(p.startsAt) > now || Date.parse(p.endsAt) <= now || !coversPlan(p.plans, packageId)) continue;
    const paise = discountPaise(p.kind, p.value, price);
    if (paise > 0 && (!best || paise > best.paise)) best = { promotion: p, paise };
  }
  return best;
}
/**
 * Public packages (packageView() shape) with any sale applied: pricePaise becomes what you pay now, and
 * listPricePaise and sale { id, name, endsAt, off } say what it was and why.
 */
export function withSales(packages, list, now = Date.now()) {
  return packages.map((p) => {
    const best = p.pricePaise > 0 ? bestPromotion(list, p.id, p.pricePaise, now) : null;
    if (!best) return p;
    const pr = best.promotion;
    return { ...p, pricePaise: p.pricePaise - best.paise, listPricePaise: p.pricePaise,
      sale: { id: pr.id, name: pr.name, endsAt: pr.endsAt, off: offText(pr.kind, pr.value) } };
  });
}

/* ---------- codes ---------- */
export const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;
export const cleanCode = (v) => (typeof v === 'string' ? v.trim().toUpperCase().replace(/\s+/g, '') : '');

/** Checks a code for one customer and plan. → the coupon row, or throws a field error on `code`. */
async function couponFor(env, code, pkg, userId, now) {
  let c;
  try {
    c = await env.DB.prepare('SELECT * FROM coupons WHERE code = ?1').bind(code).first();
  } catch {
    throw fieldError({ code: "Coupon codes can't be used right now. You can pay the full price, or try again later." });
  }
  const iso = new Date(now).toISOString();
  if (!c || !c.active) throw fieldError({ code: "That code isn't valid. Check the spelling." });
  if (c.starts_at && c.starts_at > iso) throw fieldError({ code: "That code can't be used yet." });
  if (c.ends_at && c.ends_at <= iso) throw fieldError({ code: 'That code has expired.' });
  const plans = parse(c.plans, []);
  if (!coversPlan(plans, pkg.id)) throw fieldError({ code: `That code isn't for the ${pkg.name} plan.` });
  const [used, mine] = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM order_discounts d JOIN orders o ON o.id = d.order_id WHERE d.coupon_id = ?1 AND o.status IN ${PAID_STATUSES}`).bind(c.id),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM order_discounts d JOIN orders o ON o.id = d.order_id WHERE d.coupon_id = ?1 AND d.user_id = ?2 AND o.status IN ${PAID_STATUSES}`).bind(c.id, userId),
  ]);
  if (c.max_uses != null && used.results[0].n >= c.max_uses) throw fieldError({ code: 'That code has been used up.' });
  if (c.once_per_customer && mine.results[0].n > 0) throw fieldError({ code: "You've already used that code." });
  return c;
}

/**
 * The price of a plan for one customer now, with an optional code.
 * → { listPaise, pricePaise, discount: { source, label, paise, couponId, promotionId, code, name } | null, note }
 * `note` explains when a valid code was not used because the sale already takes more off.
 * A code that can't be used throws a field error on `code`.
 */
export async function priceFor(env, pkg, { userId, code = '', now = Date.now() } = {}) {
  const list = pkg.price_paise;
  const sale = bestPromotion(await livePromotions(env), pkg.id, list, now);
  let coupon = null, couponPaise = 0;
  const typed = cleanCode(code);
  if (typed) {
    if (!CODE_RE.test(typed)) throw fieldError({ code: "That code isn't valid. Check the spelling." });
    coupon = await couponFor(env, typed, pkg, userId, now);
    couponPaise = discountPaise(coupon.kind, coupon.value, list);
    if (!couponPaise) throw fieldError({ code: "That code takes nothing off this plan's price." });
  }
  let discount = null, note = null;
  if (coupon && couponPaise > (sale ? sale.paise : 0)) {
    discount = { source: 'coupon', label: `Coupon ${coupon.code}`, name: offText(coupon.kind, coupon.value), paise: couponPaise, couponId: coupon.id, promotionId: null, code: coupon.code };
  } else if (sale) {
    const p = sale.promotion;
    discount = { source: 'promotion', label: p.name, name: offText(p.kind, p.value), paise: sale.paise, couponId: null, promotionId: p.id, code: null };
    if (coupon) note = `The ${p.name} price is already as low as this code would make it, so you get the ${p.name} price. The code stays unused.`;
  }
  if (discount && list - discount.paise < MIN_PRICE) throw new HttpError(500, 'bad_price', 'Something went wrong working out the price.');
  return { listPaise: list, pricePaise: list - (discount ? discount.paise : 0), discount, note };
}

/** The discount saved for an order, or null (also before migration 0011). */
export async function orderDiscount(env, orderId) {
  try {
    return await env.DB.prepare('SELECT * FROM order_discounts WHERE order_id = ?1').bind(orderId).first();
  } catch { return null; }
}
