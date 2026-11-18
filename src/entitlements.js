// Entitlements — docs/SAAS-CONTRACTS.md §3.
// What a learner may use = Free (the 'free' package row) + every active subscription
// that has not expired (contract §2: a stacked renewal counts from the moment it is
// bought, so an upgrade bought during a cheaper plan gives its features at once).
// Feature checks use feature keys only.
// On top of the plan, staff can open or close one lesson or game for one customer
// (access_overrides, migration 0006; docs/ADMIN-PHASE-2.md §9): a closed one stays closed
// whatever the plan, an opened one is open whatever the plan. The placement test, the
// review drill and the Daily Challenge are never closed.
import '../shared/course-meta.js';
import { nowIso } from './http.js';

const META = globalThis.TC_META;
/** The lessons Free includes: the first five in course order. */
export const FIRST5 = META.ORDER.slice(0, 5);
/** Lesson ids that are always open (placement test, review drill). */
const ALWAYS_OPEN = new Set(['placement', 'review']);

// Used only if the 'free' package row is missing (it is seeded by migration 0003).
export const FREE = { plan: 'free', planName: 'Free', expiresAt: null, features: ['lessons.first5', 'arcade.daily', 'tests.basic'], limits: { lessons: 'first5', dailyTests: 3, historyDays: 7 } };

const parse = (text, def) => { try { const v = JSON.parse(text); return v == null ? def : v; } catch { return def; } };

/** Merge limits: the most generous wins (null = unlimited). */
export function mergeLimits(a, b) {
  const out = { ...a };
  if (b.lessons === 'all' || a.lessons === 'all') out.lessons = 'all';
  else out.lessons = a.lessons || b.lessons || 'first5';
  for (const k of ['dailyTests', 'historyDays']) {
    const x = a[k], y = b[k];
    out[k] = x === null || y === null ? null : Math.max(Number(x) || 0, Number(y) || 0);
  }
  return out;
}

const noOverrides = () => ({ lessons: { allow: [], deny: [] }, games: { allow: [], deny: [] } });

/** The lessons and games staff opened or closed for this customer, still in force. */
async function overridesFor(env, userId, now) {
  const out = noOverrides();
  let rows = [];
  try {
    rows = (await env.DB.prepare(
      `SELECT kind, target, effect FROM access_overrides
        WHERE user_id = ?1 AND ended_at IS NULL AND (expires_at IS NULL OR expires_at > ?2)`
    ).bind(userId, now).all()).results;
  } catch (err) {
    if (!/no such table/i.test(String(err && err.message))) throw err;   // before migration 0006: there are none
  }
  for (const r of rows) {
    const bucket = r.kind === 'lesson' ? out.lessons : r.kind === 'game' ? out.games : null;
    if (bucket && (r.effect === 'allow' || r.effect === 'deny') && !bucket[r.effect].includes(r.target)) bucket[r.effect].push(r.target);
  }
  return out;
}

/** 'allow', 'deny' or null: what staff decided about this lesson ('lessons') or game ('games') for this customer. */
export function overrideOf(ent, kind, id) {
  const o = ent && ent.overrides && ent.overrides[kind];
  if (!o) return null;
  if (Array.isArray(o.deny) && o.deny.includes(id)) return 'deny';
  if (Array.isArray(o.allow) && o.allow.includes(id)) return 'allow';
  return null;
}

export async function entitlementsFor(env, userId, now = nowIso()) {
  const DB = env.DB;
  const [freeRes, subsRes] = await DB.batch([
    DB.prepare("SELECT id, name, features, limits FROM packages WHERE id = 'free'"),
    DB.prepare(`SELECT s.id, s.package_id, s.status, s.source, s.starts_at, s.expires_at, s.features, s.limits,
                       p.name AS package_name, p.display_order
                  FROM user_subscriptions s JOIN packages p ON p.id = s.package_id
                 WHERE s.user_id = ?1 AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?2)
                 ORDER BY s.starts_at`).bind(userId, now),
  ]);
  const free = freeRes.results[0];
  const ent = {
    plan: 'free',
    planName: free ? free.name : FREE.planName,
    expiresAt: null,
    features: free ? parse(free.features, FREE.features) : [...FREE.features],
    limits: { ...FREE.limits, ...(free ? parse(free.limits, {}) : {}) },
    subscriptions: [],
    overrides: await overridesFor(env, userId, now),
  };
  let best = null, latest = null, lifetime = false;
  const features = new Set(ent.features);
  for (const s of subsRes.results) {
    ent.subscriptions.push({ id: s.id, packageId: s.package_id, packageName: s.package_name, status: s.status, startsAt: s.starts_at, expiresAt: s.expires_at, source: s.source });
    if (s.expires_at == null) lifetime = true;
    else if (!latest || s.expires_at > latest) latest = s.expires_at;
    for (const f of parse(s.features, [])) features.add(f);
    ent.limits = mergeLimits(ent.limits, parse(s.limits, {}));
    if (!best || s.display_order > best.display_order) best = s;
  }
  ent.features = [...features];
  if (best) { ent.plan = best.package_id; ent.planName = best.package_name; ent.expiresAt = lifetime ? null : latest; }
  return ent;
}

export function has(ent, feature) {
  return !!ent && Array.isArray(ent.features) && ent.features.includes(feature);
}

export function lessonAllowed(ent, lessonId) {
  if (lessonId === 'custom') return has(ent, 'practice.custom');
  if (ALWAYS_OPEN.has(lessonId)) return true;
  const o = overrideOf(ent, 'lessons', lessonId);
  if (o) return o === 'allow';
  if ((ent.limits && ent.limits.lessons === 'all') || has(ent, 'lessons.all')) return true;
  return FIRST5.includes(lessonId);
}

export function gameAllowed(ent, gameId) {
  if (gameId === 'daily') return true;
  const o = overrideOf(ent, 'games', gameId);
  if (o) return o === 'allow';
  return has(ent, 'arcade.all');
}

/** True when this browser event is refused because staff closed its lesson or game (not because of the plan). */
export function eventClosed(ent, e) {
  if (!e || typeof e !== 'object') return false;
  if (e.type === 'run' || e.type === 'step') return overrideOf(ent, 'lessons', e.lessonId) === 'deny';
  if (e.type === 'game') return overrideOf(ent, 'games', e.gameId) === 'deny';
  return false;
}

/**
 * May this raw browser event be saved under the plan? run/step events need the
 * lesson, game events the game. Unknown lesson ids are left to the normal event
 * checks (they are rejected there as bad_lesson).
 */
export function eventAllowed(ent, e) {
  if (!e || typeof e !== 'object') return true;
  if (e.type === 'run' || e.type === 'step') {
    const id = e.lessonId;
    if (id === 'custom' || ALWAYS_OPEN.has(id) || (typeof id === 'string' && META.BY_ID[id])) return lessonAllowed(ent, id);
    return true;
  }
  if (e.type === 'game') return typeof e.gameId !== 'string' || gameAllowed(ent, e.gameId);
  return true;
}
