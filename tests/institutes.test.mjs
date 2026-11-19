// Institutes, Release 1 part 1: seats, join codes, staff access, weak keys (docs/INSTITUTES.md).
//   node --test tests/institutes.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, OWNER } from './console-kit.mjs';
import { newId, newJoinCode, cleanJoinCode, showJoinCode } from '../src/institute-access.js';
import { entitlementsFor } from '../src/entitlements.js';

let S, K;
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER, SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8787) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.73.0.' });
});
after(() => { S.srv.server.close(); });

const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
let n = 0;
async function institute({ name = `Sharma Typing Centre ${++n}`, seats = 2, status = 'active', starts = -1, ends = 90, pkg = 'premium' } = {}) {
  const id = newId('ins');
  await K.run(`INSERT INTO institutes (id, name, package_id, seats, price_paise, starts_at, ends_at, status, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, ?8, ?8)`, id, name, pkg, seats, iso(starts), iso(ends), status, iso(0));
  return id;
}
async function batch(instituteId, name, { code = newJoinCode(), archived = false } = {}) {
  const id = newId('bat');
  await K.run(`INSERT INTO batches (id, institute_id, name, join_code, archived_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
    id, instituteId, name, code, archived ? iso(0) : null, iso(0));
  return { id, code };
}
async function staff(instituteId, who, role, status = 'active') {
  const id = newId('stf');
  await K.run(`INSERT INTO institute_staff (id, institute_id, user_id, email, role, status, invited_at, joined_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
    id, instituteId, status === 'invited' ? null : who.id, who.email, role, status, iso(0));
  return id;
}
const assign = (batchId, staffId) => K.run('INSERT INTO batch_teachers (batch_id, staff_id, assigned_at) VALUES (?1, ?2, ?3)', batchId, staffId, iso(0));
const ent = async (who) => (await who.learner('GET', '/api/me/subscriptions')).body.entitlements;
const join = (who, code, adult = true) => who.learner('POST', '/api/institutes/join', { code, adult });
const peek = (who, code) => who.learner('GET', `/api/institutes/join?code=${encodeURIComponent(code)}`);

/* ---------------- codes ---------------- */
test('join codes: 8 characters without look-alikes, typed any way', () => {
  for (let i = 0; i < 200; i++) assert.match(newJoinCode(), /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(cleanJoinCode('abcd-efgh'), 'ABCDEFGH');
  assert.equal(cleanJoinCode(' AB CD EF GH '), 'ABCDEFGH');
  assert.equal(cleanJoinCode('ABCD-EFG0'), null, 'zero is not used');
  assert.equal(cleanJoinCode('ABCDEFGHJ'), null);
  assert.equal(showJoinCode('ABCDEFGH'), 'ABCD-EFGH');
  assert.match(newId('ins'), /^ins_[0-9a-f]{20}$/);
});

/* ---------------- joining ---------------- */
test('a student joins with a code, gets the plan until the end date, and can leave', async () => {
  const ins = await institute({ seats: 2 });
  const a = await batch(ins, 'Morning batch'), b = await batch(ins, 'Evening batch');
  const asha = await K.account({ email: 'asha.ins@example.com', name: 'Asha Verma' });
  assert.equal((await ent(asha)).plan, 'free');
  let mine = await asha.learner('GET', '/api/me/institutes');
  assert.deepEqual([mine.body.seats, mine.body.staff], [[], []]);

  let r = await peek(asha, showJoinCode(a.code).toLowerCase());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.batch.name, 'Morning batch');
  assert.equal(r.body.plan.name, 'Premium');
  assert.equal(r.body.canJoin, true);
  assert.equal(r.body.code, showJoinCode(a.code));

  r = await join(asha, a.code, false);
  assert.equal(r.status, 400);
  assert.ok(r.body.error.fields.adult, 'must confirm 18 or older');
  r = await join(asha, showJoinCode(a.code));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.joined, true); assert.equal(r.body.already, false);

  const e = await ent(asha);
  assert.equal(e.plan, 'premium');
  assert.ok(e.features.includes('lessons.all'));
  const row = await K.one('SELECT ends_at FROM institutes WHERE id = ?1', ins);
  assert.equal(e.expiresAt, row.ends_at);
  assert.equal(e.seats.length, 1); assert.equal(e.seats[0].batchName, 'Morning batch');
  assert.deepEqual(e.subscriptions, [], 'a seat is not a bought plan period');
  const adult = await K.one('SELECT adult_confirmed_at FROM institute_students WHERE user_id = ?1', asha.id);
  assert.ok(adult.adult_confirmed_at);

  // again: nothing changes; another batch of the same institute: refused
  r = await join(asha, a.code);
  assert.equal(r.status, 200); assert.equal(r.body.already, true);
  assert.equal((await peek(asha, a.code)).body.joined, true);
  r = await join(asha, b.code);
  assert.equal(r.status, 409); assert.equal(r.body.error.code, 'other_batch');
  assert.match(r.body.error.message, /Morning batch/);

  mine = await asha.learner('GET', '/api/me/institutes');
  assert.equal(mine.body.seats.length, 1);
  assert.equal(mine.body.seats[0].givesPlan, true);
  const seatId = mine.body.seats[0].id;

  // leaving: the seat is free again, the plan ends, the history row stays
  assert.equal((await asha.learner('POST', `/api/me/institutes/${seatId}/leave`, {})).status, 200);
  assert.equal((await asha.learner('POST', `/api/me/institutes/${seatId}/leave`, {})).status, 404, 'only once');
  assert.equal((await ent(asha)).plan, 'free');
  const left = await K.one('SELECT status, ended_at, ended_by FROM institute_students WHERE id = ?1', seatId);
  assert.equal(left.status, 'left'); assert.ok(left.ended_at); assert.equal(left.ended_by, null);
  // someone else's seat can't be given back for them
  const ravi = await K.account({ email: 'ravi.ins@example.com', name: 'Ravi Kumar' });
  assert.equal((await join(ravi, a.code)).status, 201);
  const raviSeat = (await ravi.learner('GET', '/api/me/institutes')).body.seats[0].id;
  assert.equal((await asha.learner('POST', `/api/me/institutes/${raviSeat}/leave`, {})).status, 404);
  assert.equal((await ent(ravi)).plan, 'premium');
});

test('seats run out; a freed seat can be taken; two students racing for the last seat: only one gets it', async () => {
  const ins = await institute({ seats: 2 });
  const a = await batch(ins, 'Batch A');
  const s = [];
  for (let i = 0; i < 4; i++) s.push(await K.account({ email: `seat${i}.ins@example.com`, name: `Seat ${i}` }));
  assert.equal((await join(s[0], a.code)).status, 201);
  // the last seat, two at once
  const [x, y] = await Promise.all([join(s[1], a.code), join(s[2], a.code)]);
  assert.deepEqual([x.status, y.status].sort(), [201, 409]);
  assert.equal([x, y].find((r) => r.status === 409).body.error.code, 'seats_full');
  const used = await K.one("SELECT COUNT(*) AS n FROM institute_students WHERE institute_id = ?1 AND status = 'active'", ins);
  assert.equal(used.n, 2);
  let p = await peek(s[3], a.code);
  assert.equal(p.body.canJoin, false); assert.equal(p.body.problem.code, 'seats_full');
  // one leaves: the next one can join
  const first = (await s[0].learner('GET', '/api/me/institutes')).body.seats[0].id;
  await s[0].learner('POST', `/api/me/institutes/${first}/leave`, {});
  assert.equal((await join(s[3], a.code)).status, 201);
});

test('codes that open nothing: wrong, archived batch, closed institute, joining switched off', async () => {
  const ins = await institute();
  const arch = await batch(ins, 'Old batch', { archived: true });
  const off = await batch(ins, 'No code', { code: null });
  const closedIns = await institute({ status: 'closed' });
  const closed = await batch(closedIns, 'Closed batch');
  const u = await K.account({ email: 'codes.ins@example.com' });
  for (const code of ['ABCD-EFGH', arch.code, closed.code, 'not a code']) {
    const r = await peek(u, code);
    assert.equal(r.status, 404, code); assert.equal(r.body.error.code, 'bad_code');
    const j = await join(u, code);
    assert.equal(j.status, 400, code); assert.ok(j.body.error.fields.code);
  }
  assert.ok(off.id);
  assert.equal(await K.one('SELECT 1 AS x FROM institute_students WHERE user_id = ?1', u.id), null);
});

test('not paid yet, not started, ended or paused: no joining, and a seat gives no plan', async () => {
  const pending = await batch(await institute({ status: 'pending' }), 'P');
  const later = await batch(await institute({ starts: 5 }), 'L');
  const ended = await batch(await institute({ starts: -100, ends: -1 }), 'E');
  const u = await K.account({ email: 'closed.ins@example.com' });
  for (const [b, code] of [[pending, 'not_open'], [later, 'not_open'], [ended, 'ended']]) {
    const p = await peek(u, b.code);
    assert.equal(p.status, 200); assert.equal(p.body.canJoin, false); assert.equal(p.body.problem.code, code);
    const r = await join(u, b.code);
    assert.equal(r.status, 409); assert.equal(r.body.error.code, code);
  }
  // a seat in an institute that is then paused, or whose term ends, stops giving the plan; progress stays
  const ins = await institute();
  const b = await batch(ins, 'Paused later');
  assert.equal((await join(u, b.code)).status, 201);
  assert.equal((await ent(u)).plan, 'premium');
  await K.run("UPDATE institutes SET status = 'suspended' WHERE id = ?1", ins);
  assert.equal((await ent(u)).plan, 'free');
  let mine = await u.learner('GET', '/api/me/institutes');
  assert.equal(mine.body.seats[0].givesPlan, false);
  await K.run("UPDATE institutes SET status = 'active', ends_at = ?2 WHERE id = ?1", ins, iso(-0.01));
  assert.equal((await ent(u)).plan, 'free');
  await K.run('UPDATE institutes SET ends_at = ?2 WHERE id = ?1', ins, iso(30));
  assert.equal((await ent(u)).plan, 'premium', 'renewed: the same seat gives the plan again');
});

test('a plan of your own and a seat: whichever lasts longer; the better plan shows', async () => {
  const u = await K.account({ email: 'both.ins@example.com' });
  await K.subscription(u.id, 'starter', { days: 200 });
  const ins = await institute({ ends: 60, pkg: 'premium' });
  const b = await batch(ins, 'Both');
  assert.equal((await join(u, b.code)).status, 201);
  const e = await ent(u);
  assert.equal(e.plan, 'premium', 'the higher plan');
  assert.ok(Date.parse(e.expiresAt) > Date.now() + 150 * 86400000, 'until the later end date');
  assert.ok(e.features.includes('insights') && e.features.includes('lessons.all'));
  assert.equal(e.subscriptions.length, 1); assert.equal(e.seats.length, 1);
});

test('signed out: no joining; wrong guesses are rate limited per account', async () => {
  const anon = K.client();
  assert.equal((await anon('GET', '/api/institutes/join?code=ABCDEFGH')).status, 401);
  assert.equal((await anon('POST', '/api/institutes/join', { code: 'ABCDEFGH', adult: true })).status, 401);
  assert.equal((await anon('GET', '/api/me/institutes')).status, 401);
  const u = await K.account({ email: 'guess.ins@example.com' });
  let last = null;
  for (let i = 0; i < 21; i++) last = await peek(u, 'ZZZZ-ZZZZ');
  assert.equal(last.status, 429);
  const ok = await batch(await institute(), 'After');
  assert.equal((await join(u, ok.code)).status, 429, 'the limit holds for a right code too');
});

/* ---------------- staff: admin and teachers ---------------- */
test('staff see their own institute; teachers only their batches; everyone else gets nothing', async () => {
  const ins = await institute({ seats: 5 });
  const other = await institute();
  const a = await batch(ins, 'Batch A'), b = await batch(ins, 'Batch B');
  const otherBatch = await batch(other, 'Elsewhere');
  const boss = await K.account({ email: 'boss.ins@example.com', name: 'Institute Admin' });
  const tina = await K.account({ email: 'tina.ins@example.com', name: 'Tina Teacher' });
  const gone = await K.account({ email: 'gone.ins@example.com', name: 'Gone Teacher' });
  const later = await K.account({ email: 'later.ins@example.com', name: 'Invited Teacher' });
  const kid = await K.account({ email: 'student.ins@example.com', name: 'A Student' });
  await staff(ins, boss, 'admin');
  const t = await staff(ins, tina, 'teacher');
  await assign(a.id, t);
  const g = await staff(ins, gone, 'teacher', 'removed');
  await assign(b.id, g);
  await staff(ins, later, 'teacher', 'invited');
  assert.equal((await join(kid, a.code)).status, 201);

  // the admin: every batch, the seats, the join codes
  let r = await boss.learner('GET', `/api/institutes/${ins}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.role, 'admin');
  assert.equal(r.body.institute.seatsUsed, 1); assert.equal(r.body.institute.seats, 5);
  assert.deepEqual(r.body.batches.map((x) => x.name), ['Batch A', 'Batch B']);
  assert.equal(r.body.batches[0].students, 1);
  r = await boss.learner('GET', `/api/institutes/${ins}/batches/${b.id}`);
  assert.equal(r.status, 200); assert.equal(r.body.batch.joinCode, showJoinCode(b.code));
  assert.equal(r.body.institute.notes, undefined, 'private notes never leave the console');

  // a teacher: only the batch they teach
  r = await tina.learner('GET', `/api/institutes/${ins}`);
  assert.equal(r.status, 200); assert.equal(r.body.role, 'teacher');
  assert.deepEqual(r.body.batches.map((x) => x.name), ['Batch A']);
  r = await tina.learner('GET', `/api/institutes/${ins}/batches/${a.id}`);
  assert.equal(r.status, 200); assert.equal(r.body.batch.students, 1);
  assert.deepEqual(r.body.batch.teachers.map((x) => x.name), ['Tina Teacher']);
  assert.equal((await tina.learner('GET', `/api/institutes/${ins}/batches/${b.id}`)).status, 404, 'not their batch');
  assert.equal((await tina.learner('GET', `/api/institutes/${other}`)).status, 404, 'not their institute');
  assert.equal((await tina.learner('GET', `/api/institutes/${other}/batches/${otherBatch.id}`)).status, 404);
  assert.equal((await boss.learner('GET', `/api/institutes/${ins}/batches/${otherBatch.id}`)).status, 404, 'a batch of another institute under this one');

  // removed, invited-only, students and strangers: nothing; signed out: 401
  for (const who of [gone, later, kid]) {
    assert.equal((await who.learner('GET', `/api/institutes/${ins}`)).status, 404, who.email);
    assert.equal((await who.learner('GET', `/api/institutes/${ins}/batches/${a.id}`)).status, 404, who.email);
  }
  assert.equal((await K.client()('GET', `/api/institutes/${ins}`)).status, 401);
  for (const bad of ['ins_nothex', 'bat_00000000000000000000', "ins_0000000000000000000'"]) {
    assert.ok([404, 405].includes((await boss.learner('GET', `/api/institutes/${bad}`)).status), bad);
  }
  // their roles are listed for them
  const mine = await tina.learner('GET', '/api/me/institutes');
  assert.deepEqual(mine.body.staff.map((s) => s.role), ['teacher']);

  // a closed institute: its staff lose access too
  await K.run("UPDATE institutes SET status = 'closed' WHERE id = ?1", ins);
  assert.equal((await boss.learner('GET', `/api/institutes/${ins}`)).status, 404);
  assert.deepEqual((await boss.learner('GET', '/api/me/institutes')).body.staff, []);
});

/* ---------------- weak keys ---------------- */
test('weak keys come from the typing stats the app saves (console learner page, analytics, learner Analytics)', async () => {
  const owner = await K.owner();
  const c = await K.consoleLogin(owner);
  const u = await K.account({ email: 'keys.ins@example.com', name: 'Keys Learner' });
  await K.subscription(u.id, 'pro', { days: 30 }); // Analytics' key map needs analytics.advanced
  // what the trainer sends after practice: running totals for each key
  const state = { keyStats: { a: { attempts: 300, errors: 30 }, s: { attempts: 400, errors: 4 }, ';': { attempts: 250, errors: 50 }, q: { attempts: 5, errors: 5 } } };
  assert.equal((await u.learner('PUT', '/api/user/progress/state', state)).status, 200);
  // an older copy in key_stats: the larger total wins, never both added
  await K.run('INSERT INTO key_stats (user_id, k, attempts, errors) VALUES (?1, ?2, ?3, ?4)', u.id, 'a', 100, 60);
  await K.run('INSERT INTO key_stats (user_id, k, attempts, errors) VALUES (?1, ?2, ?3, ?4)', u.id, 'z', 50, 10);

  let r = await c('GET', `/api/console/progress/${u.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const wk = r.body.weakKeys || (r.body.learner && r.body.learner.weakKeys);
  assert.deepEqual(wk.map((k) => k.key), [';', 'z', 'a', 's'], 'worst first; q is typed too little to count');
  assert.deepEqual(wk.find((k) => k.key === 'a'), { key: 'a', attempts: 300, errors: 30, rate: 10 });

  r = await c('GET', '/api/console/learning-analytics?range=30d');
  assert.equal(r.status, 200);
  const all = r.body.weakKeys;
  assert.ok(all.some((k) => k.key === ';' && k.attempts >= 250), JSON.stringify(all));

  r = await u.learner('GET', '/api/me/analytics');
  assert.equal(r.status, 200);
  const heat = r.body.advanced.keyHeatmap;
  assert.deepEqual(heat.find((k) => k.key === 'a'), { key: 'a', attempts: 300, errors: 30, accuracy: 90 });
  assert.ok(heat.find((k) => k.key === 'z'));
  // nothing new was written to key_stats by reading
  assert.equal((await K.one('SELECT COUNT(*) AS n FROM key_stats WHERE user_id = ?1', u.id)).n, 2);
});

/* ---------------- the learner's own data ---------------- */
test('export lists seats and roles; deleting the account frees the seat', async () => {
  const ins = await institute({ seats: 1 });
  const b = await batch(ins, 'Export batch');
  const u = await K.account({ email: 'export.ins@example.com' });
  assert.equal((await join(u, b.code)).status, 201);
  const ex = await u.learner('GET', '/api/user/export');
  assert.equal(ex.status, 200);
  assert.equal(ex.body.institute_seats.length, 1);
  assert.equal(ex.body.institute_seats[0].batch, 'Export batch');
  assert.deepEqual(ex.body.institute_roles, []);
  const del = await u.learner('POST', '/api/user/delete', { password: 'correct horse 9' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((await K.one("SELECT COUNT(*) AS n FROM institute_students WHERE institute_id = ?1", ins)).n, 0);
  const next = await K.account({ email: 'export2.ins@example.com' });
  assert.equal((await join(next, b.code)).status, 201, 'the seat was freed');
});

/* ---------------- before migration 0009 ---------------- */
test('before the institute tables exist: plans work as before, institute pages say they are not switched on', async () => {
  const env = makeEnv({ OWNER_EMAILS: OWNER });
  for (const t of ['batch_test_attempts', 'batch_tests', 'batch_teachers', 'institute_students', 'institute_payments', 'institute_staff', 'batches', 'institutes']) env.DB.db.exec(`DROP TABLE ${t}`);
  const Q = { env, srv: await startServer(env, 8790) };
  Q.base = `http://localhost:${Q.srv.port}`;
  const Kq = kit(Q, { ipPrefix: '10.74.0.' });
  try {
    const u = await Kq.account({ email: 'old.ins@example.com' });
    await Kq.subscription(u.id, 'pro', { days: 10 });
    const e = await entitlementsFor(env, u.id);
    assert.equal(e.plan, 'pro'); assert.deepEqual(e.seats, []);
    assert.equal((await u.learner('GET', '/api/me/subscriptions')).status, 200);
    let r = await u.learner('GET', '/api/me/institutes');
    assert.equal(r.status, 503); assert.equal(r.body.error.code, 'institutes_not_ready');
    r = await u.learner('POST', '/api/institutes/join', { code: 'ABCDEFGH', adult: true });
    assert.equal(r.status, 503);
    assert.equal((await u.learner('GET', '/api/user/export')).status, 200);
    assert.equal((await u.learner('GET', '/account/plans')).status, 200);
  } finally { Q.srv.server.close(); }
});
