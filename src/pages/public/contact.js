import { icon } from '../../layout.js';

export const meta = {
  path: '/contact',
  title: 'Contact us',
  description: 'Questions about lessons, payments or your account? Write to the TypeCraft team. Support email: hello@typecrafttyping.com.',
};

export default `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">Contact</span>
    <h1>Talk to a person</h1>
    <p class="lede">Questions about the course, a payment, or something that isn't working? Send us a message and we'll reply by email.</p>
  </header>
  <div class="contact-grid" style="padding-bottom:24px">
    <form class="card form-stack" id="contactForm" novalidate>
      <div data-msg></div>
      <div class="field-row">
        <div class="field"><label for="cName">Your name</label><input id="cName" name="name" autocomplete="name" maxlength="100" required><div class="err"></div></div>
        <div class="field"><label for="cEmail">Email</label><input id="cEmail" name="email" type="email" autocomplete="email" maxlength="254" required><div class="err"></div></div>
      </div>
      <div class="field"><label for="cTopic">Topic</label>
        <select id="cTopic" name="topic"><option value="general">General question</option><option value="billing">Payment, invoice or refund</option><option value="technical">Something isn't working</option><option value="feedback">Feedback or an idea</option></select>
        <div class="err"></div></div>
      <div class="field"><label for="cMsg">Message</label><textarea id="cMsg" name="message" maxlength="5000" required></textarea>
        <div class="hint">For payments, please include your order or invoice number.</div><div class="err"></div></div>
      <div><button class="btn btn-primary" type="submit">${icon('send')} Send message</button></div>
    </form>
    <aside class="stack">
      <div class="card">
        <span class="card-icon">${icon('mail')}</span>
        <h2 style="font-size:21px">Email</h2>
        <p><a href="mailto:{{support.email}}" style="font-weight:500">{{support.email}}</a></p>
        <p>{{support.hours}}. We usually reply within {{support.replyDays}} working days; Premium and Lifetime members are answered first.</p>
      </div>
      <div class="card">
        <span class="card-icon brass">${icon('receipt')}</span>
        <h2 style="font-size:21px">Payments and refunds</h2>
        <p>Your payment history and invoices are in your account. Refund rules are in our <a href="/refund-policy">refund and cancellation policy</a>.</p>
      </div>
      <div class="card">
        <span class="card-icon">${icon('help')}</span>
        <h2 style="font-size:21px">Quick answers</h2>
        <p>Many questions are answered in the <a href="/faq">FAQ</a>.</p>
      </div>
    </aside>
  </div>
</div>
`;
