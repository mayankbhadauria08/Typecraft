// /admin — business overview and the existing app health numbers.
export const meta = {
  path: '/admin', title: 'Admin overview', description: 'Business and app health at a glance.',
  access: 'admin', layout: 'admin', nav: 'overview', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Overview</h1>
  <p class="lede muted" id="ad-asof">Users, revenue, payments and email health.</p>
  <button class="btn btn-ghost btn-sm" type="button" id="ad-refresh">Refresh</button>
</div>
<div id="ad-alert"></div>
<section class="section" aria-labelledby="ad-kpi-h">
  <h2 id="ad-kpi-h" class="sr-only">Key numbers</h2>
  <div class="grid grid-4" id="ad-kpis">
    <div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div>
    <div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div>
  </div>
</section>
<section class="section grid grid-2">
  <article class="card" aria-labelledby="ad-rev-h"><div class="card-head"><h2 id="ad-rev-h">Revenue, last 30 days</h2><a class="btn btn-ghost btn-sm" href="/admin/revenue">Details</a></div><div id="ad-rev"><div class="skeleton" style="height:180px"></div></div></article>
  <article class="card" aria-labelledby="ad-plans-h"><div class="card-head"><h2 id="ad-plans-h">Active plans by package</h2><a class="btn btn-ghost btn-sm" href="/admin/packages">Packages</a></div><div id="ad-plans"><div class="skeleton" style="height:180px"></div></div></article>
</section>
<section class="section" aria-labelledby="ad-health-h">
  <h2 id="ad-health-h">App health</h2>
  <div id="ad-health"><div class="skeleton" style="height:8rem"></div></div>
</section>
`;
export default body;
