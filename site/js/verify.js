/* /verify and /verify/:code: checks a certificate code with GET /api/certificates/:code
   → { certificate: { kind, title, test, wpm, accuracy, seconds, at, code, holder, institute, checkedAt, … } } (institute: where the holder
   had a seat when they earned it, or null; docs/INSTITUTES.md §9) */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = (id) => document.getElementById(id);
  const form = $('verifyForm'), input = $('verifyCode'), out = $('verifyResult'), btn = $('verifyBtn');
  const clean = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const show = (c) => (c.length === 12 ? c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8) : c);

  async function check(code, push) {
    const c = clean(code);
    if (c.length !== 12) {
      K.mount(out, K.alert('bad', 'A certificate code has 12 letters and numbers, like ABCD-EFGH-JKLM.'));
      input.focus(); return;
    }
    input.value = show(c);
    if (push) history.replaceState(null, '', '/verify/' + show(c));
    K.busy(btn, true); K.skeleton(out, 3);
    const res = await K.api('GET', `/api/certificates/${encodeURIComponent(show(c))}`);
    K.busy(btn, false);
    if (!res.ok) {
      K.mount(out, K.alert(res.status === 404 ? 'bad' : 'info', K.errMsg(res, "We couldn't check the code just now. Please try again.")));
      return;
    }
    const x = res.data.certificate;
    const pic = h('div', { class: 'verify-pic' });
    if (window.TC_REWARDS_UI) K.append(pic, [K.svg(TC_REWARDS_UI.certificate({ name: x.holder, wpm: x.wpm, accuracy: x.accuracy, seconds: x.seconds, date: x.at, code: x.code, verifyAt: location.host + '/verify', institute: x.institute }))]);
    const rows = [
      ['Holder', x.holder],
      ['Result', x.title + (x.kind === 'exam' ? ', ' + x.mistakesPct + '% mistakes' : ', ' + x.accuracy + '% accuracy')],
      ['Test', x.test],
      x.institute ? ['Institute', `Earned while at ${x.institute}`] : null,
      ['Date', K.date(x.at)],
      ['Code', x.code],
    ];
    K.mount(out, h('article', { class: 'card verify-card', 'aria-labelledby': 'verifyOk' },
      h('div', { class: 'alert alert-ok', role: 'status' }, h('span', { id: 'verifyOk', text: 'This is a genuine TypeCraft certificate.' })),
      pic,
      h('dl', { class: 'ex-facts' }, rows.filter(Boolean).map(([k, v]) => h('div', null, h('dt', { text: k }), h('dd', { text: v })))),
      h('p', { class: 'muted', text: 'Checked ' + K.dateTime(x.checkedAt) + '. The test was taken online, without supervision.' })));
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); check(input.value, true); });
  const m = location.pathname.match(/^\/verify\/([^/]+)$/);
  if (m) { let v = ''; try { v = decodeURIComponent(m[1]); } catch (err) { v = ''; } check(v, false); }
})();
