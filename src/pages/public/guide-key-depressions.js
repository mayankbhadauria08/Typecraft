// /guides/key-depressions-per-hour — key depressions per hour (KDPH): what they are, converting to
// words a minute, correct key depressions, working out your own. Figures are arithmetic
// (5 key depressions a word, as SSC's notices count them).
import { icon } from '../../layout.js';
import { dataTable, related, CHECKED, CHECKED_TEXT } from './exam-seo.js';

export const meta = {
  path: '/guides/key-depressions-per-hour',
  title: 'Key depressions per hour (KDPH), explained',
  headline: 'Key depressions per hour (KDPH), explained',
  ogTitle: 'Key depressions per hour (KDPH), explained · TypeCraft',
  ogType: 'article',
  description: 'What 8,000 key depressions an hour means for the SSC DEST and DEO tests, how to turn it into words a minute, and how to work out your own speed.',
  crumb: 'Key depressions per hour',
  published: CHECKED,
  changefreq: 'monthly',
  priority: '0.6',
};

const n = (x) => x.toLocaleString('en-IN');
const ROWS = [
  [8000, 'SSC DEST, DEO skill test'],
  [9000, 'SSC typing test, Hindi (30 wpm)'],
  [10500, 'SSC typing test, English (35 wpm)'],
  [15000, 'DEO Grade A in some departments'],
];

export default `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">Guide</span>
    <h1>Key depressions per hour, explained</h1>
    <p class="lede">Data entry tests, such as SSC's DEST and its skill test for Data Entry Operators, measure speed in key depressions an hour (KDPH) rather than words a minute. Here is what that means, how to convert it, and how to work out your own.</p>
    <p class="updated" style="font:500 12.5px/1.3 var(--mono);color:var(--muted)">Updated ${CHECKED_TEXT}</p>
  </header>

  <article class="prose" style="padding-bottom:24px">
    <h2>What is a key depression?</h2>
    <p>One press of a key that enters something: a letter, a figure, a punctuation mark or a space. A passage "of about 2,000 key depressions" has about 2,000 characters, spaces included.</p>
    <p>SSC's notices count five key depressions to a word. That is how they say 35 words a minute is "about 10,500 key depressions an hour": 35 × 5 × 60.</p>

    <h2>Converting to words a minute</h2>
    <p>Divide key depressions an hour by 300 (60 minutes × 5 key depressions a word). To get what you need in the test, multiply the hourly figure by the minutes and divide by 60.</p>
    ${dataTable('Key depressions an hour, as words a minute and test totals', ['Per hour', 'wpm', 'In 10 min', 'In 15 min'],
      ROWS.map(([k, what]) => [`${n(k)}<br><span class="muted" style="font-weight:400;font-size:14px">${what}</span>`, (k / 300).toFixed(1).replace(/\.0$/, ''), n(Math.round(k / 6)), n(k / 4)]), [1, 2, 3])}

    <h2>Correct key depressions</h2>
    <p>Data entry tests are judged on <i>correct</i> entry. In the words of the SSC notices, the speed "will be adjudged on the basis of the correct entry of words/key depressions". So the number that matters is not how many keys you pressed, but how much of what you typed was right.</p>
    <p>TypeCraft's practice test counts correct key depressions as the letters and spaces of the words you typed exactly right. A word with a mistake in it adds nothing.</p>

    <h2>Working out your own</h2>
    <p>Say you type for 15 minutes and enter 2,140 key depressions, of which 90 are in words with mistakes. Your correct key depressions are 2,140 − 90 = 2,050. Over 15 minutes that is 2,050 × 4 = <b>8,200 an hour</b>: just over the 8,000 the DEST asks for.</p>
    <p>Now say you rush, enter 2,400, but 450 of them are in words with mistakes. That is 1,950 correct, or 7,800 an hour: below the mark, even though you typed more.</p>

    <h2>How to get there</h2>
    <ul>
      <li>Learn to type without looking, figures included. The <a href="/app">TypeCraft course</a> teaches the number row, and its Pro track the numpad.</li>
      <li>Practise for the full 15 minutes: the <a href="/exam-practice?test=ssc-dest">SSC-style data entry test</a> shows your correct key depressions at the end.</li>
      <li>Slow down until mistakes are rare. A wrong word costs you every key in it.</li>
    </ul>

    <div class="actions" style="margin-top:8px"><a class="btn btn-primary" href="/exam-practice?test=ssc-dest">${icon('play')} Try the data entry test</a><a class="btn btn-ghost" href="/ssc-dest-typing-test">SSC DEST and DEO rules</a></div>
  </article>
</div>
${related(meta.path)}
`;
