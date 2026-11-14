/* /account/history. Data: GET /api/user/history?from&to {days:[{date,minutes,runs,steps,bestWpm,avgAccuracy,xp,questsDone}]},
   GET /api/me/tests?limit=200 {tests:[{id,duration,wpm,rawWpm,accuracy,errors,chars,textKind,createdAt}]},
   TC.me().entitlements.limits.historyDays (null = full history). */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const panel = $('#hist-panel'), range = $('#hist-range'), dur = $('#hist-dur');
  let tab = 'days', historyDays = null, cache = {};

  function effectiveDays() {
    const want = range.value === 'all' ? Infinity : Number(range.value);
    return historyDays == null ? want : Math.min(want, historyDays);
  }
  function lockNotice() {
    const el = $('#hist-lock');
    if (historyDays == null) return K.mount(el);
    K.mount(el, K.alert('info', `Your plan shows the last ${historyDays} days of history. Everything older is kept safely and appears when you upgrade.`, ' ',
      h('a', { href: '/pricing', class: 'btn btn-primary btn-sm', text: 'See plans with full history' })));
    K.$$('option', range).forEach((o) => { const n = o.value === 'all' ? Infinity : Number(o.value); o.textContent = o.textContent.replace(/ \(locked\)$/, '') + (n > historyDays ? ' (locked)' : ''); });
  }

  async function showDays() {
    const to = K.today();
    const n = effectiveDays();
    const from = Number.isFinite(n) ? K.addDays(to, -(n - 1)) : K.addDays(to, -3650);
    const key = `d:${from}`;
    K.skeleton(panel, 6);
    const res = cache[key] || (cache[key] = await K.api('GET', `/api/user/history?from=${from}&to=${to}`));
    if (!res.ok) { delete cache[key]; return K.error(panel, res, render); }
    const days = res.data.days.filter((d) => d.runs || d.minutes || d.seconds || d.xp).sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!days.length) return K.empty(panel, { icon: 'clock', title: 'No practice in this period', text: 'Lessons and games you play are counted here by day.', action: { href: '/app', label: 'Practise now' } });
    const total = days.reduce((s, d) => s + (d.minutes || 0), 0);
    K.mount(panel,
      h('p', { class: 'muted', text: `${days.length} day${days.length === 1 ? '' : 's'} practised · ${total} minutes in all` }),
      K.table([
        { label: 'Date', value: (d) => K.date(d.date + 'T00:00:00Z') },
        { label: 'Minutes', num: true, value: (d) => K.num(d.minutes) },
        { label: 'Runs', num: true, value: (d) => K.num(d.runs) },
        { label: 'Best WPM', num: true, value: (d) => (d.bestWpm ? K.num(d.bestWpm) : '—') },
        { label: 'Accuracy', num: true, value: (d) => (d.avgAccuracy != null ? `${K.num(d.avgAccuracy, 1)}%` : '—') },
        { label: 'XP', num: true, value: (d) => K.num(d.xp) },
      ], days, { caption: 'Practice by day' }));
  }

  async function showTests() {
    K.skeleton(panel, 6);
    const res = cache.tests || (cache.tests = await K.api('GET', '/api/me/tests?limit=200'));
    if (!res.ok) { delete cache.tests; return K.error(panel, res, render); }
    const n = effectiveDays();
    const since = Number.isFinite(n) ? K.addDays(K.today(), -(n - 1)) : '';
    let tests = K.tests(res.data).filter((t) => !since || String(t.day) >= since);
    if (dur.value) tests = tests.filter((t) => String(t.duration) === dur.value);
    if (!tests.length) return K.empty(panel, { icon: 'clock', title: 'No typing tests in this period', text: 'Take a timed test to measure your speed.', action: { href: '/typing-test', label: 'Take a typing test' } });
    const best = Math.max(...tests.map((t) => +t.wpm || 0));
    K.mount(panel,
      h('p', { class: 'muted', text: `${tests.length} test${tests.length === 1 ? '' : 's'} · best ${K.num(best)} WPM` }),
      K.table([
        { label: 'When', value: (t) => K.dateTime(t.createdAt) },
        { label: 'Length', value: (t) => K.duration(t.duration) },
        { label: 'Text', value: (t) => t.textKind },
        { label: 'WPM', num: true, value: (t) => K.num(t.wpm) },
        { label: 'Raw', num: true, value: (t) => K.num(t.rawWpm) },
        { label: 'Accuracy', num: true, value: (t) => `${K.num(t.accuracy, 1)}%` },
        { label: 'Errors', num: true, value: (t) => K.num(t.errors) },
      ], tests, { caption: 'Typing tests' }));
  }

  function render() { return tab === 'days' ? showDays() : showTests(); }

  K.$$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    K.$$('.tabs [role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    panel.setAttribute('aria-labelledby', b.id);
    $('#hist-dur-wrap').hidden = tab !== 'tests';
    render();
  }));
  range.addEventListener('change', render);
  dur.addEventListener('change', render);

  K.me().then((me) => {
    const lim = me && me.entitlements && me.entitlements.limits;
    historyDays = lim && lim.historyDays != null ? Number(lim.historyDays) : null;
    if (historyDays != null && Number(range.value) > historyDays) range.value = historyDays <= 7 ? '7' : '30';
    lockNotice();
    render();
  });
})();
