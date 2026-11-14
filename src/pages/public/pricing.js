// Pricing: plan cards and the comparison table are drawn by site/js/pricing.js from
// GET /api/packages (first paint from the same data, read on the server). No price is
// written in this file: prices live in the packages table and are edited in admin.
import { icon } from '../../layout.js';
import { FAQ, faqList } from './faq-data.js';

export const meta = {
  path: '/pricing',
  title: 'Pricing and plans',
  description: 'Start free with the first 5 lessons. Paid plans are one-time payments in rupees, from one month to lifetime, with no automatic renewal. Payments by Razorpay.',
};

export default `
<div class="container">
  <header class="page-head" style="text-align:center;align-items:center">
    <span class="eyebrow">Pricing</span>
    <h1>Pay once. Learn at your pace.</h1>
    <p class="lede">Start free with the first five lessons. When you want the whole course, pick a plan for the time you need. Every plan is a single payment: <b>nothing renews automatically</b>.</p>
  </header>

  <div id="planNotice" aria-live="polite"></div>
  <div class="plan-grid" id="plans" aria-live="polite" aria-busy="true">
    <div class="plan-card skeleton" style="min-height:420px"></div><div class="plan-card skeleton" style="min-height:420px"></div><div class="plan-card skeleton" style="min-height:420px"></div><div class="plan-card skeleton" style="min-height:420px"></div>
  </div>
  <p class="muted" style="text-align:center;font-size:14px;margin-top:18px">Prices in Indian rupees. Buying while a plan is active adds the new period after the current one ends.</p>
</div>

<section class="section" aria-labelledby="compare-h">
  <div class="container">
    <div class="section-head"><h2 id="compare-h">Compare plans</h2><p class="lede">What each plan includes, feature by feature. Limits are stated as they are enforced.</p></div>
    <div class="table-wrap"><table class="table compare" id="compare"><caption class="sr-only">Features included in each plan</caption><tbody><tr><td><div class="skeleton" style="height:220px"></div></td></tr></tbody></table></div>
  </div>
</section>

<section class="section" aria-labelledby="secure-h">
  <div class="container grid-3">
    <div class="card"><span class="card-icon">${icon('shield')}</span><h2 id="secure-h" style="font-size:21px">Secure payments by Razorpay</h2>
      <p>Pay by UPI, card, net banking or wallet on Razorpay's secure checkout. TypeCraft never sees or stores your card or bank details. Your plan starts as soon as the payment is confirmed.</p></div>
    <div class="card"><span class="card-icon">${icon('receipt')}</span><h2 style="font-size:21px">Invoices for every payment</h2>
      <p>Each payment creates an invoice with a number, the plan and the amount. View or print it any time from your account.</p></div>
    <div class="card"><span class="card-icon brass">${icon('refresh')}</span><h2 style="font-size:21px">Fair refunds</h2>
      <p>Changed your mind? Ask within 7 days of your first purchase. Failed or duplicate charges are always returned. Read the <a href="/refund-policy">refund and cancellation policy</a>.</p></div>
  </div>
</section>

<section class="section" aria-labelledby="pfaq-h">
  <div class="container narrow">
    <div class="section-head"><h2 id="pfaq-h">Questions about plans</h2></div>
    ${faqList(FAQ.plans)}
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="cta-band">
      <div><h2>Not ready to pay? Start free.</h2><p>The first five lessons, the placement test, review drills, the Daily Challenge and three typing tests a day are free, for as long as you like.</p></div>
      <div class="actions"><a class="btn btn-primary btn-lg" href="/signup" data-auth-swap>Start free ${icon('arrowRight')}</a></div>
    </div>
  </div>
</section>
`;
