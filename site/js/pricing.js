/* Pricing: plan cards and the comparison table from GET /api/packages. The server also
   puts the same data in #tc-data, so the page draws at once and still works if the API
   is briefly unreachable. Prices always come from the data, never from this file. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const grid = $('plans'), table = $('compare'), notice = $('planNotice');
  let me = null;

  const embedded = () => { const el = $('tc-data'); if (!el) return null; try { return JSON.parse(el.textContent); } catch (e) { return null; } };
  const keys = (p) => (p.features || []).map((f) => f.key);
  const testsLine = (l) => l && l.dailyTests != null ? l.dailyTests + ' typing tests a day' : 'Unlimited typing tests';
  const historyLine = (l) => l && l.historyDays != null ? l.historyDays + ' days of test history' : 'Full history, kept as long as your account';
  const HIDDEN = ['tests.basic', 'lessons']; // shown as the tests limit, and the lessons line, instead
  const lessonsOf = (p) => p.lessons || { Text: '', short: '', count: 0, all: false };

  function validity(p) {
    if (!p.pricePaise) return { per: 'free, forever', line: 'No card needed' };
    if (p.validityDays) return { per: 'one payment', line: p.validityDays + ' days of access · no auto-renewal' };
    return { per: 'one payment', line: 'Never expires · no renewals' };
  }

  function card(p, prev) {
    const v = validity(p);
    const mine = me && me.entitlements && me.entitlements.plan === p.id && p.pricePaise > 0;
    const own = keys(p).filter((k) => HIDDEN.indexOf(k) === -1);
    const prevKeys = prev ? keys(prev) : [];
    const fresh = prev && prev.pricePaise ? own.filter((k) => prevKeys.indexOf(k) === -1) : own;
    const label = Object.fromEntries((p.features || []).map((f) => [f.key, f.label]));
    let items = '';
    if (prev && prev.pricePaise) items += '<li>' + TC.icon('check') + '<span>Everything in ' + TC.esc(prev.name) + ', plus:</span></li>';
    // which lessons: always on a first card, and on the others when they differ from the card before
    const L = lessonsOf(p);
    if (L.Text && (!prev || !prev.pricePaise || lessonsOf(prev).Text !== L.Text)) items += '<li>' + TC.icon('check') + '<span>' + TC.esc(L.Text) + '</span></li>';
    items += fresh.map((k) => '<li>' + TC.icon('check') + '<span>' + TC.esc(label[k] || k) + '</span></li>').join('');
    const lim = p.limits || {};
    const prevLim = (prev && prev.limits) || {};
    if (!prev || !prev.pricePaise || lim.dailyTests !== prevLim.dailyTests) items += '<li' + (lim.dailyTests != null ? ' class="limit"' : '') + '>' + TC.icon(lim.dailyTests != null ? 'clock' : 'check') + '<span>' + TC.esc(testsLine(lim)) + '</span></li>';
    if (!prev || !prev.pricePaise || lim.historyDays !== prevLim.historyDays) items += '<li' + (lim.historyDays != null ? ' class="limit"' : '') + '>' + TC.icon(lim.historyDays != null ? 'history' : 'check') + '<span>' + TC.esc(historyLine(lim)) + '</span></li>';
    if (!p.pricePaise) {
      const total = 78, rest = L.all ? 0 : total - (L.count || 0), games = keys(p).indexOf('arcade.all') === -1;
      const parts = [rest && !L.all ? 'the other ' + rest + ' lesson' + (rest === 1 ? '' : 's') : null, games ? '7 arcade games' : null].filter(Boolean);
      if (parts.length) items += '<li class="limit">' + TC.icon('lock') + '<span>' + TC.esc(parts.join(' and ').replace(/^t/, 'T')) + ' need a plan</span></li>';
    }

    let href, text, cls = p.highlight ? 'btn btn-brass btn-block' : 'btn btn-ghost btn-block';
    if (!p.pricePaise) {
      href = me ? '/app' : '/signup'; text = me ? 'Open the trainer' : 'Start free';
      cls = 'btn btn-ghost btn-block';
    } else {
      const checkout = '/checkout?plan=' + encodeURIComponent(p.id);
      href = me ? checkout : '/signup?next=' + encodeURIComponent(checkout);
      text = mine ? 'Extend ' + p.name : 'Buy ' + p.name;
      if (p.highlight) cls = 'btn btn-primary btn-block';
    }
    return '<article class="plan-card' + (p.highlight ? ' recommended' : '') + '" id="plan-' + TC.esc(p.id) + '" aria-labelledby="pn-' + TC.esc(p.id) + '">' +
      (p.highlight ? '<span class="ribbon">Recommended</span>' : '') +
      '<div class="row-between"><h3 id="pn-' + TC.esc(p.id) + '">' + TC.esc(p.name) + '</h3>' + (mine ? '<span class="badge badge-ok">Your plan</span>' : '') + '</div>' +
      (p.sale ? '<div class="sale-tag">' + TC.icon('sparkle') + '<span>' + TC.esc(p.sale.name) + ': ' + TC.esc(p.sale.off) + '</span></div>' : '') +
      '<div class="price">' + (p.sale ? '<s class="was"><span class="sr-only">Was </span>' + TC.esc(TC.money(p.listPricePaise, p.currency)) + '</s>' : '') +
        '<b>' + (p.sale ? '<span class="sr-only">now </span>' : '') + TC.esc(TC.money(p.pricePaise, p.currency)) + '</b><span>' + TC.esc(v.per) + '</span></div>' +
      '<span class="validity">' + TC.esc(v.line) + '</span>' +
      '<p class="plan-desc">' + TC.esc(p.description) + '</p>' +
      '<ul>' + items + '</ul>' +
      '<a class="' + cls + '" href="' + TC.esc(href) + '">' + TC.esc(text) + '</a>' +
      '</article>';
  }

  function cell(on) { return on ? '<td><span class="yes">' + TC.icon('check') + '</span><span class="sr-only">Included</span></td>' : '<td><span class="no">' + TC.icon('minus') + '</span><span class="sr-only">Not included</span></td>'; }
  function compare(data) {
    const list = data.packages;
    const head = '<thead><tr><th scope="col">Feature</th>' + list.map((p) => '<th scope="col"' + (p.highlight ? ' class="rec"' : '') + '>' + TC.esc(p.name) + '</th>').join('') + '</tr></thead>';
    const txt = (s) => '<td>' + TC.esc(s) + '</td>';
    let rows = '<tr><th scope="row">Price</th>' + list.map((p) => '<td class="mono">' + (p.sale ? '<s class="was">' + TC.esc(TC.money(p.listPricePaise, p.currency)) + '</s> ' : '') + TC.esc(TC.money(p.pricePaise, p.currency)) + '</td>').join('') + '</tr>';
    rows += '<tr><th scope="row">Access</th>' + list.map((p) => txt(!p.pricePaise ? 'Forever' : p.validityDays ? p.validityDays + ' days' : 'Lifetime')).join('') + '</tr>';
    rows += '<tr><th scope="row">Lessons</th>' + list.map((p) => txt(lessonsOf(p).short || '')).join('') + '</tr>';
    rows += '<tr><th scope="row">Typing tests</th>' + list.map((p) => txt(p.limits && p.limits.dailyTests != null ? p.limits.dailyTests + ' a day' : 'Unlimited')).join('') + '</tr>';
    rows += '<tr><th scope="row">Test history</th>' + list.map((p) => txt(p.limits && p.limits.historyDays != null ? p.limits.historyDays + ' days' : 'Full')).join('') + '</tr>';
    const feats = (data.features || []).filter((f) => HIDDEN.indexOf(f.key) === -1);
    rows += feats.map((f) => '<tr><th scope="row">' + TC.esc(f.label) + (f.description ? '<div class="muted" style="font-weight:400;font-size:13px">' + TC.esc(f.description) + '</div>' : '') + '</th>' +
      list.map((p) => cell(keys(p).indexOf(f.key) !== -1)).join('') + '</tr>').join('');
    table.innerHTML = '<caption class="sr-only">Features included in each plan</caption>' + head + '<tbody>' + rows + '</tbody>';
    table.style.minWidth = (220 + list.length * 110) + 'px';
  }

  /** A line above the plans while a sale is on: its name, and when it ends. */
  function saleNote(list) {
    const slot = $('saleNote');
    if (!slot) return;
    const sales = [];
    list.forEach((p) => { if (p.sale && !sales.some((x) => x.id === p.sale.id)) sales.push(p.sale); });
    slot.innerHTML = sales.map((x) => '<div class="sale-note">' + TC.icon('sparkle') + '<div><b>' + TC.esc(x.name) + '</b> is on: ' + TC.esc(x.off) +
      (list.filter((p) => p.sale && p.sale.id === x.id).length < list.filter((p) => p.pricePaise > 0).length ? ' on some plans' : '') +
      ', until ' + TC.esc(TC.dateTime ? TC.dateTime(x.endsAt) : TC.date(x.endsAt)) + '. The price you see is the price you pay.</div></div>').join('');
  }
  function draw(data) {
    if (!data || !data.packages || !data.packages.length) return false;
    const list = data.packages;
    saleNote(list);
    grid.innerHTML = list.map((p, i) => card(p, i > 0 ? list[i - 1] : null)).join('');
    grid.removeAttribute('aria-busy');
    compare(data);
    if (location.hash.indexOf('#plan-') === 0) { const t = document.getElementById(location.hash.slice(1)); if (t) t.scrollIntoView({ block: 'center' }); }
    return true;
  }
  function failed() {
    grid.removeAttribute('aria-busy');
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' + TC.icon('alert') + '<h3>Plans couldn\'t load</h3><p>Check your connection and try again. If it keeps happening, write to us at hello@typecrafttyping.com.</p><button type="button" class="btn btn-ghost" id="planRetry">' + TC.icon('refresh') + ' Try again</button></div>';
    table.innerHTML = '<tbody><tr><td class="muted">The comparison appears once plans load.</td></tr></tbody>';
    $('planRetry').addEventListener('click', load);
  }
  async function load() {
    const r = await TC.api('GET', '/api/packages');
    if (r.ok && draw(r.data)) return;
    if (!draw(embedded())) failed();
  }

  TC.me().then((m) => {
    me = m;
    const ent = m && m.entitlements;
    if (ent && ent.plan && ent.plan !== 'free') {
      notice.innerHTML = '<div class="alert alert-ok" style="margin-bottom:20px">' + TC.icon('check') + '<div>You\'re on <b>' + TC.esc(ent.planName || ent.plan) + '</b>' +
        (ent.expiresAt ? ' until ' + TC.esc(TC.date(ent.expiresAt)) + '. Buying again adds the new period after that date.' : ', which never expires.') + '</div></div>';
    }
    draw(embedded());
    load();
  });
})();
