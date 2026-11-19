// Phase 6, the cutover (docs/ADMIN-CONSOLE.md §9): the console is the admin, at /admin, and every admin
// endpoint answers only to a console session. This file walks every route the Worker has under /api/admin
// and /api/console, so a new endpoint that forgets its check fails here.
//   node --test tests/admin-cutover.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER } from './console-kit.mjs';

const ROOT = new URL('../', import.meta.url);
// the sign-in steps themselves: they are how one gets a console session
const SIGN_IN = new Set(['POST /api/admin/auth/login', 'POST /api/admin/auth/verify', 'POST /api/admin/auth/resend', 'POST /api/admin/auth/logout']);
let S, K;

before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8808) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.91.0.' });
});
after(() => S.srv.server.close());

/** Every [method, route or pattern] the modules in src/ and src/console/ offer under /api/admin and /api/console. */
async function adminRoutes() {
  const out = [];
  for (const dir of ['src/', 'src/console/']) {
    for (const f of readdirSync(new URL(dir, ROOT)).filter((x) => x.endsWith('.js'))) {
      const m = await import(new URL(dir + f, ROOT));
      for (const key of Object.keys(m.ROUTES || {})) {
        const [method, path] = key.split(' ');
        if (/^\/api\/(admin|console)\//.test(path)) out.push({ method, path, from: dir + f });
      }
      for (const [method, re] of m.PATTERNS || []) {
        if (/\\\/api\\\/(admin|console)\\\//.test(re.source)) out.push({ method, re, from: dir + f });
      }
    }
  }
  return out;
}

// values tried for each part of a pattern's address, until the whole address matches
const SAMPLES = ['ins_00000000000000000000', 'ipay_00000000000000000000', 'cmp_00000000000000000000', 'em_00000000000000000000', 'msg_00000000000000000000',
  'ntc_aaaaaa000000', 'cpn_0000000000000000', 'prm_0000000000000000', 'ord_000000000000000000000000', '0123456789abcdef', 'seller', 'l1', 'lesson:l1', 'core', '1', 'abc', 'ABC',
  'welcome', 'pro', '00000000-0000-0000-0000-000000000000', 'TC-2026-000001'];
/** A concrete address for a pattern: each capture group is replaced by the first sample that keeps the address matching. */
function addressFor(re) {
  const src = re.source.replace(/^\^/, '').replace(/\$$/, '');
  // split into literal text and top-level capture groups
  const parts = []; let depth = 0, buf = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { buf += c + src[i + 1]; i += 2; continue; }
    if (c === '(' && depth === 0) { parts.push({ lit: buf }); buf = ''; depth = 1; i++; continue; }
    if (c === '(') depth++;
    if (c === ')' && depth === 1) { parts.push({ group: buf }); buf = ''; depth = 0; i++; continue; }
    if (c === ')') depth--;
    buf += c; i++;
  }
  parts.push({ lit: buf });
  let path = '';
  for (const p of parts) {
    if ('lit' in p) { path += p.lit.replace(/\\(.)/g, '$1'); continue; }
    const g = new RegExp(`^(?:${p.group})$`);
    const pick = SAMPLES.find((x) => g.test(x)) || SAMPLES.find((x) => g.test(encodeURIComponent(x)));
    assert.ok(pick, `no sample for (${p.group}) in ${re}`);
    path += pick;
  }
  assert.ok(re.test(path), `${path} should match ${re}`);
  return path;
}

test('every admin endpoint refuses visitors and site sign-ins: a console session is the only way in', async () => {
  const routes = await adminRoutes();
  assert.ok(routes.length > 120, `found ${routes.length} admin routes`);
  const owner = await K.owner();          // a Super Admin, signed in to the site only
  const learner = await K.account();      // no role at all
  const anon = K.client();
  const checked = [];
  for (const r of routes) {
    const key = r.path ? `${r.method} ${r.path}` : `${r.method} ${r.re}`;
    if (r.path && SIGN_IN.has(key)) continue;
    const path = r.path || addressFor(r.re);
    const body = r.method === 'GET' ? undefined : {};
    for (const [who, c] of [['visitor', anon], ['learner', learner.learner], ['owner (site sign-in)', owner.learner]]) {
      const res = await c(r.method, path, body);
      assert.ok([401, 404].includes(res.status), `${key} (${path}) as ${who}: ${res.status} ${res.text.slice(0, 120)}`);
      assert.ok(!res.headers.get('set-cookie') || !/__Host-tc_admin=[^;]/.test(res.headers.get('set-cookie')), `${key}: no admin cookie handed out`);
    }
    checked.push(key);
  }
  assert.ok(checked.length > 120);
  console.log(`# admin routes checked: ${checked.length} (each as visitor, learner and the owner's site sign-in)`);
});

test('the sign-in steps are the only admin endpoints a visitor can use, and they never sign in a site session by itself', async () => {
  const owner = await K.owner();
  const r = await owner.learner('POST', '/api/admin/auth/login', {});
  assert.equal(r.status, 400, 'asks for the email and password, even from the signed-in owner');
  assert.equal((await owner.learner('GET', '/api/admin/auth/me')).status, 401);
});

test('the old admin is gone: no pages, no scripts, no API, and /console and /admin.html lead to the console', async () => {
  for (const f of ['src/pages/admin.js', 'src/admin-api.js', 'admin.html', 'site/js/admin-overview.js', 'site/js/admin-users.js', 'site/js/admin-payments.js']) {
    assert.ok(!existsSync(new URL(f, ROOT)), `${f} is removed`);
  }
  const owner = await K.owner();
  for (const p of ['/api/admin/overview', '/api/admin/users', '/api/admin/me', '/api/admin/health', '/api/admin/settings', '/api/admin/emails', '/api/admin/contact']) {
    assert.equal((await owner.learner('GET', p)).status, 404, p);
  }
  // the Super Admin's site sign-in does not open the console's pages either
  const bySite = await owner.learner('GET', '/admin/customers');
  assert.equal(bySite.status, 302);
  assert.equal(new URL(bySite.headers.get('location'), S.base).pathname, '/admin/login');
  const anon = K.client();
  const page = await anon('GET', '/admin/customers?q=asha');
  assert.equal(page.status, 302);
  const to = new URL(page.headers.get('location'), S.base);
  assert.equal(to.pathname + to.search, '/admin/login?next=%2Fadmin%2Fcustomers%3Fq%3Dasha');
  const moved = await anon('GET', '/console/customers?q=asha');
  assert.equal(moved.status, 301); assert.equal(new URL(moved.headers.get('location'), S.base).pathname + new URL(moved.headers.get('location'), S.base).search, '/admin/customers?q=asha');
  assert.equal(new URL((await anon('GET', '/console')).headers.get('location'), S.base).pathname, '/admin');
  assert.equal(new URL((await anon('GET', '/admin.html')).headers.get('location'), S.base).pathname, '/admin');
  // an address that only starts with "console" is not the console's
  assert.equal((await anon('GET', '/consoles')).status, 404);
  // signed in, the console is at /admin and says so in its links
  const c = await K.consoleLogin(owner);
  const home = await c('GET', '/admin');
  assert.equal(home.status, 200);
  assert.ok(home.text.includes('data-console-base="/admin"') && home.text.includes('href="/admin/customers"'));
  assert.ok(!/href="\/console[/"]/.test(home.text), 'no link to the old address');
  // the site's menu sends staff to /admin
  const site = await owner.learner('GET', '/dashboard');
  assert.ok(site.text.includes('href="/admin"'));
  // the job alert email and the console's own pages link to /admin
  const jobs = readFileSync(new URL('src/jobs.js', ROOT), 'utf8');
  assert.match(jobs, /\$\{CONSOLE_BASE\}\/system-health/);
});
