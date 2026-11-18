/* Courses: what learners have now, the drafts waiting, publishing, and every version (docs/ADMIN-PHASE-3.md).
   GET  /api/console/course → { version, publishedAt, drafts: [{ item, name, reset, updatedAt, by }], versions: [{ version, note, changed, at, by }],
                               levels, units, can: { edit, publish, audit } }
   POST /api/console/course/publish { note, drafts: [{ item, updatedAt }] } → { version, publishedAt, items }
   GET  /api/console/course/versions/:v → { version, note, at, by, items: [{ item, name }] }
   POST /api/console/course/versions/:v/restore { note } → { version, publishedAt, items }
   DELETE /api/console/course/drafts/:item
   Publishing asks for the password again (course.publish is sensitive): AC.api asks, then sends again. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var data = null, form = byId('publishForm');

  /** Where an item is changed. */
  function hrefOf(item) {
    var kind = item.split(':')[0], key = item.split(':')[1];
    if (kind === 'lesson') return AC.base + '/course/lessons/' + key;
    if (kind === 'level') return AC.base + '/course/levels';
    if (kind === 'unit') return AC.base + '/course/modules';
    if (kind === 'pack') return AC.base + '/course/exercises/' + key;
    return AC.base + '/course/exercises';
  }
  function live(d) {
    AC.fill('liveBody', d.version
      ? [el('p', null, [el('strong', { text: 'Version ' + d.version }), ', published ' + AC.fmt.dateTime(d.publishedAt) + '.']),
        el('p', { class: 'hint', text: 'Learners get it the next time their trainer checks, within a few minutes, and never in the middle of a lesson.' })]
      : [el('p', { text: 'The original course: nothing has been published yet.' })]);
  }
  function drafts(d) {
    byId('draftsMeta').textContent = d.drafts.length ? d.drafts.length + (d.drafts.length === 1 ? ' draft' : ' drafts') : '';
    if (!d.drafts.length) {
      AC.fill('draftsBody', AC.quiet('No drafts. Change a lesson, level, module or practice pack, and it waits here until it is published.'));
      if (form) form.hidden = true;
      return;
    }
    var heads = [['What'], ['Saved by', 'col-wide'], ['When', 'col-wide']];
    if (d.can.edit) heads.push(['', 'col-act']);
    AC.fill('draftsBody', AC.table(heads, d.drafts.map(function (x) {
      return el('tr', null, [
        el('td', null, [el('a', { class: 'cell-link', href: hrefOf(x.item), text: x.name }), x.reset ? el('div', { class: 'cell-sub', text: 'Back to the original' }) : null,
          el('div', { class: 'cell-sub show-fold', text: x.by + ', ' + AC.fmt.dateTime(x.updatedAt) })]),
        el('td', { class: 'col-wide', text: x.by }), el('td', { class: 'col-wide', text: AC.fmt.dateTime(x.updatedAt) }),
        d.can.edit ? el('td', { class: 'col-act' }, el('button', { type: 'button', class: 'btn-link', text: 'Discard', 'aria-label': 'Discard the draft for ' + x.name, on: { click: function () { discard(x); } } })) : null
      ]);
    }), true));
    if (form) {
      form.hidden = false;
      byId('publishBtn').textContent = 'Publish ' + d.drafts.length + (d.drafts.length === 1 ? ' draft' : ' drafts');
    }
  }
  function versions(d) {
    if (!d.versions.length) { AC.fill('versionsBody', AC.quiet('No versions yet. The first one is made when drafts are published.')); return; }
    var heads = [['Version'], ['What changed'], ['Published by', 'col-wide'], ['', 'col-act']];
    AC.fill('versionsBody', AC.table(heads, d.versions.map(function (v) {
      var isLive = v.version === d.version;
      return el('tr', null, [
        el('td', null, [el('span', { class: 'cell-main', text: 'Version ' + v.version }), isLive ? el('div', null, AC.badge('Live', 'ok')) : null]),
        el('td', { class: 'cell-wrap' }, [el('span', { text: v.note || '–' }), el('div', { class: 'cell-sub', text: v.changed + (v.changed === 1 ? ' change' : ' changes') })]),
        el('td', { class: 'col-wide' }, [el('span', { class: 'cell-main', text: v.by }), el('div', { class: 'cell-sub', text: AC.fmt.dateTime(v.at) })]),
        el('td', { class: 'col-act' }, [el('button', { type: 'button', class: 'btn-link', text: 'What changed', 'aria-label': 'What changed in version ' + v.version, on: { click: function () { show(v.version); } } }),
          d.can.publish && !isLive ? el('button', { type: 'button', class: 'btn-link btn-link-gap', text: 'Go back to this', 'aria-label': 'Go back to version ' + v.version, on: { click: function () { restore(v); } } }) : null])
      ]);
    })));
  }
  function course(d) {
    AC.fill('courseBody', AC.facts([
      AC.fact('Levels', el('a', { href: AC.base + '/course/levels', text: d.levels.length + ' levels' })),
      AC.fact('Modules', el('a', { href: AC.base + '/course/modules', text: d.units.length + ' modules' })),
      AC.fact('Lessons', el('a', { href: AC.base + '/course/lessons', text: d.levels.reduce(function (s, L) { return s + L.lessons; }, 0) + ' lessons' })),
      AC.fact('Practice packs', el('a', { href: AC.base + '/course/exercises', text: 'Exercises' }))
    ]));
  }
  function render(d) {
    data = d;
    var note = AC.clear(byId('courseNote'));
    if (d.drafts.length && !d.can.publish) note.appendChild(AC.notice('Drafts are published by someone with the "Publish course changes" permission (a Super Admin by default).'));
    live(d); drafts(d); versions(d); course(d);
  }
  function load() { return AC.api('GET', '/api/console/course').then(render, function (err) { AC.clear(byId('courseNote')).appendChild(AC.notice(err.message, 'warn')); }); }

  function discard(x) {
    AC.confirm({ title: 'Discard this draft?', text: x.name + ' stays as learners have it now.', confirmLabel: 'Discard draft', danger: true }).then(function (ok) {
      if (!ok) return;
      AC.course.discard(x.item).then(function () { AC.toast('Draft discarded.'); load(); }, function (err) { if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
    });
  }
  function show(v) {
    AC.api('GET', '/api/console/course/versions/' + v).then(function (r) {
      AC.formDialog({ title: 'Version ' + r.version, text: (r.note ? r.note + ' — ' : '') + r.by + ', ' + AC.fmt.dateTime(r.at) + '.',
        fields: [], submitLabel: 'Close',
        submit: function () { return true; } });
      // a dialog to read, not to answer: one button
      var cancel = doc.querySelector('dialog[open] .dialog-actions .btn-quiet'); if (cancel) cancel.hidden = true;
      var body = doc.querySelector('dialog[open] .dialog-body');
      if (body) body.appendChild(r.items.length ? el('ul', { class: 'plain-list' }, r.items.map(function (x) { return el('li', { text: x.name }); }))
        : AC.quiet('Nothing changed from the version before.'));
    }, function (err) { AC.toast(err.message, 'bad'); });
  }
  function restore(v) {
    AC.formDialog({
      title: 'Go back to version ' + v.version + '?',
      text: 'This publishes a new version with the course exactly as it was in version ' + v.version + '. Drafts stay as they are. Nothing is lost: the current version stays in the history.',
      submitLabel: 'Publish version ' + v.version + ' again',
      fields: [{ name: 'note', label: 'Why', type: 'textarea', required: true, maxlength: 300, requiredText: 'Say in a few words why.', value: 'Back to version ' + v.version }],
      submit: function (values) {
        return AC.api('POST', '/api/console/course/versions/' + v.version + '/restore', { note: values.note }).then(function (r) {
          AC.toast('Published version ' + r.version + ': the course as it was in version ' + v.version + '.'); load(); return true;
        }, function (err) { if (err.code === 'course_changed') load(); throw err; });
      }
    });
  }
  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    var box = form.elements.note, err = byId('f-note-err'), button = byId('publishBtn');
    err.hidden = true; box.removeAttribute('aria-invalid');
    if (box.value.trim().length < 3) { err.textContent = 'Say in a few words what changed.'; err.hidden = false; box.setAttribute('aria-invalid', 'true'); box.focus(); return; }
    var sent = data.drafts.map(function (x) { return { item: x.item, updatedAt: x.updatedAt }; });
    AC.busy(button, true);
    AC.api('POST', '/api/console/course/publish', { note: box.value.trim(), drafts: sent }).then(function (r) {
      AC.busy(button, false); box.value = '';
      AC.toast('Published version ' + r.version + '. Learners get it within a few minutes.'); load();
    }, function (e2) {
      AC.busy(button, false);
      if (e2.code === 'cancelled') return;
      if (e2.code === 'drafts_changed' || e2.code === 'course_changed') load();
      if (e2.fields && e2.fields.note) { err.textContent = e2.fields.note; err.hidden = false; box.focus(); return; }
      AC.toast(e2.message, 'bad');
    });
  });
  load();
})();
