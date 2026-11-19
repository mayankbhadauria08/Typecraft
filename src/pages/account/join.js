// /join and /join/ABCD-EFGH — a student enters the code their institute gave them and takes a seat
// (docs/INSTITUTES.md §4). Signed out, the site sends them to sign in (or create an account) and back.
// Data: GET /api/institutes/join?code= (what the code is for), POST /api/institutes/join { code, adult }.
export const meta = {
  path: '/join', title: 'Join your institute', description: 'Enter the code from your institute to join your batch.',
  access: 'user', layout: 'account', nav: 'plans', noindex: true,
};
export const codeMeta = { ...meta, path: '/join/:code' };
export const body = `
<div class="page-head">
  <h1>Join your institute</h1>
  <p class="lede muted">Your institute gives each batch a code of eight letters and numbers. Joining takes one of the institute's seats and gives you its plan until the institute's end date.</p>
</div>
<form class="card join-form" id="joinForm" novalidate>
  <div class="field">
    <label for="joinCode">Code from your institute</label>
    <input id="joinCode" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" placeholder="ABCD-EFGH">
    <p class="hint">Letters and numbers; the dash is optional.</p>
  </div>
  <div class="actions"><button type="submit" class="btn btn-primary" id="joinCheck">Check the code</button></div>
</form>
<section id="joinResult" aria-live="polite"></section>
<p class="muted join-small">While you are in a batch, your institute's staff can see your name, email, course progress, speeds, accuracy, weak keys and exam practice results. You can leave at any time from <a href="/account/plans">Plans</a>; your progress stays yours.</p>
`;
export default body;
