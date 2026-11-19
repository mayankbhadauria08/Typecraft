/* Admin console sign-in: the password first, then (when emailed codes are switched on) the code.
   Where to go afterwards comes from the server, which has already checked it (data-next). */
(function () {
  'use strict';
  var doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var base = doc.documentElement.getAttribute('data-console-base') || '/admin';
  var next = byId('main').getAttribute('data-next') || base;

  var stepPassword = byId('stepPassword'), stepCode = byId('stepCode');
  var email = byId('email'), password = byId('password'), code = byId('code');
  var loginBtn = byId('loginBtn'), codeBtn = byId('codeBtn'), resendBtn = byId('resendBtn');
  var resendTimer = null;

  function post(path, body) {
    return fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body || {}) })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (res.ok && data) return data;
          var err = (data && data.error) || {};
          throw { status: res.status, code: err.code || 'server_error', message: err.message || 'Something went wrong on our side. Try again.', fields: err.fields || null };
        });
      }, function () {
        throw { status: 0, code: 'network', message: "Couldn't reach TypeCraft. Check your connection and try again.", fields: null };
      });
  }
  function busy(button, on) {
    button.disabled = on;
    button.classList.toggle('is-busy', on);
  }
  function banner(id, text) {
    var box = byId(id);
    box.querySelector('span').textContent = text || '';
    box.hidden = !text;
  }
  function fieldError(input, text) {
    var line = byId(input.id + 'Err');
    line.textContent = text || '';
    line.hidden = !text;
    if (text) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', line.id); }
    else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
  }
  function clearErrors() {
    banner('loginError', ''); banner('codeError', ''); banner('codeNote', '');
    [email, password, code].forEach(function (input) { fieldError(input, ''); });
  }
  function enter() { location.assign(next); }

  function showStep(which) {
    stepPassword.hidden = which !== 'password';
    stepCode.hidden = which !== 'code';
    (which === 'code' ? code : (email.value ? password : email)).focus();
  }
  function startResendWait(seconds) {
    clearInterval(resendTimer);
    var left = Math.max(0, Math.round(seconds || 0));
    var draw = function () {
      resendBtn.disabled = left > 0;
      resendBtn.textContent = left > 0 ? 'Send a new code in ' + left + ' s' : 'Send a new code';
    };
    draw();
    resendTimer = setInterval(function () { left -= 1; draw(); if (left <= 0) clearInterval(resendTimer); }, 1000);
  }
  function restart(message) {
    clearInterval(resendTimer);
    password.value = ''; code.value = '';
    clearErrors();
    showStep('password');
    if (message) banner('loginError', message);
  }

  /* ---------- step 1: email and password ---------- */
  stepPassword.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();
    var address = email.value.trim();
    if (!address) { fieldError(email, 'Enter your email address.'); email.focus(); return; }
    if (!password.value) { fieldError(password, 'Enter your password.'); password.focus(); return; }
    busy(loginBtn, true);
    post('/api/admin/auth/login', { email: address, password: password.value }).then(function (data) {
      if (data.step === 'code') {
        busy(loginBtn, false);
        byId('sentTo').textContent = data.sentTo || 'your email';
        code.value = '';
        showStep('code');
        startResendWait(data.resendIn);
        return;
      }
      enter(); // the button stays busy while the page changes
    }, function (err) {
      busy(loginBtn, false);
      if (err.fields && (err.fields.email || err.fields.password)) {
        if (err.fields.email) fieldError(email, err.fields.email);
        if (err.fields.password) fieldError(password, err.fields.password);
        (err.fields.email ? email : password).focus();
        return;
      }
      banner('loginError', err.message);
      if (err.code === 'wrong_credentials') { password.value = ''; password.focus(); }
    });
  });
  byId('showPassword').addEventListener('click', function () {
    var show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    this.textContent = show ? 'Hide' : 'Show';
    this.setAttribute('aria-pressed', show ? 'true' : 'false');
  });

  /* ---------- step 2: the emailed code ---------- */
  function submitCode() {
    clearErrors();
    var digits = code.value.replace(/\D/g, '');
    if (digits.length !== 6) { fieldError(code, 'Enter the 6-digit code from the email.'); code.focus(); return; }
    busy(codeBtn, true);
    post('/api/admin/auth/verify', { code: digits }).then(enter, function (err) {
      busy(codeBtn, false);
      if (err.code === 'step_expired') { restart(err.message); return; }
      if (err.code === 'invalid_code' || (err.fields && err.fields.code)) { fieldError(code, (err.fields && err.fields.code) || err.message); code.select(); code.focus(); return; }
      banner('codeError', err.message);
      if (err.code === 'code_expired' || err.code === 'code_burned') { code.value = ''; startResendWait(0); }
    });
  }
  stepCode.addEventListener('submit', function (e) { e.preventDefault(); submitCode(); });
  code.addEventListener('input', function () {
    if (!codeBtn.disabled && /^\d{6}$/.test(code.value.replace(/\s/g, ''))) submitCode();
  });
  resendBtn.addEventListener('click', function () {
    clearErrors();
    resendBtn.disabled = true;
    post('/api/admin/auth/resend', {}).then(function (data) {
      banner('codeNote', 'A new code is on its way to ' + (data.sentTo || 'your email') + '.');
      startResendWait(data.resendIn);
      code.value = ''; code.focus();
    }, function (err) {
      if (err.code === 'step_expired') { restart(err.message); return; }
      banner('codeError', err.message);
      startResendWait(err.code === 'otp_cooldown' ? 30 : 0);
    });
  });
  byId('restartBtn').addEventListener('click', function () { restart(''); });

  /* ---------- arriving ---------- */
  if (/[?&]ended=1(&|$)/.test(location.search)) byId('endedNote').hidden = false;
  // already signed in (a link from another site doesn't carry the admin cookie on its first request): go straight in
  fetch('/api/admin/auth/me', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
    .then(function (res) { if (res.ok) location.replace(next); }, function () { /* offline: the form says so when it is used */ });
  showStep('password');
})();
