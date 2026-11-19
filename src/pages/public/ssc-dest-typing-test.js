// /ssc-dest-typing-test — SSC's data entry tests: the DEST (CGL, Tax Assistant) and the DEO skill
// test (CHSL). Sources (checked 20 Nov 2026): the CGL notice (DEST, about 2,000 key depressions in
// 15 minutes, 8,000 an hour), the CHSL notices (DEO 8,000 an hour, 2,000-2,200 key depressions;
// DEO Grade 'A' in the departments of its para 8.1 15,000 an hour, 3,700-4,000; 15 minutes, 20 for
// candidates eligible for a scribe; judged on correct entry; printed matter in English, which may
// also be shown on screen), SSC's revised guidelines for evaluating typing test and DEST scripts.
// The practice test is shared/exam-rules.js 'ssc-dest'.
import { icon } from '../../layout.js';
import { factsTable, dataTable, faqSection, practiceNote, related } from './exam-seo.js';

export const meta = {
  path: '/ssc-dest-typing-test',
  title: 'SSC DEST and DEO skill test: rules and practice',
  ogTitle: 'SSC DEST and DEO skill test: rules and practice · TypeCraft',
  description: 'The SSC data entry test for Tax Assistant (CGL) and DEO (CHSL) posts: 8,000 key depressions an hour for 15 minutes. What it asks, and a free practice test.',
  crumb: 'SSC DEST and DEO skill test',
  changefreq: 'monthly',
  priority: '0.8',
};

export const faq = [
  ['What is the SSC DEST?',
    'The Data Entry Speed Test: a 15-minute skill test for Tax Assistant posts in the SSC CGL exam. The skill test for Data Entry Operators in the CHSL exam asks for the same speed over the same time.'],
  ['How many words a minute is 8,000 key depressions an hour?',
    'About 27. Divide by 60 for a minute (133 key depressions) and by 5 for words (26.7). Over the 15 minutes of the test it comes to 2,000 key depressions. <a href="/guides/key-depressions-per-hour">Key depressions, explained</a>.'],
  ['Do mistakes count in the DEST?',
    'Yes. The test is judged on correct entry, so a wrong word adds nothing to your count, and SSC\'s guidelines for evaluating typing test and DEST scripts list full and half mistakes. <a href="/guides/ssc-typing-test-marking">How the marking works</a>.'],
  ['Can I use Backspace in the data entry test?',
    'Yes, you can correct mistakes while time is left. Read the instructions on screen on the day for the details, such as whether you can move back to earlier lines.'],
  ['Is the passage in English or Hindi?',
    'In English, for both the DEST and the DEO skill test.'],
  ['Is there practice for the 15,000 key depressions test?',
    'Not as a set test yet. 15,000 an hour is about 50 words a minute, so take the <a href="/typing-test?d=900">15-minute typing test</a> and aim for 50 words a minute with high accuracy.'],
];

export default `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">Exam practice</span>
    <h1>SSC DEST and DEO skill test</h1>
    <p class="lede">Some SSC posts ask for a data entry test instead of a typing test: Tax Assistant in the CGL exam takes the Data Entry Speed Test (DEST), and Data Entry Operator (DEO) in the CHSL exam takes a skill test. Both are measured in key depressions an hour, not words a minute, and both count only what you enter correctly.</p>
    <div class="actions"><a class="btn btn-primary" href="/exam-practice?test=ssc-dest">${icon('play')} Start the practice test</a><a class="btn btn-ghost" href="/guides/key-depressions-per-hour">Key depressions, explained</a></div>
  </header>
</div>

<section class="section" style="padding-top:0" aria-labelledby="rules-h">
  <div class="container"><div style="max-width:760px">
    <h2 id="rules-h" class="section-title">The test at a glance</h2>
    ${factsTable('The SSC data entry tests at a glance', [
      ['Which posts', '<b>CGL:</b> Tax Assistant (CBIC and CBDT), the Data Entry Speed Test. <b>CHSL:</b> Data Entry Operator (DEO and DEO Grade A), the skill test.'],
      ['Speed', '8,000 key depressions an hour. For DEO Grade A posts in the few departments the CHSL notice names, 15,000 an hour.'],
      ['Time', '15 minutes. Candidates eligible for a scribe get extra time: check your notice.'],
      ['Passage', 'In English: about 2,000 key depressions in CGL, 2,000 to 2,200 for the CHSL DEO test, and 3,700 to 4,000 for the 15,000-an-hour test. It may be printed on paper or shown on screen.'],
      ['How it is judged', 'In the notice\'s words, on the correct entry of words and key depressions from the passage. Typing fast with mistakes doesn\'t pass you.'],
      ['Result', 'Qualifying: pass or fail. It adds no marks.'],
    ])}
    <div style="margin-top:16px">${practiceNote('The notice for your exam on <a href="https://ssc.gov.in" rel="noopener">ssc.gov.in</a> has the final word on its rules.')}</div>
  </div></div>
</section>

<section class="section" aria-labelledby="speed-h">
  <div class="container split" style="align-items:start">
    <div class="prose">
      <h2 id="speed-h" style="margin-top:0">What the speed means in practice</h2>
      <p>A key depression is one character entered: a letter, a figure, a punctuation mark or a space. 8,000 an hour sounds like a lot, but over 15 minutes it is 2,000, about 133 a minute. At five key depressions to a word, that is roughly 27 words a minute.</p>
      ${dataTable('Data entry speeds over 15 minutes', ['Speed asked for', 'In 15 min', 'wpm'], [
        ['8,000 an hour (DEST, DEO)', '2,000', '27'],
        ['15,000 an hour (DEO Grade A, some departments)', '3,750', '50'],
      ], [1, 2])}
      <p>The catch is the word <i>correct</i>. Only what you enter correctly counts towards the speed, so steady, accurate typing passes where fast, careless typing fails.</p>
    </div>
    <div class="card">
      <h3>Our practice test, next to the real one</h3>
      <ul class="ticks" style="font-size:15px">
        <li>${icon('check')}<span>15 minutes, with a passage of about 2,250 key depressions on screen.</span></li>
        <li>${icon('check')}<span>Backspace works, and you can't type more words than the passage has.</span></li>
        <li>${icon('check')}<span>It passes you at 2,000 correct key depressions: the letters and spaces of the words you typed exactly right.</span></li>
        <li>${icon('info')}<span>It practises the 8,000-an-hour test. For 15,000 an hour, use the 15-minute <a href="/typing-test?d=900">typing test</a> and aim for 50 words a minute.</span></li>
        <li>${icon('info')}<span>On your own computer and keyboard, with passages written by TypeCraft.</span></li>
      </ul>
      <div class="actions" style="margin-top:16px"><a class="btn btn-primary btn-sm" href="/exam-practice?test=ssc-dest">${icon('play')} Start the practice test</a></div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="ready-h">
  <div class="container"><div class="prose">
    <h2 id="ready-h" style="margin-top:0">Getting ready</h2>
    <ul>
      <li><b>Accuracy first.</b> Only correct entries count, so a mistake costs you the whole word. Slow down until your mistakes are rare, then build speed.</li>
      <li><b>Know the number keys.</b> Data entry passages often have figures and dates. The <a href="/app">TypeCraft course</a> teaches the number row, and its Pro track the numpad.</li>
      <li><b>Practise the full 15 minutes.</b> Your speed over 15 minutes is what counts, not your fastest minute.</li>
      <li><b>Copy numbers exactly.</b> Type figures and years as the passage gives them: a figure typed differently is a mistake.</li>
    </ul>
  </div></div>
</section>

${faqSection(faq, 'SSC DEST and DEO: questions')}
${related(meta.path)}
`;
