/* /institute/:id. GET /api/institutes/:id → { role, institute: { id, name, city, status, seats, seatsUsed, startsAt, endsAt },
   batches: [{ id, name, students, quietThisWeek, teachers, joinCode, archived }] };
   admins: GET /api/institutes/:id/staff → { me, staff: [{ id, email, name, role, status, invitedAt, joinedAt, batches }] },
   POST /api/institutes/:id/batches { name }, POST …/staff { email, role }, …/staff/:sid/resend, …/staff/:sid/remove.
   docs/INSTITUTES.md §8. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const id = decodeURIComponent(location.pathname.split('/')[2] || '');
  const lastDay = (endsAt) => new Date(Date.parse(endsAt) - 1).toISOString();
  const joinLink = (code) => `${location.origin}/join/${code}`;
  let data = null;

  function copy(text, what) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => K.toast(`${what} copied.`), () => K.toast('Select it and copy it by hand.', 'bad'));
  }
  function note(i) {
    const now = new Date().toISOString();
    if (i.status === 'pending') return K.alert('info', "Not paid yet: students can't join until TypeCraft records your payment. You can set up batches and invite teachers now.");
    if (i.status === 'suspended') return K.alert('bad', 'Paused by TypeCraft: your students’ seats don’t give the plan, and nobody can join. Contact TypeCraft.');
    if (i.endsAt <= now) return K.alert('bad', `Your seats ended on ${K.date(lastDay(i.endsAt))}. Students keep their progress. Contact TypeCraft to renew.`);
    if (i.startsAt > now) return K.alert('info', `Your term starts on ${K.date(i.startsAt)}. Students can join from then.`);
    return null;
  }
  function stats(i) {
    const left = Math.max(0, Math.ceil((Date.parse(i.endsAt) - Date.now()) / 86400000));
    const stat = (label, value, sub) => h('div', { class: 'card ins-stat' }, h('span', { class: 'muted', text: label }), h('strong', { text: value }), sub ? h('span', { class: 'muted', text: sub }) : null);
    K.mount($('#io-stats'), h('div', { class: 'ins-stat-row' },
      stat('Seats in use', `${i.seatsUsed} of ${i.seats}`, `${Math.max(0, i.seats - i.seatsUsed)} free`),
      stat('Last day', K.date(lastDay(i.endsAt)), i.status === 'active' ? `${left} day${left === 1 ? '' : 's'} left` : null)));
  }

  function batches(d) {
    const admin = d.role === 'admin';
    K.mount($('#io-batches-act'), admin && d.institute.status !== 'closed' ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: 'New batch', onclick: newBatch }) : null);
    const list = d.batches;
    if (!list.length) {
      return K.empty($('#io-batches'), { icon: 'users', title: admin ? 'No batches yet' : 'No batches for you yet',
        text: admin ? 'Make a batch for each class. Each batch gets a code: students type it, or open its link, to join.' : 'Your institute’s admin gives you batches to teach.' });
    }
    K.mount($('#io-batches'), K.table([
      { label: 'Batch', value: (b) => [h('a', { href: `/institute/${encodeURIComponent(id)}/batches/${encodeURIComponent(b.id)}`, text: b.name }), b.archived ? [' ', K.badge('closed', 'Archived')] : null] },
      { label: 'Students', num: true, value: (b) => String(b.students) },
      { label: 'Not practised this week', num: true, value: (b) => (b.students ? String(b.quietThisWeek) : '—') },
      { label: 'Teachers', value: (b) => b.teachers || 'Admins' },
      { label: 'Join code', value: (b) => (b.joinCode ? [h('span', { class: 'mono', text: b.joinCode }), ' ',
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Copy link', 'aria-label': `Copy the join link for ${b.name}`, onclick: () => copy(joinLink(b.joinCode), 'Join link') })] : (b.archived ? '—' : 'Joining off')) },
    ], list, { caption: 'Batches' }));
  }
  async function newBatch() {
    const v = await K.confirm({ title: 'New batch', text: 'It gets its own code. Students who join it take one of your seats.', confirmLabel: 'Create batch',
      fields: [{ name: 'name', label: 'Batch name', required: true, maxlength: 60, hint: 'For example "Morning SSC batch" or "CPCT November".' }] });
    if (!v) return;
    const res = await K.api('POST', `/api/institutes/${encodeURIComponent(id)}/batches`, { name: v.name });
    if (!res.ok) return K.toast((res.error && res.error.fields && res.error.fields.name) || K.errMsg(res), 'bad');
    location.href = `/institute/${encodeURIComponent(id)}/batches/${encodeURIComponent(res.data.batch.id)}`;
  }

  async function staff() {
    const sec = $('#io-staff-sec');
    sec.hidden = false;
    const res = await K.api('GET', `/api/institutes/${encodeURIComponent(id)}/staff`);
    if (!res.ok) return K.error($('#io-staff'), res, staff);
    const open = data.institute.status !== 'closed';
    K.mount($('#io-staff-act'), open ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Invite a teacher', onclick: invite }) : null);
    K.mount($('#io-staff'), K.table([
      { label: 'Person', value: (s) => [h('strong', { text: s.name || s.email }), s.name ? h('div', { class: 'muted', text: s.email }) : null] },
      { label: 'Role', value: (s) => (s.role === 'admin' ? 'Admin' : 'Teacher') },
      { label: 'Status', value: (s) => (s.status === 'invited' ? K.badge('pending', 'Invited') : K.badge('active', 'Joined')) },
      { label: 'Batches', num: true, value: (s) => (s.role === 'admin' ? 'All' : String(s.batches)) },
      { label: '', value: (s) => h('div', { class: 'actions' },
        s.status === 'invited' ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Send again', onclick: (e) => resend(s, e.currentTarget) }) : null,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: s.id === res.data.me ? 'Leave' : 'Remove', onclick: () => remove(s, s.id === res.data.me) })) },
    ], res.data.staff, { caption: 'Admins and teachers' }));
  }
  const sent = (status) => (status === 'sent' ? 'Invitation sent.' : 'The invitation is saved, but the email could not be sent now. They can still sign in at /institute with that email and accept.');
  async function invite() {
    const v = await K.confirm({ title: 'Invite a teacher', text: 'They get an email. They sign in, or create an account, with this address and accept. Then give them batches on each batch’s page.',
      confirmLabel: 'Send invitation', fields: [
        { name: 'email', label: 'Their email', type: 'email', required: true, maxlength: 254 },
        { name: 'role', label: 'Role', type: 'select', value: 'teacher', options: [{ value: 'teacher', label: 'Teacher: sees the batches you give them' }, { value: 'admin', label: 'Admin: runs the whole institute, like you' }] }] });
    if (!v) return;
    const res = await K.api('POST', `/api/institutes/${encodeURIComponent(id)}/staff`, { email: v.email, role: v.role });
    if (!res.ok) return K.toast((res.error && res.error.fields && res.error.fields.email) || K.errMsg(res), 'bad');
    K.toast(sent(res.data.invite.emailStatus), res.data.invite.emailStatus === 'sent' ? null : 'bad');
    staff();
  }
  async function resend(s, btn) {
    K.busy(btn, true);
    const res = await K.api('POST', `/api/institutes/${encodeURIComponent(id)}/staff/${encodeURIComponent(s.id)}/resend`, {});
    K.busy(btn, false);
    if (!res.ok) return K.toast(K.errMsg(res), 'bad');
    K.toast(sent(res.data.emailStatus), res.data.emailStatus === 'sent' ? null : 'bad');
  }
  async function remove(s, self) {
    const ok = await K.confirm({ title: self ? 'Leave this institute?' : `Remove ${s.name || s.email}?`, danger: true, confirmLabel: self ? 'Leave' : 'Remove',
      text: self ? 'You lose access to this institute at once.' : s.status === 'invited' ? 'The invitation stops working.' : 'They lose access at once. Their batches stay; admins see them.' });
    if (!ok) return;
    const res = await K.api('POST', `/api/institutes/${encodeURIComponent(id)}/staff/${encodeURIComponent(s.id)}/remove`, {});
    if (!res.ok) return K.toast(K.errMsg(res), 'bad');
    if (res.data.self) { location.href = '/institute'; return; }
    K.toast('Removed.');
    load();
  }

  async function load() {
    const res = await K.api('GET', `/api/institutes/${encodeURIComponent(id)}`);
    if (!res.ok) {
      $('#io-title').textContent = 'Institute';
      return res.status === 404 ? K.mount($('#io-batches'), K.alert('bad', K.errMsg(res))) : K.error($('#io-batches'), res, load);
    }
    data = res.data;
    const i = data.institute;
    document.title = `${i.name} – TypeCraft`;
    $('#io-title').textContent = i.name;
    $('#io-sub').textContent = [data.role === 'admin' ? 'You are its admin' : 'You teach here', i.city].filter(Boolean).join(' · ');
    K.mount($('#io-note'), note(i));
    stats(i);
    batches(data);
    if (data.role === 'admin') staff();
  }
  load();
})();
