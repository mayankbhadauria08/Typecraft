/* /account/payments. Data: GET /api/me/orders → {orders:[{orderId, packageId, packageName, amountPaise, currency, status, method,
   createdAt, paidAt, invoiceNumber, refundedPaise, failureReason, razorpayPaymentId}]}. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const el = $('#pay-list');
  const STATUS = { created: 'Not completed', attempted: 'Not completed', pending: 'Processing', paid: 'Paid', failed: 'Failed', refunded: 'Refunded', partially_refunded: 'Part refunded', cancelled: 'Cancelled' };

  async function load() {
    K.skeleton(el, 5);
    const res = await K.api('GET', '/api/me/orders');
    if (!res.ok) return K.error(el, res, load);
    const orders = res.data.orders;
    if (!orders.length) return K.empty(el, { icon: 'card', title: 'No payments yet', text: 'When you buy a plan, the payment appears here with its receipt and invoice.', action: { href: '/pricing', label: 'See plans' } });
    K.mount(el, K.table([
      { label: 'Date', value: (o) => K.dateTime(o.paidAt || o.createdAt) },
      { label: 'Plan', value: (o) => o.packageName },
      { label: 'Amount', num: true, value: (o) => {
        const amt = K.money(o.amountPaise, o.currency);
        return o.refundedPaise ? [amt, h('br'), h('span', { class: 'muted', text: `${K.money(o.refundedPaise, o.currency)} refunded` })] : amt;
      } },
      { label: 'Status', value: (o) => [K.badge(o.status, STATUS[o.status]), o.failureReason ? h('p', { class: 'muted', style: 'margin:.25rem 0 0', text: o.failureReason }) : null] },
      { label: 'Payment id', value: (o) => (o.razorpayPaymentId ? [h('span', { class: 'mono', text: o.razorpayPaymentId }), o.method ? h('span', { class: 'muted', text: ` · ${o.method}` }) : null] : '—') },
      { label: 'Invoice', value: (o) => {
        if (o.invoiceNumber) return h('a', { href: `/account/invoices/${encodeURIComponent(o.invoiceNumber)}`, text: o.invoiceNumber, class: 'mono' });
        if (o.status === 'pending' || o.status === 'attempted') return h('a', { href: `/payment/pending?order=${encodeURIComponent(o.orderId)}`, text: 'Check status' });
        return '—';
      } },
    ], orders, { caption: 'Payments' }));
  }
  load();
})();
