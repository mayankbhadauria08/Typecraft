// Serves the admin console's pages (docs/ADMIN-CONSOLE.md §5). Called by src/site.js for
// every address at or below CONSOLE_BASE.
//
//   /console/login   public; someone already signed in is sent on
//   everything else  needs a console session: without one, to the sign-in page;
//                    with one, the page if the role has its permission, else a "no access" page
//
// Hiding a page is a courtesy, not the protection: each API checks the session and the
// permission itself (./session.js).
import { readCookie } from '../http.js';
import { getAdminSession } from './session.js';
import { describe } from './auth.js';
import { renderShell, renderLogin, messageBody } from './shell.js';
import { findConsolePage } from './pages.js';
import { LAYERS } from './modules.js';
import { CONSOLE_BASE } from './config.js';

export const isConsolePath = (path) => path === CONSOLE_BASE || path.startsWith(CONSOLE_BASE + '/');

/** A console address from ?next= that is safe to send the browser to, or null. */
export function safeConsoleNext(value) {
  if (typeof value !== 'string' || !value || value.length > 300) return null;
  if (!/^\/[A-Za-z0-9\-._~/?&=%]*$/.test(value) || value.startsWith('//') || value.includes('..')) return null;
  const path = value.split('?')[0];
  if (!isConsolePath(path) || path === CONSOLE_BASE + '/login') return null;
  return value;
}

/** Which sidebar layers the person opened or closed themselves: the tc_console_nav cookie set by console.js ("core-open.infra-shut"). */
function navPrefs(request) {
  const out = {};
  for (const token of String(readCookie(request, 'tc_console_nav') || '').slice(0, 200).split('.')) {
    const m = token.match(/^([a-z]{1,20})-(open|shut)$/);
    if (m && LAYERS.some((l) => l.key === m[1])) out[m[1]] = m[2] === 'open';
  }
  return out;
}

// No inline scripts or styles anywhere in the console, and nothing loaded from other sites but the fonts.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function headers(url, extra = {}) {
  const h = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': CSP,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Vary': 'Cookie',
  });
  if (url.protocol === 'https:') h.set('Strict-Transport-Security', 'max-age=31536000');
  for (const [k, v] of Object.entries(extra)) if (v) h.set(k, v);
  return h;
}
/** False until migration 0005 has created the console's tables. */
async function consoleReady(env) {
  try { await env.DB.prepare('SELECT 1 FROM admin_sessions LIMIT 1').first(); return true; } catch (err) {
    if (/no such table/i.test(String(err && err.message))) return false;
    throw err;
  }
}
const html = (request, url, status, text) => new Response(request.method === 'HEAD' ? null : text, { status, headers: headers(url) });
const redirect = (url, location) => new Response(null, { status: 302, headers: headers(url, { Location: new URL(location, url).toString() }) });

export async function serveConsole(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  }
  let sub = url.pathname.slice(CONSOLE_BASE.length);
  if (sub.endsWith('/')) return redirect(url, CONSOLE_BASE + sub.replace(/\/+$/, '') + url.search);
  if (!env.DB) return html(request, url, 503, renderLogin({ notReady: true }));

  let who = null, notReady = false;
  try { who = await getAdminSession(env, request); } catch (err) {
    if (!/no such table/i.test(String(err && err.message))) throw err;
    notReady = true; // migration 0005 has not been applied yet
  }

  if (sub === '/login') {
    const next = safeConsoleNext(url.searchParams.get('next'));
    if (who) return redirect(url, next || CONSOLE_BASE);
    if (!notReady) notReady = !(await consoleReady(env));
    return html(request, url, notReady ? 503 : 200, renderLogin({ next: next || '', notReady }));
  }
  if (!who) {
    const next = safeConsoleNext(url.pathname + url.search);
    return redirect(url, `${CONSOLE_BASE}/login${next && next !== CONSOLE_BASE ? '?next=' + encodeURIComponent(next) : ''}`);
  }

  const me = await describe(env, who);
  const prefs = navPrefs(request);
  const found = findConsolePage(sub);
  const page = found && found.page;
  if (!page) {
    return html(request, url, 404, renderShell(me, { key: 'not-found', title: 'Page not found',
      body: messageBody('missing', 'Page not found', "There's no admin page at this address. It may have moved, or it isn't built yet.") }, prefs));
  }
  if (page.permission && !me.permissions.includes(page.permission)) {
    return html(request, url, 403, renderShell(me, { key: 'forbidden', title: 'No access',
      body: messageBody('forbidden', "Your role doesn't include this page", `${page.title} isn't part of the ${me.roleLabel} role. A Super Admin can change that under Roles and permissions.`) }, prefs));
  }
  return html(request, url, 200, renderShell(me, { key: page.key, title: page.title, crumbs: page.crumbs, body: page.body(me, found.params), scripts: page.scripts, params: found.params }, prefs));
}
