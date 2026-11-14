// /payment/pending?order=<id> — waiting for the bank; polls the order every 5 s for up to 5 minutes.
export const meta = {
  path: '/payment/pending', title: 'Payment processing', description: 'Waiting for your bank to confirm the payment.',
  access: 'user', layout: 'account', nav: 'plans', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Waiting for your bank</h1>
  <p class="lede muted">Some payments, especially UPI and net banking, take a few minutes to confirm.</p>
</div>
<section class="section card" id="pn-card" aria-live="polite"><div class="skeleton" style="height:8rem"></div></section>
`;
export default body;
