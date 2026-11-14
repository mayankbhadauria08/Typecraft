/* /account/invoices. Data: GET /api/me/invoices {invoices:[{number, issuedAt, amountPaise, currency, packageName?|description?, orderId}]}. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const el = $('#inv-list');
  async function load() {
    K.skeleton(el, 4);
    const res = await K.api('GET', '/api/me/invoices');
    if (!res.ok) return K.error(el, res, load);
    const list = K.list(res.data, 'invoices', 'items');
    if (!list.length) return K.empty(el, { icon: 'file', title: 'No invoices yet', text: 'An invoice is issued automatically when a payment succeeds.', action: { href: '/pricing', label: 'See plans' } });
    K.mount(el, K.table([
      { label: 'Invoice', value: (i) => h('a', { class: 'mono', href: `/account/invoices/${encodeURIComponent(i.number)}`, text: i.number }) },
      { label: 'Date', value: (i) => K.date(K.pick(i, 'issuedAt', 'issued_at')) },
      { label: 'For', value: (i) => K.pick(i, 'packageName', 'description') || (Array.isArray(i.lines) && i.lines[0] ? i.lines[0].description : '—') },
      { label: 'Amount', num: true, value: (i) => K.money(K.pick(i, 'amountPaise', 'amount_paise'), i.currency) },
      { label: '', value: (i) => h('a', { class: 'btn btn-ghost btn-sm', href: `/account/invoices/${encodeURIComponent(i.number)}`, text: 'View / print' }) },
    ], list, { caption: 'Invoices' }));
  }
  load();
})();
