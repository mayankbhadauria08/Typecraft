import { UPDATED, CITY, SHUTDOWN_NOTICE_DAYS, sellerBlock } from './legal-common.js';

export const meta = {
  path: '/terms',
  title: 'Terms of service',
  description: 'The terms for using TypeCraft: accounts, one-time plans and their validity, acceptable use, and the law that applies.',
  changefreq: 'yearly',
  priority: '0.3',
};

export default `
<div class="container">
  <header class="page-head"><span class="eyebrow">Legal</span><h1>Terms of service</h1>
    <p class="lede">The agreement between you and TypeCraft, in plain language.</p>
    <p class="updated mono muted">Last updated: ${UPDATED}</p></header>
  <div class="prose" style="padding-bottom:40px">
    <h2>1. The service</h2>
    <p>TypeCraft is an online touch typing course with lessons, typing tests, analytics and games, run by {{seller.legalName}} ("we"). By creating an account or buying a plan you agree to these terms.</p>
    <h2>2. Your account</h2>
    <ul>
      <li>Give accurate details and keep your password private. You're responsible for activity on your account.</li>
      <li>One account is for one person. Plans can't be shared, resold or transferred.</li>
      <li>If you are under 18, use TypeCraft with the consent of a parent or guardian.</li>
    </ul>
    <h2>3. Plans and payments</h2>
    <ul>
      <li>The Free plan is free and doesn't expire. Paid plans are <b>one-time payments</b> for a fixed period shown at checkout (for example 30, 90 or 180 days). <b>Nothing renews automatically.</b></li>
      <li>A plan starts when the payment is confirmed. If you buy while a plan is active, the new period starts when the current one ends.</li>
      <li><b>Lifetime</b> means for as long as TypeCraft is offered as a service. If we ever close the service, we will tell you at least ${SHUTDOWN_NOTICE_DAYS} days in advance by email.</li>
      <li>You get the features listed for your plan at the time you bought it, for the whole period you paid for, even if plans change later.</li>
      <li>Prices are in Indian rupees and include any applicable taxes. Payments are processed by Razorpay; their terms also apply to the payment itself.</li>
      <li>Refunds follow our <a href="/refund-policy">refund and cancellation policy</a>.</li>
    </ul>
    <h2>4. Acceptable use</h2>
    <p>Don't misuse the service: no attempts to break into accounts or systems, no automated scripts to fake progress, scores or certificates, no copying of the lesson content for redistribution, and nothing unlawful. We may suspend accounts that do these things, and will tell you why.</p>
    <h2>5. Content and certificates</h2>
    <p>The lessons, texts, games, design and code are ours. You may use them for your own learning. Certificates show results recorded on your account; they are not a government or academic qualification.</p>
    <h2>6. Availability</h2>
    <p>We work to keep TypeCraft available and your data safe, but the service is provided "as is" and may sometimes be unavailable for maintenance or reasons outside our control.</p>
    <h2>7. Liability</h2>
    <p>To the extent the law allows, our total liability to you for any claim is limited to the amount you paid us in the 12 months before the claim. Nothing in these terms limits your rights under the Consumer Protection Act, 2019.</p>
    <h2>8. Ending</h2>
    <p>You can delete your account at any time from Account settings. Deleting an account ends any active plan; see the refund policy for when money is returned.</p>
    <h2>9. Law and disputes</h2>
    <p>These terms are governed by the laws of India. Please contact us first so we can try to resolve any problem; otherwise, the courts at ${CITY} have jurisdiction.</p>
    <h2>10. Changes</h2>
    <p>We may update these terms. If a change affects you materially, we'll tell you by email or on the site before it applies. Plans you've already paid for keep their features and dates.</p>
    ${sellerBlock}
  </div>
</div>
`;
