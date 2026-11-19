// /institute/:id/invoices/:number — an institute's invoice, printable (layout 'bare'; docs/INSTITUTES.md §14).
// The page holds no data: its script asks GET /api/institutes/:id/invoices/:number (the institute's admins), or
// GET /api/console/institutes/:id/invoices/:number (TypeCraft staff with a console session). Anyone else sees "not found".
import { INVOICE_STYLE } from './invoice.js';

export const meta = {
  path: '/institute/:id/invoices/:number', title: 'Invoice', description: 'A printable invoice for an institute.',
  access: 'public', layout: 'bare', noindex: true, sitemap: false,
};
export const body = `
<div class="container narrow inv-page">
  <div class="inv-tools field-row">
    <a class="btn btn-ghost btn-sm" href="/institute" id="inv-back">&larr; Institute</a>
    <button class="btn btn-primary btn-sm" type="button" id="inv-print" disabled>Print or save as PDF</button>
  </div>
  <article class="card inv-sheet" id="inv-sheet" aria-labelledby="inv-h">
    <header class="inv-top">
      <div><p class="inv-brand">TypeCraft</p><div id="inv-seller" class="inv-block"><div class="skeleton" style="height:4rem;width:14rem"></div></div></div>
      <div class="inv-meta"><h1 id="inv-h">Invoice <span id="inv-number" class="mono"></span></h1><dl id="inv-dates"></dl></div>
    </header>
    <div id="inv-body"><div class="skeleton" style="height:10rem"></div></div>
  </article>
</div>
${INVOICE_STYLE}
`;
export default body;
