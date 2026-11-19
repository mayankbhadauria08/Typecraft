// Admin console, Phase 3: the course as drafts and versions (docs/ADMIN-PHASE-3.md).
//   node --test tests/console-course.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER, assertNoInlineCode } from './console-kit.mjs';
import '../shared/course-meta.js';
import '../js/course.js';
import '../shared/course-edits.js';

const E = globalThis.TC_EDITS, C = globalThis.TC_COURSE;
let S, K, owner, admin, support, learner;
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8781) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.67.0.' });
  owner = await K.consoleLogin(await K.owner());
  admin = await K.consoleLogin(await K.account({ role: 'admin', name: 'Kavita Ops' }));
  support = await K.consoleLogin(await K.account({ role: 'support', name: 'Rahul Help' }));
  learner = await K.account({ email: 'course.learner@example.com', name: 'Course Learner' });
});
after(() => { S.srv.server.close(); });

const draft = (c, item, value) => c('PUT', `/api/console/course/drafts/${encodeURIComponent(item)}`, { value });
const course = () => owner('GET', '/api/console/course');
const publish = async (c, note = 'Clearer words for lesson 17') => {
  const d = (await course()).body.drafts.map((x) => ({ item: x.item, updatedAt: x.updatedAt }));
  return c('POST', '/api/console/course/publish', { note, drafts: d });
};

test('the shared rules: edits are checked against the keys each lesson has taught, and applied from the originals', () => {
  assert.deepEqual(E.fieldsOf('l7'), ['title', 'tip', 'keys', 'words', 'sentences']);
  assert.deepEqual(E.fieldsOf('l34'), ['title'], 'a boss lesson: only its title');
  let r = E.check({ lessons: { l7: { words: ['side', 'quiz'] } } });
  assert.equal(r.ok, false); assert.equal(r.errors[0].message, 'Uses keys lesson 17 has not taught yet: q u z.');
  r = E.check({ lessons: { l51: { sentences: ['A big Lad asks.'] } } });
  assert.equal(r.ok, true, 'capitals once Shift is taught');
  r = E.check({ lessons: { l7: { sentences: ['A kid hides'] } } });
  assert.match(r.errors[0].message, /A/, 'but not before');
  assert.equal(E.check({ levels: { 9: { name: 'x' } } }).ok, false);
  assert.equal(E.check({ units: { home: { name: 'Home keys' } } }).ok, true);
  assert.equal(E.check({ packs: { mine: { added: true, title: 'Mine', exercises: [{ id: 'one', title: 'One', text: 'Ünïcode' }] } } }).ok, false);
  E.apply({ lessons: { l7: { title: 'E and I', words: ['side', 'hide', 'idea', 'kids'] } }, levels: { 2: { name: 'Top row' } } });
  assert.equal(C.byId('l7').title, 'E and I'); assert.deepEqual(C.byId('l7').wordDrill, ['side', 'hide', 'idea', 'kids']);
  assert.equal(globalThis.TC_META.LEVELS[1].name, 'Top row');
  E.apply({});
  assert.equal(C.byId('l7').title, 'Reaching for E & I'); assert.equal(globalThis.TC_META.LEVELS[1].name, 'Intermediate');
});

test('before anything is published, learners get the original course', async () => {
  const r = await K.client()('GET', '/api/course');
  assert.equal(r.status, 200); assert.equal(r.body.version, 0); assert.deepEqual(r.body.edits, {});
  assert.match(r.headers.get('cache-control'), /max-age=60/);
});

test('who may see, edit and publish', async () => {
  assert.equal((await K.client()('GET', '/api/console/course')).status, 401);
  assert.equal((await learner.learner('GET', '/api/console/course')).status, 401);
  const seen = await support('GET', '/api/console/course');
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body.can, { edit: false, publish: false, audit: false });
  assert.equal((await draft(support, 'lesson:l7', { title: 'Nope' })).status, 403);
  assert.deepEqual((await admin('GET', '/api/console/course')).body.can, { edit: true, publish: false, audit: true });
  assert.equal((await admin('POST', '/api/console/course/publish', { note: 'Not allowed', drafts: [] })).status, 403);
  for (const bad of ['lesson:l999', 'lesson:', 'level:9', 'unit:moon', 'thing:x']) assert.equal((await draft(admin, bad, { title: 'x' })).status, 404, bad);
});

test('drafts: checked as they are saved, kept per item, never shown to learners until published', async () => {
  let r = await draft(admin, 'lesson:l7', { words: ['side', 'quiz'] });
  assert.equal(r.status, 400); assert.equal(r.body.error.fields.words, 'Uses keys lesson 17 has not taught yet: q u z.');
  r = await draft(admin, 'lesson:l7', { score: 3 });
  assert.equal(r.status, 400); assert.ok(r.body.error.fields.score);
  r = await draft(admin, 'lesson:l7', { title: 'E and I', words: ['side', 'hide', 'idea', 'kids', 'skies'], sentences: ['a kid hides a die', 'she sees ideas'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.draft.sentences, ['a kid hides a die', 'she sees ideas']);
  assert.equal((await draft(admin, 'level:2', { name: 'Top row', sub: 'Reach up for the top row and the numbers' })).status, 200);
  assert.equal((await draft(admin, 'unit:home', { name: 'Home keys' })).status, 200);
  assert.equal((await draft(admin, 'level:2', { target: 10 })).status, 400, 'speed targets are not changed here');
  // nothing published: back to the original is the original already
  r = await draft(admin, 'lesson:l8', { reset: true });
  assert.equal(r.body.note, 'It is already the original.');

  const one = (await admin('GET', '/api/console/course/lessons/l7')).body.lesson;
  assert.equal(one.draftValue.title, 'E and I'); assert.equal(one.draft, 'changed'); assert.equal(one.draftBy, 'Kavita Ops'); assert.equal(one.edited, false);
  assert.equal(one.original.title, 'Reaching for E & I'); assert.equal(one.allowed.includes('q'), false);
  const list = (await admin('GET', '/api/console/course/lessons')).body;
  assert.equal(list.items.length, 78); assert.equal(list.drafts, 3);
  assert.equal(list.items.find((l) => l.id === 'l7').draft, 'changed');
  assert.equal((await admin('GET', '/api/console/course/lessons/l999')).status, 404);
  assert.deepEqual((await K.client()('GET', '/api/course')).body.edits, {}, 'drafts are not public');
  const c = (await course()).body;
  assert.deepEqual(c.drafts.map((d) => d.name).sort(), ['Lesson 17: E and I', 'Level 2: Top row', 'Module: Home keys']);
  assert.equal(c.levels[1].draftValue.name, 'Top row'); assert.equal(c.levels[1].draft, 'changed');
  // a draft can be discarded
  assert.equal((await draft(admin, 'lesson:l9', { title: 'W and O' })).status, 200);
  assert.equal((await admin('DELETE', '/api/console/course/drafts/lesson%3Al9', {})).status, 200);
  assert.equal((await admin('DELETE', '/api/console/course/drafts/lesson%3Al9', {})).status, 404);
  const log = await K.audits('course.%');
  assert.deepEqual(log.map((a) => [a.action, a.target]).slice(-2), [['course.draft', 'lesson:l9'], ['course.discard', 'lesson:l9']]);
});

test('publishing: the drafts become a numbered version for everyone; a stale page cannot publish', async () => {
  // Admin cannot by default; the owner can, after confirming the password
  await K.stale(owner);
  let r = await publish(owner);
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'reauth_required');
  assert.equal((await owner('POST', '/api/admin/auth/reauth', { password: 'correct horse 9' })).status, 200);
  assert.equal((await owner('POST', '/api/console/course/publish', { note: 'x', drafts: [] })).status, 400);
  const before = (await course()).body.drafts.map((x) => ({ item: x.item, updatedAt: x.updatedAt }));
  // someone saves another draft after the page was loaded: publishing what the page showed is refused
  assert.equal((await draft(admin, 'lesson:l8', { title: 'R and T' })).status, 200);
  r = await owner('POST', '/api/console/course/publish', { note: 'From an old page', drafts: before });
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'drafts_changed');
  r = await publish(owner);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.version, 1); assert.equal(r.body.items, 4);
  const pub = await K.client()('GET', '/api/course');
  assert.equal(pub.body.version, 1);
  assert.equal(pub.body.edits.lessons.l7.title, 'E and I'); assert.equal(pub.body.edits.lessons.l8.title, 'R and T');
  assert.deepEqual(pub.body.edits.levels, { 2: { name: 'Top row', sub: 'Reach up for the top row and the numbers' } });
  assert.deepEqual(pub.body.edits.units, { home: { name: 'Home keys' } });
  const c = (await course()).body;
  assert.equal(c.version, 1); assert.equal(c.drafts.length, 0);
  assert.deepEqual(c.versions.map((v) => [v.version, v.note, v.changed, v.by]), [[1, 'Clearer words for lesson 17', 4, 'Mayank Owner']]);
  assert.equal((await admin('GET', '/api/console/course/lessons/l7')).body.lesson.edited, true);
  const v = (await owner('GET', '/api/console/course/versions/1')).body;
  assert.deepEqual(v.items.map((x) => x.name).sort(), ['Lesson 17: E and I', 'Lesson 18: R and T', 'Level 2: Top row', 'Module: Home keys']);
  assert.equal((await owner('GET', '/api/console/course/versions/9')).status, 404);
});

test('back to the original, and back to an earlier version, are new versions too; nothing is lost', async () => {
  let r = await draft(admin, 'lesson:l8', { reset: true });
  assert.equal(r.status, 200); assert.deepEqual(r.body.draft, { reset: true });
  r = await publish(owner, 'Lesson 18 back to the original');
  assert.equal(r.body.version, 2);
  let pub = (await K.client()('GET', '/api/course')).body;
  assert.equal(pub.edits.lessons.l8, undefined); assert.equal(pub.edits.lessons.l7.title, 'E and I');
  r = await owner('POST', '/api/console/course/versions/1/restore', { note: 'Lesson 18 was better renamed' });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.version, 3); assert.equal(r.body.items, 1);
  pub = (await K.client()('GET', '/api/course')).body;
  assert.equal(pub.edits.lessons.l8.title, 'R and T');
  assert.equal((await owner('POST', '/api/console/course/versions/3/restore', { note: 'Again' })).body.error.fields.version, 'This is already the live version.');
  assert.equal((await owner('POST', '/api/console/course/versions/1/restore', { note: '' })).status, 400);
  const log = await K.audits('course.%');
  assert.deepEqual(log.filter((a) => a.action !== 'course.draft').map((a) => [a.action, a.target]).slice(-3),
    [['course.publish', 'course:1'], ['course.publish', 'course:2'], ['course.restore', 'course:3']]);
});

test('a stored version that no longer checks loses only the broken parts', async () => {
  await K.run("INSERT INTO course_releases (version, edits, items, note, published_by, published_at) VALUES (4, ?1, '[]', 'broken', NULL, ?2)",
    JSON.stringify({ lessons: { l7: { title: 'Fine', words: ['quiz'] }, l999: { title: 'x' } }, levels: { 2: { name: '' } } }), new Date().toISOString());
  const pub = (await K.client()('GET', '/api/course')).body;
  assert.equal(pub.version, 4);
  assert.deepEqual(pub.edits, { lessons: { l7: { title: 'Fine' } } });
  await K.run('DELETE FROM course_releases WHERE version = 4');
});

test('course pages: frames by permission, the course loaded on the lesson page, no inline code', async () => {
  for (const [path, needs] of [['/admin/course', 'id="draftsBody"'], ['/admin/course/lessons', 'id="listBody"'], ['/admin/course/lessons/l7', 'id="lessonForm"'],
    ['/admin/course/levels', 'Speed targets decide crowns'], ['/admin/course/modules', 'id="listBody"']]) {
    const r = await support(path === '/admin/course/lessons/l7' ? 'GET' : 'GET', path);
    assert.equal(r.status, 200, path); assertNoInlineCode(r.text); assert.ok(r.text.includes(needs), path);
  }
  const lesson = (await support('GET', '/admin/course/lessons/l7')).text;
  assert.ok(lesson.includes('src="/js/course.js?v=') && lesson.includes('src="/shared/course-edits.js?v='));
  assert.ok(lesson.includes('data-readonly') && !lesson.includes('id="saveDraft"'), 'Support reads, does not edit');
  assert.ok((await admin('GET', '/admin/course/lessons/l7')).text.includes('id="saveDraft"'));
  assert.ok(!(await admin('GET', '/admin/course')).text.includes('id="publishForm"'), 'Admin does not publish by default');
  assert.ok((await owner('GET', '/admin/course')).text.includes('id="publishForm"'));
  assert.ok((await support('GET', '/admin/course/lessons/l999')).text.includes('id="recMissing"'), 'an unknown lesson: the page says so once its data does not come');
  const menu = (await support('GET', '/admin')).text;
  for (const p of ['/admin/course"', '/admin/course/lessons"', '/admin/course/levels"', '/admin/course/modules"']) assert.ok(menu.includes(`href="${p}`), p);
});

/* ---------------- step 3: practice packs ---------------- */
test('practice packs: edit, hide, add and reorder through drafts; learners get them behind the plan check; never in the public course', async () => {
  const list = (await admin('GET', '/api/console/course/packs')).body;
  assert.deepEqual(list.items.map((p) => p.id), ['numbers', 'code', 'business', 'exam']);
  const numbers = (await admin('GET', '/api/console/course/packs/numbers')).body;
  assert.equal(numbers.added, false); assert.equal(numbers.pack.exercises.length, 12);
  assert.equal((await admin('GET', '/api/console/course/packs/nope')).status, 404);
  // edit an original pack: hide one exercise, change one text, add one
  const ex = numbers.original.exercises.map((x) => ({ ...x }));
  ex[0].hidden = true; ex[1].text = 'Plot 14, Sector 21, Gandhinagar 382021.';
  ex.push({ id: 'aadhaar-free', title: 'Form numbers', text: 'Form No. 48-B, Serial 00417, Ref CK/22/0019.\nSigned: R. Mehta' });
  let r = await draft(admin, 'pack:numbers', { title: 'Numbers and data entry', description: numbers.original.description, hidden: false, exercises: ex });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await draft(admin, 'pack:numbers', { title: 'X', exercises: [{ id: 'aa', title: 'A', text: 'naïve' }] });
  assert.equal(r.status, 400); assert.match(Object.values(r.body.error.fields)[0], /cannot type/);
  assert.equal((await draft(admin, 'pack:numbers', { added: true, title: 'X', exercises: [] })).status, 400, 'an original pack is not new');
  // a new pack, and the order
  r = await draft(admin, 'pack:ssc-passages', { added: true, title: 'SSC typing passages', description: 'Ten-minute passages like the SSC typing test.',
    exercises: [{ id: 'p1', title: 'Passage 1', text: 'The office will remain open on Saturday for the annual audit. Staff are requested to bring their files.' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await draft(admin, 'pack:fresh', { title: 'Not marked new', exercises: [] })).status, 400);
  r = await draft(admin, 'order:packs', { order: ['exam', 'ssc-passages', 'numbers', 'code', 'business'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const pending = (await admin('GET', '/api/console/course/packs')).body;
  assert.deepEqual(pending.drafted.map((p) => p.id), ['ssc-passages']);
  assert.deepEqual(pending.order, { order: ['exam', 'ssc-passages', 'numbers', 'code', 'business'] });
  // learners: nothing changes until it is published
  const sub = await K.subscription(learner.id, 'pro', { days: 30, source: 'purchase' });
  let packs = (await learner.learner('GET', '/api/content/packs')).body.packs;
  assert.deepEqual(packs.map((p) => p.id), ['numbers', 'code', 'business', 'exam']);
  r = await publish(owner, 'Practice packs: SSC passages, numbers tidied');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  packs = (await learner.learner('GET', '/api/content/packs')).body.packs;
  assert.deepEqual(packs.map((p) => p.id), ['exam', 'ssc-passages', 'numbers', 'code', 'business']);
  const n = packs.find((p) => p.id === 'numbers');
  assert.equal(n.exerciseCount, 12, 'one hidden, one added');
  assert.ok(!n.exercises.some((x) => x.id === ex[0].id) && n.exercises.some((x) => x.id === 'aadhaar-free'));
  const one = (await learner.learner('GET', '/api/content/packs/ssc-passages')).body.pack;
  assert.equal(one.exercises[0].title, 'Passage 1');
  assert.equal((await learner.learner('GET', '/api/content/packs/numbers')).body.pack.exercises.find((x) => x.id === 'pincodes').text, 'Plot 14, Sector 21, Gandhinagar 382021.');
  // the plan check still applies, and the public course never carries pack texts
  const free = await K.account({ email: 'free.packs@example.com', name: 'Free Packs' });
  assert.equal((await free.learner('GET', '/api/content/packs/ssc-passages')).status, 402);
  assert.ok((await free.learner('GET', '/api/content/packs')).body.packs.every((p) => p.locked));
  const pub = await K.client()('GET', '/api/course');
  assert.ok(!('packs' in pub.body.edits) && !pub.text.includes('Passage 1'));
  // removing the new pack: a draft, then gone after publishing; an earlier version still has it
  assert.equal((await draft(admin, 'pack:ssc-passages', { reset: true })).status, 200);
  await publish(owner, 'SSC passages moved out for now');
  packs = (await learner.learner('GET', '/api/content/packs')).body.packs;
  assert.ok(!packs.some((p) => p.id === 'ssc-passages'));
  assert.equal((await learner.learner('GET', '/api/content/packs/ssc-passages')).status, 404);
  await K.run('DELETE FROM user_subscriptions WHERE id = ?1', sub);
});

test('exercise pages: frames by permission, no inline code', async () => {
  const list = await support('GET', '/admin/course/exercises');
  assert.equal(list.status, 200); assertNoInlineCode(list.text);
  assert.ok(!list.text.includes('id="newPack"'));
  assert.ok((await admin('GET', '/admin/course/exercises')).text.includes('id="newPack"'));
  const one = await support('GET', '/admin/course/exercises/numbers');
  assert.equal(one.status, 200); assertNoInlineCode(one.text); assert.ok(one.text.includes('data-readonly'));
  assert.ok((await admin('GET', '/admin/course/exercises/numbers')).text.includes('id="saveDraft"'));
});
