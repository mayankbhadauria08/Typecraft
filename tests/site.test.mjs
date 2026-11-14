// The multi-page site: routing, access, host rules, SEO files and headers (docs/SAAS-CONTRACTS.md §7–§8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './server.mjs';
import worker from '../src/index.js';
import { PAGES as PUBLIC } from '../src/pages/public.js';

const env = makeEnv({ OWNER_EMAILS: 'owner@example.com', SITE_URL: 'https://typecrafttyping.in' });
const ctx = { waitUntil() {} };
const BASE = 'https://typecrafttyping.in';
const pw = 'correct horse 9';

async function get(path, { cookie, host = BASE } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('Cookie', cookie);
  const res = await worker.fetch(new Request(host + path, { headers, redirect: 'manual' }), env, ctx);
  return { status: res.status, headers: res.headers, text: res.status === 200 ? await res.text() : '' };
}
async function signup(email, ip) {
  const res = await worker.fetch(new Request(BASE + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, 'CF-Connecting-IP': ip },
    body: JSON.stringify({ fullName: 'Site Test', email, phoneNumber: '+91 98765 43210', password: pw, confirmPassword: pw }),
  }), env, ctx);
  assert.equal(res.status, 201);
  return res.headers.get('set-cookie').split(';')[0];
}

test('every public page renders with a title, one h1, a canonical link and a CSP', async () => {
  for (const p of PUBLIC) {
    const r = await get(p.meta.path);
    assert.equal(r.status, 200, p.meta.path);
    assert.match(r.text, /<title>[^<]+<\/title>/, p.meta.path);
    assert.equal((r.text.match(/<h1[\s>]/g) || []).length, 1, `${p.meta.path}: exactly one h1`);
    assert.match(r.text, new RegExp(`<link rel="canonical" href="https://typecrafttyping\\.in${p.meta.path === '/' ? '/?' : p.meta.path}"`), p.meta.path);
    assert.match(r.headers.get('content-security-policy'), /checkout\.razorpay\.com/);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
  }
});

test('host rules: www goes to the apex; workers.dev pages are noindex', async () => {
  const w = await get('/pricing?x=1', { host: 'https://www.typecrafttyping.in' });
  assert.equal(w.status, 301);
  assert.equal(w.headers.get('location'), 'https://typecrafttyping.in/pricing?x=1');
  const d = await get('/pricing', { host: 'https://typecraft.mayankbhadauria08.workers.dev' });
  assert.equal(d.status, 200);
  assert.equal(d.headers.get('x-robots-tag'), 'noindex');
});

test('robots.txt and sitemap.xml', async () => {
  const robots = await get('/robots.txt');
  assert.match(robots.text, /Disallow: \/admin/);
  assert.match(robots.text, /Sitemap: https:\/\/typecrafttyping\.in\/sitemap\.xml/);
  const map = await get('/sitemap.xml');
  assert.match(map.text, /<loc>https:\/\/typecrafttyping\.in\/pricing<\/loc>/);
  assert.ok(!/\/account|\/admin|\/checkout|\/login/.test(map.text));
});

test('access: guest, user and admin pages', async () => {
  const anonDash = await get('/dashboard');
  assert.equal(anonDash.status, 302);
  assert.equal(anonDash.headers.get('location'), BASE + '/login?next=%2Fdashboard');
  const anonInvoice = await get('/account/invoices/TC-2026-000001');
  assert.equal(anonInvoice.status, 302);

  const learner = await signup('site-learner@example.com', '10.9.0.1');
  assert.equal((await get('/dashboard', { cookie: learner })).status, 200);
  assert.equal((await get('/account/invoices/TC-2026-000001', { cookie: learner })).status, 200);
  const loginIn = await get('/login', { cookie: learner });
  assert.equal(loginIn.status, 302);
  assert.equal(new URL(loginIn.headers.get('location')).pathname, '/dashboard');
  assert.match((await get('/dashboard', { cookie: learner })).headers.get('cache-control'), /no-store/);
  assert.equal((await get('/admin', { cookie: learner })).status, 404);
  assert.equal((await get('/admin/payments', { cookie: learner })).status, 404);

  const owner = await signup('owner@example.com', '10.9.0.2');
  assert.equal((await get('/admin', { cookie: owner })).status, 200);
  assert.equal((await get('/admin/payments', { cookie: owner })).status, 200);
});

test('old addresses and unknown pages', async () => {
  assert.equal((await get('/index.html')).headers.get('location'), BASE + '/app');
  assert.equal((await get('/login.html')).headers.get('location'), BASE + '/login');
  assert.equal((await get('/no-such-page')).status, 404);
  const css = await get('/site/site.css');
  assert.equal(css.status, 200);
});
