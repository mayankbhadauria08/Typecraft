import { UPDATED, REFUND_DAYS, REFUND_LESSON_LIMIT, SHUTDOWN_NOTICE_DAYS, sellerBlock } from './legal-common.js';

export const meta = {
  path: '/refund-policy',
  title: 'Refund and cancellation policy',
  description: 'When TypeCraft refunds a payment: within 7 days of your first purchase, failed or duplicate charges within 5–7 working days. No automatic renewals to cancel.',
  changefreq: 'yearly',
  priority: '0.3',
};

export default `
<div class="container">
  <header class="page-head"><span class="eyebrow">Legal</span><h1>Refund and cancellation policy</h1>
    <p class="lede">TypeCraft plans are digital and start straight away, so refunds have a few simple rules. We'd rather be fair than difficult: if something went wrong, write to us.</p>
    <p class="updated mono muted">Last updated: ${UPDATED}</p></header>
  <div class="prose" style="padding-bottom:40px">
    <h2>1. Changed your mind: 7-day refund on your first purchase</h2>
    <p>You can ask for a full refund within <b>${REFUND_DAYS} days of your first paid purchase</b> on your account, as long as you have completed fewer than <b>${REFUND_LESSON_LIMIT} lessons</b> beyond the five free ones since buying. When the refund is made, the plan is removed from your account; your learning progress stays.</p>
    <p>Later purchases (including buying again to extend a plan) are not refundable once the plan is active, except as described in sections 2 and 3.</p>
    <h2>2. Failed, duplicate or wrong charges</h2>
    <ul>
      <li>If money left your account but the plan was not activated, the payment is usually reversed automatically by Razorpay or your bank. If it isn't, we refund it in full.</li>
      <li>If you were charged twice for the same order, we refund the extra payment in full.</li>
      <li>These refunds are started within <b>5–7 working days</b> of us confirming the problem.</li>
    </ul>
    <h2>3. If we can't deliver</h2>
    <p>If a serious fault on our side stops you using a paid feature for a long time and we can't fix it, we'll extend your plan or refund the unused part. Lifetime plans last for as long as TypeCraft is offered; if we ever close the service we'll give at least ${SHUTDOWN_NOTICE_DAYS} days' notice by email.</p>
    <h2>4. How to ask for a refund</h2>
    <p>Email <a href="mailto:{{support.email}}">{{support.email}}</a> from the address on your account, with your order or invoice number (shown in your account under Payments and Invoices) and a line on what happened. We reply within {{support.replyDays}} working days.</p>
    <h2>5. How refunds are paid</h2>
    <p>Approved refunds go back to the original payment method through Razorpay, usually within 5–7 working days. Your bank may take a few more days to show it. You'll get an email when the refund has been processed, and your invoice will show it.</p>
    <h2>6. Cancellation</h2>
    <p>There is nothing to cancel: plans are one-time payments and <b>never renew automatically</b>. A plan simply ends on its expiry date, and your account continues on the Free plan with all your progress kept. If you leave a checkout before paying, no money is taken.</p>
    <h2>7. What you bought</h2>
    <p>Each plan includes the features listed on the <a href="/pricing">pricing page</a> at the time you bought it, for the whole period you paid for.</p>
    ${sellerBlock}
  </div>
</div>
`;
