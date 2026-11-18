/* Small charts for the console, drawn as SVG with no library (AC.charts).
   AC.charts.columns(host, { label, points: [{ key, label, value }], format(value), empty })
     One series of columns on one axis: thin columns (at most 24px), a 4px rounded data end and a square base,
     hairline solid gridlines, clean ticks. Hover or keyboard focus (arrow keys) shows the value of a column;
     "Show the numbers" opens the same values as a table, so a value is never only in a tooltip.
     Columns below zero (a day with more refunds than sales) hang from the same baseline.
   AC.charts.bars(host, { rows: [{ label, value, href }], format(value), empty })
     Ranked horizontal bars, one hue, each row a name, a bar and its figure.
   Colours: --chart (one hue, checked against the surface in both themes), --line for the grid, text tokens for all text.
   Every label is placed as text (textContent), never as HTML. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, svg = AC.svg, doc = document;
  var PLOT_H = 168, AXIS_H = 26, LEFT = 48, TOP = 10;
  var uid = 0;

  /** A clean axis top for a maximum: 1, 2, 2.5, 5 or 10 times a power of ten, split into 4 steps where it can. */
  function niceStep(span) {
    var raw = span / 4, pow = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
  }
  function scale(values) {
    var max = Math.max(0, Math.max.apply(null, values)), min = Math.min(0, Math.min.apply(null, values));
    if (max === 0 && min === 0) max = 1;
    var step = niceStep(max - min);
    var top = Math.ceil(max / step) * step, bottom = Math.floor(min / step) * step;
    if (top === bottom) top = bottom + step;
    var ticks = [];
    for (var t = bottom; t <= top + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
    return { top: top, bottom: bottom, ticks: ticks };
  }
  /** A column as a path: square where it meets the baseline, 4px round where the data ends. */
  function column(x, w, y0, y1) {
    var up = y1 < y0, h = Math.abs(y1 - y0), r = Math.min(4, w / 2, h);
    if (h < 0.5) return '';
    if (up) return 'M' + x + ' ' + y0 + 'V' + (y1 + r) + 'Q' + x + ' ' + y1 + ' ' + (x + r) + ' ' + y1 + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y1 + ' ' + (x + w) + ' ' + (y1 + r) + 'V' + y0 + 'Z';
    return 'M' + x + ' ' + y0 + 'V' + (y1 - r) + 'Q' + x + ' ' + y1 + ' ' + (x + r) + ' ' + y1 + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y1 + ' ' + (x + w) + ' ' + (y1 - r) + 'V' + y0 + 'Z';
  }
  function tableOf(label, points, format) {
    return el('table', { class: 'list compact chart-table' }, [
      el('caption', { class: 'vh', text: label }),
      el('thead', null, el('tr', null, [el('th', { scope: 'col', text: 'Day' }), el('th', { scope: 'col', class: 'num', text: label })])),
      el('tbody', null, points.map(function (p) { return el('tr', null, [el('td', { text: p.long || p.label }), el('td', { class: 'num', text: format(p.value) })]); }))
    ]);
  }

  function columns(host, cfg) {
    var points = cfg.points, format = cfg.format || function (v) { return String(v); };
    var id = 'chart' + (++uid);
    AC.clear(host);
    var figure = el('figure', { class: 'chart-figure' });
    var tip = el('div', { class: 'chart-tip', role: 'status', hidden: true }, [el('strong'), el('span')]);
    var tableWrap = el('div', { class: 'table-panel table-panel-inner chart-table-wrap', hidden: true }, tableOf(cfg.label, points, format));
    var toggle = el('button', { type: 'button', class: 'btn-link chart-toggle', 'aria-expanded': 'false', 'aria-controls': id + '-table', text: 'Show the numbers' });
    tableWrap.id = id + '-table';
    toggle.addEventListener('click', function () {
      var open = tableWrap.hidden;
      tableWrap.hidden = !open; toggle.setAttribute('aria-expanded', open ? 'true' : 'false'); toggle.textContent = open ? 'Hide the numbers' : 'Show the numbers';
    });
    figure.appendChild(tip);
    host.appendChild(figure);
    host.appendChild(el('div', { class: 'chart-foot' }, [cfg.summary ? el('p', { class: 'quiet', text: cfg.summary }) : null, toggle]));
    host.appendChild(tableWrap);

    var focusAt = -1, drawn = null;
    function draw() {
      var width = Math.max(260, figure.clientWidth || host.clientWidth || 600);
      var s = scale(points.map(function (p) { return p.value; }));
      var plotW = width - LEFT - 8, slot = plotW / points.length;
      var w = Math.max(3, Math.min(24, slot - 2, slot * 0.62));
      var y = function (v) { return TOP + (s.top - v) / (s.top - s.bottom) * PLOT_H; };
      var base = y(0);
      var grid = s.ticks.map(function (t) {
        return svg('g', null, [
          svg('line', { x1: LEFT, x2: width - 8, y1: y(t), y2: y(t), class: t === 0 ? 'chart-base' : 'chart-grid' }),
          svg('text', { x: LEFT - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'chart-tick' }, cfg.tick ? cfg.tick(t) : format(t))
        ]);
      });
      // label every day when there is room, else every few days counted back from today, so labels never touch
      var every = Math.max(points.length > 10 ? 5 : 1, Math.ceil(48 / slot)), last = points.length - 1;
      var bars = points.map(function (p, i) {
        var x = LEFT + i * slot + (slot - w) / 2;
        var g = svg('g', { class: 'chart-col', 'data-i': i }, [
          svg('rect', { x: LEFT + i * slot, y: TOP, width: slot, height: PLOT_H, class: 'chart-hit' }),
          svg('path', { d: column(x, w, base, y(p.value)), class: 'chart-mark' })
        ]);
        return g;
      });
      var labels = points.map(function (p, i) {
        return (last - i) % every === 0 ? svg('text', { x: LEFT + i * slot + slot / 2, y: TOP + PLOT_H + 18, 'text-anchor': 'middle', class: 'chart-tick' }, p.label) : null;
      });
      var root = svg('svg', { viewBox: '0 0 ' + width + ' ' + (TOP + PLOT_H + AXIS_H), width: width, height: TOP + PLOT_H + AXIS_H, class: 'chart-svg',
        role: 'img', tabindex: 0, 'aria-label': cfg.label + '. ' + (cfg.summary || '') + ' Use the arrow keys to read each day, or show the numbers as a table.' },
      [svg('g', null, grid), svg('g', null, bars), svg('g', null, labels)]);
      var old = figure.querySelector('svg'); if (old) old.remove();
      figure.insertBefore(root, tip);
      drawn = { root: root, slot: slot, y: y };
      wire(root);
      if (focusAt >= 0) show(focusAt);
    }
    function show(i) {
      if (!drawn || i < 0 || i >= points.length) return;
      focusAt = i;
      Array.prototype.forEach.call(drawn.root.querySelectorAll('.chart-col'), function (g) { g.classList.toggle('is-on', Number(g.getAttribute('data-i')) === i); });
      var p = points[i];
      tip.querySelector('strong').textContent = format(p.value);
      tip.querySelector('span').textContent = p.long || p.label;
      tip.hidden = false;
      var x = LEFT + i * drawn.slot + drawn.slot / 2, box = figure.clientWidth || 600;
      tip.style.left = Math.max(4, Math.min(box - 150, x - 70)) + 'px';
      tip.style.top = Math.max(0, Math.min(drawn.y(Math.max(0, p.value)), TOP + PLOT_H) - 50) + 'px';
    }
    function hide() {
      tip.hidden = true; focusAt = -1;
      if (drawn) Array.prototype.forEach.call(drawn.root.querySelectorAll('.chart-col.is-on'), function (g) { g.classList.remove('is-on'); });
    }
    function wire(root) {
      root.addEventListener('pointermove', function (e) {
        var g = e.target.closest && e.target.closest('.chart-col');
        if (g) show(Number(g.getAttribute('data-i')));
      });
      root.addEventListener('pointerleave', function () { if (doc.activeElement !== root) hide(); });
      root.addEventListener('focus', function () { show(focusAt >= 0 ? focusAt : points.length - 1); });
      root.addEventListener('blur', hide);
      root.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show(Math.max(0, Math.min(points.length - 1, (focusAt < 0 ? points.length - 1 : focusAt) + (e.key === 'ArrowLeft' ? -1 : 1)))); }
        else if (e.key === 'Home') { e.preventDefault(); show(0); }
        else if (e.key === 'End') { e.preventDefault(); show(points.length - 1); }
        else if (e.key === 'Escape') hide();
      });
    }
    draw();
    var timer = null, lastW = figure.clientWidth;
    if (window.ResizeObserver) new ResizeObserver(function () {
      if (figure.clientWidth === lastW) return;
      lastW = figure.clientWidth; clearTimeout(timer); timer = setTimeout(draw, 120);
    }).observe(figure);
    return { redraw: draw };
  }

  function bars(host, cfg) {
    var format = cfg.format || function (v) { return String(v); };
    AC.clear(host);
    if (!cfg.rows.length) { host.appendChild(el('p', { class: 'quiet', text: cfg.empty || 'Nothing to show.' })); return; }
    var max = Math.max.apply(null, cfg.rows.map(function (r) { return r.value; })) || 1;
    host.appendChild(el('ul', { class: 'hbars' }, cfg.rows.map(function (r) {
      var fill = el('span', { class: 'hbar-fill' });
      fill.style.width = (r.value ? Math.max(1.5, 100 * r.value / max) : 0) + '%';
      return el('li', { class: 'hbar' }, [
        r.href ? el('a', { class: 'hbar-name', href: r.href, text: r.label }) : el('span', { class: 'hbar-name', text: r.label }),
        el('span', { class: 'hbar-track', 'aria-hidden': 'true' }, fill),
        el('span', { class: 'hbar-value', text: format(r.value) })
      ]);
    })));
  }

  AC.charts = { columns: columns, bars: bars };
})();
