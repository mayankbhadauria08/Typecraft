/* TypeCraft admin console: what every page shares (window.AC).
   - AC.api(): talks to /api/admin, sends you to sign-in when the session has ended, and asks
     for your password when a sensitive action needs it confirmed.
   - AC.el(), AC.icon(), AC.toast(), AC.confirm(), AC.fmt: small building blocks.
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

  /* ---------- dates ---------- */
  var fmt = {
    dateTime: function (iso) {
      var d = new Date(iso);
      if (!iso || isNaN(d)) return '–';
      return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
    },
    time: function (iso) {
      var d = new Date(iso);
      if (!iso || isNaN(d)) return '–';
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
    },
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
      return fmt.dateTime(iso);
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
    el: el, clear: clear, icon: icon, fmt: fmt, toast: toast, confirm: confirmDialog, busy: busy, api: api, ApiError: ApiError
  };
  if (doc.querySelector('.app')) initFrame();
})();
