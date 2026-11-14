/* /admin. Data: GET /api/admin/overview → {at, users:{total, new7d, paying}, revenue:{todayPaise, d7Paise, d30Paise, totalPaise, grossTotalPaise,
   refundsTotalPaise, paidOrders}, ordersToday:{paid, failed, …}, pendingOrders24h, webhookFailures7d, emailFailures24h, newContactMessages,
   activeByPackage:[{packageId, name, active}], health:{learners, activeToday, runsToday, eventsToday, rejectedToday, failedToday, rejected7d,
   failed7d, rejectReasons7d:[{reason, n}], feedback7d, lastRebuild:{at, users, differences, errors}|null}};
   GET /api/admin/revenue (last 30 days: daily[{date, grossPaise}]) for the chart — owner/admin only, support sees a note. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;

  function stat(label, value, sub, href, tone) {
    const inner = [h('p', { class: 'stat-label', text: label }), h('p', { class: 'stat-value mono', text: value }), sub ? h('p', { class: 'stat-sub muted' }, tone ? K.badge(tone[0], tone[1]) : null, tone ? ' ' : null, sub) : null];
    return href ? h('a', { class: 'stat card', href, style: 'text-decoration:none;color:inherit' }, inner) : h('div', { class: 'stat card' }, inner);
  }

  function kpis(o) {
    const u = o.users, r = o.revenue;
    const failed = o.ordersToday.failed || 0;
    const active = o.activeByPackage.filter((p) => p.packageId !== 'free').reduce((n, p) => n + p.active, 0);
    K.mount($('#ad-kpis'),
      stat('Users', K.num(u.total), `${K.num(u.new7d)} joined in 7 days`, '/admin/users'),
      stat('Paying users', K.num(u.paying), u.total ? `${K.num((u.paying / u.total) * 100, 1)}% of users` : null, '/admin/users'),
      stat('Net revenue today', K.money(r.todayPaise), `${K.money(r.d7Paise)} in 7 days`, '/admin/revenue'),
      stat('Net revenue, 30 days', K.money(r.d30Paise), `${K.money(r.grossTotalPaise)} gross all time, ${K.money(r.refundsTotalPaise)} refunded`, '/admin/revenue'),
      stat('Active plan periods', K.num(active), `${K.num(r.paidOrders)} paid orders in all`),
      stat('Failed payments today', K.num(failed), `${K.num(o.ordersToday.paid || 0)} paid today`, '/admin/payments?status=failed', failed ? ['failed', 'check'] : null),
      stat('Pending payments', K.num(o.pendingOrders24h), 'last 24 h, waiting for the bank', '/admin/payments?status=pending', o.webhookFailures7d ? ['failed', `${o.webhookFailures7d} webhook failures`] : null),
      stat('Emails failed', K.num(o.emailFailures24h), o.newContactMessages ? `last 24 h · ${K.num(o.newContactMessages)} new contact messages` : 'last 24 h', '/admin/emails', o.emailFailures24h ? ['failed', 'retry'] : null));
    K.bars($('#ad-plans'), o.activeByPackage.filter((p) => p.packageId !== 'free').map((p) => ({ label: p.name, value: p.active })), { label: 'Active plans by package', emptyTitle: 'No active plans yet' });
    $('#ad-asof').textContent = `Users, revenue, payments and email health · as of ${K.dateTime(o.at)}`;
  }

  async function revenueChart() {
    const res = await K.api('GET', '/api/admin/revenue');
    if (res.status === 403) return K.mount($('#ad-rev'), h('p', { class: 'muted', text: 'Revenue is visible to owners and admins.' }));
    if (!res.ok) return K.error($('#ad-rev'), res, revenueChart);
    K.columns($('#ad-rev'), res.data.daily.map((d) => ({ label: d.date, value: d.grossPaise })), { label: 'Gross revenue by day', format: (v) => K.money(v), emptyTitle: 'No revenue in the last 30 days' });
  }

  function health(hl) {
    const el = $('#ad-health');
    if (!hl) return K.mount(el, h('p', { class: 'muted', text: 'App health numbers are not available.' }));
    const reasons = hl.rejectReasons7d;
    const lr = hl.lastRebuild;
    K.mount(el,
      h('div', { class: 'grid grid-4' },
        stat('Learners', K.num(hl.learners)), stat('Active today', K.num(hl.activeToday)),
        stat('Runs today', K.num(hl.runsToday), `${K.num(hl.eventsToday)} events`),
        stat('Rejected events', K.num(hl.rejectedToday), `${K.num(hl.rejected7d)} in 7 days · ${K.num(hl.failedToday)} failed today`, null, hl.failedToday ? ['failed', 'busy'] : null)),
      h('div', { class: 'grid grid-2 section' },
        h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Why events were rejected (7 days)' })),
          reasons.length ? K.table([{ label: 'Reason', value: (r) => h('span', { class: 'mono', text: r.reason }) }, { label: 'Events', num: true, value: (r) => K.num(r.n) }], reasons) : h('p', { class: 'muted', text: 'Nothing rejected. Good.' })),
        h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Nightly totals check' })),
          lr ? h('dl', { style: 'display:grid;grid-template-columns:auto 1fr;gap:.35rem 1rem;margin:0' },
            h('dt', { class: 'muted', text: 'Last run' }), h('dd', { style: 'margin:0', text: K.dateTime(lr.at) }),
            h('dt', { class: 'muted', text: 'Learners checked' }), h('dd', { style: 'margin:0', text: K.num(lr.users) }),
            h('dt', { class: 'muted', text: 'Differences fixed' }), h('dd', { style: 'margin:0', text: K.num(lr.differences) }),
            h('dt', { class: 'muted', text: 'Errors' }), h('dd', { style: 'margin:0' }, lr.errors ? K.badge('failed', String(lr.errors)) : '0'))
            : h('p', { class: 'muted', text: 'Has not run yet.' }),
          h('p', { class: 'muted', text: `Feedback messages in 7 days: ${K.num(hl.feedback7d || 0)}` }))));
  }

  async function load() {
    K.mount($('#ad-alert'));
    const ov = await K.api('GET', '/api/admin/overview');
    if (!ov.ok) {
      K.error($('#ad-kpis'), ov, load);
      ['#ad-rev', '#ad-plans', '#ad-health'].forEach((sel) => K.mount($(sel)));
      return;
    }
    kpis(ov.data);
    health(ov.data.health);
    revenueChart();
  }
  $('#ad-refresh').addEventListener('click', load);
  load();
})();
