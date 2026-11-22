// Admin console, Phase 3 step 4: student progress (docs/ADMIN-PHASE-3.md).
//   node --test tests/console-progress.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER, assertNoInlineCode } from './console-kit.mjs';
import '../shared/course-meta.js';

const META = globalThis.TC_META;
const IST = 330 * 60000, DAY = 86400000;
const dayAgo = (n) => new Date(Date.now() + IST - n * DAY).toISOString().slice(0, 10);
let S, K, owner, admin, support, asha, ravi, quietId, neverId;

/** lesson_scores rows: the first `done` lessons of the course finished; extra: [[lessonId, { status, attempts, ... }]] */
async function scores(userId, done, extra = []) {
  const now = new Date().toISOString();
  for (const [i, id] of META.ORDER.slice(0, done).entries()) {
    await K.run(`INSERT INTO lesson_scores (user_id, lesson_id, status, stars, crown, best_wpm, best_accuracy, attempts, last_played, completed_at)
                 VALUES (?1, ?2, 'completed', ?3, ?4, ?5, ?6, ?7, ?8, ?8)`, userId, id, i % 3 === 0 ? 3 : 2, i === 0 ? 1 : 0, 20 + i, 94 + (i % 5), 1 + (i % 2), now);
  }
  for (const [id, x] of extra) {
    await K.run(`INSERT INTO lesson_scores (user_id, lesson_id, status, stars, best_wpm, best_accuracy, attempts, last_played) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?7)`,
      userId, id, x.status || 'in_progress', x.wpm || 0, x.accuracy || 0, x.attempts, now);
  }
}
const day = (userId, d, seconds, wpm = 30) => K.run(`INSERT INTO daily_totals (user_id, day, seconds, runs, best_wpm, acc_sum, acc_count) VALUES (?1, ?2, ?3, 3, ?4, 285, 3)`, userId, d, seconds, wpm);

before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8782) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.68.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));
  // Asha: finished Level 1, stuck on the next lesson, practised today and yesterday
  asha = await K.account({ email: 'asha.learner@example.com', name: 'Asha Verma' });
  const next = META.ORDER[16];
  await scores(asha.id, 16, [[next, { attempts: 7, wpm: 24, accuracy: 88 }]]);
  await day(asha.id, dayAgo(0), 600, 34); await day(asha.id, dayAgo(1), 300, 31);
  for (const [k, attempts, errors] of [['q', 40, 10], ['a', 120, 3], ['z', 6, 4], [';', 50, 9]]) {
    await K.run('INSERT INTO key_stats (user_id, k, attempts, errors) VALUES (?1, ?2, ?3, ?4)', asha.id, k, attempts, errors);
  }
  await K.run(`INSERT INTO placement (user_id, level, wpm, accuracy, seconds, at) VALUES (?1, 2, 27.6, 93.2, 60, ?2)`, asha.id, new Date().toISOString());
  await K.run(`INSERT INTO user_totals (user_id, rev, xp, streak_count, streak_best) VALUES (?1, 'r1', 1450, 2, 9)`, asha.id);
  // Ravi: three lessons, a while ago (8 days)
  ravi = await K.account({ email: 'ravi.learner@example.com', name: 'Ravi Kumar' });
  await scores(ravi.id, 3);
  await day(ravi.id, dayAgo(8), 900, 22);
  // Quiet: last practice 40 days ago. Never: no practice at all
  quietId = await K.customer({ name: 'Meena Quiet', email: 'meena.quiet@example.com' });
  await scores(quietId, 1); await day(quietId, dayAgo(40), 120, 15);
  neverId = await K.customer({ name: 'Nikhil New', email: 'nikhil.new@example.com' });
  // staff who practise are still left out
  await scores(admin.who.id, 5); await day(admin.who.id, dayAgo(0), 60);
});
after(() => { S.srv.server.close(); });

const list = (c, qs = '') => c('GET', '/api/console/progress' + (qs ? '?' + qs : ''));
const names = (r) => r.body.items.map((x) => x.fullName);

test('who may see progress', async () => {
  assert.equal((await K.client()('GET', '/api/console/progress')).status, 401);
  assert.equal((await asha.learner('GET', '/api/console/progress')).status, 401, 'a learner is not staff');
  assert.equal((await asha.learner('GET', `/api/console/progress/${asha.id}`)).status, 401);
  assert.equal((await support('GET', '/api/console/progress')).status, 200, 'Support can see it');
  await K.setPermission('support', 'progress.view', false);
  assert.equal((await support('GET', '/api/console/progress')).status, 403);
  assert.equal((await support('GET', `/api/console/progress/${asha.id}`)).status, 403);
  assert.equal((await support('GET', '/admin/progress')).status, 403);
  await K.setPermission('support', 'progress.view', true);
});

test('the list: learners only, with level, lessons, speed, last practice and stuck', async () => {
  const r = await list(admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(names(r), ['Asha Verma', 'Ravi Kumar', 'Meena Quiet', 'Nikhil New'], 'last practice first; staff left out; never practised last');
  const a = r.body.items[0];
  assert.equal(a.lessonsDone, 16); assert.equal(a.level, 2); assert.equal(a.levelName, 'Intermediate'); assert.equal(a.finished, false);
  assert.equal(a.bestWpm, 35, 'the best of any lesson, finished or not'); assert.equal(a.stuck, 1); assert.equal(a.lastPractice, dayAgo(0)); assert.equal(a.minutes30, 15);
  assert.ok(a.accuracy > 90 && a.accuracy < 100);
  assert.equal(r.body.items[3].lastPractice, null); assert.equal(r.body.items[3].level, 1); assert.equal(r.body.items[3].bestWpm, 0);
  assert.equal(r.body.totalLessons, 78); assert.equal(r.body.today, dayAgo(0));
  assert.deepEqual(r.body.levels.map((L) => L.id), ['1', '2', '3', '4', '5']);
  assert.ok(!JSON.stringify(r.body).includes('password'), 'nothing secret');
});

test('filters and sorting', async () => {
  assert.deepEqual(names(await list(admin, 'level=2')), ['Asha Verma']);
  assert.deepEqual(names(await list(admin, 'level=1')), ['Ravi Kumar', 'Meena Quiet', 'Nikhil New']);
  assert.deepEqual(names(await list(admin, 'level=3')), []);
  assert.deepEqual(names(await list(admin, 'activity=active7')), ['Asha Verma']);
  assert.deepEqual(names(await list(admin, 'activity=quiet30')), ['Meena Quiet']);
  assert.deepEqual(names(await list(admin, 'activity=never')), ['Nikhil New']);
  assert.deepEqual(names(await list(admin, 'stuck=1')), ['Asha Verma']);
  assert.deepEqual(names(await list(admin, 'q=ravi')), ['Ravi Kumar']);
  assert.deepEqual(names(await list(admin, 'q=%25')), [], 'a % sign is just text');
  assert.deepEqual(names(await list(admin, 'sort=done')).slice(0, 2), ['Asha Verma', 'Ravi Kumar']);
  assert.deepEqual(names(await list(admin, 'sort=name')), ['Asha Verma', 'Meena Quiet', 'Nikhil New', 'Ravi Kumar']);
  assert.equal((await list(admin, 'level=9&sort=nope&activity=x')).body.total, 4, 'unknown values mean any');
  const r = await list(admin, 'level=2&activity=active7&stuck=1&q=asha');
  assert.equal(r.body.total, 1);
});

test('one learner: summary, every lesson in course order, weak keys, 30 days, placement', async () => {
  const r = await admin('GET', `/api/console/progress/${asha.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body;
  assert.equal(d.learner.fullName, 'Asha Verma'); assert.equal(d.learner.disabled, false);
  assert.equal(d.plan.name, 'Free'); assert.ok(d.plan.lessons);
  assert.equal(d.summary.lessonsDone, 16); assert.equal(d.summary.level, 2); assert.equal(d.summary.stuck, 1);
  assert.equal(d.summary.minutes, 15); assert.equal(d.summary.xp, 1450); assert.deepEqual(d.summary.streak, { now: 2, best: 9 });
  assert.equal(d.summary.rank, META.rankFor(1450).name); assert.equal(d.summary.crowns, 1);
  assert.equal(d.lessons.length, 78); assert.deepEqual(d.lessons.map((l) => l.id), META.ORDER);
  const stuck = d.lessons[16];
  assert.equal(stuck.status, 'in_progress'); assert.equal(stuck.stuck, true); assert.equal(stuck.attempts, 7);
  assert.equal(d.lessons[17].status, 'not_started'); assert.equal(d.lessons[17].stuck, false);
  assert.deepEqual(d.weakKeys.map((k) => k.key), ['q', ';', 'a'], 'worst first; a key typed fewer than 20 times is left out');
  assert.equal(d.weakKeys[0].rate, 25);
  assert.deepEqual(d.days.map((x) => x.day), [dayAgo(1), dayAgo(0)]); assert.equal(d.days[1].minutes, 10); assert.equal(d.days[1].accuracy, 95);
  assert.equal(d.since, dayAgo(29));
  assert.deepEqual(d.placement, { level: 2, wpm: 28, accuracy: 93, at: d.placement.at });
  assert.equal(d.can.customer, true);
  // a learner who has not started; unknown and malformed IDs
  const n = (await support('GET', `/api/console/progress/${neverId}`)).body;
  assert.equal(n.summary.lessonsDone, 0); assert.equal(n.summary.level, 1); assert.equal(n.summary.accuracy, null); assert.equal(n.placement, null);
  assert.deepEqual(n.weakKeys, []); assert.deepEqual(n.days, []); assert.equal(n.summary.lastPractice, null);
  assert.equal((await admin('GET', '/api/console/progress/00000000-0000-4000-8000-000000000000')).status, 404);
  assert.equal((await admin('GET', '/api/console/progress/bad%20id')).status, 404);
});

test('a renamed lesson or level shows its published name', async () => {
  await K.run(`INSERT INTO course_releases (version, edits, items, note, published_by, published_at) VALUES (1, ?1, '[]', 'Rename', NULL, ?2)`,
    JSON.stringify({ lessons: { [META.ORDER[16]]: { title: 'Top row, slowly' } }, levels: { 2: { name: 'Top row' } } }), new Date().toISOString());
  const one = (await admin('GET', `/api/console/progress/${asha.id}`)).body;
  assert.equal(one.lessons[16].title, 'Top row, slowly'); assert.equal(one.summary.levelName, 'Top row');
  assert.equal((await list(admin, 'level=2')).body.items[0].levelName, 'Top row');
  assert.equal((await list(admin)).body.levels[1].name, 'Level 2: Top row');
  await K.run('DELETE FROM course_releases');
});

test('pages: frames by permission, no inline code, in the menu', async () => {
  for (const [path, needs] of [['/admin/progress', 'id="listBody"'], [`/admin/progress/${asha.id}`, 'id="daysChart"']]) {
    const r = await support('GET', path);
    assert.equal(r.status, 200, path); assertNoInlineCode(r.text); assert.ok(r.text.includes(needs), path);
  }
  assert.ok((await support('GET', `/admin/progress/${asha.id}`)).text.includes('/site/console/charts.js?v='));
  assert.ok((await support('GET', '/admin')).text.includes('href="/admin/progress"'));
});
