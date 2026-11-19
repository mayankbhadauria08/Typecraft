// /exam-practice — practice tests in the style of Indian government typing tests (docs/EXAM-MODES.md).
// The tests, passages and marking are shared/exam-rules.js; the page script is site/js/exam-practice.js.
import { icon, esc } from '../../layout.js';
import '../../../shared/exam-passages.js';
import '../../../shared/exam-rules.js';

const X = globalThis.TC_EXAMS;

export const meta = {
  needsKeyboard: true,   // phones see a note offering to send the link to a computer
  path: '/exam-practice',
  title: 'Typing exam practice: SSC typing test, SSC data entry (DEST) and CPCT',
  ogTitle: 'Typing exam practice · TypeCraft',
  description: 'Free practice tests in the style of the SSC typing test (35 wpm in 10 minutes), the SSC data entry test (8,000 key depressions an hour) and the CPCT English typing test, marked with full and half mistakes.',
  changefreq: 'monthly',
};

const fmt = (n) => Number(n).toLocaleString('en-IN');
function card(m) {
  const passages = X.passages(m.id);
  const strokes = Math.min(...passages.map((p) => p.text.length));
  const rows = [
    ['Time', `${m.minutes} minutes`],
    ['Passage', `about ${fmt(Math.round(strokes / 50) * 50)} key depressions, on screen`],
    ['Backspace', m.backspace ? 'works, to correct mistakes' : 'turned off: mistakes stay'],
    ['Words', m.wordLimit ? 'only as many as the passage has' : 'no limit'],
    ['Goal', m.goal],
  ];
  return `<article class="card ex-card" aria-labelledby="ex-${m.id}">
    <div class="card-head"><div><h2 id="ex-${m.id}">${esc(m.name)}</h2><p class="muted ex-for">For ${esc(m.posts)}</p></div></div>
    <dl class="ex-facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <div class="card-foot"><span class="muted ex-count">${passages.length} passages</span><button type="button" class="btn btn-primary" data-start="${m.id}">${icon('play')} Start this test</button></div>
  </article>`;
}

export default `
<div class="container">
  <header class="page-head ex-head" id="exIntro">
    <span class="eyebrow">Exam practice</span>
    <h1>Practise for government typing tests</h1>
    <p class="lede">Full-length tests in the style of the typing tests Indian recruitment exams use, marked the way those tests are usually marked: full and half mistakes, gross and net speed, key depressions an hour.</p>
    <p class="muted ex-note">These are practice tests made by TypeCraft, not the exams' own software. Each exam's notice has the final word on its rules, so check yours.</p>
  </header>

  <section class="ex-cards" id="exChoose" aria-label="Choose a test">
    ${X.ORDER.map((id) => card(X.MODES[id])).join('')}
  </section>

  <section class="ex-test" id="exTest" hidden aria-labelledby="exTestName">
    <div class="ex-bar">
      <div class="ex-bar-name"><h2 id="exTestName"></h2><p class="muted" id="exTestRules"></p></div>
      <div class="ex-bar-live" aria-live="off">
        <div class="ex-clock"><span class="stat-label">Time left</span><span class="mono" id="exClock"></span></div>
        <div class="ex-clock" id="exWordsWrap"><span class="stat-label">Words left</span><span class="mono" id="exWords"></span></div>
        <button type="button" class="btn btn-primary" id="exSubmit">Submit</button>
        <button type="button" class="btn btn-ghost btn-sm" id="exLeave">Choose another test</button>
      </div>
    </div>
    <div class="ex-panes">
      <div class="ex-pane">
        <div class="ex-pane-head"><span class="stat-label">Passage</span><span class="muted" id="exPassageTitle"></span></div>
        <div class="ex-passage" id="exPassage" tabindex="0" aria-label="The passage to type"></div>
      </div>
      <div class="ex-pane">
        <div class="ex-pane-head"><label class="stat-label" for="exInput">Type here</label><span class="muted" id="exStartHint">The clock starts on your first key.</span></div>
        <textarea class="ex-input" id="exInput" rows="10" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
        <p class="muted ex-keys" id="exKeysNote" aria-live="polite"></p>
      </div>
    </div>
  </section>

  <section class="card ex-result" id="exResult" hidden tabindex="-1" aria-labelledby="exResultH">
    <div class="card-head"><div><span class="eyebrow">Result</span><h2 id="exResultH">Your result</h2></div><span class="badge" id="exBadge"></span></div>
    <div class="alert" id="exVerdict"></div>
    <div class="ex-stats" id="exStats"></div>
    <div id="exSave" aria-live="polite"></div>
    <div id="exCert"></div>
    <details class="ex-mistakes" id="exMistakesWrap"><summary id="exMistakesSum">Mistakes</summary><div id="exMistakes"></div></details>
    <div class="actions"><button type="button" class="btn btn-primary" id="exAgain">${icon('refresh')} Take it again</button><button type="button" class="btn btn-ghost" id="exOther">Choose another test</button></div>
  </section>

  <section class="section ex-history" id="exHistory" hidden aria-labelledby="exHistoryH">
    <h2 id="exHistoryH">Your recent attempts</h2>
    <div id="exHistoryBody"></div>
  </section>
</div>

<section class="section" aria-labelledby="ex-how-h">
  <div class="container split ex-how">
    <div class="prose">
      <h2 id="ex-how-h">How the marks are worked out</h2>
      <p><b>Full mistake:</b> a word left out, a wrong or misspelt word, or an extra word. A word counts one full mistake at most.</p>
      <p><b>Half mistake:</b> the right word with wrong capitals or punctuation, two words run together without a space, or a space inside a word.</p>
      <p><b>Gross speed</b> is every key depression typed, divided by five, per minute. <b>Net speed</b> takes away one word a minute for each mistake. <b>Correct key depressions</b> are the letters and spaces of the words typed exactly right.</p>
      <p>Your typing is lined up with the passage first, so one skipped word does not make every word after it wrong. What is left of the passage when time runs out does not count against you.</p>
    </div>
    <div class="card">
      <h3>Certificates you can check</h3>
      <p>Meet a test's goal with a free account and you can get a certificate with a code. Anyone you give the code to can check it on the <a href="/verify">verify page</a>: it shows your name, the result and the date.</p>
      <p class="muted">The tests are taken online without supervision, and the certificate says so.</p>
    </div>
  </div>
</section>
`;
