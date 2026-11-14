/* /payment/pending?order=<id>. Polls GET /api/checkout/orders/:id {orderId, status, packageName, amountPaise, currency} every 5 s for up to 5 minutes. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const orderId = K.qs('order');
  const card = $('#pn-card');
  const EVERY = 5000, LIMIT = 5 * 60 * 1000;
  let started = 0, timer = null;

  function waiting(o) {
    const secs = Math.round((Date.now() - started) / 1000);
    K.mount(card,
      h('div', { role: 'status', style: 'display:flex;gap:.75rem;align-items:center' }, h('div', { class: 'skeleton', style: 'width:14px;height:14px;border-radius:50%' }),
        h('p', { style: 'margin:0', text: `Still waiting for confirmation… (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')})` })),
      o ? h('p', { class: 'muted', text: `${o.packageName || 'Plan'} · ${K.money(o.amountPaise, o.currency)}` }) : null,
      h('p', { class: 'muted', text: 'You can keep this page open; it updates by itself. Please do not pay again for the same plan.' }));
  }
  function gaveUp() {
    K.mount(card,
      K.alert('info', 'Your bank has not confirmed the payment yet.'),
      h('p', { text: 'This sometimes takes up to a few hours. We keep checking with Razorpay automatically. If the payment goes through, your plan activates on its own and we email you the receipt; you do not need to stay on this page.' }),
      h('p', { text: 'If it does not go through, any amount your bank has held is returned automatically, normally within 5–7 working days.' }),
      orderId ? h('p', null, h('span', { class: 'muted', text: 'Order id: ' }), h('span', { class: 'mono', text: orderId })) : null,
      h('div', { class: 'card-foot field-row' },
        h('button', { type: 'button', class: 'btn btn-primary', text: 'Check again', onclick: () => { started = Date.now(); poll(); } }),
        h('a', { class: 'btn btn-ghost', href: '/account/payments', text: 'Your payments' }),
        h('a', { class: 'btn btn-ghost', href: `/contact?topic=billing&order=${encodeURIComponent(orderId || '')}`, text: 'Contact support' })));
  }

  async function poll() {
    clearTimeout(timer);
    const res = await K.api('GET', `/api/checkout/orders/${encodeURIComponent(orderId)}`);
    const o = res.ok ? res.data : null;
    if (o && K.orderPage(o.status) !== 'pending') return location.replace(K.orderUrl(o.status, orderId));
    if (!res.ok && res.status === 404) return K.empty(card, { icon: 'info', title: 'Order not found', text: 'We could not find this order on your account.', action: { href: '/account/payments', label: 'Your payments' } });
    if (Date.now() - started >= LIMIT) return gaveUp();
    waiting(o);
    timer = setTimeout(poll, EVERY);
  }

  if (!orderId) location.replace('/account/payments');
  else { started = Date.now(); poll(); }
})();
