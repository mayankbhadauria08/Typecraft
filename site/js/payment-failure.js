/* /payment/failure?order=<id>. GET /api/checkout/orders/:id {status, packageName, packageId?, amountPaise, failureReason?};
   GET /api/packages to find the plan id for "Try again" when the order has no packageId. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const orderId = K.qs('order');
  const card = $('#pf-card');

  async function retryHref(o) {
    let id = K.pick(o || {}, 'packageId', 'package_id');
    if (!id && o && o.packageName) {
      const res = await K.api('GET', '/api/packages');
      const p = res.ok ? K.list(res.data, 'packages').find((x) => x.name === o.packageName) : null;
      id = p && p.id;
    }
    return id ? `/checkout?plan=${encodeURIComponent(id)}&retry=1` : '/pricing';
  }

  async function load() {
    let o = null;
    if (orderId) {
      const res = await K.api('GET', `/api/checkout/orders/${encodeURIComponent(orderId)}`);
      if (res.ok) o = res.data;
      if (o && o.status === 'paid') { location.replace(`/payment/success?order=${encodeURIComponent(orderId)}`); return; }
      if (o && (o.status === 'pending' || o.status === 'attempted')) { location.replace(`/payment/pending?order=${encodeURIComponent(orderId)}`); return; }
    }
    const reason = o && K.pick(o, 'failureReason', 'failure_reason');
    const href = await retryHref(o);
    K.mount(card,
      K.alert('bad', reason ? `Reason given by the bank or Razorpay: ${reason}` : 'The payment was declined or cancelled before it finished.'),
      o ? h('p', null, h('span', { class: 'muted', text: 'Plan: ' }), o.packageName || '—', h('span', { class: 'muted', text: ' · Amount: ' }), K.money(K.pick(o, 'amountPaise', 'amount_paise'), o.currency)) : null,
      h('h2', { text: 'Was money taken?' }),
      h('p', { text: 'Usually nothing is charged when a payment fails. If your bank shows a debit, it is a temporary hold: it is refunded to you automatically, normally within 5–7 working days. If it is not, contact us with the order id below and we will sort it out.' }),
      orderId ? h('p', null, h('span', { class: 'muted', text: 'Order id: ' }), h('span', { class: 'mono', text: orderId })) : null,
      h('h2', { text: 'Things to try' }),
      h('ul', null, h('li', { text: 'Check the card details, UPI PIN or OTP and try again.' }), h('li', { text: 'Use another method: UPI, a different card or net banking.' }), h('li', { text: 'Ask your bank whether online or international payments are switched on for the card.' })),
      h('div', { class: 'card-foot field-row' },
        h('a', { class: 'btn btn-primary', href, text: 'Try again' }),
        h('a', { class: 'btn btn-ghost', href: `/contact?topic=billing${orderId ? `&order=${encodeURIComponent(orderId)}` : ''}`, text: 'Contact support' }),
        h('a', { class: 'btn btn-ghost', href: '/dashboard', text: 'Back to dashboard' })));
  }
  load();
})();
