/* Packages list.
   GET /api/console/packages → { items: [{ id, name, description, pricePaise, currency, validityDays, features, limits, highlight, active,
                                           displayOrder, customers, sales30: { orders, grossPaise | null } | null }], features } */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var body = doc.getElementById('listBody'), table = doc.getElementById('list');

  function days(n) { return n === null ? 'No end date' : Number(n).toLocaleString('en-IN') + (n === 1 ? ' day' : ' days'); }
  function row(p) {
    var open = AC.base + '/packages/' + encodeURIComponent(p.id);
    var sold = p.sales30 ? Number(p.sales30.orders).toLocaleString('en-IN') + (p.sales30.grossPaise !== null && p.sales30.orders ? ' (' + AC.money(p.sales30.grossPaise, p.currency) + ')' : '') : '–';
    return el('tr', null, [
      el('td', null, [
        el('a', { class: 'cell-link', href: open, text: p.name }),
        el('div', { class: 'cell-sub measure', text: p.description }),
        el('div', { class: 'person-extra' }, [p.active ? null : AC.badge('Off sale'), p.highlight ? AC.badge('Recommended', 'role') : null, el('span', { text: days(p.validityDays) })])
      ]),
      el('td', { class: 'num', text: p.pricePaise ? AC.money(p.pricePaise, p.currency) : 'Free' }),
      el('td', { class: 'col-wide nowrap', text: days(p.validityDays) }),
      el('td', { class: 'num col-wide', text: Number(p.customers).toLocaleString('en-IN') }),
      el('td', { class: 'num col-wide', text: sold }),
      el('td', { class: 'col-fit' }, el('div', { class: 'badges' }, [p.active ? AC.badge('On sale', 'ok') : AC.badge('Off sale'), p.highlight ? AC.badge('Recommended', 'role') : null]))
    ]);
  }
  function load() {
    AC.api('GET', '/api/console/packages').then(function (d) {
      AC.clear(body);
      d.items.forEach(function (p) { body.appendChild(row(p)); });
      table.removeAttribute('aria-busy');
    }, function (err) {
      AC.clear(body);
      body.appendChild(el('tr', null, el('td', { class: 'empty-cell', colspan: 6 }, ["Couldn't load the packages. " + err.message,
        el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Try again', on: { click: load } })])));
      table.removeAttribute('aria-busy');
    });
  }
  load();
})();
