/* Activity logs: who changed what, and when.
   GET /api/console/activity?q=&kind=&actor=&from=&to=&page= → { items: [{ id, action, label, kind, createdAt, actor: { id, name, email, role, roleLabel } | null,
         target, about, link, detail, ip }], page, pageSize, pages, total, kinds: [{ id, name }], actors: [{ id, name }] }
   GET /api/console/activity/export (same filters) → a spreadsheet; asks for the password again. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var form = document.getElementById('filters');

  function value(v) {
    if (v == null) return '–';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  // { from, to } pairs (a change) read as "from → to"
  function lines(detail) {
    if (detail == null) return [];
    if (typeof detail !== 'object' || Array.isArray(detail)) return [['Details', value(detail)]];
    var out = [];
    Object.keys(detail).forEach(function (k) {
      var v = detail[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && ('from' in v || 'to' in v) && Object.keys(v).length <= 2) out.push([k, value(v.from) + ' → ' + value(v.to)]);
      else if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach(function (k2) {
        var w = v[k2];
        out.push([k + ' › ' + k2, w && typeof w === 'object' && ('from' in w || 'to' in w) ? value(w.from) + ' → ' + value(w.to) : value(w)]);
      });
      else out.push([k, value(v)]);
    });
    return out;
  }
  function details(a) {
    var facts = [
      AC.fact('When', AC.fmt.dateTime(a.createdAt)),
      AC.fact(a.action === 'admin.login_failed' ? 'Account tried' : 'Who', a.actor ? a.actor.name + (a.actor.email ? ' (' + a.actor.email + ')' : '') + ' \u00b7 ' + a.actor.roleLabel : 'TypeCraft itself'),
      AC.fact('About', a.link ? el('a', { href: a.link, text: a.about }) : (a.about || '\u2013')),
      AC.fact('Action', el('span', { class: 'mono', text: a.action })),
      AC.fact('IP address', a.ip ? el('span', { class: 'mono', text: a.ip }) : 'Not kept (removed after 90 days, or never recorded)')
    ].concat(lines(a.detail).map(function (l) { return AC.fact(l[0], el('span', { class: 'pre-wrap', text: l[1] })); }));
    AC.show(a.label, [el('dl', { class: 'facts facts-stack activity-facts' }, facts)], { wide: true });
  }

  function row(a) {
    var who = a.action === 'admin.login_failed' ? [el('span', { class: 'cell-main', text: 'Someone' }), el('div', { class: 'cell-sub', text: 'trying ' + (a.actor ? a.actor.name + '\u2019s' : 'an') + ' account' })]
      : a.actor ? [el('span', { class: 'cell-main', text: a.actor.name }), el('div', { class: 'cell-sub', text: a.actor.roleLabel })]
      : [el('span', { class: 'cell-main', text: 'TypeCraft' }), el('div', { class: 'cell-sub', text: 'Payments, scheduled jobs' })];
    return el('tr', null, [
      el('td', { class: 'col-wide nowrap' }, [el('span', { title: AC.fmt.dateTime(a.createdAt), text: AC.fmt.dateTime(a.createdAt) })]),
      el('td', null, [
        el('span', { class: 'cell-main', text: a.label }),
        a.about ? el('div', { class: 'cell-sub' }, a.link ? el('a', { href: a.link, text: a.about }) : a.about) : null,
        el('div', { class: 'person-extra' }, [el('span', { text: a.actor ? a.actor.name : 'TypeCraft' }), el('span', { text: AC.fmt.dateTime(a.createdAt) })])
      ]),
      el('td', { class: 'col-wide' }, who),
      el('td', { class: 'col-fit' }, el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Details', on: { click: function () { details(a); } } }))
    ]);
  }

  AC.listPage({
    endpoint: '/api/console/activity',
    noun: ['entry', 'entries'],
    empty: 'Nothing has been recorded yet.',
    row: row,
    exportPath: '/api/console/activity/export',
    exportNote: 'It holds IP addresses: keep it private.',
    onData: function (d) {
      AC.options(form.elements.kind, d.kinds);
      AC.options(form.elements.actor, d.actors);
    }
  });
})();
