/* Shared by the course pages (docs/ADMIN-PHASE-3.md): state badges, drafts, step names. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var STEP = { watch: 'Watch', character: 'Keys', mixed: 'Mixed', word: 'Words', paragraph: 'Sentences', challenge: 'Challenge', timed: 'Timed test',
    sprint: 'Sprints', boss: 'Boss', intro: 'Meet the keyboard', lock: 'Accuracy lock', exam: 'Exam' };
  AC.course = {
    STEP: STEP,
    /** x: { edited, draft: null | 'changed' | 'reset' } → badges for a table cell or a page head */
    badges: function (x) {
      var out = [];
      if (x.draft === 'reset') out.push(AC.badge('Draft: back to the original', 'warn'));
      else if (x.draft) out.push(AC.badge('Draft', 'warn'));
      if (x.edited) out.push(AC.badge('Changed', 'role'));
      if (!out.length) out.push(el('span', { class: 'cell-sub', text: 'Original' }));
      return el('span', { class: 'badges-inline' }, out);
    },
    saveDraft: function (item, value) { return AC.api('PUT', '/api/console/course/drafts/' + encodeURIComponent(item), { value: value }); },
    discard: function (item) { return AC.api('DELETE', '/api/console/course/drafts/' + encodeURIComponent(item), {}); },
    /** A line that says how many drafts wait to be published, with a link to the Courses page. */
    draftsNote: function (n) {
      if (!n) return null;
      return AC.notice(n + (n === 1 ? ' draft is' : ' drafts are') + ' waiting to be published. Learners see them after publishing on the Courses page.');
    },
    coursesLink: function () { return el('a', { href: AC.base + '/course', text: 'Go to Courses to publish' }); }
  };
})();
