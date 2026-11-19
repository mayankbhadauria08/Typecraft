// Exam practice and verifiable certificates (docs/EXAM-MODES.md).
//
//   POST /api/exams/results                    signed in   marks an attempt (shared/exam-rules.js) and saves the numbers;
//                                                          with batchTestId, it may count for a batch's scheduled test (src/institute-tests.js)
//   GET  /api/exams/results                    signed in   recent attempts, best per test, certificate codes
//   POST /api/exams/results/:id/certificate    signed in   a code for a passed attempt
//   GET  /api/me/certificates                  signed in   every certificate (course speed certificates and passed tests) with its code
//   PUT  /api/me/certificates/:code            signed in   { shared } stop or start sharing one
//   GET  /api/certificates/:code               public      what a code certifies (name, result, date)
//
// The typed text is marked here and never stored. Codes are random (60 bits): a certificate can only
// be looked up by someone the holder gave the code to.
import '../shared/exam-passages.js';
import '../shared/exam-rules.js';
import { HttpError, json, readJson, fieldError, nowIso, clientIp } from './http.js';
import { requireSession, hitLimit, tooMany } from './session.js';
import { todayOf } from './api.js';
import { countResult } from './institute-tests.js';

const X = globalThis.TC_EXAMS;
export const DAILY_SAVES = 20;
export const MAX_GROSS_WPM = 200;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0 or 1
const LEVELS = ['20', '30', '40', '50', '60'];

/** 12 random characters from ALPHABET. */
export function newCode() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => ALPHABET[x & 31]).join('');
}
/** 'ABCD-EFGH-JKLM' typed any way (lower case, spaces, no dashes) → 'ABCDEFGHJKLM', or null. */
export function cleanCode(value) {
  const c = String(value || '').toUpperCase().replace(/[\s-]+/g, '');
  return c.length === 12 && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}
export const showCode = (c) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;

/** The two new tables are migration 0008: until it is applied, say so instead of failing. */
async function ready(fn, message) {
  try { return await fn(); } catch (err) {
    if (/no such table/i.test(String(err && err.message))) throw new HttpError(503, 'exams_not_ready', message);
    throw err;
  }
}
const NOT_READY_SAVE = "Saving exam results isn't switched on yet. Your result is shown, but it can't be kept.";
const NOT_READY_CHECK = "Checking certificates isn't switched on yet.";

function resultView(r, code) {
  const M = X.MODES[r.mode] || { name: r.mode, minutes: 0 };
  return {
    id: r.id, mode: r.mode, modeName: M.name, minutes: M.minutes, passageId: r.passage_id, seconds: r.seconds,
    strokes: r.strokes, correctStrokes: r.correct_strokes, words: r.words, full: r.full_mistakes, half: r.half_mistakes,
    mistakesPct: r.mistakes_pct, grossWpm: r.gross_wpm, netWpm: r.net_wpm, kdph: r.kdph, passed: !!r.passed,
    day: r.day, createdAt: r.created_at,
    certificate: code ? { code: showCode(code.code), shared: !!code.shared } : null,
  };
}

/* ---------------- POST /api/exams/results ---------------- */
export async function postResult(request, env) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request, 64 * 1024);
  if (typeof body.id !== 'string' || !/^ex-[\w-]{8,64}$/.test(body.id)) throw fieldError({ id: 'id must look like ex-… (8 to 64 letters, digits or dashes).' });
  const res = X.score(body.mode, body.passageId, body.typed, Number(body.seconds), { path: typeof body.path === 'string' ? body.path : null });
  if (!res.ok) throw fieldError({ [res.field]: res.message });
  if (res.grossWpm > MAX_GROSS_WPM) throw new HttpError(400, 'implausible', "That result can't be right: it is faster than anyone types. Please take the test again.");
  if (!res.typedWords) throw fieldError({ typed: 'Nothing was typed.' });
  const day = todayOf(body.today);
  const DB = env.DB;
  return ready(async () => {
    const [dup, used] = await DB.batch([
      DB.prepare('SELECT * FROM exam_results WHERE id = ?1 AND user_id = ?2').bind(body.id, user.id),
      DB.prepare('SELECT COUNT(*) AS n FROM exam_results WHERE user_id = ?1 AND day = ?2').bind(user.id, day),
    ]);
    const batchTestId = typeof body.batchTestId === 'string' && body.batchTestId ? body.batchTestId : null;
    if (dup.results[0]) {
      return json({ saved: false, duplicate: true, result: resultView(dup.results[0]), verdict: X.verdict(res),
        ...(batchTestId ? { batchTest: await countResult(env, user.id, batchTestId, dup.results[0]) } : {}) });
    }
    if (used.results[0].n >= DAILY_SAVES) throw new HttpError(429, 'daily_limit', `You've saved ${DAILY_SAVES} exam results today. Your result is shown, but it can't be kept until tomorrow.`);
    const now = nowIso();
    const row = {
      id: body.id, user_id: user.id, mode: res.mode, passage_id: res.passageId, seconds: res.seconds, strokes: res.strokes,
      correct_strokes: res.correctStrokes, words: res.words, full_mistakes: res.full, half_mistakes: res.half,
      gross_wpm: res.grossWpm, net_wpm: res.netWpm, kdph: res.kdph, mistakes_pct: res.mistakesPct, passed: res.passed ? 1 : 0,
      day, created_at: now,
    };
    const cols = Object.keys(row);
    const ins = await DB.prepare(`INSERT INTO exam_results (${cols.join(', ')}) VALUES (${cols.map((_, i) => '?' + (i + 1)).join(', ')})
                                  ON CONFLICT (id) DO NOTHING`).bind(...cols.map((c) => row[c])).run();
    // the same id from another account: refuse rather than mix them up
    if (!ins.meta || !ins.meta.changes) throw new HttpError(409, 'id_taken', 'That result was already saved. Please take the test again.');
    return json({ saved: true, result: resultView(row), verdict: X.verdict(res), today: { date: day, used: used.results[0].n + 1, limit: DAILY_SAVES },
      ...(batchTestId ? { batchTest: await countResult(env, user.id, batchTestId, row) } : {}) }, 201);
  }, NOT_READY_SAVE);
}

/* ---------------- GET /api/exams/results ---------------- */
export async function getResults(request, env) {
  const { user } = await requireSession(env, request);
  const DB = env.DB;
  return ready(async () => {
    const [rows, best, codes] = await DB.batch([
      DB.prepare('SELECT * FROM exam_results WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 30').bind(user.id),
      DB.prepare(`SELECT mode, COUNT(*) AS n, SUM(passed) AS passed, MAX(net_wpm) AS net, MAX(kdph) AS kdph, MIN(mistakes_pct) AS pct
                    FROM exam_results WHERE user_id = ?1 GROUP BY mode`).bind(user.id),
      DB.prepare("SELECT code, ref, shared FROM certificate_codes WHERE user_id = ?1 AND kind = 'exam'").bind(user.id),
    ]);
    const byRef = new Map(codes.results.map((c) => [c.ref, c]));
    return json({
      results: rows.results.map((r) => resultView(r, byRef.get(r.id))),
      best: Object.fromEntries(best.results.map((b) => [b.mode, { attempts: b.n, passed: b.passed || 0, netWpm: b.net, kdph: b.kdph, mistakesPct: b.pct }])),
      limit: DAILY_SAVES,
    });
  }, NOT_READY_SAVE);
}

/** The code for one certificate, made the first time it is asked for. */
export async function codeFor(env, userId, kind, ref) {
  const DB = env.DB;
  const have = await DB.prepare('SELECT code, shared FROM certificate_codes WHERE user_id = ?1 AND kind = ?2 AND ref = ?3').bind(userId, kind, ref).first();
  if (have) return have;
  const now = nowIso();
  for (let tries = 0; tries < 3; tries++) {
    const code = newCode();
    const r = await DB.prepare(`INSERT INTO certificate_codes (code, user_id, kind, ref, shared, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
                                ON CONFLICT DO NOTHING`).bind(code, userId, kind, ref, now).run();
    if (r.meta && r.meta.changes) return { code, shared: 1 };
    // the certificate got a code at the same moment (two tabs), or the code was taken: look again
    const again = await DB.prepare('SELECT code, shared FROM certificate_codes WHERE user_id = ?1 AND kind = ?2 AND ref = ?3').bind(userId, kind, ref).first();
    if (again) return again;
  }
  throw new HttpError(500, 'code_failed', "We couldn't make a code just now. Please try again.");
}

/* ---------------- POST /api/exams/results/:id/certificate ---------------- */
export async function postCertificate(request, env, ctx, params) {
  const { user } = await requireSession(env, request);
  return ready(async () => {
    const r = await env.DB.prepare('SELECT id, passed FROM exam_results WHERE id = ?1 AND user_id = ?2').bind(params.id, user.id).first();
    if (!r) throw new HttpError(404, 'not_found', 'There is no saved result with this ID.');
    if (!r.passed) throw new HttpError(409, 'not_passed', 'Certificates are for tests that meet the goal.');
    const c = await codeFor(env, user.id, 'exam', r.id);
    return json({ code: showCode(c.code), shared: !!c.shared });
  }, NOT_READY_SAVE);
}

/* ---------------- GET /api/me/certificates ---------------- */
// Course speed certificates get their code here, the first time the list is opened.
export async function getMyCertificates(request, env) {
  const { user } = await requireSession(env, request);
  const DB = env.DB;
  const levels = (await DB.prepare('SELECT level, wpm, accuracy, seconds, at FROM certificates WHERE user_id = ?1 ORDER BY level').bind(user.id).all()).results;
  let codes, exams;
  try {
    [codes, exams] = (await DB.batch([
      DB.prepare('SELECT code, kind, ref, shared FROM certificate_codes WHERE user_id = ?1').bind(user.id),
      DB.prepare(`SELECT e.* FROM exam_results e JOIN certificate_codes c ON c.kind = 'exam' AND c.ref = e.id AND c.user_id = e.user_id
                   WHERE e.user_id = ?1 ORDER BY e.created_at DESC`).bind(user.id),
    ])).map((r) => r.results);
  } catch (err) {
    if (!/no such table/i.test(String(err && err.message))) throw err;
    // before migration 0008: the certificates, without codes
    return json({ ready: false, certificates: levels.map((l) => levelView(l, null)) });
  }
  const byKey = new Map(codes.map((c) => [c.kind + ':' + c.ref, c]));
  const out = [];
  for (const l of levels) {
    const ref = String(l.level);
    if (!LEVELS.includes(ref)) continue;
    const c = byKey.get('level:' + ref) || await codeFor(env, user.id, 'level', ref);
    out.push(levelView(l, c));
  }
  for (const e of exams) out.push(examView(e, byKey.get('exam:' + e.id)));
  return json({ ready: true, certificates: out });
}
export function levelView(l, c) {
  return { kind: 'level', level: l.level, title: `${Math.round(l.wpm)} words a minute`, test: `${testWords(l.seconds)} in the TypeCraft course (the ${l.level} wpm certificate)`,
    wpm: Math.round(l.wpm), accuracy: Math.round(l.accuracy), seconds: Math.round(l.seconds), at: l.at,
    code: c ? showCode(c.code) : null, shared: c ? !!c.shared : null };
}
export function examView(e, c) {
  const M = X.MODES[e.mode] || { certificate: 'Typing test', minutes: 0 };
  // rounded down, so a certificate never shows more than was typed (41.6 wpm is 41, 0.29% mistakes is 99% right)
  const wpm = Math.floor(e.net_wpm);
  return { kind: 'exam', id: e.id, mode: e.mode, title: `${wpm} net words a minute`, test: M.certificate,
    wpm, grossWpm: e.gross_wpm, kdph: e.kdph, mistakesPct: e.mistakes_pct, accuracy: Math.max(0, Math.floor(100 - e.mistakes_pct)),
    seconds: Math.round(M.minutes * 60), at: e.created_at, code: c ? showCode(c.code) : null, shared: c ? !!c.shared : null };
}
function testWords(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s >= 60) { const m = Math.round(s / 60); return `a ${m}-minute timed test`; }
  return `a ${s}-second timed test`;
}

/* ---------------- PUT /api/me/certificates/:code ---------------- */
export async function putMyCertificate(request, env, ctx, params) {
  const { user } = await requireSession(env, request);
  const code = cleanCode(params.code);
  if (!code) throw new HttpError(404, 'not_found', 'There is no certificate with this code.');
  const body = await readJson(request, 1024);
  if (typeof body.shared !== 'boolean') throw fieldError({ shared: 'shared must be true or false.' });
  return ready(async () => {
    const r = await env.DB.prepare('UPDATE certificate_codes SET shared = ?3, updated_at = ?4 WHERE code = ?1 AND user_id = ?2')
      .bind(code, user.id, body.shared ? 1 : 0, nowIso()).run();
    if (!r.meta || !r.meta.changes) throw new HttpError(404, 'not_found', 'There is no certificate with this code.');
    return json({ code: showCode(code), shared: body.shared });
  }, NOT_READY_SAVE);
}

/**
 * The institute a learner had a seat at when they earned a certificate (docs/INSTITUTES.md §9), or null.
 * Before migration 0009 there is none.
 */
export async function instituteAt(env, userId, at) {
  try {
    const row = await env.DB.prepare(
      `SELECT i.name FROM institute_students s JOIN institutes i ON i.id = s.institute_id
        WHERE s.user_id = ?1 AND s.joined_at <= ?2 AND (s.ended_at IS NULL OR s.ended_at >= ?2) ORDER BY s.joined_at DESC LIMIT 1`
    ).bind(userId, at).first();
    return row ? row.name : null;
  } catch (err) {
    if (/no such table/i.test(String(err && err.message))) return null;
    throw err;
  }
}

/* ---------------- GET /api/certificates/:code (public) ---------------- */
const NOT_FOUND = 'No certificate matches this code, or its holder has stopped sharing it. Check the code and try again.';
export async function getCertificate(request, env, ctx, params) {
  if (!(await hitLimit(env, `verify:${clientIp(request)}`, 60, 600))) throw tooMany(10);
  const code = cleanCode(params.code);
  if (!code) throw new HttpError(404, 'not_found', NOT_FOUND);
  return ready(async () => {
    const DB = env.DB;
    const c = await DB.prepare(`SELECT c.code, c.kind, c.ref, c.shared, c.user_id, u.full_name, u.account_status
                                  FROM certificate_codes c JOIN users u ON u.id = c.user_id WHERE c.code = ?1`).bind(code).first();
    if (!c || !c.shared || c.account_status !== 'active') throw new HttpError(404, 'not_found', NOT_FOUND);
    let cert = null;
    if (c.kind === 'level') {
      const l = await DB.prepare('SELECT level, wpm, accuracy, seconds, at FROM certificates WHERE user_id = ?1 AND level = ?2').bind(c.user_id, Number(c.ref)).first();
      if (l) cert = levelView(l, c);
    } else {
      const e = await DB.prepare('SELECT * FROM exam_results WHERE id = ?1 AND user_id = ?2 AND passed = 1').bind(c.ref, c.user_id).first();
      if (e) cert = examView(e, c);
    }
    if (!cert) throw new HttpError(404, 'not_found', NOT_FOUND);
    const { shared, id, ...view } = cert;
    const institute = await instituteAt(env, c.user_id, cert.at);
    return json({ certificate: { ...view, holder: c.full_name || 'TypeCraft learner', institute, checkedAt: nowIso() } },
      200, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  }, NOT_READY_CHECK);
}

export const ROUTES = {
  'POST /api/exams/results': postResult,
  'GET /api/exams/results': getResults,
  'GET /api/me/certificates': getMyCertificates,
};
export const PATTERNS = [
  ['POST', /^\/api\/exams\/results\/(ex-[\w-]{8,64})\/certificate$/, ['id'], postCertificate],
  ['PUT', /^\/api\/me\/certificates\/([A-Za-z0-9-]{12,20})$/, ['code'], putMyCertificate],
  ['GET', /^\/api\/certificates\/([A-Za-z0-9-]{12,20})$/, ['code'], getCertificate],
];
