import { icon } from '../../layout.js';

export const meta = {
  path: '/typing-test',
  title: 'Free typing speed test (WPM and accuracy)',
  ogTitle: 'Typing speed test · TypeCraft',
  description: 'Check your typing speed in 15, 30, 60 or 120 seconds. Live words per minute and accuracy, no sign-up needed. Save your results with a free account.',
  changefreq: 'weekly',
};

export default `
<div class="container">
  <header class="page-head" style="padding-bottom:18px">
    <span class="eyebrow">Typing test</span>
    <h1>How fast do you type?</h1>
    <p class="lede">Pick a length, click the sheet and start typing. The clock starts on your first key. Mistakes stay on the page, as in a real test; you can fix them with Backspace.</p>
  </header>

  <section class="tt" id="tt" aria-label="Typing test">
    <div class="tt-bar">
      <div class="tabs" role="group" aria-label="Test length" id="ttDur">
        <button type="button" data-d="15" aria-pressed="false">15 s</button>
        <button type="button" data-d="30" aria-pressed="false">30 s</button>
        <button type="button" data-d="60" aria-pressed="true">60 s</button>
        <button type="button" data-d="120" aria-pressed="false">2 min</button>
      </div>
      <div class="tabs" role="group" aria-label="Text" id="ttKind">
        <button type="button" data-k="words" aria-pressed="true">Common words</button>
        <button type="button" data-k="quotes" aria-pressed="false">Sentences</button>
        <button type="button" data-k="numbers" aria-pressed="false">With numbers</button>
      </div>
    </div>

    <div class="tt-live" aria-live="off">
      <div class="stat"><span class="stat-label">Time left</span><span class="stat-value" id="ttTime">60<small>s</small></span></div>
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
  </section>
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
`;
