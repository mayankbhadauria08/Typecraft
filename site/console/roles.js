/* Roles and permissions.
   GET  /api/admin/permissions        → { roles, layers, permissions: [{ key, layer, label, description, ownerOnly, sensitive,
                                           roles: { admin: { allowed, default, changed }, support: {…} } }], canEdit }
   PUT  /api/admin/permissions        { role, permission, allowed } → the same shape
   POST /api/admin/permissions/reset  { role } → the same shape
   GET  /api/admin/staff              → { staff: [{ fullName, email, role, roleLabel, active, lastAdminSignIn }], ownersWithoutAccount }
   The server decides who may change what; this page only shows switches to a Super Admin. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var grid = doc.getElementById('grid'), body = doc.getElementById('gridBody');
  var staffTable = doc.getElementById('staff'), staffBody = doc.getElementById('staffBody');
  var actions = doc.getElementById('gridActions');
  var lower = function (label) { return label.charAt(0).toLowerCase() + label.slice(1); };

  /* ---------- the grid ---------- */
  function stateIcon(on) {
    return el('span', { class: 'state ' + (on ? 'is-on' : 'is-off') }, [AC.icon(on ? 'check' : 'minus'), el('span', { class: 'vh', text: on ? 'Allowed' : 'Not allowed' })]);
  }
  function switchFor(p, role) {
    var cell = p.roles[role.key];
    var button = el('button', {
      type: 'button', class: 'switch', role: 'switch', 'aria-checked': cell.allowed ? 'true' : 'false',
      'aria-label': role.label + ': ' + p.label + (cell.changed ? ' (changed from the default)' : ''),
      'data-perm': p.key, 'data-role': role.key
    });
    button.addEventListener('click', function () { toggle(p, role, button); });
    return el('span', { class: 'switch-wrap' + (cell.changed ? ' is-changed' : ''), title: cell.changed ? 'Changed from the default' : null }, button);
  }
  function permRow(p, data) {
    var editable = data.roles.filter(function (r) { return r.editable; });
    var cells = [
      el('td', null, [el('div', { class: 'perm-label', text: p.label }), el('div', { class: 'perm-desc', text: p.description })]),
      el('td', { class: 'col-role col-owner' }, stateIcon(true))
    ];
    if (p.ownerOnly) {
      cells.push(el('td', { class: 'col-role', colspan: editable.length }, el('span', { class: 'owner-only' }, [AC.icon('lock'), 'Super Admin only'])));
    } else {
      editable.forEach(function (role) {
        cells.push(el('td', { class: 'col-role' }, data.canEdit ? switchFor(p, role) : stateIcon(p.roles[role.key].allowed)));
      });
    }
    return el('tr', null, cells);
  }
  function render(data) {
    AC.clear(body);
    data.layers.forEach(function (layer, i) {
      var rows = data.permissions.filter(function (p) { return p.layer === layer.key; });
      if (!rows.length) return;
      body.appendChild(el('tr', { class: 'group-row' }, el('th', { colspan: 4, scope: 'colgroup' },
        el('span', { class: 'group-title' }, [el('span', { class: 'keychip', 'aria-hidden': 'true', text: String(i + 1) }), layer.label]))));
      rows.forEach(function (p) { body.appendChild(permRow(p, data)); });
    });
    grid.removeAttribute('aria-busy');
    data.roles.forEach(function (role) {
      if (!role.editable) return;
      var on = data.permissions.filter(function (p) { return !p.ownerOnly && p.roles[role.key].allowed; }).length;
      var count = doc.getElementById(role.key === 'admin' ? 'countAdmin' : 'countSupport');
      if (count) count.textContent = on + ' of ' + data.permissions.length;
      var reset = actions.querySelector('[data-reset="' + role.key + '"]');
      if (reset) reset.disabled = !data.permissions.some(function (p) { return !p.ownerOnly && p.roles[role.key].changed; });
    });
    actions.hidden = !data.canEdit;
    doc.getElementById('readOnlyNote').hidden = data.canEdit;
  }
  function gridError(err) {
    AC.clear(body);
    grid.removeAttribute('aria-busy');
    body.appendChild(el('tr', null, el('td', { class: 'empty-cell', colspan: 4 }, [
      "Couldn't load the permissions. " + err.message,
      el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Try again', on: { click: loadGrid } })
    ])));
  }
  function loadGrid() {
    AC.api('GET', '/api/admin/permissions').then(function (data) { latest = data; render(data); }, gridError);
  }
  var latest = null;

  function toggle(p, role, button) {
    var want = button.getAttribute('aria-checked') !== 'true';
    var cell = p.roles[role.key];
    var ask = Promise.resolve(true);
    if (want && !cell.default) { // more than this role has by default: make sure it is meant
      ask = AC.confirm({
        title: 'Let ' + role.label + ' ' + lower(p.label) + '?',
        text: 'This is not part of the ' + role.label + ' role by default. Everyone with that role will be able to do it straight away.' +
          (p.sensitive ? ' They will be asked for their password first.' : ''),
        confirmLabel: 'Allow'
      });
    }
    ask.then(function (ok) {
      if (!ok) return;
      button.disabled = true;
      AC.api('PUT', '/api/admin/permissions', { role: role.key, permission: p.key, allowed: want }).then(function (data) {
        latest = data; render(data);
        var again = body.querySelector('[data-perm="' + p.key + '"][data-role="' + role.key + '"]');
        if (again) again.focus();
        AC.toast(role.label + (want ? ' can now ' : ' can no longer ') + lower(p.label) + '.');
      }, function (err) {
        button.disabled = false;
        if (err.code !== 'cancelled') AC.toast(err.message, 'bad');
      });
    });
  }

  Array.prototype.forEach.call(actions.querySelectorAll('[data-reset]'), function (button) {
    button.addEventListener('click', function () {
      var key = button.getAttribute('data-reset');
      var role = latest && latest.roles.filter(function (r) { return r.key === key; })[0];
      if (!role) return;
      var changed = latest.permissions.filter(function (p) { return !p.ownerOnly && p.roles[key].changed; }).length;
      AC.confirm({
        title: 'Reset ' + role.label + ' to the defaults?',
        text: (changed === 1 ? '1 switch goes' : changed + ' switches go') + ' back to the default. Everyone with the ' + role.label + ' role is affected straight away.',
        confirmLabel: 'Reset ' + role.label
      }).then(function (ok) {
        if (!ok) return;
        AC.busy(button, true);
        AC.api('POST', '/api/admin/permissions/reset', { role: key }).then(function (data) {
          AC.busy(button, false);
          latest = data; render(data);
          AC.toast(role.label + ' is back to the defaults.');
        }, function (err) {
          AC.busy(button, false);
          if (err.code !== 'cancelled') AC.toast(err.message, 'bad');
        });
      });
    });
  });

  /* ---------- people with admin access ---------- */
  function staffRow(person) {
    var last = person.lastAdminSignIn ? AC.fmt.ago(person.lastAdminSignIn) : 'Not yet';
    var roleBadge = function () { return el('span', { class: 'badge badge-role', text: person.roleLabel }); };
    var stateBadge = function () { return el('span', { class: 'badge ' + (person.active ? 'badge-ok' : 'badge-bad'), text: person.active ? 'Active' : 'Disabled' }); };
    return el('tr', null, [
      el('td', null, [
        el('div', { class: 'person-name', text: person.fullName || 'No name' }),
        el('div', { class: 'person-email', text: person.email }),
        // on a phone the other columns are folded into this one
        el('div', { class: 'person-extra' }, [roleBadge(), stateBadge(), el('span', { text: 'Last admin sign-in: ' + last.charAt(0).toLowerCase() + last.slice(1) })])
      ]),
      el('td', { class: 'col-fit' }, roleBadge()),
      el('td', { class: 'col-wide', title: person.lastAdminSignIn ? AC.fmt.dateTime(person.lastAdminSignIn) : null, text: last }),
      el('td', { class: 'col-fit' }, stateBadge())
    ]);
  }
  function loadStaff() {
    AC.api('GET', '/api/admin/staff').then(function (data) {
      AC.clear(staffBody);
      staffTable.removeAttribute('aria-busy');
      if (!data.staff.length) staffBody.appendChild(el('tr', null, el('td', { class: 'empty-cell', colspan: 4, text: 'No one has admin access yet.' })));
      data.staff.forEach(function (person) { staffBody.appendChild(staffRow(person)); });
      // an owner email nobody has registered yet is an open door: say so plainly
      doc.getElementById('ownerGapCount').textContent = data.ownersWithoutAccount === 1
        ? '1 email in OWNER_EMAILS has no TypeCraft account yet.' : data.ownersWithoutAccount + ' emails in OWNER_EMAILS have no TypeCraft account yet.';
      doc.getElementById('ownerGap').hidden = !(data.ownersWithoutAccount > 0);
    }, function (err) {
      AC.clear(staffBody);
      staffTable.removeAttribute('aria-busy');
      staffBody.appendChild(el('tr', null, el('td', { class: 'empty-cell', colspan: 4 }, [
        "Couldn't load the list. " + err.message,
        el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Try again', on: { click: loadStaff } })
      ])));
    });
  }

  loadGrid();
  loadStaff();
})();
