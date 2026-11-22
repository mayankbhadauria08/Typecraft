// /guides — the typing guides and exam pages in one place (src/pages/public/exam-seo.js lists them).
import { linkCards, EXAM_PAGES, GUIDES } from './exam-seo.js';

export const meta = {
  path: '/guides',
  title: 'Typing test guides',
  ogTitle: 'Typing test guides for Indian exams · TypeCraft',
  description: 'Plain guides to Indian typing exams: how the SSC typing test is marked, key depressions per hour, and gross and net speed. With the rules for each exam.',
  changefreq: 'monthly',
  priority: '0.6',
};

export default `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">Guides</span>
    <h1>Typing test guides</h1>
    <p class="lede">How Indian typing exams are marked and measured, in plain words, with worked examples. Each guide links to a practice test you can take straight away.</p>
  </header>
  <section aria-labelledby="g-h" style="padding-bottom:40px">
    <h2 id="g-h" class="section-title">Guides</h2>
    ${linkCards(GUIDES)}
  </section>
  <section aria-labelledby="e-h" style="padding-bottom:24px">
    <h2 id="e-h" class="section-title">Exam pages</h2>
    ${linkCards(EXAM_PAGES)}
    <p class="muted" style="margin-top:16px">Ready to practise? <a href="/exam-practice">Exam practice</a> has three full-length tests marked with full and half mistakes, and the <a href="/typing-test">typing test</a> checks your speed in anything from 15 seconds to 15 minutes.</p>
  </section>
</div>
`;
