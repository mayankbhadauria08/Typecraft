// The published course edits (docs/ADMIN-PHASE-3.md §3): the highest version in course_releases.
// Before migration 0007, or with no version published, there are no edits: the course in code.
//
//   GET /api/course   public, 60 s cache: { version, edits } with lessons, levels and modules only.
//                     Practice packs are premium: they are served by src/content.js, behind the
//                     plan check, from packsFor() below.
import '../shared/course-meta.js';
import '../js/course.js';
import '../shared/course-edits.js';
import { json } from './http.js';
import { PACKS } from './content-packs.js';

const META = globalThis.TC_META;
const E = globalThis.TC_EDITS;
const parse = (text) => { try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const missingTable = (err) => /no such table/i.test(String(err && err.message));

/** The live course edits: { version, edits, publishedAt }. Edits that no longer check are dropped part by part. */
export async function loadCourse(env) {
  let row = null;
  try {
    row = await env.DB.prepare('SELECT version, edits, published_at FROM course_releases ORDER BY version DESC LIMIT 1').first();
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
  if (!row) return { version: 0, edits: {}, publishedAt: null };
  return { version: row.version, edits: E.check(parse(row.edits) || {}).edits, publishedAt: row.published_at };
}

/** What browsers may see without a plan check: no practice packs. */
export function publicEdits(edits) {
  const out = {};
  for (const k of ['lessons', 'levels', 'units']) if (edits[k] && Object.keys(edits[k]).length) out[k] = edits[k];
  return out;
}

export async function getCourse(request, env) {
  const { version, edits } = await loadCourse(env);
  return json({ version, edits: publicEdits(edits) }, 200, { 'Cache-Control': 'public, max-age=60' });
}

/* ---------- names, for pages the server draws ---------- */
export const lessonTitle = (edits, id) => (edits.lessons && edits.lessons[id] && edits.lessons[id].title) || (META.BY_ID[id] ? META.BY_ID[id].title : id);
export const levelName = (edits, n) => (edits.levels && edits.levels[String(n)] && edits.levels[String(n)].name) || (META.LEVELS.find((L) => L.n === n) || {}).name || `Level ${n}`;
export const levelSub = (edits, n) => (edits.levels && edits.levels[String(n)] && edits.levels[String(n)].sub) || (META.LEVELS.find((L) => L.n === n) || {}).sub || '';

/* ---------- practice packs ---------- */
/** The practice packs in code, as the editor and the merge read them. */
export const BASE_PACKS = PACKS.map((p) => ({ id: p.id, title: p.title, description: p.description, hidden: false,
  exercises: p.exercises.map((x) => ({ id: x.id, title: x.title, text: x.text, hidden: false })) }));
const BASE_BY_ID = Object.fromEntries(BASE_PACKS.map((p) => [p.id, p]));

/**
 * Every pack with the edits on top, in order: { id, title, description, hidden, added, edited, exercises }.
 * `all: false` (learners) leaves out hidden packs and hidden exercises.
 */
export function mergePacks(edits, { all = false } = {}) {
  const packs = (edits && edits.packs) || {};
  const ids = BASE_PACKS.map((p) => p.id).concat(Object.keys(packs).filter((id) => packs[id].added && !BASE_BY_ID[id]));
  const order = Array.isArray(edits && edits.packOrder) ? edits.packOrder.filter((id) => ids.includes(id)) : [];
  const sorted = order.concat(ids.filter((id) => !order.includes(id)));
  const out = [];
  for (const id of sorted) {
    const base = BASE_BY_ID[id], e = packs[id];
    if (!base && !(e && e.added)) continue;
    const p = e ? { id, title: e.title, description: e.description, hidden: !!e.hidden, added: !base, edited: true, exercises: e.exercises.map((x) => ({ ...x })) }
      : { ...base, added: false, edited: false, exercises: base.exercises.map((x) => ({ ...x })) };
    if (!all) {
      if (p.hidden) continue;
      p.exercises = p.exercises.filter((x) => !x.hidden);
      if (!p.exercises.length) continue;
    }
    out.push(p);
  }
  return out;
}

/** The packs learners get now. */
export async function packsFor(env) {
  return mergePacks((await loadCourse(env)).edits);
}

export const ROUTES = { 'GET /api/course': getCourse };
