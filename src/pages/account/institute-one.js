// /institute/:id — one institute for its admin and teachers: seats, batches with their codes, and (admins)
// the teachers (docs/INSTITUTES.md §8), and (admins) more seats or a renewal paid online (§15).
// Data: GET /api/institutes/:id, GET /api/institutes/:id/staff and /buy (admins).
export const meta = {
  path: '/institute/:id', title: 'Institute', description: 'Your institute: seats, batches and teachers.',
  access: 'user', layout: 'account', nav: 'institute', noindex: true,
};
export const body = `
<p><a class="back-link" href="/institute">All your institutes</a></p>
<div class="page-head ins-head">
  <h1 id="io-title"><span class="skeleton" style="display:inline-block;width:14rem;height:1em"></span></h1>
  <p class="lede muted" id="io-sub"></p>
</div>
<div id="io-note"></div>
<section class="section ins-stats" id="io-stats" aria-label="Seats and term"></section>
<section class="section" aria-labelledby="io-batches-h">
  <div class="ins-sec-head"><h2 id="io-batches-h">Batches</h2><div id="io-batches-act"></div></div>
  <div id="io-batches"><div class="skeleton" style="height:6rem"></div></div>
</section>
<section class="section" id="io-buy-sec" hidden aria-labelledby="io-buy-h">
  <div class="ins-sec-head"><h2 id="io-buy-h">More seats and renewal</h2></div>
  <div id="io-buy-msg" aria-live="polite"></div>
  <div class="ins-cards buy-cards" id="io-buy"></div>
</section>
<section class="section" id="io-inv-sec" hidden aria-labelledby="io-inv-h">
  <h2 id="io-inv-h">Invoices</h2>
  <div id="io-inv"></div>
</section>
<section class="section" id="io-staff-sec" hidden aria-labelledby="io-staff-h">
  <div class="ins-sec-head"><h2 id="io-staff-h">Admins and teachers</h2><div id="io-staff-act"></div></div>
  <div id="io-staff"></div>
</section>
<section class="section" id="io-weekly-sec" hidden aria-labelledby="io-weekly-h">
  <h2 id="io-weekly-h">Your Monday email</h2>
  <div id="io-weekly"></div>
</section>
`;
export default body;
