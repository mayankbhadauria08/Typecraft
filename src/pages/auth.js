// Sign-in pages registry (owner: the site part; docs/SAAS-CONTRACTS.md §4, §8).
// One script, site/js/auth.js, runs every form here. After signing in, the browser goes to
// ?next= (same-origin paths only) or /dashboard.
import { icon } from '../layout.js';

const S = ['/site/js/auth.js'];
const pw = (name, label, auto, hint = '') => `<div class="field"><label for="${name}">${label}</label>
  <div class="pw-wrap"><input id="${name}" name="${name}" type="password" autocomplete="${auto}" maxlength="128" required>
  <button type="button" class="icon-btn" data-pw-toggle="${name}" aria-label="Show password" aria-pressed="false">${icon('eye')}</button></div>
  ${hint ? `<div class="hint">${hint}</div>` : ''}<div class="err"></div></div>`;
const emailField = (id = 'email', extra = '') => `<div class="field"><label for="${id}">Email</label><input id="${id}" name="email" type="email" autocomplete="email" inputmode="email" maxlength="254" required ${extra}><div class="err"></div></div>`;
const codeField = (id = 'code') => `<div class="field"><label for="${id}">6-digit code</label><input id="${id}" name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" required><div class="err"></div></div>`;
const remember = '<label class="check"><input type="checkbox" name="remember" checked> Keep me signed in on this device</label>';

const login = `
<section class="auth-card" aria-labelledby="h">
  <div><h1 id="h">Welcome back</h1></div>
  <p class="sub">Sign in to continue your lessons.</p>
  <div id="topMsg" aria-live="polite"></div>
  <div class="tabs" role="tablist" aria-label="How to sign in" data-tabs>
    <button type="button" role="tab" id="tab-pw" data-tab="password" aria-selected="true" aria-controls="panel-pw">Password</button>
    <button type="button" role="tab" id="tab-code" data-tab="code" aria-selected="false" aria-controls="panel-code" tabindex="-1">Email me a code</button>
  </div>
  <div id="panel-pw" role="tabpanel" aria-labelledby="tab-pw">
    <form id="loginForm" class="form-stack" novalidate>
      <div data-msg></div>
      ${emailField('email', 'autofocus')}
      ${pw('password', 'Password', 'current-password')}
      <div class="between">${remember}<a href="/forgot-password" data-keep-next>Forgot password?</a></div>
      <button class="btn btn-primary btn-block" type="submit">Sign in</button>
    </form>
  </div>
  <div id="panel-code" role="tabpanel" aria-labelledby="tab-code" hidden>
    <form id="otpRequestForm" class="form-stack" novalidate>
      <div data-msg></div>
      <p class="muted" style="font-size:14.5px">We'll email you a 6-digit code. No password needed.</p>
      ${emailField('otpEmail')}
      <button class="btn btn-primary btn-block" type="submit">${icon('mail')} Email me a code</button>
    </form>
    <form id="otpVerifyForm" class="form-stack" novalidate hidden>
      <div data-msg></div>
      <p class="muted" style="font-size:14.5px">Enter the code we sent to <b id="otpTo"></b>. It works for 10 minutes.</p>
      ${codeField('otpCode')}
      ${remember}
      <button class="btn btn-primary btn-block" type="submit">Sign in</button>
      <div class="between"><button type="button" class="link-btn" id="otpResend">Send a new code</button><button type="button" class="link-btn" id="otpChange">Use a different email</button></div>
    </form>
  </div>
  <p class="switch">New to TypeCraft? <a href="/signup" data-keep-next>Create a free account</a></p>
</section>`;

const signup = `
<section class="auth-card auth-wide" aria-labelledby="h">
  <div><h1 id="h">Create your free account</h1></div>
  <p class="sub">Your lessons, stars and speed history are saved as you practise. The first five lessons are free; no card needed.</p>
  <form id="signupForm" class="form-stack" novalidate>
    <div data-msg></div>
    <div class="field"><label for="fullName">Full name</label><input id="fullName" name="fullName" autocomplete="name" maxlength="100" required autofocus><div class="err"></div></div>
    <div class="field-row">
      ${emailField('email')}
      <div class="field"><label for="phoneNumber">Phone number</label><input id="phoneNumber" name="phoneNumber" type="tel" autocomplete="tel" inputmode="tel" maxlength="24" placeholder="+91 98765 43210" required><div class="err"></div></div>
    </div>
    ${pw('password', 'Password', 'new-password', 'At least 8 characters, with a letter and a number.')}
    ${pw('confirmPassword', 'Confirm password', 'new-password')}
    <button class="btn btn-primary btn-block btn-lg" type="submit">Create account</button>
    <p class="muted" style="font-size:13.5px;text-align:center">By creating an account you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy policy</a>.</p>
  </form>
  <p class="switch">Already have an account? <a href="/login" data-keep-next>Sign in</a></p>
</section>`;

const forgot = `
<section class="auth-card" aria-labelledby="h">
  <div><h1 id="h">Reset your password</h1></div>
  <p class="sub">Enter the email you signed up with. We'll send you a link to choose a new password.</p>
  <form id="forgotForm" class="form-stack" novalidate>
    <div data-msg></div>
    ${emailField('email', 'autofocus')}
    <button class="btn btn-primary btn-block" type="submit">Send reset link</button>
  </form>
  <p class="switch"><a href="/login" data-keep-next>Back to sign in</a> · <a href="/login#code" data-keep-next>Sign in with an email code</a></p>
</section>`;

const reset = `
<section class="auth-card" aria-labelledby="h">
  <div><h1 id="h">Choose a new password</h1></div>
  <p class="sub">At least 8 characters, with a letter and a number. Other devices will be signed out.</p>
  <div id="resetMissing" class="alert alert-bad" hidden>${icon('alert')}<div>This page needs the link from your reset email. Links work once and expire after a while. <a href="/forgot-password">Send a new link</a>.</div></div>
  <form id="resetForm" class="form-stack" novalidate>
    <div data-msg></div>
    ${pw('password', 'New password', 'new-password')}
    ${pw('confirmPassword', 'Confirm new password', 'new-password')}
    <button class="btn btn-primary btn-block" type="submit">Set new password</button>
  </form>
  <div id="resetDone" hidden class="stack"><div class="alert alert-ok">${icon('check')}<div id="resetDoneText">Your password has been changed.</div></div><a class="btn btn-primary btn-block" href="/login">Sign in</a></div>
</section>`;

const verifyEmail = `
<section class="auth-card" aria-labelledby="h">
  <div><h1 id="h">Confirm your email</h1></div>
  <p class="sub">Open the link in the email we sent you, or type the 6-digit code from it here.</p>
  <div id="verifyLink" aria-live="polite"></div>
  <form id="verifyCodeForm" class="form-stack" novalidate>
    <div data-msg></div>
    ${emailField('email')}
    ${codeField('code')}
    <button class="btn btn-primary btn-block" type="submit">Confirm email</button>
    <div class="between"><button type="button" class="link-btn" id="verifyResend">Send a new code</button><a href="/dashboard">Skip for now</a></div>
  </form>
  <div id="verifyDone" hidden class="stack"><div class="alert alert-ok">${icon('check')}<div id="verifyDoneText">Email confirmed.</div></div><a class="btn btn-primary btn-block" href="/dashboard" id="verifyContinue">Continue</a></div>
</section>`;

const verifyOtp = `
<section class="auth-card" aria-labelledby="h">
  <div><h1 id="h">Enter your code</h1></div>
  <p class="sub" id="otpSub">We emailed you a 6-digit code. It works for 10 minutes.</p>
  <form id="otpPageForm" class="form-stack" novalidate>
    <div data-msg></div>
    ${emailField('email')}
    ${codeField('code')}
    <label class="check" id="otpRemember"><input type="checkbox" name="remember" checked> Keep me signed in on this device</label>
    <button class="btn btn-primary btn-block" type="submit">Continue</button>
    <div class="between"><button type="button" class="link-btn" id="otpPageResend">Send a new code</button><a href="/login" data-keep-next>Sign in with a password</a></div>
  </form>
</section>`;

const m = (path, title, description, access, extra = {}) => ({ path, title, description, access, layout: 'auth', ...extra });

export const PAGES = [
  { meta: m('/login', 'Sign in', 'Sign in to TypeCraft to continue your touch typing lessons.', 'guest', { sitemap: false }), body: login, scripts: S },
  { meta: m('/signup', 'Create your free account', 'Create a free TypeCraft account: the first five lessons, the placement test and daily typing tests, saved to your account.', 'guest', { sitemap: false }), body: signup, scripts: S },
  { meta: m('/forgot-password', 'Reset your password', 'Get a link to reset your TypeCraft password.', 'guest', { noindex: true }), body: forgot, scripts: S },
  { meta: m('/reset-password', 'Choose a new password', 'Choose a new password for your TypeCraft account.', 'public', { noindex: true }), body: reset, scripts: S },
  { meta: m('/verify-email', 'Confirm your email', 'Confirm the email address on your TypeCraft account.', 'public', { noindex: true }), body: verifyEmail, scripts: S },
  { meta: m('/verify-otp', 'Enter your code', 'Enter the one-time code we emailed you.', 'public', { noindex: true }), body: verifyOtp, scripts: S },
];
