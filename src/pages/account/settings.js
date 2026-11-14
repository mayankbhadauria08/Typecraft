// /account/settings — password, email preferences, sessions, reset progress, delete account.
export const meta = {
  path: '/account/settings', title: 'Settings', description: 'Password, emails and account controls.',
  access: 'user', layout: 'account', nav: 'settings', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Settings</h1>
  <p class="lede muted">Security, emails and your data.</p>
</div>
<section class="section grid grid-2">
  <form class="card" id="set-pw" novalidate aria-labelledby="set-pw-h">
    <div class="card-head"><h2 id="set-pw-h">Change password</h2></div>
    <div class="field"><label for="set-cur">Current password</label><input id="set-cur" name="currentPassword" type="password" autocomplete="current-password" required></div>
    <div class="field"><label for="set-new">New password</label><input id="set-new" name="newPassword" type="password" autocomplete="new-password" required minlength="8"><p class="hint">At least 8 characters. Other devices are signed out.</p></div>
    <div class="field"><label for="set-conf">Repeat new password</label><input id="set-conf" name="confirmPassword" type="password" autocomplete="new-password" required></div>
    <div class="card-foot"><button class="btn btn-primary" type="submit">Change password</button></div>
  </form>
  <form class="card" id="set-prefs" novalidate aria-labelledby="set-prefs-h">
    <div class="card-head"><h2 id="set-prefs-h">Email preferences</h2></div>
    <p class="muted">Receipts, invoices and security emails are always sent.</p>
    <div id="set-prefs-body"><div class="skeleton" style="height:6rem"></div></div>
    <div class="card-foot"><button class="btn btn-primary" type="submit" disabled id="set-prefs-save">Save preferences</button></div>
  </form>
</section>
<section class="section grid grid-2">
  <article class="card" aria-labelledby="set-sess-h">
    <div class="card-head"><h2 id="set-sess-h">Signed-in devices</h2></div>
    <p class="muted">Lost a phone or used a shared computer? Sign out of TypeCraft everywhere, including this browser.</p>
    <div class="card-foot"><button class="btn btn-ghost" type="button" id="set-logout-all">Sign out everywhere</button></div>
  </article>
  <article class="card" aria-labelledby="set-export-h">
    <div class="card-head"><h2 id="set-export-h">Your data</h2></div>
    <p class="muted">Download everything we store about your practice as a JSON file.</p>
    <div class="card-foot"><a class="btn btn-ghost" href="/api/user/export" download>Download my data</a></div>
  </article>
</section>
<section class="section" aria-labelledby="set-danger-h">
  <h2 id="set-danger-h">Danger zone</h2>
  <div class="grid grid-2">
    <article class="card" aria-labelledby="set-reset-h">
      <div class="card-head"><h3 id="set-reset-h">Reset progress</h3></div>
      <p class="muted">Clears lessons, stars, XP, streaks and key statistics. Your account, plan, payments and invoices stay.</p>
      <div class="card-foot"><button class="btn btn-danger" type="button" id="set-reset">Reset progress…</button></div>
    </article>
    <article class="card" aria-labelledby="set-del-h">
      <div class="card-head"><h3 id="set-del-h">Delete account</h3></div>
      <p class="muted">Deletes your account and all practice data for good. A plan you paid for ends with it. Save any <a href="/account/invoices">invoices</a> you need first.</p>
      <div class="card-foot"><button class="btn btn-danger" type="button" id="set-delete">Delete account…</button></div>
    </article>
  </div>
</section>
`;
export default body;
