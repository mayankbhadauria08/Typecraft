/* /account/invoices/:number (printable). Data: GET /api/me/invoices/:number → {invoice:{number, issuedAt, amountPaise, currency,
   billedName, billedEmail, seller:{name, legalName, address, email, phone, gstin}, lines:[{description, amountPaise}],
   orderId, razorpayPaymentId?, paymentMethod?, packageName?, periodStart?, periodEnd?}} (fields also accepted at the top level). */
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
    const inv = res.data.invoice || res.data;
    let seller = inv.seller || {};
    if (typeof seller === 'string') { try { seller = JSON.parse(seller); } catch { seller = {}; } }
    let items = inv.lines || [];
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }
    const cur = inv.currency || 'INR';
    const total = K.pick(inv, 'amountPaise', 'amount_paise');
    const issued = K.pick(inv, 'issuedAt', 'issued_at');
    const payId = K.pick(inv, 'razorpayPaymentId', 'razorpay_payment_id', 'paymentId');
    const method = K.pick(inv, 'paymentMethod', 'method');

    K.mount($('#inv-seller'), lines(seller.legalName || seller.name, seller.address, seller.email, seller.phone, seller.gstin ? `GSTIN: ${seller.gstin}` : null));
    K.mount($('#inv-dates'),
      h('dt', { text: 'Date' }), h('dd', { text: K.date(issued) }),
      h('dt', { text: 'Order' }), h('dd', { text: K.pick(inv, 'orderId', 'order_id') || '—' }));
    K.mount($('#inv-body'),
      h('div', { class: 'inv-parties' },
        h('div', null, h('p', { class: 'inv-label', text: 'Billed to' }), lines(K.pick(inv, 'billedName', 'billed_name'), K.pick(inv, 'billedEmail', 'billed_email'))),
        h('div', null, h('p', { class: 'inv-label', text: 'Status' }), h('p', null, K.badge('paid', 'Paid')), payId ? h('p', { class: 'mono', text: payId }) : null)),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('caption', { class: 'sr-only', text: 'Invoice lines' }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Description' }), h('th', { scope: 'col', class: 'num', text: 'Amount' }))),
        h('tbody', null, items.map((l) => h('tr', null, h('td', { text: l.description || '' }), h('td', { class: 'num mono', text: K.money(K.pick(l, 'amountPaise', 'amount_paise'), cur) })))),
        h('tfoot', null, h('tr', { class: 'inv-total' }, h('th', { scope: 'row', text: 'Total' }), h('td', { class: 'num mono', text: K.money(total, cur) }))))),
      h('p', { class: 'inv-paid' }, h('strong', { text: 'Paid via Razorpay' }), method ? ` (${method})` : '', issued ? ` on ${K.date(issued)}.` : '.'),
      seller.gstin ? null : h('p', { class: 'muted', text: 'The seller is not registered for GST, so no GST is charged.' }),
      h('p', { class: 'inv-foot', text: `Questions about this invoice? Write to ${seller.email || 'hello@typecrafttyping.com'} and quote ${number}.` }));
    const btn = $('#inv-print');
    btn.disabled = false;
  }
  $('#inv-print').addEventListener('click', () => window.print());
  load();
})();
