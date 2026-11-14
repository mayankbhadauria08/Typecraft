/* /account/analytics. Data: GET /api/me/analytics?days=N → { daily:[{date,wpm,accuracy,minutes}],
   keyHeatmap?:{key:{attempts,errors}} | [{key,attempts,errors}], slowPairs?:[{pair,avgMs,count}], errorClasses?:{adjacent,…},
   insights?:[{title,text}|string] } (advanced fields only with analytics.advanced, insights only with insights);
   fallbacks: GET /api/user/history (daily), GET /api/user/state stats (keyStats, bigramLatency, errorClasses); GET /api/me/tests. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const ROWS = ['1234567890-=', 'qwertyuiop[]', "asdfghjkl;'", 'zxcvbnm,./'];
  const CLASS_LABEL = { adjacent: 'Neighbouring key', transposition: 'Swapped letters', omission: 'Missed letter', other: 'Other' };
  let ent = null, stateCache = null;

  function locked(el, { title, text, feature }) {
    return K.mount(el, h('div', { class: 'card empty' },
      K.icon('lock'),
      h('h3', { text: title }),
      h('p', { class: 'muted', text }),
      h('a', { class: 'btn btn-primary btn-sm', href: `/pricing#${encodeURIComponent(feature)}`, text: 'See plans that include it' })));
  }
  async function state() {
    if (!stateCache) stateCache = await K.api('GET', `/api/user/state?today=${K.today()}`);
    return stateCache.ok ? stateCache.data : null;
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
      stat('Typing tests', `${tests.length}`, tests.length ? `best ${K.num(Math.max(...tests.map((t) => +t.wpm || 0)))} WPM` : 'None yet'));
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

  function normKeys(v) {
    if (!v) return null;
    if (Array.isArray(v)) return Object.fromEntries(v.map((r) => [r.key || r.k, { attempts: r.attempts, errors: r.errors }]));
    return v;
  }
  function normPairs(v) {
    if (!v) return null;
    if (Array.isArray(v)) return v.map((p) => ({ pair: p.pair, avgMs: K.pick(p, 'avgMs', 'avg_ms', 'ms'), count: p.count }));
    return Object.entries(v).filter(([, p]) => p.count >= 5).map(([pair, p]) => ({ pair, avgMs: p.totalMs / p.count, count: p.count }));
  }

  async function advanced(data) {
    const el = $('#an-adv');
    if (!K.has(ent, 'analytics.advanced')) {
      return locked(el, { feature: 'analytics.advanced', title: 'Advanced analytics is part of Pro, Premium and Lifetime',
        text: 'See every key coloured by how often you miss it, your slowest letter pairs and what kind of mistakes you make. Your statistics are being collected now, so they are ready the moment you upgrade.' });
    }
    const src = (data && (data.advanced || data)) || {};
    let keys = normKeys(K.pick(src, 'keyHeatmap', 'keys', 'keyStats'));
    let pairs = normPairs(K.pick(src, 'slowPairs', 'bigrams', 'bigramLatency'));
    let classes = K.pick(src, 'errorClasses', 'error_classes');
    if (!keys || !pairs || !classes) {
      const st = await state();
      const s = (st && st.stats) || {};
      keys = keys || s.keyStats || {};
      pairs = pairs || normPairs(s.bigramLatency || {});
      classes = classes || s.errorClasses || {};
    }
    const anyKeys = Object.values(keys).some((s) => (s.attempts || 0) >= 10);
    const slow = (pairs || []).filter((p) => p.avgMs != null).sort((a, b) => b.avgMs - a.avgMs).slice(0, 10);
    const cls = Object.entries(classes || {}).map(([k, n]) => ({ label: CLASS_LABEL[k] || k, value: Number(n) || 0 })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    const heatCard = h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Key heatmap' })));
    if (anyKeys) K.append(heatCard, heatmap(keys));
    else K.append(heatCard, h('p', { class: 'muted', text: 'Type a few lessons and each key will show its error rate here.' }));
    const pairCard = h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Slowest letter pairs' })), h('div'));
    const classCard = h('article', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', { text: 'Kinds of mistakes' })), h('div'));
    K.mount(el, heatCard, h('div', { class: 'grid grid-2 section' }, pairCard, classCard));
    K.bars(pairCard.lastChild, slow.map((p) => ({ label: p.pair.replace(/ /g, '␣'), value: Math.round(p.avgMs) })), { label: 'Average milliseconds between the two keys', format: (v) => `${K.num(v)} ms`, emptyTitle: 'Not enough pairs yet', emptyText: 'Each pair needs 5 or more presses.' });
    K.bars(classCard.lastChild, cls, { label: 'Mistakes by kind', emptyTitle: 'No mistakes recorded yet' });
  }

  function insights(data) {
    const el = $('#an-ins');
    if (!K.has(ent, 'insights')) {
      return locked(el, { feature: 'insights', title: 'Personal insights come with Premium and Lifetime',
        text: 'A short weekly plan built from your mistakes and speed: which keys to drill, which lessons to repeat and how long to practise.' });
    }
    const list = K.list(data && data.insights, 'items').map((i) => (typeof i === 'string' ? { text: i } : i));
    if (!list.length) return K.empty(el, { icon: 'info', title: 'No insights yet', text: 'Practise on a few more days and your weekly plan appears here.' });
    K.mount(el, h('div', { class: 'grid grid-2' }, list.map((i) => h('article', { class: 'card' },
      i.title ? h('h3', { text: i.title }) : null, h('p', { text: i.text || i.body || '' }),
      i.action && i.action.href && String(i.action.href).startsWith('/') ? h('a', { class: 'btn btn-ghost btn-sm', href: i.action.href, text: i.action.label || 'Open' }) : null))));
  }

  async function load() {
    const days = Number($('#an-range').value);
    const to = K.today();
    ['#an-wpm', '#an-acc', '#an-min', '#an-tests'].forEach((s) => K.mount($(s), h('div', { class: 'skeleton', style: 'height:180px' })));
    const [me, an, testsRes] = await Promise.all([K.me(), K.api('GET', `/api/me/analytics?days=${days}`), K.api('GET', '/api/me/tests?limit=200')]);
    ent = me && me.entitlements;
    let series = an.ok ? K.dailySeries(an.data) : [];
    if (!series.length) {
      const hist = await K.api('GET', `/api/user/history?from=${K.addDays(to, -(days - 1))}&to=${to}`);
      if (hist.ok) series = K.dailySeries(hist.data);
      else if (!an.ok) K.mount($('#an-alert'), K.alert('bad', K.errMsg(an, 'We could not load your analytics.')));
    }
    const since = K.addDays(to, -(days - 1));
    const tests = testsRes.ok ? K.tests(testsRes.data).filter((t) => String(t.day) >= since).reverse() : [];
    summary(series, tests);
    K.line($('#an-wpm'), series.map((d) => ({ label: d.date, value: d.wpm })), { label: 'Words per minute by day', format: (v) => K.num(v) });
    K.line($('#an-acc'), series.map((d) => ({ label: d.date, value: d.accuracy })), { label: 'Accuracy by day', format: (v) => `${K.num(v)}%`, max: 100 });
    K.columns($('#an-min'), series.map((d) => ({ label: d.date, value: d.minutes || 0 })), { label: 'Minutes practised by day', format: (v) => K.num(v) });
    K.line($('#an-tests'), tests.map((t) => ({ label: t.at || t.day, value: t.wpm })), { label: 'Typing test speed', format: (v) => K.num(v), emptyTitle: 'Take two tests to see a trend', emptyText: 'Typing tests measure your speed on fresh text.' });
    await advanced(an.ok ? an.data : null);
    insights(an.ok ? an.data : null);
  }
  $('#an-range').addEventListener('change', load);
  load();
})();
