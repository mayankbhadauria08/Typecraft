/* /admin/settings (owner/admin). Data: GET /api/admin/settings → {settings:{seller:{name, legalName, address, email, phone, gstin},
   support:{email, hours, replyDays}, payments:{enabled}, signups:{open}}, paymentsConfigured, webhookConfigured, paymentsMode: 'test'|'live'|null};
   PUT /api/admin/settings {seller, support, payments, signups} → {settings}. Test or live follows the Razorpay key. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const form = $('#as-form');
  let loaded = null, role = null, configured = { payments: true, webhook: true, mode: null };
  const canWrite = () => role === 'owner' || role === 'admin';

  function legend(t) { return h('legend', { class: 'card-head' }, h('h2', { text: t })); }
  function input(name, label, value, opts = {}) {
    const id = `as-${name.replace('.', '-')}`;
    const el = opts.textarea ? h('textarea', { id, name, rows: 3, maxlength: opts.max || 300, value: value ?? '' })
      : h('input', { id, name, type: opts.type || 'text', value: value ?? '', maxlength: opts.max || 200, required: opts.required, min: opts.min, autocomplete: 'off' });
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), el, opts.hint ? h('p', { class: 'hint', text: opts.hint }) : null);
  }
  function check(name, label, checked, hint) {
    const id = `as-${name.replace('.', '-')}`;
    return h('div', { class: 'check' }, h('input', { type: 'checkbox', id, name, checked: !!checked }), h('label', { for: id }, h('span', { text: label }), hint ? [h('br'), h('span', { class: 'hint muted', text: hint })] : null));
  }

  function render(s) {
    const sel = s.seller || {}, sup = s.support || {}, pay = s.payments || {}, sig = s.signups || {};
    const placeholder = /\[Your /.test(`${sel.legalName} ${sel.address}`);
    K.mount($('#as-alert'), placeholder ? K.alert('bad', 'The seller name and address still hold placeholders. Fill them in before taking real payments: they are printed on every invoice and on the legal pages.') : null);
    K.mount($('#as-seller'), legend('Seller (on invoices)'),
      input('seller.name', 'Trading name', sel.name, { required: true }),
      input('seller.legalName', 'Legal name', sel.legalName, { required: true, hint: 'e.g. your full name (sole proprietor) or the company name.' }),
      input('seller.address', 'Address', sel.address, { textarea: true }),
      input('seller.email', 'Billing email', sel.email, { type: 'email', required: true }),
      input('seller.phone', 'Phone (optional)', sel.phone, { type: 'tel' }),
      input('seller.gstin', 'GSTIN (optional)', sel.gstin, { max: 15, hint: 'Leave empty if not registered for GST. Invoices then say no GST is charged.' }));
    K.mount($('#as-support'), legend('Support'),
      input('support.email', 'Support email', sup.email, { type: 'email', required: true }),
      input('support.hours', 'Support hours', sup.hours, { hint: 'Shown on the contact page, e.g. Mon–Sat, 10:00–18:00 IST.' }),
      input('support.replyDays', 'Reply within (working days)', sup.replyDays, { type: 'number', min: 1 }));
    K.mount($('#as-payments'), legend('Payments'),
      h('p', null, 'Mode: ', configured.mode === 'live' ? K.badge('active', 'Live') : configured.mode === 'test' ? K.badge('pending', 'Test mode') : K.badge('failed', 'No key'), ' ',
        configured.payments ? null : K.badge('failed', 'Razorpay keys missing'), ' ',
        configured.webhook ? null : K.badge('pending', 'Webhook secret missing')),
      h('p', { class: 'muted', text: configured.mode === 'live' ? 'Live: real payments are being taken.' : 'Test mode follows the Razorpay key installed in Cloudflare (rzp_test_… or rzp_live_…): no real money moves until a live key is installed.' }),
      check('payments.enabled', 'Accept payments', pay.enabled !== false, 'When off, checkout shows “payments paused” and nobody is charged. Existing plans keep working.'));
    K.mount($('#as-signups'), legend('Sign-ups'),
      check('signups.open', 'New sign-ups open', sig.open !== false, 'When closed, nobody can create an account (the sign-up form says sign-ups are paused). Existing users can still sign in.'));
    if (!canWrite()) K.$$('input,textarea', form).forEach((i) => { i.disabled = true; });
    $('#as-save').disabled = !canWrite();
  }

  function values() {
    const v = (n) => form.elements[n].value.trim();
    return {
      seller: { name: v('seller.name'), legalName: v('seller.legalName'), address: v('seller.address'), email: v('seller.email'), phone: v('seller.phone'), gstin: v('seller.gstin').toUpperCase() || null },
      support: { email: v('support.email'), hours: v('support.hours'), replyDays: Number(v('support.replyDays')) || 2 },
      payments: { enabled: form.elements['payments.enabled'].checked },
      signups: { open: form.elements['signups.open'].checked },
    };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!loaded || !canWrite()) return;
    K.formErrors(form, null);
    const s = values();
    const f = {};
    if (!s.seller.name) f['seller.name'] = 'Required.';
    if (!s.seller.legalName) f['seller.legalName'] = 'Required for invoices.';
    if (!/^\S+@\S+\.\S+$/.test(s.seller.email)) f['seller.email'] = 'Enter a valid email.';
    if (!/^\S+@\S+\.\S+$/.test(s.support.email)) f['support.email'] = 'Enter a valid email.';
    if (s.seller.gstin && !/^[0-9A-Z]{15}$/i.test(s.seller.gstin)) f['seller.gstin'] = 'A GSTIN has 15 letters and digits.';
    if (Object.keys(f).length) return K.formErrors(form, f);
    const warn = [];
    if ((loaded.payments || {}).enabled !== false && !s.payments.enabled) warn.push('Payments will be paused: nobody can buy a plan.');
    if ((loaded.signups || {}).open !== false && !s.signups.open) warn.push('Sign-ups will close: new people cannot create accounts.');
    const ok = await K.confirm({ title: 'Save settings?', danger: warn.length > 0, confirmLabel: 'Save settings',
      text: `${warn.join(' ')}${warn.length ? ' ' : ''}Seller details apply to invoices issued from now on; existing invoices keep the details they were issued with.` });
    if (!ok) return;
    const btn = $('#as-save');
    K.busy(btn, true);
    const res = await K.api('PUT', '/api/admin/settings', s);
    K.busy(btn, false);
    if (!res.ok) return K.formFail(form, res);
    loaded = res.data.settings;
    render(loaded);
    K.toast('Settings saved.', 'ok');
  });

  async function load() {
    const [res, r] = await Promise.all([K.api('GET', '/api/admin/settings'), K.role()]);
    role = r;
    if (!res.ok) return K.error($('#as-alert'), res, load);
    loaded = res.data.settings;
    configured = { payments: res.data.paymentsConfigured, webhook: res.data.webhookConfigured, mode: res.data.paymentsMode || null };
    render(loaded);
  }
  load();
})();
