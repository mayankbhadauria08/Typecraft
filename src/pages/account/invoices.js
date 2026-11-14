// /account/invoices — list of invoices; each opens the printable view.
export const meta = {
  path: '/account/invoices', title: 'Invoices', description: 'Your invoices.',
  access: 'user', layout: 'account', nav: 'invoices', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Invoices</h1>
  <p class="lede muted">An invoice is issued for every successful payment. Open one to print or save it as PDF.</p>
</div>
<section class="section" id="inv-list" aria-live="polite"><div class="skeleton" style="height:10rem"></div></section>
`;
export default body;
