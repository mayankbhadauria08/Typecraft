// /payment/failure?order=<id> — the payment did not go through.
export const meta = {
  path: '/payment/failure', title: 'Payment not completed', description: 'Your payment did not go through.',
  access: 'user', layout: 'account', nav: 'plans', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Payment not completed</h1>
  <p class="lede muted">Nothing has been activated, and you can try again.</p>
</div>
<section class="section card" id="pf-card" aria-live="polite"><div class="skeleton" style="height:8rem"></div></section>
`;
export default body;
