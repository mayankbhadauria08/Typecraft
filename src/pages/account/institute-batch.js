// /institute/:id/batches/:bid — one batch: its join code, its students' progress (CSV), certificates to print, and (admins) its settings
// (docs/INSTITUTES.md §8). Data: GET /api/institutes/:id/batches/:bid and …/students.
export const meta = {
  path: '/institute/:id/batches/:bid', title: 'Batch', description: 'A batch: its code and its students.',
  access: 'user', layout: 'account', nav: 'institute', noindex: true,
};
export const body = `
<p><a class="back-link" id="ib-back" href="/institute">Back to the institute</a></p>
<div class="page-head ins-head">
  <h1 id="ib-title"><span class="skeleton" style="display:inline-block;width:14rem;height:1em"></span></h1>
  <p class="lede muted" id="ib-sub"></p>
</div>
<div id="ib-note"></div>
<section class="section" id="ib-code" aria-label="Join code"></section>
<section class="section" aria-labelledby="ib-students-h">
  <div class="ins-sec-head"><h2 id="ib-students-h">Students</h2><div id="ib-students-act"></div></div>
  <div id="ib-students"><div class="skeleton" style="height:8rem"></div></div>
</section>
<section class="section" id="ib-teach-sec" hidden aria-labelledby="ib-teach-h">
  <h2 id="ib-teach-h">Target and assignments</h2>
  <div class="grid grid-2 ins-teach">
    <article class="card" aria-labelledby="ib-target-h"><div class="card-head"><h3 id="ib-target-h">Target</h3><div id="ib-target-act"></div></div><div id="ib-target"></div></article>
    <article class="card" aria-labelledby="ib-board-h"><div class="card-head"><h3 id="ib-board-h">Leaderboard this week</h3><div id="ib-board-act"></div></div><div id="ib-board"></div></article>
  </div>
  <div class="ins-sec-head ins-sub-head"><h3>Assignments</h3><div id="ib-asg-act"></div></div>
  <div id="ib-asg"></div>
  <div class="ins-sec-head ins-sub-head"><h3>Exam practice</h3></div>
  <div id="ib-exams"></div>
</section>
<section class="section" id="ib-certs-sec" hidden aria-labelledby="ib-certs-h">
  <div class="ins-sec-head"><h2 id="ib-certs-h">Certificates</h2><div id="ib-certs-act"></div></div>
  <div id="ib-certs"></div>
</section>
<section class="section" id="ib-inv-sec" hidden aria-labelledby="ib-inv-h">
  <h2 id="ib-inv-h">Invite students by email</h2>
  <div id="ib-inv"></div>
</section>
<section class="section" id="ib-admin-sec" hidden aria-labelledby="ib-admin-h">
  <h2 id="ib-admin-h">Batch settings</h2>
  <div id="ib-admin"></div>
</section>
`;
export default body;
