// /typing-test — a timed typing test with live speed and accuracy (site/js/typing-test.js), its FAQ,
// and links to the exam pages. testWidget() is also used by /10-minute-typing-test.
import { icon } from '../../layout.js';
import { faqSection, linkCards, EXAM_PAGES, GUIDES } from './exam-seo.js';

/** Test lengths in seconds. The server keeps tests up to 900 s (src/billing.js postTest). */
export const LENGTHS = [[15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min'], [600, '10 min'], [900, '15 min']];
const clock = (d) => (d > 120 ? `${Math.floor(d / 60)}:00` : `${d}<small>s</small>`);

export const meta = {
  needsKeyboard: true,   // phones see a note offering to send the link to a computer
  path: '/typing-test',
  title: 'Free typing speed test (WPM and accuracy)',
  ogTitle: 'Typing speed test · TypeCraft',
  description: 'Check your typing speed in 15 seconds to 15 minutes. Live words per minute and accuracy, no sign-up needed. Save your results with a free account.',
  crumb: 'Typing test',
  changefreq: 'weekly',
};

export const faq = [
  ['How is typing speed worked out?',
    'Correctly typed characters, spaces included, divided by five (the usual length of a "word"), per minute. Accuracy is the share of all the keys you pressed that were right, so a mistake counts even after you fix it.'],
  ['What speed do government typing tests ask for?',
    'SSC\'s typing test for LDC and JSA asks for 35 words a minute in English or 30 in Hindi, over 10 minutes. Its data entry tests ask for 8,000 key depressions an hour, about 27 words a minute. Madhya Pradesh\'s CPCT asks for 30 net words a minute in English. The <a href="/exam-practice">exam pages</a> have the details.'],
  ['Why is my speed here different from an exam result?',
    'Exams usually mark whole words: a word with a mistake in it is a full or half mistake, and net speed takes mistakes off your gross speed. This test counts characters. <a href="/guides/gross-and-net-typing-speed">Gross and net speed</a> explains the difference.'],
  ['Which length should I take?',
    'One minute is a quick check. For exam practice, take the length of your exam: <a href="/10-minute-typing-test">10 minutes</a> for the SSC typing test, 15 minutes for data entry tests and CPCT.'],
  ['Do I need an account?',
    'No. Anyone can take the test. With a free account your results are saved to your history, so you can see your speed change; the free plan saves a few tests a day.'],
  ['Can I take it on my phone?',
    'It needs a physical keyboard. Use a computer, or a tablet with a keyboard attached.'],
];

/** The test itself, with `selected` seconds chosen. ?d=<seconds> in the address picks another listed length. */
export function testWidget(selected = 60) {
  return `
  <section class="tt" id="tt" aria-label="Typing test">
    <div class="tt-bar">
      <div class="tabs" role="group" aria-label="Test length" id="ttDur">
        ${LENGTHS.map(([d, label]) => `<button type="button" data-d="${d}" aria-pressed="${d === selected}">${label}</button>`).join('')}
      </div>
      <div class="tabs" role="group" aria-label="Text" id="ttKind">
        <button type="button" data-k="words" aria-pressed="true">Common words</button>
        <button type="button" data-k="quotes" aria-pressed="false">Sentences</button>
        <button type="button" data-k="numbers" aria-pressed="false">With numbers</button>
      </div>
    </div>

    <div class="tt-live" aria-live="off">
      <div class="stat"><span class="stat-label">Time left</span><span class="stat-value" id="ttTime">${clock(selected)}</span></div>
      <div class="stat"><span class="stat-label">Speed</span><span class="stat-value" id="ttWpm">0<small>wpm</small></span></div>
      <div class="stat"><span class="stat-label">Accuracy</span><span class="stat-value" id="ttAcc">100<small>%</small></span></div>
      <div class="stat"><span class="stat-label">Errors</span><span class="stat-value" id="ttErr">0</span></div>
    </div>

    <div class="tt-box" id="ttBox">
      <div class="tt-window"><div class="tt-words" id="ttWords" aria-hidden="true"></div></div>
      <textarea class="tt-input" id="ttInput" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Type the text shown here. The test starts on your first key."></textarea>
      <div class="tt-hint" id="ttHint">${icon('keyboard')}&nbsp; Click here and start typing</div>
    </div>
    <div class="row-between">
      <span class="muted" style="font-size:14px"><span class="kbd">Tab</span> then <span class="kbd">Enter</span> restarts · <span class="kbd">Esc</span> stops</span>
      <button type="button" class="btn btn-ghost btn-sm" id="ttRestart">${icon('refresh')} New text</button>
    </div>

    <div class="card tt-result" id="ttResult" hidden tabindex="-1" aria-labelledby="ttResultH">
      <div class="card-head"><div><span class="eyebrow">Result</span><h2 id="ttResultH" style="margin-top:8px">Your typing speed</h2></div><span class="badge badge-muted mono" id="ttResLen"></span></div>
      <div class="tt-big">
        <div class="stat"><span class="stat-label">Speed</span><span class="stat-value" id="rWpm">0</span><span class="stat-sub">words per minute</span></div>
        <div class="stat"><span class="stat-label">Accuracy</span><span class="stat-value" id="rAcc">0</span><span class="stat-sub">of keys pressed</span></div>
        <div class="stat"><span class="stat-label">Raw speed</span><span class="stat-value" id="rRaw">0</span><span class="stat-sub">including mistakes</span></div>
        <div class="stat"><span class="stat-label">Characters</span><span class="stat-value" id="rChars">0</span><span class="stat-sub" id="rErrs">0 errors</span></div>
      </div>
      <p id="rVerdict" class="lede" style="font-size:16px"></p>
      <div id="rSave" aria-live="polite"></div>
      <div class="actions"><button type="button" class="btn btn-primary" id="ttAgain">${icon('refresh')} Try again</button><a class="btn btn-ghost" href="/practice">How to get faster</a></div>
    </div>
  </section>`;
}

export default `
<div class="container">
  <header class="page-head" style="padding-bottom:18px">
    <span class="eyebrow">Typing test</span>
    <h1>How fast do you type?</h1>
    <p class="lede">Pick a length, click the sheet and start typing. The clock starts on your first key. Mistakes stay on the page, as in a real test; you can fix them with Backspace.</p>
  </header>
${testWidget(60)}
</div>

<section class="section" aria-labelledby="how-h">
  <div class="container split" style="align-items:start">
    <div class="prose">
      <h2 id="how-h" style="margin-top:0">How the score is worked out</h2>
      <p><b>Speed</b> counts correctly typed characters, divided by five (the standard length of a "word"), per minute. Spaces count as characters.</p>
      <p><b>Accuracy</b> is the share of all the keys you pressed that were right, so a mistake still counts against you even after you fix it.</p>
      <p><b>Raw speed</b> counts every character you typed, right or wrong. A big gap between raw speed and speed means slowing down a little would make you faster.</p>
    </div>
    <div class="card">
      <h3>What's a good speed?</h3>
      <ul class="ticks" style="font-size:15px">
        <li>${icon('chevronRight')}<span><b class="mono">Under 25 wpm</b> — usually still looking at the keys. The course will help most here.</span></li>
        <li>${icon('chevronRight')}<span><b class="mono">25–40 wpm</b> — typical for everyday typists.</span></li>
        <li>${icon('chevronRight')}<span><b class="mono">40–60 wpm</b> — comfortable touch typing; enough for most office and exam tests.</span></li>
        <li>${icon('chevronRight')}<span><b class="mono">60+ wpm</b> — fast. Accuracy matters more than raw speed from here.</span></li>
      </ul>
      <p style="font-size:14px">Exam rules vary: check the speed and accuracy your test asks for, and practise at that length.</p>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="exams-h">
  <div class="container">
    <h2 id="exams-h" class="section-title">Practising for a typing exam?</h2>
    ${linkCards(EXAM_PAGES, '/typing-test')}
    <h3 style="margin:28px 0 14px">Guides</h3>
    ${linkCards(GUIDES)}
  </div>
</section>

${faqSection(faq, 'Typing test: questions')}
`;
