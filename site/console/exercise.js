/* One practice pack: its title, description and exercises, saved as a draft (docs/ADMIN-PHASE-3.md).
   GET    /api/console/course/packs/:id → { pack (live, hidden parts included) | null, original | null, draftValue, draft, edited, added, published, limits, can }
   PUT    /api/console/course/drafts/pack:<id> { value: { added?, title, description, hidden, exercises: [{ id, title, text, hidden }] } | { reset: true } }
   DELETE /api/console/course/drafts/pack:<id>
   Checked as it is typed with window.TC_EDITS (shared/course-edits.js), the same checks the server runs. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document, E = window.TC_EDITS;
  var byId = function (id) { return doc.getElementById(id); };
  var id = (AC.boot.page.params || {}).id, item = 'pack:' + id;
  var form = byId('packForm'), canEdit = !form.hasAttribute('data-readonly'), list = byId('exercises');
  var data = null, timer = null;

  /* ---------- the exercises, as rows of the form ---------- */
  function slug(text) {
    var s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
    if (!/^[a-z]/.test(s)) s = 'ex-' + s;
    if (s.length < 2) s = 'exercise';
    var taken = Array.prototype.map.call(list.children, function (li) { return li.getAttribute('data-id'); }), out = s, n = 2;
    while (taken.indexOf(out) !== -1) out = s + '-' + (n++);
    return out;
  }
  function row(x) {
    var n = list.children.length + 1, uid = 'ex' + Math.random().toString(36).slice(2, 8);
    var title = el('input', { type: 'text', id: uid + '-t', maxlength: 80, autocomplete: 'off', value: x.title || '', readonly: !canEdit, 'data-part': 'title' });
    var text = el('textarea', { id: uid + '-x', rows: 5, spellcheck: 'false', readonly: !canEdit, 'data-part': 'text' });
    text.value = x.text || '';
    var hidden = el('input', { type: 'checkbox', id: uid + '-h', checked: !!x.hidden, disabled: !canEdit, 'data-part': 'hidden' });
    var count = el('span', { class: 'char-count', 'aria-live': 'polite' });
    var li = el('li', { class: 'exercise', 'data-id': x.id || '' }, [
      el('div', { class: 'exercise-head' }, [el('span', { class: 'exercise-n', text: String(n) }),
        el('div', { class: 'field exercise-title' }, [el('label', { for: uid + '-t', text: 'Title' }), title]),
        canEdit ? el('div', { class: 'exercise-tools' }, [
          el('button', { type: 'button', class: 'btn-link', text: 'Up', 'data-move': '-1' }),
          el('button', { type: 'button', class: 'btn-link btn-link-gap', text: 'Down', 'data-move': '1' }),
          el('button', { type: 'button', class: 'btn-link btn-link-danger btn-link-gap', text: 'Remove', 'data-remove': '1' })]) : null]),
      el('div', { class: 'field' }, [el('label', { for: uid + '-x', text: 'Text' }), text, el('div', { class: 'exercise-foot' }, [
        el('label', { class: 'tick tick-inline', for: uid + '-h' }, [hidden, el('span', { class: 'tick-label', text: 'Hide this exercise' })]), count])]),
      el('p', { class: 'err', hidden: true, 'data-err': '1' })
    ]);
    return li;
  }
  function renumber() {
    Array.prototype.forEach.call(list.children, function (li, i) {
      li.querySelector('.exercise-n').textContent = String(i + 1);
      var t = li.querySelector('[data-part="title"]').value.trim() || 'exercise ' + (i + 1);
      li.querySelectorAll('[data-move], [data-remove]').forEach(function (b) {
        var what = b.hasAttribute('data-remove') ? 'Remove ' : b.getAttribute('data-move') === '-1' ? 'Move up ' : 'Move down ';
        b.setAttribute('aria-label', what + t);
        if (b.hasAttribute('data-move')) b.disabled = (b.getAttribute('data-move') === '-1' && i === 0) || (b.getAttribute('data-move') === '1' && i === list.children.length - 1);
      });
      var text = li.querySelector('[data-part="text"]');
      li.querySelector('.char-count').textContent = text.value.length.toLocaleString('en-IN') + ' / ' + data.limits.text.toLocaleString('en-IN');
    });
    byId('exMeta').textContent = list.children.length + (list.children.length === 1 ? ' exercise' : ' exercises');
  }

  /* ---------- reading and checking ---------- */
  function value() {
    var v = { title: form.elements.title.value.trim(), description: form.elements.description.value.trim(), hidden: form.elements.hidden.checked,
      exercises: Array.prototype.map.call(list.children, function (li) {
        var t = li.querySelector('[data-part="title"]').value.trim();
        if (!li.getAttribute('data-id')) li.setAttribute('data-id', slug(t || 'exercise'));
        return { id: li.getAttribute('data-id'), title: t, text: li.querySelector('[data-part="text"]').value.replace(/\r\n?/g, '\n').trim(), hidden: li.querySelector('[data-part="hidden"]').checked };
      }) };
    if (data.added) v.added = true;
    return v;
  }
  function showError(name, text) {
    var err = byId('f-' + name + '-err'); if (!err) return;
    err.textContent = text || ''; err.hidden = !text;
    var input = form.elements[name]; if (input && input.setAttribute) { if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  }
  function check() {
    var v = value(), packs = {}; packs[id] = v;
    var r = E.check({ packs: packs }), first = null;
    ['title', 'description', 'exercises'].forEach(function (f) { showError(f, ''); });
    Array.prototype.forEach.call(list.children, function (li) { var e = li.querySelector('[data-err]'); e.hidden = true; e.textContent = ''; li.classList.remove('has-error'); });
    r.errors.forEach(function (e) {
      var m = /^exercises\.(\d+)/.exec(e.field || '');
      if (m && list.children[Number(m[1])]) {
        var li = list.children[Number(m[1])], box = li.querySelector('[data-err]');
        box.textContent = e.message; box.hidden = false; li.classList.add('has-error');
        if (!first) first = li.querySelector(/title/.test(e.field) ? '[data-part="title"]' : '[data-part="text"]');
      } else { showError(e.field && /^(title|description)$/.test(e.field) ? e.field : 'exercises', e.message); if (!first) first = form.elements[e.field] || null; }
    });
    renumber(); about(v);
    return { ok: r.ok, first: first, value: v };
  }
  var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  function asOriginal(o) { return { title: o.title, description: o.description, hidden: false, exercises: o.exercises.map(function (x) { return { id: x.id, title: x.title, text: x.text, hidden: false }; }) }; }

  /* ---------- the page ---------- */
  function render(d) {
    data = d;
    var cur = d.draftValue && !d.draftValue.reset ? d.draftValue : (d.pack || d.original || d.draftValue);
    AC.head({ title: cur.title, crumb: cur.title, sub: d.added ? (d.published ? 'A pack added in the console' : 'A new pack: it is a draft until it is published') : 'One of the original packs',
      badges: [AC.course.badges({ edited: !!(d.pack && d.pack.edited && d.published), draft: d.draft })] });
    var note = AC.clear(byId('recNote'));
    if (d.draft) note.appendChild(AC.notice((d.draft === 'reset' ? (d.added ? 'A draft removes this pack. ' : 'A draft takes this pack back to the original. ') : 'This pack has a draft. ') +
      'Saved by ' + d.draftBy + ', ' + AC.fmt.dateTime(d.draftAt) + '. Learners see it after it is published on the Courses page.'));
    form.elements.title.value = cur.title; form.elements.description.value = cur.description || ''; form.elements.hidden.checked = !!cur.hidden;
    AC.clear(list);
    (cur.exercises || []).forEach(function (x) { list.appendChild(row(x)); });
    renumber();
    if (canEdit) {
      byId('discardDraft').hidden = !d.draft;
      byId('toOriginal').hidden = d.added || !d.edited || d.draft === 'reset';
      byId('removePack').hidden = !d.added || d.draft === 'reset';
      byId('addExercise').disabled = list.children.length >= d.limits.exercises;
    }
    about(cur);
  }
  function about(cur) {
    var exs = cur.exercises || [];
    AC.fill('aboutBody', AC.facts([
      AC.fact('Exercises', exs.length + ' (' + exs.filter(function (x) { return !x.hidden; }).length + ' shown)'),
      AC.fact('Characters to type', exs.reduce(function (s, x) { return s + (x.hidden ? 0 : x.text.length); }, 0).toLocaleString('en-IN')),
      AC.fact('In the trainer', cur.hidden ? 'Hidden' : 'For plans with practice packs'),
      AC.idFact('ID', id, 'pack ID')
    ]));
  }
  var rec = AC.record({ endpoint: '/api/console/course/packs/' + encodeURIComponent(id), notFound: ['Pack not found', 'There is no practice pack with this ID.'], render: render });

  form.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(check, 250); });
  form.addEventListener('change', function () { clearTimeout(timer); timer = setTimeout(check, 50); });
  if (canEdit) {
    list.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var li = b.closest('li');
      if (b.hasAttribute('data-remove')) { li.remove(); byId('addExercise').disabled = false; check(); return; }
      var step = Number(b.getAttribute('data-move'));
      if (step < 0 && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
      if (step > 0 && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
      check(); b.focus();
    });
    byId('addExercise').addEventListener('click', function () {
      var li = row({ title: '', text: '' }); list.appendChild(li); renumber();
      byId('addExercise').disabled = list.children.length >= data.limits.exercises;
      li.querySelector('[data-part="title"]').focus();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var c = check();
      if (!c.ok) { if (c.first) c.first.focus(); return; }
      var v = c.value, button = byId('saveDraft');
      if (!data.added && data.original && same(v, asOriginal(data.original))) {
        if (!data.edited) { AC.toast(data.draft ? 'This is the original: discard the draft to keep it so.' : 'Nothing has changed from the original.', 'info'); return; }
        v = { reset: true };
      }
      AC.busy(button, true);
      AC.course.saveDraft(item, v).then(function () { AC.busy(button, false); AC.toast('Draft saved. Publish it on the Courses page when it is ready.'); rec.load(); },
        function (err) {
          AC.busy(button, false);
          if (err.code === 'cancelled') return;
          if (err.fields) { var k = Object.keys(err.fields)[0]; showError(/^(title|description)$/.test(k) ? k : 'exercises', err.fields[k]); }
          else AC.toast(err.message, 'bad');
        });
    });
    byId('discardDraft').addEventListener('click', function () {
      AC.confirm({ title: 'Discard this draft?', text: data.published ? 'The pack stays as learners have it now.' : 'This new pack has not been published, so it is removed.', confirmLabel: 'Discard draft', danger: true }).then(function (ok) {
        if (!ok) return;
        AC.course.discard(item).then(function () { AC.toast('Draft discarded.'); if (data.published) rec.load(); else location.assign(AC.base + '/course/exercises'); },
          function (err) { if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
      });
    });
    byId('toOriginal').addEventListener('click', function () {
      AC.confirm({ title: 'Take this pack back to the original?', text: 'This saves a draft. Learners keep the current pack until it is published.', confirmLabel: 'Save the draft' }).then(function (ok) {
        if (!ok) return;
        AC.course.saveDraft(item, { reset: true }).then(function () { AC.toast('Draft saved: back to the original.'); rec.load(); }, function (err) { if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
      });
    });
    byId('removePack').addEventListener('click', function () {
      if (!data.published) { byId('discardDraft').click(); return; }
      AC.confirm({ title: 'Remove this pack?', text: 'This saves a draft. The pack leaves the trainer when the draft is published; earlier versions keep it, so it can come back.', confirmLabel: 'Save the draft', danger: true }).then(function (ok) {
        if (!ok) return;
        AC.course.saveDraft(item, { reset: true }).then(function () { AC.toast('Draft saved: the pack is removed when it is published.'); rec.load(); }, function (err) { if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
      });
    });
  }
})();
