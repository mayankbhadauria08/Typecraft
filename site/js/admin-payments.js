/* /admin/payments. Data: GET /api/admin/payments?status&q&page → {payments:[{id (order id), userId, userEmail, userName, packageName, amountPaise, currency,
   status, razorpayOrderId, razorpayPaymentId, method, failureReason, refundedPaise, invoiceNumber, createdAt, paidAt}], page, pages, total};
   POST /api/admin/payments/:id/refund {amountPaise, reason} (id = the row id from the list). Support role: read-only. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const P = (o, ...k) => K.pick(o, ...k);
  let status = K.qs('status') || '', q = K.qs('q') || '', page = 1, role = null;
  const canWrite = () => role === 'owner' || role === 'admin';

  function detail(o) {
    const amount = P(o, 'amountPaise', 'amount_paise') || 0;
    const refunded = P(o, 'refundedPaise', 'refunded_paise') || 0;
    const refundable = amount - refunded;
    const dlg = h('dialog', { class: 'tck-dialog', 'aria-labelledby': 'apy-d-h' });
    const close = () => { dlg.close(); dlg.remove(); };
    const row = (k, v) => [h('dt', { class: 'muted', text: k }), h('dd', { style: 'margin:0;overflow-wrap:anywhere' }, v == null || v === '' ? '—' : v)];
    const refundBtn = canWrite() && ['paid', 'partially_refunded'].includes(o.status) && refundable > 0
      ? h('button', { type: 'button', class: 'btn btn-danger', text: 'Refund…', onclick: () => { close(); refund(o, refundable); } }) : null;
    K.append(dlg, h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { id: 'apy-d-h', text: `Order ${o.id}` })),
      h('dl', { style: 'display:grid;grid-template-columns:auto 1fr;gap:.35rem 1rem' },
        row('Status', K.badge(o.status)),
        row('Customer', [P(o, 'userName', 'billedName') || '', ' ', P(o, 'userEmail', 'email') ? h('a', { href: `/admin/users?q=${encodeURIComponent(P(o, 'userEmail', 'email'))}`, text: P(o, 'userEmail', 'email') }) : null]),
        row('Plan', P(o, 'packageName', 'packageId')),
        row('Amount', K.money(amount, o.currency)),
        row('Refunded', refunded ? K.money(refunded, o.currency) : null),
        row('Method', o.method),
        row('Razorpay order', h('span', { class: 'mono', text: P(o, 'razorpayOrderId', 'razorpay_order_id') || '—' })),
        row('Razorpay payment', h('span', { class: 'mono', text: P(o, 'razorpayPaymentId', 'razorpay_payment_id') || '—' })),
        row('Invoice', P(o, 'invoiceNumber') ? h('span', { class: 'mono', text: P(o, 'invoiceNumber') }) : null),
        row('Failure', P(o, 'failureReason', 'failure_reason')),
        row('Created', K.dateTime(P(o, 'createdAt', 'created_at'))),
        row('Paid', P(o, 'paidAt') ? K.dateTime(P(o, 'paidAt')) : null)),
      h('div', { class: 'card-foot field-row' }, h('button', { type: 'button', class: 'btn btn-ghost', text: 'Close', onclick: close }), refundBtn)));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    document.body.appendChild(dlg);
    dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', '');
  }

  async function refund(o, refundable) {
    const vals = await K.confirm({
      title: `Refund order ${o.id}?`, danger: true, confirmLabel: 'Refund now', typeToConfirm: 'REFUND',
      text: `Up to ${K.money(refundable, o.currency)} can be refunded to ${P(o, 'userEmail', 'email') || 'the customer'}. Razorpay sends it to the original payment method; it cannot be undone. A full refund ends the plan period bought with this order.`,
      fields: [
        { name: 'amount', label: 'Amount (₹)', type: 'number', value: (refundable / 100).toString(), min: 1, max: refundable / 100, step: '0.01', required: true, hint: `Full amount: ${K.money(refundable, o.currency)}` },
        { name: 'reason', label: 'Reason (kept in the audit log)', type: 'textarea', required: true },
      ],
    });
    if (!vals) return;
    const amountPaise = Math.round(Number(vals.amount) * 100);
    if (!(amountPaise >= 100 && amountPaise <= refundable)) return K.toast(`Enter an amount between ₹1 and ${K.money(refundable)}.`, 'bad');
    const res = await K.api('POST', `/api/admin/payments/${encodeURIComponent(o.id)}/refund`, { amountPaise, reason: vals.reason.trim() });
    if (!res.ok) return K.toast(K.errMsg(res), 'bad');
    K.toast((res.data && res.data.message) || `Refund of ${K.money(amountPaise)} started. Razorpay confirms it in a few minutes.`, 'ok');
    list();
  }

  async function list() {
    const el = $('#apy-list');
    K.skeleton(el, 6);
    const res = await K.api('GET', `/api/admin/payments?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&page=${page}`);
    if (!res.ok) return K.error(el, res, list);
    const rows = K.list(res.data, 'payments', 'orders', 'items');
    if (!rows.length) { K.mount($('#apy-pager')); return K.empty(el, { icon: 'card', title: 'No payments found', text: status || q ? 'Try another status or search.' : 'Orders appear here when people start a checkout.' }); }
    K.mount(el,
      res.data.total != null ? h('p', { class: 'muted', text: `${K.num(res.data.total)} order${res.data.total === 1 ? '' : 's'}` }) : null,
      K.table([
        { label: 'Date', value: (o) => K.dateTime(P(o, 'paidAt', 'createdAt', 'created_at')) },
        { label: 'Customer', value: (o) => P(o, 'userEmail', 'email') || '—' },
        { label: 'Plan', value: (o) => P(o, 'packageName', 'packageId') },
        { label: 'Amount', num: true, value: (o) => K.money(P(o, 'amountPaise', 'amount_paise'), o.currency) },
        { label: 'Status', value: (o) => K.badge(o.status) },
        { label: 'Payment id', value: (o) => h('span', { class: 'mono', text: P(o, 'razorpayPaymentId', 'razorpay_payment_id') || '—' }) },
      ], rows, { caption: 'Payments', onRow: detail }));
    K.pager($('#apy-pager'), { page: res.data.page || page, pages: res.data.pages || 1, onPage: (p) => { page = p; list(); } });
  }

  K.$$('#apy-tabs [role=tab]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.status === status));
    b.addEventListener('click', () => {
      status = b.dataset.status; page = 1;
      K.$$('#apy-tabs [role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      list();
    });
  });
  $('#apy-q').value = q;
  $('#apy-search').addEventListener('submit', (e) => { e.preventDefault(); q = $('#apy-q').value.trim(); page = 1; list(); });
  K.me().then((me) => { role = me && me.role; list(); });
})();
