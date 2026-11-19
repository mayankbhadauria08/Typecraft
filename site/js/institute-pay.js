/* Paying for institute seats with Razorpay (docs/INSTITUTES.md §15), shared by /institute/buy and /institute/:id.
   POST /api/institutes/checkout → { orderId, razorpayOrderId, amountPaise, currency, keyId, description, prefill };
   the Razorpay window; POST /api/institutes/checkout/verify → { status, instituteId?, invoiceNumber? };
   GET /api/institutes/checkout/orders/:id while Razorpay confirms; POST /api/institutes/checkout/failed (shown back only).
   K.buySeats(body, { button, say(kind, text) }) → { status: 'paid' | 'pending' | 'failed', instituteId?, orderId } | { error: res } | null (closed).
   The seats switch on only when the server hears from Razorpay itself, so this page only reports what the server says. */
(function () {
  'use strict';
  const K = window.TCK;
  const RZP_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
  let loading = null;

  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = RZP_SRC; s.async = true;
      s.onload = () => (window.Razorpay ? resolve() : reject(new Error('missing')));
      s.onerror = () => { loading = null; s.remove(); reject(new Error('blocked')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Razorpay confirms most payments in seconds: ask the server for about a minute. */
  async function follow(orderId) {
    for (let i = 0; i < 20; i++) {
      await wait(3000);
      const r = await K.api('GET', `/api/institutes/checkout/orders/${encodeURIComponent(orderId)}`);
      if (r.ok && r.data.status !== 'created' && r.data.status !== 'pending') return r.data;
    }
    return { status: 'pending', orderId };
  }

  K.buySeats = async function (body, { button, say }) {
    say(null);
    K.busy(button, true);
    const [res] = await Promise.all([K.api('POST', '/api/institutes/checkout', body), loadRazorpay().catch(() => null)]);
    if (!res.ok) { K.busy(button, false); return { error: res }; }
    try { await loadRazorpay(); } catch {
      K.busy(button, false);
      say('bad', 'The Razorpay payment window could not load. Check your connection, turn off any blocker for checkout.razorpay.com, and try again. Nothing has been charged.');
      return null;
    }
    const o = res.data;
    return new Promise((resolve) => {
      let done = false;
      const rzp = new window.Razorpay({
        key: o.keyId, order_id: o.razorpayOrderId, amount: o.amountPaise, currency: o.currency || 'INR',
        name: 'TypeCraft', description: o.description, prefill: o.prefill || {}, notes: { instituteOrderId: o.orderId }, theme: { color: '#0b6e63' },
        modal: {
          ondismiss() {
            if (done) return;
            K.busy(button, false);
            say('info', 'Payment window closed. Nothing has been charged. Press Pay to try again whenever you are ready.');
            resolve(null);
          },
        },
        async handler(resp) {
          done = true;
          say('info', 'Razorpay took the payment. Confirming it with them now: please keep this page open.');
          const v = await K.api('POST', '/api/institutes/checkout/verify', {
            orderId: o.orderId, razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature,
          });
          let out = v.ok ? v.data : null;
          if (!out || out.status === 'pending') out = await follow(o.orderId);
          K.busy(button, false);
          resolve({ ...out, orderId: o.orderId });
        },
      });
      rzp.on('payment.failed', async (resp) => {
        if (done) return;
        done = true;
        const err = (resp && resp.error) || {};
        await K.api('POST', '/api/institutes/checkout/failed', { orderId: o.orderId, code: String(err.code || 'payment_failed'), description: String(err.description || err.reason || '') });
        try { rzp.close(); } catch { /* already closed */ }
        K.busy(button, false);
        resolve({ status: 'failed', orderId: o.orderId, reason: err.description || '' });
      });
      rzp.open();
    });
  };

  /** What to tell the payer after K.buySeats. → true when the seats are on (the caller moves on). */
  K.buyOutcome = function (out, say) {
    if (!out) return false;
    if (out.error) { say('bad', K.errMsg(out.error, 'We could not start the payment. Nothing has been charged.')); return false; }
    if (out.status === 'paid') return true;
    if (out.status === 'failed') {
      say('bad', `The payment didn't go through${out.reason ? `: ${out.reason}` : ''}. Nothing was switched on. If money left your account, your bank returns it within 5–7 working days. You can try again.`);
      return false;
    }
    say('info', "Razorpay hasn't confirmed the payment yet. Your seats switch on by themselves as soon as it does, usually within minutes, and we email you the invoice. You can close this page.");
    return false;
  };
})();
