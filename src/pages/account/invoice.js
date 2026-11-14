// /account/invoices/:number — printable invoice (layout 'bare'). Data: GET /api/me/invoices/:number.
export const meta = {
  path: '/account/invoices/:number', title: 'Invoice', description: 'A printable invoice.',
  access: 'user', layout: 'bare', nav: 'invoices', noindex: true,
};
export const body = `
<div class="container narrow inv-page">
  <div class="inv-tools field-row">
    <a class="btn btn-ghost btn-sm" href="/account/invoices">&larr; All invoices</a>
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
<style>
.inv-page{padding-top:1.5rem;padding-bottom:3rem}
.inv-tools{justify-content:space-between;margin-bottom:1rem}
.inv-sheet{padding:clamp(1.25rem,4vw,2.5rem)}
.inv-top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:1.5rem;margin-bottom:1.5rem}
.inv-brand{font-family:var(--display);font-size:1.6rem;margin:0 0 .4rem}
.inv-block p{margin:.1rem 0}
.inv-meta{text-align:right}
.inv-meta h1{font-size:1.4rem;margin:0 0 .5rem}
.inv-meta dl{display:grid;grid-template-columns:auto auto;gap:.15rem .75rem;margin:0;justify-content:end}
.inv-meta dt{color:var(--muted)}.inv-meta dd{margin:0;font-family:var(--mono)}
.inv-parties{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1.25rem;margin-bottom:1.5rem}
.inv-label{font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 .3rem}
.inv-total td,.inv-total th{font-weight:600;font-size:1.05rem;border-top:2px solid var(--line-strong)}
.inv-paid{margin-top:1.25rem}
.inv-foot{margin-top:2rem;font-size:13px;color:var(--muted)}
@media (max-width:540px){.inv-meta{text-align:left}.inv-meta dl{justify-content:start}}
@media print{
  @page{margin:16mm}
  html,body{background:#fff !important;color:#111 !important}
  body::before,body::after,#bgfx,.inv-tools,.toast,[data-toast]{display:none !important}
  .inv-page{padding:0;max-width:none}
  .inv-sheet{border:0 !important;box-shadow:none !important;background:#fff !important;color:#111 !important;padding:0}
  .inv-sheet *{color:#111 !important;background:transparent !important;border-color:#bbb !important}
  .inv-sheet .muted,.inv-label,.inv-meta dt,.inv-foot{color:#555 !important}
  .badge{border:1px solid #888 !important}
  a{text-decoration:none}
}
</style>
`;
export default body;
