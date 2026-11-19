// Inviting an institute's admin or teachers (docs/INSTITUTES.md §5, §7). Used by the console (TypeCraft
// staff invite an institute's admin) and by the institute portal (its admin invites teachers).
// An invitation is a row in institute_staff with the email and no account yet; the account that signs in
// with that email, once verified, accepts it (src/institutes.js). The email only says where to go:
// it carries no secret, so forwarding it gives nobody access.
import { HttpError, fieldError, cleanEmail, nowIso } from './http.js';
import { sendTemplate, siteUrl } from './mail.js';
import { newId } from './institute-access.js';

export const ROLES = ['admin', 'teacher'];

/** The invitation email (again). → 'sent' | 'queued' | 'failed' | … (the email log says why). */
export async function sendInvite(env, ctx, { email, role, instituteName, invitedBy }) {
  const user = await env.DB.prepare('SELECT id, full_name FROM users WHERE email = ?1').bind(email).first();
  const r = await sendTemplate(env, ctx, {
    to: email, userId: user ? user.id : null, template: 'institute_invite',
    data: { name: user ? user.full_name : '', instituteName, role, invitedBy, email, link: `${siteUrl(env)}/institute` },
  });
  return r && r.status;
}

/**
 * Adds an invitation. → { id, email, role, emailStatus }. 400 for a bad email or role; 409 when that email
 * already has a place (invited or active) in this institute.
 */
export async function inviteStaff(env, ctx, { institute, email: raw, role, invitedById, invitedBy }) {
  const email = cleanEmail(raw);
  if (email.error) throw fieldError({ email: email.error.replace('your email address', 'their email address') });
  if (!ROLES.includes(role)) throw fieldError({ role: 'Choose admin or teacher.' });
  const DB = env.DB;
  const taken = await DB.prepare("SELECT role, status FROM institute_staff WHERE institute_id = ?1 AND email = ?2 AND status <> 'removed'")
    .bind(institute.id, email.value).first();
  if (taken) {
    throw new HttpError(409, 'already_staff', taken.status === 'active' ? `${email.value} already helps run this institute.` : `${email.value} is already invited.`,
      { email: taken.status === 'active' ? 'Already part of this institute.' : 'Already invited. You can send the email again from the list.' });
  }
  const id = newId('stf');
  try {
    await DB.prepare(`INSERT INTO institute_staff (id, institute_id, user_id, email, role, status, invited_by, invited_at)
                      VALUES (?1, ?2, NULL, ?3, ?4, 'invited', ?5, ?6)`).bind(id, institute.id, email.value, role, invitedById || null, nowIso()).run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message))) throw new HttpError(409, 'already_staff', `${email.value} is already invited.`, { email: 'Already invited.' });
    throw err;
  }
  const emailStatus = await sendInvite(env, ctx, { email: email.value, role, instituteName: institute.name, invitedBy });
  return { id, email: email.value, role, emailStatus };
}

/** Removes someone from an institute's staff: their batches go back to the admins. → true if removed. */
export async function removeStaff(env, { instituteId, staffId, removedById }) {
  const DB = env.DB;
  const [r] = await DB.batch([
    DB.prepare("UPDATE institute_staff SET status = 'removed', removed_by = ?3, removed_at = ?4 WHERE id = ?1 AND institute_id = ?2 AND status <> 'removed'")
      .bind(staffId, instituteId, removedById || null, nowIso()),
    DB.prepare('DELETE FROM batch_teachers WHERE staff_id = ?1 AND batch_id IN (SELECT id FROM batches WHERE institute_id = ?2)').bind(staffId, instituteId),
  ]);
  return !!(r.meta && r.meta.changes === 1);
}
