/* /account/analytics. Data: GET /api/me/analytics?days=N → {basic:{from, to, days, daily:[{date, minutes, runs, bestWpm, avgAccuracy, xp}],
   tests:[{date, count, avgWpm, bestWpm, avgAccuracy}]}, advanced:{keyHeatmap:[{key, attempts, errors, accuracy}], slowPairs:[{pair, count, avgMs}],
   errorClasses:{adjacent, transposition, omission, other}} | null, insights:{weakKeys, slowPairs, mainErrorType, plan:[string]} | null,
   locked:[feature keys], upgradeUrl}. Free gets basic for the last limits.historyDays (7) days only; advanced and insights are null when locked. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const ROWS = ['1234567890-=', 'qwertyuiop[]', "asdfghjkl;'", 'zxcvbnm,./'];
  const CLASS_LABEL = { adjacent: 'Neighbouring key', transposition: 'Swapped letters', omission: 'Missed letter', other: 'Other' };

  function locked(el, { title, text, feature }) {
    return K.mount(el, h('div', { class: 'card empty' },
      K.icon('lock'),
      h('h3', { text: title }),
      h('p', { class: 'muted', text }),
      h('a', { class: 'btn btn-primary btn-sm', href: `/pricing#${encodeURIComponent(feature)}`, text: 'See plans that include it' })));
  }
  function summary(series, tests) {
    const w = series.filter((d) => d.wpm != null), a = series.filter((d) => d.accuracy != null);
    const avg = (arr, k) => (arr.length ? arr.reduce((s, d) => s + Number(d[k]), 0) / arr.length : null);
    const half = Math.floor(w.length / 2);
    const change = w.length >= 4 ? avg(w.slice(half), 'wpm') - avg(w.slice(0, half), 'wpm') : null;
    const stat = (label, value, sub) => h('div', { class: 'stat card' }, h('p', { class: 'stat-label', text: label }), h('p', { class: 'stat-value mono', text: value }), sub ? h('p', { class: 'stat-sub muted', text: sub }) : null);
    K.mount($('#an-stats'),
      stat('Average speed', avg(w, 'wpm') != null ? `${K.num(avg(w, 'wpm'))} WPM` : '—', change != null ? `${change >= 0 ? '+' : ''}${K.num(change, 1)} WPM vs first half` : 'Needs a few days of practice'),
      stat('Average accuracy', avg(a, 'accuracy') != null ? `${K.num(avg(a, 'accuracy'), 1)}%` : '—', 'Across practice days'),
      stat('Days practised', `${series.filter((d) => d.minutes || d.runs).length}`, `${series.reduce((s, d) => s + (d.minutes || 0), 0)} minutes`),
      stat('Typing tests', `${tests.reduce((n, t) => n + t.count, 0)}`, tests.length ? `best ${K.num(Math.max(...tests.map((t) => t.bestWpm)))} WPM` : 'None yet'));
  }

  function heatmap(keys) {
    const get = (k) => keys[k] || keys[k.toUpperCase()] || null;
    const wrap = h('div', { class: 'kb-heat', role: 'img', 'aria-label': 'Keyboard coloured by error rate per key' });
    const rows = [];
    ROWS.forEach((row) => {
      wrap.appendChild(h('div', { class: 'kb-row' }, [...row].map((ch) => {
        const s = get(ch);
        const att = s ? Number(s.attempts) || 0 : 0;
        const rate = att >= 10 ? (Number(s.errors) || 0) / att : null;
        if (rate != null) rows.push({ label: ch, value: Math.round(rate * 1000) / 10 });
        const pct = rate == null ? 0 : Math.min(85, Math.round(rate * 600));
        return h('div', { class: 'kb-key', title: rate == null ? `${ch}: not enough data` : `${ch}: ${K.num(rate * 100, 1)}% errors in ${att} presses`,
          style: rate == null ? 'opacity:.45' : `background:color-mix(in srgb, var(--red) ${pct}%, transparent)` },
        h('span', { text: ch }), h('small', { text: rate == null ? '·' : `${K.num(rate * 100, 0)}%` }));
      })));
    });
    const legend = h('div', { class: 'kb-legend' }, 'Fewer errors',
      [0, 15, 35, 60, 85].map((p) => h('span', { style: `background:color-mix(in srgb, var(--red) ${p}%, transparent)` })), 'More errors',
      h('span', { style: 'opacity:.45;margin-left:1rem' }), 'Under 10 presses');
    const worst = rows.sort((a, b) => b.value - a.value).slice(0, 5);
    return [wrap, legend,
      worst.length ? h('p', { class: 'muted' }, 'Most mistakes: ', worst.map((r, i) => [i ? ', ' : '', h('span', { class: 'kbd', text: r.label }), ` ${K.num(r.value, 1)}%`])) : null];
  }

  function advanced(data) {
    const el = $('#an-adv');
    if (data.locked.includes('analytics.advanced')) {
      return locked(el, { feature: 'analytics.advanced', title: 'Advanced analytics is part of Pro, Premium and Lifetime',
        text: 'See every key coloured by how often you miss it, your slowest letter pairs and what kind of mistakes you make. Your statistics are being collected now, so they are ready the moment you upgrade.' });
    }
    const adv = data && data.advanced;
    if (!adv) return K.error(el, 'Advanced analytics could not be loaded.', load);
    const keys = Object.fromEntries(adv.keyHeatmap.map((k) => [k.key, k]));
    const classes = adv.errorClasses;
    const anyKeys = Object.values(keys).some((s) => (s.attempts || 0) >= 10);
    const slow = adv.slowPairs.slice(0, 10);
    const cls = Object.entries(classes || {}).map(([k, n]) => ({ label: CLASS_LABEL[k] || k, value: Number(n) || 0 })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    const heatCard = h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Key heatmap' })));
    if (anyKeys) K.append(heatCard, heatmap(keys));
    else K.append(heatCard, h('p', { class: 'muted', text: 'Type a few lessons and each key will show its error rate here.' }));
    const pairCard = h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Slowest letter pairs' })), h('div'));
    const classCard = h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Kinds of mistakes' })), h('div'));
    K.mount(el, heatCard, h('div', { class: 'grid grid-2 section' }, pairCard, classCard));
    K.bars(pairCard.lastChild, slow.map((p) => ({ label: K.pair(p.pair), value: Math.round(p.avgMs) })), { label: 'Average milliseconds between the two keys', format: (v) => `${K.num(v)} ms`, emptyTitle: 'Not enough pairs yet', emptyText: 'Each pair needs 3 or more presses.' });
    K.bars(classCard.lastChild, cls, { label: 'Mistakes by kind', emptyTitle: 'No mistakes recorded yet' });
  }

  function insights(data) {
    const el = $('#an-ins');
    if (data.locked.includes('insights')) {
      return locked(el, { feature: 'insights', title: 'Personal insights come with Premium and Lifetime',
        text: 'A short weekly plan built from your mistakes and speed: which keys to drill, which lessons to repeat and how long to practise.' });
    }
    const ins = data && data.insights;
    if (!ins) return K.error(el, 'Insights could not be loaded.', load);
    const cards = [];
    if (ins.weakKeys.length) cards.push(h('article', { class: 'card' }, h('h3', { text: 'Keys to drill' }),
      h('p', null, ins.weakKeys.map((k, i) => [i ? ' ' : '', h('span', { class: 'kbd', text: k.key }), h('span', { class: 'muted', text: ` ${K.num(k.accuracy, 1)}%` })]))));
    if (ins.slowPairs.length) cards.push(h('article', { class: 'card' }, h('h3', { text: 'Pairs to smooth out' }),
      h('p', null, ins.slowPairs.map((p, i) => [i ? ', ' : '', h('span', { class: 'kbd', text: K.pair(p.pair) }), h('span', { class: 'muted', text: ` ${K.num(p.avgMs)} ms` })]))));
    K.mount(el,
      h('article', { class: 'card' }, h('h3', { text: 'Your plan for this week' }), h('ul', null, ins.plan.map((t) => h('li', { text: t })))),
      cards.length ? h('div', { class: 'grid grid-2 section' }, cards) : null);
  }

  async function load() {
    const days = Number($('#an-range').value);
    K.mount($('#an-alert'));
    ['#an-wpm', '#an-acc', '#an-min', '#an-tests'].forEach((sel) => K.mount($(sel), h('div', { class: 'skeleton', style: 'height:180px' })));
    const an = await K.api('GET', `/api/me/analytics?days=${days}&today=${K.today()}`);
    if (!an.ok) {
      K.mount($('#an-alert'), K.alert('bad', K.errMsg(an, 'We could not load your analytics.')));
      ['#an-stats', '#an-wpm', '#an-acc', '#an-min', '#an-tests', '#an-adv', '#an-ins'].forEach((sel) => K.mount($(sel)));
      return;
    }
    const b = an.data.basic;
    if (an.data.locked.includes('analytics.basic')) {
      K.mount($('#an-alert'), K.alert('info', `The Free plan shows your last ${b.days} days. Starter and above show up to a year of trends.`, ' ',
        h('a', { href: '/pricing', class: 'btn btn-primary btn-sm', text: 'See plans' })));
    }
    const series = K.dailySeries(b.daily);
    const tests = b.tests;
    summary(series, tests);
    K.line($('#an-wpm'), series.map((d) => ({ label: d.date, value: d.wpm })), { label: 'Best words per minute by day', format: (v) => K.num(v) });
    K.line($('#an-acc'), series.map((d) => ({ label: d.date, value: d.accuracy })), { label: 'Accuracy by day', format: (v) => `${K.num(v)}%`, max: 100 });
    K.columns($('#an-min'), series.map((d) => ({ label: d.date, value: d.minutes || 0 })), { label: 'Minutes practised by day', format: (v) => K.num(v) });
    K.line($('#an-tests'), tests.map((t) => ({ label: t.date, value: t.avgWpm })), { label: 'Average typing test speed by day', format: (v) => K.num(v), emptyTitle: 'Take tests on two days to see a trend', emptyText: 'Typing tests measure your speed on fresh text.' });
    advanced(an.data);
    insights(an.data);
  }
  $('#an-range').addEventListener('change', load);
  load();
})();
