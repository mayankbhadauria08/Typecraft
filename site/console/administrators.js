/* Administrators: who can use the admin console.
   GET    /api/console/administrators → { staff: [{ id, fullName, email, role, roleLabel, source: 'setting' | 'console', changeable, active, emailVerified,
            addedAt, addedBy, lastSignIn, openSessions, you }], ownersWithoutAccount, roles: [{ value, label, hint }], can: { manage } }
   POST   /api/console/administrators { email, role }    PUT /api/console/administrators/:id { role }    DELETE /api/console/administrators/:id
   Changes ask for the password again (Super Admin only). */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var body = document.getElementById('adminBody'), table = document.getElementById('adminList'), addBtn = document.getElementById('addAdmin');
  var data = null;

  function after(res) { data = res; render(); AC.toast(res.message); return res; }

  function add() {
    AC.formDialog({
      title: 'Add an administrator',
      text: 'They need a TypeCraft account already: ask them to sign up on the site first. They get an email saying what changed.',
      submitLabel: 'Add',
      fields: [
        { name: 'email', label: 'Email of their TypeCraft account', type: 'email', required: true, maxlength: 200, placeholder: 'name@example.com' },
        { name: 'role', label: 'Role', type: 'radio', value: 'support', options: data.roles }
      ],
      submit: function (v) { return AC.api('POST', '/api/console/administrators', { email: v.email, role: v.role }).then(after); }
    });
  }
  function change(s) {
    AC.formDialog({
      title: 'Change ' + s.fullName + '’s role',
      text: 'It applies straight away, and they get an email about it.',
      submitLabel: 'Change role',
      fields: [{ name: 'role', label: 'Role', type: 'radio', value: s.role, options: data.roles }],
      submit: function (v) { return AC.api('PUT', '/api/console/administrators/' + encodeURIComponent(s.id), { role: v.role }).then(after); }
    });
  }
  function remove(s, button) {
    AC.confirm({ title: 'Remove ' + s.fullName + '?', danger: true, confirmLabel: 'Remove from the console',
      text: 'They are signed out of the admin console now and can’t sign in to it again. Their TypeCraft account stays as it is. They get an email about it.' }).then(function (ok) {
      if (!ok) return;
      AC.busy(button, true);
      AC.api('DELETE', '/api/console/administrators/' + encodeURIComponent(s.id)).then(after, function (err) {
        AC.busy(button, false); if (err.code !== 'cancelled') AC.toast(err.message, 'bad');
      });
    });
  }

  function row(s) {
    var badges = [AC.badge(s.roleLabel, 'role')];
    if (!s.active) badges.push(AC.badge('Account disabled', 'bad'));
    var person = el('td', null, [
      el('span', { class: 'cell-main', text: s.fullName + (s.you ? ' (you)' : '') }),
      el('div', { class: 'cell-sub', text: s.email }),
      !s.emailVerified ? el('div', { class: 'cell-sub', text: 'Email not confirmed yet' }) : null,
      el('div', { class: 'person-extra' }, [badges[0], el('span', { text: s.lastSignIn ? 'Last sign-in ' + AC.fmt.ago(s.lastSignIn) : 'Never signed in' })])
    ]);
    var tools = null;
    if (data.can.manage && s.changeable) {
      var del = el('button', { type: 'button', class: 'btn btn-quiet btn-sm btn-quiet-danger', text: 'Remove' });
      del.addEventListener('click', function () { remove(s, del); });
      tools = el('div', { class: 'row-tools' }, [el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Change role', on: { click: function () { change(s); } } }), del]);
    } else if (s.source === 'setting') {
      tools = el('span', { class: 'cell-sub', text: 'From OWNER_EMAILS' });
    }
    return el('tr', null, [
      person,
      el('td', { class: 'col-fit' }, badges),
      el('td', { class: 'col-wide' }, s.source === 'setting' ? el('span', { class: 'cell-sub', text: 'Cloudflare setting' })
        : [el('span', { text: s.addedAt ? AC.fmt.date(s.addedAt) : '–' }), s.addedBy ? el('div', { class: 'cell-sub', text: 'by ' + s.addedBy }) : null]),
      el('td', { class: 'col-wide' }, [el('span', { title: s.lastSignIn ? AC.fmt.dateTime(s.lastSignIn) : '', text: s.lastSignIn ? AC.fmt.ago(s.lastSignIn) : 'Never' }),
        s.openSessions ? el('div', { class: 'cell-sub', text: 'Signed in now' }) : null]),
      el('td', { class: 'col-fit' }, tools)
    ]);
  }

  function render() {
    table.removeAttribute('aria-busy');
    AC.clear(body);
    data.staff.forEach(function (s) { body.appendChild(row(s)); });
    var note = AC.clear(document.getElementById('adminNote'));
    if (data.ownersWithoutAccount) note.appendChild(AC.notice(data.ownersWithoutAccount + (data.ownersWithoutAccount === 1 ? ' email in OWNER_EMAILS has' : ' emails in OWNER_EMAILS have') +
      ' no account yet. Whoever signs up with it first becomes Super Admin: create the account now, or take the email out of the setting.', 'warn'));
    else if (!data.can.manage) note.appendChild(AC.notice('Only a Super Admin can add or remove administrators. You can see who has access here.'));
    if (addBtn) addBtn.disabled = !data.can.manage;
  }

  if (addBtn) addBtn.addEventListener('click', add);
  function load() {
    AC.api('GET', '/api/console/administrators').then(function (d) { data = d; render(); }, function (err) {
      table.removeAttribute('aria-busy');
      AC.clear(body).appendChild(el('tr', null, el('td', { class: 'empty-cell', colspan: 5 }, ["Couldn't load the list. " + err.message,
        el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Try again', on: { click: load } })])));
    });
  }
  load();
})();
