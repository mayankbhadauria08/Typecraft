// /guides/gross-and-net-typing-speed — gross speed, net speed, mistakes % and accuracy, as Indian
// recruitment typing tests usually work them out (and as shared/exam-rules.js does), with examples.
import { icon } from '../../layout.js';
import { dataTable, related, CHECKED, CHECKED_TEXT } from './exam-seo.js';

export const meta = {
  path: '/guides/gross-and-net-typing-speed',
  title: 'Gross and net typing speed, explained',
  headline: 'Gross speed, net speed and accuracy: how exam typing speed is worked out',
  ogTitle: 'Gross and net typing speed, explained · TypeCraft',
  ogType: 'article',
  description: 'How Indian typing exams work out gross speed, net speed and mistakes, with worked examples, and why a typing test speed can differ from an exam result.',
  crumb: 'Gross and net typing speed',
  published: CHECKED,
  changefreq: 'monthly',
  priority: '0.6',
};

export default `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">Guide</span>
    <h1>Gross speed, net speed and accuracy</h1>
    <p class="lede">Typing exam results talk about gross speed, net speed and mistakes. Here is how each is usually worked out, with examples, and why the number on a quick typing test can differ from an exam result.</p>
    <p class="updated" style="font:500 12.5px/1.3 var(--mono);color:var(--muted)">Updated ${CHECKED_TEXT}</p>
  </header>

  <article class="prose" style="padding-bottom:24px">
    <h2>Gross speed</h2>
    <p>Everything you typed, counted in words of five key depressions, per minute:</p>
    <p class="card" style="font-family:var(--mono)">gross speed = key depressions ÷ 5 ÷ minutes</p>
    <p>It counts every key, right or wrong, so on its own it says nothing about accuracy.</p>

    <h2>Net speed</h2>
    <p>Gross speed with your mistakes taken off. The method many Indian recruitment tests publish takes one word a minute off for each mistake, with a half mistake counting half:</p>
    <p class="card" style="font-family:var(--mono)">net speed = gross speed − mistakes ÷ minutes</p>
    <p>Madhya Pradesh's <a href="/cpct-typing-test">CPCT</a> grades typing on net words a minute. SSC's typing test asks for a speed and looks at your mistakes as well: see <a href="/guides/ssc-typing-test-marking">how the SSC typing test is marked</a>.</p>

    <h2>Two worked examples</h2>
    <p>Two candidates take a 10-minute test and both type 1,900 key depressions. Their gross speed is the same: 1,900 ÷ 5 ÷ 10 = 38 words a minute.</p>
    ${dataTable('Gross and net speed for two candidates', ['', 'Mistakes', 'Gross speed', 'Net speed'], [
      ['Careful', '8', '38.0', '38 − 8 ÷ 10 = 37.2'],
      ['Rushed', '30', '38.0', '38 − 30 ÷ 10 = 35.0'],
    ], [1, 2, 3])}
    <p>The rushed candidate typed just as much, but their net speed has fallen to 35 words a minute. The same typing with more mistakes is worth less.</p>

    <h2>Mistakes as a share</h2>
    <p>Exams that set an error allowance compare your mistakes with the number of words, as a percentage:</p>
    <p class="card" style="font-family:var(--mono)">mistakes % = (full + half ÷ 2) ÷ words × 100</p>
    <p>Which words they divide by varies: SSC's guidelines for its stenography test use the words of the whole passage. TypeCraft's practice tests use the words of the passage you reached in the time, which is fairer when a passage is longer than anyone needs.</p>

    <h2>Accuracy on a typing test</h2>
    <p>A quick typing test, like <a href="/typing-test">ours</a>, works at the level of characters instead: speed counts the correct characters, and accuracy is the share of all the keys you pressed that were right, so even a mistake you fixed counts against you.</p>
    <p>Both are useful. Character accuracy shows how cleanly you type; the exam's word-by-word marking shows how a slip would be judged. A single wrong letter makes a whole word a full mistake in an exam, so 97% accuracy on a typing test can still mean several mistakes in a 10-minute exam.</p>

    <h2>Which formula does my exam use?</h2>
    <p>The ideas above are common, but exams publish their own details: what counts as a word, which mistakes are full or half, and what the allowance is. Read the notice for your exam, and practise with the same length and rules.</p>

    <div class="actions" style="margin-top:8px"><a class="btn btn-primary" href="/exam-practice">${icon('play')} Take an exam-style test</a><a class="btn btn-ghost" href="/typing-test">Quick typing test</a></div>
  </article>
</div>
${related(meta.path)}
`;
