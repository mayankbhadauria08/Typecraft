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

  /* Seats sold online (docs/INSTITUTES.md §15): GET /api/console/institutes/pricing → { on, set, packageId, packageName, minSeats,
     terms: [{ months, pricePerSeatPaise }], razorpay, paymentsOn, allTerms, maxPaise, renewWindowDays, packages, updatedAt };
     PUT (institutes.payments) { on, packageId, minSeats, prices: { 6, 12 } } in paise per seat. */
  function prices() {
    var box = doc.getElementById('priceBody'), act = doc.getElementById('priceAct');
    if (!box) return;
    AC.api('GET', '/api/console/institutes/pricing').then(function (p) {
      var price = function (m) { var t = p.terms.filter(function (x) { return x.months === m; })[0]; return t ? AC.money(t.pricePerSeatPaise) + ' a seat for ' + m + ' months' : null; };
      var list = p.allTerms.map(price).filter(Boolean);
      AC.clear(box);
      var state = !p.on ? (p.set ? 'Off. Coaching centres can’t buy seats on the site; you set institutes up here.' : 'Off, and no prices are set yet.')
        : !p.razorpay ? 'On, but Razorpay isn’t connected, so nobody can pay yet.'
          : !p.paymentsOn ? 'On, but payments are paused in Settings, so nobody can pay now.'
            : 'On: coaching centres can buy seats at /institute/buy, and admins can add seats or renew from their institute page.';
      box.appendChild(AC.el('div', null, [
        AC.el('p', null, [AC.el('strong', { text: state })]),
        p.set ? AC.el('p', { class: 'cell-sub', text: p.packageName + ' plan. ' + list.join(', ') + '. At least ' + p.minSeats + ' seats. Added seats are priced by the day at the ' +
          p.terms[p.terms.length - 1].months + '-month rate; renewing opens ' + p.renewWindowDays + ' days before the last day. One payment goes up to ' + AC.money(p.maxPaise) + '.' }) : null,
        AC.el('p', { class: 'cell-sub', text: 'Seats switch on only when Razorpay confirms a payment to the server. Use Razorpay test keys until you have tried it end to end.' })
      ]));
      AC.clear(act);
      if (AC.can('institutes.payments')) act.appendChild(AC.el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Change', on: { click: function () { change(p); } } }));
    }, function (err) { AC.clear(box); box.appendChild(AC.quiet('Couldn’t load the online prices. ' + err.message)); });
  }
  function change(p) {
    var rupees = function (m) { var t = p.terms.filter(function (x) { return x.months === m; })[0]; return t ? String(t.pricePerSeatPaise / 100) : ''; };
    var onSale = p.packages.filter(function (k) { return k.active; });
    var choices = onSale.concat(p.packages.filter(function (k) { return !k.active; })).map(function (k) { return { value: k.id, label: k.name + (k.active ? '' : ' (off sale)') }; });
    var fields = [
      { name: 'on', label: 'Sell seats on the site', type: 'radio', value: p.on ? 'yes' : 'no', options: [{ value: 'yes', label: 'On' }, { value: 'no', label: 'Off' }] },
      { name: 'packageId', label: 'Plan a seat gives', type: 'select', options: choices, value: p.packageId || (onSale.length ? onSale[onSale.length - 1].id : (choices[0] || {}).value) },
      { name: 'minSeats', label: 'Fewest seats an institute can buy', type: 'number', min: 1, max: 1000, required: true, value: p.minSeats }
    ].concat(p.allTerms.map(function (m) {
      return { name: 'price' + m, label: 'Price per seat for ' + m + ' months (₹)', type: 'number', min: 1, step: '0.01', inputmode: 'decimal', value: rupees(m), hint: 'Leave empty to not sell this term.' };
    }));
    return AC.formDialog({
      title: 'Seats sold online', submitLabel: 'Save',
      text: 'Institutes already set up keep their own price. Online top-ups and renewals are offered only to institutes on this plan.',
      fields: fields,
      submit: function (v) {
        var byTerm = {};
        p.allTerms.forEach(function (m) { var x = v['price' + m]; if (x !== '' && x != null) byTerm[m] = Math.round(Number(x) * 100); });
        return AC.api('PUT', '/api/console/institutes/pricing', { on: v.on === 'yes', packageId: v.packageId, minSeats: Number(v.minSeats), prices: byTerm })
          .then(function () { AC.toast('Saved.'); return true; });
      }
    }).then(function (changed) { if (changed) window.setTimeout(prices, 0); });
  }
  prices();

  var btn = doc.getElementById('newInstituteBtn');
  if (btn) btn.addEventListener('click', function () {
    if (!today) return AC.toast('Wait a moment for the list to load.', 'bad');
    if (!packages.length) return AC.toast('Create a paid package first: a seat gives one.', 'bad');
    AC.institutes.create(packages, today).then(function (made) {
      if (made && made.id) location.href = AC.base + '/institutes/' + encodeURIComponent(made.id);
    });
  });
})();
