/* /payment/success?order=<id>. GET /api/checkout/orders/:id {orderId, status, packageId, packageName, amountPaise, currency, paidAt, invoiceNumber?};
   TC.me().entitlements.expiresAt for the plan end. Only status 'paid' shows the thank-you. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const orderId = K.qs('order');
  const card = $('#ps-card');

  async function load() {
    if (!orderId) { location.replace('/account/payments'); return; }
    const res = await K.api('GET', `/api/checkout/orders/${encodeURIComponent(orderId)}`);
    if (!res.ok) return K.error(card, res, load);
    const o = res.data;
    // only a paid order (or one paid and later part-refunded) shows the thank-you
    if (K.orderPage(o.status) !== 'success') { location.replace(K.orderUrl(o.status, orderId)); return; }
    const me = await K.me();
    const ent = me && me.entitlements;
    $('#ps-title').textContent = 'Thank you, your payment is confirmed';
    $('#ps-lede').textContent = `${o.packageName || 'Your plan'} is active on your account.`;
    const inv = o.invoiceNumber;
    K.mount(card,
      K.alert('ok', `We received ${K.money(o.amountPaise, o.currency)}. A receipt is on its way to your email.`),
      h('dl', { style: 'display:grid;grid-template-columns:auto 1fr;gap:.4rem 1rem;margin:1rem 0' },
        h('dt', { class: 'muted', text: 'Plan' }), h('dd', { style: 'margin:0', text: o.packageName || '—' }),
        h('dt', { class: 'muted', text: 'Active until' }), h('dd', { style: 'margin:0', text: ent ? (ent.expiresAt ? K.date(ent.expiresAt) : 'Never expires') : '—' }),
        h('dt', { class: 'muted', text: 'Order' }), h('dd', { style: 'margin:0', class: 'mono', text: o.orderId || orderId }),
        inv ? h('dt', { class: 'muted', text: 'Invoice' }) : null,
        inv ? h('dd', { style: 'margin:0' }, h('a', { class: 'mono', href: `/account/invoices/${encodeURIComponent(inv)}`, text: inv })) : null),
      h('div', { class: 'card-foot field-row' },
        h('a', { class: 'btn btn-primary', href: '/app', text: 'Start practising' }),
        inv ? h('a', { class: 'btn btn-ghost', href: `/account/invoices/${encodeURIComponent(inv)}`, text: 'View invoice' }) : h('a', { class: 'btn btn-ghost', href: '/account/invoices', text: 'Invoices' }),
        h('a', { class: 'btn btn-ghost', href: '/account/plans', text: 'Your plan' })));
  }
  load();
})();
