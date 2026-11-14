import '../../../shared/course-meta.js';
import { icon, esc } from '../../layout.js';

const M = globalThis.TC_META;
export const meta = {
  path: '/practice',
  title: 'Typing practice: the full course',
  description: 'Practise touch typing with a structured course: 78 lessons in 5 levels, five steps per lesson, stars for accuracy, crowns for speed and boss tests. First 5 lessons free.',
};

const STEPS = [
  ['Watch', 'See which finger reaches for each new key, and where it returns.'],
  ['Practise keys', 'Type the new keys on their own, slowly, until the reach is automatic.'],
  ['Mix', 'The new keys join the ones you know, in short patterns.'],
  ['Words', 'Real words and sentences that use what you have just learned.'],
  ['Challenge', 'A short timed run. Accuracy earns stars; reaching the level speed earns a crown.'],
];

function levelBlock(L) {
  const lessons = M.LESSONS.filter((l) => l.level === L.n);
  const shown = lessons.filter((l) => l.kind !== 'review').slice(0, 9);
  return `<article class="card">
    <div class="card-head"><div><span class="eyebrow">Level ${L.n}</span><h3 style="margin-top:8px">${esc(L.name)}: ${esc(L.sub.toLowerCase())}</h3></div><span class="badge badge-muted mono">${lessons.length} lessons</span></div>
    <ul class="ticks" style="gap:6px;font-size:14.5px">${shown.map((l) => `<li>${icon(l.kind === 'boss' ? 'crown' : 'chevronRight')}<span>${esc(l.title)}</span></li>`).join('')}${lessons.length > shown.length ? `<li class="muted">${icon('plus')}<span>and ${lessons.length - shown.length} more</span></li>` : ''}</ul>
    <div class="card-foot"><span class="muted" style="font-size:14px">Target speed: <b class="mono">${L.target} wpm</b></span>${L.n === 1 ? '<span class="badge badge-ok">First 5 free</span>' : ''}</div>
  </article>`;
}

export default `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">Typing practice</span>
    <h1>Practise with a plan, not at random</h1>
    <p class="lede">Random text builds random habits. TypeCraft's practice follows a course: each lesson adds one or two keys, and nothing new arrives until the last step feels easy.</p>
    <div class="actions"><a class="btn btn-primary btn-lg" href="/signup?next=%2Fapp" data-auth-swap>Start practising free ${icon('arrowRight')}</a><a class="btn btn-ghost btn-lg" href="/typing-test">Quick typing test</a></div>
  </header>
</div>
<section class="section" style="padding-top:8px" aria-labelledby="steps-h">
  <div class="container">
    <div class="section-head"><h2 id="steps-h">Every lesson, five steps</h2><p class="lede">The same calm rhythm from lesson one to lesson 78. Wrong keys in practice steps wait for the right one; in challenges the caret moves on, as in a real test.</p></div>
    <ol class="steps" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))">${STEPS.map(([t, d]) => `<li><h3>${t}</h3><p>${d}</p></li>`).join('')}</ol>
  </div>
</section>
<section class="section" aria-labelledby="levels-h">
  <div class="container">
    <div class="section-head"><h2 id="levels-h">The five levels</h2><p class="lede">Levels 1 to 4 run in order. Level 5, the Pro tracks, can be taken in any order once you know the whole keyboard.</p></div>
    <div class="grid-2">${M.LEVELS.map(levelBlock).join('')}</div>
  </div>
</section>
<section class="section" aria-labelledby="scores-h">
  <div class="container split">
    <div class="stack" style="gap:14px"><h2 id="scores-h">How you're scored</h2><p class="lede">Stars reward accuracy, crowns reward speed with accuracy. Both are earned on the challenge step of each lesson.</p></div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Result</th><th>What it takes</th></tr></thead>
      <tbody>
        <tr><th>★</th><td>${M.STARS[2][0]}% accuracy or better</td></tr>
        <tr><th>★★</th><td>${M.STARS[1][0]}% accuracy or better</td></tr>
        <tr><th>★★★</th><td>${M.STARS[0][0]}% accuracy or better</td></tr>
        <tr><th>Crown</th><td>${M.CROWN_ACCURACY}% accuracy at your level's target speed</td></tr>
        <tr><th>Boss</th><td>Clear the end-of-unit test to show the unit is truly learned</td></tr>
      </tbody></table></div>
  </div>
</section>
<section class="section">
  <div class="container">
    <div class="cta-band">
      <div><h2>Start on the home row today</h2><p>The placement test, the first five lessons and the daily review drill are free, with your progress saved to your account.</p></div>
      <div class="actions"><a class="btn btn-primary btn-lg" href="/signup?next=%2Fapp" data-auth-swap>Start free ${icon('arrowRight')}</a></div>
    </div>
  </div>
</section>
`;
