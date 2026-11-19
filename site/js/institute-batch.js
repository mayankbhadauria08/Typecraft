/* /institute/:id/batches/:bid. GET /api/institutes/:id/batches/:bid → { role, institute: { id, name },
   batch: { id, name, archived, students, joinCode, teachers: [{ id, name }] } };
   GET …/report → { role, since, totalLessons, students: [{ id, name, email, joinedAt, lessonsDone, level, levelName, bestWpm, accuracy,
     minutesThisWeek, lastDay, weakKeys: [{ key, rate }] }] }; …/report.csv (a download link);
   GET …/certificates → { institute, batch, students: [{ id, name, certificate: { title, test, wpm, accuracy, seconds, at, code } | null }] }.
   Admins: PUT /api/institutes/:id/batches/:bid { name | teacherIds | joining | archived, removeStudents }, POST …/code,
   POST /api/institutes/:id/students/:mid/remove, …/move { batchId }; GET /api/institutes/:id (other batches), …/staff (teachers).
   docs/INSTITUTES.md §8. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const parts = location.pathname.split('/');
  const id = decodeURIComponent(parts[2] || ''), bid = decodeURIComponent(parts[4] || '');
  let data = null, others = [];

  function copy(text, what) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => K.toast(`${what} copied.`), () => K.toast('Select it and copy it by hand.', 'bad'));
  }
  const fail = (res) => K.toast((res.error && res.error.fields && Object.values(res.error.fields)[0]) || K.errMsg(res), 'bad');
  async function change(body, okText) {
    const res = await K.api('PUT', `/api/institutes/${encodeURIComponent(id)}/batches/${encodeURIComponent(bid)}`, body);
    if (!res.ok) { fail(res); return null; }
    if (okText) K.toast(okText);
    load();
    return res.data;
  }

  function code(d) {
    const b = d.batch, admin = d.role === 'admin';
    if (b.archived) return K.mount($('#ib-code'));
    const acts = admin ? [
      b.joinCode ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'New code', onclick: newCode }) : null,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: b.joinCode ? 'Switch joining off' : 'Switch joining on',
        onclick: () => change({ joining: b.joinCode ? 'off' : 'on' }, b.joinCode ? 'Joining is off. The code no longer works.' : 'Joining is on, with a new code.') }),
    ] : [];
    if (!b.joinCode) {
      return K.mount($('#ib-code'), h('div', { class: 'card ins-code' }, h('p', { text: 'Joining is off for this batch: nobody can join it with a code.' }), h('div', { class: 'actions' }, acts)));
    }
    const link = `${location.origin}/join/${b.joinCode}`;
    K.mount($('#ib-code'), h('div', { class: 'card ins-code' },
      h('span', { class: 'muted', text: 'Join code' }),
      h('strong', { class: 'ins-code-big mono', text: b.joinCode }),
      h('p', { class: 'muted' }, 'Students open ', h('a', { href: link, text: link.replace(/^https?:\/\//, '') }), `, or go to ${location.host}/join and type the code. They sign in or create an account, confirm they are 18 or older, and take one of your seats.`),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'Copy the link', onclick: () => copy(link, 'Join link') }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Copy the code', onclick: () => copy(b.joinCode, 'Code') }),
        acts)));
  }
  async function newCode() {
    const ok = await K.confirm({ title: 'Make a new code?', text: 'The old code and link stop working at once. Students already in the batch stay.', confirmLabel: 'Make a new code' });
    if (!ok) return;
    const res = await K.api('POST', `/api/institutes/${encodeURIComponent(id)}/batches/${encodeURIComponent(bid)}/code`, {});
    if (!res.ok) return fail(res);
    K.toast('New code made.');
    load();
  }

  const keyWord = (k) => (k === ' ' ? 'Space' : k.toUpperCase());
  async function students() {
    const res = await K.api('GET', `/api/institutes/${encodeURIComponent(id)}/batches/${encodeURIComponent(bid)}/report`);
    if (!res.ok) return K.error($('#ib-students'), res, students);
    const r = res.data, admin = r.role === 'admin', list = r.students;
    if (!list.length) {
      K.mount($('#ib-students-act'));
      return K.empty($('#ib-students'), { icon: 'users', title: 'No students yet', text: data.batch.joinCode ? 'Give them the code or the link above.' : 'Switch joining on to give students a code.' });
    }
    const quiet = list.filter((s) => !s.lastDay || s.lastDay < r.since).length;
    K.mount($('#ib-students-act'), h('span', { class: 'muted', text: `${list.length} student${list.length === 1 ? '' : 's'}${quiet ? ` · ${quiet} not practised this week` : ''}` }), ' ',
      h('a', { class: 'btn btn-ghost btn-sm', href: `/api/institutes/${encodeURIComponent(id)}/batches/${encodeURIComponent(bid)}/report.csv`, download: '', text: 'Download CSV' }));
    const page = (s) => `/institute/${encodeURIComponent(id)}/students/${encodeURIComponent(s.id)}`;
    K.mount($('#ib-students'), K.table([
      { label: 'Student', value: (s) => [h('a', { href: page(s), text: s.name || s.email }), s.name ? h('div', { class: 'muted', text: s.email }) : null] },
      { label: 'Lessons', num: true, value: (s) => `${s.lessonsDone} of ${r.totalLessons}` },
      { label: 'Working on', value: (s) => `Level ${s.level}` },
      { label: 'Best speed', num: true, value: (s) => (s.bestWpm ? `${s.bestWpm} wpm` : '—') },
      { label: 'Accuracy', num: true, value: (s) => (s.accuracy == null ? '—' : `${s.accuracy}%`) },
      { label: 'This week', num: true, value: (s) => `${s.minutesThisWeek} min` },
      { label: 'Last practised', value: (s) => (s.lastDay ? [K.date(s.lastDay + 'T12:00:00+05:30'), s.lastDay < r.since ? [' ', K.badge('pending', 'Not this week')] : null] : 'Not yet') },
      { label: 'Weak keys', value: (s) => (s.weakKeys.length ? h('span', { class: 'ins-keys' }, s.weakKeys.map((k) => h('span', { class: 'kbd mono', title: `${k.rate}% mistakes`, text: keyWord(k.key) }))) : '—') },
      admin ? { label: '', value: (s) => h('div', { class: 'actions' },
        others.length ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Move', onclick: () => move(s) }) : null,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Remove', onclick: () => remove(s) })) } : null,
    ].filter(Boolean), list, { caption: 'Students and their progress' }));
  }

  /* Target, assignments, exam practice and the leaderboard: GET …/teaching → { target, targetStudents: [{ id, name, best, met }],
     assignments: [{ id, kind, title, dueDay, note, done, late, overdue, todo, students: [{ id, name, state }] }],
     exams: [{ id, name, modes: { mode: { tries, best, passed, latest } } }], examModes, leaderboard: { on, rows }, lessons, today };
     PUT …/target, POST …/assignments, POST …/assignments/:aid/remove, PUT …/leaderboard. */
  const STATE = { done: ['active', 'Done'], late: ['pending', 'Done late'], overdue: ['failed', 'Not done'], todo: ['created', 'To do'] };
  const day = (d) => K.date(d + 'T12:00:00+05:30');
  async function teaching() {
    const sec = $('#ib-teach-sec');
    const res = await K.api('GET', `/api/institutes/${encodeURIComponent(id)}/batches/${encodeURIComponent(bid)}/teaching`);
    if (!res.ok) {
      if (res.error && res.error.code === 'teaching_not_ready') { sec.hidden = true; return; }
      sec.hidden = false; return K.error($('#ib-asg'), res, teaching);
    }
    const t = res.data;
    sec.hidden = !!data.batch.archived;
    if (data.batch.archived) return;
    // target
    K.mount($('#ib-target-act'), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t.target ? 'Change' : 'Set a target', onclick: () => setTarget(t.target) }));
    if (!t.target) K.mount($('#ib-target'), h('p', { class: 'muted', text: 'Give the batch a goal, like 35 words a minute at 95% accuracy. Students see it on their dashboard.' }));
    else {
      const met = t.targetStudents.filter((x) => x.met).length;
      K.mount($('#ib-target'),
        h('p', null, h('strong', { text: `${t.target.wpm} wpm at ${t.target.accuracy}% accuracy` }), t.target.dueDay ? ` by ${day(t.target.dueDay)}` : ''),
        t.target.note ? h('p', { class: 'muted', text: t.target.note }) : null,
        h('p', { class: 'muted', text: `${met} of ${t.targetStudents.length} student${t.targetStudents.length === 1 ? '' : 's'} have reached it (best speed at that accuracy in lessons, typing tests or exam practice).` }),
        t.targetStudents.length ? K.table([
          { label: 'Student', value: (x) => x.name },
          { label: 'Best', num: true, value: (x) => (x.best ? `${x.best} wpm` : '—') },
          { label: '', value: (x) => (x.met ? K.badge('active', 'Reached') : null) },
        ], t.targetStudents.slice().sort((a, b) => b.best - a.best), { caption: 'Progress to the target' }) : null);
    }
    // leaderboard
    K.mount($('#ib-board-act'), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t.leaderboard.on ? 'Turn off' : 'Turn on', onclick: () => board(!t.leaderboard.on) }));
    K.mount($('#ib-board'),
      h('p', { class: 'muted', text: t.leaderboard.on ? 'On: students in this batch see the top speeds of the last 7 days, with first names only.'
        : 'Off: only you see it. Turn it on to show students the top speeds of the last 7 days, with first names only.' }),
      t.leaderboard.rows.length ? h('ol', { class: 'ins-board' }, t.leaderboard.rows.map((r) => h('li', null, h('span', { text: r.name }), h('strong', { text: `${r.wpm} wpm` }))))
        : h('p', { class: 'muted', text: 'Nobody has practised in the last 7 days.' }));
    // assignments
    K.mount($('#ib-asg-act'), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Give an assignment', onclick: () => assign(t) }));
    if (!t.assignments.length) K.mount($('#ib-asg'), h('p', { class: 'muted', text: 'No assignments. Give the batch a lesson or an exam practice test to finish by a day; you see who has done it.' }));
    else {
      K.mount($('#ib-asg'), K.table([
        { label: 'Assignment', value: (a) => [h('strong', { text: a.title }), a.note ? h('div', { class: 'muted', text: a.note }) : null] },
        { label: 'Due', value: (a) => day(a.dueDay) },
        { label: 'Done', num: true, value: (a) => `${a.done + a.late} of ${a.students.length}` },
        { label: 'Not done', value: (a) => {
          const missing = a.students.filter((x) => x.state === 'overdue' || x.state === 'todo');
          return missing.length ? h('details', null, h('summary', { text: `${missing.length} student${missing.length === 1 ? '' : 's'}` }), h('ul', { class: 'ins-names' }, missing.map((x) => h('li', null, x.name, ' ', K.badge(STATE[x.state][0], STATE[x.state][1]))))) : '—';
        } },
        { label: '', value: (a) => h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Remove', onclick: () => unassign(a) }) },
      ], t.assignments, { caption: 'Assignments' }));
    }
    // exam practice
    const tried = t.exams.filter((x) => Object.keys(x.modes).length);
    if (!tried.length) K.mount($('#ib-exams'), h('p', { class: 'muted', text: 'No exam practice tests saved by these students yet.' }));
    else {
      K.mount($('#ib-exams'), K.table([
        { label: 'Student', value: (x) => x.name },
        ...t.examModes.map((m) => ({ label: m.short, value: (x) => {
          const r = x.modes[m.id];
          return r ? [`${r.best} wpm`, ' ', r.passed ? K.badge('active', 'Passed') : K.badge('created', `${r.tries} tr${r.tries === 1 ? 'y' : 'ies'}`)] : '—';
        } })),
      ], t.exams, { caption: 'Best exam practice result of each student' }));
    }
  }
  async function setTarget(cur) {
    const v = await K.confirm({ title: 'Target for this batch', text: 'Students see it on their dashboard, and you see who has reached it.', confirmLabel: 'Save target',
      fields: [
        { name: 'wpm', label: 'Speed (words a minute)', type: 'number', min: 5, max: 150, required: true, value: cur ? cur.wpm : 35 },
        { name: 'accuracy', label: 'Accuracy (%)', type: 'number', min: 50, max: 100, required: true, value: cur ? cur.accuracy : 95 },
        { name: 'dueDay', label: 'By (optional)', type: 'date', value: cur && cur.dueDay ? cur.dueDay : '' },
        { name: 'note', label: 'Note for students (optional)', maxlength: 200, value: cur ? cur.note : '', hint: 'For example "SSC CHSL typing test: 35 wpm".' }] });
    if (!v) return;
    const res = await K.api('PUT', `/api/institutes/${encodeURIComponent(id)}/batches/${encodeURIComponent(bid)}/target`, { wpm: Number(v.wpm), accuracy: Number(v.accuracy), dueDay: v.dueDay || null, note: v.note });
    if (!res.ok) return fail(res);
    K.toast('Target saved.'); teaching();
  }
  async function board(on) {
    const res = await K.api('PUT', `/api/institutes/${encodeURIComponent(id)}/batches/${encodeURIComponent(bid)}/leaderboard`, { on });
    if (!res.ok) return fail(res);
    K.toast(on ? 'The leaderboard is on.' : 'The leaderboard is off.'); teaching();
  }
  async function assign(t) {
    const kind = await K.confirm({ title: 'Give an assignment', text: 'What should the batch do?', confirmLabel: 'Next',
      fields: [{ name: 'kind', label: 'Kind', type: 'select', value: 'lesson', options: [{ value: 'lesson', label: 'A lesson from the course' }, { value: 'exam', label: 'An exam practice test' }] }] });
    if (!kind) return;
    const options = kind.kind === 'lesson' ? t.lessons.map((l) => ({ value: l.id, label: l.label })) : t.examModes.map((m) => ({ value: m.id, label: m.name }));
    const v = await K.confirm({ title: kind.kind === 'lesson' ? 'Give a lesson' : 'Give an exam practice test', confirmLabel: 'Give assignment',
      fields: [
        { name: 'ref', label: kind.kind === 'lesson' ? 'Lesson' : 'Test', type: 'select', value: options[0].value, options },
        { name: 'dueDay', label: 'Finish by', type: 'date', required: true, value: K.addDays(K.today(), 7) },
        { name: 'note', label: 'Note for students (optional)', maxlength: 200 }] });
    if (!v) return;
    const res = await K.api('POST', `/api/institutes/${encodeURIComponent(id)}/batches/${encodeURIComponent(bid)}/assignments`, { kind: kind.kind, ref: v.ref, dueDay: v.dueDay, note: v.note });
    if (!res.ok) return fail(res);
    K.toast('Assignment given.'); teaching();
  }
  async function unassign(a) {
    const ok = await K.confirm({ title: `Remove "${a.title}"?`, text: 'Students stop seeing it. What they did stays in their progress.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    const res = await K.api('POST', `/api/institutes/${encodeURIComponent(id)}/batches/${encodeURIComponent(bid)}/assignments/${encodeURIComponent(a.id)}/remove`, {});
    if (!res.ok) return fail(res);
    K.toast('Removed.'); teaching();
  }

  async function certificates() {
    const sec = $('#ib-certs-sec');
    const res = await K.api('GET', `/api/institutes/${encodeURIComponent(id)}/batches/${encodeURIComponent(bid)}/certificates`);
    if (!res.ok) { sec.hidden = false; return K.error($('#ib-certs'), res, certificates); }
    const list = res.data.students;
    sec.hidden = !list.length;
    if (!list.length) return;
    const ready = list.filter((s) => s.certificate);
    const pictures = ready.map((s) => ({ name: s.name, wpm: s.certificate.wpm, accuracy: s.certificate.accuracy, seconds: s.certificate.seconds,
      date: s.certificate.at, code: s.certificate.code, verifyAt: location.host + '/verify', institute: res.data.institute.name }));
    K.mount($('#ib-certs-act'), ready.length && window.TC_REWARDS_UI ? h('button', { type: 'button', class: 'btn btn-primary btn-sm',
      text: `Print ${ready.length} certificate${ready.length === 1 ? '' : 's'}`, onclick: () => TC_REWARDS_UI.printCertificate(pictures) }) : null);
    K.mount($('#ib-certs'),
      h('p', { class: 'muted', text: 'Each student\u2019s best certificate: their highest speed certificate from the course, or else a passed exam practice test they made a certificate of. One a page, with your institute\u2019s name and a code anyone can check. In the print window choose your printer, or "Save as PDF".' }),
      K.table([
        { label: 'Student', value: (s) => s.name },
        { label: 'Certificate', value: (s) => (s.certificate ? s.certificate.title : h('span', { class: 'muted', text: 'None yet' })) },
        { label: 'Test', value: (s) => (s.certificate ? s.certificate.test : '—') },
        { label: 'Date', value: (s) => (s.certificate ? K.date(s.certificate.at) : '—') },
        { label: 'Code', value: (s) => (s.certificate ? (s.certificate.code ? h('span', { class: 'mono', text: s.certificate.code }) : 'Not shared') : '—') },
      ], list, { caption: 'Certificates' }));
  }
  async function move(s) {
    const v = await K.confirm({ title: `Move ${s.name || s.email}`, text: 'They keep their seat and their progress.', confirmLabel: 'Move',
      fields: [{ name: 'batchId', label: 'To batch', type: 'select', value: others[0].id, options: others.map((b) => ({ value: b.id, label: b.name })) }] });
    if (!v) return;
    const res = await K.api('POST', `/api/institutes/${encodeURIComponent(id)}/students/${encodeURIComponent(s.id)}/move`, { batchId: v.batchId });
    if (!res.ok) return fail(res);
    K.toast(`Moved to ${res.data.batch.name}.`);
    load();
  }
  async function remove(s) {
    const ok = await K.confirm({ title: `Remove ${s.name || s.email}?`, danger: true, confirmLabel: 'Remove and free the seat',
      text: 'Their seat goes back to the institute and its plan ends for them. Their progress stays theirs. To come back they need the code again.' });
    if (!ok) return;
    const res = await K.api('POST', `/api/institutes/${encodeURIComponent(id)}/students/${encodeURIComponent(s.id)}/remove`, {});
    if (!res.ok) return fail(res);
    K.toast('Removed. The seat is free.');
    load();
  }

  async function settings(d) {
    const b = d.batch;
    $('#ib-admin-sec').hidden = false;
    const staffRes = await K.api('GET', `/api/institutes/${encodeURIComponent(id)}/staff`);
    const team = staffRes.ok ? staffRes.data.staff.filter((s) => s.status === 'active') : [];
    const mine = new Set(b.teachers.map((t) => t.id));
    const name = h('input', { id: 'ibName', name: 'name', value: b.name, maxlength: 60, required: true });
    const nameForm = h('form', { class: 'ins-form', novalidate: true },
      h('div', { class: 'field' }, h('label', { for: 'ibName', text: 'Batch name' }), name),
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn btn-ghost btn-sm', text: 'Rename' })));
    nameForm.addEventListener('submit', (e) => { e.preventDefault(); change({ name: name.value }, 'Renamed.'); });
    const boxes = team.map((s) => h('div', { class: 'check' },
      h('input', { type: 'checkbox', id: `ibT-${s.id}`, value: s.id, checked: mine.has(s.id) }),
      h('label', { for: `ibT-${s.id}`, text: `${s.name || s.email}${s.role === 'admin' ? ' (admin)' : ''}` })));
    const teachForm = h('form', { class: 'ins-form', novalidate: true },
      h('fieldset', { class: 'field' }, h('legend', { text: 'Teachers of this batch' }),
        boxes.length ? boxes : h('p', { class: 'muted', text: 'Invite teachers on the institute page first.' }),
        h('p', { class: 'hint', text: 'Teachers see only the batches they teach. Admins see every batch.' })),
      boxes.length ? h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'btn btn-ghost btn-sm', text: 'Save teachers' })) : null);
    teachForm.addEventListener('submit', (e) => {
      e.preventDefault();
      change({ teacherIds: K.$$('input[type=checkbox]', teachForm).filter((c) => c.checked).map((c) => c.value) }, 'Teachers saved.');
    });
    const archiveBtn = h('button', { type: 'button', class: b.archived ? 'btn btn-ghost btn-sm' : 'btn btn-danger btn-sm', text: b.archived ? 'Bring the batch back' : 'Archive the batch', onclick: archive });
    K.mount($('#ib-admin'), h('div', { class: 'ins-settings' }, b.archived ? null : nameForm, b.archived ? null : teachForm,
      h('div', { class: 'ins-form' }, h('p', { class: 'muted', text: b.archived ? 'Archived batches keep their history but can’t be joined.'
        : 'When a batch finishes, archive it: its students are removed and their seats go back to the institute for the next batch.' }), h('div', { class: 'actions' }, archiveBtn))));
  }
  async function archive() {
    const b = data.batch;
    if (b.archived) return change({ archived: false }, 'The batch is back. Switch joining on to give it a code.');
    const n = b.students;
    const ok = await K.confirm({ title: `Archive ${b.name}?`, danger: true, confirmLabel: n ? `Archive and free ${n} seat${n === 1 ? '' : 's'}` : 'Archive',
      text: n ? `Its ${n} student${n === 1 ? '' : 's'} will be removed and their seats freed. They keep their progress. The code stops working.` : 'The code stops working.' });
    if (!ok) return;
    const r = await change({ archived: true, removeStudents: n > 0 }, null);
    if (r) K.toast(r.freed ? `Archived. ${r.freed} seat${r.freed === 1 ? '' : 's'} freed.` : 'Archived.');
  }

  async function load() {
    const res = await K.api('GET', `/api/institutes/${encodeURIComponent(id)}/batches/${encodeURIComponent(bid)}`);
    if (!res.ok) {
      $('#ib-title').textContent = 'Batch';
      return res.status === 404 ? K.mount($('#ib-students'), K.alert('bad', K.errMsg(res))) : K.error($('#ib-students'), res, load);
    }
    data = res.data;
    const b = data.batch;
    document.title = `${b.name} – ${data.institute.name} – TypeCraft`;
    $('#ib-back').textContent = data.institute.name;
    $('#ib-back').href = `/institute/${encodeURIComponent(id)}`;
    $('#ib-title').textContent = b.name;
    $('#ib-sub').textContent = [`${b.students} student${b.students === 1 ? '' : 's'}`, b.teachers.length ? `Taught by ${b.teachers.map((t) => t.name).join(', ')}` : null].filter(Boolean).join(' · ');
    K.mount($('#ib-note'), b.archived ? K.alert('info', 'This batch is archived: nobody can join it.') : null);
    code(data);
    if (data.role === 'admin') {
      const all = await K.api('GET', `/api/institutes/${encodeURIComponent(id)}`);
      others = all.ok ? all.data.batches.filter((x) => !x.archived && x.id !== bid) : [];
    }
    students();
    teaching();
    certificates();
    if (data.role === 'admin') settings(data); else $('#ib-admin-sec').hidden = true;
  }
  load();
})();
