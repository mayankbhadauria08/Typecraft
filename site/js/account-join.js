/* /join and /join/:code. GET /api/institutes/join?code= → { code, institute:{name}, batch:{name}, plan:{name}, endsAt,
   joined, canJoin, problem:{code,message}|null }; POST /api/institutes/join { code, adult } → { joined, already, … }.
   docs/INSTITUTES.md §4. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const form = $('#joinForm'), input = $('#joinCode'), out = $('#joinResult');

  function fromUrl() {
    const m = location.pathname.match(/^\/join\/([^/]+)$/);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return ''; } }
    return K.qs('code') || '';
  }
  const clean = (v) => String(v || '').toUpperCase().replace(/[\s-]+/g, '');

  function done(d) {
    K.mount(out, h('div', { class: 'card join-card' },
      h('h2', { text: d.already ? 'You are already in this batch' : 'You have joined' }),
      h('p', null, h('strong', { text: d.batch.name }), ' at ', h('strong', { text: d.institute.name }), '.'),
      h('p', { class: 'muted', text: `Your institute's plan is on until ${K.date(d.endsAt)}.` }),
      h('div', { class: 'actions' },
        h('a', { class: 'btn btn-primary', href: '/app', text: 'Open the trainer' }),
        h('a', { class: 'btn btn-ghost', href: '/account/plans', text: 'See your plan' }))));
  }

  function preview(d) {
    if (d.joined) return done({ already: true, institute: d.institute, batch: d.batch, endsAt: d.endsAt });
    const facts = h('dl', { class: 'join-facts' },
      h('dt', { text: 'Institute' }), h('dd', { text: d.institute.name }),
      h('dt', { text: 'Batch' }), h('dd', { text: d.batch.name }),
      h('dt', { text: 'Plan' }), h('dd', { text: d.plan.name }),
      h('dt', { text: 'Until' }), h('dd', { text: K.date(d.endsAt) }));
    if (!d.canJoin) {
      return K.mount(out, h('div', { class: 'card join-card' }, facts, K.alert('info', d.problem ? d.problem.message : "You can't join this batch right now.")));
    }
    const adult = h('input', { type: 'checkbox', id: 'joinAdult', name: 'adult' });
    const btn = h('button', { type: 'submit', class: 'btn btn-primary', text: `Join ${d.batch.name}` });
    const f = h('form', { class: 'join-confirm', novalidate: true },
      h('div', { class: 'field' }, h('div', { class: 'check' }, adult, h('label', { for: 'joinAdult', text: 'I am 18 or older' }))),
      h('div', { class: 'actions' }, btn));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!adult.checked) return K.formErrors(f, { adult: 'Please confirm that you are 18 or older.' });
      K.busy(btn, true);
      const res = await K.api('POST', `/api/institutes/join`, { code: d.code, adult: true });
      K.busy(btn, false);
      if (!res.ok) return K.formFail(f, res);
      done(res.data);
    });
    K.mount(out, h('div', { class: 'card join-card' }, facts, f));
  }

  async function check(code) {
    out.textContent = '';
    if (clean(code).length !== 8) return K.formErrors(form, { code: 'The code has eight letters and numbers, like ABCD-EFGH.' });
    K.formErrors(form, null);
    const btn = $('#joinCheck');
    K.busy(btn, true);
    const res = await K.api('GET', `/api/institutes/join?code=${encodeURIComponent(clean(code))}`);
    K.busy(btn, false);
    if (!res.ok) return res.error && res.error.code === 'bad_code' ? K.formErrors(form, { code: K.errMsg(res) }) : K.mount(out, K.alert('bad', K.errMsg(res)));
    preview(res.data);
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); check(input.value); });
  const start = fromUrl();
  if (start) { input.value = start; check(start); }
})();
