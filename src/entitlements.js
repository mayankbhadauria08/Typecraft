// Entitlements — docs/SAAS-CONTRACTS.md §3.
// What a learner may use = Free (the 'free' package row) + every active subscription
// that has started and has not expired. Feature checks use feature keys only.
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
  };
  let best = null, latest = null, lifetime = false;
  const features = new Set(ent.features);
  for (const s of subsRes.results) {
    ent.subscriptions.push({ id: s.id, packageId: s.package_id, packageName: s.package_name, status: s.status, startsAt: s.starts_at, expiresAt: s.expires_at, source: s.source });
    if (s.expires_at == null) lifetime = true;
    else if (!latest || s.expires_at > latest) latest = s.expires_at;
    if (s.starts_at > now) continue; // a stacked renewal: counts from its start
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
  if ((ent.limits && ent.limits.lessons === 'all') || has(ent, 'lessons.all')) return true;
  return FIRST5.includes(lessonId);
}

export function gameAllowed(ent, gameId) {
  if (gameId === 'daily') return true;
  return has(ent, 'arcade.all');
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
