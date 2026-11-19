// Notices for learners (docs/ADMIN-PHASE-4.md §5): short messages from the TypeCraft team, shown under the
// website's header and at the top of the trainer's home screen. They are written in the admin console
// (Notifications, src/console/notices-api.js) and kept in site_notices (migration 0010).
//
//   GET /api/notices?place=site|trainer   the notices for whoever asks (signed in or not), minus the ones
//                                          this browser closed (the tc_nd cookie, which the site shares)
//
// Website pages get theirs while the page is drawn (src/site.js, src/layout.js), with no extra request.
// The list is read at most once a minute per Worker; a change in the console clears it on that Worker.
import { json, nowIso } from './http.js';
import { remember, PUBLIC_DATA_TTL } from './memo.js';
import { getSession } from './session.js';
import { entitlementsFor } from './entitlements.js';

export const DISMISS_COOKIE = 'tc_nd';
export const MAX_SHOWN = 2;
const ID_RE = /^ntc_[a-z0-9]{6,24}$/;

async function loadLive(env) {
  try {
    const rows = (await env.DB.prepare(`SELECT id, message, link_url, link_label, tone, audience, place, starts_at, ends_at FROM site_notices
                                         WHERE active = 1 AND (ends_at IS NULL OR ends_at > ?1)
                                         ORDER BY COALESCE(starts_at, created_at) DESC, id LIMIT 20`).bind(nowIso()).all()).results;
    return rows.map((r) => ({ id: r.id, message: r.message, linkUrl: r.link_url || null, linkLabel: r.link_label || null, tone: r.tone,
      audience: r.audience, place: r.place, startsAt: r.starts_at || null, endsAt: r.ends_at || null }));
  } catch {
    return []; // before migration 0010 (or the database is busy): no notices, and the page is drawn as usual
  }
}

/** Every notice that is switched on and not over yet (remembered for a minute). */
export function liveNotices(env) {
  if (!env || !env.DB) return Promise.resolve([]);
  return remember(env, 'notices', PUBLIC_DATA_TTL, () => loadLive(env)).catch(() => []);
}

function fits(audience, viewer) {
  switch (audience) {
    case 'guests': return !viewer.signedIn;
    case 'signed_in': return viewer.signedIn;
    case 'free': return viewer.signedIn && !viewer.paid;
    case 'paid': return viewer.signedIn && viewer.paid;
    default: return true;
  }
}

/** The notices to show in one place (site | trainer) to one viewer ({ signedIn, paid }), newest first. */
export function pickNotices(list, viewer, place, dismissed = new Set(), now = Date.now()) {
  return (list || []).filter((n) => (n.place === 'both' || n.place === place)
    && (!n.startsAt || Date.parse(n.startsAt) <= now) && (!n.endsAt || Date.parse(n.endsAt) > now)
    && fits(n.audience, viewer) && !dismissed.has(n.id)).slice(0, MAX_SHOWN);
}

/** The notices this browser has closed, from the tc_nd cookie ("ntc_a.ntc_b"). */
export function dismissedFrom(request) {
  const header = (request && request.headers.get('Cookie')) || '';
  const m = header.match(/(?:^|;\s*)tc_nd=([^;]*)/);
  if (!m) return new Set();
  return new Set(decodeURIComponent(m[1]).split('.').filter((id) => ID_RE.test(id)).slice(-20));
}

/** What a viewer is, from the entitlements the page already has: paid = an active plan other than Free. */
export const viewerOf = (user, entitlements) => ({ signedIn: !!user, paid: !!(user && entitlements && entitlements.plan && entitlements.plan !== 'free') });

export const publicNotice = (n) => ({ id: n.id, message: n.message, linkUrl: n.linkUrl, linkLabel: n.linkLabel, tone: n.tone });

export async function getNotices(request, env) {
  const place = new URL(request.url).searchParams.get('place') === 'site' ? 'site' : 'trainer';
  const list = await liveNotices(env);
  let viewer = { signedIn: false, paid: false };
  // the viewer is looked up only when some notice depends on who they are
  if (list.some((n) => n.audience !== 'everyone')) {
    let s = null;
    try { s = await getSession(env, request); } catch { s = null; }
    if (s) viewer = viewerOf(s.user, await entitlementsFor(env, s.user.id).catch(() => null));
  }
  return json({ notices: pickNotices(list, viewer, place, dismissedFrom(request)).map(publicNotice) }, 200, { 'Cache-Control': 'private, no-store' });
}

export const ROUTES = { 'GET /api/notices': getNotices };
