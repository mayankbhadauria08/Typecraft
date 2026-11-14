// /admin/settings — seller details for invoices, support, payments and sign-ups.
export const meta = {
  path: '/admin/settings', title: 'Settings', description: 'Seller details, support, payments and sign-ups.',
  access: 'admin', layout: 'admin', nav: 'settings', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Settings</h1>
  <p class="lede muted">Details printed on invoices and legal pages, how to reach support, and site switches.</p>
</div>
<form id="as-form" novalidate>
  <div id="as-alert"></div>
  <section class="section grid grid-2">
    <fieldset class="card" id="as-seller"><legend class="card-head"><h2>Seller (on invoices)</h2></legend><div class="skeleton" style="height:16rem"></div></fieldset>
    <fieldset class="card" id="as-support"><legend class="card-head"><h2>Support</h2></legend><div class="skeleton" style="height:10rem"></div></fieldset>
  </section>
  <section class="section grid grid-2">
    <fieldset class="card" id="as-payments"><legend class="card-head"><h2>Payments</h2></legend><div class="skeleton" style="height:6rem"></div></fieldset>
    <fieldset class="card" id="as-signups"><legend class="card-head"><h2>Sign-ups</h2></legend><div class="skeleton" style="height:6rem"></div></fieldset>
  </section>
  <div class="section field-row"><button class="btn btn-primary" type="submit" id="as-save" disabled>Save settings</button></div>
</form>
`;
export default body;
