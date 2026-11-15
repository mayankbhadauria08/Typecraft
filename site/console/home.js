/* Admin console home: the setup checklist (GET /api/admin/console/setup, permission settings.view).
   The rest of the page is drawn by the server from the session. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var list = document.getElementById('setupList');
  if (!list) return; // this role can't see setup

  function row(item) {
    var title = [item.label];
    if (item.key === 'razorpay' && item.mode) title.push(el('span', { class: 'badge ' + (item.mode === 'live' ? 'badge-ok' : 'badge-warn'), text: item.mode === 'live' ? 'Live mode' : 'Test mode' }));
    return el('li', null, [
      el('span', { class: 'check-state ' + (item.ready ? 'is-ready' : 'is-waiting') }, [item.ready ? AC.icon('check') : null, el('span', { class: 'vh', text: item.ready ? 'On: ' : 'Not set up: ' })]),
      el('div', null, [
        el('div', { class: 'check-title' }, title),
        el('p', { class: 'check-detail', text: item.detail }),
        item.ready ? null : el('p', { class: 'check-setting', text: item.fix })
      ])
    ]);
  }
  function load() {
    AC.api('GET', '/api/admin/console/setup').then(function (data) {
      AC.clear(list);
      data.items.forEach(function (item) { list.appendChild(row(item)); });
      list.removeAttribute('aria-busy');
      var ready = data.items.filter(function (item) { return item.ready; }).length;
      document.getElementById('setupCount').textContent = ready + ' of ' + data.items.length + ' on';
    }, function (err) {
      AC.clear(list);
      list.removeAttribute('aria-busy');
      list.appendChild(el('li', null, [
        el('span', { class: 'check-state is-waiting' }),
        el('div', null, [
          el('p', { class: 'check-detail', text: "Couldn't load the checklist. " + err.message }),
          el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Try again', on: { click: load } })
        ])
      ]));
    });
  }
  load();
})();
