/* Unlock conditions: who can open which lesson (docs/UNLOCK-RULES.md).
   GET  /api/console/unlock          → { levels, plans, rules, progress, placement, updatedAt, exceptions, can }
   POST /api/console/unlock/rules    { scope, target, effect: 'closed' | 'open' | 'plans', reason, updatedAt } → the same, plus done
   PUT  /api/console/unlock/progress { progress, placement, reason, updatedAt } → the same, plus done
   Every write sends the updatedAt the page was drawn from: 409 rules_changed means someone else saved first. */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el, doc = document;
  var byId = function (id) { return doc.getElementById(id); };
  var data = null;
  var EFFECT = {
    plans: { label: 'Follows the plans', kind: '' },
    open: { label: 'Open to everyone', kind: 'ok' },
    closed: { label: 'Closed for everyone', kind: 'bad' }
  };
  var MODE_TEXT = function (mode, prev) {
    if (mode === 'open') return 'Open from the start';
    if (mode === 'bosses') return prev.bosses > 1 ? 'After both bosses of Level ' + prev.n + ' are beaten' : 'After the boss of Level ' + prev.n + ' is beaten';
    return 'After every lesson of Level ' + prev.n + ' is finished';
  };

  function load() {
    return AC.api('GET', '/api/console/unlock').then(render, function (err) {
      byId('unlockPage').removeAttribute('aria-busy');
      AC.clear(byId('unlockNote')).appendChild(AC.notice(err.message || 'The rules could not be loaded.', 'warn'));
    });
  }

  function ruleOf(scope, target) {
    for (var i = 0; i < data.rules.length; i++) if (data.rules[i].scope === scope && data.rules[i].target === target) return data.rules[i];
    return null;
  }

  /* ---------- what each plan includes ---------- */
  function plans() {
    var heads = [['Level']].concat(data.plans.map(function (p) { return [p.name + (p.active ? '' : ' (off sale)'), 'num']; }));
    var rows = data.levels.map(function (L) {
      return el('tr', null, [el('th', { scope: 'row' }, [el('span', { class: 'cell-main', text: 'Level ' + L.n + ': ' + L.name }), el('div', { class: 'cell-sub', text: L.lessons.length + ' lessons' })])]
        .concat(data.plans.map(function (p) {
          var n = p.byLevel[L.n];
          return el('td', { class: 'num' }, n === L.lessons.length ? 'All' : n ? n + ' of ' + L.lessons.length : el('span', { class: 'none', 'aria-label': 'None', text: '–' }));
        })));
    });
    rows.push(el('tr', { class: 'row-total' }, [el('th', { scope: 'row', text: 'In words' })].concat(data.plans.map(function (p) {
      return el('td', { class: 'num' }, el('a', { href: AC.base + '/packages/' + encodeURIComponent(p.id), text: p.text, 'aria-label': p.name + ': ' + p.text + '. Open the plan' }));
    }))));
    var parts = [AC.table(heads, rows), el('p', { class: 'hint', text: 'A customer who paid keeps the lessons their plan had when they bought it, and gets any it gains later.' })];
    if (data.exceptions) parts.push(el('p', { class: 'hint' }, [data.exceptions + (data.exceptions === 1 ? ' exception for one customer is' : ' exceptions for single customers are') + ' in force. ',
      el('a', { href: AC.base + '/access?state=active', text: 'See Learning access' })]));
    AC.fill('plansBody', parts);
  }

  /* ---------- closed or open for everyone ---------- */
  function changeButton(scope, target, name) {
    return el('button', { type: 'button', class: 'btn-link', text: 'Change', 'aria-label': 'Change ' + name, on: { click: function () { change(scope, target, name); } } });
  }
  function everyone() {
    var can = data.can.manage, parts = [];
    if (data.rules.length) {
      var heads = [['Lesson or level'], ['Rule', 'col-fit'], ['Reason', 'col-wide'], ['Set by', 'col-wide']];
      if (can) heads.push(['', 'col-act']);
      parts.push(AC.table(heads, data.rules.map(function (r) {
        var cells = [
          el('td', null, [el('span', { class: 'cell-main', text: r.name }), el('div', { class: 'cell-sub show-fold', text: EFFECT[r.effect].label })]),
          el('td', { class: 'col-fit' }, AC.badge(EFFECT[r.effect].label, EFFECT[r.effect].kind)),
          el('td', { class: 'col-wide cell-wrap', text: r.reason || '–' }),
          el('td', { class: 'col-wide' }, [el('span', { class: 'cell-main', text: r.by || 'Unknown' }), el('div', { class: 'cell-sub', text: r.at ? AC.fmt.dateTime(r.at) : '' })])
        ];
        if (can) cells.push(el('td', { class: 'col-act' }, el('button', { type: 'button', class: 'btn-link', text: 'Remove', 'aria-label': 'Remove the rule for ' + r.name,
          on: { click: function () { change(r.scope, r.target, r.name, 'plans'); } } })));
        return el('tr', null, cells);
      }), true));
    } else {
      parts.push(AC.quiet('No rules for everyone: every lesson follows the plans.'));
    }
    var list = el('div', { class: 'unlock-levels' }, data.levels.map(function (L) {
      var lr = ruleOf('level', L.n), levelEffect = lr ? lr.effect : 'plans', name = 'Level ' + L.n + ': ' + L.name;
      var own = L.lessons.filter(function (l) { return ruleOf('lesson', l.id); }).length;
      var lessonRows = L.lessons.map(function (l) {
        var r = ruleOf('lesson', l.id), lname = 'Lesson ' + l.n + ': ' + l.title;
        var state = r ? AC.badge(EFFECT[r.effect].label, EFFECT[r.effect].kind)
          : levelEffect === 'plans' ? el('div', { class: 'cell-sub', text: 'Follows the plans' })
          : el('div', { class: 'cell-sub', text: (levelEffect === 'closed' ? 'Closed' : 'Open') + ' with its level' });
        return el('tr', null, [
          el('td', null, [el('span', { class: 'cell-main', text: l.n + '. ' + l.title }), l.kind === 'boss' ? el('div', { class: 'cell-sub', text: 'Boss' }) : null]),
          el('td', { class: 'col-fit' }, state),
          can ? el('td', { class: 'col-act' }, changeButton('lesson', l.id, lname)) : null
        ]);
      });
      return el('div', { class: 'unlock-level' }, [
        el('div', { class: 'unlock-level-head' }, [
          el('div', null, [el('span', { class: 'cell-main', text: name }), el('div', { class: 'cell-sub', text: L.lessons.length + ' lessons' + (own ? ', ' + own + ' with a rule of their own' : '') })]),
          AC.badge(EFFECT[levelEffect].label, EFFECT[levelEffect].kind),
          can ? changeButton('level', L.n, name) : null
        ]),
        el('details', { class: 'unlock-lessons' }, [el('summary', { text: 'Lessons in Level ' + L.n }),
          AC.table([['Lesson'], ['Now', 'col-fit']].concat(can ? [['', 'col-act']] : []), lessonRows)])
      ]);
    }));
    parts.push(list);
    AC.fill('everyoneBody', parts);
  }
  function change(scope, target, name, preset) {
    var r = ruleOf(scope, target), now = r ? r.effect : 'plans';
    var what = scope === 'level' ? 'every lesson in it' : 'it';
    AC.formDialog({
      title: preset === 'plans' ? 'Remove the rule for ' + name + '?' : name,
      text: preset === 'plans' ? 'It follows the plans again: learners open it if their plan includes it.' : 'Now: ' + EFFECT[now].label.toLowerCase() + '.',
      submitLabel: preset === 'plans' ? 'Remove the rule' : 'Save',
      fields: [
        preset ? null : { name: 'effect', label: 'For everyone', type: 'radio', value: now, options: [
          { value: 'plans', label: 'Follow the plans', hint: 'Learners open ' + what + ' if their plan includes it.' },
          { value: 'open', label: 'Open to everyone', hint: 'Every learner can open ' + what + ', Free learners too.' },
          { value: 'closed', label: 'Closed for everyone', hint: 'No learner can open ' + what + ', whatever their plan. They see that it is closed for now.' }
        ] },
        { name: 'reason', label: 'Reason', type: 'textarea', required: true, maxlength: 300, requiredText: 'Give a reason.', hint: 'Kept in the activity log. Learners do not see it.' }
      ].filter(Boolean),
      submit: function (v) {
        var effect = preset || v.effect;
        return AC.api('POST', '/api/console/unlock/rules', { scope: scope, target: target, effect: effect, reason: v.reason, updatedAt: data.updatedAt })
          .then(function (res) { render(res); AC.toast(res.unchanged ? 'Nothing had changed.' : res.done); }, stale);
      }
    });
  }
  // someone else saved first: show their change, and say so where the person is looking
  function stale(err) { if (err && err.code === 'rules_changed') load(); throw err; }

  /* ---------- unlock by progress ---------- */
  function progress() {
    var can = data.can.manage, levels = data.levels;
    var rows = levels.slice(1).map(function (L, i) {
      var prev = levels[i], id = 'f-level' + L.n;
      var sel = el('select', { id: id, name: 'level' + L.n, disabled: !can }, ['open', 'bosses', 'all'].map(function (m) {
        return el('option', { value: m, text: MODE_TEXT(m, prev), selected: data.progress[String(L.n)] === m });
      }));
      return el('div', { class: 'field', 'data-field': 'level' + L.n }, [el('label', { for: id, text: 'Level ' + L.n + ': ' + L.name + ' opens' }), sel,
        el('p', { class: 'err', id: id + '-err', hidden: true })]);
    });
    var place = el('input', { type: 'checkbox', id: 'f-placement', name: 'placement', checked: data.placement, disabled: !can });
    AC.fill('progressBody', [
      el('div', { class: 'form-grid progress-grid' }, rows),
      el('label', { class: 'tick', for: 'f-placement' }, [place, el('span', null, [el('span', { class: 'tick-label', text: 'The placement test can open levels' }),
        el('span', { class: 'tick-hint', text: 'If the test places a learner at Level 3, Levels 2 and 3 open for them at once.' })])]),
      el('p', { class: 'hint', text: 'Level 1 is always open. Only lessons a learner can open count: lessons their plan does not include, and lessons closed for everyone, are not needed. The app shows the next level as locked until then.' })
    ]);
  }
  var form = byId('progressForm');
  if (!form.hasAttribute('data-readonly')) form.addEventListener('submit', function (e) {
    e.preventDefault();
    var reasonBox = byId('f-progressReason'), err = byId('f-reason-err');
    err.hidden = true; reasonBox.removeAttribute('aria-invalid');
    var reason = reasonBox.value.trim();
    if (!reason) { err.textContent = 'Give a reason.'; err.hidden = false; reasonBox.setAttribute('aria-invalid', 'true'); reasonBox.focus(); return; }
    var body = { progress: {}, placement: byId('f-placement').checked, reason: reason, updatedAt: data.updatedAt };
    data.levels.slice(1).forEach(function (L) { body.progress[String(L.n)] = byId('f-level' + L.n).value; });
    var button = byId('progressSave');
    AC.busy(button, true);
    AC.api('PUT', '/api/console/unlock/progress', body).then(function (res) {
      AC.busy(button, false); reasonBox.value = '';
      render(res); AC.toast(res.unchanged ? 'Nothing had changed.' : res.done);
    }, function (e2) {
      AC.busy(button, false);
      if (e2.code === 'cancelled') return;
      if (e2.code === 'rules_changed') load();
      if (e2.fields && e2.fields.reason) { err.textContent = e2.fields.reason; err.hidden = false; reasonBox.focus(); return; }
      AC.toast(e2.message || 'The rules could not be saved.', 'bad');
    });
  });

  function render(d) {
    data = d;
    byId('unlockPage').removeAttribute('aria-busy');
    AC.clear(byId('unlockNote'));
    if (!d.can.manage) byId('unlockNote').appendChild(AC.notice('You can see these rules. Changing them needs the "Change unlock conditions" permission.'));
    plans(); everyone(); progress();
  }
  load();
})();
