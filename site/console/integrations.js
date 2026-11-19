/* Integrations: the outside services and whether each is connected.
   GET /api/console/integrations → { items: [{ key, name, what, status: 'ok' | 'warn' | 'off' | 'info', statusLabel,
     facts: [{ label, value, time }], fix, link: { label, href } | null }] }  Secret values are never sent, only whether each is set. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var box = document.getElementById('intList');
  var KIND = { ok: 'ok', warn: 'warn', off: 'bad', info: '' };

  function value(f) {
    if (f.time) return f.value ? el('span', { title: AC.fmt.dateTime(f.value), text: AC.fmt.ago(f.value) }) : 'Never';
    return f.value == null || f.value === '' ? '–' : String(f.value);
  }
  function card(item) {
    return el('section', { class: 'panel int-card', 'aria-labelledby': 'int-' + item.key }, [
      el('div', { class: 'panel-head' }, [el('h2', { id: 'int-' + item.key, text: item.name }), AC.badge(item.statusLabel, KIND[item.status])]),
      el('p', { class: 'panel-sub', text: item.what }),
      el('dl', { class: 'facts' }, item.facts.map(function (f) { return AC.fact(f.label, value(f)); })),
      item.fix ? el('div', { class: 'notice ' + (item.status === 'off' ? 'notice-warn' : 'notice-quiet') }, [AC.icon(item.status === 'off' ? 'alert' : 'info'), el('div', null, el('p', { text: item.fix }))]) : null,
      item.link ? el('p', null, el('a', { href: item.link.href, target: '_blank', rel: 'noopener noreferrer', class: 'btn-link' }, [el('span', { text: item.link.label }), AC.icon('external')])) : null
    ]);
  }
  function load() {
    AC.api('GET', '/api/console/integrations').then(function (d) {
      AC.clear(box); box.removeAttribute('aria-busy');
      d.items.forEach(function (item) { box.appendChild(card(item)); });
    }, function (err) {
      AC.clear(box); box.removeAttribute('aria-busy');
      box.appendChild(el('section', { class: 'panel' }, [AC.quiet("Couldn't load the integrations. " + err.message),
        el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Try again', on: { click: load } })]));
    });
  }
  load();
})();
