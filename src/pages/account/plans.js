// /account/plans — current entitlements, subscription periods, what is and isn't included, buy/renew.
export const meta = {
  path: '/account/plans', title: 'Plans', description: 'Your plan, its periods and what it includes.',
  access: 'user', layout: 'account', nav: 'plans', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Plans</h1>
  <p class="lede muted">What you have now, when it ends, and how to extend it. Buying while a plan is active adds a new period after the current one.</p>
</div>
<section class="section grid grid-2">
  <article class="card" aria-labelledby="pl-cur-h"><div class="card-head"><h2 id="pl-cur-h">Current plan</h2></div><div id="pl-current"><div class="skeleton" style="height:6rem"></div></div></article>
  <article class="card" aria-labelledby="pl-feat-h"><div class="card-head"><h2 id="pl-feat-h">What's included</h2></div><div id="pl-features"><div class="skeleton" style="height:10rem"></div></div></article>
</section>
<section class="section" aria-labelledby="pl-subs-h">
  <h2 id="pl-subs-h">Your plan periods</h2>
  <div id="pl-subs"><div class="skeleton" style="height:6rem"></div></div>
</section>
<section class="section" aria-labelledby="pl-buy-h">
  <h2 id="pl-buy-h">Buy or renew</h2>
  <div class="grid grid-4" id="pl-buy"><div class="plan-card skeleton" style="height:14rem"></div><div class="plan-card skeleton" style="height:14rem"></div></div>
  <p class="muted">Prices include all charges. See the <a href="/refund-policy">refund policy</a> and <a href="/terms">terms</a>.</p>
</section>
`;
export default body;
