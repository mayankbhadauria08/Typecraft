// The frames of the Core operations pages built in Phase 2 (docs/ADMIN-PHASE-2.md).
// Customers is in ./pages.js; everything here is listed into PAGES there.
import { icon } from './icons.js';
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

/* ---------- Refunds ---------- */
function refundsBody() {
  return listFrame({
    title: 'Refunds',
    sub: 'Money sent back to customers through Razorpay. To send a refund, open the payment it belongs to.',
    label: 'Find refunds',
    search: { label: 'Search refunds', placeholder: 'Email, name, refund or order ID' },
    filters: [
      select('status', 'Status', [['', 'All refunds'], ['pending', 'On its way'], ['processed', 'Sent'], ['failed', 'Failed']]),
      dayField('from', 'From'),
      dayField('to', 'To'),
    ].join('\n'),
    heads: [['Date', 'col-wide'], ['Customer'], ['Amount', 'num'], ['Status', 'col-fit'], ['Reason', 'col-wide'], ['Sent by', 'col-wide']],
  });
}

/* ---------- Subscriptions ---------- */
function subscriptionsBody(me) {
  return listFrame({
    title: 'Subscriptions',
    sub: "Every plan customers have or had. To give someone a plan, open the customer.",
    action: me.permissions.includes('subscriptions.bulk') ? `<button type="button" class="btn btn-quiet" id="extendAllBtn">${icon('calendar')}<span>Extend every plan</span></button>` : '',
    label: 'Find plans',
    search: { label: 'Search plans', placeholder: 'Email, name or plan ID' },
    filters: [
      select('state', 'State', [['', 'All plans'], ['active', 'Active'], ['ending', 'Ending in 7 days'], ['expired', 'Ended'], ['revoked', 'Ended early']]),
      select('package', 'Plan', [['', 'Every package']]),
      select('source', 'How', [['', 'Any way'], ['purchase', 'Bought'], ['admin', 'Given by staff'], ['promo', 'Promotion']]),
    ].join('\n'),
    heads: [['Customer'], ['Plan', 'col-wide'], ['Status', 'col-fit'], ['Started', 'col-wide'], ['Ends', 'col-wide'], ['How', 'col-wide'], ['', 'col-act']],
  });
}

/* ---------- Learning access ---------- */
function accessBody() {
  return listFrame({
    title: 'Learning access',
    sub: 'Lessons and arcade games opened or closed for one customer, whatever their plan says. To add one, open the customer.',
    label: 'Find exceptions',
    search: { label: 'Search exceptions', placeholder: 'Email or name' },
    filters: [
      select('state', 'State', [['', 'In force and ended'], ['active', 'In force'], ['ended', 'Ended']]),
      select('kind', 'What', [['', 'Lessons and games'], ['lesson', 'Lessons'], ['game', 'Arcade games']]),
      select('effect', 'Effect', [['', 'Opened and closed'], ['allow', 'Opened'], ['deny', 'Closed']]),
    ].join('\n'),
    heads: [['Customer'], ['Lesson or game'], ['Effect', 'col-fit'], ['Until', 'col-wide'], ['Reason', 'col-wide'], ['Added by', 'col-wide'], ['', 'col-act']],
  });
}

export const CORE_PAGES = [
  { key: 'payments', path: '/payments', title: 'Payments', crumbs: ['Core operations', 'Payments'],
    permission: 'payments.view', body: paymentsBody, scripts: ['payments.js'] },
  { key: 'payments', match: /^\/payments\/([\w-]{1,64})$/, names: ['id'], title: 'Payment', crumbs: ['Core operations', ['Payments', '/payments'], 'Payment'],
    permission: 'payments.view', body: paymentBody, scripts: ['payment.js'] },
  { key: 'refunds', path: '/refunds', title: 'Refunds', crumbs: ['Core operations', 'Refunds'],
    permission: 'refunds.view', body: refundsBody, scripts: ['refunds.js'] },
  { key: 'subscriptions', path: '/subscriptions', title: 'Subscriptions', crumbs: ['Core operations', 'Subscriptions'],
    permission: 'subscriptions.view', body: subscriptionsBody, scripts: ['plan-actions.js', 'subscriptions.js'] },
  { key: 'access', path: '/access', title: 'Learning access', crumbs: ['Core operations', 'Learning access'],
    permission: 'access.view', body: accessBody, scripts: ['access-actions.js', 'access.js'] },
];
