// Learning access (docs/ADMIN-PHASE-2.md §9): one lesson or arcade game opened or closed for one
// customer, whatever their plan says. Console-only endpoints.
//
//   GET  /api/console/access                   access.view    list: q, state (active, ended), kind, effect, page
//   POST /api/console/customers/:id/access     access.manage  { kind: 'lesson' | 'game', target, effect: 'allow' | 'deny', days | null, reason }
//   POST /api/console/access/:id/end           access.manage  { reason? }
//
// What it does for the customer: entitlementsFor() in src/entitlements.js reads the exceptions in
// force; a closed one wins over the plan. The placement test, the review drill and the Daily
// Challenge are never closed, so they are not offered here.
import '../../shared/course-meta.js';
import '../../shared/rewards-rules.js';
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from '../http.js';
import { uuid } from '../crypto.js';
import { audit } from '../billing.js';
import { requireAdmin } from './session.js';
import { Binder, PAGE_SIZE, DAY_MS, pageOf, offsetOf, paged, like, oneOf, idParam, reasonOf, assertNotOwnAccount } from './lib.js';

const META = globalThis.TC_META;
// the arcade's names (they live in js/games/*.js, for the browser); the ids are the shared rules' list
const GAME_NAMES = { storm: 'Word Storm', beat: 'Beat Keys', tug: 'Tug-of-War', ghost: 'Ghost Race', pop: 'Key Pop', tower: 'Word Tower', safe: 'Safe Cracker', boss: 'Boss Battles' };
export const GAMES = globalThis.TC_RULES.GAMES.filter((g) => g !== 'daily');
export const MAX_ACTIVE = 50;

/** The lessons and games an exception can be about, in course order: [{ id, name }]. */
export const TARGETS = {
  lesson: META.LESSONS.map((l) => ({ id: l.id, name: `Lesson ${META.BY_ID[l.id].n}: ${l.title}` })),
  game: GAMES.map((g) => ({ id: g, name: GAME_NAMES[g] || g })),
};
const NAMES = { lesson: new Map(TARGETS.lesson.map((t) => [t.id, t.name])), game: new Map(TARGETS.game.map((t) => [t.id, t.name])) };
export const targetName = (kind, id) => (NAMES[kind] && NAMES[kind].get(id)) || id;

/** active: in force; expired: its days ran out; ended: someone ended it. */
const stateOf = (a, now) => (a.ended_at ? 'ended' : a.expires_at && a.expires_at <= now ? 'expired' : 'active');
export const accessView = (a, now) => ({
  id: a.id, kind: a.kind, target: a.target, targetName: targetName(a.kind, a.target), effect: a.effect, reason: a.reason,
  state: stateOf(a, now), expiresAt: a.expires_at, createdAt: a.created_at, createdBy: a.creator || null, endedAt: a.ended_at, endedBy: a.ender || null,
});
export const ACCESS_SELECT = `SELECT a.*, c.full_name AS creator, e.full_name AS ender FROM access_overrides a
  LEFT JOIN users c ON c.id = a.created_by LEFT JOIN users e ON e.id = a.ended_by`;

/* ---------- the list ---------- */
function whereOf(b, q, now) {
  const where = [];
  const term = (q.get('q') || '').trim().slice(0, 80);
  if (term) {
    const parts = [`u.email LIKE ${b.p(like(term.toLowerCase()))} ESCAPE '\\'`, `u.full_name LIKE ${b.p(like(term))} ESCAPE '\\'`];
    if (/^[\w-]{6,64}$/.test(term)) parts.push(`a.user_id = ${b.p(term)}`);
    where.push(`(${parts.join(' OR ')})`);
  }
  const state = oneOf(q.get('state'), ['active', 'ended']);
  if (state === 'active') where.push(`a.ended_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > ${b.once('now', now)})`);
  if (state === 'ended') where.push(`(a.ended_at IS NOT NULL OR a.expires_at <= ${b.once('now', now)})`);
  const kind = oneOf(q.get('kind'), ['lesson', 'game']);
  if (kind) where.push(`a.kind = ${b.p(kind)}`);
  const effect = oneOf(q.get('effect'), ['allow', 'deny']);
  if (effect) where.push(`a.effect = ${b.p(effect)}`);
  return where.length ? 'WHERE ' + where.join(' AND ') : '';
}

export async function getAccess(request, env) {
  await requireAdmin(env, request, 'access.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q), now = nowIso(), DB = env.DB;
  const list = new Binder(), count = new Binder();
  const listWhere = whereOf(list, q, now), countWhere = whereOf(count, q, now);
  const [rows, total] = await DB.batch([
    DB.prepare(`SELECT a.*, c.full_name AS creator, e.full_name AS ender, u.full_name, u.email
                  FROM access_overrides a JOIN users u ON u.id = a.user_id LEFT JOIN users c ON c.id = a.created_by LEFT JOIN users e ON e.id = a.ended_by
                  ${listWhere} ORDER BY a.created_at DESC, a.id LIMIT ${PAGE_SIZE} OFFSET ${offsetOf(page)}`).bind(...list.args),
    DB.prepare(`SELECT COUNT(*) AS n FROM access_overrides a JOIN users u ON u.id = a.user_id ${countWhere}`).bind(...count.args),
  ]);
  const items = rows.results.map((a) => ({ ...accessView(a, now), customer: { id: a.user_id, fullName: a.full_name, email: a.email } }));
  return json(paged(items, page, total.results[0].n));
}

/* ---------- adding and ending ---------- */
/** Opens or closes a lesson or game for one customer. An exception they already have for it is replaced. */
export async function postAccess(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'access.manage');
  const DB = env.DB;
  const u = await DB.prepare('SELECT id FROM users WHERE id = ?1').bind(idParam(params.id, 'Customer not found.')).first();
  if (!u) throw new HttpError(404, 'not_found', 'Customer not found.');
  assertNotOwnAccount(who, u.id);
  const body = await readJson(request);
  const kind = oneOf(body.kind, ['lesson', 'game'], null);
  if (!kind) throw fieldError({ kind: 'Choose a lesson or a game.' });
  const target = typeof body.target === 'string' && NAMES[kind].has(body.target) ? body.target : null;
  if (!target) throw fieldError({ target: kind === 'lesson' ? 'Choose a lesson from the course.' : 'Choose one of the arcade games.' });
  const effect = oneOf(body.effect, ['allow', 'deny'], null);
  if (!effect) throw fieldError({ effect: 'Choose whether to open it or close it.' });
  let days = null;
  if (body.days != null) {
    if (!Number.isInteger(body.days) || body.days < 1 || body.days > 365) throw fieldError({ days: 'Enter a whole number of days from 1 to 365, or leave it empty.' });
    days = body.days;
  }
  const reason = reasonOf(body);
  const now = nowIso();
  const inForce = `user_id = ?1 AND ended_at IS NULL AND (expires_at IS NULL OR expires_at > ?2)`;
  const [count, same] = await DB.batch([
    DB.prepare(`SELECT COUNT(*) AS n FROM access_overrides WHERE ${inForce}`).bind(u.id, now),
    DB.prepare(`SELECT id, effect FROM access_overrides WHERE ${inForce} AND kind = ?3 AND target = ?4`).bind(u.id, now, kind, target),
  ]);
  const replacing = same.results;
  if (count.results[0].n - replacing.length >= MAX_ACTIVE) {
    throw new HttpError(400, 'too_many', `A customer can have at most ${MAX_ACTIVE} exceptions in force. End some first.`);
  }
  const id = uuid();
  const expires = days == null ? null : new Date(Date.parse(now) + days * DAY_MS).toISOString();
  await DB.batch([
    ...replacing.map((r) => DB.prepare('UPDATE access_overrides SET ended_at = ?2, ended_by = ?3 WHERE id = ?1 AND ended_at IS NULL').bind(r.id, now, who.user.id)),
    DB.prepare(`INSERT INTO access_overrides (id, user_id, kind, target, effect, reason, expires_at, created_by, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`).bind(id, u.id, kind, target, effect, reason, expires, who.user.id, now),
  ]);
  await audit(env, { actorId: who.user.id, action: 'access.add', target: `user:${u.id}`,
    detail: { accessId: id, kind, item: target, effect, days, replaced: replacing.map((r) => r.id), reason }, ip: clientIp(request) });
  const row = await DB.prepare(`${ACCESS_SELECT} WHERE a.id = ?1`).bind(id).first();
  return json({ access: accessView(row, now), replaced: replacing.length }, 201);
}

export async function postAccessEnd(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'access.manage');
  const DB = env.DB;
  const a = await DB.prepare('SELECT * FROM access_overrides WHERE id = ?1').bind(idParam(params.id, 'Exception not found.')).first();
  if (!a) throw new HttpError(404, 'not_found', 'Exception not found.');
  assertNotOwnAccount(who, a.user_id);
  const body = await readJson(request);
  const reason = reasonOf(body, { required: false });
  const now = nowIso();
  if (stateOf(a, now) !== 'active') throw new HttpError(400, 'not_active', 'This exception is no longer in force.');
  const r = await DB.prepare('UPDATE access_overrides SET ended_at = ?2, ended_by = ?3 WHERE id = ?1 AND ended_at IS NULL').bind(a.id, now, who.user.id).run();
  if (r.meta.changes !== 1) throw new HttpError(409, 'conflict', 'This exception changed a moment ago. Reload the page and try again.');
  await audit(env, { actorId: who.user.id, action: 'access.end', target: `user:${a.user_id}`,
    detail: { accessId: a.id, kind: a.kind, item: a.target, effect: a.effect, ...(reason ? { reason } : {}) }, ip: clientIp(request) });
  const row = await DB.prepare(`${ACCESS_SELECT} WHERE a.id = ?1`).bind(a.id).first();
  return json({ access: accessView(row, now) });
}

export const ROUTES = {
  'GET /api/console/access': getAccess,
};
export const PATTERNS = [
  ['POST', /^\/api\/console\/customers\/([\w-]{1,64})\/access$/, ['id'], postAccess],
  ['POST', /^\/api\/console\/access\/([\w-]{1,64})\/end$/, ['id'], postAccessEnd],
];
