// Premium content (docs/SAAS-CONTRACTS.md §6), owner: app part.
//   GET /api/content/packs      → every pack (title, description, exercise titles, locked) for anyone signed in
//   GET /api/content/packs/:id  → the pack with its texts, only with 'exercises.premium' (402 otherwise)
import { HttpError, json, nowIso } from './http.js';
import { requireSession } from './session.js';
import { META, normalizeEvent, processEvents, countRejects } from './pipeline.js';
import { entitlementsFor, has } from './entitlements.js';
import { packsFor } from './course-store.js';   // the packs in code, with the published edits (docs/ADMIN-PHASE-3.md)

export const PACK_FEATURE = 'exercises.premium';

/** The 402 answer of §3. */
export function planRequired(feature, message) {
  return json({ error: { code: 'plan_required', message: message || 'This needs a paid plan. See the plans to unlock it.', feature, upgradeUrl: '/pricing' } }, 402);
}

const summary = (p, locked) => ({
  id: p.id, title: p.title, description: p.description, locked, feature: PACK_FEATURE,
  exerciseCount: p.exercises.length,
  exercises: p.exercises.map((e) => ({ id: e.id, title: e.title, chars: e.text.length })),
});

async function listPacks(request, env) {
  const { user } = await requireSession(env, request);
  const ent = await entitlementsFor(env, user.id);
  const locked = !has(ent, PACK_FEATURE);
  return json({ packs: (await packsFor(env)).map((p) => summary(p, locked)) });
}

async function getPack(request, env, ctx, params) {
  const { user } = await requireSession(env, request);
  const pack = (await packsFor(env)).find((p) => p.id === params.id);
  if (!pack) throw new HttpError(404, 'not_found', 'There is no practice pack with that name.');
  const ent = await entitlementsFor(env, user.id);
  if (!has(ent, PACK_FEATURE)) return planRequired(PACK_FEATURE, 'Practice packs are part of the Pro plan and above. See the plans to unlock them.');
  return json({ pack: { ...summary(pack, false), exercises: pack.exercises.map((e) => ({ id: e.id, title: e.title, text: e.text })) } });
}

/* ---------------- lessonId 'custom': practice texts that are not course lessons ----------------
   Custom practice (the learner's own text, weak-key drills) and premium pack exercises are saved as
   run/step events with lessonId 'custom'. They count towards practice time, streaks and quests, never
   towards a lesson's stars. Accepted only with practice.custom or exercises.premium; otherwise each
   such event is rejected with code 'plan_required' (the rest of the batch still counts). */
export const CUSTOM_LESSON = 'custom';
export const CUSTOM_FEATURES = ['practice.custom', PACK_FEATURE];
const isCustom = (e) => !!e && typeof e === 'object' && e.lessonId === CUSTOM_LESSON && (e.type === 'run' || e.type === 'step');

/**
 * Takes the 'custom' events out of a batch from the browser. Returns { rest, finish(result) }:
 * process `rest` as usual, then `await finish(result)` saves the allowed custom events and adds
 * their outcome (accepted, duplicates, rejected, awarded) to `result`.
 */
export async function takeCustomEvents(env, userId, events) {
  const list = Array.isArray(events) ? events : [];
  const mine = list.filter(isCustom);
  const rest = mine.length ? list.filter((e) => !isCustom(e)) : list;
  return {
    rest,
    async finish(r) {
      if (!mine.length) return r;
      const ent = await entitlementsFor(env, userId);
      const allowed = CUSTOM_FEATURES.some((f) => has(ent, f));
      const now = nowIso(), ok = [], rejected = [];
      for (const raw of mine) {
        const id = typeof raw.id === 'string' ? raw.id.slice(0, 100) : null;
        if (!allowed) { rejected.push({ id, code: 'plan_required', message: 'Custom practice and practice packs need the Pro plan or above.', feature: 'practice.custom' }); continue; }
        // the usual checks of every field, with a real lesson standing in for the lesson id
        const n = normalizeEvent({ ...raw, lessonId: META.ORDER[0] }, now);
        if (n.error) { rejected.push({ id, ...n.error }); continue; }
        ok.push({ ...n.event, lessonId: CUSTOM_LESSON, stars: null, crown: 0 });
      }
      if (rejected.length) await countRejects(env, userId, rejected.map((x) => x.code), now);
      const s = ok.length ? await processEvents(env, userId, ok, { internal: true }) : null;
      r.accepted = [...r.accepted, ...(s ? s.accepted : [])];
      r.duplicates = [...r.duplicates, ...(s ? s.duplicates : [])];
      r.rejected = [...r.rejected, ...rejected];
      if (s) {
        const a = r.awarded, b = s.awarded;
        a.xp += b.xp; for (const k of ['badges', 'quests', 'certificates', 'unlocks']) a[k] = [...a[k], ...b[k]];
        a.rankUp = b.rankUp || a.rankUp;
      }
      return r;
    },
  };
}

export const ROUTES = {
  'GET /api/content/packs': listPacks,
};
export const PATTERNS = [
  ['GET', /^\/api\/content\/packs\/([a-z0-9-]{1,40})$/, ['id'], getPack],
];
export async function cron(env, ctx, kind) {}
