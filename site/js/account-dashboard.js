/* /dashboard. Data: TC.me() (user, entitlements), GET /api/user/state, GET /api/me/analytics, GET /api/user/history, GET /api/me/tests. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;

  function greeting(name) {
    const hr = new Date().getHours();
    const part = hr < 5 ? 'Good evening' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const first = String(name || '').trim().split(/\s+/)[0];
    return first ? `${part}, ${first}` : part;
  }

  function planCard(ent) {
    const el = $('#dash-plan-body');
    if (!ent) return K.error(el, 'We could not load your plan.', () => location.reload());
    const free = !ent.plan || ent.plan === 'free';
    const left = K.daysLeft(ent.expiresAt);
    const kids = [h('p', null, h('span', { class: free ? 'badge badge-muted' : 'badge badge-brand', text: ent.planName || (free ? 'Free' : ent.plan) }))];
    if (free) {
      kids.push(h('p', { class: 'muted', text: 'Free includes the first five lessons, the Daily Challenge and 3 typing tests a day.' }));
      kids.push(h('div', { class: 'card-foot' }, h('a', { class: 'btn btn-primary', href: '/pricing', text: 'See plans' })));
    } else if (!ent.expiresAt) {
      kids.push(h('p', { class: 'muted', text: 'Your plan never expires.' }));
    } else {
      kids.push(h('p', null, 'Active until ', h('strong', { text: K.date(ent.expiresAt) }), h('span', { class: 'muted', text: left != null ? ` · ${left} day${left === 1 ? '' : 's'} left` : '' })));
      if (left != null && left <= 7) kids.push(K.alert('info', 'Your plan ends soon. Renew now and the new period starts when this one ends, so you lose no days.'));
      kids.push(h('div', { class: 'card-foot' },
        h('a', { class: left != null && left <= 7 ? 'btn btn-primary' : 'btn btn-ghost', href: `/checkout?plan=${encodeURIComponent(ent.plan)}`, text: 'Renew' }),
        h('a', { class: 'btn btn-ghost', href: '/account/plans', text: 'Upgrade or compare' })));
    }
    K.mount(el, kids);
  }

  function lessonTitle(id) {
    const meta = window.TC_META && TC_META.BY_ID && TC_META.BY_ID[id];
    return meta ? `Lesson ${meta.n}: ${meta.title}` : null;
  }

  function today(state) {
    const el = $('#dash-today');
    const t = state.today || {};
    const goal = t.goal || 10, mins = t.minutes || 0;
    const pct = Math.min(100, Math.round((mins / goal) * 100));
    const quests = (state.quests && state.quests.items) || [];
    const done = quests.filter((q) => q.done).length;
    K.mount(el,
      h('p', null, h('span', { class: 'stat-value mono', text: `${mins}` }), h('span', { class: 'muted', text: ` of ${goal} minutes` })),
      h('div', { class: 'tck-bar-track', role: 'progressbar', 'aria-label': 'Daily goal', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct }, h('span', { class: 'tck-bar-fill', style: `width:${pct}%` })),
      h('p', { class: 'muted' }, mins >= goal ? 'Daily goal reached. Nice work.' : `${goal - mins} minute${goal - mins === 1 ? '' : 's'} to go today.`,
        quests.length ? ` Quests: ${done} of ${quests.length} done.` : '',
        state.streak && state.streak.count ? ` Streak: ${state.streak.count} day${state.streak.count === 1 ? '' : 's'}.` : ''));
    const pos = state.position && state.position.lessonId;
    const title = pos && lessonTitle(pos);
    if (title) { const a = $('#dash-continue'); a.textContent = `Continue: ${title}`; }
  }

  function stats(state, series) {
    const t = state.totals || {};
    const recent = series.slice(-7).filter((d) => d.wpm != null);
    const avg7 = recent.length ? recent.reduce((s, d) => s + Number(d.wpm), 0) / recent.length : null;
    const stat = (label, value, sub) => h('div', { class: 'stat card' }, h('p', { class: 'stat-label', text: label }), h('p', { class: 'stat-value mono', text: value }), sub ? h('p', { class: 'stat-sub muted', text: sub }) : null);
    K.mount($('#dash-stats'),
      stat('Best speed', t.bestWpm ? `${K.num(t.bestWpm)} WPM` : '—', avg7 != null ? `7-day average ${K.num(avg7)} WPM` : 'No runs this week'),
      stat('Accuracy', t.avgAccuracy ? `${K.num(t.avgAccuracy, 1)}%` : '—', 'Average across all practice'),
      stat('Lessons done', `${t.lessonsDone || 0}`, `${t.stars || 0} stars earned`),
      stat('Time practised', `${K.num((t.minutes || 0) / 60, 1)} h`, state.rank && state.rank.name ? `Rank: ${state.rank.name}` : `${t.runs || 0} runs`));
  }

  function recent(series, tests) {
    const el = $('#dash-recent');
    const items = [];
    series.filter((d) => d.minutes || d.runs).slice(-6).forEach((d) => items.push({ at: d.date, text: `Practised ${d.minutes || 0} min`, sub: [d.runs ? `${d.runs} runs` : null, d.wpm != null ? `best ${K.num(d.wpm)} WPM` : null].filter(Boolean).join(' · ') }));
    tests.slice(0, 6).forEach((t) => items.push({ at: t.at || t.day, text: `${K.duration(t.duration)} typing test`, sub: `${K.num(t.wpm)} WPM · ${K.num(t.accuracy, 1)}%` }));
    items.sort((a, b) => (String(a.at) < String(b.at) ? 1 : -1));
    if (!items.length) return K.empty(el, { icon: 'clock', title: 'No activity yet', text: 'Your lessons, games and tests will show up here.', action: { href: '/app', label: 'Start a lesson' } });
    K.mount(el, h('ul', { class: 'tck-list', style: 'list-style:none;padding:0;margin:0;display:grid;gap:.6rem' }, items.slice(0, 6).map((i) =>
      h('li', { style: 'display:flex;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--line);padding-bottom:.5rem' },
        h('span', null, h('span', { text: i.text }), h('br'), h('span', { class: 'muted', text: i.sub })),
        h('span', { class: 'muted mono', text: K.shortDay(i.at) })))));
  }

  async function load() {
    const day = K.today();
    const [me, stateRes, anRes, testsRes] = await Promise.all([
      K.me(), K.api('GET', `/api/user/state?today=${day}`), K.api('GET', '/api/me/analytics?days=30'), K.api('GET', '/api/me/tests?limit=6'),
    ]);
    if (me && me.user) {
      $('#dash-greeting').textContent = greeting(me.user.fullName);
      if (!me.user.emailVerified) K.mount($('#dash-alert'), K.alert('info', 'Please confirm your email so we can send receipts and password resets.', ' ', h('a', { href: '/account/profile', text: 'Confirm email' })));
    }
    planCard(me && me.entitlements);
    let series = anRes.ok ? K.dailySeries(anRes.data) : [];
    if (!series.length) {
      const hist = await K.api('GET', `/api/user/history?from=${K.addDays(day, -29)}&to=${day}`);
      if (hist.ok) series = K.dailySeries(hist.data);
    }
    const tests = testsRes.ok ? K.tests(testsRes.data) : [];
    if (!stateRes.ok) {
      K.error($('#dash-today'), stateRes, load);
      K.mount($('#dash-stats'));
    } else {
      today(stateRes.data);
      stats(stateRes.data, series);
    }
    K.line($('#dash-trend'), series.map((d) => ({ label: d.date, value: d.wpm })), { label: 'Speed in words per minute, last 30 days', format: (v) => K.num(v) });
    recent(series, tests);
  }
  load();
})();
