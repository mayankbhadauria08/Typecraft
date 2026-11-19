// Entitlements — docs/SAAS-CONTRACTS.md §3.
// What a learner may use = Free (the 'free' package row) + every active subscription
// that has not expired (contract §2: a stacked renewal counts from the moment it is
// bought, so an upgrade bought during a cheaper plan gives its features at once).
// Feature checks use feature keys only.
// On top of the plan, staff can open or close one lesson or game for one customer
// (access_overrides, migration 0006; docs/ADMIN-PHASE-2.md §9): a closed one stays closed
// whatever the plan, an opened one is open whatever the plan. The placement test, the
// review drill and the Daily Challenge are never closed.
// Which lessons a plan includes, and the rules for everyone (a lesson or level closed for
// everyone or open to everyone), are decided by shared/lesson-access.js, the same code the app
// runs: docs/UNLOCK-RULES.md. A paid plan keeps the lessons it was bought with
// (user_subscriptions.limits) and also gets any its package has gained since: removing lessons
// from a package only changes what new buyers get.
// A seat in an institute (migration 0009, docs/INSTITUTES.md §3) counts like a period of its package that
// ends with the institute's term: ent.seats lists them.
import '../shared/course-meta.js';
import '../shared/lesson-access.js';
import { nowIso } from './http.js';
import { rulesStatement, fromRow, projection } from './learning-rules.js';
import { seatsFor } from './institute-access.js';

const META = globalThis.TC_META;
const A = globalThis.TC_ACCESS;
/** The lessons the original Free included: the first five in course order. */
export const FIRST5 = META.ORDER.slice(0, 5);
/** Lesson ids that are always open (placement test, review drill). */
const ALWAYS_OPEN = new Set(A.ALWAYS_OPEN);

// Used only if the 'free' package row is missing (it is seeded by migration 0003).
export const FREE = { plan: 'free', planName: 'Free', expiresAt: null, features: ['lessons.first5', 'arcade.daily', 'tests.basic'], limits: { lessons: 'first5', dailyTests: 3, historyDays: 7 } };

const parse = (text, def) => { try { const v = JSON.parse(text); return v == null ? def : v; } catch { return def; } };

/** Merge limits: the most generous wins (null = unlimited). Lessons: every lesson either one includes. */
export function mergeLimits(a, b) {
  const out = { ...a };
  out.lessons = A.union(a.lessons, b.lessons);
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
  const [seats, [freeRes, subsRes, rulesRes]] = await Promise.all([seatsFor(env, userId, now), DB.batch([
    DB.prepare("SELECT id, name, features, limits FROM packages WHERE id = 'free'"),
    DB.prepare(`SELECT s.id, s.package_id, s.status, s.source, s.starts_at, s.expires_at, s.features, s.limits,
                       p.name AS package_name, p.display_order, p.limits AS package_limits
                  FROM user_subscriptions s JOIN packages p ON p.id = s.package_id
                 WHERE s.user_id = ?1 AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?2)
                 ORDER BY s.starts_at`).bind(userId, now),
    rulesStatement(env),
  ])]);
  const free = freeRes.results[0];
  const ent = {
    plan: 'free',
    planName: free ? free.name : FREE.planName,
    expiresAt: null,
    features: free ? parse(free.features, FREE.features) : [...FREE.features],
    limits: { ...FREE.limits, ...(free ? parse(free.limits, {}) : {}) },
    subscriptions: [],
    overrides: await overridesFor(env, userId, now),
    rules: projection(fromRow(rulesRes.results[0]).stored),
  };
  let best = null, latest = null, lifetime = false;
  const features = new Set(ent.features);
  for (const s of subsRes.results) {
    ent.subscriptions.push({ id: s.id, packageId: s.package_id, packageName: s.package_name, status: s.status, startsAt: s.starts_at, expiresAt: s.expires_at, source: s.source });
    if (s.expires_at == null) lifetime = true;
    else if (!latest || s.expires_at > latest) latest = s.expires_at;
    for (const f of parse(s.features, [])) features.add(f);
    const bought = parse(s.limits, {});
    // what it was bought with, plus any lessons its package has gained since
    ent.limits = mergeLimits(ent.limits, { ...bought, lessons: A.union(bought.lessons, parse(s.package_limits, {}).lessons) });
    if (!best || s.display_order > best.display_order) best = s;
  }
  // a seat in an institute counts like a plan period that ends with the institute's term
  // (docs/INSTITUTES.md §3): its package as it is today; whichever lasts longer wins, as for periods
  ent.seats = [];
  for (const m of seats) {
    ent.seats.push({ id: m.id, instituteId: m.institute_id, instituteName: m.institute_name, batchName: m.batch_name,
      packageId: m.package_id, packageName: m.package_name, joinedAt: m.joined_at, expiresAt: m.ends_at });
    if (!latest || m.ends_at > latest) latest = m.ends_at;
    for (const f of parse(m.features, [])) features.add(f);
    ent.limits = mergeLimits(ent.limits, parse(m.limits, {}));
    if (!best || m.display_order > best.display_order) best = m;
  }
  ent.features = [...features];
  if (best) { ent.plan = best.package_id; ent.planName = best.package_name; ent.expiresAt = lifetime ? null : latest; }
  // older plans say "every lesson" with the lessons.all feature: the lessons value says it too, so readers need only one
  if (features.has('lessons.all')) ent.limits.lessons = 'all';
  ent.limits.lessons = A.check(ent.limits.lessons).ok ? A.check(ent.limits.lessons).value : 'first5';
  const words = A.describe(ent.limits.lessons);
  ent.lessonsWords = { text: words.text, Text: words.Text, short: words.short, count: words.count, all: words.all };
  return ent;
}

export function has(ent, feature) {
  return !!ent && Array.isArray(ent.features) && ent.features.includes(feature);
}

/** Why this lesson is open or not for this learner: shared/lesson-access.js access(). Progress rules are the app's. */
export function lessonAccess(ent, lessonId) {
  return A.access({ lessons: ent && ent.limits ? ent.limits.lessons : 'first5', all: has(ent, 'lessons.all'),
    overrides: ent && ent.overrides ? ent.overrides.lessons : null, rules: ent ? ent.rules : null }, lessonId);
}

export function lessonAllowed(ent, lessonId) {
  if (lessonId === 'custom') return has(ent, 'practice.custom');
  if (ALWAYS_OPEN.has(lessonId)) return true;
  return lessonAccess(ent, lessonId).open;
}

/** 'you' when staff closed this lesson for this learner, 'all' when it is closed for everyone, else null. */
export function lessonClosed(ent, lessonId) {
  const why = lessonAccess(ent, lessonId).why;
  return why === 'you-closed' ? 'you' : why === 'all-closed' ? 'all' : null;
}

export function gameAllowed(ent, gameId) {
  if (gameId === 'daily') return true;
  const o = overrideOf(ent, 'games', gameId);
  if (o) return o === 'allow';
  return has(ent, 'arcade.all');
}

/** True when this browser event is refused because staff closed its lesson or game, for this learner or for
 *  everyone (not because of the plan). */
export function eventClosed(ent, e) {
  if (!e || typeof e !== 'object') return false;
  if (e.type === 'run' || e.type === 'step') return typeof e.lessonId === 'string' && e.lessonId !== 'custom' && !!lessonClosed(ent, e.lessonId);
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
