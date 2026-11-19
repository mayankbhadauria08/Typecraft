/* "Your batch" on the dashboard, for students of an institute. GET /api/me/batches → { batches: [{ id, institute: { name },
   batch: { name }, target: { wpm, accuracy, dueDay, note, myBest, met } | null, assignments: [{ title, dueDay, note, state, link }],
   leaderboard: [{ name, wpm }] | null, tests: [{ id, title, opensAt, closesAt, note, state, mine, link }] }], today }.
   Nothing shows for anyone not in a batch. docs/INSTITUTES.md §12, §16 (scheduled tests). */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const STATE = { done: ['active', 'Done'], late: ['pending', 'Done late'], overdue: ['failed', 'Not done'], todo: ['created', 'To do'] };
  const day = (d) => K.date(d + 'T12:00:00+05:30');

  const MINE = { passed: ['active', 'Goal met'], submitted: ['created', 'Taken'], started: ['pending', 'Opened'], not_started: null };
  const hm = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  function testLine(t) {
    const taken = t.mine === 'passed' || t.mine === 'submitted';
    const when = t.state === 'upcoming' ? `opens ${K.date(t.opensAt)}, ${hm(t.opensAt)}; start by ${hm(t.closesAt)}`
      : t.state === 'open' ? `open now: start by ${hm(t.closesAt)}` : `closed ${K.date(t.closesAt)}`;
    return h('li', null,
      t.state === 'open' && !taken ? h('a', { href: t.link, text: t.title }) : h('span', { text: t.title }),
      h('span', { class: 'muted', text: ` · ${when} ` }),
      MINE[t.mine] ? K.badge(MINE[t.mine][0], MINE[t.mine][1]) : t.state === 'closed' ? K.badge('failed', 'Missed') : null,
      t.note ? h('div', { class: 'muted', text: t.note }) : null);
  }
  function card(b) {
    const t = b.target;
    return h('article', { class: 'card my-batch' },
      h('h3', null, b.batch.name, h('span', { class: 'muted', text: ` · ${b.institute.name}` })),
      t ? h('div', null,
        h('p', null, 'Target: ', h('strong', { text: `${t.wpm} wpm at ${t.accuracy}% accuracy` }), t.dueDay ? ` by ${day(t.dueDay)}` : '', '. ',
          t.met ? K.badge('active', 'Reached') : h('span', { class: 'muted', text: t.myBest ? `Your best at that accuracy: ${t.myBest} wpm.` : 'Practise to get there.' })),
        t.note ? h('p', { class: 'muted', text: t.note }) : null) : null,
      b.assignments.length ? h('div', null, h('p', null, h('strong', { text: 'Assignments' })),
        h('ul', null, b.assignments.map((a) => h('li', null,
          a.state === 'done' || a.state === 'late' ? a.title : h('a', { href: a.link, text: a.title }),
          h('span', { class: 'muted', text: ` · by ${day(a.dueDay)} ` }), K.badge(STATE[a.state][0], STATE[a.state][1]),
          a.note ? h('div', { class: 'muted', text: a.note }) : null)))) : null,
      b.tests && b.tests.length ? h('div', null, h('p', null, h('strong', { text: 'Scheduled tests' })), h('ul', null, b.tests.map(testLine))) : null,
      b.leaderboard ? h('div', null, h('p', null, h('strong', { text: 'Top speeds this week' })),
        b.leaderboard.length ? h('ol', { class: 'ins-board' }, b.leaderboard.map((r) => h('li', null, h('span', { text: r.name }), h('strong', { text: `${r.wpm} wpm` }))))
          : h('p', { class: 'muted', text: 'Nobody has practised this week yet.' })) : null,
      !t && !b.assignments.length && !b.leaderboard && !(b.tests && b.tests.length) ? h('p', { class: 'muted', text: 'Your teachers can see your progress. Targets and assignments they give appear here.' }) : null);
  }
  async function load() {
    const res = await K.api('GET', `/api/me/batches`);
    if (!res.ok || !res.data.batches.length) return;
    $('#dash-batch').hidden = false;
    K.mount($('#dash-batch-body'), h('div', { class: 'grid grid-2' }, res.data.batches.map(card)));
  }
  load();
})();
