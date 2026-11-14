/* /admin/emails. Data: GET /api/admin/emails?status&q&page → {emails:[{id, toEmail, template, subject, category, status, attempts, lastError,
   nextAttemptAt, sentAt, createdAt}], page, pages, total}; POST /api/admin/emails/:id/retry;
   POST /api/admin/announcements {subject, body, audience:'all'|'paid'|'free', test} → {message?, recipients?|queued?};
   GET /api/admin/contact?status → {messages:[{id, name, email, topic, message, priority, status, createdAt}]}; POST /api/admin/contact/:id {status}. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const P = (o, ...k) => K.pick(o, ...k);
  let role = null, page = 1, testedKey = null;
  const canWrite = () => role === 'owner' || role === 'admin';

  /* tabs */
  K.$$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => {
    K.$$('.tabs [role=tab]').forEach((x) => { x.setAttribute('aria-selected', String(x === b)); $(`#${x.getAttribute('aria-controls')}`).hidden = x !== b; });
    if (b.dataset.tab === 'contact') contact();
  }));

  /* logs */
  async function logs() {
    const el = $('#ae-log-list');
    K.skeleton(el, 6);
    const f = $('#ae-log-filter');
    const res = await K.api('GET', `/api/admin/emails?status=${encodeURIComponent(f.elements.status.value)}&q=${encodeURIComponent(f.elements.q.value.trim())}&page=${page}`);
    if (!res.ok) return K.error(el, res, logs);
    const rows = K.list(res.data, 'emails', 'items', 'logs');
    if (!rows.length) { K.mount($('#ae-log-pager')); return K.empty(el, { icon: 'mail', title: 'No emails match', text: 'Change the filter to see more.' }); }
    K.mount(el, K.table([
      { label: 'When', value: (m) => K.dateTime(P(m, 'createdAt', 'created_at')) },
      { label: 'To', value: (m) => P(m, 'toEmail', 'to_email', 'to') },
      { label: 'Template', value: (m) => h('span', { class: 'mono', text: m.template }) },
      { label: 'Subject', value: (m) => m.subject },
      { label: 'Status', value: (m) => [K.badge(m.status), P(m, 'lastError', 'last_error') ? h('p', { class: 'muted', style: 'margin:.2rem 0 0;font-size:13px', text: P(m, 'lastError', 'last_error') }) : null,
        P(m, 'nextAttemptAt', 'next_attempt_at') && m.status === 'failed' ? h('p', { class: 'muted', style: 'margin:0;font-size:13px', text: `next try ${K.dateTime(P(m, 'nextAttemptAt', 'next_attempt_at'))}` }) : null] },
      { label: 'Tries', num: true, value: (m) => K.num(m.attempts) },
      { label: '', value: (m) => (canWrite() && (m.status === 'failed' || m.status === 'bounced') ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Retry', onclick: async (e) => {
        K.busy(e.target, true);
        const r = await K.api('POST', `/api/admin/emails/${encodeURIComponent(m.id)}/retry`, {});
        K.busy(e.target, false);
        if (!r.ok) return K.toast(K.errMsg(r), 'bad');
        K.toast((r.data && r.data.message) || 'Sent again.', 'ok');
        logs();
      } }) : null) },
    ], rows, { caption: 'Email log' }));
    K.pager($('#ae-log-pager'), { page: res.data.page || page, pages: res.data.pages || 1, onPage: (p) => { page = p; logs(); } });
  }
  $('#ae-log-filter').addEventListener('submit', (e) => { e.preventDefault(); page = 1; logs(); });
  $('#ae-status').addEventListener('change', () => { page = 1; logs(); });

  /* contact inbox */
  async function contact() {
    const el = $('#ae-c-list');
    K.skeleton(el, 5);
    const st = $('#ae-c-status').value;
    const res = await K.api('GET', `/api/admin/contact?status=${encodeURIComponent(st)}`);
    if (!res.ok) return K.error(el, res, contact);
    const rows = K.list(res.data, 'messages', 'items');
    if (!rows.length) return K.empty(el, { icon: 'mail', title: st === 'new' ? 'Inbox zero' : 'No messages', text: st === 'new' ? 'No new messages from the contact form.' : null });
    K.mount(el, h('div', { style: 'display:grid;gap:1rem' }, rows.map((m) => {
      const setStatus = async (s, btn) => {
        K.busy(btn, true);
        const r = await K.api('POST', `/api/admin/contact/${encodeURIComponent(m.id)}`, { status: s });
        K.busy(btn, false);
        if (!r.ok) return K.toast(K.errMsg(r), 'bad');
        K.toast(`Marked ${s}.`, 'ok');
        contact();
      };
      const subject = `Re: your TypeCraft message (${m.topic || 'general'})`;
      return h('article', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h3', null, h('span', { text: m.name || m.email }), ' ', m.priority ? K.badge('new', 'Priority') : null),
          K.badge(m.status)),
        h('p', { class: 'muted' }, h('a', { href: `mailto:${encodeURIComponent(m.email)}`, text: m.email }), ` · ${m.topic || 'general'} · ${K.dateTime(P(m, 'createdAt', 'created_at'))}`),
        h('p', { style: 'white-space:pre-wrap', text: m.message }),
        h('div', { class: 'card-foot field-row' },
          h('a', { class: 'btn btn-primary btn-sm', href: `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(subject)}`, text: 'Reply by email' }),
          m.status !== 'answered' ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Mark answered', onclick: (e) => setStatus('answered', e.target) }) : null,
          m.status !== 'closed' ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Close', onclick: (e) => setStatus('closed', e.target) }) : null,
          m.status !== 'new' ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Reopen', onclick: (e) => setStatus('new', e.target) }) : null));
    })));
  }
  $('#ae-c-status').addEventListener('change', contact);

  /* announcements: a test to yourself first, then the real send (confirmed) */
  const af = $('#ae-a-form');
  const key = () => JSON.stringify([af.elements.subject.value, af.elements.body.value, af.elements.audience.value]);
  const amsg = (kind, text) => K.mount($('#ae-a-msg'), kind ? K.alert(kind, text) : null);
  function check() {
    const f = {};
    if (!af.elements.subject.value.trim()) f.subject = 'Write a subject.';
    if (af.elements.body.value.trim().length < 20) f.body = 'Write the message (at least 20 characters).';
    K.formErrors(af, Object.keys(f).length ? f : null);
    return !Object.keys(f).length;
  }
  af.addEventListener('input', () => {
    const fresh = testedKey === key();
    $('#ae-a-send').disabled = !fresh || !canWrite();
    if (testedKey && !fresh) amsg('info', 'You changed the announcement. Send yourself a new test before sending it to everyone.');
  });
  af.addEventListener('change', () => af.dispatchEvent(new Event('input')));
  $('#ae-a-test').addEventListener('click', async (e) => {
    if (!check()) return;
    const v = K.formValues(af);
    K.busy(e.target, true);
    const res = await K.api('POST', '/api/admin/announcements', { subject: v.subject.trim(), body: v.body, audience: v.audience, test: true });
    K.busy(e.target, false);
    if (!res.ok) return amsg('bad', K.errMsg(res));
    testedKey = key();
    const n = P(res.data || {}, 'recipients', 'audienceSize', 'count');
    af.dataset.recipients = n != null ? String(n) : '';
    amsg('ok', `Test sent to your own address. Check it in your inbox (and on a phone) before sending.${n != null ? ` The real send goes to ${K.num(n)} people.` : ''}`);
    $('#ae-a-send').disabled = !canWrite();
  });
  $('#ae-a-send').addEventListener('click', async (e) => {
    if (testedKey !== key() || !check()) return;
    const v = K.formValues(af);
    const n = af.dataset.recipients;
    const aud = af.elements.audience.options[af.elements.audience.selectedIndex].text;
    const ok = await K.confirm({ title: 'Send this announcement?', danger: true, typeToConfirm: 'SEND', confirmLabel: 'Send now',
      text: `“${v.subject.trim()}” goes to: ${aud}${n ? ` (${K.num(Number(n))} people)` : ''}. People who turned off product news are skipped. Emails cannot be recalled once sent.` });
    if (!ok) return;
    K.busy(e.target, true);
    const res = await K.api('POST', '/api/admin/announcements', { subject: v.subject.trim(), body: v.body, audience: v.audience, test: false });
    K.busy(e.target, false);
    if (!res.ok) return amsg('bad', K.errMsg(res));
    const q = P(res.data || {}, 'queued', 'recipients', 'count');
    amsg('ok', (res.data && res.data.message) || `Announcement queued${q != null ? ` for ${K.num(q)} people` : ''}. Progress shows in the email log.`);
    testedKey = null;
    e.target.disabled = true;
  });

  K.me().then((me) => {
    role = me && me.role;
    if (!canWrite()) { $('#ae-a-test').disabled = true; amsg('info', 'Your role can read emails and answer contact messages, but not send announcements.'); }
    logs();
  });
})();
