/* One lesson: its title, tip and texts, saved as a draft (docs/ADMIN-PHASE-3.md).
   GET    /api/console/course/lessons/:id → { lesson: { id, n, level, unit, kind, steps, fields, allowed, shift, ownWords, newKeys,
            original, published, draftValue, draft: null | 'changed' | 'reset', edited, draftAt, draftBy, prev, next }, levelName, unitName, can }
   PUT    /api/console/course/drafts/lesson:<id> { value }: the fields that differ from the original ({ reset: true }: the original)
   DELETE /api/console/course/drafts/lesson:<id>
   The course itself is loaded on this page (window.TC_COURSE, TC_EDITS), so the checks and the preview are
   the ones learners get. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document, E = window.TC_EDITS, C = window.TC_COURSE;
  var byId = function (id) { return doc.getElementById(id); };
  var id = (AC.boot.page.params || {}).id;
  var item = 'lesson:' + id, form = byId('lessonForm'), canEdit = !form.hasAttribute('data-readonly');
  var data = null, timer = null;
  var KIND = { intro: 'Introduction', review: 'Review', words: 'Words', timed: 'Timed test', boss: 'Boss', lesson: 'Lesson' };
  var FIELDS = ['title', 'tip', 'keys', 'words', 'sentences'];

  /* ---------- reading and writing the form ---------- */
  var toText = function (f, v) { return f === 'words' || f === 'sentences' ? (v || []).join('\n') : (v || ''); };
  function fromForm(f) {
    var raw = form.elements[f].value;
    if (f === 'words') return raw.split(/[\s,]+/).map(function (w) { return w.trim(); }).filter(Boolean);
    if (f === 'sentences') return raw.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    return raw.trim().replace(/\s+/g, ' ');
  }
  var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  /** The fields that differ from the original: the draft to save. */
  function changes() {
    var L = data.lesson, out = {};
    L.fields.forEach(function (f) { var v = fromForm(f); if (!same(v, L.original[f])) out[f] = v; });
    return out;
  }
  /** What the lesson is now for learners, or will be with its draft: the original with the edits on top. */
  function current(withDraft) {
    var L = data.lesson, src = withDraft && L.draftValue ? (L.draftValue.reset ? {} : L.draftValue) : (L.published || {}), out = {};
    FIELDS.forEach(function (f) { out[f] = src[f] !== undefined ? src[f] : L.original[f]; });
    return out;
  }
  function fill() {
    var L = data.lesson, v = current(true);
    L.fields.forEach(function (f) {
      var box = form.querySelector('[data-field="' + f + '"]'); box.hidden = false;
      form.elements[f].value = toText(f, v[f]);
      if (f === 'words' || f === 'sentences') form.elements[f].rows = Math.min(14, Math.max(4, (v[f] || []).length + 1));
    });
    byId('f-title-hint').textContent = 'Originally: ' + L.original.title;
    byId('f-words-hint').textContent = L.ownWords ? 'The Words step uses only these words.'
      : 'This lesson’s own words. The Words step mixes them with common words that use only keys taught so far.';
    byId('f-sentences-hint').textContent = L.steps.indexOf('paragraph') !== -1 ? 'Typed on the Sentences step, one passage at a time.'
      : L.steps.indexOf('lock') !== -1 ? 'Typed on the Accuracy lock step.' : 'Used for this lesson’s typed text.';
    check();
  }

  /* ---------- checks, as learners would get them ---------- */
  function showError(f, text) {
    var err = byId('f-' + f + '-err'), input = form.elements[f];
    if (!err) return;
    err.textContent = text || ''; err.hidden = !text;
    if (text) { input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', 'f-' + f + '-hint f-' + f + '-err'); }
    else { input.removeAttribute('aria-invalid'); input.setAttribute('aria-describedby', 'f-' + f + '-hint'); }
  }
  function check() {
    var out = {}; out[id] = changes();
    var r = E.check({ lessons: out }), firstBad = null;
    FIELDS.forEach(function (f) { if (form.elements[f]) showError(f, ''); });
    r.errors.forEach(function (e) { if (e.field) { showError(e.field, e.message); if (!firstBad) firstBad = form.elements[e.field]; } });
    preview();
    return { ok: r.ok, first: firstBad };
  }

  /* ---------- preview: a sample of each step, made by the course engine ---------- */
  function preview() {
    var L = data.lesson, value = changes(), edits = { lessons: {} };
    if (Object.keys(value).length) edits.lessons[id] = value;
    // only this lesson's draft is shown here; any text that does not pass the checks is left out of the preview
    var r = E.check(edits); E.apply(r.edits);
    var lesson = C.byId(id), host = AC.clear(byId('previewBody'));
    C.steps(lesson).forEach(function (step) {
      var text = '';
      if (step === 'watch') text = lesson.watch && lesson.watch.note;
      else if (step === 'boss') { var b = C.bossWords(lesson); text = b.phase1.concat(b.phase2, b.phase3).join(' '); }
      else text = C.stepText(lesson, step);
      if (text && text.length > 420) text = text.slice(0, 420).replace(/\s+\S*$/, '') + ' …';
      host.appendChild(el('div', { class: 'step-sample' }, [el('div', { class: 'step-name', text: AC.course.STEP[step] || step }),
        el('p', { class: step === 'watch' ? 'step-text step-tip' : 'step-text', text: text || '(nothing to type)' })]));
    });
  }

  /* ---------- the page ---------- */
  function keycaps(L) {
    var keys = L.allowed.split('').filter(function (c) { return c !== ' '; });
    var nice = function (c) { return c; };
    return [el('div', { class: 'keycaps' }, keys.map(function (c) {
      return el('span', { class: 'keycap' + (L.newKeys.indexOf(c) !== -1 ? ' is-new' : ''), text: nice(c) });
    }).concat([el('span', { class: 'keycap keycap-wide', text: 'Space' })])),
    el('p', { class: 'hint', text: (L.newKeys ? 'Highlighted: the keys this lesson teaches. ' : '') + (L.shift ? 'Capitals are taught, so Shift may be used.' : 'Capitals are not taught yet.') })];
  }
  function render(d) {
    data = d;
    var L = d.lesson;
    AC.head({ title: 'Lesson ' + L.n + ': ' + (current(false).title), crumb: 'Lesson ' + L.n,
      sub: 'Level ' + L.level + ': ' + d.levelName + ' · ' + d.unitName,
      badges: [AC.course.badges(L)] });
    var note = AC.clear(byId('recNote'));
    if (L.draft) note.appendChild(AC.notice((L.draft === 'reset' ? 'A draft takes this lesson back to the original. ' : 'This lesson has a draft. ') +
      'Saved by ' + L.draftBy + ', ' + AC.fmt.dateTime(L.draftAt) + '. Learners see it after it is published on the Courses page.'));
    byId('keysNote').textContent = 'Typed text may only use keys taught by now';
    fill();
    if (canEdit) {
      byId('discardDraft').hidden = !L.draft;
      byId('toOriginal').hidden = !L.edited || L.draft === 'reset';
    }
    AC.fill('aboutBody', AC.facts([
      AC.fact('Kind', KIND[L.kind] || 'Lesson'),
      AC.fact('Steps', L.steps.map(function (s) { return AC.course.STEP[s] || s; }).join(', ')),
      AC.fact('Published', L.edited ? 'Changed from the original' : 'The original'),
      AC.fact('Next and previous', el('span', null, [L.prev ? el('a', { href: AC.base + '/course/lessons/' + L.prev, text: 'Previous lesson' }) : null,
        L.prev && L.next ? ' · ' : null, L.next ? el('a', { href: AC.base + '/course/lessons/' + L.next, text: 'Next lesson' }) : null]))
    ]));
    AC.fill('keysBody', keycaps(L));
  }
  var rec = AC.record({ endpoint: '/api/console/course/lessons/' + encodeURIComponent(id), notFound: ['Lesson not found', 'There is no lesson with this ID.'], render: render });

  form.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(check, 250); });
  byId('previewAgain').addEventListener('click', preview);
  if (canEdit) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var c = check();
      if (!c.ok) { if (c.first) c.first.focus(); return; }
      var value = changes(), L = data.lesson, button = byId('saveDraft');
      if (!Object.keys(value).length) {
        if (!L.edited) { AC.toast(L.draft ? 'This is the original: discard the draft to keep it so.' : 'Nothing has changed from the original.', 'info'); return; }
        value = { reset: true };
      }
      AC.busy(button, true);
      AC.course.saveDraft(item, value).then(function () {
        AC.busy(button, false); AC.toast('Draft saved. Publish it on the Courses page when it is ready.'); rec.load();
      }, function (err) {
        AC.busy(button, false);
        if (err.code === 'cancelled') return;
        if (err.fields) Object.keys(err.fields).forEach(function (f) { showError(f, err.fields[f]); });
        else AC.toast(err.message, 'bad');
      });
    });
    byId('discardDraft').addEventListener('click', function () {
      AC.confirm({ title: 'Discard this draft?', text: 'The lesson stays as learners have it now.', confirmLabel: 'Discard draft', danger: true }).then(function (ok) {
        if (!ok) return;
        AC.course.discard(item).then(function () { AC.toast('Draft discarded.'); rec.load(); }, function (err) { if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
      });
    });
    byId('toOriginal').addEventListener('click', function () {
      AC.confirm({ title: 'Take this lesson back to the original?', text: 'This saves a draft. Learners keep the current lesson until it is published.', confirmLabel: 'Save the draft' }).then(function (ok) {
        if (!ok) return;
        AC.course.saveDraft(item, { reset: true }).then(function () { AC.toast('Draft saved: back to the original.'); rec.load(); }, function (err) { if (err.code !== 'cancelled') AC.toast(err.message, 'bad'); });
      });
    });
  }
})();
