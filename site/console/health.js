/* System health: background jobs, email, payments, the database and its updates, the plan's limits.
   GET /api/console/health → { at, warnings: [{ level: 'bad' | 'warn', text, where }],
     jobs: { ready, schedules: [{ schedule, label, everyMin, last: run | null, lastOkAt, runs24h, problems24h, late }], problems: [run], recent: [run] },
       run = { id, label, startedAt, finishedAt, state: 'ok' | 'failed' | 'cut_off' | 'running', ms, parts, failed: [{ part, error }] }
     email: { configured, webhook, sent24h, sent30d, dayLimit, monthLimit, waiting, failed24h, bounced7d, lastSentAt, lastDeliveredAt },
     payments: { configured, mode, webhook, waiting, oldestWaiting, lastPaidAt, lastWebhookAt, webhookFailed7d },
     database: { size, limit, restoreDays }, migrations: [{ id, file, title, applied, partly, missing }] | null,
     plan: { paid, label, restoreDays, databaseLimit, perRun: [[label, n]], limits: [[label, text]] }, learning: { … } | null } */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var byId = function (id) { return document.getElementById(id); };
  var STATE = { ok: ['Finished', 'ok'], failed: ['Had a problem', 'bad'], cut_off: ['Stopped before finishing', 'bad'], running: ['Running', ''] };
  var n = function (v) { return Number(v || 0).toLocaleString('en-IN'); };

  function when(iso) { return iso ? el('span', { title: AC.fmt.dateTime(iso), text: AC.fmt.ago(iso) }) : 'Never'; }
  function size(bytes) {
    if (bytes == null) return '–';
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }
  function meter(share, label) {
    return el('div', { class: 'cap-meter' + (share >= 0.8 ? ' cap-warn' : ''), role: 'img', 'aria-label': label },
      el('span', { class: 'cap-fill cap-w' + Math.max(0, Math.min(10, Math.round(share * 10))) }));
  }

  /* ---------- warnings ---------- */
  function warnings(list) {
    var box = AC.clear(byId('healthWarnings'));
    if (!list.length) { box.appendChild(el('p', { class: 'all-clear health-clear' }, [AC.icon('check'), 'Everything looks fine.'])); return; }
    box.appendChild(el('ul', { class: 'health-warnings' }, list.map(function (w) {
      return el('li', { class: 'alert ' + (w.level === 'bad' ? 'alert-bad' : 'alert-warn') }, [AC.icon('alert'), el('span', { text: w.text })]);
    })));
  }

  /* ---------- jobs ---------- */
  function failedText(run) {
    return run.failed.map(function (f) { return f.part + ': ' + f.error; }).join(' · ');
  }
  function jobs(j) {
    var tiles = AC.clear(byId('jobTiles'));
    var body = AC.clear(byId('jobsBody'));
    if (!j.ready) {
      tiles.hidden = true;
      body.appendChild(AC.notice('Runs aren’t recorded yet: database update 0017 hasn’t been applied. The jobs themselves run as before.', 'warn'));
      return;
    }
    j.schedules.forEach(function (s) {
      var st = s.last ? STATE[s.last.state] : null;
      tiles.appendChild(el('div', { class: 'tile' }, [
        el('div', { class: 'tile-label', text: s.label }),
        el('div', { class: 'tile-value tile-value-sm' }, s.last ? [AC.badge(st[0], st[1])] : [AC.badge('No run recorded yet', '')]),
        el('div', { class: 'tile-sub' }, s.last ? ['Last run ', when(s.last.startedAt), s.last.ms != null ? ', took ' + (s.last.ms < 1000 ? s.last.ms + ' ms' : (s.last.ms / 1000).toFixed(1) + ' s') : ''] : [s.everyMin >= 1440 ? 'The first run is recorded after 02:47 India time.' : 'The first run is recorded within 10 minutes.']),
        s.last ? el('div', { class: 'tile-sub', text: n(s.runs24h) + (s.runs24h === 1 ? ' run' : ' runs') + ' in the last 24 hours' + (s.problems24h ? ', ' + n(s.problems24h) + ' with a problem' : ', all fine') }) : null,
        s.last && s.last.failed.length ? el('div', { class: 'tile-delta is-bad', text: failedText(s.last) }) : null
      ]));
    });
    byId('jobsMeta').textContent = '';
    body.appendChild(el('h3', { class: 'sub-head', text: 'Problems in the last 7 days' }));
    body.appendChild(j.problems.length ? AC.table([['When'], ['Job', 'col-wide'], ['What happened']], j.problems.map(function (r) {
      return el('tr', null, [el('td', { class: 'nowrap', text: AC.fmt.dateTime(r.startedAt) }), el('td', { class: 'col-wide', text: r.label }),
        el('td', { class: 'cell-wrap', text: r.state === 'cut_off' ? 'Stopped before finishing (a limit was reached, or the Worker crashed).' : failedText(r) })]);
    })) : el('p', { class: 'all-clear' }, [AC.icon('check'), 'None.']));
    body.appendChild(el('h3', { class: 'sub-head', text: 'Latest runs' }));
    body.appendChild(j.recent.length ? AC.table([['Started'], ['Job', 'col-wide'], ['Result', 'col-fit'], ['Took', 'col-fit']], j.recent.map(function (r) {
      var st = STATE[r.state];
      return el('tr', null, [el('td', { class: 'nowrap', text: AC.fmt.dateTime(r.startedAt) }), el('td', { class: 'col-wide', text: r.label }),
        el('td', { class: 'col-fit' }, AC.badge(st[0], st[1])), el('td', { class: 'col-fit nowrap', text: r.ms == null ? '–' : r.ms < 1000 ? r.ms + ' ms' : (r.ms / 1000).toFixed(1) + ' s' })]);
    })) : AC.quiet('No runs recorded yet.'));
  }

  /* ---------- email and payments ---------- */
  function email(e) {
    var rows = [
      AC.fact('Sending', e.configured ? (e.webhook ? 'On, with delivery reports' : 'On, without delivery reports') : AC.badge('Not set up', 'bad')),
      AC.fact('Sent in the last 24 hours', e.dayLimit ? n(e.sent24h) + ' of ' + n(e.dayLimit) : n(e.sent24h)),
      AC.fact('Sent in the last 30 days', e.monthLimit ? n(e.sent30d) + ' of ' + n(e.monthLimit) : n(e.sent30d)),
      AC.fact('Waiting to be sent', n(e.waiting)),
      AC.fact('Failed for good (24 hours)', e.failed24h ? AC.badge(n(e.failed24h), 'bad') : '0'),
      AC.fact('Bounced (7 days)', n(e.bounced7d)),
      AC.fact('Last sent', when(e.lastSentAt)),
      AC.fact('Last delivery report', e.webhook ? when(e.lastDeliveredAt) : 'Not set up')
    ];
    AC.fill('emailBody', [
      e.dayLimit ? meter(e.sent24h / e.dayLimit, n(e.sent24h) + ' of ' + n(e.dayLimit) + ' emails today') : null,
      el('dl', { class: 'facts' }, rows),
      e.dayLimit ? el('p', { class: 'hint', text: 'Resend’s free plan: ' + n(e.dayLimit) + ' emails a day and ' + n(e.monthLimit) + ' a month, sign-in codes and receipts included.' }) : null,
      AC.can('emails.view') ? el('p', null, el('a', { href: AC.base + '/email-log', text: 'Open the email log' })) : null
    ]);
  }
  function payments(p) {
    AC.fill('paymentsBody', [
      el('dl', { class: 'facts' }, [
        AC.fact('Razorpay', !p.configured ? AC.badge('Not set up', 'bad') : p.mode === 'live' ? 'Live' : 'Test mode'),
        AC.fact('Waiting more than an hour for the bank', p.waiting ? AC.badge(n(p.waiting), 'warn') : '0'),
        AC.fact('Last payment', when(p.lastPaidAt)),
        AC.fact('Last message from Razorpay', p.webhook ? when(p.lastWebhookAt) : 'Webhook not set up'),
        AC.fact('Messages that failed (7 days)', p.webhookFailed7d ? AC.badge(n(p.webhookFailed7d), 'warn') : '0')
      ]),
      el('p', { class: 'hint', text: 'A payment waits when the bank said yes but Razorpay hasn’t confirmed the money yet. Each one is checked with Razorpay every 10 minutes.' }),
      p.waiting && AC.can('payments.view') ? el('p', null, el('a', { href: AC.base + '/payments?status=pending', text: 'See the payments not paid yet' })) : null
    ]);
  }

  /* ---------- database and plan ---------- */
  function database(d) {
    var share = d.size != null ? d.size / d.limit : null;
    AC.fill('databaseBody', [
      share != null ? meter(share, Math.round(share * 100) + '% of the database limit used') : null,
      el('dl', { class: 'facts' }, [
        AC.fact('Size', d.size != null ? size(d.size) + ' of ' + size(d.limit) + (share != null ? ' (' + (share < 0.01 ? 'under 1' : Math.round(share * 100)) + '%)' : '') : 'Can’t be read here'),
        AC.fact('Restore points', 'The last ' + d.restoreDays + ' days')
      ]),
      el('p', { class: 'hint', text: 'Before applying a database update, write down a restore bookmark (docs/LAUNCH.md). Cloudflare can put the database back to any minute in the last ' + d.restoreDays + ' days.' })
    ]);
  }
  function plan(p) {
    AC.fill('planBody', [
      el('dl', { class: 'facts' }, [AC.fact('Plan', p.label)].concat(p.limits.map(function (l) { return AC.fact(l[0], l[1]); }))),
      el('h3', { class: 'sub-head', text: 'Each 10-minute run handles at most' }),
      el('dl', { class: 'facts' }, p.perRun.map(function (r) { return AC.fact(r[0], n(r[1])); })),
      p.paid ? null : el('p', { class: 'hint', text: 'Small batches keep each run inside the free plan’s 50 outside calls. When you move to Workers Paid, add the variable WORKERS_PLAN = paid in Cloudflare and the batches grow by themselves.' })
    ]);
  }
  function migrations(list) {
    if (!list) { AC.fill('migrationsBody', [AC.quiet('This database doesn’t let us list its tables, so the updates can’t be checked here.')]); return; }
    var missing = list.filter(function (m) { return !m.applied; });
    byId('migrationsMeta').textContent = missing.length ? missing.length + ' not applied' : 'All ' + list.length + ' applied';
    AC.fill('migrationsBody', [
      missing.length ? AC.notice('Apply each missing update by hand, after writing down a restore bookmark, as docs/LAUNCH.md describes. Never run “wrangler d1 migrations apply”.', 'warn') : null,
      AC.table([['Update', 'col-fit'], ['What it adds'], ['State', 'col-fit']], list.slice().reverse().map(function (m) {
        return el('tr', null, [el('td', { class: 'col-fit mono', text: m.id }),
          el('td', null, [el('span', { class: 'cell-main', text: m.title }), m.applied ? null : el('span', { class: 'cell-sub', text: (m.partly ? 'Partly applied. Missing: ' : 'Missing: ') + m.missing.join(', ') })]),
          el('td', { class: 'col-fit' }, m.applied ? AC.badge('Applied', 'ok') : AC.badge(m.partly ? 'Partly applied' : 'Not applied', 'warn'))]);
      }))
    ]);
  }
  function learning(l) {
    if (!l) { AC.fill('learningBody', [AC.quiet('Not available.')]); return; }
    var rb = l.lastRebuild;
    AC.fill('learningBody', [el('dl', { class: 'facts' }, [
      AC.fact('Learners active today', n(l.activeToday)),
      AC.fact('Practice saved today', n(l.eventsToday)),
      AC.fact('Turned away today (bad data)', n(l.rejectedToday)),
      AC.fact('Couldn’t be saved today (busy)', l.failedToday ? AC.badge(n(l.failedToday), 'warn') : '0'),
      AC.fact('Nightly totals check', rb ? [when(rb.at), rb.differences ? ' · ' + n(rb.differences) + ' totals corrected' : ' · nothing to correct'] : 'Not run yet')
    ])]);
  }

  function load() {
    var refresh = byId('refreshBtn');
    AC.busy(refresh, true);
    AC.api('GET', '/api/console/health').then(function (d) {
      AC.busy(refresh, false);
      byId('dash').removeAttribute('aria-busy');
      byId('dashUpdated').textContent = 'Updated ' + AC.fmt.time(d.at);
      warnings(d.warnings); jobs(d.jobs); email(d.email); payments(d.payments); database(d.database); plan(d.plan); migrations(d.migrations); learning(d.learning);
    }, function (err) {
      AC.busy(refresh, false);
      byId('dash').removeAttribute('aria-busy');
      var box = AC.clear(byId('healthWarnings'));
      box.appendChild(el('div', { class: 'alert alert-bad', role: 'alert' }, [AC.icon('alert'), el('span', { text: "Couldn't load System health. " + err.message })]));
    });
  }
  byId('refreshBtn').addEventListener('click', load);
  load();
})();
