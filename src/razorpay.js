// Razorpay REST client and signature checks. Only Web Crypto + fetch.
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET (env only).
// Never log keys, signatures or full bodies.
import { HttpError } from './http.js';

export const API_BASE = 'https://api.razorpay.com/v1';
const enc = new TextEncoder();

export function configured(env) {
  return !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

function authHeader(env) {
  return 'Basic ' + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
}

/** One API call. Throws HttpError 502 payment_provider_error on a failed call (status only is logged). */
export async function call(env, method, path, body) {
  if (!configured(env)) throw new HttpError(503, 'payments_unavailable', 'Payments are not available right now. Please try again later.');
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { Authorization: authHeader(env), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    console.error('razorpay request failed:', method, path.split('/')[1], err && err.name);
    throw new HttpError(502, 'payment_provider_error', "We couldn't reach the payment provider. Please try again in a minute.");
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    console.error('razorpay rejected a request:', method, path.split('/')[1], res.status, data && data.error && data.error.code);
    const e = new HttpError(502, 'payment_provider_error', 'The payment provider refused the request. Please try again or contact support.');
    e.provider = { status: res.status, code: data && data.error && data.error.code, description: data && data.error && data.error.description };
    throw e;
  }
  return data;
}

export const createOrder = (env, { amount, currency, receipt, notes }) => call(env, 'POST', '/orders', { amount, currency, receipt, notes });
export const fetchPayment = (env, paymentId) => call(env, 'GET', `/payments/${encodeURIComponent(paymentId)}`);
export const fetchOrderPayments = (env, rzpOrderId) => call(env, 'GET', `/orders/${encodeURIComponent(rzpOrderId)}/payments`);
export const capturePayment = (env, paymentId, amount, currency) => call(env, 'POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount, currency });
export const refundPayment = (env, paymentId, { amount, notes }) => call(env, 'POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount, notes });

/* ---------------- signatures ---------------- */
export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two strings (length is not secret: HMAC hex is always 64 chars). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i % (x.length || 1)] || 0) ^ (y[i % (y.length || 1)] || 0);
  return diff === 0;
}

/** Checkout signature: HMAC-SHA256(order_id|payment_id, KEY_SECRET). */
export async function verifyPaymentSignature(env, rzpOrderId, rzpPaymentId, signature) {
  if (!env.RAZORPAY_KEY_SECRET || !rzpOrderId || !rzpPaymentId || typeof signature !== 'string') return false;
  return safeEqual(await hmacHex(env.RAZORPAY_KEY_SECRET, `${rzpOrderId}|${rzpPaymentId}`), signature.trim().toLowerCase());
}

/** Webhook signature: HMAC-SHA256(raw body, WEBHOOK_SECRET). */
export async function verifyWebhookSignature(env, rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET || typeof signature !== 'string' || !signature) return false;
  return safeEqual(await hmacHex(env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature.trim().toLowerCase());
}
