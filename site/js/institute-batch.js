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
    certificates();
    if (data.role === 'admin') settings(data); else $('#ib-admin-sec').hidden = true;
  }
  load();
})();
