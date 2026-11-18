/* One customer's profile.
   GET    /api/console/customers/:id → { customer, plan, subscriptions, packages | null, orders | null, progress, devices, sessions,
                                          notes, emails | null, activity | null, can: { manage, manageBlock, notes, plans } }
          (orders, emails and activity are null when the role may not see them; their sections are then not on the page)
   POST   /api/console/customers/:id/status   { status, reason }
   POST   /api/console/customers/:id/sign-out
   POST   /api/console/customers/:id/notes    { body } → { notes }
   DELETE /api/console/notes/:id              → { notes }
   Giving, extending and ending plans: AC.plans (plan-actions.js). Learning access: AC.access (access-actions.js). */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var id = (AC.boot.page.params || {}).id;
  var api = '/api/console/customers/' + encodeURIComponent(id);
  var current = null;

  var ACTION = { 'user.disable': 'Account disabled', 'user.enable': 'Account restored', 'user.sign_out': 'Signed out everywhere', 'user.note_add': 'Note added',
    'user.note_delete': 'Note deleted', 'user.role': 'Staff role changed', 'subscription.grant': 'Plan given', 'subscription.revoke': 'Plan ended',
    'subscription.extend': 'Plan extended', 'access.add': 'Access exception added', 'access.end': 'Access exception ended' };
  var reloadAfter = function (r) { if (r && r !== true) load(); };
  var fill = AC.fill, quiet = AC.quiet, table = AC.table, fact = AC.fact;
  function initials(name, email) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    return (parts.length ? parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '') : String(email || '?')[0]).toUpperCase();
  }

  /* ---------- header and actions ---------- */
  function head(d) {
    var c = d.customer, name = c.fullName || 'No name';
    doc.title = name + ' – TypeCraft Admin';
    var crumb = doc.querySelector('.crumb.is-here'); if (crumb) crumb.textContent = name;
    byId('custAvatar').textContent = initials(c.fullName, c.email);
    byId('custName').textContent = name;
    byId('custEmail').textContent = c.email;
    var badges = AC.clear(byId('custBadges'));
    [
      AC.badge(c.status === 'active' ? 'Active' : 'Disabled', c.status === 'active' ? 'ok' : 'bad'),
      AC.badge(c.emailVerified ? 'Email verified' : 'Email not verified', c.emailVerified ? '' : 'warn'),
      AC.badge(d.plan.name + ' plan', d.plan.id === 'free' ? '' : 'role'),
      c.roleLabel ? AC.badge('Staff: ' + c.roleLabel, 'warn') : null
    ].forEach(function (b) { if (b) badges.appendChild(b); });

    var actions = AC.clear(byId('custActions'));
    var block = byId('custBlock');
    block.hidden = !d.can.manageBlock;
    block.textContent = d.can.manageBlock || '';
    if (!d.can.manage) return;
    actions.appendChild(el('button', { type: 'button', class: 'btn btn-quiet', on: { click: function () { signOut(c); } } }, [AC.icon('logout'), el('span', { text: 'Sign out everywhere' })]));
    actions.appendChild(c.status === 'active'
      ? el('button', { type: 'button', class: 'btn btn-quiet btn-quiet-danger', text: 'Disable account', on: { click: function () { setStatus(c, 'disabled'); } } })
      : el('button', { type: 'button', class: 'btn btn-primary', text: 'Restore account', on: { click: function () { setStatus(c, 'active'); } } }));
  }
  function setStatus(c, status) {
    var name = c.fullName || c.email, off = status === 'disabled';
    AC.formDialog({
      title: off ? 'Disable ' + name + "'s account?" : 'Restore ' + name + "'s account?",
      text: off ? 'They are signed out at once and cannot sign in until the account is restored. Their plan, payments and progress are kept.'
        : 'They can sign in again with the same email and password. Nothing else changes.',
      fields: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true, maxlength: 300, requiredText: 'Give a reason.',
        hint: 'Kept in the activity log. The customer does not see it.' }],
      submitLabel: off ? 'Disable account' : 'Restore account',
      danger: off,
      submit: function (v) { return AC.api('POST', api + '/status', { status: status, reason: v.reason }); }
    }).then(function (done) {
      if (!done) return;
      AC.toast(off ? 'Account disabled.' : 'Account restored.');
      load();
    });
  }
  function signOut(c) {
    var name = c.fullName || c.email;
    AC.confirm({
      title: 'Sign ' + name + ' out everywhere?',
      text: 'Every browser and device signed in to this account has to sign in again. The password does not change.',
      confirmLabel: 'Sign out everywhere'
    }).then(function (ok) {
      if (!ok) return;
      AC.api('POST', api + '/sign-out').then(function (r) {
        AC.toast(r.ended ? 'Signed out of ' + r.ended + (r.ended === 1 ? ' session.' : ' sessions.') : 'There were no open sessions.', r.ended ? 'ok' : 'info');
        load();
      }, function (err) { if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
    });
  }

  /* ---------- sections ---------- */
  /** "On Premium until 2 Dec 2026, then Pro until 6 Feb 2027." The plan shown is the highest one the customer has; a lower one may last longer. */
  function planLine(d) {
    var p = d.plan;
    if (p.id === 'free') return 'On the Free plan.';
    var on = d.subscriptions.filter(function (s) { return s.status === 'active' || s.status === 'upcoming'; });
    var top = on.filter(function (s) { return s.packageId === p.id; });
    if (!top.length) return 'On ' + p.name + (p.expiresAt ? ' until ' + AC.fmt.date(p.expiresAt) + '.' : ', with no end date.');
    var lasts = function (s) { return s.expiresAt || '9999'; };   // no end date lasts longest
    var topEnd = top.map(lasts).sort().pop();
    if (topEnd === '9999') return 'On ' + p.name + ', with no end date.';
    var after = on.filter(function (s) { return s.packageId !== p.id && lasts(s) > topEnd; }).sort(function (a, b) { return lasts(a) < lasts(b) ? 1 : -1; })[0];
    return 'On ' + p.name + ' until ' + AC.fmt.date(topEnd)
      + (after ? ', then ' + after.packageName + (after.expiresAt ? ' until ' + AC.fmt.date(after.expiresAt) : ' with no end date') : '') + '.';
  }
  function plan(d) {
    var now = planLine(d);
    var who = d.customer.fullName || d.customer.email, can = d.can.plans;
    var rows = d.subscriptions.map(function (s) {
      var on = s.status === 'active' || s.status === 'upcoming';
      var how = s.source === 'purchase' && s.orderId && d.orders ? el('a', { href: AC.base + '/payments/' + encodeURIComponent(s.orderId), text: 'Bought' }) : AC.source(s.source);
      return el('tr', null, [
        el('td', null, [el('span', { class: 'cell-main', text: s.packageName }), el('div', { class: 'cell-sub' }, how)]),
        el('td', { class: 'col-fit' }, AC.status('plan', s.status)),
        el('td', { class: 'col-wide nowrap', text: AC.fmt.date(s.startsAt) }),
        el('td', { class: 'nowrap', text: s.expiresAt ? AC.fmt.date(s.expiresAt) : 'No end date' }),
        can ? el('td', { class: 'col-act' }, on ? el('div', { class: 'row-actions' }, [
          s.expiresAt ? el('button', { type: 'button', class: 'btn-link', text: 'Extend', 'aria-label': 'Extend ' + s.packageName,
            on: { click: function () { AC.plans.extend(s, who).then(reloadAfter); } } }) : null,
          el('button', { type: 'button', class: 'btn-link btn-link-danger', text: 'End', 'aria-label': 'End ' + s.packageName,
            on: { click: function () { AC.plans.end(s, who).then(reloadAfter); } } })
        ]) : null) : null
      ]);
    });
    var heads = [['Plan'], ['Status', 'col-fit'], ['Started', 'col-wide'], ['Ends']];
    if (can) heads.push(['', 'col-act']);
    fill('planBody', [el('p', { class: 'lead', text: now }), rows.length ? table(heads, rows) : quiet('No paid plan so far.')]);
    // "Give a plan" sits beside the section's title
    var head = byId('planTitle').parentNode, old = head.querySelector('.block-actions');
    if (old) old.remove();
    if (can && d.packages && d.packages.length) {
      head.appendChild(el('div', { class: 'block-actions' }, el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Give a plan',
        on: { click: function () { AC.plans.grant(d.customer, d.packages).then(reloadAfter); } } })));
    }
  }
  function orders(d) {
    if (!d.orders) return;
    var rows = d.orders.map(function (o) {
      return el('tr', null, [
        el('td', { class: 'nowrap', title: AC.fmt.dateTime(o.createdAt) }, el('a', { class: 'cell-link', href: AC.base + '/payments/' + encodeURIComponent(o.id), text: AC.fmt.date(o.createdAt) })),
        el('td', null, o.packageName),
        el('td', { class: 'num', text: AC.money(o.amountPaise, o.currency) }),
        el('td', { class: 'col-fit' }, AC.status('order', o.status)),
        el('td', { class: 'col-wide mono', text: o.invoiceNumber || '–' })
      ]);
    });
    fill('ordersBody', rows.length ? [table([['Date'], ['Plan'], ['Amount', 'num'], ['Status', 'col-fit'], ['Invoice', 'col-wide']], rows),
      d.orders.length === 10 ? el('p', { class: 'hint' }, ['The 10 most recent payments. ',
        el('a', { href: AC.base + '/payments?q=' + encodeURIComponent(d.customer.email), text: 'See all of them' }), '.']) : null] : quiet('No payments yet.'));
  }
  function figure(value, label, sub) {
    return el('div', { class: 'figure' }, [el('div', { class: 'figure-value', text: value }), el('div', { class: 'figure-label', text: label }), sub ? el('div', { class: 'figure-sub', text: sub }) : null]);
  }
  function practiceChart(days) {
    var max = Math.max(10, days.reduce(function (m, x) { return Math.max(m, x.minutes); }, 0));
    var active = days.filter(function (x) { return x.minutes > 0; }).length;
    var total = days.reduce(function (s, x) { return s + x.minutes; }, 0);
    var bars = days.map(function (x, i) {
      var h = x.minutes ? Math.max(3, Math.round(40 * x.minutes / max)) : 2;
      return AC.svg('rect', { x: i * 14, y: 44 - h, width: 10, height: h, rx: 2, class: x.minutes ? 'bar' : 'bar is-zero' },
        AC.svg('title', null, AC.fmt.day(x.day) + ': ' + (x.minutes ? x.minutes + ' min' : 'no practice')));
    });
    var summary = active ? 'Practised on ' + active + ' of the last 14 days, ' + total.toLocaleString('en-IN') + (total === 1 ? ' minute' : ' minutes') + ' in total.' : 'No practice in the last 14 days.';
    return el('div', { class: 'practice' }, [
      AC.svg('svg', { class: 'spark', viewBox: '0 0 192 44', width: 192, height: 44, role: 'img', 'aria-label': summary }, bars),
      el('p', { class: 'quiet', text: summary })
    ]);
  }
  function progress(d) {
    var p = d.progress;
    var extra = [];
    if (p.placement) extra.push('Placement test: started at Level ' + p.placement.level + ' (' + p.placement.wpm + ' wpm, ' + p.placement.accuracy + '%).');
    if (p.certificates.length) extra.push('Certificates: ' + p.certificates.map(function (c) { return 'Level ' + c.level + ' (' + c.wpm + ' wpm)'; }).join(', ') + '.');
    fill('progressBody', [
      el('div', { class: 'lessons-done' }, [
        el('div', { class: 'lessons-line' }, [
          el('label', { for: 'lessonsBar', text: p.lessonsDone + ' of ' + p.lessonsTotal + ' lessons completed' }),
          el('span', { class: 'quiet', text: 'Rank: ' + p.rank + ', ' + p.xp.toLocaleString('en-IN') + ' XP' })
        ]),
        el('progress', { id: 'lessonsBar', max: p.lessonsTotal, value: p.lessonsDone })
      ]),
      el('div', { class: 'figures' }, [
        figure(p.bestLessonWpm ? p.bestLessonWpm + ' wpm' : '–', 'Best lesson speed', p.lastPractised ? 'Last practised ' + AC.fmt.ago(p.lastPractised).toLowerCase() : 'Has not practised yet'),
        figure(String(p.stars), p.stars === 1 ? 'Star' : 'Stars', p.crowns + (p.crowns === 1 ? ' crown' : ' crowns')),
        figure(String(p.tests), p.tests === 1 ? 'Typing test' : 'Typing tests', p.tests ? 'Best ' + p.bestTestWpm + ' wpm' : null),
        figure(p.streak + (p.streak === 1 ? ' day' : ' days'), 'Streak', 'Best ' + p.bestStreak)
      ]),
      practiceChart(p.days),
      extra.length ? el('p', { class: 'quiet', text: extra.join(' ') }) : null
    ]);
  }
  /* learning access: lessons and games opened or closed for this customer */
  function learning(d) {
    if (!d.access) return;
    var who = d.customer.fullName || d.customer.email;
    var inForce = d.access.filter(function (a) { return a.state === 'active'; }), past = d.access.length - inForce.length;
    var rows = inForce.map(function (a) {
      return el('tr', null, [
        el('td', null, [el('span', { class: 'cell-main', text: a.targetName }), el('div', { class: 'cell-sub', text: a.reason })]),
        el('td', { class: 'col-fit' }, AC.status('access', a.effect)),
        el('td', { class: 'nowrap', text: AC.access.until(a) }),
        d.can.access ? el('td', { class: 'col-act' }, el('button', { type: 'button', class: 'btn-link', text: 'End', 'aria-label': 'End the exception for ' + a.targetName,
          on: { click: function () { AC.access.end(a, who).then(reloadAfter); } } })) : null
      ]);
    });
    var heads = [['Lesson or game'], ['Effect', 'col-fit'], ['Until']];
    if (d.can.access) heads.push(['', 'col-act']);
    fill('accessBody', [
      rows.length ? table(heads, rows) : quiet('Everything follows the plan.'),
      past ? el('p', { class: 'hint' }, [past + (past === 1 ? ' earlier exception has ended. ' : ' earlier exceptions have ended. '),
        AC.can('access.view') ? el('a', { href: AC.base + '/access?q=' + encodeURIComponent(d.customer.email), text: 'See them' }) : null]) : null
    ]);
    var head = byId('accessTitle').parentNode, old = head.querySelector('.block-actions');
    if (old) old.remove();
    if (d.can.access && d.accessTargets) {
      head.appendChild(el('div', { class: 'block-actions' }, el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Open or close',
        on: { click: function () { AC.access.add(d.customer, d.accessTargets).then(reloadAfter); } } })));
    }
  }
  function notes(list) {
    fill('notesBody', list.length ? el('ul', { class: 'notes' }, list.map(function (n) {
      return el('li', { class: 'note' }, [
        el('p', { class: 'note-body', text: n.body }),
        el('div', { class: 'note-foot' }, [
          el('span', { text: n.author + ' · ' + AC.fmt.dateTime(n.createdAt) }),
          n.canDelete ? el('button', { type: 'button', class: 'btn-link', text: 'Delete', 'aria-label': 'Delete the note from ' + AC.fmt.dateTime(n.createdAt), on: { click: function () { removeNote(n); } } }) : null
        ])
      ]);
    })) : quiet('No notes yet.'));
  }
  function removeNote(n) {
    AC.confirm({ title: 'Delete this note?', text: 'It is removed for everyone. The activity log keeps a record that a note was deleted.', confirmLabel: 'Delete note', danger: true }).then(function (ok) {
      if (!ok) return;
      AC.api('DELETE', '/api/console/notes/' + encodeURIComponent(n.id)).then(function (r) { notes(r.notes); AC.toast('Note deleted.'); },
        function (err) { if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
    });
  }
  function emails(d) {
    if (!d.emails) return;
    var rows = d.emails.map(function (e) {
      return el('tr', null, [el('td', null, e.subject), el('td', { class: 'col-fit' }, AC.status('email', e.status)), el('td', { class: 'nowrap', title: AC.fmt.dateTime(e.createdAt), text: AC.fmt.ago(e.createdAt) })]);
    });
    fill('emailsBody', rows.length ? [table([['Subject'], ['Status', 'col-fit'], ['When']], rows), d.emails.length === 10 ? el('p', { class: 'hint', text: 'The 10 most recent emails.' }) : null]
      : quiet('No emails have been sent to this customer.'));
  }
  function activity(d) {
    if (!d.activity) return;
    fill('activityBody', AC.timeline(d.activity, ACTION, 'Staff have not changed anything on this account.'));
  }
  function account(d) {
    var c = d.customer;
    fill('accountBody', el('dl', { class: 'facts facts-stack' }, [
      fact('Email', c.email),
      fact('Phone', c.phone || '–'),
      fact('Joined', AC.fmt.dateTime(c.createdAt)),
      fact('Last sign-in', c.lastLoginAt ? AC.fmt.dateTime(c.lastLoginAt) : 'Never'),
      c.passwordChangedAt ? fact('Password changed', AC.fmt.dateTime(c.passwordChangedAt)) : null,
      AC.idFact('Customer ID', c.id, 'customer ID')
    ]));
  }
  function devices(d) {
    var s = d.sessions;
    var open = s.active ? s.active + (s.active === 1 ? ' open session' : ' open sessions') + (s.lastSeenAt ? ', last active ' + AC.fmt.ago(s.lastSeenAt).toLowerCase() + '.' : '.') : 'Not signed in anywhere right now.';
    fill('devicesBody', [el('p', { class: 'lead', text: open }),
      d.devices.length ? el('ul', { class: 'devices' }, d.devices.map(function (x) {
        return el('li', null, [el('span', { class: 'cell-main', text: x.label }), el('span', { class: 'cell-sub', text: 'Last used ' + AC.fmt.ago(x.lastSeen).toLowerCase() })]);
      })) : quiet('No devices recorded yet.')]);
  }

  /* ---------- the note form ---------- */
  var noteForm = byId('noteForm');
  if (noteForm) {
    var text = byId('noteText'), counter = byId('noteCount'), noteErr = byId('noteErr'), noteBtn = byId('noteBtn');
    var noteError = function (msg) {
      noteErr.textContent = msg || ''; noteErr.hidden = !msg;
      if (msg) { text.setAttribute('aria-invalid', 'true'); text.setAttribute('aria-describedby', 'noteErr'); } else { text.removeAttribute('aria-invalid'); text.removeAttribute('aria-describedby'); }
    };
    text.addEventListener('input', function () { counter.textContent = text.value.length.toLocaleString('en-IN') + ' of 2,000'; if (!noteErr.hidden) noteError(''); });
    noteForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!text.value.trim()) { noteError('Write the note first.'); text.focus(); return; }
      AC.busy(noteBtn, true);
      AC.api('POST', api + '/notes', { body: text.value }).then(function (r) {
        AC.busy(noteBtn, false);
        text.value = ''; counter.textContent = '0 of 2,000'; noteError('');
        notes(r.notes);
        AC.toast('Note added.');
      }, function (err) {
        AC.busy(noteBtn, false);
        if (err.code === 'cancelled') return;
        noteError((err.fields && err.fields.body) || err.message);
        text.focus();
      });
    });
  }

  /* ---------- loading ---------- */
  function missing(title, message, retry) {
    byId('custPage').hidden = true;
    var box = byId('custMissing');
    byId('custMissingTitle').textContent = title;
    byId('custMissingText').textContent = message;
    var old = box.querySelector('[data-retry]'); if (old) old.remove();
    if (retry) box.appendChild(el('button', { type: 'button', class: 'btn btn-quiet', 'data-retry': true, text: 'Try again', on: { click: load } }));
    box.hidden = false;
  }
  function load() {
    AC.api('GET', api).then(function (d) {
      current = d;
      byId('custMissing').hidden = true;
      var page = byId('custPage'); page.hidden = false; page.removeAttribute('aria-busy');
      head(d); plan(d); orders(d); progress(d); learning(d); notes(d.notes); emails(d); activity(d); account(d); devices(d);
      if (noteForm) noteForm.hidden = !d.can.notes;
    }, function (err) {
      if (err.status === 404) missing('Customer not found', 'There is no account with this ID. It may have been deleted.', false);
      else missing("Couldn't load this customer", err.message, true);
    });
  }
  load();
})();
