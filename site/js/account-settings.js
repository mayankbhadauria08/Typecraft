/* /account/settings. Data: POST /api/auth/change-password {currentPassword,newPassword,confirmPassword},
   GET/PUT /api/me/email-preferences {announcements,testResults,loginAlerts}, POST /api/auth/logout-all,
   POST /api/user/reset {confirm:'RESET', today}, POST /api/user/delete {password}. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const PREFS = [
    ['announcements', 'Product news and offers', 'A few emails a year about new lessons and features.'],
    ['testResults', 'Typing test results', 'A summary after each saved typing test.'],
    ['loginAlerts', 'New sign-in alerts', 'An email when your account is used on a new device.'],
  ];

  /* password */
  const pw = $('#set-pw');
  pw.addEventListener('submit', async (e) => {
    e.preventDefault();
    K.formErrors(pw, null);
    const v = K.formValues(pw);
    const f = {};
    if (!v.currentPassword) f.currentPassword = 'Enter your current password.';
    if (!v.newPassword || v.newPassword.length < 8) f.newPassword = 'Use at least 8 characters.';
    if (v.newPassword !== v.confirmPassword) f.confirmPassword = "The two passwords don't match.";
    if (Object.keys(f).length) return K.formErrors(pw, f);
    const btn = pw.querySelector('[type=submit]');
    K.busy(btn, true);
    const res = await K.api('POST', '/api/auth/change-password', v);
    K.busy(btn, false);
    if (!res.ok) return K.formFail(pw, res);
    pw.reset();
    K.toast((res.data && res.data.message) || 'Password changed. Other devices were signed out.', 'ok');
  });

  /* email preferences */
  const prefs = $('#set-prefs');
  async function loadPrefs() {
    const body = $('#set-prefs-body');
    const res = await K.api('GET', '/api/me/email-preferences');
    if (!res.ok) return K.error(body, res, loadPrefs);
    const p = res.data.preferences;
    K.mount(body, PREFS.map(([key, label, hint]) => h('div', { class: 'check' },
      h('input', { type: 'checkbox', id: `pref-${key}`, name: key, checked: p[key] !== false }),
      h('label', { for: `pref-${key}` }, h('span', { text: label }), h('br'), h('span', { class: 'hint muted', text: hint })))));
    $('#set-prefs-save').disabled = false;
  }
  prefs.addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = {};
    for (const [key] of PREFS) { const i = prefs.elements[key]; if (i) out[key] = i.checked; }
    const btn = $('#set-prefs-save');
    K.busy(btn, true);
    const res = await K.api('PUT', '/api/me/email-preferences', out);
    K.busy(btn, false);
    if (!res.ok) return K.toast(K.errMsg(res), 'bad');
    K.toast('Email preferences saved.', 'ok');
  });

  /* sign out everywhere */
  $('#set-logout-all').addEventListener('click', async (e) => {
    const ok = await K.confirm({ title: 'Sign out everywhere?', text: 'Every device, including this browser, is signed out. You can sign in again at any time.', confirmLabel: 'Sign out everywhere' });
    if (!ok) return;
    K.busy(e.target, true);
    const res = await K.api('POST', '/api/auth/logout-all', {});
    K.busy(e.target, false);
    if (!res.ok) return K.toast(K.errMsg(res), 'bad');
    location.href = '/login';
  });

  /* reset progress */
  $('#set-reset').addEventListener('click', async (e) => {
    const ok = await K.confirm({ title: 'Reset all progress?', danger: true, typeToConfirm: 'RESET', confirmLabel: 'Reset progress',
      text: 'Lessons, stars, XP, streaks, badges and key statistics are cleared for good. Your plan, payments and invoices are not affected.' });
    if (!ok) return;
    K.busy(e.target, true);
    const res = await K.api('POST', '/api/user/reset', { confirm: 'RESET', today: K.today() });
    K.busy(e.target, false);
    if (!res.ok) return K.toast(K.errMsg(res), 'bad');
    try { Object.keys(localStorage).filter((k) => k.startsWith('typingMaster')).forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ }
    K.toast('Your progress has been reset.', 'ok');
  });

  /* delete account */
  $('#set-delete').addEventListener('click', async (e) => {
    const vals = await K.confirm({ title: 'Delete your account?', danger: true, typeToConfirm: 'DELETE', confirmLabel: 'Delete my account',
      text: 'This deletes your account, your practice history and any plan you have. It cannot be undone.',
      fields: [{ name: 'password', label: 'Your password', type: 'password', required: true, autocomplete: 'current-password' }] });
    if (!vals) return;
    K.busy(e.target, true);
    const res = await K.api('POST', '/api/user/delete', { password: vals.password });
    K.busy(e.target, false);
    if (!res.ok) return K.toast(K.errMsg(res), 'bad');
    try { Object.keys(localStorage).filter((k) => k.startsWith('typingMaster')).forEach((k) => localStorage.removeItem(k)); } catch { /* storage blocked */ }
    location.href = '/?deleted=1';
  });

  loadPrefs();
})();
