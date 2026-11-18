// Helpers for the admin console tests: a browser stand-in that keeps every cookie, accounts
// with roles, console sign-in, and rows written straight into the test database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const OWNER = 'boss@example.com';
export const pw = 'correct horse 9';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** S = { env, srv, base }. Everything below works against that one test server. */
export function kit(S, { ipPrefix = '10.60.0.' } = {}) {
  const realFetch = globalThis.fetch;
  let ipN = 0, userN = 0, ownerAccount = null;

  function client() {
    const jar = new Map();
    const c = async (method, p, body, extra = {}) => {
      S.env.__ip = c.ip;
      const headers = { Origin: S.base, 'User-Agent': UA, ...extra };
      if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
      if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await realFetch(S.base + p, { method, headers, redirect: 'manual', body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
      for (const sc of res.headers.getSetCookie()) {
        const pair = sc.split(';')[0], i = pair.indexOf('=');
        if (/Max-Age=0/.test(sc) || !pair.slice(i + 1)) jar.delete(pair.slice(0, i)); else jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { json = null; }
      return { status: res.status, body: json, text, headers: res.headers };
    };
    c.ip = ipPrefix + (++ipN);
    c.jar = jar;
    return c;
  }
  const settle = async () => { while (S.srv.pending.length) await Promise.all(S.srv.pending.splice(0)); };
  const one = (sql, ...args) => S.env.DB.prepare(sql).bind(...args).first();
  const many = async (sql, ...args) => (await S.env.DB.prepare(sql).bind(...args).all()).results;
  const run = (sql, ...args) => S.env.DB.prepare(sql).bind(...args).run();

  /** A real account made through sign-up (it can sign in). role: 'admin' | 'support' | null. → { id, email, name, learner } */
  async function account({ email = `staff${++userN}@example.com`, role = null, name = 'Asha Admin' } = {}) {
    const c = client();
    const r = await c('POST', '/api/auth/signup', { fullName: name, email, phoneNumber: '+91 98765 43210', password: pw, confirmPassword: pw });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    if (role) await run('INSERT INTO admin_users (user_id, role, created_by, created_at) VALUES (?1, ?2, NULL, ?3)', r.body.user.id, role, new Date().toISOString());
    await settle();
    return { id: r.body.user.id, email, name, learner: c };
  }
  async function owner() {
    if (!ownerAccount) ownerAccount = await account({ email: OWNER, name: 'Mayank Owner' });
    return ownerAccount;
  }
  /** Signs in to the console with the password (no email set up on the test server). → the client */
  async function consoleLogin(who) {
    const c = client();
    const r = await c('POST', '/api/admin/auth/login', { email: who.email, password: pw });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.step, 'done');
    c.who = who;
    return c;
  }
  /** A customer row written straight into the database (fast; it cannot sign in). → id */
  async function customer({ name = 'Test Customer', email = `c${++userN}@example.com`, phone = '+91 90000 00000', verified = 1, status = 'active',
    createdAt = new Date().toISOString(), lastLoginAt = null } = {}) {
    const id = randomUUID();
    await run(`INSERT INTO users (id, full_name, email, phone_number, password_hash, email_verified, account_status, created_at, updated_at, last_login_at)
               VALUES (?1, ?2, ?3, ?4, 'not-a-real-hash', ?5, ?6, ?7, ?7, ?8)`, id, name, email, phone, verified, status, createdAt, lastLoginAt);
    return id;
  }
  /** A subscription row. days: from now (negative = already over), null = no end date. → id */
  async function subscription(userId, packageId, { days = 30, status = 'active', source = 'admin' } = {}) {
    const id = randomUUID(), now = new Date();
    const expires = days === null ? null : new Date(now.getTime() + days * 86400000).toISOString();
    const started = new Date(now.getTime() - 86400000).toISOString();
    await run(`INSERT INTO user_subscriptions (id, user_id, package_id, order_id, status, source, features, limits, starts_at, expires_at, created_at, updated_at)
               SELECT ?1, ?2, p.id, NULL, ?4, ?5, p.features, p.limits, ?6, ?7, ?6, ?6 FROM packages p WHERE p.id = ?3`, id, userId, packageId, status, source, started, expires);
    return id;
  }
  const hex = (n) => randomUUID().replace(/-/g, '').slice(0, n);
  let invoiceN = 0;
  /**
   * An order row with the payment row it would have (none for an order nobody paid).
   * status: created | pending | paid | failed | cancelled | refunded | partially_refunded
   * → { id, userId, amountPaise, paymentRowId, razorpayOrderId, razorpayPaymentId, invoiceNumber }
   */
  async function order(userId, packageId, { status = 'paid', amountPaise = 19900, createdAt = new Date().toISOString(), method = 'upi', failureReason = null,
    invoice = false, atRazorpay = true } = {}) {
    const id = 'ord_' + hex(24), razorpayOrderId = atRazorpay ? 'order_' + hex(14) : null;
    const settled = ['paid', 'refunded', 'partially_refunded'].includes(status);
    await run(`INSERT INTO orders (id, user_id, package_id, amount_paise, currency, status, razorpay_order_id, failure_reason, paid_at, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, 'INR', ?5, ?6, ?7, ?8, ?9, ?9)`, id, userId, packageId, amountPaise, status, razorpayOrderId,
      status === 'failed' ? (failureReason || 'The payment did not go through.') : null, settled ? createdAt : null, createdAt);
    const payStatus = status === 'paid' ? 'captured' : settled ? status : status === 'failed' ? 'failed' : status === 'pending' ? 'authorized' : null;
    let paymentRowId = null, razorpayPaymentId = null, invoiceNumber = null;
    if (payStatus) {
      paymentRowId = 'pay_row_' + hex(20); razorpayPaymentId = 'pay_' + hex(14);
      await run(`INSERT INTO payments (id, order_id, user_id, razorpay_payment_id, amount_paise, currency, status, method, error_description, verified_by, captured_at, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'INR', ?6, ?7, ?8, 'signature', ?9, ?10, ?10)`, paymentRowId, id, userId, razorpayPaymentId, amountPaise, payStatus, method,
        payStatus === 'failed' ? (failureReason || 'The payment did not go through.') : null, settled ? createdAt : null, createdAt);
    }
    if (invoice) {
      const seq = 900000 + (++invoiceN);   // far from the real sequence, which the server counts from 1
      invoiceNumber = `TC-2026-${String(seq).padStart(6, '0')}`;
      await run(`INSERT INTO invoices (id, number, seq, order_id, user_id, amount_paise, currency, billed_name, billed_email, seller, lines, issued_at)
                 SELECT ?1, ?2, ?3, ?4, u.id, ?5, 'INR', u.full_name, u.email, '{}', '[]', ?6 FROM users u WHERE u.id = ?7`, randomUUID(), invoiceNumber, seq, id, amountPaise, createdAt, userId);
    }
    return { id, userId, amountPaise, paymentRowId, razorpayOrderId, razorpayPaymentId, invoiceNumber };
  }
  /** A refund row for an order made with order(). → { id, razorpayRefundId } */
  async function refundRow(o, { amountPaise = o.amountPaise, status = 'processed', reason = 'Customer request', requestedBy = null, createdAt = new Date().toISOString() } = {}) {
    const id = randomUUID(), razorpayRefundId = 'rfnd_' + hex(14);
    await run(`INSERT INTO refunds (id, payment_id, order_id, user_id, razorpay_refund_id, amount_paise, status, reason, requested_by, processed_at, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)`, id, o.paymentRowId, o.id, o.userId, razorpayRefundId, amountPaise, status, reason, requestedBy,
      status === 'processed' ? createdAt : null, createdAt);
    return { id, razorpayRefundId };
  }
  /** Gives or removes one permission for a role, as a Super Admin would in the grid. */
  async function setPermission(role, permission, allowed) {
    await run(`INSERT INTO role_permissions (role, permission, allowed, updated_at) VALUES (?1, ?2, ?3, ?4)
               ON CONFLICT (role, permission) DO UPDATE SET allowed = excluded.allowed`, role, permission, allowed ? 1 : 0, new Date().toISOString());
  }
  /** Makes the console session of this client need a new password check for sensitive actions. */
  async function stale(c) {
    await run('UPDATE admin_sessions SET reauth_at = ?2 WHERE user_id = ?1 AND ended_at IS NULL', c.who.id, new Date(Date.now() - 11 * 60000).toISOString());
  }
  const audits = (like) => many('SELECT action, target, detail, actor_id FROM audit_logs WHERE action LIKE ?1 ORDER BY created_at, rowid', like);

  return { client, settle, one, many, run, account, owner, consoleLogin, customer, subscription, order, refundRow, setPermission, stale, audits };
}

/** Fails when a console page carries inline code or styles (its Content-Security-Policy would refuse them). */
export function assertNoInlineCode(html) {
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    // the console's own scripts, and the shared course rules from /shared/
    assert.ok(/\bsrc="\/(site\/console|shared|js)\/[\w.-]+\?v=\w+"/.test(attrs) ? body === '' : /type="application\/json"/.test(attrs), `inline script: ${attrs}`);
  }
  assert.ok(!/\sstyle="/.test(html), 'no inline styles');
  assert.ok(!/\son[a-z]+="/.test(html), 'no inline event handlers');
  assert.ok(!/<style\b/.test(html), 'no style blocks');
}
