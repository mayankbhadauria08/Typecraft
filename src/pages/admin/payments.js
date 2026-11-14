// /admin/payments — orders and payments with filters, detail and refunds.
export const meta = {
  path: '/admin/payments', title: 'Payments', description: 'Orders, payments and refunds.',
  access: 'admin', layout: 'admin', nav: 'payments', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Payments</h1>
  <p class="lede muted">Every order and its Razorpay payment. Refunds go back to the original payment method.</p>
</div>
<div class="section field-row">
  <div class="tabs" role="tablist" aria-label="Status" id="apy-tabs">
    <button type="button" role="tab" aria-selected="true" data-status="">All</button>
    <button type="button" role="tab" aria-selected="false" data-status="paid">Paid</button>
    <button type="button" role="tab" aria-selected="false" data-status="failed">Failed</button>
    <button type="button" role="tab" aria-selected="false" data-status="pending">Pending</button>
    <button type="button" role="tab" aria-selected="false" data-status="refunded">Refunded</button>
  </div>
  <form class="field-row" id="apy-search" role="search">
    <div class="field"><label for="apy-q">Search</label><input id="apy-q" name="q" type="search" placeholder="Email, order or payment id" autocomplete="off"></div>
    <button class="btn btn-ghost" type="submit">Search</button>
  </form>
</div>
<section class="section" id="apy-list" aria-live="polite"><div class="skeleton" style="height:14rem"></div></section>
<div id="apy-pager"></div>
`;
export default body;
