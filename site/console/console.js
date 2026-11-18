/* TypeCraft admin console: what every page shares (window.AC).
   - AC.api(): talks to /api/admin, sends you to sign-in when the session has ended, and asks
     for your password when a sensitive action needs it confirmed.
   - AC.el(), AC.icon(), AC.toast(), AC.confirm(), AC.fmt, AC.money(), AC.badge(): small building blocks.
   - AC.formDialog(): a dialog with fields that stays open until the server accepts.
   - AC.list(): a filtered, paged table whose filters live in the address bar.
   - AC.download(): a spreadsheet download that goes through the same checks as AC.api().
   Data from the server is only ever placed as text, never as HTML. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var base = root.getAttribute('data-console-base') || '/console';
  var boot = {};
  try { boot = JSON.parse(doc.getElementById('console-boot').textContent) || {}; } catch (e) { boot = {}; }
  var me = boot.me || null;

  /* ---------- building blocks ---------- */
  function el(tag, attrs, kids) {
    var node = doc.createElement(tag), k;
    for (k in attrs || {}) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'on') { for (var ev in v) node.addEventListener(ev, v[ev]); }
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    append(node, kids);
    return node;
  }
  function append(node, kids) {
    if (kids === null || kids === undefined || kids === false) return;
    if (Array.isArray(kids)) { kids.forEach(function (kid) { append(node, kid); }); return; }
    node.appendChild(typeof kids === 'string' || typeof kids === 'number' ? doc.createTextNode(String(kids)) : kids);
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function icon(name) {
    var bank = doc.getElementById('ac-icons');
    var svg = bank && bank.content.querySelector('[data-icon="' + name + '"] svg');
    return svg ? svg.cloneNode(true) : doc.createTextNode('');
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';
  /** An SVG element: sizes and positions go in attributes, so no inline styles are needed. */
  function svg(tag, attrs, kids) {
    var node = doc.createElementNS(SVG_NS, tag), k;
    for (k in attrs || {}) if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, String(attrs[k]));
    append(node, kids);
    return node;
  }
  function badge(text, kind) { return el('span', { class: 'badge' + (kind ? ' badge-' + kind : ''), text: text }); }
  /** ₹1,499 or ₹99.50 from an amount in paise. */
  function money(paise, currency) {
    var amount = (Number(paise) || 0) / 100;
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', minimumFractionDigits: amount % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(amount);
    } catch (e) { return '\u20b9' + amount; }
  }

  /* ---------- dates ----------
     The business runs on India time, and the server counts days in India time: the console shows every
     date and time that way, in day-month-year order, wherever the administrator's own computer is set. */
  var LOCALE = 'en-IN', ZONE = 'Asia/Kolkata';
  function shown(iso, options) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return '\u2013';
    options.timeZone = ZONE;
    return new Intl.DateTimeFormat(LOCALE, options).format(d);
  }
  var fmt = {
    date: function (iso) { return shown(iso, { day: 'numeric', month: 'short', year: 'numeric' }); },
    /** '2026-11-18' (an India day, as the server sends it) → '18 Nov'. */
    day: function (day) { return shown(day + 'T12:00:00+05:30', { day: 'numeric', month: 'short' }); },
    dateTime: function (iso) { return shown(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); },
    time: function (iso) { return shown(iso, { hour: 'numeric', minute: '2-digit' }); },
    ago: function (iso) {
      var d = new Date(iso);
      if (!iso || isNaN(d)) return '–';
      var mins = Math.round((Date.now() - d.getTime()) / 60000);
      if (mins < 1) return 'Just now';
      if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
      var hours = Math.round(mins / 60);
      if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
      var days = Math.round(hours / 24);
      if (days < 7) return days + (days === 1 ? ' day ago' : ' days ago');
      return fmt.date(iso); // callers put the exact time in a tooltip
    },
    until: function (iso) {
      var left = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
      if (isNaN(left)) return '';
      if (left < 1) return 'in under a minute';
      if (left < 60) return 'in ' + left + ' min';
      return 'in ' + Math.floor(left / 60) + ' h ' + (left % 60) + ' min';
    }
  };

  /* ---------- toasts ---------- */
  function toast(message, kind) {
    var host = doc.getElementById('toasts');
    if (!host) return;
    kind = kind === 'bad' ? 'bad' : kind === 'info' ? 'info' : 'ok';
    var node = el('div', { class: 'toast is-' + kind }, [
      icon(kind === 'bad' ? 'alert' : kind === 'info' ? 'info' : 'check'),
      el('div', { class: 'toast-text', text: message }),
      el('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss', on: { click: function () { node.remove(); } } }, icon('x'))
    ]);
    host.appendChild(node);
    while (host.children.length > 3) host.removeChild(host.firstChild);
    setTimeout(function () { node.remove(); }, kind === 'bad' ? 9000 : 5000);
  }

  /* ---------- dialogs ---------- */
  // build(close) returns the dialog's content; close(value) settles the promise. Escape and a click outside close with false.
  function openDialog(build, label) {
    return new Promise(function (resolve) {
      var value = false;
      var dialog = el('dialog', { class: 'dialog', 'aria-label': label });
      function close(v) { value = v; dialog.close(); }
      append(dialog, build(close));
      dialog.addEventListener('click', function (e) { if (e.target === dialog) close(false); });
      dialog.addEventListener('close', function () { dialog.remove(); resolve(value); });
      doc.body.appendChild(dialog);
      dialog.showModal();
    });
  }
  /** → true when confirmed. { title, text, confirmLabel, danger } */
  function confirmDialog(opts) {
    return openDialog(function (close) {
      return [
        el('div', { class: 'dialog-body' }, [el('h2', { text: opts.title }), opts.text ? el('p', { text: opts.text }) : null]),
        el('div', { class: 'dialog-actions' }, [
          el('button', { type: 'button', class: 'btn btn-quiet', text: opts.cancelLabel || 'Cancel', on: { click: function () { close(false); } } }),
          el('button', { type: 'button', class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'), text: opts.confirmLabel || 'Confirm', autofocus: !opts.danger, on: { click: function () { close(true); } } })
        ])
      ];
    }, opts.title);
  }
  /** Asks for the password again (sensitive actions). → true once the server has accepted it. */
  function confirmPassword() {
    return openDialog(function (close) {
      var input = el('input', { id: 'acReauth', type: 'password', autocomplete: 'current-password', required: true });
      var error = el('p', { class: 'err', id: 'acReauthErr', hidden: true });
      var submit = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Confirm' });
      var form = el('form', { novalidate: true }, [
        el('div', { class: 'dialog-body' }, [
          el('h2', { text: 'Confirm your password' }),
          el('p', { text: 'This change is sensitive, so we check that it is still you. You won\'t be asked again for ' + ((me && me.session.freshMinutes) || 10) + ' minutes.' }),
          el('div', { class: 'field' }, [el('label', { for: 'acReauth', text: 'Password' }), input, error])
        ]),
        el('div', { class: 'dialog-actions' }, [
          el('button', { type: 'button', class: 'btn btn-quiet', text: 'Cancel', on: { click: function () { close(false); } } }),
          submit
        ])
      ]);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!input.value) { fail('Enter your password.'); return; }
        busy(submit, true);
        request('POST', '/api/admin/auth/reauth', { password: input.value }).then(function () { close(true); }, function (err) {
          busy(submit, false);
          if (signedOut(err)) return;
          fail((err.fields && err.fields.password) || err.message);
        });
      });
      function fail(text) {
        error.textContent = text; error.hidden = false;
        input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', 'acReauthErr');
        input.focus(); input.select();
      }
      return form;
    }, 'Confirm your password');
  }
  function busy(button, on) {
    button.disabled = !!on;
    button.classList.toggle('is-busy', !!on);
    if (on) button.setAttribute('aria-busy', 'true'); else button.removeAttribute('aria-busy');
  }
  var dialogN = 0;
  /**
   * A dialog with fields. It stays open until opts.submit(values) succeeds, and shows what the server
   * says about a field under that field. → what submit returned (true if nothing), or false when cancelled.
   * opts: { title, text, submitLabel, danger, submit(values) → Promise,
   *         fields: [{ name, label, type: 'text' | 'textarea' | 'number' | 'select' | 'radio', value, required,
   *                    maxlength, min, max, placeholder, hint, options: [{ value, label, hint }] }] }
   */
  function formDialog(opts) {
    return openDialog(function (close) {
      var uid = 'acf' + (++dialogN) + '-', controls = {}, errors = {};
      var banner = el('div', { class: 'alert alert-bad', role: 'alert', hidden: true }, [icon('alert'), el('span')]);
      var submitBtn = el('button', { type: 'submit', class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'), text: opts.submitLabel || 'Save' });
      function fieldRow(f) {
        var id = uid + f.name, err = el('p', { class: 'err', id: id + '-err', hidden: true }), control, row;
        errors[f.name] = err;
        if (f.type === 'radio') {
          var radios = f.options.map(function (o, i) {
            var input = el('input', { type: 'radio', name: id, id: id + '-' + i, value: o.value, checked: String(o.value) === String(f.value) });
            return el('label', { class: 'choice', for: id + '-' + i }, [input, el('span', null, [el('span', { class: 'choice-label', text: o.label }), o.hint ? el('span', { class: 'choice-hint', text: o.hint }) : null])]);
          });
          controls[f.name] = { read: function () { var on = row.querySelector('input:checked'); return on ? on.value : ''; }, node: null, first: function () { return row.querySelector('input'); } };
          row = el('fieldset', { class: 'field choices' }, [el('legend', { text: f.label }), radios, f.hint ? el('p', { class: 'field-hint', text: f.hint }) : null, err]);
          return row;
        }
        if (f.type === 'textarea') control = el('textarea', { id: id, rows: f.rows || 3, maxlength: f.maxlength, placeholder: f.placeholder });
        else if (f.type === 'select') control = el('select', { id: id }, f.options.map(function (o) { return el('option', { value: o.value, text: o.label }); }));
        else control = el('input', { id: id, type: f.type === 'number' ? 'number' : 'text', maxlength: f.maxlength, min: f.min, max: f.max, step: f.step, placeholder: f.placeholder, inputmode: f.type === 'number' ? 'numeric' : null, autocomplete: 'off' });
        if (f.value !== undefined && f.value !== null) control.value = String(f.value);
        controls[f.name] = { read: function () { return control.value; }, node: control, first: function () { return control; } };
        return el('div', { class: 'field' }, [el('label', { for: id, text: f.label }), control, f.hint ? el('p', { class: 'field-hint', id: id + '-hint', text: f.hint }) : null, err]);
      }
      function showError(name, text) {
        var c = controls[name], err = errors[name];
        err.textContent = text || ''; err.hidden = !text;
        if (c.node) { if (text) { c.node.setAttribute('aria-invalid', 'true'); c.node.setAttribute('aria-describedby', err.id); } else { c.node.removeAttribute('aria-invalid'); c.node.removeAttribute('aria-describedby'); } }
      }
      var fields = opts.fields || [];
      var form = el('form', { novalidate: true }, [
        el('div', { class: 'dialog-body' }, [el('h2', { text: opts.title }), opts.text ? el('p', { text: opts.text }) : null, fields.map(fieldRow), banner]),
        el('div', { class: 'dialog-actions' }, [
          el('button', { type: 'button', class: 'btn btn-quiet', text: 'Cancel', on: { click: function () { close(false); } } }),
          submitBtn
        ])
      ]);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        banner.hidden = true;
        var values = {}, firstBad = null;
        fields.forEach(function (f) {
          var v = controls[f.name].read();
          values[f.name] = typeof v === 'string' ? v.trim() : v;
          var missing = f.required && !values[f.name];
          showError(f.name, missing ? (f.requiredText || 'Fill this in.') : '');
          if (missing && !firstBad) firstBad = controls[f.name].first();
        });
        if (firstBad) { firstBad.focus(); return; }
        busy(submitBtn, true);
        Promise.resolve().then(function () { return opts.submit(values); }).then(function (result) {
          close(result === undefined ? true : result);
        }, function (err) {
          busy(submitBtn, false);
          if (err && err.code === 'cancelled') return; // the password check was cancelled: stay here
          var shown = false, name;
          if (err && err.fields) for (name in err.fields) if (errors[name]) { showError(name, err.fields[name]); if (!shown) controls[name].first().focus(); shown = true; }
          if (!shown) { banner.querySelector('span').textContent = (err && err.message) || 'Something went wrong. Try again.'; banner.hidden = false; }
        });
      });
      return form;
    }, opts.title);
  }

  /* ---------- the API ---------- */
  function ApiError(status, code, message, fields) {
    this.name = 'ApiError'; this.status = status; this.code = code; this.message = message; this.fields = fields || null;
  }
  ApiError.prototype = Object.create(Error.prototype);
  var lastContact = Date.now(); // the session idles out on the server; this mirrors it for the page

  function request(method, path, body) {
    var init = { method: method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (method !== 'GET') { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body === undefined ? {} : body); }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (res.ok && data) { lastContact = Date.now(); return data; }
        var err = (data && data.error) || {};
        throw new ApiError(res.status, err.code || 'server_error', err.message || 'Something went wrong on our side. Try again.', err.fields);
      });
    }, function () {
      throw new ApiError(0, 'network', "Couldn't reach TypeCraft. Check your connection and try again.");
    });
  }
  function toLogin(ended) {
    var here = location.pathname + location.search;
    var q = [];
    if (here !== base) q.push('next=' + encodeURIComponent(here));
    if (ended) q.push('ended=1');
    location.assign(base + '/login' + (q.length ? '?' + q.join('&') : ''));
  }
  // true when the error means the console session is over (the page is already leaving)
  function signedOut(err) {
    if (err && err.status === 401 && err.code === 'admin_sign_in') { toLogin(true); return true; }
    return false;
  }
  var never = function () { return new Promise(function () {}); };
  /**
   * AC.api('PUT', '/api/admin/permissions', {...}) → the response data, or throws an ApiError.
   * A cancelled password prompt throws an ApiError with code 'cancelled': callers leave things as they were.
   */
  function api(method, path, body) {
    return request(method, path, body).catch(function (err) {
      if (signedOut(err)) return never();
      if (err.status === 403 && err.code === 'reauth_required') {
        return confirmPassword().then(function (ok) {
          if (!ok) throw new ApiError(403, 'cancelled', 'Cancelled.');
          return request(method, path, body).catch(function (again) { if (signedOut(again)) return never(); throw again; });
        });
      }
      throw err;
    });
  }

  /**
   * Saves a file the server makes (a spreadsheet). Same checks as AC.api(): sends you to sign-in when the
   * session has ended, and asks for the password when the download is sensitive.
   */
  function download(path, button) {
    function attempt() {
      return fetch(path, { credentials: 'same-origin', cache: 'no-store' }).then(function (res) {
        if (res.ok) {
          var named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
          return res.blob().then(function (blob) {
            lastContact = Date.now();
            var url = URL.createObjectURL(blob), link = el('a', { href: url, download: named ? named[1] : 'download.csv', hidden: true });
            doc.body.appendChild(link); link.click(); link.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
            return named ? named[1] : 'download.csv';
          });
        }
        return res.json().catch(function () { return null; }).then(function (data) {
          var err = (data && data.error) || {};
          throw new ApiError(res.status, err.code || 'server_error', err.message || 'The download failed. Try again.', err.fields);
        });
      }, function () { throw new ApiError(0, 'network', "Couldn't reach TypeCraft. Check your connection and try again."); });
    }
    if (button) busy(button, true);
    var done = function () { if (button) busy(button, false); };
    return attempt().catch(function (err) {
      if (signedOut(err)) return never();
      if (err.status === 403 && err.code === 'reauth_required') {
        return confirmPassword().then(function (ok) {
          if (!ok) throw new ApiError(403, 'cancelled', 'Cancelled.');
          return attempt().catch(function (again) { if (signedOut(again)) return never(); throw again; });
        });
      }
      throw err;
    }).then(function (name) { done(); return name; }, function (err) { done(); throw err; });
  }

  /**
   * A filtered, paged table. The filters are the form's named controls (an empty value means "any"); they are
   * kept in the address bar, so a reload or the Back button brings the same list back.
   * cfg: { endpoint, form, table, body, pager, count, clear, columns, noun: [one, many], empty,
   *        row(item, data) → <tr>, onData(data) }    → { reload(), query() }
   */
  function list(cfg) {
    var controls = Array.prototype.slice.call(cfg.form.querySelectorAll('[name]'));
    var state = {}, page = 1, seq = 0, timer = null;
    function fromAddress() {
      var q = new URLSearchParams(location.search);
      controls.forEach(function (c) { state[c.name] = q.get(c.name) || ''; });
      page = Math.max(1, parseInt(q.get('page'), 10) || 1);
      show();
    }
    // a select may get its options later (plans come with the data): show the state again whenever they change
    function show() {
      controls.forEach(function (c) { if (c.value !== state[c.name]) c.value = state[c.name]; });
      if (cfg.clear) cfg.clear.hidden = !filtered();
    }
    function filtered() { return controls.some(function (c) { return c.name !== 'sort' && state[c.name]; }); }
    function query() {
      var q = new URLSearchParams();
      controls.forEach(function (c) { if (state[c.name]) q.set(c.name, state[c.name]); });
      if (page > 1) q.set('page', String(page));
      return q.toString();
    }
    function toAddress() { var qs = query(); history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); }
    function message(kids) { clear(cfg.body); cfg.body.appendChild(el('tr', null, el('td', { class: 'empty-cell', colspan: cfg.columns }, kids))); }
    function pagerFor(data) {
      clear(cfg.pager);
      cfg.pager.hidden = data.pages <= 1;
      if (data.pages <= 1) return;
      var go = function (to) { return function () { page = to; toAddress(); load(); cfg.table.scrollIntoView({ block: 'nearest' }); }; };
      append(cfg.pager, [
        el('button', { type: 'button', class: 'btn btn-quiet btn-sm', disabled: data.page <= 1, on: { click: go(data.page - 1) } }, [icon('arrowLeft'), el('span', { text: 'Previous' })]),
        el('span', { class: 'pager-where', text: 'Page ' + data.page + ' of ' + data.pages }),
        el('button', { type: 'button', class: 'btn btn-quiet btn-sm', disabled: data.page >= data.pages, on: { click: go(data.page + 1) } }, [el('span', { text: 'Next' }), icon('arrowRight')])
      ]);
    }
    function load() {
      var mine = ++seq, qs = query();
      cfg.table.setAttribute('aria-busy', 'true');
      api('GET', cfg.endpoint + (qs ? '?' + qs : '')).then(function (data) {
        if (mine !== seq) return; // a newer search has been sent since
        if (data.page > data.pages) { page = data.pages; toAddress(); load(); return; }
        if (cfg.onData) cfg.onData(data);
        show();
        clear(cfg.body);
        if (!data.items.length) message(filtered() ? 'Nothing matches. Try fewer filters.' : cfg.empty);
        data.items.forEach(function (item) { cfg.body.appendChild(cfg.row(item, data)); });
        cfg.table.removeAttribute('aria-busy');
        cfg.count.textContent = data.total.toLocaleString('en-IN') + ' ' + (data.total === 1 ? cfg.noun[0] : cfg.noun[1]) + (filtered() ? ' match' + (data.total === 1 ? 'es' : '') : '');
        pagerFor(data);
      }, function (err) {
        if (mine !== seq) return;
        cfg.table.removeAttribute('aria-busy');
        cfg.count.textContent = '';
        cfg.pager.hidden = true;
        message(["Couldn't load the list. " + err.message, el('button', { type: 'button', class: 'btn btn-quiet btn-sm', text: 'Try again', on: { click: load } })]);
      });
    }
    function changed(control, wait) {
      state[control.name] = control.value.trim();
      page = 1;
      if (cfg.clear) cfg.clear.hidden = !filtered();
      clearTimeout(timer);
      timer = setTimeout(function () { toAddress(); load(); }, wait);
    }
    controls.forEach(function (c) {
      if (c.tagName === 'SELECT') c.addEventListener('change', function () { changed(c, 0); });
      else c.addEventListener('input', function () { changed(c, 300); }); // typing: wait for a pause
    });
    cfg.form.addEventListener('submit', function (e) { e.preventDefault(); clearTimeout(timer); toAddress(); load(); });
    if (cfg.clear) cfg.clear.addEventListener('click', function () {
      controls.forEach(function (c) { if (c.name !== 'sort') state[c.name] = ''; });
      page = 1; show(); toAddress(); load();
    });
    window.addEventListener('popstate', function () { fromAddress(); load(); });
    fromAddress();
    load();
    return { reload: load, query: query };
  }

  /* ---------- the frame ---------- */
  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    try { localStorage.setItem('tcConsoleTheme', theme); } catch (e) { /* private mode: the choice lasts for this page */ }
    var toggle = doc.getElementById('themeToggle');
    if (toggle) toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }
  function initFrame() {
    var toggle = doc.getElementById('themeToggle');
    if (toggle) {
      toggle.setAttribute('aria-label', root.getAttribute('data-theme') === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
      toggle.addEventListener('click', function () { setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); });
    }

    // the navigation drawer on narrow screens
    var side = doc.getElementById('side'), scrim = doc.getElementById('scrim');
    var openBtn = doc.getElementById('navOpen'), closeBtn = doc.getElementById('navClose');
    function drawer(open) {
      if (!side) return;
      side.classList.toggle('is-open', open);
      scrim.hidden = !open;
      root.classList.toggle('nav-locked', open);
      openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      (open ? closeBtn : openBtn).focus();
    }
    if (openBtn) openBtn.addEventListener('click', function () { drawer(true); });
    if (closeBtn) closeBtn.addEventListener('click', function () { drawer(false); });
    if (scrim) scrim.addEventListener('click', function () { drawer(false); });

    // which layers are open is remembered in a cookie, so the server draws them right the next time
    var groups = Array.prototype.slice.call(doc.querySelectorAll('.nav-group'));
    groups.forEach(function (group) {
      group.addEventListener('toggle', function () {
        var value = groups.map(function (g) { return g.getAttribute('data-group') + (g.open ? '-open' : '-shut'); }).join('.');
        doc.cookie = 'tc_console_nav=' + value + '; Path=' + base + '; Max-Age=31536000; SameSite=Strict; Secure';
      });
    });

    var userMenu = doc.getElementById('userMenu');
    doc.addEventListener('click', function (e) { if (userMenu && userMenu.open && !userMenu.contains(e.target)) userMenu.open = false; });
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (userMenu && userMenu.open) { userMenu.open = false; userMenu.querySelector('summary').focus(); }
      if (side && side.classList.contains('is-open')) drawer(false);
    });

    Array.prototype.forEach.call(doc.querySelectorAll('[data-sign-out]'), function (button) {
      button.addEventListener('click', function () {
        busy(button, true);
        request('POST', '/api/admin/auth/logout').then(function () { location.assign(base + '/login'); }, function (err) {
          busy(button, false);
          if (!signedOut(err)) toast(err.message, 'bad');
        });
      });
    });

    Array.prototype.forEach.call(doc.querySelectorAll('[data-time]'), function (node) { node.textContent = fmt.dateTime(node.getAttribute('data-time')); });

    // the session: show when it ends, and leave the page when it has (the server decides; this keeps the screen honest)
    if (me && me.session) {
      var ends = new Date(me.session.expiresAt).getTime();
      var idleMs = (me.session.idleMinutes || 30) * 60000;
      var tick = function () {
        var now = Date.now();
        if (now >= ends || now - lastContact >= idleMs) { toLogin(true); return; }
        Array.prototype.forEach.call(doc.querySelectorAll('[data-session-ends]'), function (node) {
          node.textContent = fmt.time(me.session.expiresAt) + ' (' + fmt.until(me.session.expiresAt) + ')';
        });
      };
      tick();
      setInterval(tick, 30000);
    }
  }

  window.AC = {
    base: base, boot: boot, me: me,
    can: function (permission) { return !!(me && me.permissions.indexOf(permission) !== -1); },
    el: el, svg: svg, clear: clear, icon: icon, fmt: fmt, money: money, badge: badge, toast: toast, busy: busy,
    confirm: confirmDialog, formDialog: formDialog, api: api, download: download, list: list, ApiError: ApiError
  };
  if (doc.querySelector('.app')) initFrame();
})();
