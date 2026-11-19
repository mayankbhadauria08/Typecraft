// /dashboard — the signed-in home: plan, today, speed and accuracy, recent activity.
export const meta = {
  path: '/dashboard', title: 'Dashboard', description: 'Your TypeCraft plan, today\'s practice and progress.',
  access: 'user', layout: 'account', nav: 'dashboard', noindex: true,
};
export const body = `
<div class="page-head">
  <h1 id="dash-greeting">Welcome back</h1>
  <p class="lede muted" id="dash-sub">Here is where your typing stands today.</p>
  <div class="field-row"><a class="btn btn-primary" href="/app" id="dash-continue">Continue practising</a></div>
</div>
<div id="dash-alert"></div>
<section class="section grid grid-2" aria-label="Plan and today">
  <article class="card" id="dash-plan" aria-labelledby="dash-plan-h">
    <div class="card-head"><h2 id="dash-plan-h">Your plan</h2></div>
    <div id="dash-plan-body"><div class="skeleton" style="height:4.5rem"></div></div>
  </article>
  <article class="card" aria-labelledby="dash-today-h">
    <div class="card-head"><h2 id="dash-today-h">Today</h2></div>
    <div id="dash-today"><div class="skeleton" style="height:4.5rem"></div></div>
  </article>
</section>
<section class="section" id="dash-batch" hidden aria-labelledby="dash-batch-h">
  <h2 id="dash-batch-h">Your batch</h2>
  <div id="dash-batch-body"></div>
</section>
<section class="section" aria-labelledby="dash-stats-h">
  <h2 id="dash-stats-h" class="sr-only">Your numbers</h2>
  <div class="grid grid-4" id="dash-stats">
    <div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div>
    <div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div>
  </div>
</section>
<section class="section grid grid-2">
  <article class="card" aria-labelledby="dash-trend-h">
    <div class="card-head"><h2 id="dash-trend-h">Speed, last 30 days</h2><a class="btn btn-ghost btn-sm" href="/account/analytics">Analytics</a></div>
    <div id="dash-trend"><div class="skeleton" style="height:180px"></div></div>
  </article>
  <article class="card" aria-labelledby="dash-recent-h">
    <div class="card-head"><h2 id="dash-recent-h">Recent activity</h2><a class="btn btn-ghost btn-sm" href="/account/history">History</a></div>
    <div id="dash-recent"><div class="skeleton" style="height:180px"></div></div>
  </article>
</section>
`;
export default body;
