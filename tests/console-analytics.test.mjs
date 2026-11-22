// Admin console, Phase 3 step 5: learning analytics (docs/ADMIN-PHASE-3.md).
//   node --test tests/console-analytics.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER, assertNoInlineCode } from './console-kit.mjs';
import '../shared/course-meta.js';

const META = globalThis.TC_META;
const IST = 330 * 60000, DAY = 86400000;
const dayAgo = (n) => new Date(Date.now() + IST - n * DAY).toISOString().slice(0, 10);
const isoAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
let S, K, owner, admin, support, learner;
const ids = {};

async function lessons(userId, done, { stuckOn = null, tries = 6, at = 1, wpm = 25 } = {}) {
  for (const [i, id] of META.ORDER.slice(0, done).entries()) {
    await K.run(`INSERT INTO lesson_scores (user_id, lesson_id, status, stars, best_wpm, best_accuracy, attempts, last_played, completed_at)
                 VALUES (?1, ?2, 'completed', 2, ?3, 95, 2, ?4, ?4)`, userId, id, wpm + i * 0.1, isoAgo(at));
  }
  if (stuckOn) await K.run(`INSERT INTO lesson_scores (user_id, lesson_id, status, best_wpm, best_accuracy, attempts, last_played) VALUES (?1, ?2, 'in_progress', 18, 85, ?3, ?4)`,
    userId, stuckOn, tries, isoAgo(at));
}
const day = (userId, d, seconds) => K.run('INSERT INTO daily_totals (user_id, day, seconds, runs) VALUES (?1, ?2, ?3, 2)', userId, d, seconds);

before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8783) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.69.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));
  learner = await K.account({ email: 'only.learner@example.com', name: 'Only Learner' });
  // six learners on the same early lesson: five stuck on META.ORDER[3], one through it
  const hard = META.ORDER[3];
  for (let i = 0; i < 6; i++) {
    const id = await K.customer({ name: `Learner ${i}`, email: `l${i}@example.com` });
    ids['l' + i] = id;
    if (i < 5) await lessons(id, 3, { stuckOn: hard, tries: 5 + i, wpm: 15 + i * 3 }); else await lessons(id, 16, { wpm: 41 });
    await day(id, dayAgo(i), 600);          // this week
  }
  // one learner who finished the whole course, practised 40 days ago (outside 30 days, inside 90)
  ids.done = await K.customer({ name: 'All Done', email: 'done@example.com' });
  await lessons(ids.done, 78, { at: 40, wpm: 55 });
  await day(ids.done, dayAgo(40), 1200);
  // a learner who practised 35 days ago: counts in "the 30 days before"
  ids.old = await K.customer({ name: 'Earlier One', email: 'earlier@example.com' });
  await day(ids.old, dayAgo(35), 300);
  // placement and keys
  await K.run(`INSERT INTO placement (user_id, level, wpm, accuracy, seconds, at) VALUES (?1, 1, 12, 90, 60, ?3), (?2, 2, 30, 94, 60, ?3)`, ids.l0, ids.l5, isoAgo(2));
  for (let i = 0; i < 6; i++) {
    await K.run('INSERT INTO key_stats (user_id, k, attempts, errors) VALUES (?1, ?2, 60, ?3), (?1, ?4, 100, 2)', ids['l' + i], 'q', 9, 'a');
  }
  await K.run('INSERT INTO key_stats (user_id, k, attempts, errors) VALUES (?1, ?2, 50, 40)', ids.l0, 'z'); // too few in all to rank
  // staff who practise are left out of every figure
  await lessons(admin.who.id, 4, { stuckOn: META.ORDER[4] }); await day(admin.who.id, dayAgo(0), 3600);
  await lessons(owner.who.id, 2); await day(owner.who.id, dayAgo(0), 3600);
  await K.run('INSERT INTO key_stats (user_id, k, attempts, errors) VALUES (?1, ?2, 900, 800)', owner.who.id, 'x');
  await K.run(`INSERT INTO placement (user_id, level, wpm, accuracy, seconds, at) VALUES (?1, 5, 90, 99, 60, ?2)`, admin.who.id, isoAgo(1));
});
after(() => { S.srv.server.close(); });

const get = (c, qs = '') => c('GET', '/api/console/learning-analytics' + (qs ? '?' + qs : ''));

test('who may see learning analytics', async () => {
  assert.equal((await K.client()('GET', '/api/console/learning-analytics')).status, 401);
  assert.equal((await learner.learner('GET', '/api/console/learning-analytics')).status, 401);
  assert.equal((await get(support)).status, 200, 'Support can see it');
  await K.setPermission('support', 'analytics.view', false);
  assert.equal((await get(support)).status, 403);
  assert.equal((await support('GET', '/admin/learning-analytics')).status, 403);
  await K.setPermission('support', 'analytics.view', true);
});

test('practice over the period, with the period before; staff left out', async () => {
  const d = (await get(admin)).body;
  assert.equal(d.range, '30d'); assert.equal(d.to, dayAgo(0)); assert.equal(d.from, dayAgo(29));
  assert.equal(d.learners, 9, 'every account but staff');
  assert.deepEqual(d.practice.learners, { now: 6, before: 2 });
  assert.deepEqual(d.practice.minutes, { now: 60, before: 25 });
  assert.deepEqual(d.practice.perLearner, { now: 10, before: 13 });
  assert.equal(d.days.length, 30); assert.equal(d.days.at(-1).day, dayAgo(0)); assert.equal(d.days.at(-1).learners, 1); assert.equal(d.days.at(-1).minutes, 10);
  assert.equal(d.practice.lessonsFinished.now, 5 * 3 + 16, 'first finishes in the period');
  assert.equal(d.practice.lessonsFinished.before, 78);
  const w = (await get(admin, 'range=7d')).body;
  assert.deepEqual(w.practice.learners, { now: 6, before: 0 }); assert.equal(w.days.length, 7);
  const q = (await get(admin, 'range=90d')).body;
  assert.equal(q.practice.learners.now, 8); assert.equal(q.days.length, 90);
  assert.equal((await get(admin, 'range=1y')).body.range, '30d', 'an unknown period means 30 days');
});

test('how far learners get, hardest lessons, placement, speed and weak keys', async () => {
  const d = (await get(admin)).body;
  const L = Object.fromEntries(d.levels.map((x) => [x.n, x]));
  assert.equal(L[1].started, 7); assert.equal(L[1].finished, 2, 'the one through Level 1, and the one who finished it all');
  assert.equal(L[2].started, 1); assert.equal(L[2].finished, 1);
  assert.equal(L[1].workingOn, 5 + 2, 'five stuck in Level 1, plus two who have not finished a lesson');
  assert.equal(L[2].workingOn, 1); assert.equal(L[5].workingOn, 0, 'the one who finished the course is counted apart');
  assert.equal(d.notStarted, 2); assert.equal(d.finishedCourse, 1);
  assert.equal(d.levels[0].name, 'Beginner'); assert.equal(d.levels[0].lessons, 16);
  assert.equal(d.hardest.length, 1, 'only lessons tried by five or more learners, where someone has not finished');
  const h = d.hardest[0];
  assert.equal(h.id, META.ORDER[3]); assert.equal(h.tried, 7); assert.equal(h.finished, 2); assert.equal(h.stuck, 5); assert.equal(h.n, META.BY_ID[META.ORDER[3]].n);
  assert.deepEqual(d.placement.byLevel.map((x) => x.learners), [1, 1, 0, 0, 0]); assert.equal(d.placement.taken, 2);
  assert.deepEqual(d.speed.map((b) => b.learners), [2, 3, 0, 1, 1], 'best speeds 15.2 18.2 | 21.2 24.2 27.2 | 42.5 | 62.7');
  assert.deepEqual(d.weakKeys.map((k) => k.key), ['q', 'a']); assert.equal(d.weakKeys[0].rate, 15); assert.equal(d.weakKeys[0].learners, 6);
});

test('a renamed lesson or level shows its published name; an empty start reads as nothing yet', async () => {
  await K.run(`INSERT INTO course_releases (version, edits, items, note, published_by, published_at) VALUES (1, ?1, '[]', 'Rename', NULL, ?2)`,
    JSON.stringify({ lessons: { [META.ORDER[3]]: { title: 'Home row, slowly' } }, levels: { 1: { name: 'First steps' } } }), new Date().toISOString());
  const d = (await get(admin)).body;
  assert.equal(d.hardest[0].title, 'Home row, slowly'); assert.equal(d.levels[0].name, 'First steps'); assert.equal(d.placement.byLevel[0].name, 'First steps');
  await K.run('DELETE FROM course_releases');
  // a fresh database: every figure is zero, nothing breaks
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  const S2 = { env, srv: await startServer(env, 8784) }; S2.base = `http://localhost:${S2.srv.port}`;
  const K2 = kit(S2, { ipPrefix: '10.69.1.' });
  const o = await K2.consoleLogin(await K2.owner());
  const e = (await get(o)).body;
  assert.equal(e.learners, 0); assert.deepEqual(e.practice.learners, { now: 0, before: 0 }); assert.deepEqual(e.hardest, []); assert.equal(e.notStarted, 0);
  assert.deepEqual(e.speed.map((b) => b.learners), [0, 0, 0, 0, 0]); assert.equal(e.placement.taken, 0);
  S2.srv.server.close();
});

test('the page: frame, no inline code, in the menu', async () => {
  const r = await support('GET', '/admin/learning-analytics');
  assert.equal(r.status, 200); assertNoInlineCode(r.text);
  for (const id of ['practiceTiles', 'activeChart', 'levelsBody', 'hardestBody', 'speedBody', 'placementBody', 'keysBody']) assert.ok(r.text.includes(`id="${id}"`), id);
  assert.ok(r.text.includes('/site/console/analytics.js?v='));
  assert.ok((await support('GET', '/admin')).text.includes('href="/admin/learning-analytics"'));
});
