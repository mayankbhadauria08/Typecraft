/* Business reports.
   GET /api/console/reports?range=7d|30d|90d|12m
     → { range, by: day | week | month, from, to, previous: { from, to },
         totals: { gross, refunds, net, orders, signups: { now, before }, avgOrder, buyers, firstTime, converted },
         series: [{ key, from, to, gross, refunds, net, orders, signups }], byPlan: [{ id, name, orders, gross, refunds, net }],
         refundReasons: [{ reason, count, amount }], customers: { total, payingNow, everPaid },
         renewals: { next7, next30, lapsed, upcoming: [{ customerId, name, email, plan, expiresAt }] }, currency, at }
   GET /api/console/reports/export?range=&kind=days|plans → CSV
   The period is kept in the address (?range=). */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var dash = byId('dash');
  var range = new URLSearchParams(location.search).get('range');
  if (['7d', '30d', '90d', '12m'].indexOf(range) === -1) range = '30d';
  var BEFORE = { '7d': 'the 7 days before', '30d': 'the 30 days before', '90d': 'the 90 days before', '12m': 'the 12 months before' };
  var seq = 0;
  var count = function (n) { return Number(n || 0).toLocaleString('en-IN'); };
  var rupees = function (p) { return AC.money(p, 'INR'); };
  var pct = function (part, whole) { return whole ? Math.round((100 * part) / whole) + '%' : '–'; };
  var monthName = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

  function delta(pair, fmt, upIsGood) {
    var d = pair.now - pair.before;
    if (!d) return el('div', { class: 'tile-delta' }, 'Same as ' + BEFORE[range]);
    var up = d > 0, good = upIsGood === false ? !up : up;
    return el('div', { class: 'tile-delta ' + (good ? 'is-good' : 'is-bad') }, [
      el('span', { 'aria-hidden': 'true', text: up ? '▲ ' : '▼ ' }), (up ? 'Up ' : 'Down ') + fmt(Math.abs(d)) + ' on ' + BEFORE[range]
    ]);
  }
  function tile(label, value, extra) {
    return el('div', { class: 'tile' }, [el('div', { class: 'tile-label', text: label }), el('div', { class: 'tile-value', text: value }), extra || null]);
  }
  function put(id, node) { AC.clear(byId(id)).appendChild(node); }
  function fillTiles(id, nodes) { var box = AC.clear(byId(id)); nodes.forEach(function (n) { box.appendChild(n); }); }
  function label(b, by) {
    if (by === 'day') return AC.fmt.day(b.key);
    if (by === 'month') return monthName.format(new Date(b.key + '-15T12:00:00+05:30'));
    return AC.fmt.day(b.from);
  }
  function longLabel(b, by) {
    if (by === 'day') return AC.fmt.date(b.key + 'T12:00:00+05:30');
    if (by === 'month') return monthName.format(new Date(b.key + '-15T12:00:00+05:30'));
    return AC.fmt.day(b.from) + ' to ' + AC.fmt.day(b.to);
  }

  function render(d) {
    var t = d.totals;
    fillTiles('moneyTiles', [
      tile('Net sales', rupees(t.net.now), delta(t.net, rupees)),
      tile('Sales', rupees(t.gross.now), el('div', { class: 'tile-delta', text: count(t.orders.now) + (t.orders.now === 1 ? ' order' : ' orders') + ', ' + rupees(t.avgOrder) + ' on average' })),
      tile('Refunds', rupees(t.refunds.now), delta(t.refunds, rupees, false)),
      tile('Buyers', count(t.buyers), el('div', { class: 'tile-delta', text: count(t.firstTime) + ' buying for the first time' }))
    ]);
    byId('netMeta').textContent = { day: 'Per day', week: 'Per week, from Monday', month: 'Per month' }[d.by] + ', after refunds';
    AC.charts.columns(byId('netChart'), {
      label: 'Net sales', format: rupees,
      points: d.series.map(function (b) { return { key: b.key, label: label(b, d.by), value: b.net,
        long: longLabel(b, d.by) + ': ' + count(b.orders) + (b.orders === 1 ? ' order, ' : ' orders, ') + rupees(b.gross) + ' sales, ' + rupees(b.refunds) + ' refunded' }; }),
      summary: t.orders.now ? rupees(t.net.now) + ' net from ' + count(t.orders.now) + ' orders.' : 'No sales in this period.'
    });
    put('plansBody', d.byPlan.length ? AC.table([['Plan'], ['Orders', 'num'], ['Sales', 'num col-wide'], ['Refunds', 'num col-wide'], ['Net', 'num']], d.byPlan.map(function (p) {
      return el('tr', null, [
        el('td', null, [el('span', { class: 'cell-main', text: p.name }), el('div', { class: 'person-extra' }, [el('span', { text: rupees(p.gross) + ' sales' })])]),
        el('td', { class: 'num', text: count(p.orders) }),
        el('td', { class: 'num col-wide', text: rupees(p.gross) }),
        el('td', { class: 'num col-wide', text: p.refunds ? rupees(p.refunds) : '–' }),
        el('td', { class: 'num', text: rupees(p.net) })
      ]);
    })) : AC.quiet('No plan was sold in this period.'));
    put('reasonsBody', d.refundReasons.length ? AC.table([['Reason'], ['Refunds', 'num'], ['Amount', 'num']], d.refundReasons.map(function (r) {
      return el('tr', null, [el('td', { text: r.reason }), el('td', { class: 'num', text: count(r.count) }), el('td', { class: 'num', text: rupees(r.amount) })]);
    })) : AC.quiet('No money went back in this period.'));

    var c = d.customers;
    fillTiles('peopleTiles', [
      tile('Sign-ups', count(t.signups.now), delta(t.signups, count)),
      tile('Of them, bought a plan', count(t.converted), el('div', { class: 'tile-delta', text: pct(t.converted, t.signups.now) + ' of the people who signed up in this period' })),
      tile('Paying now', count(c.payingNow), el('div', { class: 'tile-delta', text: pct(c.payingNow, c.total) + ' of ' + count(c.total) + ' customers' })),
      tile('Ever paid', count(c.everPaid), el('div', { class: 'tile-delta', text: pct(c.everPaid, c.total) + ' of all customers' }))
    ]);
    AC.charts.columns(byId('signupChart'), {
      label: 'Sign-ups', format: count,
      points: d.series.map(function (b) { return { key: b.key, label: label(b, d.by), value: b.signups, long: longLabel(b, d.by) + ': ' + count(b.signups) + ' sign-ups' }; }),
      summary: t.signups.now ? count(t.signups.now) + ' people signed up.' : 'No one signed up in this period.'
    });
    var r = d.renewals;
    byId('renewalsMeta').textContent = count(r.next7) + ' in the next 7 days, ' + count(r.next30) + ' in 30 days. ' + count(r.lapsed) + ' ended in this period without a new plan.';
    var link = AC.can('customers.view');
    put('renewalsBody', r.upcoming.length ? AC.table([['Customer'], ['Plan', 'col-wide'], ['Ends']], r.upcoming.map(function (u) {
      return el('tr', null, [
        el('td', null, [link ? el('a', { class: 'cell-link', href: AC.base + '/customers/' + encodeURIComponent(u.customerId), text: u.name || u.email }) : el('span', { class: 'cell-main', text: u.name || u.email }),
          el('div', { class: 'cell-sub', text: u.email })]),
        el('td', { class: 'col-wide', text: u.plan }),
        el('td', { class: 'nowrap', title: AC.fmt.dateTime(u.expiresAt), text: AC.fmt.until(u.expiresAt) })
      ]);
    })) : AC.quiet('No bought plan ends in the next 30 days.'));
    byId('dashUpdated').textContent = 'Updated ' + AC.fmt.time(d.at) + ', ' + AC.fmt.day(d.from) + ' to ' + AC.fmt.day(d.to);
  }

  function load() {
    var mine = ++seq, button = byId('refreshBtn');
    dash.setAttribute('aria-busy', 'true'); AC.busy(button, true);
    AC.api('GET', '/api/console/reports?range=' + range).then(function (d) {
      if (mine !== seq) return;
      render(d);
      dash.classList.add('is-loaded'); dash.removeAttribute('aria-busy'); AC.busy(button, false);
    }, function (err) {
      if (mine !== seq) return;
      dash.removeAttribute('aria-busy'); AC.busy(button, false);
      AC.toast("Couldn't load the reports. " + err.message, 'bad');
      byId('dashUpdated').textContent = "Couldn't load the latest figures.";
    });
  }
  function pick(next) {
    range = next;
    Array.prototype.forEach.call(byId('rangePick').querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-range') === range ? 'true' : 'false'); });
    history.replaceState(null, '', location.pathname + (range === '30d' ? '' : '?range=' + range));
    load();
  }
  function exporter(kind, id) {
    var b = byId(id);
    b.addEventListener('click', function () {
      AC.download('/api/console/reports/export?range=' + range + '&kind=' + kind, b).then(function (name) { AC.toast('Saved ' + name + '.'); },
        function (err) { if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
    });
  }
  exporter('days', 'exportDays'); exporter('plans', 'exportPlans');
  byId('rangePick').addEventListener('click', function (e) { var b = e.target.closest('button[data-range]'); if (b && b.getAttribute('data-range') !== range) pick(b.getAttribute('data-range')); });
  byId('refreshBtn').addEventListener('click', load);
  pick(range);
})();
