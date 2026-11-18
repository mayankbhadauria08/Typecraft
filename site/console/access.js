/* Learning access list: lessons and games opened or closed for one customer.
   GET /api/console/access?q=&state=&kind=&effect=&page=
     → { items: [{ id, kind, target, targetName, effect, reason, state, expiresAt, createdAt, createdBy, endedAt, endedBy,
                   customer: { id, fullName, email } }], page, pageSize, pages, total }
   Ending one: AC.access (access-actions.js). */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var canManage = AC.can('access.manage'), canCustomers = AC.can('customers.view');
  var view = null;

  function row(a) {
    var c = a.customer, name = c.fullName || 'No name', who = c.fullName || c.email;
    return el('tr', a.state === 'active' ? null : { class: 'is-past' }, [
      el('td', null, [
        canCustomers ? el('a', { class: 'cell-link', href: AC.base + '/customers/' + encodeURIComponent(c.id), text: name }) : el('span', { class: 'cell-main', text: name }),
        el('div', { class: 'cell-sub', text: c.email }),
        el('div', { class: 'person-extra' }, [AC.status('access', a.effect), el('span', { text: AC.access.until(a) })])
      ]),
      el('td', null, [el('span', { class: 'cell-main', text: a.targetName }), el('div', { class: 'cell-sub', text: a.kind === 'lesson' ? 'Lesson' : 'Arcade game' })]),
      el('td', { class: 'col-fit' }, AC.status('access', a.effect)),
      el('td', { class: 'col-wide nowrap', text: AC.access.until(a) }),
      el('td', { class: 'col-wide' }, el('div', { class: 'measure', text: a.reason })),
      el('td', { class: 'col-wide nowrap', title: AC.fmt.dateTime(a.createdAt), text: (a.createdBy || 'Deleted account') }),
      el('td', { class: 'col-act' }, canManage && a.state === 'active' ? el('button', { type: 'button', class: 'btn-link', text: 'End', 'aria-label': 'End the exception for ' + a.targetName,
        on: { click: function () { AC.access.end(a, who).then(function (r) { if (r && r !== true) view.reload(); }); } } }) : null)
    ]);
  }
  view = AC.listPage({ endpoint: '/api/console/access', noun: ['exception', 'exceptions'], empty: 'No lesson or game has been opened or closed for anyone.', row: row });
})();
