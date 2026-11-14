/* /account/payments. Data: GET /api/me/orders {orders:[{id|orderId, packageName, amountPaise, currency, status, createdAt,
   paidAt?, razorpayPaymentId?, invoiceNumber?, failureReason?, refundedPaise?, method?}]}. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const el = $('#pay-list');
  const STATUS = { created: 'Not completed', attempted: 'Not completed', pending: 'Processing', paid: 'Paid', failed: 'Failed', refunded: 'Refunded', partially_refunded: 'Part refunded', cancelled: 'Cancelled' };

  async function load() {
    K.skeleton(el, 5);
    const res = await K.api('GET', '/api/me/orders');
    if (!res.ok) return K.error(el, res, load);
    const orders = K.list(res.data, 'orders', 'items');
    if (!orders.length) return K.empty(el, { icon: 'card', title: 'No payments yet', text: 'When you buy a plan, the payment appears here with its receipt and invoice.', action: { href: '/pricing', label: 'See plans' } });
    K.mount(el, K.table([
      { label: 'Date', value: (o) => K.dateTime(K.pick(o, 'paidAt', 'createdAt', 'created_at')) },
      { label: 'Plan', value: (o) => K.pick(o, 'packageName', 'package_name', 'packageId') },
      { label: 'Amount', num: true, value: (o) => {
        const amt = K.money(K.pick(o, 'amountPaise', 'amount_paise'), o.currency);
        const ref = K.pick(o, 'refundedPaise', 'refunded_paise');
        return ref ? [amt, h('br'), h('span', { class: 'muted', text: `${K.money(ref, o.currency)} refunded` })] : amt;
      } },
      { label: 'Status', value: (o) => [K.badge(o.status, STATUS[o.status]), o.status === 'failed' && K.pick(o, 'failureReason', 'failure_reason') ? h('p', { class: 'muted', style: 'margin:.25rem 0 0', text: K.pick(o, 'failureReason', 'failure_reason') }) : null] },
      { label: 'Payment id', value: (o) => { const id = K.pick(o, 'razorpayPaymentId', 'razorpay_payment_id', 'paymentId'); return id ? h('span', { class: 'mono', text: id }) : '—'; } },
      { label: 'Invoice', value: (o) => {
        const n = K.pick(o, 'invoiceNumber', 'invoice_number');
        if (n) return h('a', { href: `/account/invoices/${encodeURIComponent(n)}`, text: n, class: 'mono' });
        if (o.status === 'pending') return h('a', { href: `/payment/pending?order=${encodeURIComponent(K.pick(o, 'id', 'orderId'))}`, text: 'Check status' });
        return '—';
      } },
    ], orders, { caption: 'Payments' }));
  }
  load();
})();
