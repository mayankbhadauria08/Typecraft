// Notifications: the notices learners see (docs/ADMIN-PHASE-4.md §5). Console-only endpoints: a console session is required.
//
//   GET    /api/console/notices          notices.view    list: status (live | scheduled | ended | off), page
//   POST   /api/console/notices          notices.manage  { message, linkUrl, linkLabel, tone, audience, place, startsAt, endsAt }
//   PUT    /api/console/notices/:id      notices.manage  the same fields, or only { active: true | false }
//   DELETE /api/console/notices/:id      notices.manage
//
// Learners get them from src/notices.js. A change here clears the remembered list on this Worker
// (src/index.js forgets after every console change); other Workers catch up within a minute.
import { HttpError, json, readJson, fieldError, clientIp, nowIso } from '../http.js';
import { uuid } from '../crypto.js';
import { audit } from '../billing.js';
import { requireAdmin } from './session.js';
import { can } from './permissions.js';
import { Binder, PAGE_SIZE, DAY_MS, pageOf, offsetOf, paged, oneOf, idParam } from './lib.js';

export const TONES = { info: 'Information', offer: 'Offer', warning: 'Warning' };
export const AUDIENCES = { everyone: 'Everyone', guests: 'People who are not signed in', signed_in: 'Everyone signed in', free: 'Signed in, on Free', paid: 'Signed in, with a paid plan' };
export const PLACES = { both: 'Website and trainer', site: 'Website only', trainer: 'Trainer only' };
const STATES = ['live', 'scheduled', 'ended', 'off'];
const MESSAGE_MAX = 200, LABEL_MAX = 30, URL_MAX = 300;

const stateOf = (r, now) => (!r.active ? 'off' : r.ends_at && r.ends_at <= now ? 'ended' : r.starts_at && r.starts_at > now ? 'scheduled' : 'live');
function shape(r, now) {
  return { id: r.id, message: r.message, linkUrl: r.link_url || null, linkLabel: r.link_label || null, tone: r.tone, toneLabel: TONES[r.tone],
    audience: r.audience, audienceLabel: AUDIENCES[r.audience], place: r.place, placeLabel: PLACES[r.place],
    startsAt: r.starts_at || null, endsAt: r.ends_at || null, active: !!r.active, state: stateOf(r, now),
    createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_name || null };
}
function stateWhere(b, state, now) {
  const n = b.once('now', now);
  switch (state) {
    case 'off': return 'n.active = 0';
    case 'ended': return `n.active = 1 AND n.ends_at IS NOT NULL AND n.ends_at <= ${n}`;
    case 'scheduled': return `n.active = 1 AND n.starts_at IS NOT NULL AND n.starts_at > ${n} AND (n.ends_at IS NULL OR n.ends_at > ${n})`;
    case 'live': return `n.active = 1 AND (n.starts_at IS NULL OR n.starts_at <= ${n}) AND (n.ends_at IS NULL OR n.ends_at > ${n})`;
    default: return '';
  }
}

export async function getNoticesList(request, env) {
  const who = await requireAdmin(env, request, 'notices.view');
  const q = new URL(request.url).searchParams;
  const page = pageOf(q), DB = env.DB, now = nowIso();
  const state = oneOf(q.get('status'), STATES);
  const list = new Binder(), count = new Binder();
  const lw = state ? 'WHERE ' + stateWhere(list, state, now) : '', cw = state ? 'WHERE ' + stateWhere(count, state, now) : '';
  const [rows, total] = await DB.batch([
    DB.prepare(`SELECT n.*, u.full_name AS updated_name FROM site_notices n LEFT JOIN users u ON u.id = n.updated_by ${lw}
                 ORDER BY n.active DESC, COALESCE(n.starts_at, n.created_at) DESC, n.id LIMIT ${PAGE_SIZE} OFFSET ${offsetOf(page)}`).bind(...list.args),
    DB.prepare(`SELECT COUNT(*) AS n FROM site_notices n ${cw}`).bind(...count.args),
  ]);
  return json({ ...paged(rows.results.map((r) => shape(r, now)), page, total.results[0].n),
    tones: TONES, audiences: AUDIENCES, places: PLACES, can: { manage: await can(env, who.role, 'notices.manage') } });
}

/* ---------- input ---------- */
const oneLine = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '');
function linkOf(v) {
  const s = oneLine(v);
  if (!s) return { value: null };
  if (s.length > URL_MAX) return { error: `Keep the address under ${URL_MAX} characters.` };
  if (/^\/(?!\/)[^\s]*$/.test(s)) return { value: s };
  try {
    const u = new URL(s);
    if (u.protocol === 'https:') return { value: u.toString() };
  } catch { /* falls through */ }
  return { error: 'Use a page on this site (like /pricing) or an address starting with https://.' };
}
function timeOf(v, field, fields) {
  if (v == null || v === '') return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) { fields[field] = 'Choose a date and time.'; return null; }
  return new Date(t).toISOString();
}
function noticeFrom(body, { creating }) {
  const fields = {};
  const message = oneLine(body.message);
  if (message.length < 3) fields.message = 'Write the message.'; else if (message.length > MESSAGE_MAX) fields.message = `Keep it under ${MESSAGE_MAX} characters, so it fits on one line.`;
  const link = linkOf(body.linkUrl);
  if (link.error) fields.linkUrl = link.error;
  let label = oneLine(body.linkLabel);
  if (label.length > LABEL_MAX) fields.linkLabel = `Keep the link text under ${LABEL_MAX} characters.`;
  if (label && !link.value && !link.error) fields.linkUrl = 'Add the address the link goes to, or clear the link text.';
  if (link.value && !label) label = 'Find out more';
  const tone = TONES[body.tone] ? body.tone : (body.tone == null || body.tone === '' ? 'info' : null);
  if (!tone) fields.tone = 'Choose information, offer or warning.';
  const audience = AUDIENCES[body.audience] ? body.audience : null;
  if (!audience) fields.audience = 'Choose who sees it.';
  const place = PLACES[body.place] ? body.place : null;
  if (!place) fields.place = 'Choose where it shows.';
  const startsAt = timeOf(body.startsAt, 'startsAt', fields), endsAt = timeOf(body.endsAt, 'endsAt', fields);
  if (startsAt && endsAt && endsAt <= startsAt) fields.endsAt = 'Make it end after it starts.';
  else if (endsAt && Date.parse(endsAt) <= Date.now() && creating) fields.endsAt = 'Choose an end time that is still to come.';
  if (startsAt && Date.parse(startsAt) > Date.now() + 365 * DAY_MS) fields.startsAt = 'Choose a start within the next year.';
  if (Object.keys(fields).length) throw fieldError(fields);
  return { message, linkUrl: link.value, linkLabel: link.value ? label : null, tone, audience, place, startsAt, endsAt };
}

const log = (env, who, action, id, detail, request) =>
  audit(env, { actorId: who.user.id, action, target: `notice:${id}`, detail, ip: clientIp(request) });

export async function postNotice(request, env) {
  const who = await requireAdmin(env, request, 'notices.manage');
  const n = noticeFrom(await readJson(request, 8 * 1024), { creating: true });
  const id = `ntc_${uuid().replace(/-/g, '').slice(0, 12)}`, now = nowIso();
  await env.DB.prepare(`INSERT INTO site_notices (id, message, link_url, link_label, tone, audience, place, starts_at, ends_at, active, created_by, updated_by, created_at, updated_at)
                        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10, ?11, ?11)`)
    .bind(id, n.message, n.linkUrl, n.linkLabel, n.tone, n.audience, n.place, n.startsAt, n.endsAt, who.user.id, now).run();
  await log(env, who, 'notice.create', id, { audience: n.audience, place: n.place }, request);
  const row = await env.DB.prepare('SELECT * FROM site_notices WHERE id = ?1').bind(id).first();
  const s = shape(row, now);
  return json({ notice: s, message: s.state === 'live' ? 'Showing now.' : 'Saved. It shows from the start time.' }, 201);
}

async function noticeRow(env, id) {
  const row = await env.DB.prepare('SELECT * FROM site_notices WHERE id = ?1').bind(idParam(id, 'Notification not found.')).first();
  if (!row) throw new HttpError(404, 'not_found', 'Notification not found.');
  return row;
}

export async function putNotice(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'notices.manage');
  const body = await readJson(request, 8 * 1024);
  const row = await noticeRow(env, params.id);
  const now = nowIso();
  if (Object.keys(body).length === 1 && typeof body.active === 'boolean') {
    await env.DB.prepare('UPDATE site_notices SET active = ?2, updated_by = ?3, updated_at = ?4 WHERE id = ?1').bind(row.id, body.active ? 1 : 0, who.user.id, now).run();
    await log(env, who, body.active ? 'notice.on' : 'notice.off', row.id, null, request);
  } else {
    const n = noticeFrom(body, { creating: false });
    await env.DB.prepare(`UPDATE site_notices SET message = ?2, link_url = ?3, link_label = ?4, tone = ?5, audience = ?6, place = ?7, starts_at = ?8, ends_at = ?9,
                                 updated_by = ?10, updated_at = ?11 WHERE id = ?1`)
      .bind(row.id, n.message, n.linkUrl, n.linkLabel, n.tone, n.audience, n.place, n.startsAt, n.endsAt, who.user.id, now).run();
    await log(env, who, 'notice.update', row.id, { audience: n.audience, place: n.place }, request);
  }
  const after = await env.DB.prepare('SELECT * FROM site_notices WHERE id = ?1').bind(row.id).first();
  const s = shape(after, now);
  return json({ notice: s, message: !s.active ? 'Turned off. Learners no longer see it.' : s.state === 'live' ? 'Saved. Showing now.' : s.state === 'ended' ? 'Saved. Its end time has passed, so it isn\'t showing.' : 'Saved. It shows from the start time.' });
}

export async function deleteNotice(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'notices.manage');
  const row = await noticeRow(env, params.id);
  await env.DB.prepare('DELETE FROM site_notices WHERE id = ?1').bind(row.id).run();
  await log(env, who, 'notice.delete', row.id, { message: row.message.slice(0, 60) }, request);
  return json({ deleted: true, message: 'Deleted.' });
}

export const ROUTES = {
  'GET /api/console/notices': getNoticesList,
  'POST /api/console/notices': postNotice,
};
export const PATTERNS = [
  ['PUT', /^\/api\/console\/notices\/(ntc_[a-z0-9]{6,24})$/, ['id'], putNotice],
  ['DELETE', /^\/api\/console\/notices\/(ntc_[a-z0-9]{6,24})$/, ['id'], deleteNotice],
];
