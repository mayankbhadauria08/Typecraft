/* Refunds list.
   GET /api/console/refunds?q=&status=&from=&to=&page=
     → { items: [{ id, orderId, amountPaise, currency, status, reason, razorpayRefundId, requestedBy, packageName, processedAt, createdAt,
                   customer: { id, fullName, email } }], page, pageSize, pages, total }
   A refund is sent from its payment's page (payment.js). */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var canCustomers = AC.can('customers.view'), canPayments = AC.can('payments.view');

  function row(r) {
    var c = r.customer, name = c.fullName || 'No name';
    var open = canPayments ? AC.base + '/payments/' + encodeURIComponent(r.orderId) : null;
    var when = open ? el('a', { class: 'cell-link', href: open, text: AC.fmt.date(r.createdAt) }) : el('span', { class: 'cell-main', text: AC.fmt.date(r.createdAt) });
    return el('tr', null, [
      el('td', { class: 'col-wide nowrap' }, [when, el('div', { class: 'cell-sub', text: r.packageName })]),
      el('td', null, [
        canCustomers ? el('a', { class: 'cell-link', href: AC.base + '/customers/' + encodeURIComponent(c.id), text: name }) : el('span', { class: 'cell-main', text: name }),
        el('div', { class: 'cell-sub', text: c.email }),
        // on a phone the other columns are folded into this one
        el('div', { class: 'person-extra' }, [AC.status('refund', r.status), el('span', { text: r.reason || '' }),
          open ? el('a', { href: open, text: AC.fmt.date(r.createdAt) }) : el('span', { text: AC.fmt.date(r.createdAt) })])
      ]),
      el('td', { class: 'num', text: AC.money(r.amountPaise, r.currency) }),
      el('td', { class: 'col-fit' }, AC.status('refund', r.status)),
      el('td', { class: 'col-wide' }, el('div', { class: 'measure', text: r.reason || '–' })),
      el('td', { class: 'col-wide nowrap', text: r.requestedBy || 'Started at Razorpay' })
    ]);
  }

  AC.listPage({
    endpoint: '/api/console/refunds',
    noun: ['refund', 'refunds'],
    empty: 'No money has been refunded yet.',
    row: row
  });
})();
