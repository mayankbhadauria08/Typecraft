/* Payments list: one row per order.
   GET /api/console/payments?q=&status=&package=&from=&to=&page=
     → { items: [{ id, createdAt, paidAt, status, amountPaise, currency, refundedPaise, packageName, method, invoiceNumber,
                   customer: { id, fullName, email } }], page, pageSize, pages, total, packages: [{ id, name }] }
   GET /api/console/payments/export.csv (same filters) → a spreadsheet; asks for the password first. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var canCustomers = AC.can('customers.view');

  function row(o) {
    var c = o.customer, name = c.fullName || 'No name', open = AC.base + '/payments/' + encodeURIComponent(o.id);
    return el('tr', null, [
      el('td', { class: 'col-wide nowrap' }, [
        el('a', { class: 'cell-link', href: open, text: AC.fmt.date(o.createdAt) }),
        el('div', { class: 'cell-sub', text: AC.fmt.time(o.createdAt) })
      ]),
      el('td', null, [
        canCustomers ? el('a', { class: 'cell-link', href: AC.base + '/customers/' + encodeURIComponent(c.id), text: name }) : el('span', { class: 'cell-main', text: name }),
        el('div', { class: 'cell-sub', text: c.email }),
        // on a phone the other columns are folded into this one
        el('div', { class: 'person-extra' }, [AC.status('order', o.status), el('span', { text: o.packageName }), el('a', { href: open, text: AC.fmt.dateTime(o.createdAt) })])
      ]),
      el('td', { class: 'col-wide', text: o.packageName }),
      el('td', { class: 'num' }, [AC.money(o.amountPaise, o.currency),
        o.refundedPaise ? el('div', { class: 'cell-sub', text: AC.money(o.refundedPaise, o.currency) + ' refunded' }) : null]),
      el('td', { class: 'col-fit' }, AC.status('order', o.status)),
      el('td', { class: 'col-wide', text: AC.method(o.method) }),
      el('td', { class: 'col-wide mono', text: o.invoiceNumber || '–' })
    ]);
  }

  AC.listPage({
    endpoint: '/api/console/payments',
    noun: ['payment', 'payments'],
    empty: 'No one has started a payment yet.',
    row: row,
    onData: function (data) { AC.options(document.querySelector('#filters [name="package"]'), data.packages); },
    exportPath: '/api/console/payments/export.csv',
    exportNote: 'It holds personal details: keep it safe.'
  });
})();
