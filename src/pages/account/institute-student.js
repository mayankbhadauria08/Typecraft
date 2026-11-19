// /institute/:id/students/:mid — one student, for their institute's admins and their batch's teachers:
// lessons, practice by day, weak keys and exam practice (docs/INSTITUTES.md §9). Data: GET /api/institutes/:id/students/:mid.
export const meta = {
  path: '/institute/:id/students/:mid', title: 'Student', description: "A student's progress.",
  access: 'user', layout: 'account', nav: 'institute', noindex: true,
};
export const body = `
<p><a class="back-link" id="is-back" href="/institute">Back to the batch</a></p>
<div class="page-head ins-head">
  <h1 id="is-title"><span class="skeleton" style="display:inline-block;width:14rem;height:1em"></span></h1>
  <p class="lede muted" id="is-sub"></p>
</div>
<section class="section ins-stats" id="is-stats" aria-label="Summary"></section>
<section class="section" aria-labelledby="is-days-h">
  <h2 id="is-days-h">Practice in the last 30 days</h2>
  <div class="card" id="is-days"><div class="skeleton" style="height:10rem"></div></div>
</section>
<section class="section grid grid-2">
  <article class="card" aria-labelledby="is-levels-h"><div class="card-head"><h2 id="is-levels-h">Lessons by level</h2></div><div id="is-levels"></div></article>
  <article class="card" aria-labelledby="is-keys-h"><div class="card-head"><h2 id="is-keys-h">Weak keys</h2></div><div id="is-keys"></div></article>
</section>
<section class="section" aria-labelledby="is-stuck-h" id="is-stuck-sec" hidden>
  <h2 id="is-stuck-h">Lessons they are stuck on</h2>
  <div id="is-stuck"></div>
</section>
<section class="section" aria-labelledby="is-exams-h">
  <h2 id="is-exams-h">Exam practice</h2>
  <div id="is-exams"></div>
</section>
`;
export default body;
