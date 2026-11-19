// /10-minute-typing-test — the typing test (site/js/typing-test.js) set to 10 minutes, with what ten
// minutes asks for in the exams and an FAQ. Figures are arithmetic: wpm x 5 x 10 key depressions.
import { icon } from '../../layout.js';
import { testWidget } from './typing-test.js';
import { dataTable, faqSection, related } from './exam-seo.js';

export const meta = {
  needsKeyboard: true,
  path: '/10-minute-typing-test',
  title: 'Free 10-minute typing test',
  ogTitle: '10-minute typing test, for exam practice · TypeCraft',
  description: 'A free 10-minute typing test with live words per minute and accuracy, the length of the SSC typing test. See the speed you can hold, not your best minute.',
  crumb: '10-minute typing test',
  changefreq: 'monthly',
  priority: '0.8',
};

export const faq = [
  ['Is the 10-minute typing test free?',
    'Yes, and you don\'t need an account. With a free account your results are saved to your history; the free plan saves a few tests a day.'],
  ['Why is my 10-minute speed lower than my 1-minute speed?',
    'Speed usually drops once the first burst wears off and your attention and hands tire. That is why exams use long tests, and why it pays to practise at full length: the speed you can hold for ten minutes is the one that counts.'],
  ['How is the speed worked out?',
    'Correctly typed characters, spaces included, divided by five, per minute. Exams usually mark whole words and take mistakes off instead: <a href="/guides/gross-and-net-typing-speed">gross and net speed</a> explains the difference.'],
  ['Which exams have a 10-minute typing test?',
    'SSC\'s typing test for LDC and JSA posts in the CHSL exam is 10 minutes, and many other recruitment typing tests are 10 or 15 minutes. SSC\'s data entry tests and Madhya Pradesh\'s CPCT are 15. Check the notice for your exam.'],
  ['Is there a test with a set passage, marked like an exam?',
    'Yes: <a href="/exam-practice">exam practice</a> has a 10-minute SSC-style test with a passage on screen, full and half mistakes, and gross and net speed.'],
];

export default `
<div class="container">
  <header class="page-head" style="padding-bottom:18px">
    <span class="eyebrow">Typing test</span>
    <h1>10-minute typing test</h1>
    <p class="lede">Ten minutes is the length of SSC's typing test for LDC and JSA posts. A long test shows the speed you can hold, not just your best minute. Click the sheet and start typing: the clock starts on your first key.</p>
  </header>
${testWidget(600)}
</div>

<section class="section" aria-labelledby="ten-h">
  <div class="container split" style="align-items:start">
    <div class="prose">
      <h2 id="ten-h" style="margin-top:0">What ten minutes asks for</h2>
      <p>Typing tests count five key depressions to a word. Over ten minutes, the speeds exams ask for come to these totals:</p>
      ${dataTable('Key depressions in 10 minutes at exam speeds', ['Speed', 'In 10 minutes'], [
        ['30 words a minute (SSC, Hindi)', '1,500'],
        ['35 words a minute (SSC, English)', '1,750'],
        ['8,000 key depressions an hour (SSC data entry)', 'about 1,333'],
        ['50 words a minute', '2,500'],
      ], [1])}
      <p>The figure on this test counts only correct characters, so it is a fair guide to whether you would reach those totals. Exams then look at your mistakes word by word.</p>
    </div>
    <div class="card">
      <h3>Practising for an exam?</h3>
      <p>This test gives you endless text and live speed. For an exam-style test with a set passage, marked with full and half mistakes, take the SSC-style test in exam practice.</p>
      <div class="actions" style="margin-top:12px"><a class="btn btn-primary btn-sm" href="/exam-practice?test=ssc-typing">${icon('play')} SSC-style 10-minute test</a><a class="btn btn-ghost btn-sm" href="/ssc-chsl-typing-test">SSC CHSL rules</a></div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="hold-h">
  <div class="container"><div class="prose">
    <h2 id="hold-h" style="margin-top:0">Holding your speed for ten minutes</h2>
    <ul>
      <li><b>Start a little below your best.</b> A pace you can keep beats a fast start that fades.</li>
      <li><b>Keep your eyes on the text.</b> Looking at the keys breaks your rhythm every time. The <a href="/app">course</a> teaches every key by touch.</li>
      <li><b>Sit well and relax your hands.</b> Tension shows up in the last few minutes.</li>
      <li><b>Take the full test regularly.</b> Long tests build the stamina that short bursts don't.</li>
    </ul>
  </div></div>
</section>

${faqSection(faq, '10-minute typing test: questions')}
${related(meta.path)}
`;
