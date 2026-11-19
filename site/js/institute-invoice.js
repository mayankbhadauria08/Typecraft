/* /institute/:id/invoices/:number (printable). GET /api/institutes/:id/invoices/:number (institute admins), else
   GET /api/console/institutes/:id/invoices/:number (TypeCraft staff) → { invoice: { number, issuedAt, amountPaise,
   billedTo: { name, contactName, email, phone, city, gstin }, seller: { name, legalName, address, email, phone, gstin },
   lines: [{ description, quantity, amountPaise }], subtotalPaise, tax: { ratePercent, amountPaise, note }, totalPaise,
   payment: { method, reference, paidOn } } }. docs/INSTITUTES.md §14. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const parts = location.pathname.split('/');
  const id = decodeURIComponent(parts[2] || ''), number = decodeURIComponent(parts[4] || '');
  const lines = (...rows) => rows.filter((r) => r != null && r !== '').map((r) => h('p', { text: r }));

  async function load() {
    $('#inv-number').textContent = number;
    document.title = `Invoice ${number} · TypeCraft`;
    let res = await K.api('GET', `/api/institutes/${encodeURIComponent(id)}/invoices/${encodeURIComponent(number)}`);
    if (!res.ok && (res.status === 401 || res.status === 404 || res.status === 403)) {
      const staff = await K.api('GET', `/api/console/institutes/${encodeURIComponent(id)}/invoices/${encodeURIComponent(number)}`);
      if (staff.ok) { res = staff; $('#inv-back').href = `/console/institutes/${encodeURIComponent(id)}`; $('#inv-back').textContent = '← Console'; }
    } else if (res.ok) $('#inv-back').href = `/institute/${encodeURIComponent(id)}`;
    if (!res.ok) {
      K.mount($('#inv-seller'));
      if ([401, 403, 404].includes(res.status)) return K.empty($('#inv-body'), { icon: 'file', title: 'Invoice not found', text: 'Sign in as the institute’s admin, or open it from your institute’s page.' });
      return K.error($('#inv-body'), res, load);
    }
    const inv = res.data.invoice, seller = inv.seller || {}, billed = inv.billedTo || {}, tax = inv.tax || {}, pay = inv.payment || {};
    const money = (p) => K.money(p, 'INR');
    K.mount($('#inv-seller'), lines(seller.legalName || seller.name, seller.address, seller.email, seller.phone, seller.gstin ? `GSTIN: ${seller.gstin}` : null));
    K.mount($('#inv-dates'), h('dt', { text: 'Date' }), h('dd', { text: K.date(inv.issuedAt) }));
    K.mount($('#inv-body'),
      h('div', { class: 'inv-parties' },
        h('div', null, h('p', { class: 'inv-label', text: 'Billed to' }), lines(billed.name, billed.contactName ? `Attn: ${billed.contactName}` : null, billed.city, billed.email, billed.phone, billed.gstin ? `GSTIN: ${billed.gstin}` : null)),
        h('div', null, h('p', { class: 'inv-label', text: 'Payment' }), lines(pay.method ? `${pay.method}${pay.paidOn ? ` on ${K.date(pay.paidOn + 'T12:00:00+05:30')}` : ''}` : null, pay.reference ? `Reference ${pay.reference}` : null), h('p', null, K.badge('paid', 'Paid')))),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('caption', { class: 'sr-only', text: 'Invoice lines' }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Description' }), h('th', { scope: 'col', class: 'num', text: 'Qty' }), h('th', { scope: 'col', class: 'num', text: 'Amount' }))),
        h('tbody', null, (inv.lines || []).map((l) => h('tr', null, h('td', { text: l.description }), h('td', { class: 'num mono', text: String(l.quantity ?? 1) }), h('td', { class: 'num mono', text: money(l.amountPaise) })))),
        h('tfoot', null,
          h('tr', null, h('th', { scope: 'row', colspan: 2, text: 'Subtotal' }), h('td', { class: 'num mono', text: money(inv.subtotalPaise) })),
          h('tr', null, h('th', { scope: 'row', colspan: 2, text: tax.ratePercent ? `GST ${tax.ratePercent}%` : 'GST' }), h('td', { class: 'num mono', text: money(tax.amountPaise || 0) })),
          h('tr', { class: 'inv-total' }, h('th', { scope: 'row', colspan: 2, text: 'Total' }), h('td', { class: 'num mono', text: money(inv.totalPaise) }))))),
      h('p', { class: 'muted', text: seller.gstin ? tax.note : 'The seller is not registered for GST, so no GST is charged.' }),
      h('p', { class: 'inv-foot', text: `Questions about this invoice? Write to ${seller.email || 'hello@typecrafttyping.com'} and quote ${inv.number}.` }));
    $('#inv-print').disabled = false;
  }
  $('#inv-print').addEventListener('click', () => window.print());
  load();
})();
