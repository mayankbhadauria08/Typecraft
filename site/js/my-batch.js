/* "Your batch" on the dashboard, for students of an institute. GET /api/me/batches → { batches: [{ id, institute: { name },
   batch: { name }, target: { wpm, accuracy, dueDay, note, myBest, met } | null, assignments: [{ title, dueDay, note, state, link }],
   leaderboard: [{ name, wpm }] | null }], today }. Nothing shows for anyone not in a batch. docs/INSTITUTES.md §12. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const STATE = { done: ['active', 'Done'], late: ['pending', 'Done late'], overdue: ['failed', 'Not done'], todo: ['created', 'To do'] };
  const day = (d) => K.date(d + 'T12:00:00+05:30');

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
      b.leaderboard ? h('div', null, h('p', null, h('strong', { text: 'Top speeds this week' })),
        b.leaderboard.length ? h('ol', { class: 'ins-board' }, b.leaderboard.map((r) => h('li', null, h('span', { text: r.name }), h('strong', { text: `${r.wpm} wpm` }))))
          : h('p', { class: 'muted', text: 'Nobody has practised this week yet.' })) : null,
      !t && !b.assignments.length && !b.leaderboard ? h('p', { class: 'muted', text: 'Your teachers can see your progress. Targets and assignments they give appear here.' }) : null);
  }
  async function load() {
    const res = await K.api('GET', `/api/me/batches`);
    if (!res.ok || !res.data.batches.length) return;
    $('#dash-batch').hidden = false;
    K.mount($('#dash-batch-body'), h('div', { class: 'grid grid-2' }, res.data.batches.map(card)));
  }
  load();
})();
