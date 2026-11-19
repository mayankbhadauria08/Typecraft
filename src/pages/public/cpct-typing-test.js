// /cpct-typing-test — Madhya Pradesh's CPCT typing test: rules, scale, practice, FAQ.
// Sources (checked 20 Nov 2026): the CPCT rule book for examinees (75 MCQs in 75 minutes, English and
// Hindi typing 15 minutes each, net words a minute on a scaled score, 50% to qualify = 30 NWPM
// English / 20 Hindi, Remington (GAIL) or Inscript in Unicode, Higher Secondary and 18+, any number of
// attempts), the 7-year validity of the score card (GAD order of 17 September 2021, as reported),
// practice guides on Backspace being off (the rule book doesn't cover it, and the page says so).
// The practice test is shared/exam-rules.js 'cpct'.
import { icon } from '../../layout.js';
import { factsTable, dataTable, faqSection, practiceNote, related } from './exam-seo.js';

export const meta = {
  path: '/cpct-typing-test',
  title: 'CPCT typing test: rules and free practice',
  ogTitle: 'MP CPCT typing test: rules, scores and practice · TypeCraft',
  description: 'MP CPCT typing test: 15 minutes each in English and Hindi, 30 net wpm in English to qualify, no Backspace. The score scale and a free practice test.',
  crumb: 'MP CPCT typing test',
  changefreq: 'monthly',
  priority: '0.8',
};

export const faq = [
  ['What is the passing speed in the CPCT typing test?',
    '30 net words a minute in English and 20 in Hindi. On the score card that is 50%, the mark that counts as qualified; faster typing scores higher, up to 100% above 80 net words a minute in English.'],
  ['Is Backspace allowed in the CPCT typing test?',
    'CPCT practice guides say Backspace is switched off in the typing tests, so a mistake stays where it is. CPCT\'s rule book doesn\'t cover it, so follow the instructions on screen on the day. Our practice test keeps Backspace off.'],
  ['How is net speed worked out?',
    'Net speed is your typing speed with your mistakes taken off. The rule book doesn\'t give CPCT\'s formula. Our practice uses the method many Indian typing tests publish: gross speed, less one word a minute for each mistake. <a href="/guides/gross-and-net-typing-speed">Gross and net speed, explained</a>.'],
  ['How long is a CPCT score card valid?',
    '7 years from the date of the exam. You get a score card for every attempt, and you can take CPCT again to improve your score.'],
  ['Which Hindi keyboard does CPCT use?',
    'You choose Remington (GAIL) or Inscript, and the text is in Unicode. TypeCraft doesn\'t teach Hindi typing yet.'],
  ['Is this the real CPCT software?',
    'No. It is a practice test made by TypeCraft in the style of the CPCT English typing test, with passages we wrote. Dates, rules and registration are on the official portal, <a href="https://cpct.mp.gov.in" rel="noopener">cpct.mp.gov.in</a>.'],
];

export default `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">Exam practice</span>
    <h1>MP CPCT typing test</h1>
    <p class="lede">The Computer Proficiency Certification Test (CPCT) is Madhya Pradesh's test of computer skills and typing, and its score card is asked for in state government recruitment for clerical and data entry posts. Its typing tests are 15 minutes long, and practice guides say Backspace is switched off in them, unlike SSC's.</p>
    <div class="actions"><a class="btn btn-primary" href="/exam-practice?test=cpct">${icon('play')} Start the English practice test</a><a class="btn btn-ghost" href="/guides/gross-and-net-typing-speed">Gross and net speed</a></div>
  </header>
</div>

<section class="section" style="padding-top:0" aria-labelledby="rules-h">
  <div class="container"><div style="max-width:760px">
    <h2 id="rules-h" class="section-title">The test at a glance</h2>
    ${factsTable('The CPCT at a glance', [
      ['Parts', '75 multiple-choice questions in 75 minutes, then an English typing test and a Hindi typing test.'],
      ['Typing time', '15 minutes for English and 15 for Hindi, each after a short practice round.'],
      ['Qualifying speed', '30 net words a minute in English, 20 in Hindi. The score card shows this as 50%.'],
      ['Backspace', 'Practice guides say it is switched off, so mistakes stay. The rule book doesn\'t cover it: follow the instructions on screen.'],
      ['Hindi keyboard', 'Remington (GAIL) or Inscript, your choice, in Unicode.'],
      ['Score card', 'One for every attempt, valid for 7 years from the exam date. You can take CPCT as many times as you like.'],
      ['Who can take it', 'Anyone 18 or older who has passed Higher Secondary (12th). The portal has the full rule.'],
    ])}
    <div style="margin-top:16px">${practiceNote('Dates, rules and registration are on the official portal, <a href="https://cpct.mp.gov.in" rel="noopener">cpct.mp.gov.in</a>.')}</div>
  </div></div>
</section>

<section class="section" aria-labelledby="scale-h">
  <div class="container split" style="align-items:start">
    <div class="prose">
      <h2 id="scale-h" style="margin-top:0">How the typing score is scaled</h2>
      <p>CPCT measures typing in net words a minute and turns it into a percentage on the score card. 50% is qualified; a recruitment notice may ask for more.</p>
      ${dataTable('CPCT typing score scale', ['Score', 'English, net wpm', 'Hindi, net wpm'], [
        ['50%', '30 to 40', '20 to 25'],
        ['60%', '41 to 50', '26 to 30'],
        ['70%', '51 to 60', '31 to 35'],
        ['80%', '61 to 70', '36 to 40'],
        ['90%', '71 to 80', '41 to 50'],
        ['100%', 'over 80', 'over 50'],
      ], [1, 2])}
      <p>Without Backspace, every slip stays in your typing and comes off your net speed. That makes CPCT a test of calm, even typing more than raw speed.</p>
    </div>
    <div class="card">
      <h3>Our practice test, next to the real one</h3>
      <ul class="ticks" style="font-size:15px">
        <li>${icon('check')}<span>15 minutes of English typing, with Backspace switched off.</span></li>
        <li>${icon('check')}<span>Two passages, about 4,000 key depressions, so you never run out of text.</span></li>
        <li>${icon('check')}<span>It passes you at 30 net words a minute over the full 15 minutes.</span></li>
        <li>${icon('info')}<span>English only: TypeCraft doesn't teach Hindi typing yet.</span></li>
        <li>${icon('info')}<span>On your own computer and keyboard, with passages written by TypeCraft.</span></li>
      </ul>
      <div class="actions" style="margin-top:16px"><a class="btn btn-primary btn-sm" href="/exam-practice?test=cpct">${icon('play')} Start the practice test</a></div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="ready-h">
  <div class="container"><div class="prose">
    <h2 id="ready-h" style="margin-top:0">Getting ready</h2>
    <ul>
      <li><b>Practise without Backspace.</b> If you rely on it, the real test will throw you. Our CPCT practice test keeps it off.</li>
      <li><b>Keep going after a mistake.</b> You can't fix it, so don't stop: carry on with the next word and keep your rhythm.</li>
      <li><b>Type without looking.</b> Looking down costs both speed and accuracy. The <a href="/app">TypeCraft course</a> teaches every key by touch.</li>
      <li><b>Build to 15 minutes.</b> Practise the full length so your speed holds to the end.</li>
    </ul>
  </div></div>
</section>

${faqSection(faq, 'CPCT typing test: questions')}
${related(meta.path)}
`;
