// Rules for everyone about lessons and levels (docs/UNLOCK-RULES.md): a lesson or level closed
// for everyone or open to everyone, and when each level opens by progress. Kept as one JSON value
// in platform_settings under 'learning_rules' (that table exists since migration 0003, so no
// migration is needed). No row, or a value that cannot be read, means no rules: everything
// follows the plans, and every level is open from the start.
//
// Stored: { locks: [{ scope: 'level' | 'lesson', target: 3 | 'l40', effect: 'closed' | 'open',
//                     reason, by: userId, at: iso }],
//           progress: { '2': 'open' | 'bosses' | 'all', ... }, placement: true | false }
// Browsers only ever see projection(): no reasons and no staff ids.
import '../shared/course-meta.js';
import '../shared/lesson-access.js';
import { json } from './http.js';

const A = globalThis.TC_ACCESS;
export const RULES_KEY = 'learning_rules';
export const MAX_LOCKS = 200;

const parse = (text) => { try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const validLock = (l) => l && typeof l === 'object' && (l.effect === 'closed' || l.effect === 'open')
  && ((l.scope === 'level' && A.isLevel(l.target)) || (l.scope === 'lesson' && A.isLesson(l.target)));

/** The stored rules, cleaned: unknown or broken parts are dropped, so a bad value can only mean fewer rules. */
export function cleanStored(v) {
  v = v && typeof v === 'object' ? v : {};
  const seen = new Set(), locks = [];
  for (const l of Array.isArray(v.locks) ? v.locks : []) {
    if (!validLock(l)) continue;
    const key = l.scope + ':' + l.target;
    if (seen.has(key)) continue;                   // one rule per lesson or level
    seen.add(key);
    locks.push({ scope: l.scope, target: l.target, effect: l.effect, reason: typeof l.reason === 'string' ? l.reason.slice(0, 300) : '',
      by: typeof l.by === 'string' ? l.by : null, at: typeof l.at === 'string' ? l.at : null });
    if (locks.length >= MAX_LOCKS) break;
  }
  const clean = A.cleanRules({ progress: v.progress, placement: v.placement });
  return { locks, progress: clean.progress, placement: clean.placement };
}

/** What browsers see: { closed: { levels, lessons }, open: { levels, lessons }, progress, placement }. */
export function projection(stored) {
  const s = cleanStored(stored);
  const pick = (effect, scope) => s.locks.filter((l) => l.effect === effect && l.scope === scope).map((l) => l.target);
  return A.cleanRules({
    closed: { levels: pick('closed', 'level'), lessons: pick('closed', 'lesson') },
    open: { levels: pick('open', 'level'), lessons: pick('open', 'lesson') },
    progress: s.progress, placement: s.placement,
  });
}

/** The statement that reads the rules, for a DB.batch. Its row (or none) goes to fromRow(). */
export const rulesStatement = (env) => env.DB.prepare('SELECT value, updated_at FROM platform_settings WHERE key = ?1').bind(RULES_KEY);
export const fromRow = (row) => ({ stored: cleanStored(row ? parse(row.value) : null), updatedAt: row ? row.updated_at : null });

export async function loadRules(env) {
  try { return fromRow(await rulesStatement(env).first()); }
  catch { return fromRow(null); }
}

/* ---------- GET /api/learning-rules (public) ---------- */
// For the trainer without an account, and for everyone before their plan has loaded.
export async function getLearningRules(request, env) {
  const { stored } = await loadRules(env);
  return json({ rules: projection(stored) }, 200, { 'Cache-Control': 'public, max-age=60' });
}

export const ROUTES = { 'GET /api/learning-rules': getLearningRules };
