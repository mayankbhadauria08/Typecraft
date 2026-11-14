// /account/profile — name, phone, email (change with confirmation), verification status.
export const meta = {
  path: '/account/profile', title: 'Profile', description: 'Your name, phone number and email.',
  access: 'user', layout: 'account', nav: 'profile', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Profile</h1>
  <p class="lede muted">How we address you on invoices and emails.</p>
</div>
<div id="prof-verify"></div>
<section class="section grid grid-2">
  <form class="card" id="prof-form" novalidate aria-labelledby="prof-h">
    <div class="card-head"><h2 id="prof-h">Your details</h2></div>
    <div class="field"><label for="prof-name">Full name</label><input id="prof-name" name="fullName" autocomplete="name" required maxlength="80"></div>
    <div class="field"><label for="prof-phone">Phone number <span class="muted">(optional)</span></label><input id="prof-phone" name="phoneNumber" type="tel" autocomplete="tel" inputmode="tel" maxlength="20"><p class="hint">Used only to prefill payment forms.</p></div>
    <div class="field"><label for="prof-email">Email</label><input id="prof-email" name="email" type="email" readonly aria-describedby="prof-email-hint"><p class="hint" id="prof-email-hint">To change your email, use the form alongside.</p></div>
    <p class="muted" id="prof-since"></p>
    <div class="card-foot"><button class="btn btn-primary" type="submit">Save changes</button></div>
  </form>
  <form class="card" id="email-form" novalidate aria-labelledby="email-h">
    <div class="card-head"><h2 id="email-h">Change email</h2></div>
    <p class="muted">We send a confirmation link to the new address. Your email changes only after you open it.</p>
    <div class="field"><label for="email-new">New email</label><input id="email-new" name="newEmail" type="email" autocomplete="email" required></div>
    <div class="field"><label for="email-pw">Current password</label><input id="email-pw" name="password" type="password" autocomplete="current-password" required></div>
    <div class="card-foot"><button class="btn btn-ghost" type="submit">Send confirmation link</button></div>
  </form>
</section>
`;
export default body;
