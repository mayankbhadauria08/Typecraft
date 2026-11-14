// /admin/users — search, page through and manage accounts.
export const meta = {
  path: '/admin/users', title: 'Users', description: 'Find and manage learner accounts.',
  access: 'admin', layout: 'admin', nav: 'users', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Users</h1>
  <p class="lede muted">Search by name or email. Open a user to see plans and payments, grant or revoke a plan, or disable the account.</p>
</div>
<form class="section field-row" id="au-search" role="search">
  <div class="field" style="flex:1"><label for="au-q">Search</label><input id="au-q" name="q" type="search" placeholder="Name or email" autocomplete="off"></div>
  <button class="btn btn-primary" type="submit">Search</button>
</form>
<section class="section" id="au-list" aria-live="polite"><div class="skeleton" style="height:14rem"></div></section>
<div id="au-pager"></div>
<dialog id="au-drawer" class="adm-drawer" aria-labelledby="au-d-title">
  <div class="card">
    <div class="card-head"><h2 id="au-d-title">User</h2><button class="btn btn-ghost btn-sm" type="button" id="au-d-close">Close</button></div>
    <div id="au-d-body"></div>
  </div>
</dialog>
<style>
.adm-drawer{margin:0 0 0 auto;height:100vh;max-height:100vh;width:min(560px,100vw);max-width:100vw;padding:0;border:0;background:transparent;color:inherit}
.adm-drawer::backdrop{background:var(--scrim,rgba(0,0,0,.6))}
.adm-drawer>.card{min-height:100%;border-radius:16px 0 0 16px;overflow:auto}
.adm-dl{display:grid;grid-template-columns:auto 1fr;gap:.35rem 1rem;margin:0 0 1rem}
.adm-dl dt{color:var(--muted)}.adm-dl dd{margin:0;overflow-wrap:anywhere}
</style>
`;
export default body;
