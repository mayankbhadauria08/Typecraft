// Pages and host rules (owner: the "site" part; see docs/SAAS-CONTRACTS.md §5).
// beforeAll(): runs first for every request (www → apex redirect, workers.dev noindex…); returns a Response or null.
// servePage(): every HTML page (public, auth, account, payment, admin); returns a Response or null (then static assets).
// Baseline below = today's behaviour (sign-in gate at "/", owner page at /admin) until the multi-page site replaces it.
import { getSession } from './session.js';
import * as admin from './admin.js';

export async function beforeAll(request, env, ctx) { return null; }

// The app is only sent to signed-in browsers: everyone else gets the sign-in page.
const APP_PATHS = new Set(['/', '/index.html']);
const LOGIN_PATHS = new Set(['/login', '/login.html']);
const PAGE_HEADERS = {
  'Cache-Control': 'no-store, private', // a page depends on who is signed in, so no cache may keep it
  'Vary': 'Cookie',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};
async function asset(env, request, path, extraHeaders = {}) {
  const res = await env.ASSETS.fetch(new Request(new URL(path, request.url), { method: 'GET', headers: request.headers }));
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries({ ...PAGE_HEADERS, ...extraHeaders })) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
function redirect(request, path) {
  return new Response(null, { status: 302, headers: { Location: new URL(path, request.url).toString(), 'Cache-Control': 'no-store' } });
}
async function gate(request, env) {
  const { pathname } = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  // no database connected: no accounts, so the app works as a guest-only app
  if (!env.DB) return LOGIN_PATHS.has(pathname) ? redirect(request, '/') : asset(env, request, '/index.html');
  let session = null;
  try { session = await getSession(env, request); } catch { session = null; } // tables missing: treated as signed out
  const renew = session && session.setCookie ? { 'Set-Cookie': session.setCookie } : {};
  if (LOGIN_PATHS.has(pathname)) return session ? redirect(request, '/') : asset(env, request, '/login.html');
  if (pathname === '/index.html') return redirect(request, '/');
  // "/" keeps its address either way, so links like /#reset=… reach whichever page is shown
  return session ? asset(env, request, '/index.html', { ...renew, 'X-TC-Page': 'app' }) : asset(env, request, '/login.html');
}

export async function servePage(request, env, ctx) {
  const { pathname } = new URL(request.url);
  if (APP_PATHS.has(pathname) || LOGIN_PATHS.has(pathname)) return gate(request, env);
  if (pathname === '/admin' || pathname === '/admin.html' || pathname === '/admin/') return admin.serveAdminPage(request, env);
  return null;
}
