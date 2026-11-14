/* /admin/revenue (owner/admin). Data: GET /api/admin/revenue?from&to → {from, to, currency, daily:[{date, orders, grossPaise, refundsPaise, netPaise}]
   (every day of the range), byPackage:[{packageId, name, orders, grossPaise, refundsPaise, netPaise}],
   totals:{orders, grossPaise, refundsPaise, netPaise, refunds (count), avgOrderPaise}}. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const form = $('#ar-range');
  const utcToday = () => new Date().toISOString().slice(0, 10);

  function setRange(days) {
    const to = utcToday();
    form.elements.to.value = to;
    form.elements.from.value = K.addDays(to, -(days - 1));
  }
  const stat = (label, value, sub) => h('div', { class: 'stat card' }, h('p', { class: 'stat-label', text: label }), h('p', { class: 'stat-value mono', text: value }), sub ? h('p', { class: 'stat-sub muted', text: sub }) : null);

  async function load() {
    const from = form.elements.from.value, to = form.elements.to.value;
    if (!from || !to || from > to) return K.formErrors(form, { from: 'Pick a start date on or before the end date.' });
    K.formErrors(form, null);
    ['#ar-daily', '#ar-pkg', '#ar-ref'].forEach((s) => K.skeleton($(s), 4));
    const res = await K.api('GET', `/api/admin/revenue?from=${from}&to=${to}`);
    if (!res.ok) { K.error($('#ar-kpis'), res, load); ['#ar-daily', '#ar-pkg', '#ar-ref'].forEach((s) => K.mount($(s))); return; }
    const d = res.data;
    const t = d.totals || {};
    const daily = d.daily;
    const gross = t.grossPaise, refunds = t.refundsPaise, net = t.netPaise, orders = t.orders;
    K.mount($('#ar-kpis'),
      stat('Gross revenue', K.money(gross), `${K.shortDay(from)} – ${K.shortDay(to)}`),
      stat('Refunds', K.money(refunds), refunds ? `${K.num(t.refunds)} refund${t.refunds === 1 ? '' : 's'} · ${K.num((refunds / (gross || 1)) * 100, 1)}% of gross` : 'None'),
      stat('Net', K.money(net), 'Before Razorpay fees'),
      stat('Paid orders', K.num(orders), orders ? `average ${K.money(t.avgOrderPaise)}` : null));
    const points = daily.map((x) => ({ label: x.date, value: x.grossPaise }));
    K.columns($('#ar-daily'), points, { label: 'Gross revenue by day', format: (v) => K.money(v), emptyTitle: 'No revenue in this period' });
    const pk = d.byPackage;
    K.mount($('#ar-pkg'), pk.length
      ? [h('div'), K.table([
        { label: 'Package', value: (r) => r.name },
        { label: 'Orders', num: true, value: (r) => K.num(r.orders) },
        { label: 'Gross', num: true, value: (r) => K.money(r.grossPaise) },
        { label: 'Refunds', num: true, value: (r) => K.money(r.refundsPaise) },
        { label: 'Net', num: true, value: (r) => K.money(r.netPaise) },
      ], pk)]
      : null);
    if (pk.length) K.bars($('#ar-pkg').firstChild, pk.map((r) => ({ label: r.name, value: r.grossPaise })), { label: 'Gross by package', format: (v) => K.money(v) });
    else K.empty($('#ar-pkg'), { icon: 'chart', title: 'No sales in this period' });
    const refDays = daily.filter((x) => x.refundsPaise > 0).reverse();
    if (!refDays.length) K.empty($('#ar-ref'), { icon: 'info', title: 'No refunds in this period' });
    else K.mount($('#ar-ref'), K.table([
      { label: 'Date', value: (r) => K.date(`${r.date}T00:00:00Z`) },
      { label: 'Refunded', num: true, value: (r) => K.money(r.refundsPaise) },
      { label: 'Gross that day', num: true, value: (r) => K.money(r.grossPaise) },
      { label: 'Net that day', num: true, value: (r) => K.money(r.netPaise) },
    ], refDays, { caption: 'Refunds by day' }), h('p', { class: 'muted' }, 'Individual refunds are listed under ', h('a', { href: '/admin/payments?status=refunded', text: 'Payments' }), '.'));
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
  K.$$('[data-days]', form).forEach((b) => b.addEventListener('click', () => { setRange(Number(b.dataset.days)); load(); }));
  setRange(30);
  load();
})();
