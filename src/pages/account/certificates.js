// /account/certificates — every certificate with its code: copy the link, print, stop or start sharing.
// Data: GET /api/me/certificates; PUT /api/me/certificates/:code { shared } (docs/EXAM-MODES.md).
export const meta = {
  path: '/account/certificates', title: 'Certificates', description: 'Your typing certificates and the codes that let others check them.',
  access: 'user', layout: 'account', nav: 'certificates', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Certificates</h1>
  <p class="lede muted">Speed certificates from the course and certificates from exam practice. Each has a code: anyone you give it to can check it on the <a href="/verify">verify page</a>, where they see your name, the result and the date.</p>
</div>
<div id="cert-note"></div>
<section class="section" id="cert-list" aria-live="polite"><div class="skeleton" style="height:12rem"></div></section>
`;
export default body;
