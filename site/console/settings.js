/* Settings: business details, support contact, payments and sign-ups.
   GET /api/console/settings → { settings: { seller, support, payments: { enabled }, signups: { open } }, changed: { seller: { at, by } | null, … },
     incomplete, payments: { configured, mode, webhook }, campaigns: { dailyCap }, can: { manage, campaignLimit } }
   PUT /api/console/settings/:section  the section's fields → the same, with { saved, message }. Asks for the password again. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var page = document.getElementById('settingsPage');
  var data = null;

  function shown(v) { return v ? v : '–'; }
  function changedLine(c) {
    return c ? el('p', { class: 'hint', text: 'Last changed ' + (c.by ? 'by ' + c.by + ', ' : '') + AC.fmt.dateTime(c.at) + '.' }) : null;
  }
  function editButton(label, onClick) {
    return el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: label, on: { click: onClick } });
  }
  function tools(id, nodes) {
    var box = AC.clear(document.getElementById(id + 'Tools'));
    (nodes || []).forEach(function (n) { if (n) box.appendChild(n); });
  }
  function save(section, body) {
    return AC.api('PUT', '/api/console/settings/' + section, body).then(function (res) {
      data = res; render(); AC.toast(res.message); return res;
    });
  }

  /* ---------- business details ---------- */
  function editSeller() {
    var s = data.settings.seller;
    AC.formDialog({
      title: 'Business details',
      text: 'Printed on every new invoice and on the legal pages. Invoices already issued keep the details they were issued with.',
      submitLabel: 'Save',
      fields: [
        { name: 'name', label: 'Trading name', value: s.name || '', maxlength: 120, required: true, placeholder: 'TypeCraft' },
        { name: 'legalName', label: 'Legal name', value: s.legalName || '', maxlength: 200, required: true, hint: 'Your full name if you are a sole proprietor, or the company name.' },
        { name: 'address', label: 'Address', type: 'textarea', rows: 3, value: s.address || '', maxlength: 300 },
        { name: 'email', label: 'Billing email', type: 'email', value: s.email || '', maxlength: 200, required: true },
        { name: 'phone', label: 'Phone (optional)', value: s.phone || '', maxlength: 30 },
        { name: 'gstin', label: 'GSTIN (optional)', value: s.gstin || '', maxlength: 15, hint: 'Leave empty if you are not registered for GST. Invoices then say that no GST is charged.' }
      ],
      submit: function (v) { return save('seller', { name: v.name, legalName: v.legalName, address: v.address, email: v.email, phone: v.phone, gstin: v.gstin || null }); }
    });
  }
  function sellerBlock() {
    var s = data.settings.seller;
    AC.fill('sellerBody', [
      data.incomplete ? AC.notice('The legal name, address or billing email still needs filling in. These are printed on every invoice and on the legal pages, so fill them in before taking real payments.', 'warn') : null,
      el('dl', { class: 'facts' }, [
        AC.fact('Trading name', shown(s.name)), AC.fact('Legal name', shown(s.legalName)),
        AC.fact('Address', el('span', { class: 'pre-wrap', text: shown(s.address) })), AC.fact('Billing email', shown(s.email)),
        AC.fact('Phone', shown(s.phone)), AC.fact('GSTIN', s.gstin ? el('span', { class: 'mono', text: s.gstin }) : 'Not registered (no GST charged)')
      ]),
      changedLine(data.changed.seller)
    ]);
    tools('seller', [data.can.manage ? editButton('Change', editSeller) : null]);
  }

  /* ---------- support contact ---------- */
  function editSupport() {
    var s = data.settings.support;
    AC.formDialog({
      title: 'Support contact',
      text: 'Replies to every email go to this address, and the contact page shows it with the hours.',
      submitLabel: 'Save',
      fields: [
        { name: 'email', label: 'Support email', type: 'email', value: s.email || '', maxlength: 200, required: true },
        { name: 'hours', label: 'Support hours (optional)', value: s.hours || '', maxlength: 200, placeholder: 'Mon to Sat, 10 am to 6 pm India time' },
        { name: 'replyDays', label: 'We reply within (working days)', type: 'number', value: s.replyDays == null ? 2 : s.replyDays, min: 0, max: 30, required: true }
      ],
      submit: function (v) { return save('support', { email: v.email, hours: v.hours, replyDays: v.replyDays }); }
    });
  }
  function supportBlock() {
    var s = data.settings.support;
    AC.fill('supportBody', [
      el('dl', { class: 'facts' }, [
        AC.fact('Support email', shown(s.email)), AC.fact('Hours', shown(s.hours)),
        AC.fact('Reply within', s.replyDays == null ? '–' : s.replyDays + (s.replyDays === 1 ? ' working day' : ' working days'))
      ]),
      changedLine(data.changed.support)
    ]);
    tools('support', [data.can.manage ? editButton('Change', editSupport) : null]);
  }

  /* ---------- the two switches ---------- */
  function flip(section, body, opts) {
    return function (e) {
      var button = e.currentTarget;
      AC.confirm(opts).then(function (ok) {
        if (!ok) return;
        AC.busy(button, true);
        save(section, body).catch(function (err) { AC.busy(button, false); if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
      });
    };
  }
  function paymentsBlock() {
    var on = data.settings.payments.enabled !== false, p = data.payments;
    AC.fill('paymentsBody', [
      el('dl', { class: 'facts' }, [
        AC.fact('Taking payments', on ? AC.badge('On', 'ok') : AC.badge('Paused', 'warn')),
        AC.fact('Razorpay', !p.configured ? AC.badge('Keys not installed', 'bad') : p.mode === 'live' ? AC.badge('Live: real money', 'ok') : AC.badge('Test mode: no real money', 'warn')),
        AC.fact('Webhook', p.webhook ? 'Installed' : AC.badge('Not installed', 'warn'))
      ]),
      el('p', { class: 'hint', text: 'Test or live follows the Razorpay key installed in Cloudflare (rzp_test_… or rzp_live_…). Pausing stops new purchases only: plans already bought keep working.' }),
      changedLine(data.changed.payments)
    ]);
    tools('payments', [data.can.manage ? editButton(on ? 'Pause payments' : 'Turn payments on', on
      ? flip('payments', { enabled: false }, { title: 'Pause payments?', text: 'Checkout will say payments are paused and nobody can buy a plan or institute seats until you turn them back on. Plans already bought keep working.', confirmLabel: 'Pause payments', danger: true })
      : flip('payments', { enabled: true }, { title: 'Turn payments on?', text: p.mode === 'live' ? 'Customers can buy plans again, with real money.' : 'Customers can buy plans again. Razorpay is in test mode, so no real money moves.', confirmLabel: 'Turn payments on' })) : null]);
  }
  function signupsBlock() {
    var open = data.settings.signups.open !== false;
    AC.fill('signupsBody', [
      el('dl', { class: 'facts' }, [AC.fact('New accounts', open ? AC.badge('Open', 'ok') : AC.badge('Closed', 'warn'))]),
      el('p', { class: 'hint', text: open ? 'Anyone can create an account.' : 'Nobody can create an account, including people invited to an institute. Everyone who has one can still sign in.' }),
      changedLine(data.changed.signups)
    ]);
    tools('signups', [data.can.manage ? editButton(open ? 'Close sign-ups' : 'Open sign-ups', open
      ? flip('signups', { open: false }, { title: 'Close sign-ups?', text: 'The sign-up form will say new accounts can’t be created right now. People invited to an institute can’t create accounts either. Everyone who has an account can still sign in.', confirmLabel: 'Close sign-ups', danger: true })
      : flip('signups', { open: true }, { title: 'Open sign-ups?', text: 'Anyone will be able to create an account again.', confirmLabel: 'Open sign-ups' })) : null]);
  }
  function mailLimitBlock() {
    AC.fill('mailLimitBody', [
      el('p', null, ['At most ', el('strong', { text: String(data.campaigns.dailyCap) }), ' campaign emails go out in a day. ',
        AC.can('emails.view') ? el('a', { href: AC.base + '/campaigns', text: data.can.campaignLimit ? 'Change it under Email campaigns.' : 'See Email campaigns.' }) : null]),
      el('p', { class: 'hint', text: 'Resend’s free plan sends 100 emails a day in all, so keep room for sign-in codes and receipts.' })
    ]);
  }

  function render() {
    page.removeAttribute('aria-busy');
    var note = AC.clear(document.getElementById('settingsNote'));
    if (!data.can.manage) note.appendChild(AC.notice('Your role can see the settings but not change them.'));
    sellerBlock(); supportBlock(); paymentsBlock(); signupsBlock(); mailLimitBlock();
  }
  function load() {
    AC.api('GET', '/api/console/settings').then(function (d) { data = d; render(); }, function (err) {
      page.removeAttribute('aria-busy');
      AC.fill('sellerBody', [AC.quiet("Couldn't load the settings. " + err.message), el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Try again', on: { click: load } })]);
    });
  }
  load();
})();
