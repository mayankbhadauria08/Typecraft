/* Promotions (sales): the list, "New sale", and changing, turning off or deleting one.
   GET /api/console/promotions?status=&page= → { items: [{ id, name, kind, value, off, plans, plansLabel, startsAt, endsAt, active, state, orders,
     examples: [{ id, name, listPaise, pricePaise }] }], page, pageSize, pages, total, plans, can: { manage } } */
(function () {
  'use strict';
  var AC = window.AC, DK = window.DK, el = AC.el;
  var last = null, view;

  function send(m, b, method, body, confirmOpts) {
    var go = function () {
      AC.busy(b, true);
      AC.api(method, '/api/console/promotions/' + encodeURIComponent(m.id), body).then(function (res) { AC.toast(res.message); view.reload(); },
        function (err) { AC.busy(b, false); if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
    };
    if (confirmOpts) AC.confirm(confirmOpts).then(function (ok) { if (ok) go(); }); else go();
  }

  function row(m, d) {
    var tools = null;
    if (d.can.manage) {
      var change = el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Change' });
      var toggle = el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: m.active ? 'Turn off' : 'Turn on' });
      change.addEventListener('click', function () { DK.saleDialog({ sale: m, plans: d.plans }).then(function (res) { if (res) { AC.toast(res.message); view.reload(); } }); });
      toggle.addEventListener('click', function () {
        send(m, toggle, 'PUT', { active: !m.active }, m.active && m.state === 'live' ? { title: 'End ' + m.name + ' now?', text: 'Prices go back to normal straight away.', confirmLabel: 'Turn off' } : null);
      });
      var kids = [change, toggle];
      if (!m.orders) {
        var del = el('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': 'Delete ' + m.name }, AC.icon('trash'));
        del.addEventListener('click', function () { send(m, del, 'DELETE', undefined, { title: 'Delete ' + m.name + '?', text: 'Nobody has bought at this price. This can’t be undone.', danger: true, confirmLabel: 'Delete' }); });
        kids.push(del);
      }
      tools = el('div', { class: 'row-tools' }, kids);
    }
    var cheapest = (m.examples || []).map(function (x) { return x.name + ' ' + AC.money(x.pricePaise); }).join(', ');
    return el('tr', null, [
      el('td', null, [el('div', { class: 'cell-main', text: m.name }), cheapest ? el('div', { class: 'cell-sub', text: cheapest }) : null,
        el('div', { class: 'person-extra' }, [AC.status('promotion', m.state), el('span', { text: m.off })])]),
      el('td', { class: 'col-wide', text: m.off }),
      el('td', { class: 'col-wide', text: m.plansLabel }),
      el('td', { class: 'col-wide', text: DK.when(m.startsAt, m.endsAt) }),
      el('td', { class: 'col-fit', text: String(m.orders) }),
      el('td', { class: 'col-fit' }, AC.status('promotion', m.state)),
      el('td', { class: 'col-fit' }, tools)
    ]);
  }

  view = AC.listPage({
    endpoint: '/api/console/promotions',
    noun: ['sale', 'sales'],
    empty: 'No sales yet.',
    row: row,
    onData: function (d) { last = d; }
  });
  var add = document.getElementById('newPromotion');
  if (add) add.addEventListener('click', function () {
    DK.saleDialog({ plans: last ? last.plans : [] }).then(function (res) { if (res) { AC.toast(res.message); view.reload(); } });
  });
})();
