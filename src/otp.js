// One-time 6-digit codes sent by email (sign-in and email confirmation).
// Only HMAC-SHA256(code, SESSION_SECRET) is stored; codes expire after 10 minutes,
// can be tried 5 times, work once, and a new one can be asked for every 60 seconds.
import { HttpError, nowIso } from './http.js';
import { uuid } from './crypto.js';

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_COOLDOWN_MS = 60 * 1000;
export const OTP_PURPOSES = ['login', 'verify_email', 'sensitive'];

const enc = new TextEncoder();

export function otpEnabled(env) {
  return typeof env.SESSION_SECRET === 'string' && env.SESSION_SECRET.length >= 16;
}

/** A uniformly random 6-digit string: rejection sampling, so no modulo bias. */
export function generateCode() {
  const LIMIT = Math.floor(0x100000000 / 1000000) * 1000000; // largest multiple of 10^6 below 2^32
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < LIMIT) return String(buf[0] % 1000000).padStart(6, '0');
  }
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The stored form of a code: bound to the email and purpose so a code can't be replayed elsewhere. */
export async function hashCode(env, { email, purpose, code }) {
  if (!otpEnabled(env)) throw new HttpError(503, 'otp_not_configured', "Email codes aren't set up for this site yet.");
  return hmacHex(env.SESSION_SECRET, `otp:v1:${purpose}:${String(email).toLowerCase()}:${code}`);
}

function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Creates a new code (older unused ones for the same email + purpose stop working).
 * → { code, id, expiresAt } or { cooldown: true, retryAfter } (seconds) if one was made under 60 s ago.
 */
export async function createOtp(env, { email, userId = null, purpose }) {
  if (!OTP_PURPOSES.includes(purpose)) throw new Error('bad otp purpose');
  const em = String(email).toLowerCase();
  const last = await env.DB.prepare(
    'SELECT created_at FROM otp_verifications WHERE email = ?1 AND purpose = ?2 ORDER BY created_at DESC LIMIT 1'
  ).bind(em, purpose).first();
  if (last) {
    const age = Date.now() - Date.parse(last.created_at);
    if (age < OTP_COOLDOWN_MS) return { cooldown: true, retryAfter: Math.ceil((OTP_COOLDOWN_MS - age) / 1000) };
  }
  const code = generateCode();
  const id = uuid();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE otp_verifications SET used_at = ?3 WHERE email = ?1 AND purpose = ?2 AND used_at IS NULL').bind(em, purpose, now),
    env.DB.prepare(
      `INSERT INTO otp_verifications (id, user_id, email, purpose, code_hash, attempts, expires_at, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)`
    ).bind(id, userId, em, purpose, await hashCode(env, { email: em, purpose, code }), expiresAt, now),
  ]);
  return { code, id, expiresAt };
}

/**
 * Checks a code. Every check counts as an attempt (counted before comparing, so parallel
 * guesses can't exceed the limit); the 5th wrong try leaves the code unusable.
 * → { ok: true, userId, email } or { ok: false, reason: 'invalid' | 'expired' | 'burned' }.
 */
export async function verifyOtp(env, { email, purpose, code }) {
  const em = String(email).toLowerCase();
  const row = await env.DB.prepare(
    `SELECT id, user_id, code_hash, attempts, expires_at FROM otp_verifications
      WHERE email = ?1 AND purpose = ?2 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`
  ).bind(em, purpose).first();
  if (!row) return { ok: false, reason: 'invalid' };
  const now = nowIso();
  if (Date.parse(row.expires_at) <= Date.now()) return { ok: false, reason: 'expired' };
  const counted = await env.DB.prepare(
    `UPDATE otp_verifications SET attempts = attempts + 1
      WHERE id = ?1 AND used_at IS NULL AND attempts < ?2 RETURNING attempts`
  ).bind(row.id, OTP_MAX_ATTEMPTS).first();
  if (!counted) return { ok: false, reason: 'burned' };
  const good = /^\d{6}$/.test(String(code)) && sameHex(await hashCode(env, { email: em, purpose, code: String(code) }), row.code_hash);
  if (!good) {
    if (counted.attempts >= OTP_MAX_ATTEMPTS) {
      await env.DB.prepare('UPDATE otp_verifications SET used_at = ?2 WHERE id = ?1 AND used_at IS NULL').bind(row.id, now).run();
      return { ok: false, reason: 'burned' };
    }
    return { ok: false, reason: 'invalid', attemptsLeft: OTP_MAX_ATTEMPTS - counted.attempts };
  }
  // single use: only the request that flips used_at wins
  const claim = await env.DB.prepare('UPDATE otp_verifications SET used_at = ?2 WHERE id = ?1 AND used_at IS NULL').bind(row.id, now).run();
  if (!claim.meta || claim.meta.changes !== 1) return { ok: false, reason: 'invalid' };
  return { ok: true, userId: row.user_id, email: em };
}
