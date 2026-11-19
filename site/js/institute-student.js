/* /institute/:id/students/:mid. GET /api/institutes/:id/students/:mid → { role, institute: { id, name },
   student: { id, name, email, joinedAt, batch: { id, name } }, summary: { lessonsDone, totalLessons, level, levelName, bestWpm, accuracy,
   minutes, lastPractice, stuck, … }, lessons: [{ id, n, level, title, status, stars, bestWpm, bestAccuracy, attempts, stuck }],
   levels: [{ n, name }], weakKeys: [{ key, attempts, errors, rate }], days: [{ day, minutes, bestWpm, accuracy }], since, today,
   exams: [{ modeName, netWpm, mistakesPct, passed, at }] }. docs/INSTITUTES.md §9. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const parts = location.pathname.split('/');
  const id = decodeURIComponent(parts[2] || ''), mid = decodeURIComponent(parts[4] || '');
  const keyWord = (k) => (k === ' ' ? 'Space' : k.toUpperCase());

  function stats(d) {
    const s = d.summary;
    const stat = (label, value, sub) => h('div', { class: 'card ins-stat' }, h('span', { class: 'muted', text: label }), h('strong', { text: value }), sub ? h('span', { class: 'muted', text: sub }) : null);
    K.mount($('#is-stats'), h('div', { class: 'ins-stat-row ins-stat-wide' },
      stat('Lessons done', `${s.lessonsDone} of ${s.totalLessons}`, `Working on level ${s.level}: ${s.levelName}`),
      stat('Best speed', s.bestWpm ? `${s.bestWpm} wpm` : '—', s.accuracy == null ? null : `${s.accuracy}% accuracy in finished lessons`),
      stat('Practice', `${s.minutes} min`, s.lastPractice ? `Last on ${K.date(s.lastPractice + 'T12:00:00+05:30')}` : 'Not practised yet')));
  }
  function days(d) {
    const by = new Map(d.days.map((x) => [x.day, x]));
    const out = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(Date.parse(d.today + 'T00:00:00Z') - i * 86400000).toISOString().slice(0, 10);
      out.push({ label: day, value: by.has(day) ? by.get(day).minutes : 0 });
    }
    if (!d.days.length) return K.empty($('#is-days'), { icon: 'chart', title: 'No practice in the last 30 days' });
    K.line($('#is-days'), out, { label: 'Minutes of practice by day', format: (v) => `${K.num(v, 1)} min` });
  }
  function levels(d) {
    const rows = d.levels.map((L) => {
      const ls = d.lessons.filter((x) => x.level === L.n);
      return { label: `Level ${L.n}: ${L.name}`, value: ls.filter((x) => x.status === 'completed').length, sub: `of ${ls.length}` };
    });
    K.bars($('#is-levels'), rows, { label: 'Lessons finished in each level', format: (v) => `${v}` });
  }
  function keys(d) {
    if (!d.weakKeys.length) return K.mount($('#is-keys'), h('p', { class: 'muted', text: 'Not enough typing yet: a key counts once it has been typed 20 times.' }));
    K.bars($('#is-keys'), d.weakKeys.map((k) => ({ label: keyWord(k.key), value: k.rate, sub: `${k.errors} of ${k.attempts}` })), { label: 'Mistakes on each key', format: (v) => `${v}%` });
  }
  function stuck(d) {
    const list = d.lessons.filter((x) => x.stuck);
    $('#is-stuck-sec').hidden = !list.length;
    if (!list.length) return;
    K.mount($('#is-stuck'), K.table([
      { label: 'Lesson', value: (x) => `${x.n}. ${x.title}` },
      { label: 'Level', num: true, value: (x) => String(x.level) },
      { label: 'Tries', num: true, value: (x) => String(x.attempts) },
      { label: 'Best', value: (x) => (x.bestWpm ? `${x.bestWpm} wpm at ${x.bestAccuracy}%` : '—') },
    ], list, { caption: 'Lessons tried five or more times and not finished' }));
  }
  function exams(d) {
    if (!d.exams.length) return K.mount($('#is-exams'), h('p', { class: 'muted', text: 'No exam practice tests saved yet.' }));
    K.mount($('#is-exams'), K.table([
      { label: 'Test', value: (e) => e.modeName },
      { label: 'Net speed', num: true, value: (e) => `${Math.floor(e.netWpm)} wpm` },
      { label: 'Mistakes', num: true, value: (e) => `${e.mistakesPct}%` },
      { label: 'Result', value: (e) => (e.passed ? K.badge('active', 'Passed') : K.badge('pending', 'Not yet')) },
      { label: 'Date', value: (e) => K.date(e.at) },
    ], d.exams, { caption: 'Recent exam practice tests' }));
  }

  async function load() {
    const res = await K.api('GET', `/api/institutes/${encodeURIComponent(id)}/students/${encodeURIComponent(mid)}`);
    if (!res.ok) { $('#is-title').textContent = 'Student'; return K.mount($('#is-stats'), K.alert('bad', K.errMsg(res))); }
    const d = res.data, st = d.student;
    document.title = `${st.name || st.email} – ${d.institute.name} – TypeCraft`;
    const back = $('#is-back');
    back.textContent = st.batch.name; back.href = `/institute/${encodeURIComponent(id)}/batches/${encodeURIComponent(st.batch.id)}`;
    $('#is-title').textContent = st.name || st.email;
    $('#is-sub').textContent = [st.name ? st.email : null, `${st.batch.name} since ${K.date(st.joinedAt)}`].filter(Boolean).join(' · ');
    stats(d); days(d); levels(d); keys(d); stuck(d); exams(d);
  }
  load();
})();
