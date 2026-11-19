// Unlock conditions (docs/UNLOCK-RULES.md): which lessons a plan includes, lessons and levels closed or
// open for everyone, and when each level opens by progress.
//   node --test tests/unlock-rules.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER, assertNoInlineCode } from './console-kit.mjs';
import { entitlementsFor, lessonAllowed } from '../src/entitlements.js';
import '../shared/course-meta.js';
import '../shared/lesson-access.js';

const A = globalThis.TC_ACCESS, META = globalThis.TC_META;
let S, K, owner, admin, support, learner, payer;
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8780) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.66.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));
  learner = await K.account({ email: 'free.learner@example.com', name: 'Free Learner' });
  payer = await K.account({ email: 'paid.learner@example.com', name: 'Paid Learner' });
});
after(() => { S.srv.server.close(); });

let n = 0;
const today = new Date().toISOString().slice(0, 10);
const run = (lessonId) => ({ id: `ev-unlock-${Date.now().toString(36)}-${++n}`, type: 'run', lessonId, kind: 'challenge', wpm: 32, accuracy: 96, errors: 4, seconds: 90, at: new Date().toISOString(), tz: 0 });
/** Sends one run per lesson. → { accepted: [lessonIds], rejected: { lessonId: code } } */
async function send(who, ids) {
  const events = ids.map(run), r = await who.learner('POST', '/api/user/events', { events, today });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const byId = Object.fromEntries(events.map((e) => [e.id, e.lessonId]));
  return { accepted: r.body.sync.accepted.map((id) => byId[id]), rejected: Object.fromEntries(r.body.sync.rejected.map((x) => [byId[x.id], x.code])), raw: r.body.sync.rejected };
}
const allowed = async (userId, id) => lessonAllowed(await entitlementsFor(S.env, userId), id);
const pkgPut = (c, id, body) => c('PUT', `/api/console/packages/${id}`, body);
const unlock = (c) => c('GET', '/api/console/unlock');
const rule = async (c, body) => c('POST', '/api/console/unlock/rules', { reason: 'Testing the rules', updatedAt: (await unlock(owner)).body.updatedAt, ...body });

/* ---------------- the shared rules ---------------- */
test('shared rules: a plan\'s lessons are checked, joined and said in words', () => {
  assert.deepEqual(A.check({ levels: [2, 1, 1], lessons: ['l40', 'l1'] }).value, { levels: [1, 2], lessons: [] }, 'lessons inside a chosen level are dropped');
  assert.equal(A.check({ levels: [1, 2, 3, 4, 5] }).value, 'all');
  for (const bad of [{ levels: [9] }, { lessons: ['nope'] }, { other: 1 }, 'some', 5, null]) assert.equal(A.check(bad).ok, false, JSON.stringify(bad));
  assert.equal(A.describe('first5').text, 'the first 5 lessons');
  assert.equal(A.describe({ levels: [1] }).Text, 'Level 1 (16 lessons)');
  assert.equal(A.describe({ levels: [1, 2, 3] }).short, 'Levels 1–3');
  assert.equal(A.describe({ levels: [1], lessons: ['l40'] }).text, 'Level 1 and 1 more lesson (17 lessons)');
  assert.equal(A.describe('all').Text, 'All 78 lessons');
  assert.equal(A.union('first5', 'first5'), 'first5');
  assert.equal(A.union({ levels: [1, 2] }, { levels: [3, 4, 5] }), 'all');
  assert.deepEqual(A.union({ levels: [1] }, { lessons: ['l40'] }), { levels: [1], lessons: ['l40'] });
  // the order: the placement test, then this learner, then a lesson rule, then a level rule, then the plan
  const rules = A.cleanRules({ closed: { levels: [2], lessons: ['l2'] }, open: { lessons: ['l8'] } });
  const ctx = { lessons: 'all', rules, overrides: { allow: ['l2'], deny: ['l1'] } };
  assert.deepEqual([A.access(ctx, 'placement').why, A.access(ctx, 'l1').why, A.access(ctx, 'l2').why, A.access(ctx, 'l8').why, A.access(ctx, 'l7').why, A.access(ctx, 'l50').why],
    ['always', 'you-closed', 'you-open', 'all-open', 'all-closed', 'plan']);
  assert.equal(A.access({ lessons: 'first5', rules }, 'l50').why, 'not-in-plan');
  // progress: a level opens when the one before is done; only lessons the learner can open count
  const prog = A.cleanRules({ progress: { 2: 'bosses', 3: 'all' } }), done = new Set();
  const p = (id, extra = {}) => A.progress({ rules: prog, done: (x) => done.has(x), canOpen: () => true, ...extra }, id);
  assert.deepEqual(p('l7'), { open: false, level: 1, mode: 'bosses', left: 1 });
  done.add('l34');
  assert.equal(p('l7').open, true);
  assert.equal(p('l50').left, 18);
  assert.equal(p('l50', { canOpen: (x) => x === 'l7' }).left, 1, 'Level 2 lessons the learner cannot open are not needed');
  assert.equal(p('l50', { placementLevel: 3 }).open, true, 'the placement test opens its level');
  assert.equal(A.progress({ rules: { ...prog, placement: false }, done: () => false, placementLevel: 3 }, 'l50').open, false);
  assert.equal(p('l60').open, true, 'Level 4 opens from the start');
});

/* ---------------- what each plan includes ---------------- */
test('a plan can include chosen levels and lessons; the lesson features follow; the public data says it in words', async () => {
  let r = await pkgPut(owner, 'starter', { limits: { lessons: { levels: [1, 2], lessons: ['l49'] }, dailyTests: null, historyDays: null } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.package.limits.lessons, { levels: [1, 2], lessons: ['l49'] });
  assert.ok(!r.body.package.features.includes('lessons.all'), 'no longer "every lesson"');
  assert.ok(r.body.changed.includes('limits'));
  for (const bad of [{ levels: [0] }, { lessons: ['l999'] }, 'some', { levels: 'all' }]) {
    r = await pkgPut(owner, 'starter', { limits: { lessons: bad, dailyTests: null, historyDays: null } });
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.ok(r.body.error.fields.limits);
  }
  // every level chosen is "every lesson"
  r = await pkgPut(owner, 'premium', { limits: { lessons: { levels: [1, 2, 3, 4, 5] }, dailyTests: null, historyDays: null } });
  assert.equal(r.body.package.limits.lessons, 'all'); assert.ok(r.body.package.features.includes('lessons.all'));
  const pub = (await K.client()('GET', '/api/packages')).body;
  const starter = pub.packages.find((p) => p.id === 'starter');
  assert.equal(starter.lessons.Text, 'Levels 1 and 2 and 1 more lesson (35 lessons)');
  assert.deepEqual(starter.features[0], { key: 'lessons', label: starter.lessons.Text });
  assert.ok(!pub.features.some((f) => f.key.startsWith('lessons.')));
  // the console reads back the stored choice, so its form can keep it when something else is changed
  const stored = (await owner('GET', '/api/console/packages/starter')).body.package;
  assert.deepEqual(stored.limits.lessons, { levels: [1, 2], lessons: ['l49'] });
  r = await pkgPut(owner, 'starter', { description: 'Two levels and one lesson more' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.deepEqual(r.body.package.limits.lessons, { levels: [1, 2], lessons: ['l49'] });
});

test('customers who paid keep what they bought; lessons a plan gains reach them at once', async () => {
  // bought Pro while it had every lesson
  const before = await K.subscription(payer.id, 'pro', { days: 60, source: 'purchase' });
  assert.equal(await allowed(payer.id, 'l70'), true);
  let r = await pkgPut(owner, 'pro', { limits: { lessons: { levels: [1, 2] }, dailyTests: null, historyDays: null } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await allowed(payer.id, 'l70'), true, 'they keep every lesson they paid for');
  // someone who buys Pro now gets Levels 1 and 2
  const newer = await K.customer({ email: 'new.pro@example.com' });
  await K.subscription(newer, 'pro', { days: 60, source: 'purchase' });
  assert.equal(await allowed(newer, 'l7'), true);
  assert.equal(await allowed(newer, 'l50'), false);
  // Pro gains Level 3: it reaches them without buying again
  await pkgPut(owner, 'pro', { limits: { lessons: { levels: [1, 2, 3] }, dailyTests: null, historyDays: null } });
  assert.equal(await allowed(newer, 'l50'), true);
  const ent = await entitlementsFor(S.env, newer);
  assert.equal(ent.lessonsWords.Text, 'Levels 1–3 (54 lessons)');
  await pkgPut(owner, 'pro', { limits: { lessons: 'all', dailyTests: null, historyDays: null } });
  await K.run('DELETE FROM user_subscriptions WHERE id = ?1', before);
});

test('Free is read live: what it includes changes for every free learner at once, on the server and in the site\'s words', async () => {
  let s = await send(learner, ['l25', 'l34']);
  assert.deepEqual(s.rejected, { l34: 'plan_required' }, 'the original Free: the first five lessons');
  const r = await pkgPut(owner, 'free', { limits: { lessons: { levels: [1] }, dailyTests: 3, historyDays: 7 } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!r.body.package.features.includes('lessons.first5'));
  s = await send(learner, ['l34', 'l7']);
  assert.deepEqual(s.accepted, ['l34']); assert.deepEqual(s.rejected, { l7: 'plan_required' });
  const ent = (await learner.learner('GET', '/api/me/entitlements')).body;
  assert.deepEqual(ent.limits.lessons, { levels: [1], lessons: [] });
  assert.equal(ent.lessonsWords.text, 'Level 1 (16 lessons)');
  const web = K.client();
  for (const [path, words] of [['/pricing', 'Start free with Level 1 (16 lessons).'], ['/', 'Level 1 free'], ['/faq', 'Level 1 (16 lessons), the placement test'],
    ['/practice', '<span class="badge badge-ok">Free</span>'], ['/signup', 'You start with Level 1 (16 lessons) free'],
    ['/features', 'Level 1 (16 lessons) · '], ['/refund-policy', 'beyond the lessons the Free plan includes']]) {
    const page = await web('GET', path);
    assert.equal(page.status, 200, path);
    assert.ok(page.text.includes(words), `${path} says "${words}"`);
    assert.ok(!page.text.includes('{{free.'), `${path} has no unfilled words`);
    // the site's own words follow Free (a plan's description is the owner's own text, so it is left out here)
    const own = page.text.replace(/<script type="application\/(json|ld\+json)"[^>]*>[\s\S]*?<\/script>/g, '').replace(/Start touch typing: the first five lessons[^<]*/g, '');
    assert.ok(!/first (five|5) lessons/i.test(own), `${path} no longer says the first five: ${(own.match(/[\s\S]{0,80}first (five|5) lessons[\s\S]{0,30}/i) || [])[0]}`);
  }
  await pkgPut(owner, 'free', { limits: { lessons: 'first5', dailyTests: 3, historyDays: 7 } });
  assert.ok((await web('GET', '/pricing')).text.includes('Start free with the first 5 lessons.'));
});

/* ---------------- closed or open for everyone ---------------- */
test('who may see and change the rules for everyone', async () => {
  assert.equal((await K.client()('GET', '/api/console/unlock')).status, 401);
  assert.equal((await learner.learner('GET', '/api/console/unlock')).status, 401);
  const seen = await support('GET', '/api/console/unlock');
  assert.equal(seen.status, 200);
  assert.equal(seen.body.can.manage, false);
  assert.deepEqual(seen.body.levels.map((l) => l.lessons.length), [16, 18, 20, 14, 10]);
  assert.ok(seen.body.plans.some((p) => p.id === 'free' && p.byLevel[1] === 5 && p.text === 'The first 5 lessons'));
  for (const c of [support, admin]) {
    const r = await c('POST', '/api/console/unlock/rules', { scope: 'level', target: 3, effect: 'closed', reason: 'Not allowed', updatedAt: seen.body.updatedAt });
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'forbidden');
    assert.equal((await c('PUT', '/api/console/unlock/progress', { progress: { 2: 'all', 3: 'open', 4: 'open', 5: 'open' }, placement: true, reason: 'Not allowed' })).status, 403);
  }
  // with the permission, a recent password check is still needed
  await K.setPermission('admin', 'unlock.manage', true);
  await K.stale(admin);
  const r = await admin('POST', '/api/console/unlock/rules', { scope: 'level', target: 3, effect: 'closed', reason: 'Checking the password', updatedAt: seen.body.updatedAt });
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'reauth_required');
  await K.setPermission('admin', 'unlock.manage', false);
});

test('a lesson or level closed for everyone is closed whatever the plan; one opened is open to Free too; an exception for one learner wins', async () => {
  const pro = await K.subscription(payer.id, 'pro', { days: 30, source: 'purchase' });
  let r = await rule(owner, { scope: 'lesson', target: 'l7', effect: 'closed', reason: 'Fixing a typo in the text' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.done, 'Lesson 17: Reaching for E & I now closed for everyone.');
  assert.deepEqual(r.body.rules.map((x) => [x.target, x.effect, x.reason, x.by]), [['l7', 'closed', 'Fixing a typo in the text', 'Mayank Owner']]);
  r = await rule(owner, { scope: 'level', target: 4, effect: 'closed', reason: 'Level 4 is being rewritten' });
  r = await rule(owner, { scope: 'lesson', target: 'l60', effect: 'open', reason: 'This one is ready' });     // a lesson rule beats its level's
  r = await rule(owner, { scope: 'lesson', target: 'l40', effect: 'open', reason: 'A free taste of Level 2' });
  assert.equal(r.body.rules.length, 4);

  let s = await send(payer, ['l7', 'l8', 'l62', 'l60']);
  assert.deepEqual(s.accepted.sort(), ['l60', 'l8']);
  assert.deepEqual(s.rejected, { l7: 'closed', l62: 'closed' });
  assert.ok(s.raw.every((x) => x.message === 'This lesson is closed for now.'));
  const done = await payer.learner('POST', '/api/user/progress/lesson-complete', { lessonId: 'l7', eventId: 'ev-unlock-closed-l7', stars: 2, wpm: 30, accuracy: 95, seconds: 60 });
  assert.equal(done.status, 403); assert.equal(done.body.error.message, 'This lesson is closed for now.');
  s = await send(learner, ['l40', 'l41']);
  assert.deepEqual(s.accepted, ['l40'], 'open to everyone, Free too'); assert.deepEqual(s.rejected, { l41: 'plan_required' });
  // staff open l7 for this one learner: that wins
  await K.run(`INSERT INTO access_overrides (id, user_id, kind, target, effect, reason, created_at) VALUES ('ov-unlock-1', ?1, 'lesson', 'l7', 'allow', 'Tester', ?2)`, payer.id, new Date().toISOString());
  s = await send(payer, ['l7']);
  assert.deepEqual(s.accepted, ['l7']);

  // browsers see the rules without reasons or names, signed in or not
  const pub = await K.client()('GET', '/api/learning-rules');
  assert.equal(pub.status, 200); assert.match(pub.headers.get('cache-control'), /max-age=60/);
  assert.deepEqual(pub.body.rules.closed, { levels: [4], lessons: ['l7'] });
  assert.deepEqual(pub.body.rules.open, { levels: [], lessons: ['l40', 'l60'] });
  assert.ok(!/Fixing|Mayank|reason/.test(pub.text));
  assert.deepEqual((await payer.learner('GET', '/api/me/entitlements')).body.rules, pub.body.rules);

  // the same again changes nothing; "follow the plans" removes a rule; an old page cannot overwrite a newer change
  const page = (await unlock(owner)).body;
  r = await owner('POST', '/api/console/unlock/rules', { scope: 'lesson', target: 'l7', effect: 'closed', reason: 'Again', updatedAt: page.updatedAt });
  assert.equal(r.body.unchanged, true);
  r = await owner('POST', '/api/console/unlock/rules', { scope: 'level', target: 4, effect: 'plans', reason: 'Level 4 is ready', updatedAt: page.updatedAt });
  assert.equal(r.status, 200); assert.equal(r.body.rules.length, 3);
  r = await owner('POST', '/api/console/unlock/rules', { scope: 'lesson', target: 'l8', effect: 'closed', reason: 'From an old page', updatedAt: page.updatedAt });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'rules_changed');
  for (const bad of [{ scope: 'unit', target: 1, effect: 'closed' }, { scope: 'level', target: 9, effect: 'closed' }, { scope: 'lesson', target: 'l999', effect: 'closed' },
    { scope: 'lesson', target: 'l8', effect: 'maybe' }, { scope: 'lesson', target: 'l8', effect: 'closed', reason: '' }]) {
    const x = await owner('POST', '/api/console/unlock/rules', { reason: 'A reason', updatedAt: r.body && r.body.updatedAt, ...bad });
    assert.equal(x.status, 400, JSON.stringify(bad));
  }
  const log = await K.audits('unlock.%');
  assert.deepEqual(log.map((a) => [a.action, a.target, JSON.parse(a.detail).to]), [
    ['unlock.rule', 'lesson:l7', 'closed'], ['unlock.rule', 'level:4', 'closed'], ['unlock.rule', 'lesson:l60', 'open'], ['unlock.rule', 'lesson:l40', 'open'], ['unlock.rule', 'level:4', 'plans']]);
  for (const t of ['l7', 'l60', 'l40']) await rule(owner, { scope: 'lesson', target: t, effect: 'plans', reason: 'Back to normal' });
  assert.deepEqual((await K.client()('GET', '/api/learning-rules')).body.rules.open.lessons, []);
  await K.run("DELETE FROM access_overrides WHERE id = 'ov-unlock-1'");
  await K.run('DELETE FROM user_subscriptions WHERE id = ?1', pro);
});

/* ---------------- unlock by progress ---------------- */
test('progress rules: set per level, kept for browsers; the server does not refuse progress by them', async () => {
  const page = (await unlock(owner)).body;
  assert.deepEqual(page.progress, { 2: 'open', 3: 'open', 4: 'open', 5: 'open' }); assert.equal(page.placement, true);
  for (const bad of [{ progress: { 2: 'later', 3: 'open', 4: 'open', 5: 'open' }, placement: true }, { progress: { 2: 'all' }, placement: true },
    { progress: { 2: 'all', 3: 'open', 4: 'open', 5: 'open' }, placement: 'yes' }]) {
    const r = await owner('PUT', '/api/console/unlock/progress', { ...bad, reason: 'Testing', updatedAt: page.updatedAt });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  const body = { progress: { 2: 'bosses', 3: 'all', 4: 'open', 5: 'bosses' }, placement: false, reason: 'Learners should finish each level first' };
  assert.equal((await owner('PUT', '/api/console/unlock/progress', { ...body, reason: '' , updatedAt: page.updatedAt })).status, 400, 'a reason is needed');
  let r = await owner('PUT', '/api/console/unlock/progress', { ...body, updatedAt: page.updatedAt });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.progress, body.progress); assert.equal(r.body.placement, false);
  const pub = (await K.client()('GET', '/api/learning-rules')).body.rules;
  assert.deepEqual(pub.progress, body.progress); assert.equal(pub.placement, false);
  // progress is the app's to show: a run from a level not opened yet is still saved (offline progress arrives late)
  const pro = await K.subscription(payer.id, 'pro', { days: 30, source: 'purchase' });
  const s = await send(payer, ['l50']);
  assert.deepEqual(s.accepted, ['l50']);
  r = await owner('PUT', '/api/console/unlock/progress', { progress: { 2: 'open', 3: 'open', 4: 'open', 5: 'open' }, placement: true, reason: 'Back to open', updatedAt: r.body.updatedAt });
  assert.equal(r.status, 200);
  const log = await K.audits('unlock.progress');
  assert.equal(log.length, 2); assert.deepEqual(JSON.parse(log[0].detail).after.progress, body.progress);
  await K.run('DELETE FROM user_subscriptions WHERE id = ?1', pro);
});

test('a broken stored value means no rules, never an error', async () => {
  await K.run(`INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES ('learning_rules', '{not json', NULL, ?1)
               ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, new Date().toISOString());
  const pub = await K.client()('GET', '/api/learning-rules');
  assert.equal(pub.status, 200);
  assert.deepEqual(pub.body.rules, A.cleanRules(null));
  assert.equal(await allowed(payer.id, 'l1'), true);
  await K.run("UPDATE platform_settings SET value = ?1 WHERE key = 'learning_rules'", JSON.stringify({ locks: [{ scope: 'level', target: 'x', effect: 'closed' }, { scope: 'lesson', target: 'l9', effect: 'shut' }] }));
  assert.deepEqual((await K.client()('GET', '/api/learning-rules')).body.rules.closed, { levels: [], lessons: [] });
  await K.run("DELETE FROM platform_settings WHERE key = 'learning_rules'");
});

/* ---------------- the console page ---------------- */
test('the Unlock conditions page: in the menu by permission; Support may look, not change; no inline code', async () => {
  const s = await support('GET', '/admin/unlock');
  assert.equal(s.status, 200); assertNoInlineCode(s.text);
  assert.match(s.text, /<a class="nav-item is-current" href="\/admin\/unlock" aria-current="page">/);
  assert.ok(s.text.includes('src="/shared/lesson-access.js?v='));
  assert.ok(s.text.includes('data-readonly') && !s.text.includes('id="progressSave"'));
  const o = await owner('GET', '/admin/unlock');
  assert.ok(o.text.includes('id="progressSave"'));
  await K.setPermission('support', 'unlock.view', false);
  assert.equal((await support('GET', '/admin/unlock')).status, 403);
  assert.ok(!(await support('GET', '/admin')).text.includes('href="/admin/unlock"'), 'not in the menu without the permission');
  await K.setPermission('support', 'unlock.view', true);
  // the package page chooses lessons with the same shared rules
  const pkg = await owner('GET', '/admin/packages/starter');
  assertNoInlineCode(pkg.text);
  assert.ok(pkg.text.includes('name="lessonsMode"') && pkg.text.includes('src="/shared/course-meta.js?v='));
});
