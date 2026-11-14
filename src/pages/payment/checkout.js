// /checkout?plan=<id> — order summary and the Razorpay payment button.
export const meta = {
  path: '/checkout', title: 'Checkout', description: 'Review your plan and pay securely with Razorpay.',
  access: 'user', layout: 'account', nav: 'plans', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Checkout</h1>
  <p class="lede muted">Review your plan, then pay securely with Razorpay: UPI, cards, net banking or wallets.</p>
</div>
<div id="co-alert" aria-live="polite"></div>
<section class="section grid grid-2" id="co-main">
  <article class="card" aria-labelledby="co-sum-h">
    <div class="card-head"><h2 id="co-sum-h">Order summary</h2></div>
    <div id="co-summary"><div class="skeleton" style="height:9rem"></div></div>
  </article>
  <article class="card" aria-labelledby="co-get-h">
    <div class="card-head"><h2 id="co-get-h">What you get</h2></div>
    <div id="co-features"><div class="skeleton" style="height:9rem"></div></div>
  </article>
</section>
<section class="section card" aria-labelledby="co-pay-h" id="co-pay-card">
  <h2 id="co-pay-h" class="sr-only">Pay</h2>
  <div id="co-msg" aria-live="polite"></div>
  <button class="btn btn-primary btn-block" type="button" id="co-pay" disabled>Pay</button>
  <p class="muted" style="margin-top:.75rem">By paying you agree to the <a href="/terms">terms</a> and the <a href="/refund-policy">refund policy</a>. Payments are processed by Razorpay; TypeCraft never sees your card or UPI details. Your plan starts only after the payment is confirmed.</p>
  <p class="muted"><a href="/pricing">&larr; Choose a different plan</a></p>
</section>
`;
export default body;
