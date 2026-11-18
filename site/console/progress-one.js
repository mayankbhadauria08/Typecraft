/* One learner's progress.
   GET /api/console/progress/:id → { learner, plan, summary, placement, lessons: [78 in course order], levels, weakKeys, days, since, today, can } */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var id = (AC.boot.page.params || {}).id;
  var STATUS = { completed: ['Finished', 'ok'], in_progress: ['Started', 'warn'], not_started: ['Not started', ''] };

  function figure(value, label, sub) {
    return el('div', { class: 'figure' }, [el('div', { class: 'figure-value', text: value }), el('div', { class: 'figure-label', text: label }), sub ? el('div', { class: 'figure-sub', text: sub }) : null]);
  }
  function lastPractice(day, today) {
    if (!day) return 'Never';
    if (day === today) return 'Today';
    var days = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(day + 'T00:00:00Z')) / 86400000);
    return days === 1 ? 'Yesterday' : days + ' days ago';
  }
  function daysChart(d) {
    var host = byId('daysChart');
    if (!d.days.some(function (x) { return x.minutes > 0; })) { AC.clear(host).appendChild(AC.quiet('No practice in the last 30 days.')); return; }
    var by = {}; d.days.forEach(function (x) { by[x.day] = x; });
    var points = [], start = Date.parse(d.since + 'T00:00:00Z'), total = 0, active = 0;
    for (var i = 0; i < 30; i++) {
      var day = new Date(start + i * 86400000).toISOString().slice(0, 10), x = by[day], m = x ? x.minutes : 0;
      total += m; if (m > 0) active++;
      points.push({ key: day, label: AC.fmt.day(day), long: AC.fmt.day(day) + (x && x.bestWpm ? ', best ' + x.bestWpm + ' wpm' : ''), value: m });
    }
    AC.charts.columns(host, { label: 'Minutes practised each day', points: points, format: function (v) { return (Math.round(v * 10) / 10) + ' min'; },
      tick: function (v) { return String(Math.round(v * 10) / 10); },
      summary: Math.round(total) + ' minutes on ' + active + (active === 1 ? ' day' : ' days') + ' out of 30.' });
  }
  function lessons(d) {
    var stuck = d.lessons.filter(function (l) { return l.stuck; }).length;
    byId('lessonsMeta').textContent = d.summary.lessonsDone + ' of ' + d.summary.totalLessons + ' finished' + (stuck ? ', stuck on ' + stuck : '');
    var host = byId('lessonsBody'), parts = [];
    d.levels.forEach(function (L) {
      var rows = d.lessons.filter(function (l) { return l.level === L.n; });
      var done = rows.filter(function (l) { return l.status === 'completed'; }).length;
      var started = rows.some(function (l) { return l.status !== 'not_started'; });
      var table = AC.table([['Lesson'], ['State', 'col-fit'], ['Stars', 'num col-wide'], ['Best speed', 'num'], ['Accuracy', 'num col-wide'], ['Tries', 'num col-wide']],
        rows.map(function (l) {
          var s = STATUS[l.status] || STATUS.not_started;
          return el('tr', { class: l.status === 'not_started' ? 'row-quiet' : null }, [
            el('td', null, [el('span', { class: 'cell-main', text: l.n + '. ' + l.title }), l.stuck ? el('div', null, AC.badge('Stuck: ' + l.attempts + ' tries', 'warn')) : null,
              // on a phone the State column folds into this one
              l.status === 'not_started' ? null : el('div', { class: 'person-extra' }, [AC.badge(s[0], s[1]), l.bestWpm ? el('span', { text: l.bestWpm + ' wpm' }) : null])]),
            el('td', { class: 'col-fit' }, AC.badge(s[0], s[1])),
            el('td', { class: 'num col-wide', text: l.status === 'not_started' ? '' : '★'.repeat(l.stars) + (l.crown ? ' ♛' : '') || '–' }),
            el('td', { class: 'num', text: l.bestWpm ? l.bestWpm + ' wpm' : '' }),
            el('td', { class: 'num col-wide', text: l.bestAccuracy ? l.bestAccuracy + '%' : '' }),
            el('td', { class: 'num col-wide', text: l.attempts ? String(l.attempts) : '' })
          ]);
        }), true);
      parts.push(el('details', { class: 'level-block', open: started && done < rows.length ? true : null }, [
        el('summary', null, [el('span', { class: 'cell-main', text: 'Level ' + L.n + ': ' + L.name }), el('span', { class: 'cell-sub', text: done + ' of ' + rows.length + ' finished' })]), table]));
    });
    AC.clear(host).appendChild(el('div', null, parts));
  }
  function render(d) {
    var s = d.summary, L = d.learner;
    AC.head({ title: L.fullName || 'No name', crumb: L.fullName || 'Learner', sub: L.email,
      badges: [s.finished ? AC.badge('Finished the course', 'ok') : AC.badge('Working on Level ' + s.level, 'role'), L.disabled ? AC.badge('Disabled', 'bad') : null,
        s.stuck ? AC.badge(s.stuck === 1 ? 'Stuck on a lesson' : 'Stuck on ' + s.stuck + ' lessons', 'warn') : null],
      actions: d.can.customer ? [el('a', { class: 'btn btn-quiet', href: AC.base + '/customers/' + encodeURIComponent(L.id), text: 'Customer page' })] : [] });
    var fig = AC.clear(byId('figures')); fig.removeAttribute('aria-busy');
    [figure(s.lessonsDone + ' / ' + s.totalLessons, 'Lessons finished', s.finished ? 'The whole course' : 'Working on Level ' + s.level + ': ' + s.levelName),
      figure(s.bestWpm ? s.bestWpm + ' wpm' : '–', 'Best speed', s.accuracy == null ? null : s.accuracy + '% accuracy on average'),
      figure(s.minutes ? s.minutes.toLocaleString('en-IN') + ' min' : '0 min', 'Practice in all', 'Last: ' + lastPractice(s.lastPractice, d.today)),
      figure(s.stars + ' ★', 'Stars', s.crowns + (s.crowns === 1 ? ' crown' : ' crowns') + ', rank ' + s.rank)
    ].forEach(function (f) { fig.appendChild(f); });
    daysChart(d); lessons(d);
    AC.fill('aboutBody', AC.facts([
      AC.fact('Plan', d.plan ? d.plan.name : '–', d.plan ? el('div', { class: 'cell-sub', text: d.plan.lessons }) : null),
      AC.fact('Joined', AC.fmt.date(L.joinedAt)),
      AC.fact('Streak', s.streak.now + (s.streak.now === 1 ? ' day' : ' days') + ' (best ' + s.streak.best + ')'),
      AC.fact('XP', s.xp.toLocaleString('en-IN'))
    ]));
    AC.fill('keysBody', d.weakKeys.length ? AC.table([['Key'], ['Missed', 'num'], ['Typed', 'num col-wide']], d.weakKeys.map(function (k) {
      return el('tr', null, [el('td', null, el('span', { class: 'keycap', text: k.key === ' ' ? 'Space' : k.key })), el('td', { class: 'num', text: k.rate + '%' }),
        el('td', { class: 'num col-wide', text: k.attempts.toLocaleString('en-IN') })]);
    })) : AC.quiet('Not enough typing yet to tell.'));
    AC.fill('placementBody', d.placement ? AC.facts([AC.fact('Placed at', 'Level ' + d.placement.level), AC.fact('Result', d.placement.wpm + ' wpm, ' + d.placement.accuracy + '%'),
      AC.fact('Taken', AC.fmt.date(d.placement.at))]) : AC.quiet('Not taken.'));
  }
  AC.record({ endpoint: '/api/console/progress/' + encodeURIComponent(id), notFound: ['Learner not found', 'There is no learner with this ID.'], render: render });
})();
