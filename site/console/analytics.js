/* Learning analytics.
   GET /api/console/learning-analytics?range=7d|30d|90d
     → { range, from, to, previous, learners,
         practice: { learners, minutes, perLearner, lessonsFinished: { now, before } }, days: [{ day, learners, minutes }],
         levels: [{ n, name, lessons, started, finished, workingOn }], notStarted, finishedCourse,
         hardest: [{ id, n, level, title, tried, finished, stuck, tries }], minTried, stuckTries,
         placement: { taken, byLevel: [{ n, name, learners, wpm }] }, speed: [{ from, to, learners }],
         weakKeys: [{ key, attempts, errors, learners, rate }], keyMin, at }
   The period is kept in the address (?range=); the Refresh button asks again. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var dash = byId('dash');
  var range = new URLSearchParams(location.search).get('range');
  if (['7d', '30d', '90d'].indexOf(range) === -1) range = '30d';
  var BEFORE = { '7d': 'the 7 days before', '30d': 'the 30 days before', '90d': 'the 90 days before' };
  var seq = 0;
  var dayLong = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  var count = function (n) { return Number(n || 0).toLocaleString('en-IN'); };
  var plural = function (n, one, many) { return count(n) + ' ' + (n === 1 ? one : many); };
  function time(min) {
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), m = min % 60;
    return count(h) + ' h' + (m ? ' ' + m + ' min' : '');
  }
  var pct = function (part, whole) { return whole ? Math.round((100 * part) / whole) + '%' : '–'; };

  function delta(pair, fmt) {
    var d = pair.now - pair.before;
    if (!d) return el('div', { class: 'tile-delta' }, 'Same as ' + BEFORE[range]);
    var up = d > 0;
    return el('div', { class: 'tile-delta ' + (up ? 'is-good' : 'is-bad') }, [
      el('span', { 'aria-hidden': 'true', text: up ? '▲ ' : '▼ ' }), (up ? 'Up ' : 'Down ') + fmt(Math.abs(d)) + ' on ' + BEFORE[range]
    ]);
  }
  function tile(label, value, extra) {
    return el('div', { class: 'tile' }, [el('div', { class: 'tile-label', text: label }), el('div', { class: 'tile-value', text: value }), extra || null]);
  }
  function put(id, node) { AC.clear(byId(id)).appendChild(node); }

  function levels(d) {
    byId('levelsMeta').textContent = plural(d.learners, 'learner', 'learners') + ', ' + count(d.notStarted) + ' yet to finish a lesson, ' + count(d.finishedCourse) + ' finished the course';
    var link = AC.can('progress.view');
    put('levelsBody', AC.table([['Level'], ['Lessons', 'num col-wide'], ['Started', 'num col-wide'], ['Finished', 'num'], ['Working on it now', 'num']], d.levels.map(function (L) {
      var now = count(L.workingOn);
      return el('tr', null, [
        el('td', null, [el('span', { class: 'cell-main', text: 'Level ' + L.n + ': ' + L.name }),
          // on a phone the narrow columns fold into this one
          el('div', { class: 'person-extra' }, [el('span', { text: L.lessons + ' lessons' }), el('span', { text: count(L.started) + ' started' })])]),
        el('td', { class: 'num col-wide', text: String(L.lessons) }),
        el('td', { class: 'num col-wide', text: count(L.started) }),
        el('td', { class: 'num' }, [el('span', { text: count(L.finished) }), L.started ? el('div', { class: 'cell-sub', text: pct(L.finished, L.started) + ' of ' + count(L.started) }) : null]),
        el('td', { class: 'num' }, link && L.workingOn ? el('a', { href: AC.base + '/progress?level=' + L.n, text: now }) : now)
      ]);
    })));
  }
  function hardest(d) {
    byId('hardestMeta').textContent = 'Where learners get stuck: ' + d.stuckTries + ' tries or more and not finished. Lessons tried by ' + d.minTried + ' learners or more';
    if (!d.hardest.length) { put('hardestBody', AC.quiet('No lesson stands out yet. A lesson shows here once ' + d.minTried + ' learners have tried it and someone is stuck on it.')); return; }
    var link = AC.can('course.view');
    put('hardestBody', AC.table([['Lesson'], ['Tried', 'num'], ['Finished', 'num col-wide'], ['Stuck', 'num'], ['Average tries', 'num col-wide']], d.hardest.map(function (l) {
      var name = l.n + '. ' + l.title;
      return el('tr', null, [
        el('td', null, [link ? el('a', { class: 'cell-link', href: AC.base + '/course/lessons/' + l.id, text: name }) : el('span', { class: 'cell-main', text: name }),
          el('div', { class: 'cell-sub', text: 'Level ' + l.level })]),
        el('td', { class: 'num', text: count(l.tried) }),
        el('td', { class: 'num col-wide', text: count(l.finished) + ' (' + pct(l.finished, l.tried) + ')' }),
        el('td', { class: 'num' }, l.stuck ? AC.badge(count(l.stuck), 'warn') : '0'),
        el('td', { class: 'num col-wide', text: String(l.tries) })
      ]);
    })));
  }
  function speedName(b) { return b.to == null ? b.from + ' wpm or more' : b.from === 0 ? 'Under ' + b.to + ' wpm' : b.from + '–' + (b.to - 1) + ' wpm'; }

  function render(d) {
    var p = d.practice;
    var tiles = AC.clear(byId('practiceTiles'));
    [tile('Learners who practised', count(p.learners.now), delta(p.learners, count)),
      tile('Practice time', time(p.minutes.now), delta(p.minutes, time)),
      tile('Practice per learner', time(p.perLearner.now), delta(p.perLearner, time)),
      tile('Lessons finished', count(p.lessonsFinished.now), delta(p.lessonsFinished, count))
    ].forEach(function (t) { tiles.appendChild(t); });

    var total = d.days.reduce(function (s, x) { return s + x.learners; }, 0);
    AC.charts.columns(byId('activeChart'), {
      label: 'Learners who practised', format: count,
      points: d.days.map(function (x) { return { key: x.day, label: AC.fmt.day(x.day), value: x.learners,
        long: dayLong.format(new Date(x.day + 'T12:00:00+05:30')) + ', ' + time(x.minutes) + ' in all' }; }),
      summary: total ? count(p.learners.now) + ' different learners practised on at least one day.' : 'No one practised in this period.'
    });
    levels(d); hardest(d);
    AC.charts.bars(byId('speedBody'), { rows: d.speed.map(function (b) { return { label: speedName(b), value: b.learners }; }),
      format: count, empty: 'No speeds yet.' });
    if (!d.speed.some(function (b) { return b.learners; })) put('speedBody', AC.quiet('No one has finished a lesson with a speed yet.'));
    byId('placementMeta').textContent = 'Learners, by the level it placed them at: ' + count(d.placement.taken) + ' in all';
    if (!d.placement.taken) put('placementBody', AC.quiet('No one has taken the placement test yet.'));
    else AC.charts.bars(byId('placementBody'), { rows: d.placement.byLevel.map(function (L) { return { label: 'Level ' + L.n + ': ' + L.name, value: L.learners }; }),
      format: count });
    byId('keysMeta').textContent = 'Keys typed ' + count(d.keyMin) + ' times or more, by everyone together';
    put('keysBody', d.weakKeys.length ? AC.table([['Key'], ['Missed', 'num'], ['Typed', 'num col-wide'], ['Learners', 'num col-wide']], d.weakKeys.map(function (k) {
      return el('tr', null, [el('td', null, el('span', { class: 'keycap', text: k.key === ' ' ? 'Space' : k.key })), el('td', { class: 'num', text: k.rate + '%' }),
        el('td', { class: 'num col-wide', text: count(k.attempts) }), el('td', { class: 'num col-wide', text: count(k.learners) })]);
    })) : AC.quiet('Not enough typing yet to tell.'));
    byId('dashUpdated').textContent = 'Updated ' + AC.fmt.time(d.at) + ', ' + AC.fmt.day(d.from) + ' to ' + AC.fmt.day(d.to);
  }

  function load() {
    var mine = ++seq, button = byId('refreshBtn');
    dash.setAttribute('aria-busy', 'true'); AC.busy(button, true);
    AC.api('GET', '/api/console/learning-analytics?range=' + range).then(function (d) {
      if (mine !== seq) return;
      render(d);
      dash.classList.add('is-loaded'); dash.removeAttribute('aria-busy'); AC.busy(button, false);
    }, function (err) {
      if (mine !== seq) return;
      dash.removeAttribute('aria-busy'); AC.busy(button, false);
      AC.toast("Couldn't load learning analytics. " + err.message, 'bad');
      byId('dashUpdated').textContent = "Couldn't load the latest figures.";
    });
  }
  function pick(next) {
    range = next;
    Array.prototype.forEach.call(byId('rangePick').querySelectorAll('button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-range') === range ? 'true' : 'false'); });
    history.replaceState(null, '', location.pathname + (range === '30d' ? '' : '?range=' + range));
    load();
  }
  byId('rangePick').addEventListener('click', function (e) { var b = e.target.closest('button[data-range]'); if (b && b.getAttribute('data-range') !== range) pick(b.getAttribute('data-range')); });
  byId('refreshBtn').addEventListener('click', load);
  pick(range);
})();
