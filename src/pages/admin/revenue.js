// /admin/revenue — revenue by day and package, refunds, net.
export const meta = {
  path: '/admin/revenue', title: 'Revenue', description: 'Revenue, refunds and net by day and package.',
  access: 'admin', layout: 'admin', nav: 'revenue', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Revenue</h1>
  <p class="lede muted">Money received through Razorpay, refunds, and what remains. Dates are in UTC.</p>
</div>
<form class="section field-row" id="ar-range">
  <div class="field"><label for="ar-from">From</label><input id="ar-from" name="from" type="date" required></div>
  <div class="field"><label for="ar-to">To</label><input id="ar-to" name="to" type="date" required></div>
  <button class="btn btn-primary" type="submit">Show</button>
  <div class="field-row" role="group" aria-label="Quick ranges">
    <button class="btn btn-ghost btn-sm" type="button" data-days="7">7 days</button>
    <button class="btn btn-ghost btn-sm" type="button" data-days="30">30 days</button>
    <button class="btn btn-ghost btn-sm" type="button" data-days="90">90 days</button>
    <button class="btn btn-ghost btn-sm" type="button" data-days="365">1 year</button>
  </div>
</form>
<section class="section grid grid-4" id="ar-kpis" aria-label="Totals">
  <div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div><div class="stat skeleton" style="height:5.5rem"></div>
</section>
<section class="section card" aria-labelledby="ar-daily-h"><div class="card-head"><h2 id="ar-daily-h">Daily revenue (gross)</h2></div><div id="ar-daily"><div class="skeleton" style="height:180px"></div></div></section>
<section class="section grid grid-2">
  <article class="card" aria-labelledby="ar-pkg-h"><div class="card-head"><h2 id="ar-pkg-h">By package</h2></div><div id="ar-pkg"><div class="skeleton" style="height:10rem"></div></div></article>
  <article class="card" aria-labelledby="ar-ref-h"><div class="card-head"><h2 id="ar-ref-h">Refunds</h2></div><div id="ar-ref"><div class="skeleton" style="height:10rem"></div></div></article>
</section>
`;
export default body;
