/* One institute.
   GET /api/console/institutes/:id → { institute: { id, name, city, status, packageId, packageName, contactName, contactEmail, contactPhone, gstin, notes,
       seats, seatsUsed, startsAt, endsAt, startDate, lastDay, pricePaise | null }, money: { pricePaise, duePaise, paidPaise } | null,
       batches: [{ id, name, students, joinCode, archived, teachers }], staff: [{ id, email, name, role, status, invitedAt, joinedAt, removedAt }],
       payments: [{ id, amountPaise, method, reference, paidOn, note, recordedBy, createdAt }] | null, history: [...] | null,
       can: { manage, payments }, today }
   Changes: AC.institutes (institute-actions.js). */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var id = decodeURIComponent(location.pathname.split('/').pop());
  var LABELS = {
    'institute.create': 'Institute created', 'institute.update': 'Details changed', 'institute.term': 'Seats or term changed', 'institute.status': 'Status changed',
    'institute.payment': 'Payment recorded', 'institute.payment_remove': 'Payment removed', 'institute.staff_invite': 'Invitation sent',
    'institute.staff_resend': 'Invitation sent again', 'institute.staff_remove': 'Removed from the institute'
  };
  var page = null;
  var after = function (changed) { if (changed) page.load(); };
  var day = function (d) { return AC.fmt.date(d + 'T12:00:00+05:30'); };
  var btn = function (label, iconName, onClick, kind) {
    return el('button', { type: 'button', class: 'btn ' + (kind || 'btn-quiet'), on: { click: onClick } }, [iconName ? AC.icon(iconName) : null, el('span', { text: label })]);
  };

  function noteFor(i, today, can) {
    if (i.status === 'pending') return AC.notice('Not paid yet: no student can join. ' + (can.payments ? 'Record the payment to switch it on.' : 'It switches on when the payment is recorded.'), 'warn');
    if (i.status === 'suspended') return AC.notice('Paused: seats don’t give the plan and nobody can join until it is switched on again.', 'warn');
    if (i.status === 'closed') return AC.notice('Closed: seats don’t give the plan, and its admin and teachers have no access.');
    if (i.lastDay < today) return AC.notice('The term ended on ' + day(i.lastDay) + ': seats no longer give the plan. To renew, change the term and move the last day on.', 'warn');
    if (i.startDate > today) return AC.notice('The term starts on ' + day(i.startDate) + '. Until then nobody can join.');
    return null;
  }
  function actionsFor(d) {
    var i = d.institute, can = d.can, out = [];
    if (can.payments && i.status !== 'closed') out.push(btn('Record payment', 'card', function () { AC.institutes.payment(i, d.today, d.money ? d.money.duePaise - d.money.paidPaise : 0).then(after); },
      i.status === 'pending' ? 'btn-primary' : null));
    if (!can.manage) return out;
    if (i.status !== 'closed') {
      out.push(btn('Change seats or term', 'calendar', function () { AC.institutes.term(i, d.money).then(after); }));
      out.push(btn('Edit details', 'note', function () { AC.institutes.edit(i).then(after); }));
    }
    if (i.status === 'pending' || i.status === 'suspended') out.push(btn('Switch on', 'check', function () { AC.institutes.status(i, 'active').then(after); }));
    if (i.status === 'active') out.push(btn('Pause', 'clock', function () { AC.institutes.status(i, 'suspended').then(after); }));
    if (i.status !== 'closed') out.push(btn('Close', 'x', function () { AC.institutes.status(i, 'closed').then(after); }));
    return out;
  }

  function seats(d) {
    var i = d.institute, m = d.money;
    var rows = [
      AC.fact('Seats', i.seatsUsed + ' in use of ' + i.seats),
      AC.fact('Plan a seat gives', i.packageName),
      AC.fact('First day', day(i.startDate)),
      AC.fact('Last day', day(i.lastDay))
    ];
    if (m) {
      rows.push(AC.fact('Price per seat', AC.money(m.pricePaise)));
      rows.push(AC.fact('For the term', AC.money(m.duePaise), el('span', { class: 'cell-sub', text: ' ' + i.seats + ' × ' + AC.money(m.pricePaise) })));
      rows.push(AC.fact('Paid', AC.money(m.paidPaise)));
      var left = m.duePaise - m.paidPaise;
      rows.push(AC.fact(left >= 0 ? 'Still to pay' : 'Paid in advance', AC.money(Math.abs(left))));
    }
    rows.push(AC.idFact('Institute ID', i.id, 'institute ID'));
    AC.fill('seatsBody', AC.facts(rows));
  }
  function contact(i) {
    AC.fill('contactBody', AC.facts([
      AC.fact('Person', i.contactName || '–'),
      AC.fact('Email', i.contactEmail ? el('a', { href: 'mailto:' + i.contactEmail, text: i.contactEmail }) : '–'),
      AC.fact('Phone', i.contactPhone || '–'),
      AC.fact('GSTIN', i.gstin ? el('span', { class: 'mono', text: i.gstin }) : 'None'),
      AC.fact('Private notes', i.notes ? el('span', { class: 'pre-wrap', text: i.notes }) : '–')
    ]));
  }
  function batches(list) {
    if (!list.length) return AC.fill('batchesBody', AC.quiet('No batches yet. Their admin creates them after accepting the invitation.'));
    AC.fill('batchesBody', AC.table([['Batch'], ['Students', 'num'], ['Teachers', 'col-wide'], ['Join code', 'col-fit']], list.map(function (b) {
      return el('tr', null, [
        el('td', null, [el('span', { class: 'cell-main', text: b.name }), b.archived ? el('div', null, AC.badge('Archived')) : null]),
        el('td', { class: 'num', text: String(b.students) }),
        el('td', { class: 'col-wide', text: b.teachers || 'Admins only' }),
        el('td', { class: 'col-fit mono', text: b.joinCode || '–' })
      ]);
    })));
  }
  function staff(d) {
    var i = d.institute, can = d.can && d.can.manage && i.status !== 'closed';
    var top = can ? el('div', { class: 'block-actions' }, btn('Invite admin or teacher', 'mail', function () { AC.institutes.invite(i).then(after); })) : null;
    var list = d.staff;
    if (!list.length) return AC.fill('staffBody', [top, AC.quiet('Nobody yet. Invite their admin: they set up batches and invite their teachers.')]);
    AC.fill('staffBody', [top, AC.table([['Person'], ['Role', 'col-fit'], ['Status', 'col-fit'], ['Since', 'col-wide'], ['', 'col-act']], list.map(function (s) {
      var acts = can && s.status !== 'removed' ? el('div', { class: 'row-actions' }, [
        s.status === 'invited' ? el('button', { type: 'button', class: 'btn-link', text: 'Send again', on: { click: function () { AC.institutes.resend(i, s); } } }) : null,
        el('button', { type: 'button', class: 'btn-link btn-link-danger', text: 'Remove', on: { click: function () { AC.institutes.removeStaff(i, s).then(after); } } })
      ]) : null;
      return el('tr', null, [
        el('td', null, [el('span', { class: 'cell-main', text: s.name || s.email }), s.name ? el('div', { class: 'cell-sub', text: s.email }) : null]),
        el('td', { class: 'col-fit', text: s.role === 'admin' ? 'Admin' : 'Teacher' }),
        el('td', { class: 'col-fit' }, AC.status('staff', s.status)),
        el('td', { class: 'col-wide', text: AC.fmt.date(s.removedAt || s.joinedAt || s.invitedAt) }),
        el('td', { class: 'col-act' }, acts)
      ]);
    }))]);
  }
  function payments(d) {
    if (!d.payments) return;
    var i = d.institute, can = d.can.payments;
    if (!d.payments.length) return AC.fill('paymentsBody', AC.quiet('No payments recorded yet.'));
    AC.fill('paymentsBody', AC.table([['Day'], ['Amount', 'num'], ['How', 'col-wide'], ['Reference', 'col-wide'], ['Recorded by', 'col-wide'], ['', 'col-act']], d.payments.map(function (p) {
      return el('tr', null, [
        el('td', null, [el('span', { class: 'cell-main', text: day(p.paidOn) }), p.note ? el('div', { class: 'cell-sub', text: p.note }) : null]),
        el('td', { class: 'num', text: AC.money(p.amountPaise) }),
        el('td', { class: 'col-wide', text: AC.method(p.method) }),
        el('td', { class: 'col-wide mono', text: p.reference || '–' }),
        el('td', { class: 'col-wide', text: p.recordedBy }),
        el('td', { class: 'col-act' }, can ? el('button', { type: 'button', class: 'btn-link btn-link-danger', text: 'Remove', on: { click: function () { AC.institutes.removePayment(i, p).then(after); } } }) : null)
      ]);
    })));
  }

  page = AC.record({
    endpoint: '/api/console/institutes/' + encodeURIComponent(id),
    notFound: ['Institute not found', 'There is no institute with this ID.'],
    render: function (d) {
      var i = d.institute;
      AC.head({ title: i.name, sub: [i.city, i.packageName + ' for ' + i.seats + ' seats'].filter(Boolean).join(' · '),
        badges: [AC.status('institute', i.status)], actions: actionsFor(d), note: noteFor(i, d.today, d.can) });
      seats(d); contact(i); batches(d.batches); staff(d); payments(d);
      if (d.history) AC.fill('activityBody', AC.timeline(d.history, LABELS, 'Nothing has changed yet.'));
    }
  });
})();
