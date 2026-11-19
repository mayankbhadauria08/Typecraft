/* One support message.
   GET  /api/console/support/:id → { message: { id, name, email, topic, topicLabel, body, priority, status, createdAt, assignedTo },
        customer: { id, fullName, active } | null, thread: [{ id, kind: reply | note, body, author, createdAt, email }],
        history: [{ action, actor, createdAt, note }], earlier: [{ id, topic, status, createdAt }], staff: [{ id, name, role }],
        emailOn, can: { reply, manage } }
   POST /api/console/support/:id/reply { body, then }   POST /api/console/support/:id/note { body }
   PUT  /api/console/support/:id { status } | { assignedTo } */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var id = location.pathname.split('/').pop();
  var path = '/api/console/support/' + encodeURIComponent(id);
  var data = null;

  function threadItem(t) {
    var reply = t.kind === 'reply';
    return el('li', { class: reply ? 'is-reply' : 'is-note' }, [
      el('div', { class: 'thread-head' }, [
        el('b', { text: t.author }),
        el('span', { text: reply ? 'emailed a reply' : 'wrote a note' }),
        el('span', { text: '· ' + AC.fmt.dateTime(t.createdAt) }),
        reply ? AC.status('email', t.email) : AC.badge('Staff only')
      ]),
      el('p', { class: 'thread-text', text: t.body })
    ]);
  }

  function handling(d) {
    var m = d.message;
    if (!d.can.manage) {
      return AC.facts([AC.fact('Status', AC.status('support', m.status)), AC.fact('Looked after by', m.assignedTo ? m.assignedTo.name : 'Nobody yet')]);
    }
    var status = el('select', { id: 'statusPick' }, [['new', 'New'], ['answered', 'Answered'], ['closed', 'Closed']].map(function (o) {
      return el('option', { value: o[0], text: o[1], selected: o[0] === m.status });
    }));
    var owner = el('select', { id: 'ownerPick' }, [el('option', { value: '', text: 'Nobody yet' })].concat(d.staff.map(function (s) {
      return el('option', { value: s.id, text: s.name + ' (' + s.role + ')', selected: !!(m.assignedTo && m.assignedTo.id === s.id) });
    })));
    function save(body, select, before) {
      select.disabled = true;
      AC.api('PUT', path, body).then(function () { AC.toast('Saved.'); return load(); }, function (err) {
        select.value = before; select.disabled = false;
        if (err.code !== 'cancelled') AC.toast(err.message, 'bad');
      });
    }
    status.addEventListener('change', function () { save({ status: status.value }, status, m.status); });
    owner.addEventListener('change', function () { save({ assignedTo: owner.value || null }, owner, m.assignedTo ? m.assignedTo.id : ''); });
    return el('div', { class: 'handling' }, [
      el('div', { class: 'field' }, [el('label', { for: 'statusPick', text: 'Status' }), status]),
      el('div', { class: 'field' }, [el('label', { for: 'ownerPick', text: 'Looked after by' }), owner]),
      d.history.length ? AC.timeline(d.history.slice(0, 5), { 'support.status': 'Status changed', 'support.assign': 'Given to someone' }, '') : null
    ]);
  }

  function render(d) {
    data = d;
    var m = d.message;
    AC.head({
      title: m.name || m.email, crumb: 'Message',
      sub: [el('span', { text: m.topicLabel + ' · received ' + AC.fmt.dateTime(m.createdAt) })],
      badges: [AC.status('support', m.status), m.priority ? AC.badge('Priority support', 'warn') : null],
      actions: [],
      note: !d.emailOn && d.can.reply ? AC.notice("Email sending isn't set up, so replies can't be sent from here. Reply from the support inbox instead.", 'warn') : null
    });
    AC.fill('msgBody', [el('p', { class: 'msg-body', text: m.body })]);
    AC.fill('threadBody', [d.thread.length ? el('ul', { class: 'thread' }, d.thread.map(threadItem)) : AC.quiet('No replies or notes yet.')]);
    AC.fill('senderBody', [AC.facts([
      AC.fact('Name', el('span', { text: m.name })),
      AC.fact('Email', el('a', { href: 'mailto:' + m.email, text: m.email })),
      AC.fact('Account', d.customer ? (AC.can('customers.view') ? el('a', { href: AC.base + '/customers/' + encodeURIComponent(d.customer.id), text: d.customer.fullName })
        : el('span', { text: d.customer.fullName })) : el('span', { text: 'Not signed in when they wrote' })),
      AC.idFact('Message ID', m.id, 'message ID')
    ])]);
    AC.fill('handlingBody', [handling(d)]);
    AC.fill('earlierBody', [d.earlier.length ? el('ul', { class: 'plain-list' }, d.earlier.map(function (o) {
      return el('li', null, [el('a', { href: AC.base + '/support/' + encodeURIComponent(o.id), text: o.topic + ', ' + AC.fmt.date(o.createdAt) }), ' ', AC.status('support', o.status)]);
    })) : AC.quiet('This is the first message from this email address.')]);
    var replyBlock = byId('replyBlock');
    if (replyBlock) {
      replyBlock.hidden = !(d.can.reply && d.emailOn);
      byId('replyTo').textContent = 'To ' + m.email;
    }
  }

  function load() { return rec.load(); }
  var rec = AC.record({ endpoint: path, notFound: ['Message not found', 'There is no message with this ID. It may have been deleted with its account.'], render: render });

  /* the reply and note forms: the text stays if sending fails */
  function wire(formId, textId, errId, btnId, send, done) {
    var form = byId(formId); if (!form) return;
    var text = byId(textId), err = byId(errId), btn = byId(btnId);
    function show(msg) { err.textContent = msg || ''; err.hidden = !msg; if (msg) text.setAttribute('aria-invalid', 'true'); else text.removeAttribute('aria-invalid'); }
    text.addEventListener('input', function () { show(''); var c = byId('replyCount'); if (c && textId === 'replyText') c.textContent = text.value.length.toLocaleString('en-IN') + ' of 5,000'; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = text.value.trim();
      if (value.length < 2) { show('Write something first.'); text.focus(); return; }
      AC.busy(btn, true);
      send(value).then(function () {
        AC.busy(btn, false); text.value = ''; show(''); done(); load();
      }, function (er) {
        AC.busy(btn, false);
        if (er.code === 'cancelled') return;
        show((er.fields && (er.fields.body || er.fields.then)) || er.message);
      });
    });
  }
  wire('replyForm', 'replyText', 'replyErr', 'replyBtn', function (body) {
    var then = byId('replyThen').value;
    return AC.confirm({ title: 'Send this reply?', text: 'It is emailed to ' + data.message.email + ' now and cannot be taken back.', confirmLabel: 'Send reply' }).then(function (ok) {
      if (!ok) throw new AC.ApiError(0, 'cancelled', 'Cancelled.');
      return AC.api('POST', path + '/reply', { body: body, then: then });
    });
  }, function () { AC.toast('Reply sent.'); var c = byId('replyCount'); if (c) c.textContent = '0 of 5,000'; });
  wire('noteForm', 'noteText', 'noteErr', 'noteBtn', function (body) { return AC.api('POST', path + '/note', { body: body }); }, function () { AC.toast('Note added.'); });
})();
