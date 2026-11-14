// Pages and host rules (owner: the "site" part; docs/SAAS-CONTRACTS.md §7, §8).
// beforeAll(): runs first for every request (www → apex, old .html addresses); a Response or null.
// servePage(): every HTML page (public, auth, account, payment, admin), /app, robots.txt and
// sitemap.xml; a Response, or null to let the static files answer (css, js, icons…).
import { getSession } from './session.js';
import * as admin from './admin.js';
import { roleOf } from './roles.js';
import { entitlementsFor } from './entitlements.js';
import { renderPage, esc } from './layout.js';
import { PAGES as PUBLIC_PAGES } from './pages/public.js';
import { PAGES as AUTH_PAGES } from './pages/auth.js';
import { PAGES as ACCOUNT_PAGES } from './pages/account.js';
import { PAGES as PAYMENT_PAGES } from './pages/payment.js';
import { PAGES as ADMIN_PAGES } from './pages/admin.js';
import { loadSettings } from './site-data.js';
import notFoundBody, { meta as notFoundMeta } from './pages/public/not-found.js';

const APEX = 'typecrafttyping.in';
const ADMIN_ROLES = ['owner', 'admin', 'support'];

/* ---------- registry ---------- */
function compile(list, defaults) {
  return (list || []).map((p) => {
    const meta = { ...p.meta };
    meta.access = meta.access || defaults.access;
    meta.layout = meta.layout || defaults.layout;
    const keys = [];
    const re = meta.path.includes(':')
      ? new RegExp('^' + meta.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$')
      : null;
    return { ...p, meta, re, keys };
  });
}
let REGISTRY = null;
function registry() {
  if (REGISTRY) return REGISTRY;
  REGISTRY = [
    ...compile(PUBLIC_PAGES, { access: 'public', layout: 'site' }),
    ...compile(AUTH_PAGES, { access: 'guest', layout: 'auth' }),
    ...compile(ACCOUNT_PAGES, { access: 'user', layout: 'account' }),
    ...compile(PAYMENT_PAGES, { access: 'user', layout: 'site' }),
    ...compile(ADMIN_PAGES, { access: 'admin', layout: 'admin' }),
  ];
  return REGISTRY;
}
/** { page, params } for a path, or null. Exact paths win over patterns. */
export function findPage(pathname) {
  const all = registry();
  const exact = all.find((p) => !p.re && p.meta.path === pathname);
  if (exact) return { page: exact, params: {} };
  for (const p of all) {
    if (!p.re) continue;
    const m = pathname.match(p.re);
    if (m) {
      try { return { page: p, params: Object.fromEntries(p.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; } catch { return null; }
    }
  }
  return null;
}
/** Public pages that belong in the sitemap. */
export function indexablePages() {
  return registry().filter((p) => p.meta.access === 'public' && !p.meta.noindex && !p.re && p.meta.sitemap !== false);
}

/* ---------- helpers ---------- */
const siteUrl = (env) => String(env.SITE_URL || 'https://' + APEX).replace(/\/+$/, '');
const isWorkersDev = (url) => url.hostname.endsWith('.workers.dev');
/** A same-origin path from ?next= (or null). */
export function safeNext(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  if (!/^\/(?!\/)[^\\\s]*$/.test(value)) return null;
  if (/^\/(login|signup|forgot-password)(\/|\?|$)/.test(value)) return null;
  return value;
}
function randomNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/=+$/, '');
}

export function contentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''} https://checkout.razorpay.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.razorpay.com",
    "connect-src 'self' https://api.razorpay.com https://*.razorpay.com",
    'frame-src https://api.razorpay.com https://*.razorpay.com',
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function pageHeaders(url, { nonce, cache, extra = {} }) {
  const h = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': contentSecurityPolicy(nonce),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com" "https://api.razorpay.com")',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Cache-Control': cache,
    'Vary': 'Cookie',
  });
  if (url.protocol === 'https:') h.set('Strict-Transport-Security', 'max-age=31536000');
  if (isWorkersDev(url)) h.set('X-Robots-Tag', 'noindex');
  for (const [k, v] of Object.entries(extra)) if (v) h.set(k, v);
  return h;
}
const NO_STORE = 'private, no-store';
const PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=600';

function redirect(url, location, status = 302) {
  const h = new Headers({ Location: new URL(location, url).toString(), 'Cache-Control': 'no-store' });
  if (isWorkersDev(url)) h.set('X-Robots-Tag', 'noindex');
  return new Response(null, { status, headers: h });
}
function textResponse(url, body, type, cache = 'public, max-age=3600') {
  const h = new Headers({ 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  if (isWorkersDev(url)) h.set('X-Robots-Tag', 'noindex');
  return new Response(body, { status: 200, headers: h });
}

async function sessionFor(env, request) {
  if (!env.DB) return null;
  try { return await getSession(env, request); } catch { return null; } // tables missing: signed out
}
async function whoFor(env, session) {
  if (!session) return { user: null, entitlements: null, role: null };
  let entitlements = null, role = null;
  try { const e = await entitlementsFor(env, session.user.id); entitlements = { plan: e.plan, planName: e.planName, expiresAt: e.expiresAt, features: e.features, limits: e.limits }; } catch { entitlements = null; }
  try { role = await roleOf(env, session.user); } catch { role = null; }
  const u = session.user;
  return { user: { id: u.id, fullName: u.fullName, email: u.email, emailVerified: u.emailVerified }, entitlements, role };
}

/** {{seller.legalName}}-style tokens in a page body, filled from platform_settings (escaped). */
async function fillTokens(env, html, url) {
  if (!html.includes('{{')) return html;
  const s = await loadSettings(env);
  const vals = { site: { url: siteUrl(env) }, seller: s.seller, support: s.support };
  return html.replace(/\{\{(\w+)\.(\w+)\}\}/g, (all, a, b) => {
    const v = vals[a] && vals[a][b];
    if (v == null || v === '') return a === 'seller' ? '—' : all;
    // owner details not filled in yet stay visible as marked placeholders
    return /\[[^\]]+\]/.test(String(v)) ? `<span class="placeholder">${esc(v)}</span>` : esc(v);
  });
}

/* ---------- beforeAll ---------- */
export async function beforeAll(request, env, ctx) {
  const url = new URL(request.url);
  if (url.hostname === 'www.' + APEX) return redirect(url, `https://${APEX}${url.pathname}${url.search}`, 301);
  if (url.pathname === '/index.html') return redirect(url, '/app' + url.search, 301);
  if (url.pathname === '/login.html') return redirect(url, '/login' + url.search, 301);
  return null;
}

/* ---------- servePage ---------- */
export async function servePage(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith('/api/')) return null;
  const method = request.method;
  const readOnly = method === 'GET' || method === 'HEAD';

  if (path === '/robots.txt') return textResponse(url, robotsTxt(env), 'text/plain; charset=utf-8');
  if (path === '/sitemap.xml') return textResponse(url, sitemapXml(env), 'application/xml; charset=utf-8');
  if (path === '/app') return readOnly ? serveApp(request, env, url) : new Response('Method not allowed', { status: 405 });

  // the owner page from before the multi-page site, until the admin registry provides /admin
  const hasAdminHome = !!findPage('/admin');
  if (path === '/admin.html' || path === '/admin/' || (path === '/admin' && !hasAdminHome)) {
    if (!hasAdminHome) return admin.serveAdminPage(request, env);
    return notFound(request, env, url);
  }

  if (path.length > 1 && path.endsWith('/') && !path.includes('.')) return redirect(url, path.replace(/\/+$/, '') + url.search, 301);

  const found = findPage(path);
  if (!found) {
    if (path === '/dashboard') { // until the account part adds its dashboard, signed-in learners land in the trainer
      const s = await sessionFor(env, request);
      return s ? redirect(url, '/app') : redirect(url, '/login?next=%2Fdashboard');
    }
    if (/\.[a-z0-9]+$/i.test(path)) { // a file: static assets answer (adds noindex on workers.dev)
      if (!isWorkersDev(url)) return null;
      const res = await env.ASSETS.fetch(request);
      const h = new Headers(res.headers); h.set('X-Robots-Tag', 'noindex');
      return new Response(res.body, { status: res.status, headers: h });
    }
    return notFound(request, env, url);
  }
  if (!readOnly) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });

  const { page, params } = found;
  const access = page.meta.access;
  const session = await sessionFor(env, request);
  const renew = session && session.setCookie ? session.setCookie : null;

  if (access === 'guest' && session) return redirect(url, safeNext(url.searchParams.get('next')) || '/dashboard');
  if (access === 'user' && !session) return redirect(url, '/login?next=' + encodeURIComponent(path + url.search));
  const who = await whoFor(env, session);
  if (access === 'admin') {
    const allowed = page.meta.roles || ADMIN_ROLES;
    if (!who.role || !allowed.includes(who.role)) return notFound(request, env, url, session, who);
  }
  const personal = access !== 'public' || !!session;
  const html = await render(env, url, page, params, who);
  const headers = pageHeaders(url, { nonce: html.nonce, cache: personal ? NO_STORE : PUBLIC_CACHE, extra: { 'Set-Cookie': renew } });
  return new Response(method === 'HEAD' ? null : html.text, { status: 200, headers });
}

async function render(env, url, page, params, who, status) {
  const nonce = randomNonce();
  const base = siteUrl(env);
  const ctx = {
    env, url, params, siteUrl: base, path: url.pathname, nonce,
    canonicalPath: page.meta.canonical || (page.re ? url.pathname : page.meta.path),
    user: who.user, entitlements: who.entitlements, role: who.role,
    noindex: !!page.meta.noindex || page.meta.access === 'user' || page.meta.access === 'admin' || isWorkersDev(url) || !!status,
    jsonld: [],
  };
  let loaded = {};
  if (typeof page.load === 'function') { try { loaded = (await page.load(env, ctx)) || {}; } catch { loaded = {}; } }
  if (loaded.data !== undefined) ctx.data = loaded.data;
  const ld = typeof page.jsonld === 'function' ? page.jsonld(ctx, loaded) : page.jsonld;
  if (ld) ctx.jsonld = Array.isArray(ld) ? ld : [ld];
  let body = typeof page.body === 'function' ? page.body(ctx) : String(page.body || '');
  body = await fillTokens(env, body, url);
  return { nonce, text: renderPage(page, ctx, body) };
}

async function notFound(request, env, url, session, who) {
  if (session === undefined) session = await sessionFor(env, request);
  if (!who) who = await whoFor(env, session);
  const page = { meta: { ...notFoundMeta, access: 'public', layout: 'site' }, body: notFoundBody };
  const html = await render(env, url, page, {}, who, 404);
  return new Response(request.method === 'HEAD' ? null : html.text, { status: 404, headers: pageHeaders(url, { nonce: html.nonce, cache: NO_STORE }) });
}

/* ---------- /app: the trainer, only for signed-in browsers ---------- */
async function serveApp(request, env, url) {
  let extra = { 'X-TC-Page': 'app' };
  if (env.DB) { // no database connected: no accounts, so the trainer works as a guest-only app
    const s = await sessionFor(env, request);
    if (!s) return redirect(url, '/login?next=' + encodeURIComponent('/app' + url.search));
    if (s.setCookie) extra['Set-Cookie'] = s.setCookie;
  }
  const res = await env.ASSETS.fetch(new Request(new URL('/index.html', url), { method: 'GET', headers: request.headers }));
  if (!res.ok) return res;
  const headers = pageHeaders(url, { nonce: null, cache: NO_STORE, extra });
  headers.set('X-Robots-Tag', 'noindex');
  return new Response(request.method === 'HEAD' ? null : res.body, { status: 200, headers });
}

/* ---------- robots.txt and sitemap.xml ---------- */
export function robotsTxt(env) {
  return ['User-agent: *', 'Allow: /',
    'Disallow: /account', 'Disallow: /admin', 'Disallow: /checkout', 'Disallow: /payment', 'Disallow: /app', 'Disallow: /api',
    'Disallow: /dashboard', 'Disallow: /reset-password', 'Disallow: /verify-email', 'Disallow: /verify-otp',
    '', `Sitemap: ${siteUrl(env)}/sitemap.xml`, ''].join('\n');
}
export function sitemapXml(env) {
  const base = siteUrl(env);
  const urls = indexablePages().map((p) => {
    const pri = p.meta.path === '/' ? '1.0' : (p.meta.priority || '0.7');
    return `  <url><loc>${esc(base + p.meta.path)}</loc><changefreq>${p.meta.changefreq || 'monthly'}</changefreq><priority>${pri}</priority></url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
