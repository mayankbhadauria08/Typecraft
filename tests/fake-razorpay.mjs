// A small stand-in for Razorpay's API for the admin console tests. install() puts it behind
// globalThis.fetch for requests to api.razorpay.com only; nothing here touches the network.
//   const fake = fakeRazorpay({ keyId, keySecret }); fake.install(); … fake.restore();
export function fakeRazorpay({ keyId, keySecret }) {
  const realFetch = globalThis.fetch;
  // refundAs: the status the next refunds get ('processed' | 'pending'); down: every call fails as if Razorpay were unreachable;
  // onRefund(refund): awaited before a refund is answered (to send a webhook first, as Razorpay sometimes does)
  const fake = { orders: new Map(), payments: new Map(), refunds: new Map(), calls: [], n: 0, refundAs: 'processed', down: false, onRefund: null };
  const rid = (p) => `${p}_${(++fake.n).toString(36).padStart(8, '0')}FAKE`;
  const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const bad = (description) => reply(400, { error: { code: 'BAD_REQUEST_ERROR', description } });

  async function handle(url, init = {}) {
    const method = init.method || 'GET';
    const path = new URL(url).pathname.replace(/^\/v1/, '');
    const body = init.body ? JSON.parse(init.body) : null;
    fake.calls.push(`${method} ${path}`);
    if (fake.down) throw new TypeError('fetch failed');
    if (new Headers(init.headers).get('Authorization') !== 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')) return reply(401, { error: { code: 'BAD_REQUEST_ERROR', description: 'auth' } });
    let m;
    if (method === 'POST' && path === '/orders') {
      const o = { id: rid('order'), entity: 'order', amount: body.amount, currency: body.currency, receipt: body.receipt, notes: body.notes, status: 'created' };
      fake.orders.set(o.id, o);
      return reply(200, o);
    }
    if (method === 'GET' && (m = path.match(/^\/payments\/(\w+)$/))) {
      const p = fake.payments.get(m[1]);
      return p ? reply(200, p) : bad('not found');
    }
    if (method === 'POST' && (m = path.match(/^\/payments\/(\w+)\/capture$/))) {
      const p = fake.payments.get(m[1]);
      if (!p || p.status !== 'authorized' || body.amount !== p.amount) return bad('cannot capture');
      p.status = 'captured';
      return reply(200, p);
    }
    if (method === 'GET' && (m = path.match(/^\/orders\/(\w+)\/payments$/))) {
      const items = [...fake.payments.values()].filter((p) => p.order_id === m[1]);
      return reply(200, { entity: 'collection', count: items.length, items });
    }
    if (method === 'POST' && (m = path.match(/^\/payments\/(\w+)\/refund$/))) {
      const p = fake.payments.get(m[1]);
      if (!p || p.status !== 'captured') return bad('cannot refund');
      const r = { id: rid('rfnd'), entity: 'refund', amount: body.amount ?? p.amount, payment_id: p.id, notes: body.notes, status: fake.refundAs };
      fake.refunds.set(r.id, r);
      if (fake.onRefund) await fake.onRefund(r);
      return reply(200, r);
    }
    if (method === 'GET' && (m = path.match(/^\/refunds\/(\w+)$/))) {
      const r = fake.refunds.get(m[1]);
      return r ? reply(200, r) : bad('not found');
    }
    return reply(404, { error: { code: 'BAD_REQUEST_ERROR', description: 'no route' } });
  }

  /** A payment made in the fake checkout for one of the orders created through it. */
  fake.pay = (rzpOrderId, { status = 'captured', amount, currency = 'INR', method = 'upi', error = null, orderId = rzpOrderId } = {}) => {
    const o = fake.orders.get(rzpOrderId);
    const p = { id: rid('pay'), entity: 'payment', order_id: orderId, amount: amount ?? o.amount, currency, status, method,
      error_code: error ? 'BAD_REQUEST_ERROR' : null, error_description: error };
    fake.payments.set(p.id, p);
    return p;
  };
  fake.install = () => { globalThis.fetch = async (url, init) => (String(url).startsWith('https://api.razorpay.com/') ? handle(url, init) : realFetch(url, init)); };
  fake.restore = () => { globalThis.fetch = realFetch; };
  return fake;
}
