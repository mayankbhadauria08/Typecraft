import { icon } from '../../layout.js';

export const meta = {
  path: '/features',
  title: 'Features',
  description: 'Everything in TypeCraft: 78 lessons, placement test, a coach for weak keys, typing tests, analytics, 8 arcade games, certificates and progress saved across devices.',
};

const free = '<span class="badge badge-ok">Free</span>';
const paid = (name) => `<span class="badge badge-warn">${name}</span>`;
const F = [
  ['book', 'A real course', 'Five levels and 78 lessons: home row, top row and numbers, bottom row with capitals and symbols, mastery, and optional Pro tracks.', `${free} {{free.lessons}} · ${paid('Paid plans')} the rest`],
  ['target', 'Placement test', 'Checks which keys you already type by touch and suggests where to start, so you skip what you know.', free],
  ['keyboard', 'Five-step lessons', 'Watch the reach, practise each key, mix them into words, then a challenge. On-screen hands show which finger to use.', free],
  ['refresh', 'Coach and review drills', 'Every missed key and slow letter pair is counted. Review drills are built from words full of exactly those keys.', free],
  ['clock', 'Typing tests', '15, 30, 60 and 120-second tests with live speed and accuracy. Results are saved to your history when signed in.', `${free} 3 a day · ${paid('Starter')} 20 · ${paid('Pro')} unlimited`],
  ['chart', 'Progress analytics', 'Daily and weekly speed and accuracy trends from your lessons, games and tests.', paid('Starter and up')],
  ['grid', 'Advanced analytics', 'A per-key accuracy heatmap, your slowest letter pairs and the kinds of mistakes you make most.', paid('Pro and up')],
  ['code', 'Custom practice', 'Paste your own text, or practise only your weakest keys, inside the same lesson engine.', paid('Pro and up')],
  ['layers', 'Premium exercise packs', 'Numbers and data entry, code snippets, business writing and long 300-word passages, all written by us.', paid('Pro and up')],
  ['gamepad', 'Arcade', 'Eight games that each train one skill, plus a shared Daily Challenge.', `${free} Daily Challenge · ${paid('All plans')} all 8 games`],
  ['sparkle', 'Personal insights', 'A weekly plan built from your mistakes and speed: what to practise next and for how long.', paid('Premium')],
  ['certificate', 'Certificates', 'Printable level certificates showing the speed and accuracy you reached.', paid('Premium')],
  ['devices', 'Saved to your account', 'Progress saves as you type and follows you to any computer. Lessons keep working offline and sync later.', free],
  ['sun', 'Calm themes', 'Dark ink and light paper themes, sound on or off, and reduced motion for those who prefer it.', free],
  ['shield', 'Private by design', 'No ads and no advertising trackers; visits are counted without cookies. Sign in with a password or a one-time code sent to your email.', free],
];

export default `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">Features</span>
    <h1>Everything you need to learn, and nothing you don't</h1>
    <p class="lede">TypeCraft is one focused tool: a course, a coach, tests and an arcade, sharing one record of your typing. Here is what each part does, and which plan includes it.</p>
    <div class="actions"><a class="btn btn-primary" href="/signup" data-auth-swap>Start free ${icon('arrowRight')}</a><a class="btn btn-ghost" href="/pricing">Compare plans</a></div>
  </header>
</div>
<section class="section" style="padding-top:8px">
  <div class="container grid-3">
    ${F.map(([ic, t, d, who]) => `<article class="card"><span class="card-icon">${icon(ic)}</span><h2 style="font-size:21px">${t}</h2><p>${d}</p><div class="card-foot" style="justify-content:flex-start">${who}</div></article>`).join('')}
  </div>
</section>
<section class="section">
  <div class="container">
    <div class="cta-band">
      <div><h2>Not sure where you stand?</h2><p>Take a one-minute typing test now, no account needed. You'll see your speed and accuracy straight away.</p></div>
      <div class="actions"><a class="btn btn-primary btn-lg" href="/typing-test">Take the test ${icon('arrowRight')}</a></div>
    </div>
  </div>
</section>
`;
