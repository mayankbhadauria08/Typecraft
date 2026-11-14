// /payment/success?order=<id> — shown only when the server says the order is paid.
export const meta = {
  path: '/payment/success', title: 'Payment successful', description: 'Your plan is active.',
  access: 'user', layout: 'account', nav: 'plans', noindex: true,
};
export const body = `
<div class="page-head">
  <h1 id="ps-title">Checking your payment…</h1>
  <p class="lede muted" id="ps-lede">One moment.</p>
</div>
<section class="section card" id="ps-card" aria-live="polite"><div class="skeleton" style="height:8rem"></div></section>
`;
export default body;
