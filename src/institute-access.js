// Institutes: who may see what, join codes, and the seats that give a plan (docs/INSTITUTES.md).
// Every institute request goes through requireStaff / requireBatch here: the server checks the
// signed-in account, its role in that institute and, for a teacher, that the batch is theirs.
// Hiding a link in a page is never the check.
import { HttpError } from './http.js';
import { requireSession } from './session.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0 or 1

/** 'ins_', 'bat_', 'stf_', 'mem_', 'ipay_' + 20 random hex characters. */
export function newId(prefix) {
  const b = new Uint8Array(10);
  crypto.getRandomValues(b);
  return prefix + '_' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
export const ID_RE = /^(ins|bat|stf|mem|ipay|asg|sinv)_[0-9a-f]{20}$/;
export const isId = (v, prefix) => typeof v === 'string' && ID_RE.test(v) && v.startsWith(prefix + '_');

/** A join code: 8 random characters (40 bits). Wrong guesses are rate limited (src/institutes.js). */
export function newJoinCode() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => ALPHABET[x & 31]).join('');
}
/** 'abcd-efgh', 'ABCD EFGH' or 'ABCDEFGH' → 'ABCDEFGH'; anything else → null. */
export function cleanJoinCode(value) {
  const c = String(value || '').toUpperCase().replace(/[\s-]+/g, '');
  return c.length === 8 && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}
export const showJoinCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : null);

/** Tables from migration 0009: until it is applied, institute features answer 503 instead of failing. */
export const NOT_READY = "Institutes aren't switched on yet.";
export async function ready(fn) {
  try { return await fn(); } catch (err) {
    if (/no such table/i.test(String(err && err.message))) throw new HttpError(503, 'institutes_not_ready', NOT_READY);
    throw err;
  }
}

/* ---------------- seats → plan ---------------- */
/**
 * The seats that give this learner a plan now: an active seat in an active institute whose term has
 * started and not ended. Each row carries the package it gives, read as the package is today.
 * Before migration 0009 there are none.
 */
export async function seatsFor(env, userId, now) {
  try {
    return (await env.DB.prepare(
      `SELECT m.id, m.joined_at, i.id AS institute_id, i.name AS institute_name, i.ends_at, b.name AS batch_name,
              p.id AS package_id, p.name AS package_name, p.display_order, p.features, p.limits
         FROM institute_students m
         JOIN institutes i ON i.id = m.institute_id
         JOIN batches b ON b.id = m.batch_id
         JOIN packages p ON p.id = i.package_id
        WHERE m.user_id = ?1 AND m.status = 'active' AND i.status = 'active' AND i.starts_at <= ?2 AND i.ends_at > ?2
        ORDER BY m.joined_at`
    ).bind(userId, now).all()).results;
  } catch (err) {
    if (/no such table/i.test(String(err && err.message))) return [];
    throw err;
  }
}

/** Is a seat in this institute able to give the plan at `now`? (status and term) */
export const instituteOpen = (i, now) => !!i && i.status === 'active' && i.starts_at <= now && i.ends_at > now;

/* ---------------- staff: admin and teachers ---------------- */
const NOT_FOUND = 'There is no institute here, or it is not yours.';
const NO_BATCH = 'There is no batch here, or it is not yours.';

/**
 * The signed-in account's place in one institute: { user, staff: { id, role }, institute }.
 * Only active staff of an institute that is not closed. Anyone else gets 404 (the institute's
 * existence is not confirmed). { admin: true } also refuses teachers, with 403.
 */
export async function requireStaff(env, request, instituteId, { admin = false } = {}) {
  const { user } = await requireSession(env, request);
  if (!isId(instituteId, 'ins')) throw new HttpError(404, 'not_found', NOT_FOUND);
  const row = await ready(() => env.DB.prepare(
    `SELECT st.id AS staff_id, st.role, i.*
       FROM institute_staff st JOIN institutes i ON i.id = st.institute_id
      WHERE st.institute_id = ?1 AND st.user_id = ?2 AND st.status = 'active' AND i.status <> 'closed'`
  ).bind(instituteId, user.id).first());
  if (!row) throw new HttpError(404, 'not_found', NOT_FOUND);
  if (admin && row.role !== 'admin') throw new HttpError(403, 'forbidden', 'Only the institute admin can do this.');
  const { staff_id: staffId, role, ...institute } = row;
  return { user, staff: { id: staffId, role }, institute };
}

/**
 * One batch for its institute's staff: admins see every batch, a teacher only the batches they are
 * assigned to. Anything else is 404. → { user, staff, institute, batch }
 */
export async function requireBatch(env, request, instituteId, batchId, { admin = false } = {}) {
  const ctx = await requireStaff(env, request, instituteId, { admin });
  if (!isId(batchId, 'bat')) throw new HttpError(404, 'not_found', NO_BATCH);
  const batch = await env.DB.prepare(
    `SELECT b.*, EXISTS (SELECT 1 FROM batch_teachers t WHERE t.batch_id = b.id AND t.staff_id = ?3) AS mine
       FROM batches b WHERE b.id = ?1 AND b.institute_id = ?2`
  ).bind(batchId, instituteId, ctx.staff.id).first();
  if (!batch || (ctx.staff.role !== 'admin' && !batch.mine)) throw new HttpError(404, 'not_found', NO_BATCH);
  return { ...ctx, batch };
}

/** SQL condition: batch alias `b` is visible to the staff member in placeholder staffParam (admins: every
 *  batch). The placeholder is used either way, so the statement always takes the same parameters. */
export const visibleBatchSql = (role, staffParam) =>
  role === 'admin' ? `${staffParam} IS NOT NULL` : `EXISTS (SELECT 1 FROM batch_teachers t WHERE t.batch_id = b.id AND t.staff_id = ${staffParam})`;
