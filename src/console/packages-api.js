// Packages (docs/ADMIN-PHASE-2.md §10): the plans on sale. Console-only endpoints.
//
//   GET  /api/console/packages        packages.view    every package, with how many customers have it and its sales in 30 days
//   GET  /api/console/packages/:id    packages.view    one package, its features list and its history
//   POST /api/console/packages        packages.manage  create: { id, ...fields }
//   PUT  /api/console/packages/:id    packages.manage  update: the fields to change; { confirmPriceChange: true } when
//                                                      the price moves by more than half
//
// The rules are src/package-rules.js. No delete: a package goes off
// sale instead, because orders and subscriptions point at it. Money totals need revenue.view.
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from '../http.js';
import { audit } from '../billing.js';
import { packageFields, checkPackage, featureKeys, saveStatements, highlightTakenFrom, NEW_PACKAGE, ID_RE, RESERVED_IDS } from '../package-rules.js';
import { requireAdmin } from './session.js';
import { permissionsFor } from './permissions.js';
import { DAY_MS, idParam, parseJson } from './lib.js';

const SOLD = "('paid', 'partially_refunded', 'refunded')";

/** The figures for each package: customers who have it now, and sales in the last 30 days. */
function statsStatements(env, now) {
  const DB = env.DB, since = new Date(Date.parse(now) - 30 * DAY_MS).toISOString();
  return [
    DB.prepare(`SELECT package_id, COUNT(DISTINCT user_id) AS n FROM user_subscriptions
                 WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?1) GROUP BY package_id`).bind(now),
    DB.prepare(`SELECT package_id, COUNT(*) AS orders, COALESCE(SUM(amount_paise), 0) AS gross FROM orders
                 WHERE status IN ${SOLD} AND paid_at >= ?1 GROUP BY package_id`).bind(since),
    // everyone without a paid plan in force is on Free
    DB.prepare(`SELECT COUNT(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM user_subscriptions s WHERE s.user_id = u.id AND s.status = 'active'
                 AND (s.expires_at IS NULL OR s.expires_at > ?1))`).bind(now),
  ];
}
function view(p, labels, stats, money) {
  const f = packageFields(p);
  return {
    id: p.id, ...f, currency: p.currency, featureLabels: f.features.map((k) => labels[k] || k), createdAt: p.created_at, updatedAt: p.updated_at,
    customers: p.id === 'free' ? stats.onFree : (stats.subs.get(p.id) || 0),
    sales30: p.id === 'free' ? null : { orders: (stats.sales.get(p.id) || {}).orders || 0, grossPaise: money ? ((stats.sales.get(p.id) || {}).gross || 0) : null },
  };
}
async function load(env, who, ids = null) {
  const DB = env.DB, now = nowIso();
  const perms = await permissionsFor(env, who.role);
  const [rows, features, subs, sales, free] = await DB.batch([
    ids ? DB.prepare('SELECT * FROM packages WHERE id = ?1').bind(ids) : DB.prepare('SELECT * FROM packages ORDER BY display_order, price_paise, id'),
    DB.prepare('SELECT key, label, description FROM package_features ORDER BY display_order'),
    ...statsStatements(env, now),
  ]);
  const labels = Object.fromEntries(features.results.map((x) => [x.key, x.label]));
  const stats = { subs: new Map(subs.results.map((r) => [r.package_id, r.n])), sales: new Map(sales.results.map((r) => [r.package_id, r])), onFree: free.results[0].n };
  return { items: rows.results.map((p) => view(p, labels, stats, perms.includes('revenue.view'))), features: features.results, perms };
}

export async function getPackages(request, env) {
  const who = await requireAdmin(env, request, 'packages.view');
  const { items, features } = await load(env, who);
  return json({ items, features });
}

export async function getPackage(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'packages.view');
  const id = idParam(params.id, 'Package not found.');
  const { items, features, perms } = await load(env, who, id);
  if (!items.length) throw new HttpError(404, 'not_found', 'Package not found.');
  let history = null;
  if (perms.includes('audit.view')) {
    const rows = (await env.DB.prepare(`SELECT a.action, a.detail, a.created_at, x.full_name AS actor FROM audit_logs a LEFT JOIN users x ON x.id = a.actor_id
                                         WHERE a.target = ?1 ORDER BY a.created_at DESC LIMIT 30`).bind(`package:${id}`).all()).results;
    history = rows.map((a) => { const d = parseJson(a.detail, {}); return { action: a.action, changed: Array.isArray(d.changed) ? d.changed : [], actor: a.actor || 'System', createdAt: a.created_at }; });
  }
  return json({ package: items[0], features, history });
}

/* ---------- changes ---------- */
const fieldsOnly = (body) => Object.fromEntries(Object.keys(NEW_PACKAGE).filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
const differences = (changed, before, after) => Object.fromEntries(changed.map((k) => [k, { from: before[k], to: after[k] }]));

export async function postPackage(request, env) {
  const who = await requireAdmin(env, request, 'packages.manage');
  const body = await readJson(request);
  const DB = env.DB;
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!ID_RE.test(id) || RESERVED_IDS.includes(id)) {
    throw fieldError({ id: 'Use 2 to 31 lower-case letters, digits and hyphens, starting with a letter (for example pro-yearly).' });
  }
  if (await DB.prepare('SELECT 1 FROM packages WHERE id = ?1').bind(id).first()) throw fieldError({ id: 'A package with this ID already exists.' });
  const { v, fields } = checkPackage(id, NEW_PACKAGE, fieldsOnly(body), await featureKeys(env));
  if (Object.keys(fields).length) throw fieldError(fields);
  const taken = await highlightTakenFrom(env, id, v);
  await DB.batch(saveStatements(env, id, v, { isNew: true }));
  await audit(env, { actorId: who.user.id, action: 'package.create', target: `package:${id}`,
    detail: { changed: Object.keys(v), to: v, ...(taken.length ? { highlightTakenFrom: taken } : {}) }, ip: clientIp(request) });
  const { items } = await load(env, who, id);
  return json({ package: items[0] }, 201);
}

export async function putPackage(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'packages.manage');
  const DB = env.DB;
  const p = await DB.prepare('SELECT * FROM packages WHERE id = ?1').bind(idParam(params.id, 'Package not found.')).first();
  if (!p) throw new HttpError(404, 'not_found', 'Package not found.');
  const body = await readJson(request);
  const cur = packageFields(p);
  const { v, fields, changed } = checkPackage(p.id, cur, fieldsOnly(body), await featureKeys(env));
  if (Object.keys(fields).length) throw fieldError(fields);
  if (!changed.length) return json({ package: (await load(env, who, p.id)).items[0], changed });
  // a big price change is easy to type by mistake (499 for 4999): it has to be confirmed
  if (cur.pricePaise > 0 && Math.abs(v.pricePaise - cur.pricePaise) > cur.pricePaise / 2 && body.confirmPriceChange !== true) {
    throw new HttpError(409, 'confirm_price', 'The price changes by more than half. Confirm the change to save it.');
  }
  const taken = await highlightTakenFrom(env, p.id, v);
  await DB.batch(saveStatements(env, p.id, v));
  await audit(env, { actorId: who.user.id, action: 'package.update', target: `package:${p.id}`,
    detail: { changed, ...differences(changed, cur, v), ...(taken.length ? { highlightTakenFrom: taken } : {}) }, ip: clientIp(request) });
  return json({ package: (await load(env, who, p.id)).items[0], changed });
}

export const ROUTES = {
  'GET /api/console/packages': getPackages,
  'POST /api/console/packages': postPackage,
};
export const PATTERNS = [
  ['GET', /^\/api\/console\/packages\/([\w-]{1,64})$/, ['id'], getPackage],
  ['PUT', /^\/api\/console\/packages\/([\w-]{1,64})$/, ['id'], putPackage],
];
