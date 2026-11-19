// /ssc-chsl-typing-test — the SSC CHSL typing test (LDC, JSA): rules, marking, practice, FAQ.
// Sources (checked 20 Nov 2026): the CHSL notices (35/30 wpm, 10,500/9,000 key depressions an hour,
// 10 minutes, 5 more for candidates eligible for a scribe, qualifying), SSC's revised guidelines for
// evaluating typing test and DEST scripts (20 June 2022), the CHSL 2023 Tier II typing instructions
// (a 10-minute practice round first). The practice test is shared/exam-rules.js 'ssc-typing'.
import { icon } from '../../layout.js';
import { factsTable, faqSection, practiceNote, related } from './exam-seo.js';

export const meta = {
  path: '/ssc-chsl-typing-test',
  title: 'SSC CHSL typing test: rules and free practice',
  ogTitle: 'SSC CHSL typing test: rules, marking and practice · TypeCraft',
  description: 'SSC CHSL typing test for LDC and JSA: 35 wpm in English or 30 in Hindi in 10 minutes. The rules, how it is marked, and a free full-length practice test.',
  crumb: 'SSC CHSL typing test',
  changefreq: 'monthly',
  priority: '0.8',
};

export const faq = [
  ['Is the SSC CHSL typing test qualifying?',
    'Yes. It is pass or fail and adds no marks: your rank comes from the Tier 2 papers. But you have to pass it to be selected for an LDC or JSA post.'],
  ['What typing speed do I need for SSC CHSL?',
    '35 words a minute in English, or 30 in Hindi. SSC counts five key depressions to a word, so that is about 10,500 or 9,000 key depressions an hour, or about 1,750 key depressions in the 10 minutes in English.'],
  ['Can I use Backspace in the SSC typing test?',
    'Yes. Backspace and the arrow keys work, so you can correct a mistake while there is time left. A mistake you leave in is marked.'],
  ['How many mistakes are allowed?',
    'The CHSL notice sets the speed but does not print one error allowance for the typing test, and coaching websites quote different figures, some by category. Our practice test passes you only at 5% mistakes or less, the strictest figure quoted, so a pass here leaves you room. <a href="/guides/ssc-typing-test-marking">How the marking works</a>.'],
  ['What if I finish the passage before the 10 minutes are up?',
    'You don\'t type it again. Use the time left to read back over your typing and correct mistakes, as SSC\'s guidelines allow.'],
  ['Can I practise for the Hindi typing test here?',
    'Not yet. TypeCraft\'s practice tests are in English for now.'],
  ['Is this the real SSC test software?',
    'No. It is a practice test made by TypeCraft in the style of the SSC test, with passages we wrote. The notice for your exam on <a href="https://ssc.gov.in" rel="noopener">ssc.gov.in</a> has the final word on the rules.'],
];

export default `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">Exam practice</span>
    <h1>SSC CHSL typing test</h1>
    <p class="lede">Candidates for Lower Division Clerk (LDC) and Junior Secretariat Assistant (JSA) posts in the SSC Combined Higher Secondary Level exam take a typing test in Tier 2. It adds no marks, but you must pass it. Here are its rules, how your typing is marked, and a full-length test to practise on.</p>
    <div class="actions"><a class="btn btn-primary" href="/exam-practice?test=ssc-typing">${icon('play')} Start the practice test</a><a class="btn btn-ghost" href="/guides/ssc-typing-test-marking">How the marking works</a></div>
  </header>
</div>

<section class="section" style="padding-top:0" aria-labelledby="rules-h">
  <div class="container"><div style="max-width:760px">
    <h2 id="rules-h" class="section-title">The test at a glance</h2>
    ${factsTable('The SSC CHSL typing test at a glance', [
      ['Who takes it', 'LDC and JSA candidates, in Tier 2. Data Entry Operator candidates take a <a href="/ssc-dest-typing-test">data entry skill test</a> instead.'],
      ['Speed', '35 words a minute in English, or 30 in Hindi. SSC counts five key depressions to a word, so this is about 10,500 or 9,000 key depressions an hour.'],
      ['Time', '10 minutes. Candidates eligible for a scribe get 5 minutes more.'],
      ['Passage', 'Shown on the screen. In English, 35 words a minute for 10 minutes comes to about 1,750 key depressions.'],
      ['Language', 'English or Hindi, the one you chose. Typing in the other language earns no credit.'],
      ['Corrections', 'Backspace and the arrow keys work, so you can correct mistakes while time is left.'],
      ['Practice round', 'Recent tests have started with a practice round on the same software: 10 minutes in CHSL 2023.'],
      ['Result', 'Qualifying: pass or fail. It does not add to your Tier 2 marks.'],
    ])}
    <div style="margin-top:16px">${practiceNote('The notice for your exam on <a href="https://ssc.gov.in" rel="noopener">ssc.gov.in</a> has the final word on its rules.')}</div>
  </div></div>
</section>

<section class="section" aria-labelledby="marking-h">
  <div class="container split" style="align-items:start">
    <div class="prose">
      <h2 id="marking-h" style="margin-top:0">How your typing is marked</h2>
      <p>Your typing is compared with the passage word by word. SSC's guidelines for evaluating typing tests, revised in June 2022, sort the differences into two kinds.</p>
      <p><b>Full mistakes</b> are the serious ones: a word left out, a wrong or misspelt word, an extra or repeated word, or a word left half typed.</p>
      <p><b>Half mistakes</b> are the smaller ones: a wrong capital letter, wrong or missing punctuation, a missing space between words or a space inside a word, two words swapped, or a paragraph not started with the Tab key.</p>
      <p>Speed is the other half of the result. In English you need about 1,750 key depressions in the 10 minutes. The <a href="/guides/ssc-typing-test-marking">marking guide</a> works through an example, and <a href="/guides/gross-and-net-typing-speed">gross and net speed</a> explains the speed figures.</p>
    </div>
    <div class="card">
      <h3>Our practice test, next to the real one</h3>
      <ul class="ticks" style="font-size:15px">
        <li>${icon('check')}<span>10 minutes, with a passage of about 1,800 key depressions on screen.</span></li>
        <li>${icon('check')}<span>Backspace works, and you can't type more words than the passage has.</span></li>
        <li>${icon('check')}<span>Marked with full and half mistakes, gross and net speed. It passes you at 1,750 key depressions with mistakes at 5% of the words or less.</span></li>
        <li>${icon('info')}<span>English only for now. Two swapped words count as two mistakes here, where SSC counts a half mistake.</span></li>
        <li>${icon('info')}<span>On your own computer and keyboard, with passages written by TypeCraft.</span></li>
      </ul>
      <div class="actions" style="margin-top:16px"><a class="btn btn-primary btn-sm" href="/exam-practice?test=ssc-typing">${icon('play')} Start the practice test</a></div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="ready-h">
  <div class="container"><div class="prose">
    <h2 id="ready-h" style="margin-top:0">Getting ready</h2>
    <ul>
      <li><b>Type without looking first.</b> If you still look at the keys, speed stops rising early. The <a href="/app">TypeCraft course</a> teaches every key by touch, from the home row up.</li>
      <li><b>Practise at full length.</b> Ten minutes is long; speed usually drops once the first burst wears off. Take the whole test, or the <a href="/10-minute-typing-test">10-minute typing test</a>, rather than one-minute bursts.</li>
      <li><b>Watch capitals and punctuation.</b> Each one wrong is a half mistake, and they add up quickly.</li>
      <li><b>Leave time to read back.</b> If you finish early, check your typing against the passage and correct it.</li>
      <li><b>Work on your weak keys.</b> The course's coach finds the keys you miss most and builds drills from them.</li>
    </ul>
  </div></div>
</section>

${faqSection(faq, 'SSC CHSL typing test: questions')}
${related(meta.path)}
`;
