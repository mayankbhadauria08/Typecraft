import { FAQ, faqList } from './faq-data.js';
import { icon } from '../../layout.js';

export const meta = {
  path: '/faq',
  title: 'Frequently asked questions',
  description: 'Answers about learning touch typing with TypeCraft, the free plan, one-time payments, refunds, invoices and your account.',
};

export default `
<div class="container narrow">
  <header class="page-head">
    <span class="eyebrow">FAQ</span>
    <h1>Questions, answered plainly</h1>
    <p class="lede">Can't find what you need? <a href="/contact">Write to us</a> and a person will reply.</p>
    <nav class="toc" aria-label="Sections"><a href="#learning">Learning</a><a href="#plans">Plans and payments</a><a href="#account">Your account</a></nav>
  </header>
  <section class="section" style="padding-top:0" aria-labelledby="learning"><h2 id="learning" style="margin-bottom:12px">Learning</h2>${faqList(FAQ.learning)}</section>
  <section class="section" aria-labelledby="plans"><h2 id="plans" style="margin-bottom:12px">Plans and payments</h2>${faqList(FAQ.plans)}</section>
  <section class="section" aria-labelledby="account"><h2 id="account" style="margin-bottom:12px">Your account</h2>${faqList(FAQ.account)}</section>
  <div class="alert alert-info" style="margin-bottom:24px">${icon('mail')}<div>Still have a question? Email <a href="mailto:{{support.email}}">{{support.email}}</a> or use the <a href="/contact">contact form</a>. We usually reply within {{support.replyDays}} working days.</div></div>
</div>
`;
