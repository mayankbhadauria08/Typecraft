/* /account/profile. Data: GET/PUT /api/user/profile {user:{fullName,email,phoneNumber,emailVerified,createdAt}, emailEnabled},
   POST /api/user/email-change {newEmail,password}, POST /api/auth/resend-verification. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const form = $('#prof-form'), emailForm = $('#email-form');

  function verifyBox(user, emailEnabled) {
    const el = $('#prof-verify');
    if (user.emailVerified) return K.mount(el, K.alert('ok', `Your email ${user.email} is confirmed.`));
    const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Resend confirmation email' });
    btn.addEventListener('click', async () => {
      K.busy(btn, true);
      const res = await K.api('POST', '/api/auth/resend-verification', {});
      K.busy(btn, false);
      if (res.ok) { K.toast((res.data && res.data.message) || 'Confirmation email sent.', 'ok'); btn.disabled = true; btn.textContent = 'Sent — check your inbox'; }
      else K.toast(K.errMsg(res), 'bad');
    });
    K.mount(el, K.alert('info', `Your email ${user.email} isn't confirmed yet. Confirm it to receive receipts, invoices and password resets.`, ' ',
      emailEnabled === false ? h('span', { class: 'muted', text: '(Email sending is not set up yet.)' }) : btn,
      ' ', h('a', { href: '/verify-otp?purpose=verify_email', text: 'I have a code' })));
  }

  function fill(user) {
    form.elements.fullName.value = user.fullName || '';
    form.elements.phoneNumber.value = user.phoneNumber || '';
    form.elements.email.value = user.email || '';
    $('#prof-since').textContent = user.createdAt ? `Member since ${K.date(user.createdAt)}` : '';
  }

  async function load() {
    K.$$('input,button', form).forEach((i) => { i.disabled = true; });
    const res = await K.api('GET', '/api/user/profile');
    K.$$('input,button', form).forEach((i) => { i.disabled = false; });
    if (!res.ok) return K.error($('#prof-verify'), res, load);
    fill(res.data.user);
    verifyBox(res.data.user, res.data.emailEnabled);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    K.formErrors(form, null);
    const v = K.formValues(form);
    if (!String(v.fullName || '').trim()) return K.formErrors(form, { fullName: 'Please enter your name.' });
    const btn = form.querySelector('[type=submit]');
    K.busy(btn, true);
    const res = await K.api('PUT', '/api/user/profile', { fullName: v.fullName, phoneNumber: v.phoneNumber });
    K.busy(btn, false);
    if (!res.ok) return K.formFail(form, res);
    fill(res.data.user);
    K.toast(res.data.message || 'Profile saved.', 'ok');
  });

  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    K.formErrors(emailForm, null);
    const v = K.formValues(emailForm);
    const fields = {};
    if (!/^\S+@\S+\.\S+$/.test(String(v.newEmail || '').trim())) fields.newEmail = 'Enter the new email address.';
    if (!v.password) fields.password = 'Enter your current password.';
    if (Object.keys(fields).length) return K.formErrors(emailForm, fields);
    const btn = emailForm.querySelector('[type=submit]');
    K.busy(btn, true);
    const res = await K.api('POST', '/api/user/email-change', { newEmail: String(v.newEmail).trim(), password: v.password });
    K.busy(btn, false);
    if (!res.ok) return K.formFail(emailForm, res);
    emailForm.reset();
    K.mount($('#prof-verify'), K.alert('ok', res.data.message || 'Check your new inbox for a confirmation link.'));
  });

  load();
})();
