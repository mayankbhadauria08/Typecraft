/* One package: create it, or change it.
   GET  /api/console/packages/:id → { package, features: [{ key, label, description }], history | null }
   GET  /api/console/packages     → { items, features }            (a new package needs the features list)
   POST /api/console/packages     { id, name, description, pricePaise, validityDays, features, limits, highlight, active, displayOrder } → { package }
   PUT  /api/console/packages/:id { the same fields, confirmPriceChange? } → { package, changed }
   A price change of more than half is answered 409 confirm_price: the page asks, then sends it again confirmed.
   Lessons (limits.lessons): 'all', 'first5' or { levels, lessons }, chosen with the course from
   /shared/course-meta.js and the words from /shared/lesson-access.js (window.TC_ACCESS), as learners get them.
   The two lesson features follow from it on the server, so they are not ticked here. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var id = (AC.boot.page.params || {}).id || null;
  var form = byId('pkgForm'), canEdit = !form.hasAttribute('data-readonly');
  var current = null;
  var F = function (name) { return form.elements[name]; };
  var META = window.TC_META, ACCESS = window.TC_ACCESS;
  var LESSON_FEATURES = ['lessons.first5', 'lessons.all'];
  var LABELS = { name: 'Name', description: 'Description', pricePaise: 'Price', validityDays: 'Length', features: 'What it includes', limits: 'Limits',
    highlight: 'Recommended', active: 'On sale', displayOrder: 'Place on the plans page' };

  function rupeesText(paise) { return paise % 100 ? (paise / 100).toFixed(2) : String(paise / 100); }
  function paiseOf(text) {
    var t = String(text || '').replace(/[₹,\s]/g, '');
    return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(parseFloat(t) * 100) : NaN;
  }
  function whole(text) { var t = String(text || '').trim(); return /^\d+$/.test(t) ? Number(t) : NaN; }

  /* ---------- errors under the fields ---------- */
  var MAP = { pricePaise: 'price' };
  function showError(name, text) {
    var err = byId('f-' + name + '-err'); if (!err) return false;
    err.textContent = text || ''; err.hidden = !text;
    var input = byId('f-' + name);
    if (input) { if (text) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', err.id); } else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); } }
    return true;
  }
  function clearErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('.err'), function (e) { e.hidden = true; e.textContent = ''; });
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (x) { x.removeAttribute('aria-invalid'); });
    var banner = byId('pkgErr'); if (banner) banner.hidden = true;
  }
  function showErrors(fields) {
    var first = null;
    Object.keys(fields).forEach(function (k) {
      var name = MAP[k] || k;
      if (showError(name, fields[k]) && !first) first = byId('f-' + name) || form.querySelector('[data-field="' + name + '"] input');
      else if (!byId('f-' + name + '-err')) banner(fields[k]);
    });
    if (first) first.focus();
  }
  function banner(text) { var b = byId('pkgErr'); if (!b) return; b.querySelector('span').textContent = text; b.hidden = false; }

  /* ---------- filling the form ---------- */
  function features(list, on) {
    var host = AC.clear(byId('featureList'));
    list.filter(function (f) { return LESSON_FEATURES.indexOf(f.key) === -1; }).forEach(function (f) {
      var box = el('input', { type: 'checkbox', id: 'feat-' + f.key, name: 'features', value: f.key, checked: on.indexOf(f.key) !== -1 });
      host.appendChild(el('label', { class: 'tick', for: 'feat-' + f.key }, [box, el('span', null, [el('span', { class: 'tick-label', text: f.label }), el('span', { class: 'tick-hint', text: f.description })])]));
    });
  }
  function sync() {
    // the "no limit" ticks switch their number off; the Free plan keeps its fixed rules
    F('validityDays').disabled = !canEdit || F('noEnd').checked;
    F('dailyTests').disabled = !canEdit || F('noTestLimit').checked;
    F('historyDays').disabled = !canEdit || F('allHistory').checked;
    if (id === 'free') { F('price').disabled = true; F('noEnd').disabled = true; F('active').disabled = true; F('validityDays').disabled = true; }
  }
  function fill(p, list) {
    current = p;
    F('name').value = p.name;
    if (F('id')) F('id').value = '';
    F('description').value = p.description;
    F('price').value = p.pricePaise ? rupeesText(p.pricePaise) : '0';
    F('validityDays').value = p.validityDays === null ? '' : String(p.validityDays);
    F('noEnd').checked = p.validityDays === null;
    features(list, p.features);
    lessonsFill(p.features.indexOf('lessons.all') !== -1 ? 'all' : p.limits.lessons);
    F('dailyTests').value = p.limits.dailyTests === null || p.limits.dailyTests === undefined ? '' : String(p.limits.dailyTests);
    F('noTestLimit').checked = p.limits.dailyTests === null;
    F('historyDays').value = p.limits.historyDays === null || p.limits.historyDays === undefined ? '' : String(p.limits.historyDays);
    F('allHistory').checked = p.limits.historyDays === null;
    F('active').checked = !!p.active;
    F('highlight').checked = !!p.highlight;
    F('displayOrder').value = String(p.displayOrder);
    if (!canEdit) Array.prototype.forEach.call(form.elements, function (x) { x.disabled = true; });
    sync();
  }
  function note(p) {
    var host = AC.clear(byId('pkgNote'));
    if (!p) return;
    host.appendChild(p.id === 'free'
      ? AC.notice('This is the Free plan. What it includes applies at once to everyone without a paid plan, lessons too. It always costs nothing, never ends and stays on.', 'warn')
      : AC.notice('Changes apply to new purchases. Customers who already bought ' + p.name + ' keep what it gave them when they bought it. '
        + 'Lessons you add here also reach them at once; lessons you take out only change what new buyers get.'));
  }
  function side(d) {
    var p = d.package;
    if (byId('statsBody')) AC.fill('statsBody', AC.facts([
      AC.fact(p.id === 'free' ? 'Customers on Free' : 'Customers who have it now', Number(p.customers).toLocaleString('en-IN')),
      p.sales30 ? AC.fact('Sold in the last 30 days', Number(p.sales30.orders).toLocaleString('en-IN') + (p.sales30.grossPaise !== null ? ' (' + AC.money(p.sales30.grossPaise, p.currency) + ')' : '')) : null,
      AC.idFact('ID', p.id, 'package ID'),
      AC.fact('Last changed', AC.fmt.dateTime(p.updatedAt))
    ]));
    if (byId('historyBody') && d.history) AC.fill('historyBody', AC.timeline(d.history.map(function (h) {
      return { action: h.action, note: h.changed.length ? h.changed.map(function (k) { return LABELS[k] || k; }).join(', ') : null, actor: h.actor, createdAt: h.createdAt };
    }), { 'package.create': 'Created', 'package.update': 'Changed' }, 'No changes recorded yet.'));
  }

  /* ---------- lessons: every lesson, the first five, or chosen levels and lessons ---------- */
  var levelsHost = byId('lessonLevels');
  function lessonsBuild() {
    if (levelsHost.childNodes.length) return;
    META.LEVELS.forEach(function (L) {
      var ids = ACCESS.BY_LEVEL[L.n];
      var whole = el('input', { type: 'checkbox', id: 'lvl-' + L.n, 'data-level': String(L.n) });
      var singles = el('div', { class: 'lesson-singles' }, ids.map(function (lid) {
        var m = META.BY_ID[lid];
        return el('label', { class: 'tick', for: 'les-' + lid }, [el('input', { type: 'checkbox', id: 'les-' + lid, 'data-lesson': lid }),
          el('span', null, el('span', { class: 'tick-label', text: m.n + '. ' + m.title }))]);
      }));
      var more = el('details', { class: 'lesson-more' }, [el('summary', { text: 'Choose single lessons' }), singles]);
      levelsHost.appendChild(el('div', { class: 'lesson-level' }, [
        el('label', { class: 'tick', for: 'lvl-' + L.n }, [whole, el('span', null, [el('span', { class: 'tick-label', text: 'Level ' + L.n + ': ' + L.name }),
          el('span', { class: 'tick-hint', id: 'lvl-' + L.n + '-count', text: ids.length + ' lessons' })])]),
        more]));
    });
    levelsHost.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-level')) {
        // a whole level ticks (and locks) its lessons; unticking it clears them
        ACCESS.BY_LEVEL[t.getAttribute('data-level')].forEach(function (lid) { var x = byId('les-' + lid); x.checked = t.checked; });
      }
      lessonsSync();
    });
    Array.prototype.forEach.call(form.querySelectorAll('input[name="lessonsMode"]'), function (r) { r.addEventListener('change', lessonsSync); });
  }
  function lessonsFill(v) {
    lessonsBuild();
    var mode = v === 'all' ? 'all' : v === 'first5' || !v ? 'first5' : 'pick';
    Array.prototype.forEach.call(form.querySelectorAll('input[name="lessonsMode"]'), function (r) { r.checked = r.value === mode; });
    var set = ACCESS.idsOf(mode === 'pick' ? v : 'first5');
    if (mode !== 'pick') set = [];
    ACCESS.ORDER.forEach(function (lid) { byId('les-' + lid).checked = set.indexOf(lid) !== -1; });
    META.LEVELS.forEach(function (L) { byId('lvl-' + L.n).checked = mode === 'pick' && v.levels && v.levels.indexOf(L.n) !== -1; });
    lessonsSync();
  }
  /** What the form says now: 'all', 'first5', { levels, lessons }, or null when "choose" has nothing chosen. */
  function lessonsValue() {
    var on = form.querySelector('input[name="lessonsMode"]:checked'), mode = on ? on.value : 'first5';
    if (mode !== 'pick') return mode;
    var levels = META.LEVELS.filter(function (L) { return byId('lvl-' + L.n).checked; }).map(function (L) { return L.n; });
    var lessons = ACCESS.ORDER.filter(function (lid) { return byId('les-' + lid).checked && levels.indexOf(META.BY_ID[lid].level) === -1; });
    if (!levels.length && !lessons.length) return null;
    return ACCESS.check({ levels: levels, lessons: lessons }).value;
  }
  function lessonsSync() {
    var on = form.querySelector('input[name="lessonsMode"]:checked'), pick = !!on && on.value === 'pick';
    levelsHost.hidden = !pick;
    META.LEVELS.forEach(function (L) {
      var whole = byId('lvl-' + L.n), ids = ACCESS.BY_LEVEL[L.n];
      var picked = ids.filter(function (lid) { return byId('les-' + lid).checked; }).length;
      // a level with all its lessons ticked one by one counts as the whole level
      if (!whole.checked && picked === ids.length) whole.checked = true;
      ids.forEach(function (lid) { byId('les-' + lid).disabled = !canEdit || whole.checked; });
      whole.disabled = !canEdit;
      byId('lvl-' + L.n + '-count').textContent = whole.checked ? 'All ' + ids.length + ' lessons' : picked ? picked + ' of ' + ids.length + ' lessons' : ids.length + ' lessons';
    });
    var v = lessonsValue(), err = byId('f-lessons-err');
    // the description is written by hand: once the lessons change, say so next to it
    var saved = current ? (current.features.indexOf('lessons.all') !== -1 ? 'all' : current.limits.lessons) : null;
    byId('lessonDescHint').hidden = !current || !current.id || JSON.stringify(v) === JSON.stringify(saved);
    byId('lessonSummary').textContent = v === null ? 'Nothing chosen yet.' : 'Includes ' + ACCESS.describe(v).text + ', plus the placement test and the review drill.';
    if (v !== null && !err.hidden) { err.hidden = true; err.textContent = ''; }
  }

  /* ---------- saving ---------- */
  function collect() {
    var fields = {}, body = {};
    body.name = F('name').value;
    body.description = F('description').value;
    if (id !== 'free') {
      var price = paiseOf(F('price').value);
      if (isNaN(price)) fields.price = 'Enter the price in rupees, like 199 or 99.50.'; else body.pricePaise = price;
      if (F('noEnd').checked) body.validityDays = null;
      else { var v = whole(F('validityDays').value); if (isNaN(v)) fields.validityDays = 'Enter the length in whole days, or tick No end date.'; else body.validityDays = v; }
      body.active = F('active').checked;
    }
    body.features = Array.prototype.filter.call(form.querySelectorAll('input[name="features"]'), function (x) { return x.checked; }).map(function (x) { return x.value; });
    var tests = F('noTestLimit').checked ? null : whole(F('dailyTests').value);
    var history = F('allHistory').checked ? null : whole(F('historyDays').value);
    if (Number.isNaN(tests)) fields.dailyTests = 'Enter a whole number, or tick No daily limit.';
    if (Number.isNaN(history)) fields.historyDays = 'Enter a whole number of days, or tick All history.';
    var lessons = lessonsValue();
    if (lessons === null) fields.lessons = 'Choose at least one level or lesson, or another option.';
    body.limits = { lessons: lessons, dailyTests: tests, historyDays: history };
    body.highlight = F('highlight').checked;
    var order = whole(F('displayOrder').value);
    if (isNaN(order)) fields.displayOrder = 'Enter a whole number.'; else body.displayOrder = order;
    if (F('id')) body.id = F('id').value.trim();
    return { body: body, fields: fields };
  }
  function save(body) {
    var button = byId('pkgSave');
    AC.busy(button, true);
    var call = id ? AC.api('PUT', '/api/console/packages/' + encodeURIComponent(id), body) : AC.api('POST', '/api/console/packages', body);
    return call.then(function (r) {
      AC.busy(button, false);
      if (!id) { location.assign(AC.base + '/packages/' + encodeURIComponent(r.package.id) + '?created=1'); return; }
      AC.toast(r.changed && r.changed.length ? 'Saved: ' + r.changed.map(function (k) { return (LABELS[k] || k).toLowerCase(); }).join(', ') + '.' : 'Nothing had changed.');
      load();
    }, function (err) {
      AC.busy(button, false);
      if (err.code === 'cancelled') return;
      if (err.code === 'confirm_price') {
        var before = AC.money(current.pricePaise), after = AC.money(body.pricePaise);
        return AC.confirm({ title: 'Change the price from ' + before + ' to ' + after + '?', text: 'That is a change of more than half. New purchases pay ' + after
          + '; customers who already bought keep what they paid for.', confirmLabel: 'Change the price' }).then(function (ok) {
          if (ok) return save(Object.assign({}, body, { confirmPriceChange: true }));
          F('price').focus();
        });
      }
      if (err.fields) showErrors(err.fields); else banner(err.message);
    });
  }
  if (canEdit) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearErrors();
      var c = collect();
      if (Object.keys(c.fields).length) { showErrors(c.fields); return; }
      save(c.body);
    });
    ['noEnd', 'noTestLimit', 'allHistory'].forEach(function (n) { F(n).addEventListener('change', sync); });
    form.addEventListener('input', function (e) { if (e.target.name && byId('f-' + e.target.name + '-err')) showError(e.target.name, ''); });
  }

  /* ---------- loading ---------- */
  function ready() { byId('recMissing').hidden = true; var page = byId('pkgPage'); page.hidden = false; page.removeAttribute('aria-busy'); }
  function missing(title, text, retry) {
    byId('pkgPage').hidden = true;
    byId('recMissingTitle').textContent = title; byId('recMissingText').textContent = text;
    var box = byId('recMissing'), old = box.querySelector('[data-retry]'); if (old) old.remove();
    if (retry) box.appendChild(el('button', { type: 'button', class: 'btn btn-quiet', 'data-retry': true, text: 'Try again', on: { click: load } }));
    box.hidden = false;
  }
  function load() {
    if (!id) {
      return AC.api('GET', '/api/console/packages').then(function (d) {
        ready();
        fill({ id: null, name: '', description: '', pricePaise: 0, validityDays: 30, features: [], limits: { lessons: 'first5', dailyTests: 3, historyDays: 7 },
          highlight: false, active: false, displayOrder: (d.items.reduce(function (m, p) { return Math.max(m, p.displayOrder); }, 0) || 0) + 1 }, d.features);
        F('price').value = '';
        F('name').focus();
      }, function (err) { missing("Couldn't load this page", err.message, true); });
    }
    return AC.api('GET', '/api/console/packages/' + encodeURIComponent(id)).then(function (d) {
      ready();
      var p = d.package;
      doc.title = p.name + ' – TypeCraft Admin';
      var crumb = doc.querySelector('.crumb.is-here'); if (crumb) crumb.textContent = p.name;
      byId('pkgTitle').textContent = p.name;
      var sub = AC.clear(byId('pkgSub'));
      sub.appendChild(doc.createTextNode((p.pricePaise ? AC.money(p.pricePaise, p.currency) : 'Free') + ', ' + (p.validityDays === null ? 'no end date' : p.validityDays + ' days') + ' '));
      sub.appendChild(p.active ? AC.badge('On sale', 'ok') : AC.badge('Off sale'));
      if (p.highlight) { sub.appendChild(doc.createTextNode(' ')); sub.appendChild(AC.badge('Recommended', 'role')); }
      note(p); fill(p, d.features); side(d);
      if (/[?&]created=1/.test(location.search)) { AC.toast(p.name + ' created. It is off sale until you tick On sale.'); history.replaceState(null, '', location.pathname); }
    }, function (err) {
      if (err.status === 404) missing('Package not found', 'There is no package with this ID.', false);
      else missing("Couldn't load this package", err.message, true);
    });
  }
  load();
})();
