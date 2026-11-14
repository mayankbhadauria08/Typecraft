// Profile, email change and account deletion.
import { HttpError, json, readJson, fieldError, cleanName, cleanPhone, cleanEmail, clearSessionCookie, nowIso } from './http.js';
import { verifyPassword } from './crypto.js';
import { requireSession, publicUser, hitLimit, tooMany, emailEnabled } from './session.js';
import { sendVerificationEmail } from './auth.js';

export async function getProfile(request, env) {
  const { user } = await requireSession(env, request);
  return json({ user, emailEnabled: emailEnabled(env) });
}

export async function updateProfile(request, env) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request);
  const fields = {};
  const name = cleanName(body.fullName); if (name.error) fields.fullName = name.error;
  const phone = cleanPhone(body.phoneNumber); if (phone.error) fields.phoneNumber = phone.error;
  if (Object.keys(fields).length) throw fieldError(fields);
  if ('email' in body && body.email !== user.email) {
    throw fieldError({ email: 'To change your email, use "Change email" so the new address can be confirmed first.' });
  }
  const now = nowIso();
  await env.DB.prepare('UPDATE users SET full_name = ?2, phone_number = ?3, updated_at = ?4 WHERE id = ?1')
    .bind(user.id, name.value, phone.value, now).run();
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(user.id).first();
  return json({ user: publicUser(row), message: 'Profile saved.' });
}

/** The new address only replaces the old one after its confirmation link is opened. */
export async function requestEmailChange(request, env, ctx) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request);
  const email = cleanEmail(body.newEmail);
  if (email.error) throw fieldError({ newEmail: email.error });
  if (email.value === user.email) throw fieldError({ newEmail: 'That is already your email.' });
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?1').bind(user.id).first();
  if (!(await verifyPassword(String(body.password || ''), row.password_hash))) throw fieldError({ password: "That isn't your current password." });
  if (!emailEnabled(env)) throw new HttpError(503, 'email_not_configured', "Email sending isn't set up for this site yet, so your email can't be changed.");
  if (!(await hitLimit(env, `email-change:${user.id}`, 5, 3600))) throw tooMany(60);
  const taken = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?1').bind(email.value).first();
  if (taken) throw fieldError({ newEmail: 'Another account already uses that email.' });
  await sendVerificationEmail(env, request, user, email.value, ctx);
  return json({ message: `We've sent a confirmation link to ${email.value}. Your email changes once you open it.` });
}

// Every table with a user_id column (migrations 0001 and 0002). Keep in step with migrations/.
export const USER_TABLES = ['sessions', 'password_reset_tokens', 'email_tokens', 'user_learning_progress', 'user_activity', 'user_state',
  'events', 'lesson_scores', 'user_position', 'stats_batches', 'key_stats', 'bigram_stats', 'error_classes', 'daily_totals', 'user_totals',
  'xp_ledger', 'daily_quests', 'badges', 'certificates', 'placement', 'user_settings', 'workshop_unlocks', 'game_bests', 'ghost_replays',
  'daily_results', 'feedback', 'guest_imports', 'event_rejects', 'rebuild_diffs'];

/** Deletes the account and everything stored for it. Requires the password. */
export async function deleteAccount(request, env) {
  const { user } = await requireSession(env, request);
  const body = await readJson(request);
  if (!(await hitLimit(env, `delete:${user.id}`, 5, 3600))) throw tooMany(60);
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?1').bind(user.id).first();
  if (!(await verifyPassword(String(body.password || ''), row.password_hash))) throw fieldError({ password: "That isn't your password." });
  // invoices and their payments are kept for tax records (migration 0004), without a link to the account
  await env.DB.prepare(`INSERT OR IGNORE INTO billing_archive (invoice_number, former_user_id, billed_name, billed_email, amount_paise, currency, issued_at, invoice, order_json, payments_json, refunds_json, archived_at)
    SELECT i.number, i.user_id, i.billed_name, i.billed_email, i.amount_paise, i.currency, i.issued_at,
      json_object('id', i.id, 'number', i.number, 'seller', json(i.seller), 'lines', json(i.lines), 'issuedAt', i.issued_at),
      (SELECT json_object('id', o.id, 'packageId', o.package_id, 'amountPaise', o.amount_paise, 'status', o.status, 'razorpayOrderId', o.razorpay_order_id, 'paidAt', o.paid_at, 'createdAt', o.created_at) FROM orders o WHERE o.id = i.order_id),
      (SELECT json_group_array(json_object('razorpayPaymentId', p.razorpay_payment_id, 'amountPaise', p.amount_paise, 'status', p.status, 'method', p.method, 'capturedAt', p.captured_at)) FROM payments p WHERE p.order_id = i.order_id),
      (SELECT json_group_array(json_object('razorpayRefundId', r.razorpay_refund_id, 'amountPaise', r.amount_paise, 'status', r.status, 'processedAt', r.processed_at)) FROM refunds r WHERE r.order_id = i.order_id),
      ?2
    FROM invoices i WHERE i.user_id = ?1`).bind(user.id, nowIso()).run();
  // foreign keys cascade these, but deleting them explicitly doesn't depend on that setting
  await env.DB.batch([
    ...USER_TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?1`).bind(user.id)),
    // email part (migration 0003): codes, devices and preferences go; email/contact logs keep no link to the account
    env.DB.prepare('DELETE FROM otp_verifications WHERE user_id = ?1 OR email = ?2').bind(user.id, user.email),
    env.DB.prepare('DELETE FROM known_devices WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('DELETE FROM email_preferences WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('UPDATE email_logs SET user_id = NULL WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('UPDATE contact_messages SET user_id = NULL WHERE user_id = ?1').bind(user.id),
    env.DB.prepare('DELETE FROM rate_limits WHERE key = ?1').bind(`login-fail:${user.email}`),
    env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(user.id),
  ]);
  return json({ message: 'Your account and all of its data have been deleted.' }, 200, { 'Set-Cookie': clearSessionCookie() });
}
