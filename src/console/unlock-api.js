// Unlock conditions (docs/UNLOCK-RULES.md): who can open which lesson, for everyone.
//
//   GET  /api/console/unlock            unlock.view    what each plan includes, the rules for everyone, the progress rules
//   POST /api/console/unlock/rules      unlock.manage  one lesson or level: { scope: 'lesson' | 'level', target, effect:
//                                                      'closed' | 'open' | 'plans', reason, updatedAt } ('plans' removes
//                                                      its rule, so it follows the plans again)
//   PUT  /api/console/unlock/progress   unlock.manage  { progress: { '2': 'open' | 'bosses' | 'all', ... '5' }, placement,
//                                                      reason, updatedAt }
//
// The rules live in platform_settings 'learning_rules' (src/learning-rules.js). Every write sends back the
// updatedAt it started from, so two people changing the rules at once cannot overwrite each other.
// What a plan includes is changed on its package (Packages); exceptions for one customer are Learning access.
import '../../shared/course-meta.js';
import '../../shared/lesson-access.js';
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from '../http.js';
import { audit } from '../billing.js';
import { lessonsOf } from '../package-view.js';
import { loadRules, cleanStored, RULES_KEY, MAX_LOCKS } from '../learning-rules.js';
import { requireAdmin } from './session.js';
import { permissionsFor } from './permissions.js';
import { reasonOf } from './lib.js';

const META = globalThis.TC_META;
const A = globalThis.TC_ACCESS;
const LEVEL_NAME = Object.fromEntries(META.LEVELS.map((l) => [l.n, l.name]));
const lessonName = (id) => `Lesson ${META.BY_ID[id].n}: ${META.BY_ID[id].title}`;
const ruleName = (scope, target) => (scope === 'level' ? `Level ${target}: ${LEVEL_NAME[target]}` : lessonName(target));
const EFFECT_WORDS = { closed: 'closed for everyone', open: 'open to everyone', plans: 'follows the plans' };

/** The course, for the page: levels with their lessons. */
const COURSE = META.LEVELS.map((L) => ({
  n: L.n, name: L.name, sub: L.sub,
  lessons: META.LESSONS.filter((l) => l.level === L.n).map((l) => ({ id: l.id, n: META.BY_ID[l.id].n, title: l.title, kind: l.kind })),
  bosses: A.BOSSES_OF[L.n].length,
}));

async function view(env, who) {
  const perms = await permissionsFor(env, who.role);
  const has = (k) => perms.includes(k);
  const [{ stored, updatedAt }, pk] = await Promise.all([
    loadRules(env),
    env.DB.prepare('SELECT id, name, active, price_paise, features, limits, display_order FROM packages ORDER BY display_order, price_paise').all(),
  ]);
  const ids = [...new Set(stored.locks.map((l) => l.by).filter(Boolean))];
  const names = ids.length
    ? new Map((await env.DB.prepare(`SELECT id, full_name, email FROM users WHERE id IN (${ids.map((_, i) => '?' + (i + 1)).join(', ')})`).bind(...ids).all())
      .results.map((u) => [u.id, u.full_name || u.email]))
    : new Map();
  let exceptions = null;
  if (has('access.view')) {
    try {
      exceptions = (await env.DB.prepare('SELECT COUNT(*) AS n FROM access_overrides WHERE ended_at IS NULL AND (expires_at IS NULL OR expires_at > ?1)')
        .bind(nowIso()).first()).n;
    } catch { exceptions = null; }
  }
  return {
    levels: COURSE,
    plans: pk.results.map((p) => {
      const value = lessonsOf(p), d = A.describe(value), set = new Set(A.idsOf(value));
      return {
        id: p.id, name: p.name, active: !!p.active, pricePaise: p.price_paise, lessons: value, text: d.Text, count: d.count,
        byLevel: Object.fromEntries(COURSE.map((L) => [L.n, L.lessons.filter((l) => set.has(l.id)).length])),
      };
    }),
    rules: stored.locks.map((l) => ({ scope: l.scope, target: l.target, name: ruleName(l.scope, l.target), effect: l.effect,
      reason: l.reason, by: l.by ? names.get(l.by) || 'Deleted account' : null, at: l.at })),
    progress: stored.progress, placement: stored.placement, updatedAt,
    exceptions,
    can: { manage: has('unlock.manage'), packages: has('packages.manage'), access: has('access.view') },
  };
}

export async function getUnlock(request, env) {
  const who = await requireAdmin(env, request, 'unlock.view');
  return json(await view(env, who));
}

/** Writes the rules if nobody else has since `expected` (the updatedAt the page started from). */
async function save(env, stored, expected, who) {
  const r = await env.DB.prepare(`INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      WHERE platform_settings.updated_at IS ?5`)
    .bind(RULES_KEY, JSON.stringify(stored), who.user.id, nowIso(), expected).run();
  if (!r.meta.changes) throw new HttpError(409, 'rules_changed', 'Someone else changed these rules a moment ago. The page now shows their change: check it, then try again.');
}
const expectedOf = (body) => (typeof body.updatedAt === 'string' ? body.updatedAt : null);

export async function postRule(request, env) {
  const who = await requireAdmin(env, request, 'unlock.manage');
  const body = await readJson(request);
  const scope = body.scope;
  if (scope !== 'lesson' && scope !== 'level') throw fieldError({ scope: 'Choose a lesson or a level.' });
  const target = body.target;
  if (scope === 'level' ? !A.isLevel(target) : !A.isLesson(target)) throw fieldError({ target: scope === 'level' ? 'Choose a level.' : 'Choose a lesson.' });
  const effect = body.effect;
  if (!['closed', 'open', 'plans'].includes(effect)) throw fieldError({ effect: 'Choose what should happen to it.' });
  const reason = reasonOf(body);

  const { stored, updatedAt } = await loadRules(env);
  if (expectedOf(body) !== updatedAt) throw new HttpError(409, 'rules_changed', 'Someone else changed these rules a moment ago. The page now shows their change: check it, then try again.');
  const before = stored.locks.find((l) => l.scope === scope && l.target === target);
  const from = before ? before.effect : 'plans';
  if (from === effect) return json({ ...(await view(env, who)), unchanged: true });
  const locks = stored.locks.filter((l) => l !== before);
  if (effect !== 'plans') {
    if (locks.length >= MAX_LOCKS) throw new HttpError(409, 'too_many_rules', `There can be at most ${MAX_LOCKS} rules for everyone. Remove some first.`);
    locks.push({ scope, target, effect, reason, by: who.user.id, at: nowIso() });
  }
  await save(env, cleanStored({ ...stored, locks }), updatedAt, who);
  await audit(env, { actorId: who.user.id, action: 'unlock.rule', target: `${scope}:${target}`,
    detail: { name: ruleName(scope, target), from, to: effect, reason }, ip: clientIp(request) });
  return json({ ...(await view(env, who)), done: `${ruleName(scope, target)} now ${EFFECT_WORDS[effect]}.` });
}

export async function putProgress(request, env) {
  const who = await requireAdmin(env, request, 'unlock.manage');
  const body = await readJson(request);
  const fields = {};
  const progress = {};
  const sent = body.progress && typeof body.progress === 'object' ? body.progress : {};
  for (const n of A.LEVELS.slice(1)) {
    const v = sent[String(n)];
    if (!A.MODES.includes(v)) fields['level' + n] = `Choose when Level ${n} opens.`;
    else progress[String(n)] = v;
  }
  if (typeof body.placement !== 'boolean') fields.placement = 'Choose whether the placement test opens levels.';
  if (Object.keys(fields).length) throw fieldError(fields);
  const reason = reasonOf(body);

  const { stored, updatedAt } = await loadRules(env);
  if (expectedOf(body) !== updatedAt) throw new HttpError(409, 'rules_changed', 'Someone else changed these rules a moment ago. The page now shows their change: check it, then try again.');
  if (JSON.stringify(stored.progress) === JSON.stringify(progress) && stored.placement === body.placement) return json({ ...(await view(env, who)), unchanged: true });
  await save(env, cleanStored({ ...stored, progress, placement: body.placement }), updatedAt, who);
  await audit(env, { actorId: who.user.id, action: 'unlock.progress', target: 'learning_rules',
    detail: { before: { progress: stored.progress, placement: stored.placement }, after: { progress, placement: body.placement }, reason }, ip: clientIp(request) });
  return json({ ...(await view(env, who)), done: 'Saved. Learners see the new rules the next time their app checks, within a minute or two.' });
}

export const ROUTES = {
  'GET /api/console/unlock': getUnlock,
  'POST /api/console/unlock/rules': postRule,
  'PUT /api/console/unlock/progress': putProgress,
};
