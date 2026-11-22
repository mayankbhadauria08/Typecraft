/* Security: admin console sign-ins, sign-in locks, failed admin sign-ins, checks.
   GET  /api/console/security → { sessions: [{ ref, userId, name, email, role, roleLabel, device, ip, secondFactor, startedAt, lastSeenAt, endsAt, you }],
          locks: [{ ref, kind, label, email, ip, tries, limit, locked, until }], failed: [{ name, email, what, ip, at }],
          checks: [{ ok, label, detail }], rules: { length, idle, max, lengths: [{ key, idle, max }], lengthChanged, emailCode, idleMinutes, maxHours,
          freshMinutes, learnerLock, adminLock }, can: { manage } }
   POST /api/console/security/sessions/:ref/end    POST /api/console/security/sessions/end-others    POST /api/console/security/unlock { ref }
   POST /api/console/security/session-length { length }
   The four changes ask for the password again. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var byId = function (id) { return document.getElementById(id); };
  var data = null;

  function act(button, method, path, body, confirmOpts) {
    AC.confirm(confirmOpts).then(function (ok) {
      if (!ok) return;
      AC.busy(button, true);
      AC.api(method, path, body).then(function (res) { AC.toast(res.message); load(); }, function (err) {
        AC.busy(button, false); if (err.code !== 'cancelled') AC.toast(err.message, 'bad');
      });
    });
  }

  function checks(list) {
    AC.fill('checksBody', [el('ul', { class: 'checklist' }, list.map(function (c) {
      return el('li', null, [
        el('span', { class: 'check-state ' + (c.ok ? 'is-ready' : 'is-waiting') }, [c.ok ? AC.icon('check') : null, el('span', { class: 'vh', text: c.ok ? 'Fine: ' : 'Needs a look: ' })]),
        el('div', null, [el('div', { class: 'check-title', text: c.label }), el('p', { class: 'check-detail', text: c.detail })])
      ]);
    }))]);
  }

  function sessions(list) {
    var others = list.filter(function (s) { return !s.you; }).length;
    var tools = AC.clear(byId('sessionsTools'));
    if (data.can.manage && others) {
      var all = el('button', { type: 'button', class: 'btn btn-quiet btn-sm btn-quiet-danger', text: 'Sign everyone else out' });
      all.addEventListener('click', function () {
        act(all, 'POST', '/api/console/security/sessions/end-others', {}, { title: 'Sign everyone else out?', danger: true, confirmLabel: 'Sign them out',
          text: 'Every admin console sign-in except yours ends now, on every device. Use this if a password may have leaked. Their TypeCraft accounts are not affected.' });
      });
      tools.appendChild(all);
    }
    AC.fill('sessionsBody', [list.length ? AC.table([['Person'], ['Device', 'col-wide'], ['Signed in', 'col-wide'], ['Last active', 'col-wide'], ['', 'col-fit']], list.map(function (s) {
      var end = null;
      if (data.can.manage && !s.you) {
        end = el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Sign out' });
        end.addEventListener('click', function () {
          act(end, 'POST', '/api/console/security/sessions/' + encodeURIComponent(s.ref) + '/end', {}, { title: 'Sign ' + s.name + ' out?', confirmLabel: 'Sign out',
            text: 'Their admin console sign-in on ' + s.device + ' ends now. They can sign in again with their password' + (s.secondFactor ? ' and an emailed code.' : '.') });
        });
      }
      return el('tr', null, [
        el('td', null, [el('span', { class: 'cell-main', text: s.name + (s.you ? ' (you, here)' : '') }), el('div', { class: 'cell-sub', text: s.email + ' · ' + s.roleLabel })]),
        el('td', { class: 'col-wide' }, [el('span', { text: s.device }), s.ip ? el('div', { class: 'cell-sub mono', text: s.ip }) : null]),
        el('td', { class: 'col-wide' }, [el('span', { title: AC.fmt.dateTime(s.startedAt), text: AC.fmt.ago(s.startedAt) }),
          el('div', { class: 'cell-sub', text: s.secondFactor ? 'Password and emailed code' : 'Password only' })]),
        el('td', { class: 'col-wide' }, [el('span', { title: AC.fmt.dateTime(s.lastSeenAt), text: AC.fmt.ago(s.lastSeenAt) })]),
        el('td', { class: 'col-fit' }, end)
      ]);
    }), true) : AC.quiet('Nobody is signed in.')]);
  }

  function locks(list) {
    AC.fill('locksBody', [
      list.length ? AC.table([['Account'], ['Wrong tries', 'col-fit'], ['', 'col-fit']], list.map(function (l) {
        var lift = null;
        if (data.can.manage) {
          lift = el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: l.locked ? 'Unlock' : 'Reset count' });
          lift.addEventListener('click', function () {
            act(lift, 'POST', '/api/console/security/unlock', { ref: l.ref }, { title: (l.locked ? 'Unlock ' : 'Reset the count for ') + (l.email || 'this account') + '?', confirmLabel: l.locked ? 'Unlock' : 'Reset',
              text: 'Only do this when you know the wrong tries were theirs (for example, they called you). Otherwise the lock ends by itself at ' + AC.fmt.time(l.until) + '.' });
          });
        }
        return el('tr', null, [
          el('td', null, [el('span', { class: 'cell-main', text: l.email || 'Unknown account' }), el('div', { class: 'cell-sub', text: l.label + (l.ip ? ' · from ' + l.ip : '') })]),
          el('td', { class: 'col-fit' }, l.locked ? AC.badge('Locked until ' + AC.fmt.time(l.until), 'bad') : el('span', { text: l.tries + ' of ' + l.limit })),
          el('td', { class: 'col-fit' }, lift)
        ]);
      })) : el('p', { class: 'all-clear' }, [AC.icon('check'), 'No account has several wrong tries right now.'])
    ]);
  }

  function failed(list) {
    AC.fill('failedBody', [list.length ? AC.table([['Who'], ['What', 'col-wide'], ['When', 'col-wide']], list.map(function (f) {
      return el('tr', null, [
        el('td', null, [el('span', { class: 'cell-main', text: f.name }), el('div', { class: 'cell-sub', text: (f.email || '') + (f.ip ? ' · ' + f.ip : '') })]),
        el('td', { class: 'col-wide', text: f.what }),
        el('td', { class: 'col-wide nowrap', text: AC.fmt.dateTime(f.at) })
      ]);
    })) : el('p', { class: 'all-clear' }, [AC.icon('check'), 'None in the last 7 days.'])]);
  }

  // what each sign-in length is for (the server sends the lengths themselves)
  var LENGTH_HINTS = {
    '30m': 'The safest. Best on a computer other people use.',
    '2h': 'Fewer sign-ins during a long task.',
    '8h': 'Stay signed in for a working day.',
    '1d': 'Only on your own computer, locked when you step away.'
  };

  function editLength() {
    var r = data.rules;
    AC.formDialog({
      title: 'How long an admin sign-in lasts',
      text: 'For you and every other administrator. It applies straight away, to everyone signed in now too. Whatever you choose, refunds, roles, '
        + 'administrators and security changes still ask for the password again after ' + r.freshMinutes + ' minutes.'
        + (r.emailCode ? '' : ' The emailed sign-in code is off, so a password alone opens the admin: a longer sign-in is safer once the code is on.'),
      submitLabel: 'Save',
      fields: [{ name: 'length', label: 'Sign out after', type: 'radio', value: r.length, options: r.lengths.map(function (l) {
        return { value: l.key, label: l.idle + ' without activity', hint: 'And after ' + l.max + ' at the latest. ' + (LENGTH_HINTS[l.key] || '') };
      }) }],
      submit: function (v) { return AC.api('POST', '/api/console/security/session-length', { length: v.length }); }
    }).then(function (res) { if (res) { AC.toast(res.message); load(); } });
  }

  function rules(r) {
    var tools = AC.clear(byId('rulesTools'));
    if (data.can.manage) tools.appendChild(el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Change sign-in length', on: { click: editLength } }));
    var changed = r.lengthChanged ? 'Set by ' + (r.lengthChanged.by || 'an administrator') + ' on ' + AC.fmt.date(r.lengthChanged.at) : 'The standard setting';
    AC.fill('rulesBody', [el('dl', { class: 'facts' }, [
      AC.fact('Admin console: signed out after', r.idle + ' without activity, and ' + r.max + ' at the latest', el('div', { class: 'cell-sub', text: changed })),
      AC.fact('Sensitive changes', 'Ask for the password again after ' + r.freshMinutes + ' minutes'),
      AC.fact('Admin sign-in lock', r.adminLock.tries + ' wrong passwords from one address: locked for ' + r.adminLock.minutes + ' minutes'),
      AC.fact('Site sign-in lock', r.learnerLock.tries + ' wrong passwords: locked for ' + r.learnerLock.minutes + ' minutes'),
      AC.fact('IP addresses', 'Kept in the activity log for 90 days, then removed')
    ])]);
  }

  function load() {
    AC.api('GET', '/api/console/security').then(function (d) {
      data = d;
      byId('dash').removeAttribute('aria-busy');
      var note = AC.clear(byId('securityNote'));
      if (!d.can.manage) note.appendChild(AC.notice('Your role can see this page. Signing people out, unlocking accounts and the sign-in length are for Super Admins.'));
      checks(d.checks); sessions(d.sessions); locks(d.locks); failed(d.failed); rules(d.rules);
    }, function (err) {
      byId('dash').removeAttribute('aria-busy');
      AC.fill('checksBody', [AC.quiet("Couldn't load this page. " + err.message), el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Try again', on: { click: load } })]);
    });
  }
  load();
})();
