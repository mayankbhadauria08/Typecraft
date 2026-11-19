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
  const consoleCsp = (await get('/admin/login')).headers.get('content-security-policy') || '';
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
  assert.doesNotMatch(robots.text, /\/admin|\/console/, 'the admin is not advertised (its pages send noindex)');
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
  const owner = await signup('owner@example.com', '10.9.0.2');
  // /admin is the admin console (src/console/): its own sign-in, whatever the site session
  for (const cookie of [learner, owner, undefined]) {
    for (const p of ['/admin', '/admin/payments']) {
      const r = await get(p, { cookie });
      assert.equal(r.status, 302, p); assert.equal(new URL(r.headers.get('location')).pathname, '/admin/login', p);
    }
  }
  // the console's old address, and the page from before the multi-page site, lead there
  const moved = await get('/console/payments?status=failed');
  assert.equal(moved.status, 301); assert.equal(moved.headers.get('location'), BASE + '/admin/payments?status=failed');
  assert.equal(new URL((await get('/console')).headers.get('location')).pathname, '/admin');
  assert.equal(new URL((await get('/admin.html')).headers.get('location')).pathname, '/admin');
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

test('signed in: the streak and XP chip and Upgrade on the Free plan; the trainer is in Learn and the account menu', async () => {
  const cookie = await signup('header@example.com', '203.0.113.88');
  const page = await get('/pricing', { cookie });
  const head = page.text.slice(page.text.indexOf('<header class="site-head'), page.text.indexOf('</header>'));
  assert.doesNotMatch(head, /class="btn btn-primary btn-sm[^"]*" href="\/app"/, 'no Open trainer button in the top bar');
  assert.match(head, /<a href="\/app"><span class="ng-ic"/, 'Learn → Course and trainer');
  assert.match(head, /<a role="menuitem" href="\/app">.*<span>Open the trainer<\/span><\/a>/, 'account menu');
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

test('slow-changing public data is remembered for a minute and forgotten after an admin change', async () => {
  const { remember, forgetAll } = await import('../src/memo.js');
  const env = { DB: {} };
  let reads = 0;
  const load = async () => { reads += 1; return { n: reads }; };
  assert.deepEqual(await remember(env, 'k', 60000, load), { n: 1 });
  assert.deepEqual(await remember(env, 'k', 60000, load), { n: 1 }, 'second read comes from memory');
  forgetAll(env);
  assert.deepEqual(await remember(env, 'k', 60000, load), { n: 2 }, 'read again after forgetAll');
  await remember(env, 'e', 0, load);
  assert.deepEqual(await remember(env, 'e', 0, load), { n: 4 }, 'expired at once: read again');
  let nulls = 0;
  await remember(env, 'n', 60000, async () => { nulls += 1; return null; });
  await remember(env, 'n', 60000, async () => { nulls += 1; return null; });
  assert.equal(nulls, 2, 'a null read is not kept');
  assert.deepEqual(await remember({ DB: {} }, 'k', 60000, load), { n: 5 }, 'kept per database');
});

test('a seller change in admin shows on the legal pages straight away', async () => {
  assert.doesNotMatch((await get('/privacy')).text, /Asha Verma/);   // read once: now remembered
  // signed in to the admin console (no emailed code: email is not set up here)
  const res = await worker.fetch(new Request(BASE + '/api/admin/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE, 'CF-Connecting-IP': '10.9.0.3' },
    body: JSON.stringify({ email: 'owner@example.com', password: pw }),
  }), env, ctx);
  assert.equal(res.status, 200, await res.clone().text());
  const owner = res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !/=$/.test(c)).join('; ');
  const call = (method, path, body) => worker.fetch(new Request(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: owner }, body: body && JSON.stringify(body),
  }), env, ctx);
  const data = await (await call('GET', '/api/console/settings')).json();
  const seller = Object.fromEntries(Object.entries(data.settings.seller).filter(([k]) => k !== 'updatedAt'));
  const put = await call('PUT', '/api/console/settings/seller', { ...seller, legalName: 'Asha Verma (sole proprietor)' });
  assert.equal(put.status, 200, await put.clone().text());
  assert.match((await get('/privacy')).text, /Asha Verma \(sole proprietor\)/);
});

import { readFileSync } from 'node:fs';
const pngSize = (path) => { const b = readFileSync(new URL('../' + path, import.meta.url)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('share picture, icon files and app settings', async () => {
  const home = await get('/');
  assert.match(home.text, /<meta property="og:image" content="https:\/\/typecrafttyping\.in\/site\/og-image\.png">/);
  assert.match(home.text, /<meta property="og:image:width" content="1200">/);
  assert.match(home.text, /<meta property="og:image:height" content="630">/);
  assert.match(home.text, /<link rel="icon" href="\/favicon\.ico" sizes="48x48">/);
  assert.match(home.text, /<link rel="icon" href="\/icons\/favicon\.svg" type="image\/svg\+xml">/);
  assert.match(home.text, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.doesNotMatch(home.text, /rel="icon"[^>]*href="data:/, 'no inline icon');
  assert.deepEqual(pngSize('site/og-image.png'), [1200, 630]);
  assert.deepEqual(pngSize('icons/icon-192.png'), [192, 192]);
  assert.deepEqual(pngSize('icons/icon-512.png'), [512, 512]);
  const ico = readFileSync(new URL('../favicon.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(2), 1, 'an icon file'); assert.ok(ico.readUInt16LE(4) >= 3, '16, 32 and 48 px');

  const m = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(m.start_url, '/app', 'the installed app opens the trainer');
  assert.equal(m.id, '/app');
  assert.equal(m.display, 'standalone');
  for (const size of ['192x192', '512x512']) assert.ok(m.icons.some((i) => i.sizes === size && i.type === 'image/png'), size + ' icon');
  for (const i of m.icons.filter((x) => x.type === 'image/png')) assert.deepEqual(pngSize(i.src.slice(1)), i.sizes.split('x').map(Number));
  assert.deepEqual(m.shortcuts.map((s) => s.url), ['/app', '/arcade', '/typing-test']);
  for (const s of m.screenshots) assert.deepEqual(pngSize(s.src.slice(1)), s.sizes.split('x').map(Number), s.src);
  assert.ok(m.screenshots.every((s) => s.form_factor === 'wide'), 'computer screenshots only');

  const app = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /rel="icon"[^>]*href="data:/);
  assert.match(app, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(app, /data-install hidden>Install the app</);
  assert.match(app, /id="installCard" hidden/);
});

test('Get the app page, the account menu install item and the phone keyboard note', async () => {
  const page = await get('/get-the-app');
  assert.equal(page.status, 200);
  assert.match(page.text, /<h1>Install TypeCraft on your computer\.<\/h1>/);
  assert.match(page.text, /data-install hidden>/);
  assert.match(page.text, /data-install-status data-state="manual"/);
  assert.match((await get('/sitemap.xml')).text, /\/get-the-app<\/loc>/);
  assert.match((await get('/')).text, /<a href="\/get-the-app">Get the app<\/a>/);

  const cookie = await signup('install@example.com', '203.0.113.91');
  assert.match((await get('/pricing', { cookie })).text, /<button type="button" role="menuitem" data-install hidden>/);

  for (const p of ['/typing-test', '/exam-practice', '/practice']) assert.match((await get(p)).text, /data-kb-note/, p + ': keyboard note for phones');
  for (const p of ['/', '/about', '/pricing']) assert.doesNotMatch((await get(p)).text, /data-kb-note/, p);
});
