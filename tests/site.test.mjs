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

test('the CSP lets Cloudflare Web Analytics load and report on site pages, not in the console', async () => {
  const cookie = await signup('analytics-csp@example.com', '203.0.113.77');
  for (const path of ['/', '/exam-practice', '/verify', '/app']) {
    const csp = (await get(path, { cookie })).headers.get('content-security-policy') || '';
    const directive = (name) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) || '');
    assert.match(directive('script-src'), /https:\/\/static\.cloudflareinsights\.com/, `${path}: beacon script allowed`);
    assert.match(directive('connect-src'), /https:\/\/cloudflareinsights\.com/, `${path}: beacon report allowed`);
  }
  const consoleCsp = (await get('/console/login')).headers.get('content-security-policy') || '';
  assert.doesNotMatch(consoleCsp, /cloudflareinsights/, 'the admin console stays unmeasured');
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

test('the header: Learn and Resources groups, an Arcade button, Exam practice and For institutes', async () => {
  const home = await get('/');
  const head = home.text.slice(home.text.indexOf('<header class="site-head"'), home.text.indexOf('</header>'));
  assert.match(head, /<details class="nav-group"><summary>Learn/);
  assert.match(head, /<details class="nav-group"><summary>Resources/);
  assert.match(head, /<a href="\/arcade" class="nav-arcade">/);
  assert.match(head, /href="\/exam-practice">Exam practice <span class="nav-new">New<\/span>/);
  assert.match(head, /href="\/contact\?topic=institutes">For institutes/);
  assert.match(head, /href="\/verify"/);
  assert.match(head, /href="\/signup">Start free/);
  assert.doesNotMatch(head, /Open trainer|streak-chip/, 'signed out: no trainer button, no streak');
  // the page you are on is marked, inside its dropdown too
  const faq = await get('/faq');
  assert.match(faq.text, /<details class="nav-group" data-here><summary>Resources/);
  assert.match(faq.text, /<a href="\/faq" aria-current="page">/);
});

test('signed in: Open trainer is back, with the streak and XP chip and Upgrade on the Free plan', async () => {
  const cookie = await signup('header@example.com', '203.0.113.88');
  const page = await get('/pricing', { cookie });
  const head = page.text.slice(page.text.indexOf('<header class="site-head'), page.text.indexOf('</header>'));
  assert.match(head, /<a class="btn btn-primary btn-sm hide-xs" href="\/app">.*Open trainer<\/a>/);
  assert.match(head, /class="streak-chip"[^>]*aria-label="0 days streak, 0 XP"/);
  assert.match(head, /href="\/account\/plans">Upgrade<\/a>/);
  assert.match(head, /<a href="\/arcade" class="nav-arcade">/);
  // Pricing and For institutes move into Resources; the theme switch moves into the account menu
  assert.match(head, /<details class="nav-group" data-here><summary>Resources.*href="\/pricing" aria-current="page"/s);
  assert.doesNotMatch(head, /<a href="\/pricing"( aria-current="page")?>Pricing<\/a>/);
  assert.match(head, /data-theme-toggle="menu"/);
});

test('/arcade opens the arcade straight away; signed-out visitors sign in first', async () => {
  const out = await get('/arcade');
  assert.equal(out.status, 302);
  assert.equal(out.headers.get('location'), BASE + '/login?next=%2Farcade');
  const cookie = await signup('arcade@example.com', '203.0.113.89');
  const inn = await get('/arcade', { cookie });
  assert.equal(inn.status, 302);
  assert.equal(inn.headers.get('location'), BASE + '/app#arcade');
  assert.match(inn.headers.get('cache-control'), /no-store/);
  // after signing in, ?next=/arcade is honoured
  const login = await get('/login?next=%2Farcade', { cookie });
  assert.equal(new URL(login.headers.get('location')).pathname, '/arcade');
});

test('the streak chip counts a streak only while it is current (India time)', async () => {
  const { headerTotals } = await import('../src/site.js');
  const now = Date.parse('2026-11-19T06:00:00Z'); // 11:30 in India
  assert.deepEqual(headerTotals({ xp: 320, streak_count: 4, streak_last: '2026-11-19' }, now), { streak: 4, xp: 320 });
  assert.deepEqual(headerTotals({ xp: 320, streak_count: 4, streak_last: '2026-11-18' }, now), { streak: 4, xp: 320 });
  assert.deepEqual(headerTotals({ xp: 320, streak_count: 4, streak_last: '2026-11-17' }, now), { streak: 0, xp: 320 });
  assert.deepEqual(headerTotals(null, now), { streak: 0, xp: 0 });
});

test('the contact form takes an institutes topic', async () => {
  const page = await get('/contact');
  assert.match(page.text, /<option value="institutes">/);
});
