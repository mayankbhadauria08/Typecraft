/* /account/invoices/:number (printable). Data: GET /api/me/invoices/:number → {invoice:{number, orderId, issuedAt, amountPaise, currency,
   billedTo:{name, email, gstin}, seller:{name, legalName, address, email, phone, gstin}, lines:[{description, quantity, amountPaise}],
   subtotalPaise, tax:{gstin, ratePercent, amountPaise, note}, totalPaise, status, paidAt, paymentMethod, paymentReference, refundedPaise}}. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const number = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');

  function lines(...rows) { return rows.filter((r) => r != null && r !== '').map((r) => h('p', { text: r })); }

  async function load() {
    $('#inv-number').textContent = number;
    document.title = `Invoice ${number} · TypeCraft`;
    const res = await K.api('GET', `/api/me/invoices/${encodeURIComponent(number)}`);
    if (!res.ok) {
      K.mount($('#inv-seller'));
      if (res.status === 404) return K.empty($('#inv-body'), { icon: 'file', title: 'Invoice not found', text: 'Check the number, or open it from your invoices list.', action: { href: '/account/invoices', label: 'All invoices' } });
      return K.error($('#inv-body'), res, load);
    }
    const inv = res.data.invoice;
    const seller = inv.seller || {};
    const billed = inv.billedTo || {};
    const tax = inv.tax || {};
    const money = (p) => K.money(p, inv.currency);
    const status = inv.status === 'refunded' ? K.badge('refunded', 'Refunded') : inv.status === 'partially_refunded' ? K.badge('partially_refunded') : K.badge('paid', 'Paid');

    K.mount($('#inv-seller'), lines(seller.legalName || seller.name, seller.address, seller.email, seller.phone, seller.gstin ? `GSTIN: ${seller.gstin}` : null));
    K.mount($('#inv-dates'),
      h('dt', { text: 'Date' }), h('dd', { text: K.date(inv.issuedAt) }),
      h('dt', { text: 'Order' }), h('dd', { text: inv.orderId }));
    K.mount($('#inv-body'),
      h('div', { class: 'inv-parties' },
        h('div', null, h('p', { class: 'inv-label', text: 'Billed to' }), lines(billed.name, billed.email, billed.gstin ? `GSTIN: ${billed.gstin}` : null)),
        h('div', null, h('p', { class: 'inv-label', text: 'Status' }), h('p', null, status), inv.paymentReference ? h('p', { class: 'mono', text: inv.paymentReference }) : null)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('caption', { class: 'sr-only', text: 'Invoice lines' }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Description' }), h('th', { scope: 'col', class: 'num', text: 'Qty' }), h('th', { scope: 'col', class: 'num', text: 'Amount' }))),
        h('tbody', null, (inv.lines || []).map((l) => h('tr', null, h('td', { text: l.description }), h('td', { class: 'num mono', text: String(l.quantity ?? 1) }), h('td', { class: 'num mono', text: money(l.amountPaise) })))),
        h('tfoot', null,
          h('tr', null, h('th', { scope: 'row', colspan: 2, text: 'Subtotal' }), h('td', { class: 'num mono', text: money(inv.subtotalPaise) })),
          h('tr', null, h('th', { scope: 'row', colspan: 2, text: tax.ratePercent ? `GST ${tax.ratePercent}%` : 'GST' }), h('td', { class: 'num mono', text: money(tax.amountPaise || 0) })),
          h('tr', { class: 'inv-total' }, h('th', { scope: 'row', colspan: 2, text: 'Total' }), h('td', { class: 'num mono', text: money(inv.totalPaise) }))))),
      h('p', { class: 'inv-paid' }, h('strong', { text: 'Paid via Razorpay' }), inv.paymentMethod ? ` (${inv.paymentMethod})` : '', inv.paidAt ? ` on ${K.date(inv.paidAt)}.` : '.'),
      inv.refundedPaise ? h('p', { text: `${money(inv.refundedPaise)} of this payment has been refunded.` }) : null,
      seller.gstin ? null : h('p', { class: 'muted', text: 'The seller is not registered for GST, so no GST is charged.' }),
      h('p', { class: 'inv-foot', text: `Questions about this invoice? Write to ${seller.email || 'hello@typecrafttyping.com'} and quote ${number}.` }));
    $('#inv-print').disabled = false;
  }
  $('#inv-print').addEventListener('click', () => window.print());
  load();
})();
