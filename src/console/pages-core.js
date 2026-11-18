// The frames of the Core operations pages built in Phase 2 (docs/ADMIN-PHASE-2.md).
// Customers is in ./pages.js; everything here is listed into PAGES there.
import { esc } from '../layout.js';
import { icon } from './icons.js';
import { CONSOLE_BASE } from './config.js';
import { select, dayField, section, panel, lines, listFrame, recordFrame, downloadButton, skeletonRows } from './page-kit.js';

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

/* ---------- Packages ---------- */
function packagesBody(me) {
  const canEdit = me.permissions.includes('packages.manage');
  return `<div class="page-head page-head-row">
<div><h1>Packages</h1>
<p class="page-sub">The plans customers can buy, and the Free plan. Open one to change its price, length or what it includes.</p></div>
${canEdit ? `<a class="btn btn-quiet" href="${esc(CONSOLE_BASE)}/packages/new">${icon('package')}<span>New package</span></a>` : ''}
</div>
<div class="table-panel">
<table class="list fold" id="list" aria-busy="true">
<thead><tr><th scope="col">Package</th><th scope="col" class="num">Price</th><th scope="col" class="col-wide">Length</th><th scope="col" class="num col-wide">Customers</th>
<th scope="col" class="num col-wide">Sold in 30 days</th><th scope="col" class="col-fit">On the plans page</th></tr></thead>
<tbody id="listBody">${skeletonRows(5, 6)}</tbody>
</table>
</div>
<p class="hint">A package is never deleted: take it off sale instead. Customers who bought it keep what it gave them.</p>`;
}

const field = (name, label, control, hint = '') => `<div class="field" data-field="${esc(name)}"><label for="f-${esc(name)}">${esc(label)}</label>${control}
${hint ? `<p class="field-hint" id="f-${esc(name)}-hint">${esc(hint)}</p>` : ''}<p class="err" id="f-${esc(name)}-err" hidden></p></div>`;
const input = (name, { mode = 'text', max = 60, more = '' } = {}) => `<input id="f-${esc(name)}" name="${esc(name)}" type="text" inputmode="${mode}" maxlength="${max}" autocomplete="off"${more}>`;
const tick = (name, label, hint = '') => `<label class="tick" for="f-${esc(name)}"><input type="checkbox" id="f-${esc(name)}" name="${esc(name)}"><span><span class="tick-label">${esc(label)}</span>${hint ? `<span class="tick-hint">${esc(hint)}</span>` : ''}</span></label>`;

function packageBody(me, params) {
  const isNew = !params.id;
  const canEdit = me.permissions.includes('packages.manage');
  return `<a class="back" href="${esc(CONSOLE_BASE)}/packages">${icon('arrowLeft')}<span>Packages</span></a>

<div class="empty empty-page" id="recMissing" hidden>
<div class="empty-icon">${icon('help')}</div>
<h1 id="recMissingTitle">Package not found</h1>
<p id="recMissingText">There is no package with this ID.</p>
<a class="btn btn-quiet" href="${esc(CONSOLE_BASE)}/packages">Back to packages</a>
</div>

<div id="pkgPage" aria-busy="true">
<div class="page-head"><h1 id="pkgTitle">${isNew ? 'New package' : '<span class="skeleton skeleton-wide"></span>'}</h1>
<p class="page-sub" id="pkgSub">${isNew ? 'It starts off sale, so you can check it before customers see it.' : ''}</p></div>
<div id="pkgNote"></div>

<div class="detail-grid${isNew ? ' detail-grid-one' : ''}">
<form class="detail-main pkg-form" id="pkgForm" novalidate${canEdit ? '' : ' data-readonly'}>
<section class="block" aria-labelledby="pkgBasicsTitle"><div class="block-head"><h2 id="pkgBasicsTitle">Name and price</h2></div>
<div class="form-grid">
${field('name', 'Name', input('name'))}
${isNew ? field('id', 'ID', input('id', { max: 31, more: ' spellcheck="false" placeholder="for example pro-yearly"' }), 'Lower-case letters, digits and hyphens. It is used in checkout links and cannot be changed later.') : ''}
${field('price', 'Price (₹)', input('price', { mode: 'decimal', max: 12 }))}
${field('validityDays', 'Length in days', input('validityDays', { mode: 'numeric', max: 4 }), '')}
</div>
${tick('noEnd', 'No end date', 'Customers keep it for good, like Lifetime.')}
${field('description', 'Description', '<textarea id="f-description" name="description" rows="2" maxlength="500"></textarea>', 'Shown on the plans page and at checkout.')}
</section>

<section class="block" aria-labelledby="pkgIncludesTitle"><div class="block-head"><h2 id="pkgIncludesTitle">What it includes</h2></div>
<fieldset class="field ticks" data-field="features"><legend class="vh">Features</legend><div class="tick-grid" id="featureList">${lines(4)}</div><p class="err" id="f-features-err" hidden></p></fieldset>
<div class="form-grid" data-field="limits">
${field('lessons', 'Lessons', '<select id="f-lessons" name="lessons"><option value="first5">The first 5 lessons</option><option value="all">All 78 lessons</option></select>')}
${field('dailyTests', 'Saved typing tests a day', input('dailyTests', { mode: 'numeric', max: 5 }))}
${field('historyDays', 'Days of history shown', input('historyDays', { mode: 'numeric', max: 4 }))}
</div>
<div class="tick-row">${tick('noTestLimit', 'No daily limit on tests')}${tick('allHistory', 'All history')}</div>
<p class="err" id="f-limits-err" hidden></p>
</section>

<section class="block" aria-labelledby="pkgShowTitle"><div class="block-head"><h2 id="pkgShowTitle">On the plans page</h2></div>
${tick('active', 'On sale', 'Customers can buy it. Off sale, it is hidden from the plans page and checkout.')}
${tick('highlight', 'Recommended', 'Shown as the recommended plan. Only one package can be: choosing this one takes it off the others.')}
<div class="form-grid">${field('displayOrder', 'Place on the plans page', input('displayOrder', { mode: 'numeric', max: 4 }), 'Lower numbers come first.')}</div>
</section>

${canEdit ? `<div class="form-actions"><button type="submit" class="btn btn-primary" id="pkgSave">${isNew ? 'Create package' : 'Save changes'}</button>
<a class="btn btn-quiet" href="${esc(CONSOLE_BASE)}/packages">Cancel</a></div>
<div class="alert alert-bad" id="pkgErr" role="alert" hidden>${icon('alert')}<span></span></div>` : ''}
</form>
${isNew ? '' : `<aside class="detail-side" aria-label="Customers and history">
${panel('stats', 'Customers and sales', 3)}
${me.permissions.includes('audit.view') ? panel('history', 'History', 3) : ''}
</aside>`}
</div>
</div>`;
}

/* ---------- Dashboard ---------- */
const tiles = (id, n) => `<div class="tiles" id="${id}">${Array.from({ length: n }, () => '<div class="tile" aria-hidden="true"><span class="skeleton"></span><span class="skeleton skeleton-wide"></span></div>').join('')}</div>`;
function dashboardBody(me) {
  const money = me.permissions.includes('revenue.view');
  return `<div class="page-head">
<h1>Dashboard</h1>
<p class="page-sub">How TypeCraft is doing, from the live data. Days are India days, and each figure is compared with the same number of days just before.</p>
</div>
<div class="dash-bar">
<div class="seg" role="group" aria-label="Period" id="rangePick">
<button type="button" data-range="today" aria-pressed="false">Today</button><button type="button" data-range="7d" aria-pressed="true">Last 7 days</button><button type="button" data-range="30d" aria-pressed="false">Last 30 days</button>
</div>
<button type="button" class="btn btn-quiet btn-sm" id="refreshBtn">${icon('refresh')}<span>Refresh</span></button>
<span class="list-meta" id="dashUpdated" aria-live="polite"></span>
</div>

<div id="dash" aria-busy="true">
<section class="block" aria-labelledby="attentionTitle"><div class="block-head"><h2 id="attentionTitle">Needs attention</h2></div><div id="attentionBody">${lines(2)}</div></section>
<section class="block" aria-labelledby="customersTitle"><div class="block-head"><h2 id="customersTitle">Customers</h2></div>${tiles('customerTiles', 4)}</section>
<section class="block" aria-labelledby="paymentsTitle"><div class="block-head"><h2 id="paymentsTitle">Payments</h2></div>${tiles('paymentTiles', 3)}</section>
${money ? `<section class="block" aria-labelledby="moneyTilesTitle"><div class="block-head"><h2 id="moneyTilesTitle">Money</h2></div>${tiles('moneyTiles', 3)}</section>` : ''}
<div class="dash-cols">
<section class="block" aria-labelledby="plansTitle"><div class="block-head"><h2 id="plansTitle">Paid plans in force</h2><span class="panel-meta" id="plansMeta"></span></div><div id="plansBody">${lines(4)}</div></section>
<section class="block" aria-labelledby="signupsTitle"><div class="block-head"><h2 id="signupsTitle">Sign-ups per day</h2></div><div class="chart" id="signupsChart">${lines(3)}</div></section>
</div>
<section class="block" aria-labelledby="moneyTitle"><div class="block-head"><h2 id="moneyTitle">${money ? 'Money in per day, after refunds' : 'Payments per day'}</h2></div><div class="chart" id="moneyChart">${lines(3)}</div></section>
</div>`;
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
  { key: 'dashboard', path: '/dashboard', title: 'Dashboard', crumbs: ['Core operations', 'Dashboard'],
    permission: 'dashboard.view', body: dashboardBody, scripts: ['charts.js', 'dashboard.js'] },
  { key: 'packages', path: '/packages', title: 'Packages', crumbs: ['Core operations', 'Packages'],
    permission: 'packages.view', body: packagesBody, scripts: ['packages.js'] },
  { key: 'packages', path: '/packages/new', title: 'New package', crumbs: ['Core operations', ['Packages', '/packages'], 'New package'],
    permission: 'packages.manage', body: packageBody, scripts: ['package.js'] },
  { key: 'packages', match: /^\/packages\/([a-z][a-z0-9-]{0,30})$/, names: ['id'], title: 'Package', crumbs: ['Core operations', ['Packages', '/packages'], 'Package'],
    permission: 'packages.view', body: packageBody, scripts: ['package.js'] },
];
