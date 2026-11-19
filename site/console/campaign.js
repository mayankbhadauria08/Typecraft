/* One email campaign.
   GET  /api/console/campaigns/:id → { campaign: { id, name, subject, body, audience, audienceLabel, status, sendAt, total, startedAt, finishedAt,
          createdAt, updatedAt, createdBy, updatedBy }, reach, dailyCap, days, progress: { waiting, sent, failed, skipped, cancelled },
          delivery: { delivered, bounced }, history: [{ action, actor, createdAt, note }], plans, inactiveDays, emailOn, can: { write, send } }
   PUT /:id (a draft) · DELETE /:id (a draft) · POST /:id/test · POST /:id/schedule { sendAt | null } · POST /:id/unschedule · POST /:id/cancel */
(function () {
  'use strict';
  var AC = window.AC, CK = window.CK, el = AC.el, doc = document;
  var id = location.pathname.split('/').pop();
  var path = '/api/console/campaigns/' + encodeURIComponent(id);
  var rec, timer = null;

  var LABELS = { 'campaign.create': 'Draft written', 'campaign.update': 'Draft changed', 'campaign.test': 'Test sent', 'campaign.schedule': 'Scheduled',
    'campaign.unschedule': 'Taken off the schedule', 'campaign.start': 'Sending started', 'campaign.cancel': 'Stopped', 'campaign.delete': 'Deleted' };
  var n = function (x) { return (x || 0).toLocaleString('en-IN'); };

  function button(label, iconName, cls, onClick) {
    var b = el('button', { type: 'button', class: 'btn ' + (cls || 'btn-quiet') }, [iconName ? AC.icon(iconName) : null, el('span', { text: label })]);
    b.addEventListener('click', function () { onClick(b); });
    return b;
  }
  function act(b, method, suffix, body, done) {
    AC.busy(b, true);
    return AC.api(method, path + suffix, body).then(function (res) {
      AC.busy(b, false);
      if (res.message) AC.toast(res.message);
      if (done) done(res); else rec.load();
    }, function (err) {
      AC.busy(b, false);
      if (err.code !== 'cancelled') AC.toast(err.message, 'bad');
    });
  }

  /** The email as the customer reads it: subject, greeting, the paragraphs, the sign-off. */
  function preview(c) {
    var paras = c.body.split(/\n\s*\n/).map(function (p) { return el('p', { text: p.trim() }); });
    return el('div', { class: 'mail-preview' }, [
      el('div', { class: 'mail-preview-head' }, [el('span', { class: 'muted', text: 'Subject' }), el('b', { text: c.subject })]),
      el('div', { class: 'mail-preview-body' }, [el('p', { class: 'muted', text: 'Hi [their first name],' })].concat(paras, [
        el('p', { class: 'muted', text: 'Happy typing, The TypeCraft team' }),
        el('p', { class: 'mail-preview-foot', text: 'With an "Unsubscribe from announcements" link at the bottom.' })
      ]))
    ]);
  }

  function schedule(b, d) {
    var c = d.campaign;
    AC.formDialog({
      title: 'Send “' + c.name + '”',
      text: c.audienceLabel + ': about ' + n(d.reach) + (d.reach === 1 ? ' person' : ' people') + ' now. At ' + n(d.dailyCap) +
        ' a day that takes ' + (d.days === 1 ? 'a day or less' : 'about ' + d.days + ' days') + '. Who is in it is fixed when sending starts; anyone who turns off product news before their turn is left out.',
      submitLabel: 'Confirm',
      fields: [
        { name: 'when', label: 'When', type: 'radio', value: 'now', options: [
          { value: 'now', label: 'Start now', hint: 'The first emails go within a minute, the rest every 10 minutes.' },
          { value: 'later', label: 'At a set time', hint: 'Your computer’s time. You can take it off the schedule until then.' }] },
        { name: 'sendAt', label: 'Date and time', type: 'datetime', value: '', hint: 'Only for "At a set time".' }
      ],
      submit: function (v) {
        var body = { sendAt: null };
        if (v.when === 'later') {
          body.sendAt = AC.fromLocalInput(v.sendAt);
          if (!body.sendAt) return Promise.reject({ fields: { sendAt: 'Choose a date and time.' } });
        }
        return AC.api('POST', path + '/schedule', body);
      }
    }).then(function (res) { if (res) { AC.toast(res.message); rec.load(); } });
  }

  function actions(d) {
    var c = d.campaign, out = [];
    if (d.can.write && c.status === 'draft') out.push(button('Change', 'note', 'btn-quiet', function () {
      CK.edit({ campaign: c, plans: d.plans, inactiveDays: d.inactiveDays }).then(function (saved) { if (saved) { AC.toast('Draft saved.'); rec.load(); } });
    }));
    if (d.can.write && d.emailOn && ['draft', 'scheduled'].indexOf(c.status) !== -1) out.push(button('Send a test to me', 'send', 'btn-quiet', function (b) { act(b, 'POST', '/test', {}, function () {}); }));
    if (d.can.send && c.status === 'draft') out.push(button('Schedule or send…', 'calendar', 'btn-primary', function (b) { schedule(b, d); }));
    if (d.can.send && c.status === 'scheduled') out.push(button('Take off the schedule', 'arrowLeft', 'btn-quiet', function (b) { act(b, 'POST', '/unschedule', {}); }));
    if (d.can.send && ['scheduled', 'sending'].indexOf(c.status) !== -1) out.push(button(c.status === 'sending' ? 'Stop sending' : 'Cancel it', 'x', 'btn-danger', function (b) {
      AC.confirm({ title: c.status === 'sending' ? 'Stop sending?' : 'Cancel this campaign?', danger: true, confirmLabel: c.status === 'sending' ? 'Stop sending' : 'Cancel it', cancelLabel: 'Keep it',
        text: c.status === 'sending' ? n(d.progress.waiting) + ' people who haven’t had it yet won’t get it. Emails already sent can’t be called back. This can’t be undone.'
          : 'It won’t be sent. This can’t be undone; you can copy it into a new draft.' })
        .then(function (ok) { if (ok) act(b, 'POST', '/cancel', {}); });
    }));
    if (d.can.write && ['sent', 'cancelled', 'sending', 'scheduled'].indexOf(c.status) !== -1) out.push(button('Copy into a new draft', 'copy', 'btn-quiet', function (b) {
      AC.busy(b, true);
      AC.api('POST', '/api/console/campaigns', { name: ('Copy of ' + c.name).slice(0, 80), subject: c.subject, body: c.body, audience: c.audience }).then(function (res) {
        location.assign(AC.base + '/campaigns/' + encodeURIComponent(res.id));
      }, function (err) { AC.busy(b, false); AC.toast(err.message, 'bad'); });
    }));
    if (d.can.write && c.status === 'draft') out.push(button('Delete', 'trash', 'btn-quiet', function (b) {
      AC.confirm({ title: 'Delete this draft?', text: 'It hasn’t been sent to anyone. This can’t be undone.', danger: true, confirmLabel: 'Delete' })
        .then(function (ok) { if (ok) act(b, 'DELETE', '', undefined, function () { location.assign(AC.base + '/campaigns'); }); });
    }));
    return out;
  }

  function progress(d) {
    var c = d.campaign, p = d.progress, block = doc.getElementById('progressBlock');
    var started = ['sending', 'sent', 'cancelled'].indexOf(c.status) !== -1 && c.total;
    block.hidden = !started;
    if (!started) return;
    doc.getElementById('progressMeta').textContent = CK.progressText(p, c.total);
    var pct = c.total ? Math.round(100 * (p.sent + p.failed + p.skipped) / c.total) : 0;
    var tile = function (label, value, sub) { return el('div', { class: 'tile' }, [el('div', { class: 'tile-label', text: label }), el('div', { class: 'tile-value', text: n(value) }), sub ? el('div', { class: 'tile-sub', text: sub }) : null]); };
    var left = p.waiting ? Math.ceil(p.waiting / d.dailyCap) : 0;
    AC.fill('progressBody', [
      el('progress', { class: 'meter', max: '100', value: String(pct), 'aria-label': 'Done so far: ' + pct + '%' }),
      el('div', { class: 'tiles' }, [
        tile('Sent', p.sent, d.delivery.delivered ? n(d.delivery.delivered) + ' delivered so far' : null),
        tile('Still to go', p.waiting, p.waiting && c.status === 'sending' ? (left <= 1 ? 'Today or tomorrow' : 'About ' + left + ' more days') : null),
        tile('Failed', p.failed, d.delivery.bounced ? n(d.delivery.bounced) + ' bounced' : 'Tried again on their own'),
        tile('Skipped', p.skipped + p.cancelled, p.cancelled ? n(p.cancelled) + ' after it was stopped' : 'Turned off news, or closed their account')
      ])
    ]);
  }

  function render(d) {
    var c = d.campaign;
    var ago = AC.fmt.ago(c.updatedAt);
    var subText = c.status === 'draft' ? 'Draft, last changed ' + (ago === 'Just now' ? 'just now' : ago)
      : c.status === 'scheduled' ? 'Scheduled for ' + AC.fmt.dateTime(c.sendAt)
        : c.status === 'sending' ? 'Sending since ' + AC.fmt.dateTime(c.startedAt)
          : c.status === 'sent' ? 'Sent ' + AC.fmt.dateTime(c.startedAt) + (c.finishedAt ? ' to ' + AC.fmt.dateTime(c.finishedAt) : '')
            : 'Stopped ' + AC.fmt.dateTime(c.finishedAt);
    AC.head({
      title: c.name, crumb: c.name,
      sub: [el('span', { text: subText })],
      badges: [AC.status('campaign', c.status)],
      actions: actions(d),
      note: !d.emailOn ? AC.notice("Email sending isn't set up for this site, so nothing is sent. Add the Resend key in Cloudflare first.", 'warn')
        : c.status === 'scheduled' && Date.parse(c.sendAt) <= Date.now() ? AC.notice('Its time has come: sending starts within 10 minutes.', 'quiet') : null
    });
    AC.fill('emailBody', [preview(c)]);
    progress(d);
    var reachText = ['draft', 'scheduled'].indexOf(c.status) !== -1 ? 'About ' + n(d.reach) + ' people now' : n(c.total) + ' people (fixed when sending started)';
    AC.fill('audienceBody', [AC.facts([
      AC.fact('Audience', el('span', { text: c.audienceLabel })),
      AC.fact('How many', el('span', { text: reachText })),
      AC.fact('Daily limit', el('span', { text: n(d.dailyCap) + ' campaign emails a day' + (d.reach > d.dailyCap && ['draft', 'scheduled'].indexOf(c.status) !== -1 ? ', so about ' + d.days + ' days to send' : '') }))
    ])]);
    AC.fill('aboutBody', [AC.facts([
      AC.fact('Written by', el('span', { text: (c.createdBy || 'Staff') + ', ' + AC.fmt.date(c.createdAt) })),
      AC.fact('Last changed', el('span', { text: (c.updatedBy || 'Staff') + ', ' + AC.fmt.dateTime(c.updatedAt) })),
      AC.idFact('Campaign ID', c.id, 'campaign ID')
    ])]);
    AC.fill('historyBody', [AC.timeline(d.history, LABELS, 'Nothing yet.')]);
    // while it sends, the page keeps itself up to date
    clearTimeout(timer);
    if (c.status === 'sending' || (c.status === 'scheduled' && Date.parse(c.sendAt) - Date.now() < 15 * 60000)) timer = setTimeout(function () { rec.load(); }, 30000);
  }

  rec = AC.record({ endpoint: path, notFound: ['Campaign not found', 'There is no campaign with this ID. A draft may have been deleted.'], render: render });
})();
