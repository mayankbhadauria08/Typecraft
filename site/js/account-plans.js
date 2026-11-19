/* /account/plans. Data: TC.me().entitlements {plan,planName,expiresAt,features,limits,subscriptions},
   GET /api/me/subscriptions {subscriptions:[{id,packageId,packageName,orderId,source,status,upcoming,startsAt,expiresAt}], entitlements},
   GET /api/packages {packages:[{id,name,description,pricePaise,validityDays,features:[{key,label}],highlight}], features:[{key,label,description}]},
   GET /api/me/institutes {seats:[{id,institute:{name},batch:{name},plan:{name},joinedAt,endsAt,givesPlan}]}, POST /api/me/institutes/:id/leave. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const SOURCE = { purchase: 'Purchased', admin: 'Granted by TypeCraft', promo: 'Promotion' };

  function limitsText(l, words) {
    if (!l) return [];
    const out = [];
    out.push(words && words.Text ? words.Text : l.lessons === 'all' ? 'All lessons' : 'First 5 lessons');
    out.push(l.dailyTests == null ? 'Unlimited typing tests' : `${l.dailyTests} typing tests a day`);
    out.push(l.historyDays == null ? 'Full history' : `${l.historyDays} days of history`);
    return out;
  }

  function current(ent) {
    const el = $('#pl-current');
    if (!ent) return K.error(el, 'We could not load your plan.', () => location.reload());
    const free = !ent.plan || ent.plan === 'free';
    const left = K.daysLeft(ent.expiresAt);
    // a plan that comes only from an institute seat is renewed by the institute, not bought here
    const seatOnly = !free && (ent.seats || []).length > 0 && !(ent.subscriptions || []).length;
    K.mount(el,
      h('p', null, h('span', { class: free ? 'badge badge-muted' : 'badge badge-brand', text: ent.planName || ent.plan || 'Free' })),
      h('p', null, free ? 'You are on the Free plan.' : ent.expiresAt ? ['Active until ', h('strong', { text: K.date(ent.expiresAt) }), left != null ? h('span', { class: 'muted', text: ` (${left} day${left === 1 ? '' : 's'} left)` }) : null] : 'Never expires.'),
      h('ul', { class: 'muted' }, limitsText(ent.limits, ent.lessonsWords).map((t) => h('li', { text: t }))),
      seatOnly ? h('p', { class: 'muted', text: `Through ${ent.seats.map((m) => m.instituteName).join(' and ')}.` }) : null,
      !free && ent.expiresAt && !seatOnly ? h('div', { class: 'card-foot' }, h('a', { class: 'btn btn-primary', href: `/checkout?plan=${encodeURIComponent(ent.plan)}`, text: `Renew ${ent.planName || ''}`.trim() })) : null);
  }

  function features(ent, catalogue) {
    const el = $('#pl-features');
    if (!catalogue.length) return K.mount(el, h('p', { class: 'muted', text: 'The feature list is not available right now.' }));
    const have = new Set((ent && ent.features) || []);
    K.mount(el, h('ul', { style: 'list-style:none;padding:0;margin:0;display:grid;gap:.5rem' }, catalogue.map((f) => {
      const ok = have.has(f.key);
      return h('li', { style: 'display:flex;gap:.6rem;align-items:flex-start' + (ok ? '' : ';opacity:.7') },
        K.icon(ok ? 'check' : 'lock'),
        h('span', null, h('span', { class: 'sr-only', text: ok ? 'Included: ' : 'Not included: ' }), h('strong', { text: f.label }), f.description ? h('br') : null, f.description ? h('span', { class: 'muted', text: f.description }) : null));
    })));
  }

  function subs(list) {
    const el = $('#pl-subs');
    if (!list.length) return K.empty(el, { icon: 'calendar', title: 'No paid periods yet', text: 'When you buy a plan, each period is listed here with its dates.', action: { href: '/pricing', label: 'Compare plans' } });
    K.mount(el, K.table([
      { label: 'Plan', value: (s) => s.packageName || s.packageId },
      { label: 'Status', value: (s) => (s.upcoming ? K.badge('pending', 'Starts later') : K.badge(s.status)) },
      { label: 'Starts', value: (s) => K.date(s.startsAt) },
      { label: 'Ends', value: (s) => (s.expiresAt ? K.date(s.expiresAt) : 'Never') },
      { label: 'How', value: (s) => SOURCE[s.source] || s.source || '—' },
    ], list.slice().sort((a, b) => (String(a.startsAt) < String(b.startsAt) ? 1 : -1)), { caption: 'Plan periods' }));
  }

  function seats(res) {
    const el = $('#pl-inst');
    if (!res.ok && res.error && res.error.code === 'institutes_not_ready') { $('#pl-inst-sec').hidden = true; return; }
    if (!res.ok) return K.error(el, res, loadSeats);
    const list = res.data.seats;
    if (!list.length) return K.mount(el, h('p', { class: 'muted' }, 'Have a code from your institute? ', h('a', { href: '/join', text: 'Join your batch' }), '.'));
    K.mount(el, h('div', { class: 'seat-list' }, list.map((m) => h('article', { class: 'card seat-item' },
      h('div', null,
        h('p', null, h('strong', { text: m.batch.name }), ' at ', h('strong', { text: m.institute.name })),
        h('p', { class: 'muted', text: m.givesPlan ? `${m.plan.name} until ${K.date(m.endsAt)}` : "The institute's plan isn't on right now. Ask your institute." })),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Leave the batch', onclick: (e) => leave(m, e.currentTarget) })))));
  }
  async function leave(m, btn) {
    const ok = await K.confirm({ title: `Leave ${m.batch.name}?`, text: `Your seat goes back to ${m.institute.name} and its plan ends for you. Your progress stays yours. To come back you need the batch code again.`,
      confirmLabel: 'Leave the batch', danger: true });
    if (!ok) return;
    K.busy(btn, true);
    const res = await K.api('POST', `/api/me/institutes/${encodeURIComponent(m.id)}/leave`, {});
    K.busy(btn, false);
    if (!res.ok) return K.toast(K.errMsg(res), 'bad');
    K.toast(`You have left ${m.batch.name}.`);
    location.reload();
  }
  async function loadSeats() { seats(await K.api('GET', '/api/me/institutes')); }

  function buy(ent, pkgs) {
    const el = $('#pl-buy');
    const paid = pkgs.filter((p) => (p.pricePaise || 0) > 0);
    if (!paid.length) return K.empty(el, { icon: 'info', title: 'Plans are not on sale right now', text: 'Please check back soon.' });
    K.mount(el, paid.map((p) => {
      // a plan that comes only from an institute seat isn't renewed here: buying adds a period of one's own
      const mine = ent && ent.plan === p.id && !((ent.seats || []).length && !(ent.subscriptions || []).length);
      return h('article', { class: p.highlight ? 'plan-card recommended card' : 'plan-card card' },
        p.highlight ? h('span', { class: 'badge badge-brand', text: 'Recommended' }) : null,
        h('h3', { text: p.name }),
        h('p', { class: 'price' }, h('span', { class: 'mono', text: K.money(p.pricePaise, p.currency) }), h('span', { class: 'muted', text: ` · ${K.validity(p.validityDays)}` })),
        h('p', { class: 'muted', text: p.description || '' }),
        h('a', { class: mine || p.highlight ? 'btn btn-primary btn-block' : 'btn btn-ghost btn-block', href: `/checkout?plan=${encodeURIComponent(p.id)}`,
          text: mine ? (p.validityDays == null ? 'You own this' : 'Renew') : `Buy ${p.name}` }));
    }));
    K.$$('a', el).forEach((a) => { if (a.textContent === 'You own this') { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.className = 'btn btn-ghost btn-block'; } });
  }

  async function load() {
    const [me, subsRes, pkgRes] = await Promise.all([K.me(), K.api('GET', '/api/me/subscriptions'), K.api('GET', '/api/packages')]);
    const ent = subsRes.ok ? subsRes.data.entitlements : me && me.entitlements;
    current(ent);
    const pkgs = pkgRes.ok ? pkgRes.data.packages : [];
    const catalogue = pkgRes.ok ? pkgRes.data.features : [];
    features(ent, catalogue);
    if (subsRes.ok) subs(subsRes.data.subscriptions);
    else K.error($('#pl-subs'), subsRes, load);
    if (pkgRes.ok) buy(ent, pkgs); else K.error($('#pl-buy'), pkgRes, load);
    loadSeats();
  }
  load();
})();
