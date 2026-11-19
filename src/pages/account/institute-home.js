// /institute — the institutes this account helps run, and invitations to accept (docs/INSTITUTES.md §8).
// Data: GET /api/me/institutes; POST /api/me/institute-invites/:id/accept | decline; GET /api/institutes/buy (§15).
export const meta = {
  path: '/institute', title: 'Institute', description: 'The institutes you help run, and invitations to accept.',
  access: 'user', layout: 'account', nav: 'institute', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Institute</h1>
  <p class="lede muted">For the admins and teachers of a coaching centre: set up batches, give students their code, and see how they are doing. See the <a href="/institute-terms">terms for institutes</a> and the <a href="/institute-guide">guide</a>.</p>
</div>
<section class="section" id="ih-invites-sec" hidden aria-labelledby="ih-invites-h">
  <h2 id="ih-invites-h">Invitations</h2>
  <div id="ih-invites"></div>
</section>
<section class="section" aria-labelledby="ih-list-h">
  <h2 id="ih-list-h">Your institutes</h2>
  <div id="ih-list"><div class="skeleton" style="height:5rem"></div></div>
</section>
<section class="section" id="ih-buy" aria-label="Buy seats"></section>
`;
export default body;
