// /institute/:id/batches/:bid — one batch: its join code, its students, and (admins) its settings
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
<section class="section" id="ib-admin-sec" hidden aria-labelledby="ib-admin-h">
  <h2 id="ib-admin-h">Batch settings</h2>
  <div id="ib-admin"></div>
</section>
`;
export default body;
