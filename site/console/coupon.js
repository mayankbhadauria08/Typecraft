/* One coupon.
   GET /api/console/coupons/:id → { coupon: { …, examples: [{ id, name, listPaise, pricePaise }] }, orders: [{ id, status, amountPaise, listPaise, discountPaise, paidAt,
     packageName, customer: { id, fullName, email } }], totals: { orders, salesPaise, discountPaise }, plans, history: [{ action, actor, createdAt }], can: { manage } }
   PUT /api/console/coupons/:id (fields, or { active }) · DELETE /api/console/coupons/:id */
(function () {
  'use strict';
  var AC = window.AC, DK = window.DK, el = AC.el;
  var id = location.pathname.split('/').pop();
  var path = '/api/console/coupons/' + encodeURIComponent(id);
  var rec;
  var LABELS = { 'coupon.create': 'Made', 'coupon.update': 'Changed', 'coupon.on': 'Turned on', 'coupon.off': 'Turned off' };

  function button(label, iconName, cls, onClick) {
    var b = el('button', { type: 'button', class: 'btn ' + cls }, [iconName ? AC.icon(iconName) : null, el('span', { text: label })]);
    b.addEventListener('click', function () { onClick(b); });
    return b;
  }
  function send(b, method, body, done) {
    AC.busy(b, true);
    AC.api(method, path, body).then(function (res) { AC.toast(res.message); if (done) done(); else rec.load(); },
      function (err) { AC.busy(b, false); if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
  }

  function render(d) {
    var c = d.coupon;
    var actions = [];
    if (d.can.manage) {
      actions.push(button('Change', 'note', 'btn-quiet', function () {
        DK.couponDialog({ coupon: c, plans: d.plans }).then(function (res) { if (res) { AC.toast(res.message); rec.load(); } });
      }));
      actions.push(button(c.active ? 'Turn off' : 'Turn on', c.active ? 'x' : 'check', 'btn-quiet', function (b) { send(b, 'PUT', { active: !c.active }); }));
      if (!d.orders.length) actions.push(button('Delete', 'trash', 'btn-quiet', function (b) {
        AC.confirm({ title: 'Delete ' + c.code + '?', text: 'Nobody has used it. This can’t be undone.', danger: true, confirmLabel: 'Delete' })
          .then(function (ok) { if (ok) send(b, 'DELETE', undefined, function () { location.assign(AC.base + '/coupons'); }); });
      }));
    }
    AC.head({
      title: c.code, crumb: c.code,
      sub: [el('span', { text: c.off + ' · ' + c.plansLabel })],
      badges: [AC.status('coupon', c.state)],
      actions: actions,
      note: c.note ? AC.notice(c.note, 'quiet') : null
    });
    AC.fill('termsBody', [AC.facts([
      AC.fact('Takes off', el('span', { text: c.off })),
      AC.fact('Works on', el('span', { text: c.plansLabel })),
      AC.fact('When', el('span', { text: DK.when(c.startsAt, c.endsAt) })),
      AC.fact('Uses', el('span', { text: c.uses + (c.maxUses != null ? ' of ' + c.maxUses + ' allowed' : ', no limit') })),
      AC.fact('Each customer', el('span', { text: c.oncePerCustomer ? 'Once' : 'As often as they like' }))
    ])]);
    document.getElementById('usesMeta').textContent = d.totals.orders ? AC.money(d.totals.salesPaise) + ' paid, ' + AC.money(d.totals.discountPaise) + ' off' : '';
    AC.fill('usesBody', [d.orders.length ? AC.table([['Customer'], ['Plan', 'col-wide'], ['Paid', 'num'], ['Off', 'num'], ['When', 'col-wide']], d.orders.map(function (o) {
      return el('tr', null, [
        el('td', null, [AC.can('customers.view') ? el('a', { class: 'cell-link', href: AC.base + '/customers/' + encodeURIComponent(o.customer.id), text: o.customer.fullName }) : el('span', { text: o.customer.fullName }),
          el('div', { class: 'cell-sub', text: o.customer.email })]),
        el('td', { class: 'col-wide', text: o.packageName }),
        el('td', { class: 'num' }, [AC.can('payments.view') ? el('a', { href: AC.base + '/payments/' + encodeURIComponent(o.id), text: AC.money(o.amountPaise) }) : el('span', { text: AC.money(o.amountPaise) }),
          o.status !== 'paid' ? el('div', null, AC.status('order', o.status)) : null]),
        el('td', { class: 'num', text: AC.money(o.discountPaise) }),
        el('td', { class: 'col-wide nowrap', text: AC.fmt.date(o.paidAt) })
      ]);
    })) : AC.quiet('Nobody has paid with this code yet.')]);
    AC.fill('pricesBody', [DK.prices(c.examples)]);
    AC.fill('historyBody', [AC.timeline(d.history, LABELS, 'Nothing yet.')]);
  }

  rec = AC.record({ endpoint: path, notFound: ['Coupon not found', 'There is no coupon with this ID. It may have been deleted.'], render: render });
})();
