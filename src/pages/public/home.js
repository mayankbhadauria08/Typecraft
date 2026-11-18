// Home: the conversion page. Live mini typing demo in the hero (site/js/home.js), how it
// works, the five levels (counted from shared/course-meta.js), the arcade, a plans teaser
// from GET /api/packages, an FAQ teaser and a final call to action.
import '../../../shared/course-meta.js';
import { icon } from '../../layout.js';
import { FAQ, faqList } from './faq-data.js';

const META_ = globalThis.TC_META;
const count = (n) => META_.LESSONS.filter((l) => l.level === n).length;
const bosses = META_.BOSSES.length;

export const meta = {
  path: '/',
  fullTitle: 'TypeCraft · Learn touch typing online, one key at a time',
  title: 'Learn touch typing online',
  description: 'A complete touch typing course for India: 78 lessons in 5 levels, a coach that finds your weak keys, typing tests and an arcade of 8 games. Start free, no card needed.',
  changefreq: 'weekly',
};

const LEVEL_TEXT = {
  1: 'Where your fingers rest. F and J first, then the rest of the home row, first words and a steady space bar.',
  2: 'Reaches up to the top row, common letter pairs, double letters and the number row.',
  3: 'The bottom row, both Shift keys, punctuation, brackets, prices, dates and email addresses.',
  4: 'The most common English words, tricky spellings, accuracy locks, speed bursts and 3- and 5-minute tests.',
  5: 'Optional tracks in any order: numpad, code (HTML, CSS, JavaScript, Python), office letters and exam-style passages.',
};

const GAMES = [
  ['Word Storm', 'Words fall; type them before they land.', 'word speed', 'bolt'],
  ['Beat Keys', 'Keys arrive on a beat. Stay on time.', 'even rhythm', 'clock'],
  ['Tug-of-War', 'Out-type a pacer to pull the rope.', 'holding a pace', 'trend'],
  ['Ghost Race', 'Race a replay of your own best run.', 'beating your record', 'flag'],
  ['Key Pop', 'Pop balloons by pressing their keys.', 'finding keys', 'target'],
  ['Word Tower', 'Stack a tower; mistakes shake it.', 'accuracy under pressure', 'layers'],
  ['Safe Cracker', 'Enter codes of numbers and symbols.', 'numbers and symbols', 'lock'],
  ['Boss Battles', 'Each level ends with a boss to beat.', 'the whole unit', 'crown'],
];

export default `
<section class="hero">
  <div class="container hero-grid">
    <div class="hero-copy">
      <span class="eyebrow">Touch typing course · made in India</span>
      <h1>Type without looking. <em>Calmly</em> first, then fast.</h1>
      <p class="lede">TypeCraft teaches touch typing one key at a time: <b>78 short lessons</b> from the home row to full speed, a coach that notices which keys you miss, and an arcade for when you've earned a break.</p>
      <div class="actions">
        <a class="btn btn-primary btn-lg" href="/signup" data-auth-swap>Start free ${icon('arrowRight')}</a>
        <a class="btn btn-ghost btn-lg" href="/typing-test">Take a typing test</a>
      </div>
      <div class="hero-facts"><span>${icon('check')}{{free.badge}}</span><span>${icon('check')}No card needed</span><span>${icon('check')}Progress saved to your account</span></div>
    </div>
    <div class="demo" id="demo" aria-label="Try typing: a short demo">
      <div class="demo-sheet" id="demoSheet">
        <div class="demo-meta"><span id="demoLabel">Watch, then try it</span><span>Home row</span></div>
        <div class="demo-text" id="demoText" aria-live="off"></div>
        <input class="demo-input" id="demoInput" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Type the sentence shown on the sheet">
      </div>
      <div class="demo-gauges" aria-live="polite">
        <div class="demo-gauge"><span>Speed</span><b id="demoWpm">0</b></div>
        <div class="demo-gauge"><span>Accuracy</span><b id="demoAcc">100%</b></div>
        <div class="demo-gauge"><span>Keys</span><b id="demoKeys">0</b></div>
      </div>
      <div class="demo-keys" aria-hidden="true"><i data-k="a">A</i><i data-k="s">S</i><i data-k="d">D</i><i data-k="f">F</i><i data-k=" ">␣</i><i data-k="j">J</i><i data-k="k">K</i><i data-k="l">L</i><i data-k=";">;</i></div>
      <div class="demo-foot"><span id="demoStatus">Typing by itself…</span><button type="button" id="demoTry">Try it yourself</button></div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="counts-h">
  <div class="container">
    <h2 id="counts-h" class="sr-only">TypeCraft in numbers</h2>
    <div class="counts">
      <div class="count"><div class="fig">78</div><div class="lab">Lessons</div><div class="sub">Short, five-step lessons, each one adding a key or a skill.</div></div>
      <div class="count"><div class="fig">5</div><div class="lab">Levels</div><div class="sub">Home row to mastery, plus optional Pro tracks.</div></div>
      <div class="count"><div class="fig">${bosses}</div><div class="lab">Boss tests</div><div class="sub">A checkpoint at the end of each unit, so you know you're ready.</div></div>
      <div class="count"><div class="fig">8</div><div class="lab">Arcade games</div><div class="sub">Each one trains something different, from rhythm to numbers.</div></div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="how-h">
  <div class="container">
    <div class="section-head"><span class="eyebrow">How it works</span><h2 id="how-h">A method, not a stopwatch</h2>
      <p class="lede">Most typing sites just time you. TypeCraft teaches the movement first, then builds speed on top of it.</p></div>
    <ol class="steps">
      <li><h3>Find your level</h3><p>A short placement test checks which keys you already know by touch and suggests where to begin.</p></li>
      <li><h3>Learn one key at a time</h3><p>Each lesson shows the reach, lets you practise the new keys slowly, then mixes them into real words.</p></li>
      <li><h3>Fix what slows you</h3><p>The coach keeps count of every missed key and letter pair and builds review drills from them.</p></li>
      <li><h3>Prove it</h3><p>Pass each level's boss, earn stars for accuracy and crowns for speed, and track your typing tests over time.</p></li>
    </ol>
  </div>
</section>

<section class="section" aria-labelledby="levels-h">
  <div class="container">
    <div class="section-head"><span class="eyebrow">The course</span><h2 id="levels-h">Five levels, home row to full speed</h2>
      <p class="lede">You can start free with {{free.lessons}}, the placement test and review drills. A plan unlocks the rest.</p></div>
    <div class="levels">
      ${META_.LEVELS.map((L) => `<div class="level${L.n === 5 ? ' pro' : ''}"><div class="node" aria-hidden="true">${L.n}</div><div><h3>${L.name} <span class="muted" style="font:400 15px var(--sans)">· ${L.sub}</span></h3><p>${LEVEL_TEXT[L.n]}</p></div><div class="meta"><span class="mono">${count(L.n)} lessons</span><span class="badge ${L.n === 1 ? 'badge-ok' : 'badge-muted'}">${L.n === 1 ? 'Starts free' : `target ${L.target} wpm`}</span></div></div>`).join('')}
    </div>
  </div>
</section>

<section class="section" aria-labelledby="arcade-h">
  <div class="container">
    <div class="section-head"><span class="eyebrow">The arcade</span><h2 id="arcade-h">Practice that doesn't feel like practice</h2>
      <p class="lede">Eight games, each built to train one thing. The <b>Daily Challenge</b> is free for everyone: one shared run a day.</p></div>
    <div class="games">
      ${GAMES.map(([t, d, trains, ic]) => `<div class="game"><span class="gi">${icon(ic)}</span><h3>${t}</h3><p>${d}</p><div class="trains">trains: ${trains}</div></div>`).join('')}
    </div>
  </div>
</section>

<section class="section" aria-labelledby="learn-h">
  <div class="container split">
    <div class="stack" style="gap:16px">
      <span class="eyebrow">What you'll be able to do</span>
      <h2 id="learn-h">Skills you can check, not promises</h2>
      <p class="lede">We don't publish testimonials or invented success rates. Here is what the course actually covers, and every number in your account comes from your own keystrokes.</p>
      <div class="actions"><a class="btn btn-ghost" href="/practice">See the full course ${icon('arrowRight')}</a></div>
    </div>
    <ul class="ticks card">
      <li>${icon('check')}<span>Type all <b>26 letters</b>, digits and common symbols without looking at the keyboard.</span></li>
      <li>${icon('check')}<span>Use <b>both Shift keys</b> correctly for capitals, and type punctuation in rhythm.</span></li>
      <li>${icon('check')}<span>Hold <b>95% accuracy or better</b> at your level's target speed.</span></li>
      <li>${icon('check')}<span>Type <b>real-world text</b>: prices, dates, phone numbers, email addresses and code.</span></li>
      <li>${icon('check')}<span>Sit a <b>10-minute exam-style passage</b> under strict rules, as in clerk and data-entry tests.</span></li>
      <li>${icon('check')}<span>See <b>which keys and letter pairs</b> slow you down, and drill exactly those.</span></li>
    </ul>
  </div>
</section>

<section class="section" aria-labelledby="plans-h">
  <div class="container">
    <div class="row-between" style="align-items:flex-end;margin-bottom:24px">
      <div class="section-head" style="margin:0"><span class="eyebrow">Plans</span><h2 id="plans-h">Start free. Pay once when you're ready.</h2>
        <p class="lede">No subscriptions and no automatic renewals: each plan is a single payment for a fixed period.</p></div>
      <a class="btn btn-ghost" href="/pricing">Compare plans ${icon('arrowRight')}</a>
    </div>
    <div class="plan-grid" id="planTeaser" aria-live="polite">
      <div class="plan-card skeleton" style="min-height:180px"></div><div class="plan-card skeleton" style="min-height:180px"></div><div class="plan-card skeleton" style="min-height:180px"></div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="faq-h">
  <div class="container narrow">
    <div class="section-head"><span class="eyebrow">Questions</span><h2 id="faq-h">Before you start</h2></div>
    ${faqList([FAQ.learning[0], FAQ.plans[0], FAQ.plans[2], FAQ.learning[5]])}
    <p style="margin-top:20px"><a href="/faq">All questions ${icon('arrowRight')}</a></p>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="cta-band">
      <div><h2>Your free lessons are waiting</h2><p>Create a free account, take the placement test and start on the home row today. It takes under a minute.</p></div>
      <div class="actions"><a class="btn btn-primary btn-lg" href="/signup" data-auth-swap>Start free ${icon('arrowRight')}</a></div>
    </div>
  </div>
</section>
`;
