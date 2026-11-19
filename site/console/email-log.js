/* The email log: every email TypeCraft has sent.
   GET  /api/console/emails?q=&status=&kind=&page=
     → { items: [{ id, to, template, kind, subject, status, attempts, lastError, nextAttemptAt, sentAt, createdAt, retryable }],
         page, pageSize, pages, total, last24h: { status: n }, kinds: { template: label }, emailOn, can: { retry } }
   POST /api/console/emails/:id/retry → { email, result, message } */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var counts = document.getElementById('dayCounts');
  var kindPick = document.querySelector('#filters select[name="kind"]');
  var view;

  var WHY = { not_configured: 'Email is not set up', rate_limited: 'Too many emails at once; tried again later', rate_limited_recipient: 'Too many to this address in an hour',
    network_error: 'Could not reach Resend', render_failed: 'The email could not be made', abandoned: 'Cut off while sending', internal_error: 'Something went wrong on our side',
    bounced: 'The address did not accept it', complained: 'Marked as spam by the person' };
  function why(e) {
    if (!e.lastError) return null;
    var m = /^http_(\d+)$/.exec(e.lastError);
    return m ? 'Resend said no (' + m[1] + ')' : (WHY[e.lastError] || e.lastError);
  }

  function retry(e, button) {
    AC.busy(button, true);
    AC.api('POST', '/api/console/emails/' + encodeURIComponent(e.id) + '/retry').then(function (res) {
      AC.toast(res.message, res.result === 'sent' ? 'ok' : 'bad');
      view.reload();
    }, function (err) { AC.busy(button, false); if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
  }

  function row(e) {
    var reason = why(e);
    var button = e.retryable ? el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Send again' }) : null;
    if (button) button.addEventListener('click', function () { retry(e, button); });
    return el('tr', null, [
      el('td', null, [
        el('div', { class: 'cell-main', text: e.to }),
        el('div', { class: 'person-extra' }, [AC.status('email', e.status), el('span', { text: e.kind }), el('span', { text: AC.fmt.ago(e.createdAt) })])
      ]),
      el('td', { class: 'col-wide' }, [el('div', { class: 'measure', text: e.subject || e.kind }), el('div', { class: 'cell-sub', text: e.kind })]),
      el('td', { class: 'col-fit' }, [AC.status('email', e.status), reason && ['failed', 'bounced', 'cancelled'].indexOf(e.status) !== -1 ? el('div', { class: 'cell-sub', text: reason }) : null,
        e.status === 'failed' && e.nextAttemptAt ? el('div', { class: 'cell-sub', text: 'Tries again ' + AC.fmt.until(e.nextAttemptAt) }) : null]),
      el('td', { class: 'col-fit', text: String(e.attempts) }),
      el('td', { class: 'col-wide nowrap', title: AC.fmt.dateTime(e.createdAt), text: AC.fmt.ago(e.createdAt) }),
      el('td', { class: 'col-fit' }, button)
    ]);
  }

  view = AC.listPage({
    endpoint: '/api/console/emails',
    noun: ['email', 'emails'],
    empty: 'No emails yet.',
    row: row,
    onData: function (d) {
      AC.options(kindPick, Object.keys(d.kinds).map(function (k) { return { id: k, name: d.kinds[k] }; }));
      AC.clear(counts);
      counts.appendChild(el('span', { class: 'muted', text: 'Last 24 hours:' }));
      ['sent', 'delivered', 'queued', 'failed', 'bounced'].forEach(function (s) {
        counts.appendChild(el('span', { class: 'seg-count' }, [AC.status('email', s), el('b', { text: (d.last24h[s] || 0).toLocaleString('en-IN') })]));
      });
      if (!d.emailOn) counts.appendChild(AC.badge('Email is not set up', 'bad'));
    }
  });
})();
