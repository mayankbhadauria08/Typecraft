/* Email campaigns: the list, the daily limit, and "New campaign".
   GET /api/console/campaigns?q=&status=&page=
     → { items: [{ id, name, subject, audience, audienceLabel, status, sendAt, total, startedAt, finishedAt, updatedAt, progress: { waiting, sent, failed, skipped, cancelled } }],
         page, pageSize, pages, total, limit: { dailyCap, usedToday }, emailOn, plans, inactiveDays, can: { write, send, limit } } */
(function () {
  'use strict';
  var AC = window.AC, CK = window.CK, el = AC.el;
  var bar = document.getElementById('limitBar');
  var last = null;

  var ago = function (iso) { var t = AC.fmt.ago(iso); return t === 'Just now' ? 'just now' : t; };
  function when(c) {
    if (c.status === 'draft') return ['Edited ' + ago(c.updatedAt), c.updatedAt];
    if (c.status === 'scheduled') return [(Date.parse(c.sendAt) <= Date.now() ? 'Starting' : 'Starts ' + AC.fmt.dateTime(c.sendAt)), c.sendAt];
    if (c.status === 'sending') return ['Started ' + ago(c.startedAt), c.startedAt];
    return [(c.status === 'sent' ? 'Finished ' : 'Stopped ') + ago(c.finishedAt), c.finishedAt];
  }
  function row(c) {
    var w = when(c), open = AC.base + '/campaigns/' + encodeURIComponent(c.id);
    var started = ['sending', 'sent', 'cancelled'].indexOf(c.status) !== -1 && c.total;
    return el('tr', null, [
      el('td', null, [
        el('a', { class: 'cell-link', href: open, text: c.name }),
        el('div', { class: 'cell-sub measure', text: c.subject }),
        el('div', { class: 'person-extra' }, [AC.status('campaign', c.status), el('span', { text: c.audienceLabel })])
      ]),
      el('td', { class: 'col-wide', text: c.audienceLabel }),
      el('td', { class: 'col-fit' }, AC.status('campaign', c.status)),
      el('td', { class: 'col-wide' }, started ? [
        el('div', { text: CK.progressText(c.progress, c.total) }),
        el('div', { class: 'cell-sub', text: c.progress.sent.toLocaleString('en-IN') + ' sent' + (c.progress.failed ? ', ' + c.progress.failed + ' failed' : '') + (c.progress.skipped ? ', ' + c.progress.skipped + ' skipped' : '') })
      ] : el('span', { class: 'muted', text: '–' })),
      el('td', { class: 'col-wide', title: w[1] ? AC.fmt.dateTime(w[1]) : null, text: w[0] })
    ]);
  }

  function paintLimit(d) {
    AC.clear(bar);
    var used = d.limit.usedToday, cap = d.limit.dailyCap;
    var kids = [
      AC.icon('mail'),
      el('span', null, [el('b', { text: cap.toLocaleString('en-IN') }), ' campaign emails a day at most. ',
        el('span', { class: 'muted', text: used.toLocaleString('en-IN') + ' sent in the last 24 hours.' })])
    ];
    if (!d.emailOn) kids.push(AC.badge('Email is not set up: nothing is sent', 'bad'));
    if (d.can.limit) kids.push(el('button', { type: 'button', class: 'btn-link', text: 'Change the limit', on: { click: function () { changeLimit(cap); } } }));
    bar.appendChild(el('div', { class: 'limit-inner' }, kids));
  }
  function changeLimit(cap) {
    AC.formDialog({
      title: 'Daily limit for campaigns',
      text: 'Resend’s free plan sends 100 emails a day in all, and sign-in codes, receipts and replies count too. Keep this lower than your plan’s daily allowance so those always go through.',
      submitLabel: 'Save',
      fields: [{ name: 'dailyCap', label: 'Campaign emails a day', type: 'number', value: cap, min: 1, max: 5000, required: true }],
      submit: function (v) { return AC.api('PUT', '/api/console/campaigns/limit', { dailyCap: Number(v.dailyCap) }); }
    }).then(function (res) { if (res) { AC.toast(res.message); view.reload(); } });
  }

  var view = AC.listPage({
    endpoint: '/api/console/campaigns',
    noun: ['campaign', 'campaigns'],
    empty: 'No campaigns yet. Write one with New campaign.',
    row: row,
    onData: function (d) { last = d; paintLimit(d); }
  });

  var add = document.getElementById('newCampaign');
  if (add) add.addEventListener('click', function () {
    CK.edit({ plans: last ? last.plans : [], inactiveDays: last ? last.inactiveDays : null }).then(function (id) {
      if (id) location.assign(AC.base + '/campaigns/' + encodeURIComponent(id));
    });
  });
})();
