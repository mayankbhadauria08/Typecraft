// Institutes and email (docs/INSTITUTES.md §13): inviting students from a spreadsheet, and reminders to an
// institute when its seats are nearly full or its term is ending. Migration 0010.
//
//   POST /api/institutes/:id/batches/:bid/invites   admin   { students: [{ name, email }] } at most 25 a request (the page
//                                                           sends a long list in parts); each gets the batch's code and link
//   GET  /api/institutes/:id/batches/:bid/invites   admin   who was invited, and who has joined
//   cron (nightly)                                          seats 90% used; 30 and 7 days before the last day: one email each,
//                                                           to the institute's admins and its contact email
import { HttpError, json, readJson, fieldError, cleanEmail, nowIso, clientIp } from './http.js';
import { hitLimit } from './session.js';
import { audit } from './billing.js';
import { sendTemplate, siteUrl } from './mail.js';
import { newId, requireBatch, showJoinCode } from './institute-access.js';

export const PER_REQUEST = 25;
export const PER_DAY = 500;          // invitation emails an institute can send in a day
const IST_MS = 330 * 60000, DAY_MS = 86400000;
const NOT_READY = "Inviting students by email isn't switched on yet.";
const later = async (fn) => {
  try { return await fn(); } catch (err) {
    if (/no such table/i.test(String(err && err.message))) throw new HttpError(503, 'invites_not_ready', NOT_READY);
    throw err;
  }
};

/* ---------------- students invited from a spreadsheet ---------------- */
export async function postInvites(request, env, ctx, params) {
  const { user, institute, batch } = await requireBatch(env, request, params.id, params.bid, { admin: true });
  const body = await readJson(request, 64 * 1024);
  return later(async () => {
    if (institute.status === 'closed') throw new HttpError(409, 'closed', 'This institute is closed.');
    if (batch.archived_at) throw new HttpError(409, 'archived', 'This batch is archived. Bring it back first.');
    if (!batch.join_code) throw new HttpError(409, 'joining_off', 'Joining is off for this batch. Switch it on first: the email carries the batch code.');
    const list = Array.isArray(body.students) ? body.students : null;
    if (!list || !list.length) throw fieldError({ students: 'Add at least one student with an email address.' });
    if (list.length > PER_REQUEST) throw fieldError({ students: `Send at most ${PER_REQUEST} students at a time.` });
    const DB = env.DB, now = nowIso();
    const sent = [], skipped = [];
    const seen = new Set();
    const members = new Set((await DB.prepare(
      `SELECT u.email FROM institute_students s JOIN users u ON u.id = s.user_id WHERE s.institute_id = ?1 AND s.status = 'active'`
    ).bind(institute.id).all()).results.map((r) => r.email));
    for (const raw of list) {
      const e = cleanEmail(raw && raw.email);
      const name = typeof (raw && raw.name) === 'string' ? raw.name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
      if (e.error) { skipped.push({ email: String((raw && raw.email) || '').slice(0, 80), why: 'not an email address' }); continue; }
      if (seen.has(e.value)) { skipped.push({ email: e.value, why: 'twice in the list' }); continue; }
      seen.add(e.value);
      if (members.has(e.value)) { skipped.push({ email: e.value, why: 'already in your institute' }); continue; }
      const id = newId('sinv');
      const r = await DB.prepare(`INSERT INTO student_invites (id, batch_id, email, name, invited_by, invited_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                                  ON CONFLICT (batch_id, email) DO NOTHING`).bind(id, batch.id, e.value, name, user.id, now).run();
      if (!r.meta || r.meta.changes !== 1) { skipped.push({ email: e.value, why: 'already invited to this batch' }); continue; }
      if (!(await hitLimit(env, `sinv:${institute.id}`, PER_DAY, 86400))) {
        await DB.prepare('DELETE FROM student_invites WHERE id = ?1').bind(id).run();
        skipped.push({ email: e.value, why: `the daily limit of ${PER_DAY} invitations is reached; try tomorrow` });
        continue;
      }
      const code = showJoinCode(batch.join_code);
      const m = await sendTemplate(env, ctx, { to: e.value, template: 'student_invite',
        // batchCode and joinPath (not code and link, which the email log leaves out) so a retry still carries them
        data: { name, instituteName: institute.name, batchName: batch.name, batchCode: code, joinPath: `/join/${code}` } });
      await DB.prepare('UPDATE student_invites SET email_status = ?2 WHERE id = ?1').bind(id, (m && m.status) || 'failed').run();
      sent.push({ email: e.value, status: (m && m.status) || 'failed' });
    }
    if (sent.length) {
      await audit(env, { actorId: user.id, action: 'institute.students_invite', target: `institute:${institute.id}`,
        detail: { batch: batch.name, count: sent.length, by: 'institute' }, ip: clientIp(request) });
    }
    return json({ sent, skipped });
  });
}

export async function getInvites(request, env, ctx, params) {
  const { batch } = await requireBatch(env, request, params.id, params.bid, { admin: true });
  return later(async () => {
    const rows = (await env.DB.prepare(
      `SELECT v.email, v.name, v.invited_at, v.email_status,
              EXISTS (SELECT 1 FROM institute_students s JOIN users u ON u.id = s.user_id WHERE s.batch_id = v.batch_id AND s.status = 'active' AND u.email = v.email) AS joined
         FROM student_invites v WHERE v.batch_id = ?1 ORDER BY v.invited_at DESC, v.email LIMIT 500`
    ).bind(batch.id).all()).results;
    return json({ invites: rows.map((r) => ({ email: r.email, name: r.name || null, invitedAt: r.invited_at, emailStatus: r.email_status, joined: !!r.joined })) });
  });
}

/* ---------------- reminders (nightly) ---------------- */
const lastDayOf = (endsAt) => new Date(Date.parse(endsAt) - 1 + IST_MS).toISOString().slice(0, 10);
const words = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** One pass: each reminder goes once per term (its end date), to the admins and the contact email. → counts. */
export async function sendReminders(env, ctx, now = Date.now()) {
  const DB = env.DB;
  const iso = new Date(now).toISOString();
  const soon = new Date(now + 30 * DAY_MS).toISOString();
  const rows = (await DB.prepare(
    `SELECT i.id, i.name, i.seats, i.ends_at, i.contact_email, i.contact_name,
            (SELECT COUNT(*) FROM institute_students s WHERE s.institute_id = i.id AND s.status = 'active') AS used
       FROM institutes i WHERE i.status = 'active' AND i.ends_at > ?1 LIMIT 500`
  ).bind(iso).all()).results;
  const out = { seats: 0, ends30: 0, ends7: 0 };
  for (const i of rows) {
    const daysLeft = Math.ceil((Date.parse(i.ends_at) - now) / DAY_MS);
    const due = [];
    if (i.seats >= 5 && i.used >= Math.ceil(i.seats * 0.9)) due.push(['seats_90', 'seats']);
    if (i.ends_at <= soon && daysLeft <= 7) due.push(['ends_7', 'ends']);
    else if (i.ends_at <= soon) due.push(['ends_30', 'ends']);
    for (const [kind, template] of due) {
      const claim = await DB.prepare('INSERT INTO institute_reminders (institute_id, kind, ref, sent_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING')
        .bind(i.id, kind, i.ends_at, iso).run();
      if (!claim.meta || claim.meta.changes !== 1) continue; // already sent for this term
      const admins = (await DB.prepare(
        `SELECT st.email, u.full_name FROM institute_staff st LEFT JOIN users u ON u.id = st.user_id WHERE st.institute_id = ?1 AND st.role = 'admin' AND st.status = 'active'`
      ).bind(i.id).all()).results;
      const to = new Map(admins.map((a) => [a.email, a.full_name || '']));
      if (i.contact_email && !to.has(i.contact_email)) to.set(i.contact_email, i.contact_name || '');
      for (const [email, name] of to) {
        await sendTemplate(env, ctx, { to: email, template: 'institute_reminder', data: { name, instituteName: i.name, kind: template, seats: i.seats, seatsUsed: i.used,
          lastDay: words(lastDayOf(i.ends_at)), days: daysLeft, link: `${siteUrl(env)}/institute/${i.id}` } });
      }
      out[kind === 'seats_90' ? 'seats' : kind === 'ends_7' ? 'ends7' : 'ends30']++;
    }
  }
  return out;
}

export async function cron(env, ctx, kind) {
  if (kind !== '17 21 * * *') return;
  try {
    const r = await sendReminders(env, ctx);
    if (r.seats || r.ends30 || r.ends7) console.log('institute reminders:', JSON.stringify(r));
  } catch (err) {
    if (!/no such table/i.test(String(err && err.message))) throw err; // before migration 0010
  }
}

const ID = '([a-z]{3,4}_[0-9a-f]{20})';
export const ROUTES = {};
export const PATTERNS = [
  ['POST', new RegExp(`^/api/institutes/${ID}/batches/${ID}/invites$`), ['id', 'bid'], postInvites],
  ['GET', new RegExp(`^/api/institutes/${ID}/batches/${ID}/invites$`), ['id', 'bid'], getInvites],
];
