/* Customers list.
   GET /api/console/customers?q=&plan=&status=&verified=&joined=&sort=&page=
     → { items: [{ id, fullName, email, phone, emailVerified, status, role, plan: { id, name, expiresAt } | null, createdAt, lastLoginAt }],
         page, pageSize, pages, total, packages: [{ id, name }] }
   GET /api/console/customers/export.csv (same filters) → a spreadsheet; asks for the password first. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var form = doc.getElementById('filters');
  var planSelect = form.querySelector('[name="plan"]');
  var ROLE = { owner: 'Super Admin', admin: 'Admin', support: 'Support' };

  function planCell(c) {
    if (!c.plan) return AC.badge('Free');
    return [AC.badge(c.plan.name, 'role'), el('div', { class: 'cell-sub', text: c.plan.expiresAt ? 'until ' + AC.fmt.date(c.plan.expiresAt) : 'no end date' })];
  }
  function accountCell(c) {
    return [
      AC.badge(c.status === 'active' ? 'Active' : 'Disabled', c.status === 'active' ? 'ok' : 'bad'),
      c.role ? AC.badge(ROLE[c.role] || 'Staff', 'warn') : null
    ];
  }
  function row(c) {
    var seen = c.lastLoginAt ? AC.fmt.ago(c.lastLoginAt) : 'Never';
    return el('tr', null, [
      el('td', null, [
        el('a', { class: 'cell-link', href: AC.base + '/customers/' + encodeURIComponent(c.id), text: c.fullName || 'No name' }),
        el('div', { class: 'cell-sub', text: c.email + (c.emailVerified ? '' : ' (not verified)') }),
        // on a phone the other columns are folded into this one
        el('div', { class: 'person-extra' }, [c.status === 'active' ? null : AC.badge('Disabled', 'bad'), c.role ? AC.badge(ROLE[c.role] || 'Staff', 'warn') : null,
          el('span', { text: c.phone }), el('span', { text: 'Joined ' + AC.fmt.date(c.createdAt) })])
      ]),
      el('td', { class: 'col-wide nowrap', text: c.phone }),
      el('td', null, planCell(c)),
      el('td', { class: 'col-fit' }, el('div', { class: 'badges' }, accountCell(c))),
      el('td', { class: 'col-wide nowrap', title: AC.fmt.dateTime(c.createdAt), text: AC.fmt.date(c.createdAt) }),
      el('td', { class: 'col-wide nowrap', title: c.lastLoginAt ? AC.fmt.dateTime(c.lastLoginAt) : null, text: seen })
    ]);
  }
  // the paid plans come with the first answer: add them to the Plan filter once
  function plansInto(data) {
    if (planSelect.getAttribute('data-filled') || !data.packages) return;
    planSelect.setAttribute('data-filled', '1');
    data.packages.forEach(function (p) { planSelect.appendChild(el('option', { value: p.id, text: p.name })); });
  }

  var view = AC.list({
    endpoint: '/api/console/customers',
    form: form,
    table: doc.getElementById('list'),
    body: doc.getElementById('listBody'),
    pager: doc.getElementById('pager'),
    count: doc.getElementById('listCount'),
    clear: doc.getElementById('clearFilters'),
    columns: 6,
    noun: ['customer', 'customers'],
    empty: 'No one has signed up yet.',
    row: row,
    onData: plansInto
  });

  var exportBtn = doc.getElementById('exportBtn');
  if (exportBtn) exportBtn.addEventListener('click', function () {
    var q = new URLSearchParams(view.query());
    q.delete('page');
    var qs = q.toString();
    AC.download('/api/console/customers/export.csv' + (qs ? '?' + qs : ''), exportBtn).then(function (name) {
      AC.toast('Saved ' + name + '. It holds personal details: keep it safe.');
    }, function (err) { if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
  });
})();
