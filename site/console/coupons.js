/* Coupons: the list and "New coupon".
   GET /api/console/coupons?q=&status=&page= → { items: [{ id, code, note, kind, value, off, plans, plansLabel, startsAt, endsAt, maxUses, oncePerCustomer,
     active, uses, state }], page, pageSize, pages, total, plans: [{ id, name, pricePaise, onSale }], totals: { orders, discountPaise }, can: { manage } } */
(function () {
  'use strict';
  var AC = window.AC, DK = window.DK, el = AC.el;
  var last = null, totals = document.getElementById('couponTotals');

  function row(c) {
    var open = AC.base + '/coupons/' + encodeURIComponent(c.id);
    return el('tr', null, [
      el('td', null, [
        el('a', { class: 'cell-link mono', href: open, text: c.code }),
        c.note ? el('div', { class: 'cell-sub', text: c.note }) : null,
        el('div', { class: 'person-extra' }, [AC.status('coupon', c.state), el('span', { text: c.off })])
      ]),
      el('td', { class: 'col-wide' }, [el('div', { text: c.off }), el('div', { class: 'cell-sub', text: c.oncePerCustomer ? 'Once per customer' : 'Can be used again' })]),
      el('td', { class: 'col-wide', text: c.plansLabel }),
      el('td', { class: 'col-fit', text: c.uses + (c.maxUses != null ? ' of ' + c.maxUses : '') }),
      el('td', { class: 'col-wide', text: DK.when(c.startsAt, c.endsAt) }),
      el('td', { class: 'col-fit' }, AC.status('coupon', c.state))
    ]);
  }

  AC.listPage({
    endpoint: '/api/console/coupons',
    noun: ['coupon', 'coupons'],
    empty: 'No coupons yet.',
    row: row,
    onData: function (d) {
      last = d;
      AC.clear(totals);
      totals.appendChild(el('div', { class: 'limit-inner' }, [AC.icon('receipt'),
        el('span', { text: d.totals.orders ? d.totals.orders.toLocaleString('en-IN') + ' paid orders used a coupon, ' + AC.money(d.totals.discountPaise) + ' off in all.' : 'No paid order has used a coupon yet.' }),
        d.can.manage ? null : el('span', { class: 'muted', text: 'Making coupons needs the "Make and change coupons" permission.' })]));
    }
  });

  var add = document.getElementById('newCoupon');
  if (add) add.addEventListener('click', function () {
    DK.couponDialog({ plans: last ? last.plans : [] }).then(function (res) { if (res) location.assign(AC.base + '/coupons/' + encodeURIComponent(res.id)); });
  });
})();
