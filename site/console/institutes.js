/* Institutes list.
   GET /api/console/institutes?q=&status=&page=
     → { items: [{ id, name, city, status, packageName, seats, seatsUsed, startsAt, endsAt, lastDay, admin, paidPaise | null, duePaise | null }],
         page, pageSize, pages, total, packages: [{ id, name, active }], money, today }
   "New institute": AC.institutes.create (institute-actions.js). */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var packages = [], today = null;

  function row(i) {
    var open = AC.base + '/institutes/' + encodeURIComponent(i.id);
    var full = i.seatsUsed >= i.seats;
    return el('tr', null, [
      el('td', null, [
        el('a', { class: 'cell-link', href: open, text: i.name }),
        el('div', { class: 'cell-sub', text: [i.city, i.packageName].filter(Boolean).join(' · ') }),
        el('div', { class: 'person-extra' }, [AC.status('institute', i.status), el('span', { text: i.seatsUsed + ' of ' + i.seats + ' seats' })])
      ]),
      el('td', { class: 'col-fit' }, AC.status('institute', i.status)),
      el('td', { class: 'num' }, [el('span', { text: i.seatsUsed + ' / ' + i.seats }), full ? el('div', { class: 'cell-sub', text: 'Full' }) : null]),
      el('td', { class: 'col-wide nowrap', text: AC.fmt.date(i.lastDay + 'T12:00:00+05:30') }),
      el('td', { class: 'col-wide', text: i.admin || 'Not invited' }),
      el('td', { class: 'num col-wide' }, i.paidPaise === null ? '–' : [el('span', { text: AC.money(i.paidPaise) }),
        i.duePaise ? el('div', { class: 'cell-sub', text: 'of ' + AC.money(i.duePaise) }) : null])
    ]);
  }

  AC.listPage({
    endpoint: '/api/console/institutes', noun: ['institute', 'institutes'],
    empty: 'No institutes yet. Create one when a coaching centre buys seats.',
    row: row, onData: function (d) { packages = d.packages; today = d.today; }
  });

  var btn = doc.getElementById('newInstituteBtn');
  if (btn) btn.addEventListener('click', function () {
    if (!today) return AC.toast('Wait a moment for the list to load.', 'bad');
    if (!packages.length) return AC.toast('Create a paid package first: a seat gives one.', 'bad');
    AC.institutes.create(packages, today).then(function (made) {
      if (made && made.id) location.href = AC.base + '/institutes/' + encodeURIComponent(made.id);
    });
  });
})();
