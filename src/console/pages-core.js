// The frames of the Core operations pages built in Phase 2 (docs/ADMIN-PHASE-2.md).
// Customers is in ./pages.js; everything here is listed into PAGES there.
import { select, dayField, section, panel, lines, listFrame, recordFrame, downloadButton } from './page-kit.js';

/* ---------- Payments ---------- */
function paymentsBody(me) {
  return listFrame({
    title: 'Payments',
    sub: 'Every order, and what Razorpay says about it. Open one to see its payment attempts and refunds.',
    action: me.permissions.includes('payments.export') ? downloadButton() : '',
    label: 'Find payments',
    search: { label: 'Search payments', placeholder: 'Email, order, payment or invoice number' },
    filters: [
      select('status', 'Status', [['', 'All payments'], ['paid', 'Paid'], ['pending', 'Not paid yet'], ['failed', 'Failed'], ['refunded', 'Refunded'], ['cancelled', 'Cancelled']]),
      select('package', 'Plan', [['', 'All plans']]),
      dayField('from', 'From'),
      dayField('to', 'To'),
    ].join('\n'),
    heads: [['Date', 'col-wide'], ['Customer'], ['Plan', 'col-wide'], ['Amount', 'num'], ['Status', 'col-fit'], ['Paid with', 'col-wide'], ['Invoice', 'col-wide']],
  });
}

function paymentBody(me) {
  const has = (k) => me.permissions.includes(k);
  return recordFrame({
    back: ['Payments', '/payments'],
    missing: ['Payment not found', 'There is no order with this ID.'],
    main: [
      section('attempts', 'Payment attempts', lines(3)),
      section('refunds', 'Refunds', lines(2)),
      has('audit.view') ? section('activity', 'History', lines(3), '<span class="panel-meta">What happened to this order, and who did it</span>') : '',
    ].join('\n'),
    side: [panel('order', 'Order', 5), panel('customer', 'Customer', 3), panel('plan', 'Plan and invoice', 3)].join('\n'),
    sideLabel: 'Order details',
  });
}

export const CORE_PAGES = [
  { key: 'payments', path: '/payments', title: 'Payments', crumbs: ['Core operations', 'Payments'],
    permission: 'payments.view', body: paymentsBody, scripts: ['payments.js'] },
  { key: 'payments', match: /^\/payments\/([\w-]{1,64})$/, names: ['id'], title: 'Payment', crumbs: ['Core operations', ['Payments', '/payments'], 'Payment'],
    permission: 'payments.view', body: paymentBody, scripts: ['payment.js'] },
];
