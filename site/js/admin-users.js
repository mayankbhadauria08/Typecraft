/* /admin/users. Data: GET /api/admin/users?q&page → {users:[{id, fullName, email, emailVerified, status, plan|planName, role, createdAt, lastLoginAt}], page, pages, total};
   GET /api/admin/users/:id → {user:{…, status, role}, entitlements?, subscriptions:[{id, packageId, packageName, status, startsAt, expiresAt, source}],
   orders:[{id, packageName, amountPaise, status, createdAt, razorpayPaymentId}]}; POST /api/admin/users/:id {status?, grant:{packageId, days?}?, revoke?, role?};
   GET /api/admin/packages for the grant list. TC.me().role decides what is shown (support: read-only; owner: roles). */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const P = (o, ...k) => K.pick(o, ...k);
  const drawer = $('#au-drawer');
  let role = null, page = 1, q = '', packages = null;
  const canWrite = () => role === 'owner' || role === 'admin';

  async function list() {
    const el = $('#au-list');
    K.skeleton(el, 6);
    const res = await K.api('GET', `/api/admin/users?q=${encodeURIComponent(q)}&page=${page}`);
    if (!res.ok) return K.error(el, res, list);
    const users = K.list(res.data, 'users', 'items');
    if (!users.length) { K.pager($('#au-pager'), { page: 1, pages: 1, onPage() {} }); return K.empty(el, { icon: 'search', title: q ? 'No users match' : 'No users yet', text: q ? 'Try part of the email or name.' : null }); }
    K.mount(el,
      res.data.total != null ? h('p', { class: 'muted', text: `${K.num(res.data.total)} user${res.data.total === 1 ? '' : 's'}${q ? ` matching “${q}”` : ''}` }) : null,
      K.table([
        { label: 'Name', value: (u) => [h('strong', { text: P(u, 'fullName', 'full_name') || '—' }), P(u, 'role') ? [' ', K.badge('new', P(u, 'role'))] : null] },
        { label: 'Email', value: (u) => [u.email, u.emailVerified === false ? [' ', K.badge('pending', 'unverified')] : null] },
        { label: 'Plan', value: (u) => P(u, 'planName', 'plan') || 'Free' },
        { label: 'Status', value: (u) => K.badge(u.status === 'disabled' ? 'disabled' : 'active', u.status === 'disabled' ? 'Disabled' : 'Active') },
        { label: 'Joined', value: (u) => K.date(P(u, 'createdAt', 'created_at')) },
      ], users, { caption: 'Users', onRow: (u) => open(u.id) }));
    K.pager($('#au-pager'), { page: res.data.page || page, pages: res.data.pages || 1, onPage: (p) => { page = p; list(); } });
  }

  async function act(id, body, done) {
    const res = await K.api('POST', `/api/admin/users/${encodeURIComponent(id)}`, body);
    if (!res.ok) { K.toast(K.errMsg(res), 'bad'); return false; }
    K.toast(done, 'ok');
    open(id);
    list();
    return true;
  }

  async function grantForm(u) {
    if (!packages) {
      const res = await K.api('GET', '/api/admin/packages');
      packages = res.ok ? K.list(res.data, 'packages').filter((p) => p.id !== 'free') : [];
    }
    const sel = h('select', { id: 'au-g-pkg', name: 'packageId' }, packages.map((p) => h('option', { value: p.id, text: `${p.name} (${K.validity(P(p, 'validityDays', 'validity_days'))})` })));
    const days = h('input', { id: 'au-g-days', name: 'days', type: 'number', min: 1, max: 3650, placeholder: 'Package default', inputmode: 'numeric' });
    const btn = h('button', { type: 'submit', class: 'btn btn-primary btn-sm', text: 'Grant…' });
    const form = h('form', { class: 'card', novalidate: true },
      h('h3', { text: 'Grant a plan' }),
      h('p', { class: 'muted', text: 'For support cases and promotions. No payment is recorded. It stacks after any active period.' }),
      h('div', { class: 'field' }, h('label', { for: 'au-g-pkg', text: 'Package' }), sel),
      h('div', { class: 'field' }, h('label', { for: 'au-g-days', text: 'Days (optional)' }), days, h('p', { class: 'hint', text: 'Leave empty to use the package validity.' })),
      btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pkg = packages.find((p) => p.id === sel.value);
      if (!pkg) return;
      const d = days.value ? Math.round(Number(days.value)) : null;
      if (days.value && !(d >= 1 && d <= 3650)) return K.toast('Days must be between 1 and 3650.', 'bad');
      const ok = await K.confirm({ title: `Grant ${pkg.name} to ${u.email}?`, text: `${d ? `${d} days` : K.validity(P(pkg, 'validityDays', 'validity_days'))} of ${pkg.name}, free of charge. This is recorded in the audit log.`, confirmLabel: 'Grant plan' });
      if (!ok) return;
      K.busy(btn, true);
      await act(u.id, { grant: d ? { packageId: pkg.id, days: d } : { packageId: pkg.id } }, `${pkg.name} granted.`);
      K.busy(btn, false);
    });
    return form;
  }

  async function open(id) {
    const body = $('#au-d-body');
    if (!drawer.open) { if (drawer.showModal) drawer.showModal(); else drawer.setAttribute('open', ''); }
    K.skeleton(body, 8);
    const res = await K.api('GET', `/api/admin/users/${encodeURIComponent(id)}`);
    if (!res.ok) return K.error(body, res, () => open(id));
    const u = res.data.user || {};
    const subs = K.list(res.data, 'subscriptions');
    const orders = K.list(res.data, 'orders');
    const ent = res.data.entitlements;
    const urole = P(res.data, 'role') ?? u.role ?? null;
    const disabled = u.status === 'disabled';
    $('#au-d-title').textContent = P(u, 'fullName', 'full_name') || u.email || 'User';
    const kids = [
      h('dl', { class: 'adm-dl' },
        h('dt', { text: 'Email' }), h('dd', null, u.email, ' ', u.emailVerified ? K.badge('active', 'verified') : K.badge('pending', 'unverified')),
        h('dt', { text: 'Phone' }), h('dd', { text: P(u, 'phoneNumber', 'phone_number') || '—' }),
        h('dt', { text: 'Status' }), h('dd', null, K.badge(disabled ? 'disabled' : 'active', disabled ? 'Disabled' : 'Active')),
        h('dt', { text: 'Role' }), h('dd', { text: urole || 'Learner' }),
        h('dt', { text: 'Plan' }), h('dd', { text: ent ? `${ent.planName || ent.plan}${ent.expiresAt ? ` until ${K.date(ent.expiresAt)}` : ''}` : P(u, 'planName', 'plan') || '—' }),
        h('dt', { text: 'Joined' }), h('dd', { text: K.dateTime(P(u, 'createdAt', 'created_at')) }),
        h('dt', { text: 'Last sign-in' }), h('dd', { text: K.dateTime(P(u, 'lastLoginAt', 'last_login_at')) }),
        h('dt', { text: 'User id' }), h('dd', { class: 'mono', text: u.id || id })),
      h('h3', { text: 'Plan periods' }),
      subs.length ? K.table([
        { label: 'Plan', value: (s) => P(s, 'packageName', 'packageId') },
        { label: 'Status', value: (s) => K.badge(s.status) },
        { label: 'Dates', value: (s) => `${K.date(s.startsAt)} – ${s.expiresAt ? K.date(s.expiresAt) : 'never'}` },
        { label: 'Source', value: (s) => s.source || '—' },
        { label: '', value: (s) => (canWrite() && s.status === 'active' ? h('button', { type: 'button', class: 'btn btn-danger btn-sm', text: 'Revoke…', onclick: async (e) => {
          const ok = await K.confirm({ title: 'Revoke this plan period?', danger: true, confirmLabel: 'Revoke', text: `${P(s, 'packageName', 'packageId')} (${K.date(s.startsAt)} – ${s.expiresAt ? K.date(s.expiresAt) : 'never'}) stops now. This does not refund any payment; refund it from Payments if needed.` });
          if (!ok) return;
          K.busy(e.target, true);
          await act(u.id || id, { revoke: s.id }, 'Plan period revoked.');
        } }) : null) },
      ], subs) : h('p', { class: 'muted', text: 'No plan periods. On Free.' }),
      h('h3', { text: 'Orders' }),
      orders.length ? K.table([
        { label: 'Date', value: (o) => K.date(P(o, 'createdAt', 'created_at')) },
        { label: 'Plan', value: (o) => P(o, 'packageName', 'packageId') },
        { label: 'Amount', num: true, value: (o) => K.money(P(o, 'amountPaise', 'amount_paise'), o.currency) },
        { label: 'Status', value: (o) => K.badge(o.status) },
        { label: 'Payment', value: (o) => h('a', { class: 'mono', href: `/admin/payments?q=${encodeURIComponent(P(o, 'razorpayPaymentId', 'id') || '')}`, text: P(o, 'razorpayPaymentId', 'id') || '—' }) },
      ], orders) : h('p', { class: 'muted', text: 'No orders.' }),
    ];
    if (canWrite()) {
      kids.push(await grantForm(u.id ? u : { ...u, id }));
      const toggle = h('button', { type: 'button', class: disabled ? 'btn btn-primary btn-sm' : 'btn btn-danger btn-sm', text: disabled ? 'Enable account…' : 'Disable account…' });
      toggle.addEventListener('click', async () => {
        const ok = await K.confirm(disabled
          ? { title: 'Enable this account?', text: `${u.email} can sign in again.`, confirmLabel: 'Enable' }
          : { title: 'Disable this account?', danger: true, confirmLabel: 'Disable', text: `${u.email} is signed out everywhere and cannot sign in until enabled again. Their data and plans are kept.` });
        if (!ok) return;
        K.busy(toggle, true);
        await act(u.id || id, { status: disabled ? 'active' : 'disabled' }, disabled ? 'Account enabled.' : 'Account disabled.');
      });
      kids.push(h('div', { class: 'card section' }, h('h3', { text: 'Account access' }), toggle));
    }
    if (role === 'owner') {
      const sel = h('select', { id: 'au-role', name: 'role' },
        [['', 'Learner (no admin access)'], ['support', 'Support (read-only, replies)'], ['admin', 'Admin (everything but roles)'], ['owner', 'Owner']].map(([v, t]) => h('option', { value: v, text: t, selected: (urole || '') === v })));
      const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Change role…' });
      btn.addEventListener('click', async () => {
        const v = sel.value || null;
        if ((urole || null) === v) return K.toast('That is already their role.', 'info');
        const ok = await K.confirm({ title: 'Change role?', danger: v === 'owner' || v === 'admin', confirmLabel: 'Change role', typeToConfirm: v === 'owner' ? 'OWNER' : null,
          text: `${u.email} becomes: ${sel.options[sel.selectedIndex].text}.` });
        if (!ok) return;
        K.busy(btn, true);
        await act(u.id || id, { role: v }, 'Role changed.');
      });
      kids.push(h('div', { class: 'card section' }, h('h3', { text: 'Role' }), h('div', { class: 'field' }, h('label', { for: 'au-role', text: 'Admin role' }), sel), btn));
    }
    K.mount(body, kids);
  }

  $('#au-d-close').addEventListener('click', () => drawer.close());
  drawer.addEventListener('click', (e) => { if (e.target === drawer) drawer.close(); });
  $('#au-search').addEventListener('submit', (e) => { e.preventDefault(); q = $('#au-q').value.trim(); page = 1; list(); });
  q = K.qs('q') || ''; $('#au-q').value = q;
  K.me().then((me) => { role = me && me.role; list(); const id = K.qs('id'); if (id) open(id); });
})();
