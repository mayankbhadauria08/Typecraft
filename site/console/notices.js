/* Notifications: the short messages learners see on the website and in the trainer.
   GET    /api/console/notices?status=&page= → { items: [{ id, message, linkUrl, linkLabel, tone, toneLabel, audience, audienceLabel, place, placeLabel,
            startsAt, endsAt, active, state, updatedAt, updatedBy }], page, pageSize, pages, total, tones, audiences, places, can: { manage } }
   POST   /api/console/notices { message, linkUrl, linkLabel, tone, audience, place, startsAt, endsAt }
   PUT    /api/console/notices/:id  the same, or { active }      DELETE /api/console/notices/:id */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var last = null, view;
  var pairs = function (o) { return Object.keys(o || {}).map(function (k) { return { value: k, label: o[k] }; }); };

  function when(n) {
    var from = n.startsAt ? AC.fmt.dateTime(n.startsAt) : null, to = n.endsAt ? AC.fmt.dateTime(n.endsAt) : null;
    if (from && to) return from + ' to ' + to;
    if (from) return 'From ' + from;
    if (to) return 'Until ' + to;
    return 'Until turned off';
  }

  function edit(n) {
    if (!last) return;
    AC.formDialog({
      title: n ? 'Change the notification' : 'New notification',
      text: 'One line, plain words. It shows under the website’s header, at the top of the trainer, or both.',
      submitLabel: n ? 'Save' : 'Save and show',
      fields: [
        { name: 'message', label: 'Message', type: 'textarea', rows: 2, maxlength: 200, required: true, value: n ? n.message : '',
          placeholder: 'Diwali offer: 30% off every plan until Sunday.' },
        { name: 'linkLabel', label: 'Link text (optional)', maxlength: 30, value: n ? n.linkLabel : '', placeholder: 'See the plans' },
        { name: 'linkUrl', label: 'Link goes to (optional)', maxlength: 300, value: n ? n.linkUrl : '', placeholder: '/pricing',
          hint: 'A page on this site, like /pricing, or an address starting with https://.' },
        { name: 'tone', label: 'Kind', type: 'radio', value: n ? n.tone : 'info', options: [
          { value: 'info', label: 'Information', hint: 'Green: news, a new feature, a tip.' },
          { value: 'offer', label: 'Offer', hint: 'Gold: a sale or a coupon.' },
          { value: 'warning', label: 'Warning', hint: 'Red: planned downtime, a problem we are fixing.' }] },
        { name: 'audience', label: 'Shown to', type: 'select', value: n ? n.audience : 'everyone', options: pairs(last.audiences) },
        { name: 'place', label: 'Where', type: 'select', value: n ? n.place : 'both', options: pairs(last.places) },
        { name: 'startsAt', label: 'Starts (optional)', type: 'datetime', value: n ? AC.localInput(n.startsAt) : '', hint: 'Empty: straight away. Your computer’s time.' },
        { name: 'endsAt', label: 'Ends (optional)', type: 'datetime', value: n ? AC.localInput(n.endsAt) : '', hint: 'Empty: until you turn it off.' }
      ],
      submit: function (v) {
        var body = { message: v.message, linkLabel: v.linkLabel, linkUrl: v.linkUrl, tone: v.tone, audience: v.audience, place: v.place,
          startsAt: AC.fromLocalInput(v.startsAt), endsAt: AC.fromLocalInput(v.endsAt) };
        return n ? AC.api('PUT', '/api/console/notices/' + encodeURIComponent(n.id), body) : AC.api('POST', '/api/console/notices', body);
      }
    }).then(function (res) { if (res) { AC.toast(res.message); view.reload(); } });
  }

  function act(n, button, method, body, confirmOpts) {
    var go = function () {
      AC.busy(button, true);
      AC.api(method, '/api/console/notices/' + encodeURIComponent(n.id), body).then(function (res) { AC.toast(res.message); view.reload(); },
        function (err) { AC.busy(button, false); if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
    };
    if (confirmOpts) AC.confirm(confirmOpts).then(function (ok) { if (ok) go(); }); else go();
  }

  function row(n, d) {
    var tools = null;
    if (d.can.manage) {
      var change = el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Change' });
      var toggle = el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: n.active ? 'Turn off' : 'Turn on' });
      var del = el('button', { type: 'button', class: 'icon-btn icon-btn-sm', 'aria-label': 'Delete this notification' }, AC.icon('trash'));
      change.addEventListener('click', function () { edit(n); });
      toggle.addEventListener('click', function () { act(n, toggle, 'PUT', { active: !n.active }); });
      del.addEventListener('click', function () { act(n, del, 'DELETE', undefined, { title: 'Delete this notification?', text: n.active ? 'Learners stop seeing it straight away.' : 'It is off, so learners don’t see it now.', danger: true, confirmLabel: 'Delete' }); });
      tools = el('div', { class: 'row-tools' }, [change, toggle, del]);
    }
    return el('tr', null, [
      el('td', null, [
        el('div', { class: 'notice-line tone-' + n.tone }, [AC.icon(n.tone === 'warning' ? 'alert' : n.tone === 'offer' ? 'sparkle' : 'info'), el('span', { class: 'measure', text: n.message })]),
        n.linkUrl ? el('div', { class: 'cell-sub', text: (n.linkLabel || 'Find out more') + ' → ' + n.linkUrl }) : null,
        el('div', { class: 'person-extra' }, [AC.status('notice', n.state), el('span', { text: n.audienceLabel }), el('span', { text: n.placeLabel })])
      ]),
      el('td', { class: 'col-wide', text: n.audienceLabel }),
      el('td', { class: 'col-wide', text: n.placeLabel }),
      el('td', { class: 'col-wide', text: when(n) }),
      el('td', { class: 'col-fit' }, AC.status('notice', n.state)),
      el('td', { class: 'col-fit' }, tools)
    ]);
  }

  view = AC.listPage({
    endpoint: '/api/console/notices',
    noun: ['notification', 'notifications'],
    empty: 'No notifications yet. Learners see nothing extra until you add one.',
    row: row,
    onData: function (d) { last = d; }
  });
  var add = document.getElementById('newNotice');
  if (add) add.addEventListener('click', function () { edit(null); });
})();
