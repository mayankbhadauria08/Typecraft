/* Student progress: every learner (staff left out), with filters kept in the address.
   GET /api/console/progress?q=&level=&activity=&stuck=&sort=&page=
     → { items: [{ id, fullName, email, joinedAt, lessonsDone, finished, level, levelName, bestWpm, accuracy, stuck, lastPractice, minutes30 }],
         page, pageSize, pages, total, today, levels: [{ id, name }], totalLessons } */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var form = doc.getElementById('filters'), total = 78, today = null;

  function lastPractice(day) {
    if (!day) return 'Never';
    if (day === today) return 'Today';
    var days = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86400000);
    return days === 1 ? 'Yesterday' : days < 31 ? days + ' days ago' : AC.fmt.day(day);
  }
  function stuckBadge(n) { return n ? AC.badge(n === 1 ? 'Stuck on a lesson' : 'Stuck on ' + n + ' lessons', 'warn') : null; }
  function row(x) {
    var level = x.finished ? 'Finished the course' : 'Level ' + x.level + ': ' + x.levelName;
    return el('tr', null, [
      el('td', null, [
        el('a', { class: 'cell-link', href: AC.base + '/progress/' + encodeURIComponent(x.id), text: x.fullName || 'No name' }),
        el('div', { class: 'cell-sub', text: x.email }),
        // on a phone the other columns are folded into this one
        el('div', { class: 'person-extra' }, [stuckBadge(x.stuck), el('span', { text: level }), el('span', { text: x.bestWpm ? x.bestWpm + ' wpm' : 'No speed yet' }),
          el('span', { text: 'Last practice: ' + lastPractice(x.lastPractice) })])
      ]),
      el('td', { class: 'col-wide' }, [el('span', { text: x.finished ? 'Finished the course' : 'Level ' + x.level }), x.finished ? null : el('div', { class: 'cell-sub', text: x.levelName })]),
      el('td', { class: 'num nowrap', text: x.lessonsDone + ' of ' + total }),
      el('td', { class: 'num col-wide nowrap', text: x.bestWpm ? x.bestWpm + ' wpm' : '–' }),
      el('td', { class: 'num col-wide nowrap', text: x.accuracy == null ? '–' : x.accuracy + '%' }),
      el('td', { class: 'col-wide nowrap' }, [el('span', { text: lastPractice(x.lastPractice) }),
        x.minutes30 ? el('div', { class: 'cell-sub', text: x.minutes30 + ' min in 30 days' }) : null]),
      el('td', { class: 'col-fit' }, stuckBadge(x.stuck))
    ]);
  }
  AC.listPage({
    endpoint: '/api/console/progress', noun: ['learner', 'learners'], row: row,
    empty: 'No learners yet. When people sign up and practise, they show here.',
    onData: function (d) { total = d.totalLessons; today = d.today; AC.options(form.querySelector('[name="level"]'), d.levels); }
  });
})();
