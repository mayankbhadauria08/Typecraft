/* /admin/emails. Data: GET /api/admin/emails?status&q&page → {emails:[{id, userId, to, template, category, subject, status, attempts, lastError,
   nextAttemptAt, sentAt, providerId, createdAt, updatedAt, retryable}], page, pages, total, last24h:{status: n}, templates, configured};
   POST /api/admin/emails/:id/retry → {email, result}; POST /api/admin/announcements {subject, body, audience:'all'|'paid'|'free', test}
   → test: {test:true, status, to}; real: 202 {queued, audience, batchSize, message};
   GET /api/admin/contact?status&page → {messages:[{id, userId, name, email, topic, message, priority, status, createdAt}], page, pages, total};
   POST /api/admin/contact/:id {status} → {id, status}. Retry and announcements: owner/admin; support reads and answers contact messages. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
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
    const rows = res.data.emails;
    const banner = res.data.configured ? null : K.alert('bad', 'Email sending is not set up (RESEND_API_KEY is missing), so emails are logged as failed with "not_configured".');
    const failed24 = res.data.last24h.failed || 0;
    if (!rows.length) { K.mount($('#ae-log-pager')); K.empty(el, { icon: 'mail', title: 'No emails match', text: 'Change the filter to see more.' }); if (banner) el.prepend(banner); return; }
    K.mount(el, banner, h('p', { class: 'muted', text: `${K.num(res.data.total)} email${res.data.total === 1 ? '' : 's'} · ${K.num(failed24)} failed in the last 24 hours` }), K.table([
      { label: 'When', value: (m) => K.dateTime(m.createdAt) },
      { label: 'To', value: (m) => m.to },
      { label: 'Template', value: (m) => h('span', { class: 'mono', text: m.template }) },
      { label: 'Subject', value: (m) => m.subject },
      { label: 'Status', value: (m) => [K.badge(m.status), m.lastError ? h('p', { class: 'muted', style: 'margin:.2rem 0 0;font-size:13px', text: m.lastError }) : null,
        m.nextAttemptAt && m.status === 'failed' ? h('p', { class: 'muted', style: 'margin:0;font-size:13px', text: `next try ${K.dateTime(m.nextAttemptAt)}` }) : null] },
      { label: 'Tries', num: true, value: (m) => K.num(m.attempts) },
      { label: '', value: (m) => (canWrite() && m.retryable ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Retry', onclick: async (e) => {
        K.busy(e.target, true);
        const r = await K.api('POST', `/api/admin/emails/${encodeURIComponent(m.id)}/retry`, {});
        K.busy(e.target, false);
        if (!r.ok) return K.toast(K.errMsg(r), 'bad');
        K.toast(r.data.email.status === 'sent' ? 'Sent again.' : `Retry result: ${r.data.email.status}${r.data.email.lastError ? ` (${r.data.email.lastError})` : ''}.`, r.data.email.status === 'sent' ? 'ok' : 'bad');
        logs();
      } }) : null) },
    ], rows, { caption: 'Email log' }));
    K.pager($('#ae-log-pager'), { page: res.data.page, pages: res.data.pages, onPage: (p) => { page = p; logs(); } });
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
    const rows = res.data.messages;
    if (!rows.length) return K.empty(el, { icon: 'mail', title: st === 'new' ? 'Inbox zero' : 'No messages', text: st === 'new' ? 'No new messages from the contact form.' : null });
    K.mount(el, res.data.total > rows.length ? h('p', { class: 'muted', text: `Showing the first ${rows.length} of ${res.data.total}, priority first.` }) : null,
      h('div', { style: 'display:grid;gap:1rem' }, rows.map((m) => {
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
        h('p', { class: 'muted' }, h('a', { href: `mailto:${encodeURIComponent(m.email)}`, text: m.email }), ` · ${m.topic || 'general'} · ${K.dateTime(m.createdAt)}`),
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
    if (res.data.status !== 'sent') return amsg('bad', `The test email to ${res.data.to} was not sent (status: ${res.data.status}). Check the email log before sending to everyone.`);
    amsg('ok', `Test sent to ${res.data.to}. Check it in your inbox (and on a phone) before sending.`);
    $('#ae-a-send').disabled = !canWrite();
  });
  $('#ae-a-send').addEventListener('click', async (e) => {
    if (testedKey !== key() || !check()) return;
    const v = K.formValues(af);
    const aud = af.elements.audience.options[af.elements.audience.selectedIndex].text;
    const ok = await K.confirm({ title: 'Send this announcement?', danger: true, typeToConfirm: 'SEND', confirmLabel: 'Send now',
      text: `“${v.subject.trim()}” goes to: ${aud}. Only confirmed, active accounts are included. People who turned off product news are skipped. Emails cannot be recalled once sent.` });
    if (!ok) return;
    K.busy(e.target, true);
    const res = await K.api('POST', '/api/admin/announcements', { subject: v.subject.trim(), body: v.body, audience: v.audience, test: false });
    K.busy(e.target, false);
    if (!res.ok) return amsg('bad', K.errMsg(res));
    amsg('ok', `${res.data.message} Progress shows in the email log.`);
    testedKey = null;
    e.target.disabled = true;
  });

  K.role().then((r) => {
    role = r;
    if (!canWrite()) { $('#ae-a-test').disabled = true; amsg('info', 'Your role can read emails and answer contact messages, but not send announcements.'); }
    logs();
  });
})();
