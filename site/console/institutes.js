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

  /* Capacity today: GET /api/console/institutes/capacity → { lessonsToday, learnersToday, seatsInUse, databaseBytes | null,
     freeDatabaseBytes, freeLessonsADay, writesALesson, freeWritesADay } */
  function capacity() {
    var box = doc.getElementById('capBody');
    if (!box) return;
    AC.api('GET', '/api/console/institutes/capacity').then(function (c) {
      var share = c.freeLessonsADay ? c.lessonsToday / c.freeLessonsADay : 0;
      var n = function (x) { return Number(x).toLocaleString('en-IN'); };
      var meter = AC.el('div', { class: 'cap-meter' + (share >= 0.5 ? ' cap-warn' : ''), role: 'img', 'aria-label': n(c.lessonsToday) + ' of about ' + n(c.freeLessonsADay) + ' lessons a day' },
        AC.el('span', { class: 'cap-fill cap-w' + Math.min(10, Math.round(share * 10)) }));
      AC.clear(box);
      box.appendChild(AC.el('div', null, [
        AC.el('p', null, [AC.el('strong', { text: n(c.lessonsToday) + ' lessons' }), ' finished today by ' + n(c.learnersToday) + (c.learnersToday === 1 ? ' learner' : ' learners') +
          ' (since midnight, India time). ' + n(c.seatsInUse) + ' institute seats are in use.']),
        meter,
        AC.el('p', { class: 'cell-sub', text: 'An estimate: on Cloudflare\u2019s free plan the database takes ' + n(c.freeWritesADay) + ' writes a day, about ' + n(c.freeLessonsADay) +
          ' lessons (a lesson writes about ' + c.writesALesson + ' rows). Past that, saving stops for everyone until 5:30 am. Move to Workers Paid ($5 a month) before you are near it: ' +
          'Cloudflare dashboard \u203a Workers & Pages \u203a Plans.' }),
        AC.el('p', { class: 'cell-sub', text: c.databaseBytes == null ? 'Database size isn\u2019t available right now.' :
          'Database size: ' + (c.databaseBytes / 1e6).toLocaleString('en-IN', { maximumFractionDigits: 1 }) + ' MB of ' + n(c.freeDatabaseBytes / 1e9) + ' GB on the free plan.' })
      ]));
    }, function (err) { AC.clear(box); box.appendChild(AC.quiet("Couldn't load today's numbers. " + err.message)); });
  }
  capacity();

  var btn = doc.getElementById('newInstituteBtn');
  if (btn) btn.addEventListener('click', function () {
    if (!today) return AC.toast('Wait a moment for the list to load.', 'bad');
    if (!packages.length) return AC.toast('Create a paid package first: a seat gives one.', 'bad');
    AC.institutes.create(packages, today).then(function (made) {
      if (made && made.id) location.href = AC.base + '/institutes/' + encodeURIComponent(made.id);
    });
  });
})();
