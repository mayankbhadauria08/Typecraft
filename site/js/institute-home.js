/* /institute. GET /api/me/institutes → { seats, staff: [{ institute: { id, name, status }, role }],
   invites: [{ id, institute: { name }, role, invitedAt }], emailVerified };
   POST /api/me/institute-invites/:id/accept → { institute: { id, name }, role }; …/decline.
   GET /api/institutes/buy → { open, … }: when seats are sold online, a way to buy them for a new institute (§15). docs/INSTITUTES.md §8. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const ROLE = { admin: 'Admin', teacher: 'Teacher' };
  const STATUS = { pending: 'Not paid yet', active: 'On', suspended: 'Paused' };

  async function answer(inv, accept, btn) {
    if (!accept) {
      const ok = await K.confirm({ title: `Decline the invitation from ${inv.institute.name}?`, text: 'They can invite you again later.', confirmLabel: 'Decline', danger: true });
      if (!ok) return;
    }
    K.busy(btn, true);
    const verb = accept ? 'accept' : 'decline';
    const res = await K.api('POST', `/api/me/institute-invites/${encodeURIComponent(inv.id)}/${verb}`, {});
    K.busy(btn, false);
    if (!res.ok) return K.toast(K.errMsg(res), 'bad');
    if (accept) { location.href = `/institute/${encodeURIComponent(res.data.institute.id)}`; return; }
    K.toast('Invitation declined.');
    load();
  }

  function invites(list, verified) {
    const sec = $('#ih-invites-sec');
    sec.hidden = !list.length;
    if (!list.length) return;
    K.mount($('#ih-invites'),
      verified ? null : K.alert('info', 'Confirm your email address to accept: open the link we emailed you when you signed up, or send it again from Settings.',
        ' ', h('a', { href: '/account/settings', text: 'Settings' })),
      h('div', { class: 'ins-cards' }, list.map((inv) => h('article', { class: 'card ins-card' },
        h('h3', { text: inv.institute.name }),
        h('p', { class: 'muted', text: `Invited as ${inv.role === 'admin' ? 'its admin' : 'a teacher'} on ${K.date(inv.invitedAt)}.` }),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Accept', disabled: !verified, onclick: (e) => answer(inv, true, e.currentTarget) }),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Decline', onclick: (e) => answer(inv, false, e.currentTarget) }))))));
  }

  function institutes(list, invited) {
    const el = $('#ih-list');
    if (!list.length) {
      return K.empty(el, { icon: 'users', title: invited ? 'Accept the invitation above' : "You don't help run an institute",
        text: invited ? 'Then your institute appears here.' : 'If your institute invited you, sign in with the email address the invitation went to. To join a batch as a student, use the code from your institute.',
        action: invited ? null : { href: '/join', label: 'Join a batch' } });
    }
    K.mount(el, h('div', { class: 'ins-cards' }, list.map((s) => h('a', { class: 'card ins-card ins-link', href: `/institute/${encodeURIComponent(s.institute.id)}` },
      h('h3', { text: s.institute.name }),
      h('p', null, K.badge(s.institute.status === 'active' ? 'active' : 'pending', STATUS[s.institute.status] || s.institute.status), ' ',
        h('span', { class: 'muted', text: ROLE[s.role] || s.role }))))));
  }

  async function load() {
    const res = await K.api('GET', `/api/me/institutes`);
    if (!res.ok) {
      if (res.error && res.error.code === 'institutes_not_ready') return K.mount($('#ih-list'), K.alert('info', "Institutes aren't switched on yet."));
      return K.error($('#ih-list'), res, load);
    }
    const d = res.data;
    // one institute and nothing to answer: go straight to it
    let stay = false;
    try { stay = !!sessionStorage.getItem('tc-ih-stay'); } catch (e) { stay = true; }
    if (d.staff.length === 1 && !d.invites.length && !stay) {
      try { sessionStorage.setItem('tc-ih-stay', '1'); } catch (e) { /* private mode */ }
      location.replace(`/institute/${encodeURIComponent(d.staff[0].institute.id)}`);
      return;
    }
    invites(d.invites, d.emailVerified);
    institutes(d.staff, d.invites.length > 0);
    const sale = await K.api('GET', '/api/institutes/buy');
    K.mount($('#ih-buy'), sale.ok && sale.data.open ? h('div', { class: 'card ins-buy-cta' },
      h('div', null, h('h2', { text: 'Run a coaching centre?' }),
        h('p', { class: 'muted', text: `Buy seats online: each gives one student the ${sale.data.packageName} plan for the term, from ${sale.data.terms.map((t) => `${K.money(t.pricePerSeatPaise)} a seat for ${t.months} months`).join(' or ')}. At least ${sale.data.minSeats} seats.` })),
      h('a', { class: 'btn btn-primary', href: '/institute/buy', text: 'Buy seats' })) : null);
  }
  load();
})();
