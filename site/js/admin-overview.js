/* /admin. Data: GET /api/admin/overview → {users, paidUsers, signupsToday?, revenueTodayPaise, revenue30dPaise, activeSubscriptions,
   failedPayments (last 7 days), pendingPayments?, emailsFailed, contactNew?, daily:[{date, revenuePaise, signups, orders}], at?};
   GET /api/admin/health (existing) → {learners, activeToday, runsToday, eventsToday, rejectedToday, failedToday, rejected7d, failed7d,
   rejectReasons7d:[{reason,n}], feedback7d, lastRebuild:{at, users, differences, errors}}. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const P = (o, ...k) => K.pick(o, ...k);

  function stat(label, value, sub, href, tone) {
    const inner = [h('p', { class: 'stat-label', text: label }), h('p', { class: 'stat-value mono', text: value }), sub ? h('p', { class: 'stat-sub muted' }, tone ? K.badge(tone[0], tone[1]) : null, tone ? ' ' : null, sub) : null];
    return href ? h('a', { class: 'stat card', href, style: 'text-decoration:none;color:inherit' }, inner) : h('div', { class: 'stat card' }, inner);
  }

  function kpis(o) {
    const failed = P(o, 'failedPayments', 'failedPayments7d') || 0;
    const mailFail = P(o, 'emailsFailed', 'emailsFailed7d') || 0;
    const users = P(o, 'users', 'totalUsers') || 0, paid = P(o, 'paidUsers') || 0;
    K.mount($('#ad-kpis'),
      stat('Users', K.num(users), P(o, 'signupsToday') != null ? `${K.num(P(o, 'signupsToday'))} joined today` : null, '/admin/users'),
      stat('Paid users', K.num(paid), users ? `${K.num((paid / users) * 100, 1)}% of users` : null, '/admin/users'),
      stat('Revenue today', K.money(P(o, 'revenueTodayPaise') || 0), null, '/admin/revenue'),
      stat('Revenue, 30 days', K.money(P(o, 'revenue30dPaise') || 0), null, '/admin/revenue'),
      stat('Active subscriptions', K.num(P(o, 'activeSubscriptions') || 0)),
      stat('Failed payments', K.num(failed), 'last 7 days', '/admin/payments?status=failed', failed ? ['failed', 'check'] : null),
      stat('Pending payments', K.num(P(o, 'pendingPayments') || 0), 'waiting for the bank', '/admin/payments?status=pending'),
      stat('Emails failed', K.num(mailFail), P(o, 'contactNew') ? `${K.num(P(o, 'contactNew'))} new contact messages` : null, '/admin/emails', mailFail ? ['failed', 'retry'] : null));
    const daily = K.list(o, 'daily', 'series');
    K.columns($('#ad-rev'), daily.map((d) => ({ label: P(d, 'date', 'day'), value: P(d, 'revenuePaise', 'grossPaise') || 0 })), { label: 'Revenue by day', format: (v) => K.money(v), emptyTitle: 'No revenue in the last 30 days' });
    K.line($('#ad-sign'), daily.map((d) => ({ label: P(d, 'date', 'day'), value: P(d, 'signups') || 0 })), { label: 'Sign-ups by day', format: (v) => K.num(v), emptyTitle: 'No sign-up data yet' });
    if (o.at) $('#ad-asof').textContent = `Users, revenue, payments and email health · as of ${K.dateTime(o.at)}`;
  }

  function health(hl) {
    const el = $('#ad-health');
    if (!hl) return K.mount(el, h('p', { class: 'muted', text: 'App health numbers are not available.' }));
    const reasons = K.list(hl, 'rejectReasons7d');
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
    const [ov, hl] = await Promise.all([K.api('GET', '/api/admin/overview'), K.api('GET', '/api/admin/health')]);
    if (ov.ok) kpis(ov.data);
    else {
      K.error($('#ad-kpis'), ov, load);
      K.mount($('#ad-rev')); K.mount($('#ad-sign'));
    }
    health(hl.ok ? hl.data : null);
  }
  $('#ad-refresh').addEventListener('click', load);
  load();
})();
