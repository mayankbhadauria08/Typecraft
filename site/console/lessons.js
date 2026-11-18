/* Lessons: all 78 in course order, filtered here in the page (the list is short).
   GET /api/console/course/lessons → { items: [{ id, n, title, originalTitle, level, unit, kind, steps, fields, edited, draft }], levels, units, drafts, can } */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var form = byId('filters'), data = null;
  var KIND = { intro: 'Introduction', review: 'Review', words: 'Words', timed: 'Timed test', boss: 'Boss', lesson: 'Lesson' };

  function params() {
    var q = new URLSearchParams(location.search);
    return { q: (q.get('q') || '').trim(), level: q.get('level') || '', state: q.get('state') || '' };
  }
  function setParams(p) {
    var q = new URLSearchParams();
    Object.keys(p).forEach(function (k) { if (p[k]) q.set(k, p[k]); });
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
  }
  function render() {
    var p = params(), body = AC.clear(byId('listBody'));
    form.elements.q.value = p.q; form.elements.level.value = p.level; form.elements.state.value = p.state;
    byId('clearFilters').hidden = !(p.q || p.level || p.state);
    var q = p.q.toLowerCase();
    var rows = data.items.filter(function (l) {
      if (p.level && String(l.level) !== p.level) return false;
      if (p.state === 'edited' && !l.edited) return false;
      if (p.state === 'draft' && !l.draft) return false;
      if (q && String(l.n) !== q && l.title.toLowerCase().indexOf(q) === -1 && l.originalTitle.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var level = function (n) { var L = data.levels.filter(function (x) { return x.n === n; })[0]; return 'Level ' + n + (L ? ': ' + L.name : ''); };
    rows.forEach(function (l) {
      body.appendChild(el('tr', null, [
        el('td', null, [el('a', { class: 'cell-link', href: AC.base + '/course/lessons/' + l.id, text: l.n + '. ' + l.title }),
          l.title !== l.originalTitle ? el('div', { class: 'cell-sub', text: 'Originally: ' + l.originalTitle }) : null,
          el('div', { class: 'cell-sub show-fold', text: level(l.level) })]),
        el('td', { class: 'col-wide', text: level(l.level) }),
        el('td', { class: 'col-wide', text: data.units[l.unit] || l.unit }),
        el('td', { class: 'col-wide' }, [el('span', { text: KIND[l.kind] || 'Lesson' }), el('div', { class: 'cell-sub', text: l.steps.map(function (s) { return AC.course.STEP[s] || s; }).join(', ') })]),
        el('td', { class: 'col-fit' }, AC.course.badges(l))
      ]));
    });
    if (!rows.length) body.appendChild(el('tr', null, el('td', { colspan: 5, class: 'empty-cell', text: 'No lessons match. Clear the filters to see them all.' })));
    byId('listCount').textContent = rows.length === data.items.length ? data.items.length + ' lessons' : rows.length + ' of ' + data.items.length + ' lessons';
    byId('list').removeAttribute('aria-busy');
  }
  function load() {
    AC.api('GET', '/api/console/course/lessons').then(function (d) {
      data = d;
      var sel = form.elements.level;
      d.levels.forEach(function (L) { sel.appendChild(el('option', { value: String(L.n), text: 'Level ' + L.n + ': ' + L.name })); });
      var note = AC.course.draftsNote(d.drafts);
      if (note) byId('filters').parentNode.insertBefore(note, byId('filters'));
      render();
    }, function (err) {
      byId('list').removeAttribute('aria-busy');
      AC.clear(byId('listBody')).appendChild(el('tr', null, el('td', { colspan: 5, class: 'empty-cell', text: err.message })));
    });
  }
  var timer = null;
  form.addEventListener('input', function (e) {
    clearTimeout(timer);
    timer = setTimeout(function () { setParams({ q: form.elements.q.value.trim(), level: form.elements.level.value, state: form.elements.state.value }); render(); }, e.target.name === 'q' ? 200 : 0);
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  byId('clearFilters').addEventListener('click', function () { setParams({}); render(); form.elements.q.focus(); });
  load();
})();
