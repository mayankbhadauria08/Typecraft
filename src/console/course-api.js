// The course (docs/ADMIN-PHASE-3.md): lessons, levels, modules and practice packs, edited as drafts
// and published as numbered versions.
//
//   GET    /api/console/course                      course.view     the course: version, drafts waiting, versions, levels, modules
//   GET    /api/console/course/lessons              course.view     every lesson with its state (edited, draft)
//   GET    /api/console/course/lessons/:id          course.view     one lesson: original, published, draft, keys it may use
//   GET    /api/console/course/packs                course.view     every practice pack with its state
//   PUT    /api/console/course/drafts/:item         course.edit     { value }: the item as it should become ({ reset: true }: the original)
//   DELETE /api/console/course/drafts/:item         course.edit     discard the draft
//   POST   /api/console/course/publish              course.publish  { note, drafts: [{ item, updatedAt }] } → a new version
//   GET    /api/console/course/versions/:v          course.view     what one version changed
//   POST   /api/console/course/versions/:v/restore  course.publish  { note } → a new version with that version's edits
//
// Items: lesson:<id>, level:<n>, unit:<id>, pack:<id>, order:packs. The server never applies edits
// to its own copy of the course (TC_COURSE stays the original); it reads them.
import '../../shared/course-meta.js';
import '../../js/course.js';
import '../../shared/course-edits.js';
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from '../http.js';
import { audit } from '../billing.js';
import { loadCourse, mergePacks, BASE_PACKS } from '../course-store.js';
import { requireAdmin } from './session.js';
import { permissionsFor } from './permissions.js';
import { parseJson } from './lib.js';

const META = globalThis.TC_META, C = globalThis.TC_COURSE, E = globalThis.TC_EDITS;
const KIND = { lesson: 'lessons', level: 'levels', unit: 'units', pack: 'packs' };
const NOTE_MAX = 300;

/* ---------- items ---------- */
/** 'lesson:l7' → { kind: 'lesson', key: 'l7', part: 'lessons' }, or null when it names nothing. */
export function itemOf(item) {
  if (item === 'order:packs') return { kind: 'order', key: 'packs', part: 'packOrder' };
  const m = /^(lesson|level|unit|pack):([a-z0-9-]{1,40})$/.exec(String(item || ''));
  if (!m) return null;
  const [, kind, key] = m;
  if (kind === 'lesson' && !META.BY_ID[key]) return null;
  if (kind === 'level' && !META.LEVELS.some((L) => String(L.n) === key)) return null;
  if (kind === 'unit' && !E.UNITS.includes(key)) return null;
  return { kind, key, part: KIND[kind] };
}
const originalPack = (id) => BASE_PACKS.find((p) => p.id === id) || null;

/** The words a person reads for an item. */
function itemName(item, edits = {}) {
  const it = itemOf(item);
  if (!it) return item;
  if (it.kind === 'lesson') return `Lesson ${META.BY_ID[it.key].n}: ${(edits.lessons && edits.lessons[it.key] && edits.lessons[it.key].title) || META.BY_ID[it.key].title}`;
  if (it.kind === 'level') return `Level ${it.key}: ${(edits.levels && edits.levels[it.key] && edits.levels[it.key].name) || META.LEVELS.find((L) => String(L.n) === it.key).name}`;
  if (it.kind === 'unit') return `Module: ${(edits.units && edits.units[it.key] && edits.units[it.key].name) || E.unitName(it.key)}`;
  if (it.kind === 'pack') { const p = (edits.packs && edits.packs[it.key]) || originalPack(it.key); return `Practice pack: ${p ? p.title : it.key}`; }
  return 'The order of the practice packs';
}

/** Puts one item's value into a copy of the edits ({ reset: true } removes it). */
export function withItem(edits, item, value) {
  const it = itemOf(item), out = JSON.parse(JSON.stringify(edits || {}));
  if (it.kind === 'order') {
    if (value && value.reset) delete out.packOrder; else out.packOrder = value.order;
    return out;
  }
  out[it.part] = out[it.part] || {};
  if (value && value.reset) delete out[it.part][it.key];
  else out[it.part][it.key] = value;
  if (!Object.keys(out[it.part]).length) delete out[it.part];
  return out;
}

/** Checks one item's value on its own. → the cleaned value, or throws 400 with the problems by field. */
function checkItem(item, value) {
  const it = itemOf(item);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fieldError({ value: 'Send the changes as an object.' });
  if (value.reset) {
    if (Object.keys(value).length !== 1) throw fieldError({ value: 'Back to the original takes no other changes.' });
    return { reset: true };
  }
  if (it.kind === 'order') {
    const r = E.check({ packOrder: value.order });
    if (!r.ok || Object.keys(value).length !== 1) throw fieldError({ order: (r.errors[0] && r.errors[0].message) || 'Send the order as a list of pack IDs.' });
    return { order: r.edits.packOrder };
  }
  if (it.kind === 'pack' && !originalPack(it.key) && !value.added) throw fieldError({ value: 'A new pack is marked as added.' });
  if (it.kind === 'pack' && originalPack(it.key) && value.added) throw fieldError({ value: 'This pack is one of the original packs.' });
  const r = E.check({ [it.part]: { [it.key]: value } });
  if (!r.ok) {
    const fields = {};
    for (const e of r.errors) fields[e.field || 'value'] = fields[e.field || 'value'] || e.message;
    throw fieldError(fields);
  }
  const clean = r.edits[it.part] && r.edits[it.part][it.key];
  if (!clean || (it.kind !== 'pack' && !Object.keys(clean).length)) throw fieldError({ value: 'Nothing to change: to go back to the original, use Back to the original.' });
  return clean;
}

/* ---------- reading ---------- */
async function drafts(env) {
  const rows = (await env.DB.prepare(`SELECT d.item, d.value, d.updated_by, d.updated_at, u.full_name AS by_name, u.email AS by_email
      FROM course_drafts d LEFT JOIN users u ON u.id = d.updated_by ORDER BY d.updated_at DESC`).all()).results;
  return rows.filter((r) => itemOf(r.item)).map((r) => ({ item: r.item, value: parseJson(r.value, {}), updatedAt: r.updated_at, by: r.by_name || r.by_email || 'Deleted account' }));
}
async function can(env, who) {
  const perms = await permissionsFor(env, who.role);
  return { edit: perms.includes('course.edit'), publish: perms.includes('course.publish'), audit: perms.includes('audit.view') };
}
const draftOf = (list, item) => list.find((d) => d.item === item) || null;
const stateOf = (published, draft) => ({ edited: !!published, draft: draft ? (draft.value.reset ? 'reset' : 'changed') : null, draftAt: draft ? draft.updatedAt : null, draftBy: draft ? draft.by : null });

function originalLesson(id) {
  const l = C.byId(id);
  return { title: l.title, tip: l.watch ? l.watch.note : '', keys: l.charDrill || '', words: (l.wordDrill || []).slice(), sentences: [l.paragraphDrill].concat(l.paragraphs || []).filter(Boolean) };
}

export async function getCourse(request, env) {
  const who = await requireAdmin(env, request, 'course.view');
  const [course, list, versions] = await Promise.all([
    loadCourse(env), drafts(env),
    env.DB.prepare(`SELECT r.version, r.items, r.note, r.published_at, u.full_name AS by_name, u.email AS by_email
      FROM course_releases r LEFT JOIN users u ON u.id = r.published_by ORDER BY r.version DESC LIMIT 50`).all(),
  ]);
  const ed = course.edits;
  return json({
    version: course.version, publishedAt: course.publishedAt,
    drafts: list.map((d) => ({ item: d.item, name: itemName(d.item, withItem(ed, d.item, d.value.reset ? { reset: true } : d.value)), reset: !!d.value.reset, updatedAt: d.updatedAt, by: d.by })),
    versions: versions.results.map((v) => ({ version: v.version, note: v.note || '', changed: parseJson(v.items, []).length, at: v.published_at, by: v.by_name || v.by_email || 'Deleted account' })),
    levels: META.LEVELS.map((L) => {
      const pub = ed.levels && ed.levels[String(L.n)], d = draftOf(list, 'level:' + L.n);
      return { n: L.n, original: { name: L.name, sub: L.sub }, published: pub || null, draftValue: d ? d.value : null, ...stateOf(pub, d),
        target: L.target, lessons: META.LESSONS.filter((l) => l.level === L.n).length };
    }),
    units: E.UNITS.map((u) => {
      const pub = ed.units && ed.units[u], d = draftOf(list, 'unit:' + u), ls = META.LESSONS.filter((l) => l.unit === u);
      return { id: u, original: { name: E.unitName(u) }, published: pub || null, draftValue: d ? d.value : null, ...stateOf(pub, d),
        levels: [...new Set(ls.map((l) => l.level))], lessons: ls.length };
    }),
    can: await can(env, who),
  });
}

export async function getLessons(request, env) {
  const who = await requireAdmin(env, request, 'course.view');
  const [course, list] = await Promise.all([loadCourse(env), drafts(env)]);
  const ed = course.edits;
  return json({
    items: META.LESSONS.map((m) => {
      const pub = ed.lessons && ed.lessons[m.id], d = draftOf(list, 'lesson:' + m.id);
      return { id: m.id, n: META.BY_ID[m.id].n, title: (pub && pub.title) || m.title, originalTitle: m.title, level: m.level, unit: m.unit, kind: m.kind,
        steps: C.steps(C.byId(m.id)), fields: E.fieldsOf(m.id), ...stateOf(pub, d) };
    }),
    levels: META.LEVELS.map((L) => ({ n: L.n, name: (ed.levels && ed.levels[String(L.n)] && ed.levels[String(L.n)].name) || L.name })),
    units: Object.fromEntries(E.UNITS.map((u) => [u, (ed.units && ed.units[u] && ed.units[u].name) || E.unitName(u)])),
    drafts: list.length,
    can: await can(env, who),
  });
}

export async function getLesson(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'course.view');
  if (!META.BY_ID[params.id]) throw new HttpError(404, 'not_found', 'There is no lesson with this ID.');
  const id = params.id, m = META.BY_ID[id], l = C.byId(id);
  const [course, list] = await Promise.all([loadCourse(env), drafts(env)]);
  const pub = (course.edits.lessons && course.edits.lessons[id]) || null, d = draftOf(list, 'lesson:' + id);
  const at = META.ORDER.indexOf(id);
  return json({
    lesson: {
      id, n: m.n, level: m.level, unit: m.unit, kind: m.kind, steps: C.steps(l), fields: E.fieldsOf(id),
      allowed: [...l.allowed].join(''), shift: !!l.allowShift, ownWords: !!(l.ownWords || l.isReview), newKeys: l.teach || '',
      original: originalLesson(id), published: pub, draftValue: d ? d.value : null, ...stateOf(pub, d),
      prev: at > 0 ? META.ORDER[at - 1] : null, next: at < META.ORDER.length - 1 ? META.ORDER[at + 1] : null,
    },
    levelName: (course.edits.levels && course.edits.levels[String(m.level)] && course.edits.levels[String(m.level)].name) || META.LEVELS.find((L) => L.n === m.level).name,
    unitName: (course.edits.units && course.edits.units[m.unit] && course.edits.units[m.unit].name) || E.unitName(m.unit),
    can: await can(env, who),
  });
}

export async function getPacks(request, env) {
  const who = await requireAdmin(env, request, 'course.view');
  const [course, list] = await Promise.all([loadCourse(env), drafts(env)]);
  const order = draftOf(list, 'order:packs');
  return json({
    items: mergePacks(course.edits, { all: true }).map((p) => {
      const d = draftOf(list, 'pack:' + p.id);
      return { ...p, original: originalPack(p.id), ...stateOf(p.edited ? p : null, d), draftValue: d ? d.value : null };
    }),
    // packs that exist only as a draft so far
    drafted: list.filter((d) => d.item.startsWith('pack:') && !d.value.reset && d.value.added && !mergePacks(course.edits, { all: true }).some((p) => 'pack:' + p.id === d.item))
      .map((d) => ({ id: d.item.slice(5), ...d.value, draft: 'changed', draftAt: d.updatedAt, draftBy: d.by })),
    order: order ? order.value : null,
    can: await can(env, who),
  });
}

/* ---------- drafts ---------- */
export async function putDraft(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'course.edit');
  const item = decodeURIComponent(params.item);
  if (!itemOf(item)) throw new HttpError(404, 'not_found', 'There is nothing to change with this name.');
  const body = await readJson(request, 512 * 1024);   // a practice pack can be long
  const value = checkItem(item, body.value);
  if (value.reset) {
    // back to the original only makes sense when something is published for it
    const { edits } = await loadCourse(env), it = itemOf(item);
    const published = it.kind === 'order' ? edits.packOrder : edits[it.part] && edits[it.part][it.key];
    if (!published) {
      await env.DB.prepare('DELETE FROM course_drafts WHERE item = ?1').bind(item).run();
      return json({ item, draft: null, note: 'It is already the original.' });
    }
  }
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO course_drafts (item, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT (item) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(item, JSON.stringify(value), who.user.id, now).run();
  await audit(env, { actorId: who.user.id, action: 'course.draft', target: item, detail: { name: itemName(item), reset: !!value.reset }, ip: clientIp(request) });
  return json({ item, draft: value, updatedAt: now });
}

export async function deleteDraft(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'course.edit');
  const item = decodeURIComponent(params.item);
  if (!itemOf(item)) throw new HttpError(404, 'not_found', 'There is nothing to change with this name.');
  const r = await env.DB.prepare('DELETE FROM course_drafts WHERE item = ?1').bind(item).run();
  if (!r.meta.changes) throw new HttpError(404, 'not_found', 'There is no draft for this.');
  await audit(env, { actorId: who.user.id, action: 'course.discard', target: item, detail: { name: itemName(item) }, ip: clientIp(request) });
  return json({ item, draft: null });
}

/* ---------- publishing ---------- */
const noteOf = (body) => {
  const t = typeof body.note === 'string' ? body.note.trim().replace(/\s+/g, ' ') : '';
  if (t.length < 3) throw fieldError({ note: 'Say in a few words what changed. Learners do not see it.' });
  if (t.length > NOTE_MAX) throw fieldError({ note: `Keep it under ${NOTE_MAX} characters.` });
  return t;
};
/** Writes a new version (one batch: the version, and the drafts it took). A version number taken meanwhile → 409. */
async function release(env, who, request, { edits, items, note, used = [] }) {
  const r = E.check(edits);
  if (!r.ok) {
    const e = r.errors[0];
    throw new HttpError(409, 'course_invalid', `${itemName(e.item)}: ${e.message}`);
  }
  const top = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM course_releases').first();
  const version = top.v + 1, now = nowIso();
  const stmts = [env.DB.prepare(`INSERT INTO course_releases (version, edits, items, note, published_by, published_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(version, JSON.stringify(r.edits), JSON.stringify(items), note, who.user.id, now)];
  for (const d of used) stmts.push(env.DB.prepare('DELETE FROM course_drafts WHERE item = ?1 AND updated_at = ?2').bind(d.item, d.updatedAt));
  try { await env.DB.batch(stmts); } catch (err) {
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(err && err.message))) throw new HttpError(409, 'course_changed', 'Someone else published a moment ago. The page now shows the latest version: check it, then publish again.');
    throw err;
  }
  return { version, at: now };
}

export async function postPublish(request, env) {
  const who = await requireAdmin(env, request, 'course.publish');
  const body = await readJson(request);
  const note = noteOf(body);
  const sent = Array.isArray(body.drafts) ? body.drafts : null;
  if (!sent || !sent.length) throw fieldError({ drafts: 'There are no drafts to publish.' });
  const [course, list] = await Promise.all([loadCourse(env), drafts(env)]);
  // publish exactly the drafts the page showed: a draft changed or added since then stops it
  const stale = sent.some((s) => { const d = draftOf(list, s && s.item); return !d || d.updatedAt !== s.updatedAt; }) || list.length !== sent.length;
  if (stale) throw new HttpError(409, 'drafts_changed', 'The drafts changed since this page was loaded. The page now shows them: check them, then publish again.');
  let edits = course.edits;
  for (const d of list) edits = withItem(edits, d.item, d.value);
  const out = await release(env, who, request, { edits, items: list.map((d) => d.item), note, used: list });
  await audit(env, { actorId: who.user.id, action: 'course.publish', target: `course:${out.version}`, detail: { items: list.map((d) => d.item), note }, ip: clientIp(request) });
  return json({ version: out.version, publishedAt: out.at, items: list.length });
}

export async function getVersion(request, env, ctx, params) {
  await requireAdmin(env, request, 'course.view');
  const v = Number(params.v);
  const row = await env.DB.prepare(`SELECT r.*, u.full_name AS by_name, u.email AS by_email FROM course_releases r LEFT JOIN users u ON u.id = r.published_by WHERE r.version = ?1`).bind(v).first();
  if (!row) throw new HttpError(404, 'not_found', 'There is no such version.');
  const edits = parseJson(row.edits, {}), items = parseJson(row.items, []);
  return json({ version: row.version, note: row.note || '', at: row.published_at, by: row.by_name || row.by_email || 'Deleted account',
    items: items.map((item) => ({ item, name: itemName(item, edits) })) });
}

export async function postRestore(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'course.publish');
  const body = await readJson(request);
  const note = noteOf(body);
  const v = Number(params.v);
  const [row, course] = await Promise.all([env.DB.prepare('SELECT version, edits FROM course_releases WHERE version = ?1').bind(v).first(), loadCourse(env)]);
  if (!row) throw new HttpError(404, 'not_found', 'There is no such version.');
  if (v === course.version) throw fieldError({ version: 'This is already the live version.' });
  const edits = E.check(parseJson(row.edits, {})).edits;
  // the items that differ between the live version and the one brought back
  const keys = (e) => [
    ...Object.keys(e.lessons || {}).map((k) => 'lesson:' + k), ...Object.keys(e.levels || {}).map((k) => 'level:' + k),
    ...Object.keys(e.units || {}).map((k) => 'unit:' + k), ...Object.keys(e.packs || {}).map((k) => 'pack:' + k), ...(e.packOrder ? ['order:packs'] : [])];
  const value = (e, item) => { const it = itemOf(item); return JSON.stringify(it.kind === 'order' ? e.packOrder : e[it.part] && e[it.part][it.key]); };
  const items = [...new Set(keys(edits).concat(keys(course.edits)))].filter((i) => itemOf(i) && value(edits, i) !== value(course.edits, i));
  const out = await release(env, who, request, { edits, items, note });
  await audit(env, { actorId: who.user.id, action: 'course.restore', target: `course:${out.version}`, detail: { from: v, items, note }, ip: clientIp(request) });
  return json({ version: out.version, publishedAt: out.at, items: items.length });
}

export const ROUTES = {
  'GET /api/console/course': getCourse,
  'GET /api/console/course/lessons': getLessons,
  'GET /api/console/course/packs': getPacks,
  'POST /api/console/course/publish': postPublish,
};
export const PATTERNS = [
  ['GET', /^\/api\/console\/course\/lessons\/(l\d{1,3})$/, ['id'], getLesson],
  ['PUT', /^\/api\/console\/course\/drafts\/([a-z]+(?::|%3A)[a-z0-9-]{1,40})$/i, ['item'], putDraft],
  ['DELETE', /^\/api\/console\/course\/drafts\/([a-z]+(?::|%3A)[a-z0-9-]{1,40})$/i, ['item'], deleteDraft],
  ['GET', /^\/api\/console\/course\/versions\/(\d{1,6})$/, ['v'], getVersion],
  ['POST', /^\/api\/console\/course\/versions\/(\d{1,6})\/restore$/, ['v'], postRestore],
];
