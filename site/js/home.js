/* Home page: old email links, the mini typing demo in the hero, and the plans teaser. */
(function () {
  'use strict';
  // links from older emails: /#reset=… and /#verify=… now have their own pages
  const old = location.hash.match(/^#(reset|verify)=([\w-]{20,200})$/);
  if (old) { location.replace((old[1] === 'reset' ? '/reset-password' : '/verify-email') + '#token=' + old[2]); return; }

  const $ = (id) => document.getElementById(id);

  /* ---------- the mini typewriter ---------- */
  const LINES = [
    'dad has a glass flask; a lad asks',
    'all lads had salads as dad asks',
    'a sad flask falls; dad shall ask',
    'ask a lass; a lad had a salad',
  ];
  const textEl = $('demoText'), input = $('demoInput'), sheet = $('demoSheet');
  if (textEl && input) {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let line = 0, pos = 0, mode = 'auto', timer = null, started = 0, keys = 0, good = 0, wrongAt = -1;
    const keyEls = {};
    document.querySelectorAll('.demo-keys i').forEach((k) => { keyEls[k.dataset.k] = k; });
    const text = () => LINES[line % LINES.length];
    function render() {
      const t = text();
      textEl.innerHTML = '<span class="ok">' + TC.esc(t.slice(0, pos)) + '</span>' +
        (pos < t.length ? '<span class="' + (wrongAt === pos ? 'cur bad' : 'cur') + '">' + TC.esc(t[pos] === ' ' ? ' ' : t[pos]) + '</span><span class="rest">' + TC.esc(t.slice(pos + 1)) + '</span>' : '');
    }
    function gauges() {
      const mins = started ? (Date.now() - started) / 60000 : 0;
      $('demoWpm').textContent = mins > 0.02 ? Math.round(good / 5 / mins) : 0;
      $('demoAcc').textContent = (keys ? Math.round((100 * good) / keys) : 100) + '%';
      $('demoKeys').textContent = keys;
    }
    function flash(ch) { const k = keyEls[ch]; if (!k) return; k.classList.add('on'); setTimeout(() => k.classList.remove('on'), 110); }
    function resetLine(next) { if (next) line++; pos = 0; wrongAt = -1; started = 0; keys = 0; good = 0; render(); gauges(); }
    function autoStep() {
      const t = text();
      if (pos >= t.length) { timer = setTimeout(() => { resetLine(true); autoStep(); }, 1500); return; }
      if (!started) started = Date.now() - 400;
      flash(t[pos]); pos++; keys++; good++; render(); gauges();
      timer = setTimeout(autoStep, t[pos - 1] === ' ' ? 190 : 120 + Math.random() * 90);
    }
    function startTry() {
      if (mode !== 'try') { mode = 'try'; clearTimeout(timer); resetLine(true); }
      $('demoLabel').textContent = 'Your turn: type the line';
      $('demoStatus').textContent = 'Fingers on A S D F and J K L ;';
      $('demoTry').textContent = 'Start over';
      input.focus({ preventScroll: true });
    }
    input.addEventListener('input', () => {
      const v = input.value; input.value = '';
      if (mode !== 'try') startTry();
      for (const ch of v) {
        const t = text(); if (pos >= t.length) break;
        if (!started) started = Date.now();
        keys++; flash(ch.toLowerCase());
        if (ch === t[pos]) { good++; pos++; wrongAt = -1; } else wrongAt = pos;
        render(); gauges();
        if (pos >= t.length) {
          const mins = (Date.now() - started) / 60000;
          const wpm = Math.round(good / 5 / Math.max(mins, 0.01)), acc = Math.round((100 * good) / keys);
          $('demoStatus').innerHTML = TC.esc(wpm + ' wpm at ' + acc + '% accuracy. ') + '<a href="/typing-test" style="color:inherit">Take the full test</a>';
          setTimeout(() => { if (mode === 'try') { resetLine(true); $('demoLabel').textContent = 'Another line'; } }, 1800);
        }
      }
    });
    $('demoTry').addEventListener('click', () => { if (mode === 'try') resetLine(true); startTry(); });
    sheet.addEventListener('click', startTry);
    input.addEventListener('blur', () => { if (mode === 'try') $('demoLabel').textContent = 'Click the sheet to keep typing'; });
    input.addEventListener('focus', () => { if (mode === 'try') $('demoLabel').textContent = 'Your turn: type the line'; });
    render();
    if (reduce) { $('demoStatus').textContent = 'Click the sheet and type the line.'; $('demoLabel').textContent = 'Try it'; }
    else timer = setTimeout(autoStep, 700);
  }

  /* ---------- plans teaser ---------- */
  const teaser = $('planTeaser');
  if (!teaser) return;
  function embedded() { const el = $('tc-data'); if (!el) return null; try { return JSON.parse(el.textContent); } catch (e) { return null; } }
  function draw(data) {
    const list = (data && data.packages) || [];
    if (!list.length) return false;
    teaser.classList.add('compact');
    teaser.innerHTML = list.map((p) => {
      const free = !p.pricePaise;
      const span = free ? 'free, forever' : (p.validityDays ? p.validityDays + ' days' : 'one payment, no expiry');
      return '<a class="plan-card' + (p.highlight ? ' recommended' : '') + '" href="/pricing#plan-' + TC.esc(p.id) + '" style="text-decoration:none;color:inherit;gap:10px">' +
        (p.highlight ? '<span class="ribbon">Recommended</span>' : '') +
        '<h3>' + TC.esc(p.name) + '</h3>' +
        '<div class="price"><b>' + TC.esc(TC.money(p.pricePaise, p.currency)) + '</b></div>' +
        '<span class="validity">' + TC.esc(span) + '</span>' +
        '<p class="plan-desc" style="min-height:0">' + TC.esc(p.description) + '</p></a>';
    }).join('');
    return true;
  }
  const first = draw(embedded());
  TC.api('GET', '/api/packages').then((r) => {
    if (r.ok && draw(r.data)) return;
    if (!first) teaser.innerHTML = '<div class="empty empty-sm" style="grid-column:1/-1">' + TC.icon('package') + '<p>Plans are listed on the <a href="/pricing">pricing page</a>.</p></div>';
  });
})();
