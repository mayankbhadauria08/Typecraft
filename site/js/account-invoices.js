/* /account/invoices. Data: GET /api/me/invoices → {invoices:[{number, orderId, amountPaise, currency, issuedAt, description}]}. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const el = $('#inv-list');
  async function load() {
    K.skeleton(el, 4);
    const res = await K.api('GET', '/api/me/invoices');
    if (!res.ok) return K.error(el, res, load);
    const list = res.data.invoices;
    if (!list.length) return K.empty(el, { icon: 'file', title: 'No invoices yet', text: 'An invoice is issued automatically when a payment succeeds.', action: { href: '/pricing', label: 'See plans' } });
    K.mount(el, K.table([
      { label: 'Invoice', value: (i) => h('a', { class: 'mono', href: `/account/invoices/${encodeURIComponent(i.number)}`, text: i.number }) },
      { label: 'Date', value: (i) => K.date(i.issuedAt) },
      { label: 'For', value: (i) => i.description || '—' },
      { label: 'Amount', num: true, value: (i) => K.money(i.amountPaise, i.currency) },
      { label: '', value: (i) => h('a', { class: 'btn btn-ghost btn-sm', href: `/account/invoices/${encodeURIComponent(i.number)}`, text: 'View / print' }) },
    ], list, { caption: 'Invoices' }));
  }
  load();
})();
