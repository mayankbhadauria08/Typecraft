/* TypeCraft site helpers (docs/SAAS-CONTRACTS.md §11): the global `TC` used by every
   public, account, payment and admin page. Classic script, no dependencies.
   The icon set at the top is also imported by the Worker (src/layout.js) so that
   server-rendered navigation uses the same drawings: keep that part free of DOM use. */
(function (root) {
  'use strict';

  /* ---------- icons: one 24 px set, 1.5 px stroke, round joins ---------- */
  const P = {
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7.5 14h9"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".6"/>',
    chart: '<path d="M4 19.5h16M7 16v-4M11 16V8M15 16v-6M19 16V5"/>',
    trend: '<path d="M3.5 17l5.5-5.5 4 4L20.5 8"/><path d="M15 8h5.5v5.5"/>',
    gamepad: '<rect x="2.5" y="7" width="19" height="10.5" rx="5.25"/><path d="M7.5 10.5v4M5.5 12.5h4M15 11.5h.01M17.5 13.5h.01"/>',
    trophy: '<path d="M8 4.5h8v5a4 4 0 0 1-8 0z"/><path d="M8 6.5H5a3 3 0 0 0 3 4M16 6.5h3a3 3 0 0 1-3 4M12 13.5v3.5M8.5 20h7M9.5 17h5"/>',
    star: '<path d="M12 3.8l2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8z"/>',
    crown: '<path d="M4 8l4 4 4-6 4 6 4-4-1.5 10h-13z"/><path d="M5.5 20.5h13"/>',
    book: '<path d="M4 5.5A2 2 0 0 1 6 3.5h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20.5V5.5M8 7.5h7"/>',
    layers: '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.5l8.5 4.5 8.5-4.5M3.5 16.5l8.5 4.5 8.5-4.5"/>',
    shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.4-4.4"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2"/>',
    unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 7.7-1.5M12 14.5v2"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/>',
    user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
    users: '<circle cx="9" cy="9" r="3.5"/><path d="M2.8 19.5c.9-3 3.2-4.6 6.2-4.6s5.3 1.6 6.2 4.6M15.5 5.7a3.5 3.5 0 0 1 0 6.6M17.5 15.2c1.8.6 3 2 3.7 4.3"/>',
    card: '<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
    receipt: '<path d="M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    home: '<path d="M4 10.5L12 4l8 6.5V20H14.5v-5.5h-5V20H4z"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    history: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v4h4M12 8v4.3l3 1.8"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
    alert: '<path d="M12 3.8l9 15.7H3z"/><path d="M12 10v4.5M12 17.2h.01"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8h.01"/>',
    logout: '<path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14"/><path d="M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M4.5 19.5h15"/>',
    external: '<path d="M13.5 4.5h6v6M19.5 4.5l-8 8"/><path d="M17 13.5v5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7h5"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 0 1-13.3 4.7M4.5 12A7.5 7.5 0 0 1 17.8 7.3"/><path d="M18 3.5v4h-4M6 20.5v-4h4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
    moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
    sparkle: '<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    code: '<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14"/>',
    hash: '<path d="M9.5 4l-2 16M16.5 4l-2 16M4.5 9h15M3.5 15h15"/>',
    briefcase: '<rect x="3" y="7.5" width="18" height="12" rx="2.5"/><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M3 12.5h18"/>',
    certificate: '<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M7 8.5h10M7 12h5"/><circle cx="16" cy="16" r="2.5"/><path d="M14.7 18.2l-.7 3 2-1 2 1-.7-3"/>',
    send: '<path d="M20.5 3.5L10 14M20.5 3.5l-6.5 17-4-6.5-6.5-4z"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    rupee: '<path d="M7 4.5h10M7 9h10M9 4.5c3.5 0 5.5 1.5 5.5 4.5S12.5 13.5 9 13.5H7.5l7.5 7"/>',
    play: '<path d="M7.5 4.8v14.4L19 12z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    flag: '<path d="M5 21V4.5M5 4.5h11l-2 4 2 4H5"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.4 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.4-3.5-8.5S9.6 6.1 12 3.5z"/>',
    devices: '<rect x="2.5" y="4.5" width="14" height="10" rx="1.5"/><path d="M6 18h7M9.5 14.5V18"/><rect x="17" y="8.5" width="4.5" height="11" rx="1.2"/>',
    inbox: '<path d="M3.5 13.5l2.5-8h12l2.5 8v5.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 19z"/><path d="M3.5 13.5h5l1 2.5h5l1-2.5h5"/>',
    package: '<path d="M12 3l8.5 4.5v9L12 21l-8.5-4.5v-9z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9M7.8 5.3l8.5 4.5"/>',
    monitor: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  };
  const ICONS = {};
  for (const k of Object.keys(P)) {
    ICONS[k] = '<svg class="ic" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + P[k] + '</svg>';
  }
  root.TC_ICONS = ICONS;
  if (typeof document === 'undefined') return; // imported by the Worker: icons only

  /* ---------- installing the app on a computer ----------
     Chrome and Edge fire beforeinstallprompt when the site can be installed; we keep it and show our own
     "Install the app" buttons ([data-install]). Only on computers: a phone has no keyboard to type with.
     Firefox and Safari never fire it, so the buttons stay hidden there and /get-the-app explains instead. */
  const touchOnly = () => !!(root.matchMedia && root.matchMedia('(hover: none) and (pointer: coarse)').matches);
  const standalone = () => !!(root.matchMedia && root.matchMedia('(display-mode: standalone)').matches) || root.navigator.standalone === true;
  const install = { prompt: null, installed: standalone() };
  function paintInstall() {
    const can = !!install.prompt && !install.installed && !touchOnly();
    document.querySelectorAll('[data-install]').forEach((b) => { b.hidden = !can; });
    const status = document.querySelector('[data-install-status]');
    if (status) status.setAttribute('data-state', install.installed ? 'installed' : touchOnly() ? 'phone' : can ? 'ready' : 'manual');
  }
  async function runInstall() {
    if (!install.prompt) return;
    const p = install.prompt;
    install.prompt = null;
    p.prompt();
    try { const choice = await p.userChoice; if (choice && choice.outcome === 'accepted') install.installed = true; } catch (e) { /* closed */ }
    paintInstall();
  }
  root.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); install.prompt = e; paintInstall(); });
  root.addEventListener('appinstalled', () => { install.installed = true; install.prompt = null; paintInstall(); });

  /* ---------- "send this link to your computer" (phones) ---------- */
  async function shareLink(btn) {
    const url = (document.querySelector('link[rel="canonical"]') || {}).href || location.href;
    const data = { title: 'TypeCraft', text: 'Open TypeCraft on my computer: ', url };
    if (root.navigator.share) {
      try { await root.navigator.share(data); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await root.navigator.clipboard.writeText(url); toast('Link copied. Paste it into WhatsApp or an email to yourself.', 'ok'); }
    catch (e) { root.prompt('Copy this link and send it to yourself:', url); }
  }

  /* ---------- basics ---------- */
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const icon = (name) => ICONS[name] || '';
  const qs = (name) => new URLSearchParams(location.search).get(name);
  const NETWORK_ERROR = "Can't reach TypeCraft right now. Check your connection and try again.";

  /** JSON request to this site. Never throws: { ok, status, data, error }. */
  async function api(method, path, body) {
    const init = { method: method || 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined && body !== null) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(path, init); } catch (e) {
      return { ok: false, status: 0, data: null, error: { code: 'network', message: NETWORK_ERROR } };
    }
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.ok) return { ok: true, status: res.status, data: data || {}, error: null };
    let error = (data && data.error) || null;
    if (!error) {
      error = res.status === 404 ? { code: 'not_found', message: "That isn't available yet." }
        : { code: 'http_' + res.status, message: 'Something went wrong on our side. Please try again.' };
    }
    return { ok: false, status: res.status, data, error };
  }

  /* ---------- who is signed in (rendered into the page by the server) ---------- */
  let mePromise = null;
  function readBoot() {
    const el = document.getElementById('tc-boot');
    if (!el) return undefined;
    try { return JSON.parse(el.textContent); } catch (e) { return undefined; }
  }
  /** Promise<{ user, entitlements, role } | null>, once per page. */
  function me(fresh) {
    if (mePromise && !fresh) return mePromise;
    const boot = fresh ? undefined : readBoot();
    if (boot !== undefined) { mePromise = Promise.resolve(boot && boot.user ? boot : null); return mePromise; }
    mePromise = (async () => {
      const r = await api('GET', '/api/auth/me');
      if (!r.ok || !r.data.user) return null;
      const e = await api('GET', '/api/me/entitlements');
      return { user: r.data.user, entitlements: e.ok ? e.data : null, role: (boot && boot.role) || null };
    })();
    return mePromise;
  }

  /* ---------- toasts ---------- */
  function toast(text, kind) {
    let region = document.getElementById('tc-toasts');
    if (!region) {
      region = document.createElement('div');
      region.id = 'tc-toasts'; region.className = 'toasts'; region.setAttribute('role', 'status'); region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' toast-' + kind : '');
    t.innerHTML = icon(kind === 'bad' ? 'alert' : kind === 'ok' ? 'check' : 'info') + '<span>' + esc(text) + '</span>';
    region.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, kind === 'bad' ? 6500 : 4200);
  }

  /* ---------- forms ---------- */
  function formValues(form) {
    const o = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.value;
    }
    return o;
  }
  /** Shows field errors under their inputs (.field .err) and an optional message in the form's
      [data-msg] / .alert slot. fields = null clears everything. */
  function formErrors(form, fields, message) {
    form.querySelectorAll('.err').forEach((e) => { e.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
    let first = null;
    for (const [name, text] of Object.entries(fields || {})) {
      const input = form.elements[name];
      if (!input) continue;
      const field = (input.closest && input.closest('.field')) || null;
      let err = field ? field.querySelector('.err') : null;
      if (!err && field) { err = document.createElement('div'); err.className = 'err'; field.appendChild(err); }
      if (err) { err.textContent = text; if (!err.id) err.id = 'err-' + name + '-' + Math.random().toString(36).slice(2, 7); input.setAttribute('aria-describedby', err.id); }
      input.setAttribute('aria-invalid', 'true');
      first = first || input;
    }
    let slot = form.querySelector('[data-msg]');
    if (message && !slot) { slot = document.createElement('div'); slot.setAttribute('data-msg', ''); form.prepend(slot); }
    if (slot) {
      slot.className = message ? 'alert alert-bad' : '';
      slot.setAttribute('role', message ? 'alert' : 'presentation');
      slot.innerHTML = message ? icon('alert') + '<div>' + esc(message) + '</div>' : '';
    }
    if (first) first.focus();
  }
  /** A success / info message in the same slot. */
  function formMessage(form, message, kind) {
    let slot = form.querySelector('[data-msg]');
    if (!slot) { slot = document.createElement('div'); slot.setAttribute('data-msg', ''); form.prepend(slot); }
    slot.className = message ? 'alert alert-' + (kind || 'ok') : '';
    slot.setAttribute('role', 'status');
    slot.innerHTML = message ? icon(kind === 'info' ? 'info' : 'check') + '<div>' + esc(message) + '</div>' : '';
  }
  function busy(button, on) {
    if (!button) return;
    if (on) { button.setAttribute('aria-busy', 'true'); button.disabled = true; }
    else { button.removeAttribute('aria-busy'); button.disabled = false; }
  }

  /* ---------- formatting ---------- */
  function money(paise, currency) {
    const n = Math.abs(Number(paise || 0)) / 100;
    const whole = Math.round(n * 100) % 100 === 0;
    const sym = !currency || currency === 'INR' ? '₹' : currency + ' ';
    return (Number(paise) < 0 ? '\u2212' : '') + sym + n.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  }
  function date(iso) {
    if (!iso) return '—';
    const d = new Date(iso); if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function dateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso); if (isNaN(d)) return '—';
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /* ---------- small SVG charts (no library) ---------- */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  function svgEl(w, h, label) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" role="img" aria-label="' + esc(label || 'Chart') + '">';
  }
  /** series: [{ name, values:[number|null], color? }], opts: { labels:[x labels], height, format(v), label } */
  function line(el, series, opts) {
    opts = opts || {};
    const list = (Array.isArray(series) ? series : [series]).filter(Boolean);
    const n = Math.max(0, ...list.map((s) => (s.values || []).length));
    if (!n) { el.innerHTML = '<div class="empty empty-sm">' + icon('chart') + '<p class="muted">No data yet.</p></div>'; return; }
    const W = 600, H = opts.height || 200, L = 36, R = 10, T = 12, B = 26;
    const all = list.flatMap((s) => s.values.filter((v) => v != null));
    const max = niceMax(Math.max(1, ...all));
    const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const fmt = opts.format || ((v) => String(Math.round(v)));
    let s = svgEl(W, H, opts.label);
    for (let g = 0; g <= 4; g++) {
      const v = (max * g) / 4, yy = y(v);
      s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/><text class="axis" x="' + (L - 6) + '" y="' + (yy + 3.5) + '" text-anchor="end">' + esc(fmt(v)) + '</text>';
    }
    const labels = opts.labels || [];
    const step = Math.max(1, Math.ceil(n / 6));
    for (let i = 0; i < n; i += step) if (labels[i] != null) s += '<text class="axis" x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(labels[i]) + '</text>';
    list.forEach((ser, k) => {
      const cls = 'series s' + (k % 4);
      let d = '', pen = false;
      ser.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; });
      s += '<path class="' + cls + '" d="' + d + '"/>';
      ser.values.forEach((v, i) => { if (v != null) s += '<circle class="' + cls + '" cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="2.6"><title>' + esc((labels[i] != null ? labels[i] + ': ' : '') + fmt(v) + (ser.name ? ' ' + ser.name : '')) + '</title></circle>'; });
    });
    s += '</svg>';
    let legend = '';
    if (list.length > 1) legend = '<div class="chart-legend">' + list.map((ser, k) => '<span><i class="sw s' + (k % 4) + '"></i>' + esc(ser.name) + '</span>').join('') + '</div>';
    el.classList.add('chart');
    el.innerHTML = s + legend;
  }
  /** rows: [{ label, value, sub? }], opts: { format(v), max?, label } — horizontal bars */
  function bars(el, rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) { el.innerHTML = '<div class="empty empty-sm">' + icon('chart') + '<p class="muted">No data yet.</p></div>'; return; }
    const max = opts.max || Math.max(1, ...rows.map((r) => Number(r.value) || 0));
    const fmt = opts.format || ((v) => String(v));
    el.classList.add('chart');
    el.innerHTML = '<div class="bars" role="list" aria-label="' + esc(opts.label || 'Chart') + '">' + rows.map((r) =>
      '<div class="bar-row" role="listitem"><span class="bar-label">' + esc(r.label) + '</span><span class="bar-track"><i style="width:' +
      Math.max(0, Math.min(100, (100 * (Number(r.value) || 0)) / max)).toFixed(1) + '%"></i></span><span class="bar-value mono">' + esc(fmt(r.value)) + '</span></div>').join('') + '</div>';
  }

  /* ---------- pagination ---------- */
  function paginate(el, o) {
    const page = Number(o.page) || 1, pages = Math.max(1, Number(o.pages) || 1);
    if (pages <= 1) { el.innerHTML = ''; return; }
    el.className = 'pager';
    el.innerHTML = '<button type="button" class="btn btn-ghost btn-sm" data-p="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>' + icon('arrowLeft') + '<span>Previous</span></button>' +
      '<span class="muted mono">Page ' + page + ' of ' + pages + '</span>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-p="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + '><span>Next</span>' + icon('arrowRight') + '</button>';
    el.querySelectorAll('button[data-p]').forEach((b) => b.addEventListener('click', () => o.onPage && o.onPage(Number(b.dataset.p))));
  }

  /** Same-origin path from ?next= (anything else falls back). */
  function safeNext(fallback) {
    const n = qs('next');
    if (n && /^\/(?!\/)[^\\\s]*$/.test(n) && !/^\/(login|signup)\b/.test(n)) return n;
    return fallback || '/dashboard';
  }

  /* ---------- theme: same setting as the app (typingMasterSettings.bg 'paper' = light) ---------- */
  function setTheme(light) {
    let st = {};
    try { st = JSON.parse(localStorage.getItem('typingMasterSettings') || '{}') || {}; } catch (e) { st = {}; }
    if (light) { if (st.bg && st.bg !== 'paper') st.lastDarkBg = st.bg; st.bg = 'paper'; }
    else { st.bg = st.lastDarkBg || 'letters'; }
    try { localStorage.setItem('typingMasterSettings', JSON.stringify(st)); } catch (e) {}
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
  }

  /* ---------- page chrome: mobile nav, user menu, sign out, theme button ---------- */
  function wire() {
    const toggle = document.querySelector('[data-nav-toggle]');
    if (toggle) {
      const nav = document.getElementById(toggle.getAttribute('aria-controls'));
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(open));
        if (nav) nav.classList.toggle('open', open);
        document.documentElement.classList.toggle('nav-open', open);
      });
    }
    // the user menu and the header's dropdowns: one open at a time; outside click or Escape closes them
    const MENUS = 'details.user-menu[open], details.nav-group[open]';
    document.querySelectorAll('details.user-menu, details.nav-group').forEach((d) => d.addEventListener('toggle', () => {
      if (d.open) document.querySelectorAll(MENUS).forEach((o) => { if (o !== d) o.removeAttribute('open'); });
    }));
    document.addEventListener('click', (e) => {
      document.querySelectorAll(MENUS).forEach((d) => { if (!d.contains(e.target)) d.removeAttribute('open'); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll(MENUS).forEach((d) => { d.removeAttribute('open'); const s = d.querySelector('summary'); if (s) s.focus(); });
    });
    document.querySelectorAll('[data-signout]').forEach((b) => b.addEventListener('click', async () => {
      busy(b, true);
      await api('POST', '/api/auth/logout', {});
      try { localStorage.removeItem('typingMasterAccount'); } catch (e) {}
      location.replace('/login?signedout=1');
    }));
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => {
      const sync = () => { const light = document.documentElement.getAttribute('data-theme') === 'light'; b.setAttribute('aria-pressed', String(light)); b.innerHTML = icon(light ? 'moon' : 'sun') + '<span' + (b.getAttribute('data-theme-toggle') === 'menu' ? '' : ' class="sr-only"') + '>' + (light ? 'Switch to dark theme' : 'Switch to light theme') + '</span>'; };
      sync();
      b.addEventListener('click', () => { setTheme(document.documentElement.getAttribute('data-theme') !== 'light'); sync(); });
    });
    document.querySelectorAll('[data-tabs]').forEach(initTabs);
    document.querySelectorAll('[data-install]').forEach((b) => b.addEventListener('click', runInstall));
    paintInstall();
    document.querySelectorAll('[data-share-link]').forEach((b) => b.addEventListener('click', () => shareLink(b)));
    document.querySelectorAll('[data-kb-dismiss]').forEach((b) => b.addEventListener('click', () => {
      const note = b.closest('[data-kb-note]'); if (note) note.remove();
      try { sessionStorage.setItem('tcKbNote', 'off'); } catch (e) {}
    }));
    try { if (sessionStorage.getItem('tcKbNote') === 'off') document.querySelectorAll('[data-kb-note]').forEach((n) => n.remove()); } catch (e) {}
    // notices from the team: closing one keeps it closed on every page, and in the trainer (the tc_nd cookie)
    document.querySelectorAll('[data-notice-close]').forEach((b) => b.addEventListener('click', () => {
      const bar = b.closest('[data-notice]'); if (!bar) return;
      closeNotice(bar.getAttribute('data-notice'));
      const all = bar.parentElement; bar.remove();
      if (all && !all.children.length) all.remove();
    }));
    // "Start free" calls to action become "Open the trainer" for signed-in visitors
    const boot = readBoot();
    if (boot && boot.user) document.querySelectorAll('a[data-auth-swap]').forEach((a) => { a.href = a.getAttribute('data-auth-swap') || '/app'; a.innerHTML = 'Open the trainer' + icon('arrowRight'); });
  }

  /** Remembers a closed notice for 60 days; the last 10 are kept. */
  function closeNotice(id) {
    if (!/^ntc_[a-z0-9]{6,24}$/.test(id || '')) return;
    const m = document.cookie.match(/(?:^|;\s*)tc_nd=([^;]*)/);
    const ids = (m ? decodeURIComponent(m[1]).split('.') : []).filter((x) => x && x !== id).concat(id).slice(-10);
    document.cookie = 'tc_nd=' + ids.join('.') + '; Path=/; Max-Age=' + 60 * 86400 + '; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }

  /** .tabs with buttons [role=tab][aria-controls]; arrow keys move between tabs. */
  function initTabs(list) {
    const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
    const select = (tab, focus) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
        const panel = document.getElementById(t.getAttribute('aria-controls'));
        if (panel) panel.hidden = !on;
      });
      if (focus) tab.focus();
      list.dispatchEvent(new CustomEvent('tabchange', { detail: { tab } }));
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t));
      t.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
      });
    });
    list.tcSelect = (id) => { const t = tabs.find((x) => x.dataset.tab === id || x.id === id); if (t) select(t); };
  }

  root.TC = {
    api, me, toast, formValues, formErrors, formMessage, busy, money, date, dateTime, qs, icon, esc,
    chart: { line, bars }, paginate, safeNext, setTheme, initTabs,
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})(typeof globalThis !== 'undefined' ? globalThis : window);
