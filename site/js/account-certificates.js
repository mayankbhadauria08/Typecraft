/* /account/certificates. GET /api/me/certificates → { ready, certificates: [{ kind, level?, id?, title, test, wpm, accuracy,
   seconds, at, code, shared, mistakesPct? }] }; PUT /api/me/certificates/:code { shared }.
   Printing needs the 'certificates' feature (as in the app); the code and link work on every plan. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const list = $('#cert-list');
  let me = null;
  const verifyUrl = (code) => location.origin + '/verify/' + code;

  function picture(c) {
    const box = h('div', { class: 'cert-pic' });
    const data = { name: (me && me.user && me.user.fullName) || '', wpm: c.wpm, accuracy: c.accuracy, seconds: c.seconds, date: c.at,
      code: c.code && c.shared ? c.code : null, verifyAt: location.host + '/verify' };
    if (window.TC_REWARDS_UI) K.append(box, [K.svg(TC_REWARDS_UI.certificate(data))]);
    return { box, data };
  }
  function item(c) {
    const { box, data } = picture(c);
    const canPrint = me && me.entitlements && K.has(me.entitlements, 'certificates');
    const actions = [];
    if (c.code && c.shared) {
      actions.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Copy the link', onclick: () => {
        (navigator.clipboard ? navigator.clipboard.writeText(verifyUrl(c.code)) : Promise.reject()).then(() => K.toast('Link copied.'), () => K.toast('Select the link and copy it.', 'bad'));
      } }));
    }
    actions.push(canPrint ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Print', onclick: () => TC_REWARDS_UI.printCertificate(data) })
      : h('a', { class: 'btn btn-ghost btn-sm', href: '/pricing', text: 'Printing: see plans' }));
    if (c.code) {
      actions.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: c.shared ? 'Stop sharing' : 'Share again', onclick: (e) => toggle(c, e.currentTarget) }));
    }
    return h('article', { class: 'card cert-item' },
      box,
      h('div', { class: 'cert-text' },
        h('h2', { class: 'cert-title', text: c.title }),
        h('p', { class: 'muted', text: c.test + ' · ' + K.date(c.at) + (c.kind === 'exam' ? ' · ' + c.mistakesPct + '% mistakes' : ' · ' + c.accuracy + '% accuracy') }),
        c.code ? h('p', null, 'Code ', h('b', { class: 'mono', text: c.code }), ' ', h('span', { class: 'badge ' + (c.shared ? 'badge-ok' : 'badge-muted'), text: c.shared ? 'Can be checked' : 'Not shared' }))
          : h('p', { class: 'muted', text: 'Codes are not switched on yet.' }),
        c.code && c.shared ? h('p', { class: 'muted cert-link' }, h('a', { href: verifyUrl(c.code), text: verifyUrl(c.code) })) : null,
        h('div', { class: 'actions' }, actions)));
  }
  async function toggle(c, btn) {
    K.busy(btn, true);
    const res = await K.api('PUT', `/api/me/certificates/${encodeURIComponent(c.code)}`, { shared: !c.shared });
    K.busy(btn, false);
    if (!res.ok) return K.toast(K.errMsg(res), 'bad');
    K.toast(res.data.shared ? 'The code can be checked again.' : "The code can't be checked any more.");
    load();
  }
  async function load() {
    me = await K.me();
    const res = await K.api('GET', '/api/me/certificates');
    if (!res.ok) return K.error(list, res, load);
    const certs = res.data.certificates;
    K.mount($('#cert-note'), res.data.ready ? null : K.alert('info', "Certificate codes aren't switched on yet. Your certificates are shown without them."));
    if (!certs.length) {
      return K.empty(list, { icon: 'certificate', title: 'No certificates yet',
        text: 'Earn one in the course with a timed test of a minute or longer at 95% accuracy or better, or meet the goal of an exam practice test.',
        action: { href: '/exam-practice', label: 'Try exam practice' } });
    }
    K.mount(list, h('div', { class: 'cert-list' }, certs.map(item)));
  }
  load();
})();
