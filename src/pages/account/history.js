// /account/history — practice days and typing tests, limited by the plan's historyDays.
export const meta = {
  path: '/account/history', title: 'History', description: 'Your practice days and typing tests.',
  access: 'user', layout: 'account', nav: 'history', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>History</h1>
  <p class="lede muted">Every day you practised and every typing test you took.</p>
</div>
<div id="hist-lock"></div>
<div class="section field-row" role="group" aria-label="Filters">
  <div class="tabs" role="tablist" aria-label="What to show">
    <button type="button" role="tab" aria-selected="true" data-tab="days" id="hist-tab-days" aria-controls="hist-panel">Practice days</button>
    <button type="button" role="tab" aria-selected="false" data-tab="tests" id="hist-tab-tests" aria-controls="hist-panel">Typing tests</button>
  </div>
  <div class="field"><label for="hist-range">Period</label>
    <select id="hist-range"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option><option value="all">Everything</option></select>
  </div>
  <div class="field" id="hist-dur-wrap" hidden><label for="hist-dur">Test length</label>
    <select id="hist-dur"><option value="">All lengths</option><option value="15">15 s</option><option value="30">30 s</option><option value="60">1 min</option><option value="120">2 min</option><option value="300">5 min</option><option value="600">10 min</option><option value="900">15 min</option></select>
  </div>
</div>
<section class="section" id="hist-panel" role="tabpanel" aria-live="polite"><div class="skeleton" style="height:12rem"></div></section>
`;
export default body;
