// App part (plans in the trainer): premium practice packs and 'custom' practice events.
// node --test tests/app-plan.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { PACKS } from '../src/content-packs.js';
import { rebuildAll } from '../src/pipeline.js';

let env, srv, base;
before(async () => {
  env = makeEnv();
  srv = await startServer(env, 8798);
  base = `http://localhost:${srv.port}`;
});
after(() => srv.server.close());

const pw = 'correct horse 9';
let ip = 0;
function client() {
  let cookie = null;
  const myIp = `10.8.0.${++ip}`;
  return async (method, path, body) => {
    env.__ip = myIp;
    const headers = { Origin: base };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const sc of res.headers.getSetCookie()) cookie = /Max-Age=0/.test(sc) ? null : sc.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}
async function signup(email) {
  const c = client();
  const r = await c('POST', '/api/auth/signup', { fullName: 'Learner', email, phoneNumber: '+91 98765 43210', password: pw, confirmPassword: pw });
  assert.equal(r.status, 201);
  c.user = r.body.user;
  return c;
}
/** Stands in for a purchase: an active subscription row with the package's features. */
async function grant(userId, packageId, { expiresAt = '2099-01-01T00:00:00.000Z', status = 'active' } = {}) {
  const p = await env.DB.prepare('SELECT features, limits FROM packages WHERE id = ?1').bind(packageId).first();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO user_subscriptions (id, user_id, package_id, status, source, features, limits, starts_at, expires_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, 'admin', ?5, ?6, ?7, ?8, ?7, ?7)`).bind(`sub-${packageId}-${userId}-${status}`, userId, packageId, status, p.features, p.limits, now, expiresAt).run();
}
let n = 0;
const id = () => `ev-app-${Date.now().toString(36)}-${++n}`;
const today = new Date().toISOString().slice(0, 10);
const run = (lessonId, extra = {}) => ({ id: id(), type: 'run', lessonId, kind: 'challenge', wpm: 32, accuracy: 96, errors: 4, seconds: 90, at: new Date().toISOString(), tz: 0, ...extra });
const send = (c, events) => c('POST', '/api/user/events', { events, today });

/* ---------------- pack data ---------------- */
test('pack data: four packs, unique ids, the promised sizes, printable text only', () => {
  assert.deepEqual(PACKS.map((p) => p.id), ['numbers', 'code', 'business', 'exam']);
  const sizes = { numbers: 12, code: 12, business: 12, exam: 8 };
  for (const p of PACKS) {
    assert.ok(p.title && p.description, p.id);
    assert.equal(p.exercises.length, sizes[p.id], p.id);
    const ids = p.exercises.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, `${p.id}: exercise ids are unique`);
    for (const e of p.exercises) {
      assert.match(e.id, /^[a-z0-9-]{1,40}$/);
      assert.ok(e.title.length > 2 && e.title.length < 60, e.id);
      // printable ASCII and the rupee sign; line breaks only in the code pack
      const allowed = p.id === 'code' ? /^[\x20-\x7E\n₹]+$/ : /^[\x20-\x7E₹]+$/;
      assert.match(e.text, allowed, `${p.id}/${e.id}: printable characters only`);
      assert.ok(!/ \n|\n$|^\s|\s$|\t/.test(e.text), `${p.id}/${e.id}: no stray whitespace`);
      assert.ok(e.text.length <= 2000, `${p.id}/${e.id}: at most 2,000 characters`);
      if (p.id === 'exam') {
        const words = e.text.split(/\s+/).length;
        assert.ok(words >= 260 && words <= 340, `${e.id}: about 300 words (${words})`);
      } else assert.ok(e.text.length >= 120, `${p.id}/${e.id}: long enough to practise`);
    }
  }
  assert.ok(PACKS.find((p) => p.id === 'numbers').exercises.some((e) => e.text.includes('₹')), 'amounts in rupees');
});

/* ---------------- content endpoints ---------------- */
test('packs: signed out 401; Free sees the list locked and gets 402 for texts', async () => {
  assert.equal((await client()('GET', '/api/content/packs')).status, 401);
  assert.equal((await client()('GET', '/api/content/packs/code')).status, 401);
  const a = await signup('free-packs@example.com');
  const list = await a('GET', '/api/content/packs');
  assert.equal(list.status, 200);
  assert.equal(list.body.packs.length, 4);
  for (const p of list.body.packs) {
    assert.equal(p.locked, true);
    assert.ok(p.exercises.length > 0);
    assert.ok(p.exercises.every((e) => !('text' in e)), 'the list never carries texts');
  }
  const r = await a('GET', '/api/content/packs/numbers');
  assert.equal(r.status, 402);
  assert.equal(r.body.error.code, 'plan_required');
  assert.equal(r.body.error.feature, 'exercises.premium');
  assert.equal(r.body.error.upgradeUrl, '/pricing');
  assert.ok(r.body.error.message);
  assert.equal(r.body.pack, undefined);
});

test('packs: Starter is still locked; Pro and Premium get the texts; expired or revoked plans do not count', async () => {
  const s = await signup('starter-packs@example.com');
  await grant(s.user.id, 'starter');
  assert.equal((await s('GET', '/api/content/packs/code')).status, 402);
  assert.equal((await s('GET', '/api/content/packs')).body.packs[0].locked, true);

  const p = await signup('pro-packs@example.com');
  await grant(p.user.id, 'pro');
  const list = await p('GET', '/api/content/packs');
  assert.ok(list.body.packs.every((x) => x.locked === false));
  const r = await p('GET', '/api/content/packs/exam');
  assert.equal(r.status, 200);
  assert.equal(r.body.pack.id, 'exam');
  assert.equal(r.body.pack.exercises.length, 8);
  assert.ok(r.body.pack.exercises.every((e) => typeof e.text === 'string' && e.text.length > 1000));
  assert.equal((await p('GET', '/api/content/packs/nope')).status, 404);

  const pr = await signup('premium-packs@example.com');
  await grant(pr.user.id, 'premium');
  assert.equal((await pr('GET', '/api/content/packs/business')).status, 200);

  const old = await signup('expired-packs@example.com');
  await grant(old.user.id, 'pro', { expiresAt: '2020-01-01T00:00:00.000Z' });
  assert.equal((await old('GET', '/api/content/packs/business')).status, 402);
  const rv = await signup('revoked-packs@example.com');
  await grant(rv.user.id, 'lifetime', { expiresAt: null, status: 'revoked' });
  assert.equal((await rv('GET', '/api/content/packs/business')).status, 402);
  const life = await signup('lifetime-packs@example.com');
  await grant(life.user.id, 'lifetime', { expiresAt: null });
  assert.equal((await life('GET', '/api/content/packs/numbers')).status, 200);
});

/* ---------------- 'custom' events ---------------- */
test("custom events: refused with plan_required on Free and Starter; the rest of the batch still counts", async () => {
  for (const [email, pkg] of [['free-custom@example.com', null], ['starter-custom@example.com', 'starter']]) {
    const a = await signup(email);
    if (pkg) await grant(a.user.id, pkg);
    const good = run('l25'), custom = run('custom', { data: { pack: 'code', exercise: 'js-sum' } });
    const r = await send(a, [good, custom]);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.sync.accepted, [good.id]);
    assert.equal(r.body.sync.rejected.length, 1);
    assert.equal(r.body.sync.rejected[0].id, custom.id);
    assert.equal(r.body.sync.rejected[0].code, 'plan_required');
    const saved = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE user_id = ?1 AND lesson_id = 'custom'").bind(a.user.id).first();
    assert.equal(saved.n, 0);
    const rej = await env.DB.prepare("SELECT n FROM event_rejects WHERE user_id = ?1 AND reason = 'plan_required'").bind(a.user.id).first();
    assert.equal(rej.n, 1);
  }
});

test('custom events: accepted with practice.custom (Pro) or exercises.premium alone; checked like any event; never a lesson', async () => {
  const a = await signup('pro-custom@example.com');
  await grant(a.user.id, 'pro');
  const custom = run('custom', { stars: 3, crown: true, data: { custom: 'text' } });
  const bad = run('custom', { wpm: 999 });
  const r = await send(a, [custom, bad, run('l25')]);
  assert.equal(r.status, 200);
  assert.equal(r.body.sync.accepted.length, 2);
  assert.ok(r.body.sync.accepted.includes(custom.id));
  assert.deepEqual(r.body.sync.rejected.map((x) => [x.id, x.code]), [[bad.id, 'bad_number']]);
  assert.equal(r.body.lessons.custom, undefined, 'custom practice has no lesson scorecard');
  const row = await env.DB.prepare("SELECT lesson_id, stars, crown, wpm FROM events WHERE user_id = ?1 AND id = ?2").bind(a.user.id, custom.id).first();
  assert.deepEqual({ ...row }, { lesson_id: 'custom', stars: null, crown: 0, wpm: 32 });
  assert.ok(r.body.today.seconds >= 0);
  // the same event again is a duplicate, not a second run
  const again = await send(a, [custom]);
  assert.deepEqual(again.body.sync.accepted, []);
  assert.deepEqual(again.body.sync.duplicates, [custom.id]);
  // a step event for custom practice is fine too
  const st = await send(a, [{ ...run('custom'), type: 'step', step: 0, kind: 'challenge' }]);
  assert.equal(st.body.sync.accepted.length, 1);

  // exercises.premium without practice.custom (a hand-made grant) is enough
  const b = await signup('packs-only@example.com');
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO user_subscriptions (id, user_id, package_id, status, source, features, limits, starts_at, expires_at, created_at, updated_at)
    VALUES ('sub-packs-only', ?1, 'pro', 'active', 'promo', '["exercises.premium"]', '{}', ?2, NULL, ?2, ?2)`).bind(b.user.id, now).run();
  assert.equal((await send(b, [run('custom')])).body.sync.accepted.length, 1);

  // the nightly rebuild agrees with the totals that custom runs produced
  const rb = await rebuildAll(env);
  assert.equal(rb.differences, 0);
  assert.equal(rb.errors, 0);
});

/* ---------------- lessons and games staff opened or closed for one learner (admin console, Phase 2) ---------------- */
async function exception(userId, kind, target, effect, { expiresAt = null, ended = false } = {}) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO access_overrides (id, user_id, kind, target, effect, reason, expires_at, created_by, created_at, ended_at)
    VALUES (?1, ?2, ?3, ?4, ?5, 'test', ?6, NULL, ?7, ?8)`).bind(`ao-${userId}-${kind}-${target}-${effect}-${++n}`, userId, kind, target, effect, expiresAt, now, ended ? now : null).run();
}
const game = (gameId) => ({ id: id(), type: 'game', gameId, score: 120, xp: 5, seconds: 60, at: new Date().toISOString() });

test('staff exceptions: an opened lesson or game is saved on Free; ended or run-out ones change nothing', async () => {
  const a = await signup('opened@example.com');
  await exception(a.user.id, 'lesson', 'l4', 'allow');
  await exception(a.user.id, 'game', 'storm', 'allow');
  await exception(a.user.id, 'lesson', 'l27', 'allow', { ended: true });
  await exception(a.user.id, 'lesson', 'l28', 'allow', { expiresAt: '2020-01-01T00:00:00.000Z' });
  const ok = [run('l4'), game('storm')], locked = [run('l27'), run('l28'), game('beat')];
  const r = await send(a, [...ok, ...locked]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.sync.accepted.sort(), ok.map((e) => e.id).sort());
  assert.deepEqual(r.body.sync.rejected.map((x) => x.code), ['plan_required', 'plan_required', 'plan_required']);
  const ent = (await a('GET', '/api/me/entitlements')).body;
  assert.deepEqual(ent.overrides, { lessons: { allow: ['l4'], deny: [] }, games: { allow: ['storm'], deny: [] } });
  assert.equal(ent.plan, 'free', 'the plan itself does not change');
});

test('staff exceptions: a closed lesson or game is refused as closed, not as a plan matter, whatever the plan', async () => {
  const a = await signup('closed@example.com');
  await grant(a.user.id, 'premium');
  await exception(a.user.id, 'lesson', 'l7', 'deny');
  await exception(a.user.id, 'game', 'storm', 'deny');
  await exception(a.user.id, 'game', 'daily', 'deny');              // never applies: the Daily Challenge is always open
  await exception(a.user.id, 'lesson', 'placement', 'deny');        // nor to the placement test
  const closed = [run('l7'), game('storm')], open = [run('l8'), game('beat'), game('daily')];
  const r = await send(a, [...closed, ...open]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.sync.rejected.map((x) => [x.id, x.code]), closed.map((e) => [e.id, 'closed']));
  assert.ok(r.body.sync.rejected.every((x) => !/plan/i.test(x.message)), 'the message does not talk about plans');
  for (const e of open) assert.ok(r.body.sync.accepted.includes(e.id), e.lessonId || e.gameId);
  const ent = (await a('GET', '/api/me/entitlements')).body;
  assert.deepEqual(ent.overrides.lessons.deny.sort(), ['l7', 'placement'], 'the placement row is read, and still never applies (src/entitlements.js)');
  const rej = await env.DB.prepare("SELECT n FROM event_rejects WHERE user_id = ?1 AND reason = 'closed'").bind(a.user.id).first();
  assert.equal(rej.n, 2);
  // the older lesson route says the same
  const done = await a('POST', '/api/user/progress/lesson-complete', { lessonId: 'l7', eventId: 'ev-closed-l7', stars: 2, wpm: 30, accuracy: 95, seconds: 60 });
  assert.equal(done.status, 403); assert.equal(done.body.error.code, 'closed');
  // when staff open it again, it is saved
  await env.DB.prepare("UPDATE access_overrides SET ended_at = ?2 WHERE user_id = ?1 AND target = 'l7'").bind(a.user.id, new Date().toISOString()).run();
  const again = await send(a, [run('l7')]);
  assert.equal(again.body.sync.accepted.length, 1);
});
