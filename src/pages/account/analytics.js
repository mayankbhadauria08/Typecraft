// /account/analytics — basic trends for everyone with analytics; advanced and insights by plan.
export const meta = {
  path: '/account/analytics', title: 'Analytics', description: 'Speed, accuracy and your weakest keys.',
  access: 'user', layout: 'account', nav: 'analytics', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Analytics</h1>
  <p class="lede muted">How your speed and accuracy are moving, and where your mistakes come from.</p>
  <div class="field"><label for="an-range">Period</label>
    <select id="an-range"><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></select>
  </div>
</div>
<div id="an-alert"></div>
<section class="section grid grid-4" id="an-stats" aria-label="Summary">
  <div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div>
  <div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div>
</section>
<section class="section grid grid-2">
  <article class="card" aria-labelledby="an-wpm-h"><div class="card-head"><h2 id="an-wpm-h">Speed (WPM)</h2></div><div id="an-wpm"><div class="skeleton" style="height:180px"></div></div></article>
  <article class="card" aria-labelledby="an-acc-h"><div class="card-head"><h2 id="an-acc-h">Accuracy (%)</h2></div><div id="an-acc"><div class="skeleton" style="height:180px"></div></div></article>
  <article class="card" aria-labelledby="an-min-h"><div class="card-head"><h2 id="an-min-h">Minutes practised</h2></div><div id="an-min"><div class="skeleton" style="height:180px"></div></div></article>
  <article class="card" aria-labelledby="an-tests-h"><div class="card-head"><h2 id="an-tests-h">Typing tests (WPM)</h2></div><div id="an-tests"><div class="skeleton" style="height:180px"></div></div></article>
</section>
<section class="section" aria-labelledby="an-adv-h">
  <h2 id="an-adv-h">Advanced analytics</h2>
  <div id="an-adv"><div class="skeleton" style="height:14rem"></div></div>
</section>
<section class="section" aria-labelledby="an-ins-h">
  <h2 id="an-ins-h">Personal insights</h2>
  <div id="an-ins"><div class="skeleton" style="height:6rem"></div></div>
</section>
<style>
.kb-heat{display:grid;gap:6px;max-width:720px}
.kb-row{display:flex;gap:6px;justify-content:center}
.kb-key{flex:0 0 auto;width:clamp(24px,7.5vw,46px);height:clamp(28px,8vw,46px);border-radius:8px;border:1px solid var(--line);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:var(--mono);font-size:13px;line-height:1.05}
.kb-key small{font-size:10px;color:var(--muted)}
.kb-legend{display:flex;gap:.5rem;align-items:center;font-size:12px;color:var(--muted);margin-top:.75rem}
.kb-legend span{width:18px;height:12px;border-radius:3px;border:1px solid var(--line);display:inline-block}
</style>
`;
export default body;
