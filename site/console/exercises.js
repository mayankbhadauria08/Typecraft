/* Exercises: the practice packs, in the order learners see them (docs/ADMIN-PHASE-3.md).
   GET /api/console/course/packs → { items: [{ id, title, description, hidden, added, edited, exercises, original, draft, draftValue }],
                                     drafted: [new packs that exist only as a draft], order: { order: [ids] } | { reset } | null, can }
   PUT /api/console/course/drafts/order:packs { value: { order: [ids] } }; PUT /api/console/course/drafts/pack:<id> { value } (a new pack) */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var data = null;

  function rows() {
    // packs as learners will see them once drafts are published: the draft order, if there is one
    var all = data.items.concat(data.drafted.map(function (p) { return Object.assign({ isNew: true, exercises: p.exercises || [] }, p); }));
    var order = data.order && data.order.order ? data.order.order : null;
    if (!order) return all;
    var by = {}; all.forEach(function (p) { by[p.id] = p; });
    var out = order.filter(function (id) { return by[id]; }).map(function (id) { return by[id]; });
    return out.concat(all.filter(function (p) { return order.indexOf(p.id) === -1; }));
  }
  function move(list, i, step) {
    var ids = list.map(function (p) { return p.id; }), j = i + step;
    var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
    AC.course.saveDraft('order:packs', { order: ids }).then(function () { AC.toast('Draft saved: the new order. Publish it on the Courses page.'); load(); },
      function (err) { if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
  }
  function render(d) {
    data = d;
    var body = AC.clear(byId('listBody')), list = rows();
    list.forEach(function (p, i) {
      var shown = (p.exercises || []).filter(function (x) { return !x.hidden; }).length;
      var where = p.isNew ? 'Not yet: a new pack, still a draft' : p.hidden ? 'Hidden' : shown ? 'Shown' : 'Not shown: no exercises';
      var name = p.title;
      body.appendChild(el('tr', null, [
        el('td', null, [el('a', { class: 'cell-link', href: AC.base + '/course/exercises/' + p.id, text: p.title }),
          p.description ? el('div', { class: 'cell-sub', text: p.description }) : null]),
        el('td', { class: 'num col-wide', text: shown === (p.exercises || []).length ? String(shown) : shown + ' of ' + p.exercises.length }),
        el('td', { class: 'col-wide', text: where }),
        el('td', { class: 'col-fit' }, AC.course.badges(p.isNew ? { draft: 'changed' } : { edited: !!p.edited, draft: p.draft })),
        d.can.edit ? el('td', { class: 'col-act' }, [
          el('button', { type: 'button', class: 'btn-link', text: 'Up', 'aria-label': 'Move ' + name + ' up', disabled: i === 0, on: { click: function () { move(list, i, -1); } } }),
          el('button', { type: 'button', class: 'btn-link btn-link-gap', text: 'Down', 'aria-label': 'Move ' + name + ' down', disabled: i === list.length - 1, on: { click: function () { move(list, i, 1); } } })]) : null
      ]));
    });
    var old = byId('orderNote'); if (old) old.remove();
    if (d.order) {
      var n = AC.notice('The order is a draft: learners see it after it is published on the Courses page.');
      n.id = 'orderNote'; byId('list').parentNode.parentNode.insertBefore(n, byId('list').parentNode);
    }
    byId('list').removeAttribute('aria-busy');
  }
  function load() {
    return AC.api('GET', '/api/console/course/packs').then(render, function (err) {
      byId('list').removeAttribute('aria-busy');
      AC.clear(byId('listBody')).appendChild(el('tr', null, el('td', { colspan: 5, class: 'empty-cell', text: err.message })));
    });
  }
  function slug(text) {
    var s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    if (!/^[a-z]/.test(s)) s = 'pack-' + s;
    s = s.replace(/-+$/, '');
    var taken = rows().map(function (p) { return p.id; }), out = s.length >= 2 ? s : 'pack', n = 2;
    while (taken.indexOf(out) !== -1) out = s + '-' + (n++);
    return out;
  }
  var newBtn = byId('newPack');
  if (newBtn) newBtn.addEventListener('click', function () {
    AC.formDialog({
      title: 'New practice pack', text: 'It starts as a draft with no exercises. Add them on the next page.', submitLabel: 'Create the draft',
      fields: [{ name: 'title', label: 'Title', required: true, maxlength: 60, requiredText: 'Give the pack a title.' },
        { name: 'description', label: 'Description', type: 'textarea', maxlength: 300, hint: 'Shown on the pack’s card in the trainer.' }],
      submit: function (v) {
        var id = slug(v.title);
        return AC.course.saveDraft('pack:' + id, { added: true, title: v.title, description: v.description || '', exercises: [] }).then(function () {
          location.assign(AC.base + '/course/exercises/' + id); return true;
        });
      }
    });
  });
  load();
})();
