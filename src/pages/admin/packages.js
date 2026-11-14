// /admin/packages — plan prices, validity, features and limits.
export const meta = {
  path: '/admin/packages', title: 'Packages', description: 'Edit plans, prices and features.',
  access: 'admin', layout: 'admin', nav: 'packages', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Packages</h1>
  <p class="lede muted">Changes apply to new purchases. People who already paid keep what they bought.</p>
</div>
<div class="section tabs" role="tablist" aria-label="Packages" id="ap-tabs"><span class="skeleton" style="height:2.2rem;width:20rem;display:inline-block"></span></div>
<section class="section grid grid-2" id="ap-main">
  <form class="card" id="ap-form" novalidate aria-labelledby="ap-form-h"><div class="card-head"><h2 id="ap-form-h">Edit package</h2></div><div id="ap-fields"><div class="skeleton" style="height:24rem"></div></div></form>
  <div aria-labelledby="ap-prev-h"><h2 id="ap-prev-h" class="sr-only">Preview</h2><p class="muted">Preview on the pricing page</p><div id="ap-preview"></div></div>
</section>
`;
export default body;
