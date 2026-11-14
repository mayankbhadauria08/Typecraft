/* /payment/processing?order=<id>. POST /api/checkout/verify {orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature}
   → {status:'paid'|'pending'|'failed', orderId, invoiceNumber?}; without the Razorpay response (page refreshed):
   GET /api/checkout/orders/:id → {status}. Success is shown only when the server says 'paid'. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const orderId = K.qs('order');
  const go = (page) => location.replace(`/payment/${page}?order=${encodeURIComponent(orderId)}`);
  const route = (status) => (status === 'paid' ? go('success') : status === 'failed' || status === 'cancelled' ? go('failure') : go('pending'));

  async function run() {
    if (!orderId) {
      $('#pp-title').textContent = 'No payment to confirm';
      $('#pp-text').textContent = 'This page needs an order. Your payments are listed in your account.';
      K.$('.pp-spinner').hidden = true;
      return K.mount($('#pp-extra'), h('a', { class: 'btn btn-primary', href: '/account/payments', text: 'Your payments' }));
    }
    const key = `tc:pay:${orderId}`;
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { saved = null; }
    if (saved && saved.razorpay_payment_id) {
      const res = await K.api('POST', '/api/checkout/verify', saved);
      if (res.ok && res.data && res.data.status) {
        try { sessionStorage.removeItem(key); } catch { /* ignore */ }
        return route(res.data.status);
      }
      if (res.status === 400 || res.status === 403 || res.status === 404) {
        try { sessionStorage.removeItem(key); } catch { /* ignore */ }
      }
      // network trouble or a server error: the payment may still be fine; the pending page keeps asking the server
      return go('pending');
    }
    const res = await K.api('GET', `/api/checkout/orders/${encodeURIComponent(orderId)}`);
    if (res.ok && res.data) return route(res.data.status);
    if (res.status === 404) {
      $('#pp-title').textContent = 'Order not found';
      $('#pp-text').textContent = 'We could not find this order on your account.';
      K.$('.pp-spinner').hidden = true;
      return K.mount($('#pp-extra'), h('a', { class: 'btn btn-primary', href: '/account/payments', text: 'Your payments' }));
    }
    return go('pending');
  }
  run();
})();
