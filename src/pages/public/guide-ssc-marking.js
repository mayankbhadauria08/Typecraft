// /guides/ssc-typing-test-marking — how SSC marks typing tests and DEST scripts: full and half
// mistakes from SSC's revised evaluation guidelines (20 June 2022), a worked example that
// shared/exam-rules.js marks the same way (tests/exam-pages.test.mjs checks it), and where
// TypeCraft's practice test differs.
import { icon } from '../../layout.js';
import { dataTable, related, CHECKED, CHECKED_TEXT } from './exam-seo.js';

export const meta = {
  path: '/guides/ssc-typing-test-marking',
  title: 'How the SSC typing test is marked',
  headline: 'How the SSC typing test is marked: full and half mistakes',
  ogTitle: 'How the SSC typing test is marked: full and half mistakes · TypeCraft',
  ogType: 'article',
  description: 'Full and half mistakes in the SSC typing test and DEST, from SSC\'s own guidelines, with a worked example of how a typed passage is marked.',
  crumb: 'How the SSC typing test is marked',
  published: CHECKED,
  changefreq: 'monthly',
  priority: '0.6',
};

/** The worked example: the test checks these against shared/exam-rules.js. */
export const EXAMPLE = {
  passage: 'The new office opens on Monday, and every visitor must bring a valid photo identity card to the front desk.',
  typed: 'The new office opens on Monday and every vistor must bring a valid photoidentity card to the the Front desk.',
  full: 2, half: 3, words: 20,
};

const SSC_GUIDELINES = 'https://sscer.org/matter/TypeDEST_Guidelines_20062022';

export default `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">Guide</span>
    <h1>How the SSC typing test is marked</h1>
    <p class="lede">SSC marks its typing tests and data entry tests the same way: your typing is compared with the passage word by word, and each difference is a full mistake or a half mistake. Here is what counts as which, with a worked example.</p>
    <p class="updated" style="font:500 12.5px/1.3 var(--mono);color:var(--muted)">Checked against SSC's guidelines on ${CHECKED_TEXT}</p>
  </header>

  <article class="prose" style="padding-bottom:24px">
    <h2>Full mistakes</h2>
    <p>SSC's <a href="${SSC_GUIDELINES}" rel="noopener">revised guidelines for evaluating typing test and DEST scripts</a> (20 June 2022) count one full mistake for each of these:</p>
    <ul>
      <li>a word or figure left out;</li>
      <li>a wrong word or figure typed in place of the right one;</li>
      <li>a word or figure added that isn't in the passage, or one typed twice;</li>
      <li>a spelling mistake: a letter added, left out, changed or repeated;</li>
      <li>a word left incomplete;</li>
      <li>anything typed that has nothing to do with the passage.</li>
    </ul>

    <h2>Half mistakes</h2>
    <p>These count as half a mistake each:</p>
    <ul>
      <li>spacing: no space between two words, or a space inside a word;</li>
      <li>a wrong capital letter (not in Hindi typing);</li>
      <li>punctuation left out, added or changed;</li>
      <li>two words swapped round;</li>
      <li>a paragraph not started with the Tab key.</li>
    </ul>

    <h2>Other rules worth knowing</h2>
    <ul>
      <li>Type figures and years exactly as the passage gives them. Writing them another way is a mistake.</li>
      <li>Put one space after a punctuation mark.</li>
      <li>Type in the language you chose. Typing in the other one earns no credit.</li>
      <li>If you finish the passage early, you don't type it again: use the time left to read back and correct.</li>
    </ul>

    <h2>A worked example</h2>
    <p>Here is one sentence of a passage, and what a candidate typed:</p>
    <div class="card" style="gap:10px">
      <p><b>Passage:</b> ${EXAMPLE.passage}</p>
      <p><b>Typed:</b> ${EXAMPLE.typed}</p>
    </div>
    <p>Word by word, the differences are:</p>
    ${dataTable('The mistakes in the example', ['Passage', 'Typed', 'Mistake'], [
      ['Monday,', 'Monday', 'half: punctuation left out'],
      ['visitor', 'vistor', 'full: spelling'],
      ['photo identity', 'photoidentity', 'half: no space between words'],
      ['the', 'the the', 'full: a word typed twice'],
      ['front', 'Front', 'half: wrong capital'],
    ])}
    <p>That is ${EXAMPLE.full} full mistakes and ${EXAMPLE.half} half mistakes: ${EXAMPLE.full} + ${EXAMPLE.half} ÷ 2 = <b>${EXAMPLE.full + EXAMPLE.half / 2} mistakes</b>. The sentence has ${EXAMPLE.words} words, so that is ${(100 * (EXAMPLE.full + EXAMPLE.half / 2) / EXAMPLE.words).toFixed(1)}% of them. Three of the five mistakes are small slips of capitals, spaces and commas: careful typing matters as much as speed.</p>

    <h2>How many mistakes are allowed?</h2>
    <p>The CHSL and CGL notices set the speed, but don't print a single error allowance for the typing test or the DEST, and coaching websites quote different figures, some by category. Treat any figure you read as a guide, and aim to make as few mistakes as you can. Our practice test passes you only at 5% mistakes or less, the strictest figure quoted.</p>

    <h2>How TypeCraft's practice test marks</h2>
    <p>The <a href="/exam-practice">exam practice</a> tests use the same full and half mistakes, and line your typing up with the passage first, so one skipped word doesn't make every word after it wrong. Two differences:</p>
    <ul>
      <li>Two swapped words count as two full mistakes, which is stricter than SSC's half mistake.</li>
      <li>Our passages have no paragraphs to indent, so the Tab rule doesn't come up.</li>
    </ul>
    <p>Speed is worked out as gross and net words a minute: <a href="/guides/gross-and-net-typing-speed">gross and net speed</a> shows how.</p>

    <div class="actions" style="margin-top:8px"><a class="btn btn-primary" href="/exam-practice?test=ssc-typing">${icon('play')} Try the SSC-style test</a><a class="btn btn-ghost" href="/ssc-chsl-typing-test">SSC CHSL typing test</a></div>
  </article>
</div>
${related(meta.path)}
`;
