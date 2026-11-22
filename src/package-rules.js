// The rules for a package (a plan on sale), used by the admin console (src/console/packages-api.js).
//
// What a customer already bought does not change when a package changes: a subscription keeps a
// copy of the features and limits it was sold with (user_subscriptions.features, .limits). The Free
// package is different: it is read live, so changing it changes what every free user gets at once.
// Lessons (limits.lessons) are the exception for paid packages too: a customer keeps the lessons they
// bought with, and also gets any lessons the package gains later (src/entitlements.js).
//
// Which lessons a package includes lives only in limits.lessons ('all', 'first5' or
// { levels, lessons }: shared/lesson-access.js). The two lesson features ('lessons.all',
// 'lessons.first5') only label the two standard cases, so they are set from it on every save.
import '../shared/course-meta.js';
import '../shared/lesson-access.js';
import { nowIso } from './http.js';

const A = globalThis.TC_ACCESS;
/** Features that only say which lessons a package has: derived from limits.lessons, never chosen. */
export const LESSON_FEATURES = ['lessons.first5', 'lessons.all'];

const parse = (text, def) => { try { const v = JSON.parse(text); return v == null ? def : v; } catch { return def; } };
export const LIMIT_KEYS = ['lessons', 'dailyTests', 'historyDays'];
export const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
/** Ids a new package cannot have: the console's own addresses use them. */
export const RESERVED_IDS = ['new', 'free'];

/** The editable fields of a stored package, as the APIs speak them. */
export function packageFields(p) {
  return {
    name: p.name, description: p.description, pricePaise: p.price_paise, validityDays: p.validity_days, features: parse(p.features, []),
    limits: parse(p.limits, {}), highlight: !!p.highlight, active: !!p.active, displayOrder: p.display_order,
  };
}

/** What a new package starts from: off sale until someone puts it on sale. */
export const NEW_PACKAGE = {
  name: '', description: '', pricePaise: 0, validityDays: 30, features: [], limits: { lessons: 'first5', dailyTests: 3, historyDays: 7 },
  highlight: false, active: false, displayOrder: 10,
};

export async function featureKeys(env) {
  return (await env.DB.prepare('SELECT key FROM package_features ORDER BY display_order').all()).results.map((r) => r.key);
}

/**
 * Checks a package. `cur`: what is stored now (or NEW_PACKAGE); `body`: the fields to change.
 * → { v: the checked values (trimmed, limits complete), fields: errors by field, changed: the keys that differ from cur }
 */
export function checkPackage(id, cur, body, keys) {
  const v = { ...cur };
  for (const k of Object.keys(cur)) if (body[k] !== undefined) v[k] = body[k];
  const f = {};
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.trim().length > 60) f.name = 'Name: 1–60 characters.';
  if (typeof v.description !== 'string' || v.description.length > 500) f.description = 'Description: at most 500 characters.';
  const isFree = id === 'free';
  if (!Number.isInteger(v.pricePaise) || v.pricePaise < 0 || v.pricePaise > 100000000) f.pricePaise = 'Price must be whole paise from 0 to 10,00,00,000.';
  else if (isFree && v.pricePaise !== 0) f.pricePaise = 'The Free plan must cost 0.';
  else if (!isFree && v.pricePaise < 100) f.pricePaise = 'A paid plan must cost at least ₹1 (100 paise).';
  if (v.validityDays !== null && (!Number.isInteger(v.validityDays) || v.validityDays < 1 || v.validityDays > 3650)) f.validityDays = 'Validity: whole days from 1 to 3650, or empty for no expiry.';
  else if (isFree && v.validityDays !== null) f.validityDays = 'The Free plan never expires.';
  if (!Array.isArray(v.features) || v.features.some((x) => !keys.includes(x)) || new Set(v.features).size !== v.features.length) f.features = 'Features must be a list of known feature keys, each once.';
  const L = v.limits;
  if (!L || typeof L !== 'object' || Array.isArray(L)) f.limits = 'Limits must be an object.';
  else {
    const extra = Object.keys(L).filter((k) => !LIMIT_KEYS.includes(k));
    const okN = (x, max) => x === null || (Number.isInteger(x) && x >= 0 && x <= max);
    if (extra.length) f.limits = `Unknown limit: ${extra[0]}.`;
    else if (!A.check(L.lessons).ok) f.limits = A.check(L.lessons).error;
    else if (!okN(L.dailyTests, 10000)) f.limits = 'limits.dailyTests must be a whole number or null (unlimited).';
    else if (!okN(L.historyDays, 3650) || L.historyDays === 0) f.limits = 'limits.historyDays must be 1–3650 or null (all history).';
  }
  if (typeof v.highlight !== 'boolean') f.highlight = 'highlight must be true or false.';
  if (typeof v.active !== 'boolean') f.active = 'active must be true or false.';
  else if (isFree && !v.active) f.active = 'The Free plan cannot be switched off.';
  if (!Number.isInteger(v.displayOrder) || v.displayOrder < 0 || v.displayOrder > 1000) f.displayOrder = 'displayOrder must be a whole number from 0 to 1000.';
  if (Object.keys(f).length) return { v, fields: f, changed: [] };
  v.name = v.name.trim();
  v.description = v.description.trim();
  v.limits = { lessons: A.check(L.lessons).value, dailyTests: L.dailyTests ?? null, historyDays: L.historyDays ?? null };
  // the lesson features follow the lessons: 'lessons.all' for every lesson, 'lessons.first5' for the first five
  const lessonFeature = v.limits.lessons === 'all' ? 'lessons.all' : v.limits.lessons === 'first5' ? 'lessons.first5' : null;
  v.features = v.features.filter((k) => !LESSON_FEATURES.includes(k));
  if (lessonFeature && keys.includes(lessonFeature)) v.features.unshift(lessonFeature);
  const same = (k) => k === 'features' ? JSON.stringify([...(cur.features || [])].sort()) === JSON.stringify([...v.features].sort())
    : JSON.stringify(cur[k]) === JSON.stringify(v[k]);
  const changed = Object.keys(cur).filter((k) => !same(k));
  return { v, fields: f, changed };
}

/** The other packages shown as recommended now: saving `v` takes the highlight off them (recorded in the activity log). */
export async function highlightTakenFrom(env, id, v) {
  if (!v.highlight) return [];
  return (await env.DB.prepare('SELECT id FROM packages WHERE highlight = 1 AND id <> ?1 ORDER BY id').bind(id).all()).results.map((r) => r.id);
}

/**
 * The statements that store a checked package (one batch). Only one package is shown as
 * recommended: highlighting one takes the highlight off the others.
 */
export function saveStatements(env, id, v, { isNew = false, now = nowIso() } = {}) {
  const DB = env.DB;
  const args = [id, v.name, v.description, v.pricePaise, v.validityDays, JSON.stringify(v.features), JSON.stringify(v.limits), v.highlight ? 1 : 0, v.active ? 1 : 0, v.displayOrder, now];
  const out = [isNew
    ? DB.prepare(`INSERT INTO packages (id, name, description, price_paise, currency, validity_days, features, limits, highlight, active, display_order, created_at, updated_at)
                  VALUES (?1, ?2, ?3, ?4, 'INR', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`).bind(...args)
    : DB.prepare(`UPDATE packages SET name = ?2, description = ?3, price_paise = ?4, validity_days = ?5, features = ?6, limits = ?7, highlight = ?8, active = ?9,
                  display_order = ?10, updated_at = ?11 WHERE id = ?1`).bind(...args)];
  if (v.highlight) out.push(DB.prepare('UPDATE packages SET highlight = 0, updated_at = ?2 WHERE id <> ?1 AND highlight = 1').bind(id, now));
  return out;
}
