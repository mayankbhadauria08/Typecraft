/* Dashboard.
   GET /api/console/dashboard?range=today|7d|30d
     → { range, from, to, previous: { from, to }, customers: { total, new: { now, before }, learners: { now, before } },
         plans: { paying, endingIn7Days, byPackage: [{ id, name, customers }] },
         payments: { paid: { now, before }, failed: { now, before }, waiting },
         money: { gross, refunds, net: { now, before }, currency } | null (without revenue.view),
         attention: [{ count, text, href }], chart: [{ day, signups, paid, netPaise | null }], at }
   The period is kept in the address (?range=), so a reload shows the same. No automatic refresh: the Refresh button asks again. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var dash = byId('dash');
  var range = new URLSearchParams(location.search).get('range');
  if (['today', '7d', '30d'].indexOf(range) === -1) range = '7d';
  var BEFORE = { today: 'yesterday', '7d': 'the 7 days before', '30d': 'the 30 days before' };
  var seq = 0;
  var dayLong = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  var count = function (n) { return Number(n || 0).toLocaleString('en-IN'); };
  var rupees = function (paise) { return AC.money(paise, 'INR'); };

  /* ---------- figures ---------- */
  /** "Up 12 on the 7 days before", coloured by whether up is good here; arrows and words carry it, not colour alone. */
  function delta(pair, upIsGood, fmt) {
    var d = pair.now - pair.before;
    if (!d) return el('div', { class: 'tile-delta' }, 'Same as ' + BEFORE[range]);
    var up = d > 0;
    return el('div', { class: 'tile-delta ' + (up === upIsGood ? 'is-good' : 'is-bad') }, [
      el('span', { 'aria-hidden': 'true', text: up ? '▲ ' : '▼ ' }), (up ? 'Up ' : 'Down ') + fmt(Math.abs(d)) + ' on ' + BEFORE[range]
    ]);
  }
  function tile(label, value, extra, href) {
    return el('div', { class: 'tile' }, [
      href ? el('a', { class: 'tile-label', href: href, text: label }) : el('div', { class: 'tile-label', text: label }),
      el('div', { class: 'tile-value', text: value }),
      extra || null
    ]);
  }
  function fill(id, kids) { var node = AC.clear(byId(id)); kids.forEach(function (k) { if (k) node.appendChild(k); }); }
  function when(d) { return '&from=' + d.from + '&to=' + d.to; }

  function render(d) {
    var c = d.customers, pl = d.plans, pay = d.payments, m = d.money;
    // needs attention
    var att = AC.clear(byId('attentionBody'));
    att.appendChild(d.attention.length ? el('ul', { class: 'attention' }, d.attention.map(function (a) {
      return el('li', null, [AC.icon('alert'), el('a', { href: a.href },
        [el('strong', { text: count(a.count) }), ' ' + a.text])]);
    })) : el('p', { class: 'all-clear' }, [AC.icon('check'), 'Nothing needs attention.']));

    fill('customerTiles', [
      tile('New customers', count(c.new.now), delta(c.new, true, count), AC.can('customers.view') ? AC.base + '/customers?joined=' + (range === 'today' ? 'today' : range) : null),
      tile('Learners who practised', count(c.learners.now), delta(c.learners, true, count)),
      tile('All customers', count(c.total), el('div', { class: 'tile-sub', text: 'Everyone with an account' })),
      tile('Paying customers', count(pl.paying), el('div', { class: 'tile-sub' }, pl.endingIn7Days && AC.can('subscriptions.view')
        ? el('a', { href: AC.base + '/subscriptions?state=ending', text: count(pl.endingIn7Days) + (pl.endingIn7Days === 1 ? ' plan ends' : ' plans end') + ' in the next 7 days' })
        : (pl.endingIn7Days ? count(pl.endingIn7Days) + ' plans end in the next 7 days' : 'No plan ends in the next 7 days')))
    ]);
    var payLink = AC.can('payments.view') ? function (status) { return AC.base + '/payments?status=' + status + when(d); } : function () { return null; };
    var payTiles = [
      tile('Payments made', count(pay.paid.now), delta(pay.paid, true, count), payLink('paid')),
      tile('Failed payments', count(pay.failed.now), delta(pay.failed, false, count), payLink('failed')),
      tile('Not paid yet', count(pay.waiting), el('div', { class: 'tile-sub', text: 'Started in this period, not finished' }), payLink('pending'))
    ];
    fill('paymentTiles', payTiles);
    if (m && byId('moneyTiles')) fill('moneyTiles', [
      tile('Money in', rupees(m.gross.now), delta(m.gross, true, rupees)),
      tile('Refunds', rupees(m.refunds.now), delta(m.refunds, false, rupees), AC.can('refunds.view') ? AC.base + '/refunds?status=processed' + when(d) : null),
      tile('After refunds', rupees(m.net.now), delta(m.net, true, rupees))
    ]);

    byId('plansMeta').textContent = count(pl.paying) + (pl.paying === 1 ? ' paying customer' : ' paying customers');
    AC.charts.bars(byId('plansBody'), {
      rows: pl.byPackage.map(function (p) { return { label: p.name, value: p.customers, href: AC.can('subscriptions.view') ? AC.base + '/subscriptions?state=active&package=' + encodeURIComponent(p.id) : null }; }),
      format: count, empty: 'There are no paid packages.'
    });

    var points = function (pick) { return d.chart.map(function (x) { return { key: x.day, label: AC.fmt.day(x.day), long: dayLong.format(new Date(x.day + 'T12:00:00+05:30')), value: pick(x) }; }); };
    var signups = d.chart.reduce(function (s, x) { return s + x.signups; }, 0), n = d.chart.length;
    AC.charts.columns(byId('signupsChart'), { label: 'Sign-ups', points: points(function (x) { return x.signups; }), format: count,
      summary: count(signups) + (signups === 1 ? ' sign-up' : ' sign-ups') + ' in the last ' + n + ' days.' });
    if (m) {
      var net = d.chart.reduce(function (s, x) { return s + x.netPaise; }, 0);
      AC.charts.columns(byId('moneyChart'), { label: 'Money in after refunds', points: points(function (x) { return x.netPaise; }), format: rupees,
        summary: rupees(net) + ' after refunds in the last ' + n + ' days.' });
    } else {
      var paid = d.chart.reduce(function (s, x) { return s + x.paid; }, 0);
      AC.charts.columns(byId('moneyChart'), { label: 'Payments made', points: points(function (x) { return x.paid; }), format: count,
        summary: count(paid) + (paid === 1 ? ' payment' : ' payments') + ' in the last ' + n + ' days.' });
    }
    byId('dashUpdated').textContent = 'Updated ' + AC.fmt.time(d.at) + (range === 'today' ? '' : ', ' + AC.fmt.day(d.from) + ' to ' + AC.fmt.day(d.to));
  }

  /* ---------- loading: the last figures stay on screen, dimmed, until the new ones arrive ---------- */
  function load() {
    var mine = ++seq, button = byId('refreshBtn');
    dash.setAttribute('aria-busy', 'true'); AC.busy(button, true);
    AC.api('GET', '/api/console/dashboard?range=' + range).then(function (d) {
      if (mine !== seq) return;
      render(d);
      dash.classList.add('is-loaded'); dash.removeAttribute('aria-busy'); AC.busy(button, false);
    }, function (err) {
      if (mine !== seq) return;
      dash.removeAttribute('aria-busy'); AC.busy(button, false);
      AC.toast("Couldn't load the dashboard. " + err.message, 'bad');
      byId('dashUpdated').textContent = "Couldn't load the latest figures.";
    });
  }
  function pick(next) {
    range = next;
    Array.prototype.forEach.call(byId('rangePick').querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-range') === range ? 'true' : 'false'); });
    history.replaceState(null, '', location.pathname + (range === '7d' ? '' : '?range=' + range));
    load();
  }
  byId('rangePick').addEventListener('click', function (e) { var b = e.target.closest('button[data-range]'); if (b && b.getAttribute('data-range') !== range) pick(b.getAttribute('data-range')); });
  byId('refreshBtn').addEventListener('click', load);
  pick(range);
})();
