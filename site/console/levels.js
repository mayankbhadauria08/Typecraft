/* Levels and Modules: names (and a level's short description), saved as drafts (docs/ADMIN-PHASE-3.md).
   One script for both pages: AC.boot.page.key is 'levels' or 'course-modules'.
   GET /api/console/course → { levels: [{ n, original: { name, sub }, published, draftValue, draft (state), edited, draftAt, draftBy, target, lessons }],
                               units: [{ id, original: { name }, published, draftValue, draft, edited, levels, lessons }], drafts, can }
   PUT /api/console/course/drafts/level:<n> | unit:<id> { value }; DELETE the same to discard. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var levelsPage = AC.boot.page.key === 'levels', data = null;

  function now(x, withDraft) {
    var src = withDraft && x.draftValue ? (x.draftValue.reset ? {} : x.draftValue) : (x.published || {}), out = {};
    Object.keys(x.original).forEach(function (k) { out[k] = src[k] || x.original[k]; });
    return out;
  }
  function edit(x, item, name) {
    var v = now(x, true), fields = [{ name: 'name', label: 'Name', value: v.name, required: true, maxlength: levelsPage ? 30 : 40, requiredText: 'Give it a name.',
      hint: 'Originally: ' + x.original.name }];
    if (levelsPage) fields.push({ name: 'sub', label: 'Short description', value: v.sub, maxlength: 80, hint: 'Originally: ' + x.original.sub });
    AC.formDialog({
      title: 'Change ' + name, text: 'This saves a draft. Learners see it after it is published on the Courses page.', submitLabel: 'Save draft', fields: fields,
      submit: function (values) {
        var value = {};
        Object.keys(x.original).forEach(function (k) { if (values[k] && values[k] !== x.original[k]) value[k] = values[k]; });
        if (!Object.keys(value).length) {
          if (!x.edited) return x.draft ? AC.course.discard(item).then(done('Back to the original: draft discarded.')) : Promise.resolve(true).then(done('Nothing has changed from the original.'));
          value = { reset: true };
        }
        return AC.course.saveDraft(item, value).then(done('Draft saved. Publish it on the Courses page when it is ready.'));
      }
    });
  }
  function done(message) { return function () { AC.toast(message); load(); return true; }; }
  function discard(item) {
    AC.course.discard(item).then(done('Draft discarded.'), function (err) { if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
  }
  function nameCell(x, title) {
    var cur = now(x, false), drafted = x.draft ? now(x, true) : null;
    return el('td', null, [el('span', { class: 'cell-main', text: title(cur) }),
      x.edited ? el('div', { class: 'cell-sub', text: 'Originally: ' + x.original.name }) : null,
      drafted && drafted.name !== cur.name ? el('div', { class: 'cell-sub', text: 'Draft: ' + drafted.name }) : null]);
  }
  function actions(x, item, name) {
    if (!data.can.edit) return null;
    return el('td', { class: 'col-act' }, [el('button', { type: 'button', class: 'btn-link', text: 'Change', 'aria-label': 'Change ' + name, on: { click: function () { edit(x, item, name); } } }),
      x.draft ? el('button', { type: 'button', class: 'btn-link btn-link-gap', text: 'Discard draft', 'aria-label': 'Discard the draft for ' + name, on: { click: function () { discard(item); } } }) : null]);
  }
  function render(d) {
    data = d;
    var body = AC.clear(byId('listBody')), note = byId('draftsNote');
    if (note) note.remove();
    var n = AC.course.draftsNote(d.drafts.length);
    if (n) { n.id = 'draftsNote'; byId('list').parentNode.parentNode.insertBefore(n, byId('list').parentNode); }
    if (levelsPage) {
      d.levels.forEach(function (L) {
        var name = 'Level ' + L.n, cur = now(L, false), drafted = L.draft ? now(L, true) : null;
        body.appendChild(el('tr', null, [nameCell(L, function (v) { return 'Level ' + L.n + ': ' + v.name; }),
          el('td', { class: 'col-wide' }, [el('span', { text: cur.sub }), drafted && drafted.sub !== cur.sub ? el('div', { class: 'cell-sub', text: 'Draft: ' + drafted.sub }) : null]),
          el('td', { class: 'num col-wide', text: String(L.lessons) }), el('td', { class: 'num col-wide', text: L.target + ' wpm' }),
          el('td', { class: 'col-fit' }, AC.course.badges(L)), actions(L, 'level:' + L.n, name)]));
      });
    } else {
      d.units.forEach(function (u) {
        var name = now(u, false).name;
        body.appendChild(el('tr', null, [nameCell(u, function (v) { return v.name; }),
          el('td', { class: 'col-wide', text: u.levels.map(function (n) { return 'Level ' + n; }).join(', ') }),
          el('td', { class: 'num col-wide', text: String(u.lessons) }),
          el('td', { class: 'col-fit' }, AC.course.badges(u)), actions(u, 'unit:' + u.id, 'the module ' + name)]));
      });
    }
    byId('list').removeAttribute('aria-busy');
  }
  function load() {
    return AC.api('GET', '/api/console/course').then(render, function (err) {
      byId('list').removeAttribute('aria-busy');
      AC.clear(byId('listBody')).appendChild(el('tr', null, el('td', { colspan: 6, class: 'empty-cell', text: err.message })));
    });
  }
  load();
})();
