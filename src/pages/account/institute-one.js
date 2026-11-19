// /institute/:id — one institute for its admin and teachers: seats, batches with their codes, and (admins)
// the teachers (docs/INSTITUTES.md §8). Data: GET /api/institutes/:id, GET /api/institutes/:id/staff (admins).
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
<section class="section" id="io-staff-sec" hidden aria-labelledby="io-staff-h">
  <div class="ins-sec-head"><h2 id="io-staff-h">Admins and teachers</h2><div id="io-staff-act"></div></div>
  <div id="io-staff"></div>
</section>
`;
export default body;
