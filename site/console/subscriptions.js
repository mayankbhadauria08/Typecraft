/* Subscriptions list: every plan customers have or had.
   GET /api/console/subscriptions?q=&state=&package=&source=&page=
     → { items: [{ id, packageId, packageName, orderId, source, status, startsAt, expiresAt, createdAt, customer: { id, fullName, email } }],
         page, pageSize, pages, total, counts: { active, ending, expired, revoked, extendable }, packages: [{ id, name }] }
   Extending and ending plans: AC.plans (plan-actions.js). */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var canManage = AC.can('subscriptions.manage'), canCustomers = AC.can('customers.view'), canPayments = AC.can('payments.view');
  var STATES = { active: 'Active', ending: 'Ending in 7 days', expired: 'Ended', revoked: 'Ended early' };
  var counts = null, view = null;
  var reload = function (r) { if (r && r !== true) view.reload(); };

  function how(s) {
    if (s.source === 'purchase' && s.orderId && canPayments) return el('a', { href: AC.base + '/payments/' + encodeURIComponent(s.orderId), text: 'Bought' });
    return AC.source(s.source);
  }
  function actions(s, who) {
    if (!canManage || (s.status !== 'active' && s.status !== 'upcoming')) return null;
    return el('div', { class: 'row-actions' }, [
      s.expiresAt ? el('button', { type: 'button', class: 'btn-link', text: 'Extend', 'aria-label': 'Extend ' + s.packageName + ' for ' + who,
        on: { click: function () { AC.plans.extend(s, who).then(reload); } } }) : null,
      el('button', { type: 'button', class: 'btn-link btn-link-danger', text: 'End', 'aria-label': 'End ' + s.packageName + ' for ' + who,
        on: { click: function () { AC.plans.end(s, who).then(reload); } } })
    ]);
  }
  function row(s) {
    var c = s.customer, name = c.fullName || 'No name', who = c.fullName || c.email;
    var ends = s.expiresAt ? AC.fmt.date(s.expiresAt) : 'No end date';
    return el('tr', null, [
      el('td', null, [
        canCustomers ? el('a', { class: 'cell-link', href: AC.base + '/customers/' + encodeURIComponent(c.id), text: name }) : el('span', { class: 'cell-main', text: name }),
        el('div', { class: 'cell-sub', text: c.email }),
        // on a phone the other columns are folded into this one
        el('div', { class: 'person-extra' }, [el('span', { class: 'cell-main', text: s.packageName }), AC.status('plan', s.status), el('span', { text: s.expiresAt ? 'Ends ' + ends : ends })])
      ]),
      el('td', { class: 'col-wide' }, el('span', { class: 'cell-main', text: s.packageName })),
      el('td', { class: 'col-fit' }, AC.status('plan', s.status)),
      el('td', { class: 'col-wide nowrap', text: AC.fmt.date(s.startsAt) }),
      el('td', { class: 'col-wide nowrap', title: s.expiresAt ? AC.fmt.dateTime(s.expiresAt) : null, text: ends }),
      el('td', { class: 'col-wide' }, how(s)),
      el('td', { class: 'col-act' }, actions(s, who))
    ]);
  }
  // the counts come with every answer: they go into the State filter, and into the "Extend every plan" dialog
  function onData(data) {
    AC.options(doc.querySelector('#filters [name="package"]'), data.packages);
    counts = data.counts;
    Array.prototype.forEach.call(doc.querySelector('#filters [name="state"]').options, function (o) {
      if (STATES[o.value]) o.textContent = STATES[o.value] + ' (' + Number(counts[o.value]).toLocaleString('en-IN') + ')';
    });
  }

  view = AC.listPage({ endpoint: '/api/console/subscriptions', noun: ['plan', 'plans'], empty: 'No one has a plan yet.', row: row, onData: onData });

  var all = doc.getElementById('extendAllBtn');
  if (all) all.addEventListener('click', function () {
    if (!counts) return;
    if (!counts.extendable) { AC.toast('No active plan has an end date, so there is nothing to extend.', 'info'); return; }
    AC.plans.extendAll(counts.extendable).then(reload);
  });
})();
