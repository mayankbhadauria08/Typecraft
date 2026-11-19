/* TypeCraft pages kit: small DOM helpers shared by the account, payment and admin pages.
   Global `TCK`. Builds every element with createElement/textContent, never with HTML strings
   from data. Depends on `TC` from site/site.js (TC.api, TC.me, TC.money, TC.date, TC.esc, TC.icon). */
(function () {
  'use strict';
  const K = {};
  const SVGNS = 'http://www.w3.org/2000/svg';

  /* ---------- elements ---------- */
  /** h('div', {class:'card', text:'…', onclick:fn, dataset:{id:1}}, child, 'text', [more]) */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    setAttrs(el, attrs);
    append(el, kids);
    return el;
  }
  function setAttrs(el, attrs) {
    if (!attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value' && 'value' in el) el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return el;
  }
  K.h = h;
  /** An SVG picture from our own renderers (js/rewards-ui.js escapes every piece of data), parsed as XML
      rather than written as HTML. → an <svg> node, or null */
  K.svg = (markup) => {
    try {
      const el = new DOMParser().parseFromString(String(markup || ''), 'image/svg+xml').documentElement;
      return el && el.nodeName === 'svg' ? document.importNode(el, true) : null;
    } catch (e) { return null; }
  };
  K.append = (el, ...kids) => append(el, kids);
  K.mount = (el, ...kids) => { if (!el) return el; el.replaceChildren(); return append(el, kids); };
  K.$ = (sel, root) => (root || document).querySelector(sel);
  K.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  /** Inline SVG icon from TC.icon (a fixed, trusted set of strings in site/site.js; never data). */
  K.icon = function (name) {
    const span = h('span', { class: 'icon', 'aria-hidden': 'true' });
    const svg = window.TC && typeof TC.icon === 'function' ? TC.icon(name) : '';
    if (svg) {
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const node = doc.documentElement;
      if (node && node.nodeName.toLowerCase() === 'svg') span.appendChild(document.importNode(node, true));
    }
    return span;
  };

  /* ---------- data helpers ---------- */
  K.money = (paise, currency) => {
    const n = Number(paise) || 0;
    if (window.TC && TC.money && (!currency || currency === 'INR')) return TC.money(n);
    const v = n / 100;
    return (currency && currency !== 'INR' ? currency + ' ' : '₹') + (Number.isInteger(v) ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  };
  K.date = (iso) => (iso ? (window.TC && TC.date ? TC.date(iso) : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })) : '—');
  K.dateTime = (iso) => (iso ? (window.TC && TC.dateTime ? TC.dateTime(iso) : new Date(iso).toLocaleString('en-IN')) : '—');
  K.num = (v, d = 0) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
  K.today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  K.addDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  K.daysLeft = (iso) => (iso ? Math.ceil((Date.parse(iso) - Date.now()) / 86400000) : null);
  K.qs = (name) => (window.TC && TC.qs ? TC.qs(name) : new URLSearchParams(location.search).get(name));
  K.has = (ent, key) => !!(ent && Array.isArray(ent.features) && ent.features.includes(key));
  K.errMsg = (res, fallback) => (res && res.error && res.error.message) || fallback || 'Something went wrong. Please try again.';
  K.api = function (method, path, body) {
    if (window.TC && TC.api) return TC.api(method, path, body);
    return Promise.resolve({ ok: false, status: 0, data: null, error: { code: 'no_site_js', message: 'The page did not load completely. Refresh to try again.' } });
  };
  K.me = () => (window.TC && TC.me ? TC.me() : Promise.resolve(null));
  K.toast = (text, kind) => { if (window.TC && TC.toast) TC.toast(text, kind); };
  K.busy = (btn, on) => { if (!btn) return; if (window.TC && TC.busy) TC.busy(btn, on); else { btn.disabled = !!on; btn.setAttribute('aria-busy', on ? 'true' : 'false'); } };
  K.formValues = (form) => (window.TC && TC.formValues ? TC.formValues(form) : Object.fromEntries(new FormData(form)));
  K.formErrors = (form, fields, message) => {
    if (window.TC && TC.formErrors) return TC.formErrors(form, fields, message);
    K.$$('.err', form).forEach((e) => e.remove());
    if (fields) for (const [name, msg] of Object.entries(fields)) { const inp = form.elements[name]; if (inp) inp.after(h('p', { class: 'err', text: msg })); }
    if (message) form.prepend(h('div', { class: 'alert alert-bad', role: 'alert', text: message }));
  };
  /** Shows the server's answer on a form: field errors next to fields, else the message. */
  K.formFail = (form, res) => K.formErrors(form, (res.error && res.error.fields) || null, K.errMsg(res));

  /* ---------- states ---------- */
  K.skeleton = function (el, rows = 3, height = '1.1em') {
    const kids = [];
    for (let i = 0; i < rows; i++) kids.push(h('div', { class: 'skeleton', style: `height:${height};margin:.5rem 0;width:${90 - (i % 3) * 15}%`, 'aria-hidden': 'true' }));
    return K.mount(el, h('div', { 'aria-busy': 'true', 'aria-label': 'Loading' }, kids));
  };
  K.empty = function (el, { icon = 'info', title, text, action } = {}) {
    return K.mount(el, h('div', { class: 'empty' },
      K.icon(icon),
      h('h3', { text: title || 'Nothing here yet' }),
      text ? h('p', { class: 'muted', text }) : null,
      action ? h('a', { class: 'btn btn-primary btn-sm', href: action.href, text: action.label }) : null));
  };
  K.error = function (el, res, retry) {
    const msg = typeof res === 'string' ? res : K.errMsg(res, "We couldn't load this. Check your connection and try again.");
    return K.mount(el, h('div', { class: 'alert alert-bad', role: 'alert' },
      h('span', { text: msg }), ' ',
      retry ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Try again', onclick: retry }) : null));
  };
  K.alert = (kind, text, ...more) => h('div', { class: `alert alert-${kind}`, role: kind === 'bad' ? 'alert' : 'status' }, h('span', { text }), more);

  const BADGE = {
    paid: 'ok', captured: 'ok', active: 'ok', sent: 'ok', delivered: 'ok', processed: 'ok', answered: 'ok', enabled: 'ok',
    pending: 'warn', created: 'muted', attempted: 'warn', queued: 'warn', authorized: 'warn', new: 'brand', partially_refunded: 'warn',
    failed: 'bad', bounced: 'bad', disabled: 'bad', revoked: 'bad', cancelled: 'muted', expired: 'muted', refunded: 'muted', closed: 'muted',
  };
  const LABEL = { created: 'Not paid', attempted: 'Attempted', partially_refunded: 'Part refunded' };
  K.badge = (status, label) => {
    const s = String(status || 'unknown');
    return h('span', { class: `badge badge-${BADGE[s] || 'muted'}`, text: label || LABEL[s] || s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') });
  };

  /* ---------- table ---------- */
  /** columns: [{label, num?, value(row) → string|Node}] */
  K.table = function (columns, rows, { caption, onRow } = {}) {
    const table = h('table', { class: 'table' },
      caption ? h('caption', { class: 'sr-only', text: caption }) : null,
      h('thead', null, h('tr', null, columns.map((c) => h('th', { scope: 'col', class: c.num ? 'num' : null, text: c.label })))),
      h('tbody', null, rows.map((r) => {
        const tr = h('tr', null, columns.map((c) => {
          const v = c.value(r);
          return h('td', { class: c.num ? 'num' : null, 'data-label': c.label }, v == null ? '—' : v);
        }));
        if (onRow) { tr.tabIndex = 0; tr.style.cursor = 'pointer'; tr.addEventListener('click', () => onRow(r)); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') onRow(r); }); }
        return tr;
      })));
    return h('div', { class: 'table-wrap' }, table);
  };

  K.pager = function (el, { page, pages, onPage }) {
    if (!el) return;
    if (window.TC && TC.paginate) return TC.paginate(el, { page, pages, onPage });
    if (!pages || pages <= 1) return K.mount(el);
    K.mount(el, h('nav', { 'aria-label': 'Pages', class: 'field-row' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Previous', disabled: page <= 1, onclick: () => onPage(page - 1) }),
      h('span', { class: 'muted mono', text: `Page ${page} of ${pages}` }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Next', disabled: page >= pages, onclick: () => onPage(page + 1) })));
  };

  /* ---------- in-page confirmation (never window.confirm) ---------- */
  /**
   * K.confirm({title, text, confirmLabel, danger, typeToConfirm, fields:[{name,label,type ('select': options [{value,label}]),value,hint,required,min,max,step,maxlength}]})
   * → Promise<null | {…field values}> (null = cancelled). Uses a <dialog> on the page.
   */
  K.confirm = function ({ title, text, confirmLabel = 'Confirm', danger = false, typeToConfirm = null, fields = [] }) {
    return new Promise((resolve) => {
      const form = h('form', { method: 'dialog', class: 'card', novalidate: true });
      const dlg = h('dialog', { class: 'tck-dialog', 'aria-labelledby': 'tck-dlg-title' }, form);
      const inputs = fields.map((f) => {
        const id = 'tckf-' + f.name;
        const input = f.type === 'textarea'
          ? h('textarea', { id, name: f.name, rows: 3, required: f.required, value: f.value ?? '' })
          : f.type === 'select'
            ? h('select', { id, name: f.name }, (f.options || []).map((o) => h('option', { value: o.value, text: o.label, selected: String(o.value) === String(f.value ?? '') })))
            : h('input', { id, name: f.name, type: f.type || 'text', required: f.required, min: f.min, max: f.max, step: f.step, maxlength: f.maxlength, value: f.value ?? '', autocomplete: f.autocomplete || 'off' });
        return h('div', { class: 'field' }, h('label', { for: id, text: f.label }), input, f.hint ? h('p', { class: 'hint', text: f.hint }) : null);
      });
      let typed = null;
      if (typeToConfirm) {
        typed = h('input', { id: 'tckf-typed', name: '__typed', autocomplete: 'off', spellcheck: 'false' });
        inputs.push(h('div', { class: 'field' }, h('label', { for: 'tckf-typed' }, 'Type ', h('span', { class: 'kbd mono', text: typeToConfirm }), ' to confirm'), typed));
      }
      const ok = h('button', { type: 'submit', class: danger ? 'btn btn-danger' : 'btn btn-primary', text: confirmLabel, disabled: !!typeToConfirm });
      const cancel = h('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancel' });
      append(form, [
        h('div', { class: 'card-head' }, h('h2', { id: 'tck-dlg-title', text: title })),
        text ? h('p', { class: 'muted', text }) : null,
        inputs,
        h('div', { class: 'card-foot field-row' }, cancel, ok),
      ]);
      if (typed) typed.addEventListener('input', () => { ok.disabled = typed.value.trim() !== typeToConfirm; });
      let done = false;
      const finish = (v) => { if (done) return; done = true; dlg.close(); dlg.remove(); resolve(v); };
      cancel.addEventListener('click', () => finish(null));
      dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (typed && typed.value.trim() !== typeToConfirm) return;
        const bad = K.$$('input,textarea', form).find((i) => i.name !== '__typed' && !i.checkValidity());
        if (bad) { bad.reportValidity(); return; }
        const vals = {};
        for (const f of fields) vals[f.name] = form.elements[f.name].value;
        finish(vals);
      });
      document.body.appendChild(dlg);
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      (inputs.length ? K.$('input,textarea,select', form) : cancel).focus();
    });
  };

  /* ---------- charts (inline SVG, one series per chart, one axis) ---------- */
  function svg(tag, attrs) {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
    return el;
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
    return 10 * p;
  }
  function shortDay(d) { const t = Date.parse(String(d).length === 10 ? d + 'T00:00:00Z' : d); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : String(d); }
  K.shortDay = shortDay;
  /** A small data table under the chart for screen readers (and a print fallback). */
  function srTable(label, points, fmt) {
    return h('table', { class: 'sr-only' }, h('caption', { text: label }),
      h('tbody', null, points.map((p) => h('tr', null, h('th', { scope: 'row', text: p.label }), h('td', { text: fmt(p.value) })))));
  }
  /**
   * K.line(el, points:[{label, value}], {label, format, min, max, height})
   * Single series, 2 px line, hover tooltip via a hit column per point.
   */
  K.line = function (el, points, opts = {}) {
    const fmt = opts.format || ((v) => K.num(v, 1));
    const pts = points.filter((p) => p.value != null && Number.isFinite(Number(p.value)));
    if (pts.length < 2) return K.empty(el, { icon: 'chart', title: opts.emptyTitle || 'Not enough data yet', text: opts.emptyText || 'Practise on a couple of days and your trend appears here.' });
    const W = 600, H = opts.height || 180, L = 40, R = 12, T = 12, B = 24;
    const lo = opts.min != null ? opts.min : 0;
    const hi = opts.max != null ? opts.max : niceMax(Math.max(...pts.map((p) => +p.value)));
    const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
    const y = (v) => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': opts.label || 'Chart', preserveAspectRatio: 'none', style: 'display:block;overflow:visible' });
    for (let g = 0; g <= 2; g++) {
      const v = lo + ((hi - lo) * g) / 2;
      root.appendChild(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--line)', 'stroke-width': 1 }));
      const t = svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)', 'font-family': 'var(--mono)' }); t.textContent = fmt(v); root.appendChild(t);
    }
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(+p.value).toFixed(1)}`).join(' ');
    root.appendChild(svg('path', { d: `${d} L${x(pts.length - 1)},${y(lo)} L${x(0)},${y(lo)} Z`, fill: 'var(--teal-soft)', stroke: 'none' }));
    root.appendChild(svg('path', { d, fill: 'none', stroke: 'var(--teal)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
    [0, pts.length - 1].concat(pts.length > 6 ? [Math.floor((pts.length - 1) / 2)] : []).forEach((i) => {
      const t = svg('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle', 'font-size': 11, fill: 'var(--muted)', 'font-family': 'var(--mono)' });
      t.textContent = shortDay(pts[i].label); root.appendChild(t);
    });
    const dot = svg('circle', { r: 4, fill: 'var(--teal)', stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' });
    root.appendChild(dot);
    const tip = h('div', { class: 'tck-tip mono', hidden: true });
    const colW = (W - L - R) / Math.max(1, pts.length - 1);
    pts.forEach((p, i) => {
      const hit = svg('rect', { x: x(i) - colW / 2, y: T, width: colW, height: H - T - B, fill: 'transparent' });
      const title = svg('title'); title.textContent = `${shortDay(p.label)}: ${fmt(+p.value)}`; hit.appendChild(title);
      hit.addEventListener('mouseenter', () => {
        dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(+p.value)); dot.setAttribute('visibility', 'visible');
        tip.textContent = `${shortDay(p.label)} · ${fmt(+p.value)}`; tip.hidden = false;
        tip.style.left = `${(x(i) / W) * 100}%`;
      });
      hit.addEventListener('mouseleave', () => { dot.setAttribute('visibility', 'hidden'); tip.hidden = true; });
      root.appendChild(hit);
    });
    return K.mount(el, h('div', { class: 'chart', style: 'position:relative' }, root, tip, srTable(opts.label || 'Chart data', pts, fmt)));
  };
  /** K.bars(el, rows:[{label, value, sub?}], {label, format, horizontal}) — horizontal bars (labels readable on phones). */
  K.bars = function (el, rows, opts = {}) {
    const fmt = opts.format || ((v) => K.num(v));
    if (!rows.length) return K.empty(el, { icon: 'chart', title: opts.emptyTitle || 'No data for this period', text: opts.emptyText });
    const max = Math.max(...rows.map((r) => +r.value || 0)) || 1;
    const list = h('div', { class: 'tck-bars', role: 'list', 'aria-label': opts.label || 'Bar chart' },
      rows.map((r) => h('div', { class: 'tck-bar', role: 'listitem', title: `${r.label}: ${fmt(+r.value || 0)}` },
        h('span', { class: 'tck-bar-label', text: r.label }),
        h('span', { class: 'tck-bar-track' }, h('span', { class: 'tck-bar-fill', style: `width:${Math.max(1.5, ((+r.value || 0) / max) * 100).toFixed(1)}%` })),
        h('span', { class: 'tck-bar-value mono', text: fmt(+r.value || 0) }))));
    return K.mount(el, h('div', { class: 'chart' }, list));
  };
  /** K.columns(el, points:[{label, value}], {label, format}) — daily columns (e.g. revenue per day). */
  K.columns = function (el, points, opts = {}) {
    const fmt = opts.format || ((v) => K.num(v));
    if (!points.length) return K.empty(el, { icon: 'chart', title: opts.emptyTitle || 'No data for this period' });
    const W = 600, H = opts.height || 180, L = 52, R = 8, T = 10, B = 24;
    const hi = niceMax(Math.max(...points.map((p) => +p.value || 0)));
    const bw = (W - L - R) / points.length;
    const y = (v) => T + (1 - v / hi) * (H - T - B);
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': opts.label || 'Chart', preserveAspectRatio: 'none', style: 'display:block' });
    for (let g = 0; g <= 2; g++) {
      const v = (hi * g) / 2;
      root.appendChild(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: 'var(--line)', 'stroke-width': 1 }));
      const t = svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--muted)', 'font-family': 'var(--mono)' }); t.textContent = fmt(v); root.appendChild(t);
    }
    points.forEach((p, i) => {
      const v = +p.value || 0;
      const r = svg('rect', { x: L + i * bw + Math.min(2, bw * 0.15), y: y(v), width: Math.max(1, bw - Math.min(4, bw * 0.3)), height: Math.max(0, y(0) - y(v)), rx: Math.min(4, bw / 4), fill: 'var(--teal)' });
      const title = svg('title'); title.textContent = `${shortDay(p.label)}: ${fmt(v)}`; r.appendChild(title);
      root.appendChild(r);
    });
    [0, points.length - 1].forEach((i) => {
      const t = svg('text', { x: L + i * bw + bw / 2, y: H - 6, 'text-anchor': i === 0 ? 'start' : 'end', 'font-size': 11, fill: 'var(--muted)', 'font-family': 'var(--mono)' });
      t.textContent = shortDay(points[i].label); root.appendChild(t);
    });
    return K.mount(el, h('div', { class: 'chart' }, root, srTable(opts.label || 'Chart data', points, fmt)));
  };

  /* ---------- shared normalisers ---------- */
  /** Daily rows → [{date, wpm, accuracy, minutes, runs}] from GET /api/me/analytics (basic.daily) or GET /api/user/history (days):
      both send {date, minutes, runs, bestWpm, avgAccuracy, xp}. */
  K.dailySeries = (rows) => (rows || []).map((d) => ({ date: d.date, wpm: d.bestWpm || null, accuracy: d.avgAccuracy, minutes: d.minutes, runs: d.runs }))
    .filter((d) => d.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  /** Tests from GET /api/me/tests: {id, duration, wpm, rawWpm, accuracy, errors, chars, textKind, day, createdAt}. */
  K.tests = (data) => ((data && data.tests) || []);
  /** Letter pair from the app's "a>b" key, with the space made visible. */
  K.pair = (p) => String(p).split('>').map((c) => (c === ' ' ? '␣' : c)).join('');
  /** The signed-in staff role: TC.me().role, else GET /api/admin/me. */
  K.role = async function () {
    const me = await K.me();
    if (me && me.role !== undefined) return me.role;
    const r = await K.api('GET', '/api/admin/me');
    return r.ok ? r.data.role : null;
  };
  /** Where a checkout order's server status sends the learner. 'paid' and part-refunded orders were paid (success);
      a fully refunded order is shown in the payment history; failed/cancelled → failure; anything else is still pending. */
  K.orderPage = (status) => (status === 'paid' || status === 'partially_refunded' ? 'success'
    : status === 'refunded' ? 'payments' : status === 'failed' || status === 'cancelled' ? 'failure' : 'pending');
  K.orderUrl = (status, orderId) => (K.orderPage(status) === 'payments' ? '/account/payments' : `/payment/${K.orderPage(status)}?order=${encodeURIComponent(orderId)}`);
  /** Human length of a validity period in days. */
  K.validity = (days) => (days == null ? 'Never expires' : days % 30 === 0 ? `${days / 30} month${days === 30 ? '' : 's'}` : `${days} days`);
  K.duration = (s) => (s >= 60 ? `${s / 60} min` : `${s} s`);

  /* ---------- page-level styles shared by the kit (dialog, tooltip, bars) ---------- */
  const css = `
.tck-dialog{border:0;padding:0;background:transparent;max-width:min(520px,calc(100vw - 24px));width:100%;color:inherit}
.tck-dialog::backdrop{background:var(--scrim,rgba(0,0,0,.6))}
.tck-dialog .card-foot{justify-content:flex-end;gap:.5rem}
.tck-tip{position:absolute;top:0;transform:translateX(-50%);padding:.2rem .5rem;border-radius:8px;background:var(--raise);border:1px solid var(--line-strong);font-size:12px;pointer-events:none;white-space:nowrap}
.tck-bars{display:grid;gap:.45rem}
.tck-bar{display:grid;grid-template-columns:minmax(5rem,9rem) 1fr auto;gap:.6rem;align-items:center;font-size:14px}
.tck-bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tck-bar-track{height:10px;border-radius:5px;background:var(--glass-2,rgba(255,255,255,.08));overflow:hidden}
.tck-bar-fill{display:block;height:100%;border-radius:5px;background:var(--teal)}
.tck-bar-value{color:var(--muted);font-size:13px;min-width:3.5rem;text-align:right}
.icon svg{width:1.25em;height:1.25em;vertical-align:-.2em}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  window.TCK = K;
})();
