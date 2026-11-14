// /account/payments — every order with its status, amount and Razorpay payment id.
export const meta = {
  path: '/account/payments', title: 'Payments', description: 'Your payment history.',
  access: 'user', layout: 'account', nav: 'payments', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Payments</h1>
  <p class="lede muted">Every checkout you started, what happened to it, and its invoice.</p>
</div>
<section class="section" id="pay-list" aria-live="polite"><div class="skeleton" style="height:12rem"></div></section>
<p class="muted">Money taken for a payment that failed is returned by your bank automatically, usually within 5–7 working days. Questions? <a href="/contact">Contact us</a> with the payment id.</p>
`;
export default body;
