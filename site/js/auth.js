/* Sign-in pages: /login, /signup, /forgot-password, /reset-password, /verify-email, /verify-otp.
   Validation mirrors the server (src/http.js); the server's message wins when they differ. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const V = {
    email: (v) => !String(v || '').trim() ? 'Enter your email address.' : (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim()) ? 'Enter a valid email address.' : null),
    name: (v) => !String(v || '').trim() ? 'Enter your name.' : (String(v).trim().length > 100 ? 'Keep your name under 100 characters.' : null),
    phone: (v) => { v = String(v || ''); const d = v.replace(/\D/g, ''); return !v.trim() ? 'Enter your phone number.' : ((!/^\+?[\d\s().-]+$/.test(v.trim()) || d.length < 7 || d.length > 15) ? 'Enter a valid phone number (7–15 digits, optionally starting with +).' : null); },
    password: (v, email) => { v = String(v || ''); return v.length < 8 ? 'Use at least 8 characters.' : v.length > 128 ? 'Keep your password under 128 characters.'
      : (!/[A-Za-z]/.test(v) || !/\d/.test(v)) ? 'Use at least one letter and one number.'
      : (email && v.toLowerCase() === String(email).trim().toLowerCase()) ? "Your password can't be your email address." : null; },
    same: (a, b) => a !== b ? "The two passwords don't match." : null,
    code: (v) => /^\d{6}$/.test(String(v || '').trim()) ? null : 'Enter the 6-digit code from the email.',
  };
  const errors = (checks) => Object.fromEntries(Object.entries(checks).filter(([, m]) => m));
  const submitBtn = (f) => f.querySelector('button[type=submit]');
  const nextPath = () => TC.safeNext('/dashboard');
  const goNext = () => location.replace(nextPath());
  function apiFail(form, r) {
    const e = r.error || {};
    if (e.fields) TC.formErrors(form, e.fields, '');
    else TC.formErrors(form, null, e.message || 'Something went wrong. Please try again.');
  }
  async function run(form, fn) { const b = submitBtn(form); TC.busy(b, true); try { await fn(); } finally { TC.busy(b, false); } }
  /** The token from #token=… (or the old #reset= / #verify= forms); removed from the address bar at once. */
  function hashToken() {
    const m = location.hash.match(/^#(?:token|reset|verify)=([\w-]{20,200})$/);
    if (m) history.replaceState(null, '', location.pathname + location.search);
    return m ? m[1] : null;
  }
  const codeUnavailable = (r) => r.status === 404 || r.status === 405;

  // keep ?next= on links between the sign-in pages
  const next = TC.qs('next');
  if (next) document.querySelectorAll('a[data-keep-next]').forEach((a) => {
    const u = new URL(a.getAttribute('href'), location.origin); u.searchParams.set('next', next); a.href = u.pathname + u.search + u.hash;
  });
  // show / hide password
  document.querySelectorAll('[data-pw-toggle]').forEach((b) => b.addEventListener('click', () => {
    const input = $(b.dataset.pwToggle); const show = input.type === 'password';
    input.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', String(show)); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }));
  // codes: digits only
  document.querySelectorAll('input[name="code"]').forEach((i) => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 6); }));
  const prefillEmail = TC.qs('email');

  /* ---------- /login ---------- */
  const loginForm = $('loginForm');
  if (loginForm) {
    const top = $('topMsg');
    const say = (text, kind) => { top.className = text ? 'alert alert-' + (kind || 'ok') : ''; top.innerHTML = text ? TC.icon(kind === 'bad' ? 'alert' : 'info') + '<div>' + TC.esc(text) + '</div>' : ''; };
    if (TC.qs('signedout')) say('You have been signed out.', 'info');
    if (TC.qs('expired')) say('Your session has ended. Please sign in again.', 'bad');
    if (TC.qs('deleted')) say('Your account and all of its data have been deleted.', 'info');
    if (TC.qs('reset')) say('Your password has been changed. Sign in with your new password.', 'ok');
    if (prefillEmail) { loginForm.elements.email.value = prefillEmail; $('otpEmail').value = prefillEmail; loginForm.elements.password.focus(); }
    const tabs = document.querySelector('[data-tabs]');
    if (location.hash === '#code') setTimeout(() => tabs.tcSelect && tabs.tcSelect('code'), 0);

    loginForm.addEventListener('submit', (e) => {
      e.preventDefault(); const v = TC.formValues(loginForm);
      const errs = errors({ email: V.email(v.email), password: v.password ? null : 'Enter your password.' });
      if (Object.keys(errs).length) return TC.formErrors(loginForm, errs);
      run(loginForm, async () => { const r = await TC.api('POST', '/api/auth/login', v); if (!r.ok) return apiFail(loginForm, r); goNext(); });
    });

    const reqForm = $('otpRequestForm'), verForm = $('otpVerifyForm');
    let otpEmail = '', cooldownUntil = 0, timer = null;
    const resend = $('otpResend');
    function tick() {
      const left = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (left > 0) { resend.disabled = true; resend.textContent = 'Send a new code (' + left + ' s)'; }
      else { resend.disabled = false; resend.textContent = 'Send a new code'; clearInterval(timer); timer = null; }
    }
    function startCooldown() { cooldownUntil = Date.now() + 60000; if (!timer) timer = setInterval(tick, 1000); tick(); }
    async function requestCode(form) {
      const r = await TC.api('POST', '/api/auth/otp/request', { email: otpEmail, purpose: 'login' });
      if (codeUnavailable(r)) { TC.formErrors(form, null, "Sign-in codes aren't available yet. Please sign in with your password."); return false; }
      if (!r.ok) { apiFail(form, r); return false; }
      return r.data.message || 'If that email has an account, a code is on its way.';
    }
    reqForm.addEventListener('submit', (e) => {
      e.preventDefault(); const v = TC.formValues(reqForm);
      const errs = errors({ email: V.email(v.email) });
      if (Object.keys(errs).length) return TC.formErrors(reqForm, errs);
      otpEmail = v.email.trim();
      run(reqForm, async () => {
        const msg = await requestCode(reqForm); if (!msg) return;
        TC.formErrors(reqForm, null);
        reqForm.hidden = true; verForm.hidden = false; $('otpTo').textContent = otpEmail;
        TC.formMessage(verForm, msg, 'info'); startCooldown(); $('otpCode').focus();
      });
    });
    verForm.addEventListener('submit', (e) => {
      e.preventDefault(); const v = TC.formValues(verForm);
      const errs = errors({ code: V.code(v.code) });
      if (Object.keys(errs).length) return TC.formErrors(verForm, errs);
      run(verForm, async () => {
        const r = await TC.api('POST', '/api/auth/otp/verify', { email: otpEmail, code: v.code.trim(), purpose: 'login', remember: !!v.remember });
        if (codeUnavailable(r)) return TC.formErrors(verForm, null, "Sign-in codes aren't available yet. Please sign in with your password.");
        if (!r.ok) return apiFail(verForm, r);
        goNext();
      });
    });
    resend.addEventListener('click', async () => {
      if (Date.now() < cooldownUntil) return;
      TC.busy(resend, true); const msg = await requestCode(verForm); TC.busy(resend, false);
      if (msg) { TC.formMessage(verForm, 'A new code is on its way. Use the newest one.', 'info'); startCooldown(); } else tick();
    });
    $('otpChange').addEventListener('click', () => { verForm.hidden = true; reqForm.hidden = false; $('otpEmail').focus(); });
  }

  /* ---------- /signup ---------- */
  const signupForm = $('signupForm');
  if (signupForm) {
    if (prefillEmail) signupForm.elements.email.value = prefillEmail;
    signupForm.addEventListener('submit', (e) => {
      e.preventDefault(); const v = TC.formValues(signupForm);
      const errs = errors({ fullName: V.name(v.fullName), email: V.email(v.email), phoneNumber: V.phone(v.phoneNumber),
        password: V.password(v.password, v.email), confirmPassword: V.same(v.password, v.confirmPassword) });
      if (Object.keys(errs).length) return TC.formErrors(signupForm, errs);
      run(signupForm, async () => {
        const r = await TC.api('POST', '/api/auth/signup', v);
        if (!r.ok) return apiFail(signupForm, r);
        goNext();
      });
    });
  }

  /* ---------- /forgot-password ---------- */
  const forgotForm = $('forgotForm');
  if (forgotForm) {
    if (prefillEmail) forgotForm.elements.email.value = prefillEmail;
    forgotForm.addEventListener('submit', (e) => {
      e.preventDefault(); const v = TC.formValues(forgotForm);
      const errs = errors({ email: V.email(v.email) });
      if (Object.keys(errs).length) return TC.formErrors(forgotForm, errs);
      run(forgotForm, async () => {
        const r = await TC.api('POST', '/api/auth/forgot-password', { email: v.email });
        if (!r.ok) return apiFail(forgotForm, r);
        TC.formErrors(forgotForm, null);
        TC.formMessage(forgotForm, r.data.message || 'If that email has an account, a reset link is on its way.', 'ok');
      });
    });
  }

  /* ---------- /reset-password ---------- */
  const resetForm = $('resetForm');
  if (resetForm) {
    const token = hashToken();
    if (!token) { resetForm.hidden = true; $('resetMissing').hidden = false; }
    resetForm.addEventListener('submit', (e) => {
      e.preventDefault(); const v = TC.formValues(resetForm);
      const errs = errors({ password: V.password(v.password), confirmPassword: V.same(v.password, v.confirmPassword) });
      if (Object.keys(errs).length) return TC.formErrors(resetForm, errs);
      run(resetForm, async () => {
        const r = await TC.api('POST', '/api/auth/reset-password', { token, password: v.password, confirmPassword: v.confirmPassword });
        if (!r.ok) return apiFail(resetForm, r);
        resetForm.hidden = true; $('resetDone').hidden = false;
        if (r.data.message) $('resetDoneText').textContent = r.data.message;
        $('resetDone').querySelector('a').focus();
      });
    });
  }

  /* ---------- /verify-email ---------- */
  const verifyForm = $('verifyCodeForm');
  if (verifyForm) {
    const done = (text) => {
      verifyForm.hidden = true; $('verifyDone').hidden = false; $('verifyDoneText').textContent = text || 'Email confirmed.';
      TC.me().then((me) => { const a = $('verifyContinue'); if (!me) { a.href = '/login'; a.textContent = 'Sign in'; } a.focus(); });
    };
    TC.me().then((me) => { if (!verifyForm.elements.email.value) verifyForm.elements.email.value = prefillEmail || (me && me.user.email) || ''; });
    const token = hashToken();
    if (token) {
      const slot = $('verifyLink');
      slot.className = 'alert alert-info'; slot.innerHTML = TC.icon('clock') + '<div>Checking your link…</div>';
      TC.api('POST', '/api/auth/verify-email', { token }).then((r) => {
        if (r.ok) { slot.className = ''; slot.innerHTML = ''; done(r.data.message); return; }
        slot.className = 'alert alert-bad';
        slot.innerHTML = TC.icon('alert') + '<div>' + TC.esc((r.error && r.error.message) || 'That confirmation link did not work.') + ' You can enter the code from the email instead, or ask for a new one.</div>';
      });
    }
    verifyForm.addEventListener('submit', (e) => {
      e.preventDefault(); const v = TC.formValues(verifyForm);
      const errs = errors({ email: V.email(v.email), code: V.code(v.code) });
      if (Object.keys(errs).length) return TC.formErrors(verifyForm, errs);
      run(verifyForm, async () => {
        const r = await TC.api('POST', '/api/auth/otp/verify', { email: v.email.trim(), code: v.code.trim(), purpose: 'verify_email' });
        if (codeUnavailable(r)) return TC.formErrors(verifyForm, null, "Codes can't be checked here yet. Please use the link in the email.");
        if (!r.ok) return apiFail(verifyForm, r);
        done(r.data.message);
      });
    });
    $('verifyResend').addEventListener('click', async () => {
      const email = verifyForm.elements.email.value;
      const bad = V.email(email); if (bad) return TC.formErrors(verifyForm, { email: bad });
      const b = $('verifyResend'); TC.busy(b, true);
      let r = await TC.api('POST', '/api/auth/otp/request', { email: email.trim(), purpose: 'verify_email' });
      if (codeUnavailable(r)) r = await TC.api('POST', '/api/auth/resend-verification', {}); // older API: signed in only
      TC.busy(b, false);
      if (!r.ok) return apiFail(verifyForm, r);
      TC.formErrors(verifyForm, null);
      TC.formMessage(verifyForm, r.data.message || 'A new email is on its way.', 'info');
    });
  }

  /* ---------- /verify-otp ---------- */
  const otpForm = $('otpPageForm');
  if (otpForm) {
    const purpose = TC.qs('purpose') === 'verify_email' ? 'verify_email' : 'login';
    if (prefillEmail) otpForm.elements.email.value = prefillEmail;
    if (purpose === 'verify_email') { $('otpRemember').hidden = true; $('otpSub').textContent = 'Enter the 6-digit code from your confirmation email.'; }
    (prefillEmail ? otpForm.elements.code : otpForm.elements.email).focus();
    otpForm.addEventListener('submit', (e) => {
      e.preventDefault(); const v = TC.formValues(otpForm);
      const errs = errors({ email: V.email(v.email), code: V.code(v.code) });
      if (Object.keys(errs).length) return TC.formErrors(otpForm, errs);
      run(otpForm, async () => {
        const r = await TC.api('POST', '/api/auth/otp/verify', { email: v.email.trim(), code: v.code.trim(), purpose, remember: !!v.remember });
        if (codeUnavailable(r)) return TC.formErrors(otpForm, null, "Codes aren't available yet. Please sign in with your password.");
        if (!r.ok) return apiFail(otpForm, r);
        if (purpose === 'login') return goNext();
        TC.formErrors(otpForm, null); TC.formMessage(otpForm, r.data.message || 'Email confirmed.', 'ok');
        setTimeout(() => location.replace(nextPath()), 1200);
      });
    });
    $('otpPageResend').addEventListener('click', async () => {
      const email = otpForm.elements.email.value; const bad = V.email(email);
      if (bad) return TC.formErrors(otpForm, { email: bad });
      const b = $('otpPageResend'); TC.busy(b, true);
      const r = await TC.api('POST', '/api/auth/otp/request', { email: email.trim(), purpose });
      TC.busy(b, false);
      if (codeUnavailable(r)) return TC.formErrors(otpForm, null, "Codes aren't available yet. Please sign in with your password.");
      if (!r.ok) return apiFail(otpForm, r);
      TC.formErrors(otpForm, null); TC.formMessage(otpForm, r.data.message || 'A new code is on its way.', 'info');
    });
  }
})();
