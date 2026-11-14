/* /admin/payments. Data: GET /api/admin/payments?status&q&page → {items:[{orderId, userId, email, name, packageId, packageName, amountPaise, currency,
   status, createdAt, paidAt, failureReason, razorpayOrderId, invoiceNumber, payment:{id, razorpayPaymentId, status, method, error}|null,
   refundedPaise, refundPendingPaise, refundablePaise}], page, pages, total} (q matches email, name, order id, Razorpay order or payment id);
   POST /api/admin/payments/:orderId/refund {amountPaise, reason} → {refund, orderId, orderStatus}. The server picks the captured payment of
   that order and decides what is refundable (refundablePaise). Support role: read-only. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  let status = K.qs('status') || '', q = K.qs('q') || '', page = 1, role = null;
  const canWrite = () => role === 'owner' || role === 'admin';

  function detail(o) {
    const amount = o.amountPaise;
    const refundable = o.refundablePaise;
    const pay = o.payment || {};
    const dlg = h('dialog', { class: 'tck-dialog', 'aria-labelledby': 'apy-d-h' });
    const close = () => { dlg.close(); dlg.remove(); };
    const row = (k, v) => [h('dt', { class: 'muted', text: k }), h('dd', { style: 'margin:0;overflow-wrap:anywhere' }, v == null || v === '' ? '—' : v)];
    const refundBtn = canWrite() && refundable > 0
      ? h('button', { type: 'button', class: 'btn btn-danger', text: 'Refund…', onclick: () => { close(); refund(o, refundable); } }) : null;
    K.append(dlg, h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', { id: 'apy-d-h', text: `Order ${o.orderId}` })),
      h('dl', { style: 'display:grid;grid-template-columns:auto 1fr;gap:.35rem 1rem' },
        row('Status', K.badge(o.status)),
        row('Customer', [o.name, ' ', h('a', { href: `/admin/users?q=${encodeURIComponent(o.email)}`, text: o.email })]),
        row('Plan', o.packageName),
        row('Amount', K.money(amount, o.currency)),
        row('Refunded', o.refundedPaise ? K.money(o.refundedPaise, o.currency) : null),
        row('Refund pending', o.refundPendingPaise ? K.money(o.refundPendingPaise, o.currency) : null),
        row('Can refund', refundable ? K.money(refundable, o.currency) : null),
        row('Method', pay.method),
        row('Razorpay order', h('span', { class: 'mono', text: o.razorpayOrderId || '—' })),
        row('Razorpay payment', pay.razorpayPaymentId ? [h('span', { class: 'mono', text: pay.razorpayPaymentId }), ' ', K.badge(pay.status)] : null),
        row('Invoice', o.invoiceNumber ? h('span', { class: 'mono', text: o.invoiceNumber }) : null),
        row('Failure', o.failureReason || pay.error),
        row('Created', K.dateTime(o.createdAt)),
        row('Paid', o.paidAt ? K.dateTime(o.paidAt) : null)),
      h('div', { class: 'card-foot field-row' }, h('button', { type: 'button', class: 'btn btn-ghost', text: 'Close', onclick: close }), refundBtn)));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    document.body.appendChild(dlg);
    dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', '');
  }

  async function refund(o, refundable) {
    const vals = await K.confirm({
      title: `Refund order ${o.orderId}?`, danger: true, confirmLabel: 'Refund now', typeToConfirm: 'REFUND',
      text: `Up to ${K.money(refundable, o.currency)} can be refunded to ${o.email}. Razorpay sends it to the original payment method; it cannot be undone. A full refund ends the plan period bought with this order.`,
      fields: [
        { name: 'amount', label: 'Amount (₹)', type: 'number', value: (refundable / 100).toString(), min: 1, max: refundable / 100, step: '0.01', required: true, hint: `Full amount: ${K.money(refundable, o.currency)}` },
        { name: 'reason', label: 'Reason (kept in the audit log)', type: 'textarea', required: true },
      ],
    });
    if (!vals) return;
    const amountPaise = Math.round(Number(vals.amount) * 100);
    if (!(amountPaise >= 100 && amountPaise <= refundable)) return K.toast(`Enter an amount between ₹1 and ${K.money(refundable)}.`, 'bad');
    const res = await K.api('POST', `/api/admin/payments/${encodeURIComponent(o.orderId)}/refund`, { amountPaise, reason: vals.reason.trim() });
    if (!res.ok) return K.toast(K.errMsg(res), 'bad');
    const r = res.data.refund || {};
    K.toast(r.status === 'processed' ? `Refunded ${K.money(amountPaise)}.` : `Refund of ${K.money(amountPaise)} started (${r.status || 'pending'}). Razorpay confirms it in a few minutes.`, 'ok');
    list();
  }

  async function list() {
    const el = $('#apy-list');
    K.skeleton(el, 6);
    const res = await K.api('GET', `/api/admin/payments?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&page=${page}`);
    if (!res.ok) return K.error(el, res, list);
    const rows = res.data.items;
    if (!rows.length) { K.mount($('#apy-pager')); return K.empty(el, { icon: 'card', title: 'No payments found', text: status || q ? 'Try another status or search.' : 'Orders appear here when people start a checkout.' }); }
    K.mount(el,
      h('p', { class: 'muted', text: `${K.num(res.data.total)} order${res.data.total === 1 ? '' : 's'}` }),
      K.table([
        { label: 'Date', value: (o) => K.dateTime(o.paidAt || o.createdAt) },
        { label: 'Customer', value: (o) => o.email },
        { label: 'Plan', value: (o) => o.packageName },
        { label: 'Amount', num: true, value: (o) => K.money(o.amountPaise, o.currency) },
        { label: 'Status', value: (o) => K.badge(o.status) },
        { label: 'Payment id', value: (o) => h('span', { class: 'mono', text: o.payment ? o.payment.razorpayPaymentId : '—' }) },
      ], rows, { caption: 'Payments', onRow: detail }));
    K.pager($('#apy-pager'), { page: res.data.page, pages: res.data.pages, onPage: (p) => { page = p; list(); } });
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
  K.role().then((r) => { role = r; list(); });
})();
