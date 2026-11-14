// /admin/emails — email logs with retry, announcements, contact messages.
export const meta = {
  path: '/admin/emails', title: 'Emails', description: 'Email delivery, announcements and contact messages.',
  access: 'admin', layout: 'admin', nav: 'emails', noindex: true,
};
export const body = `
<div class="page-head">
  <h1>Emails</h1>
  <p class="lede muted">What was sent, what failed, messages from the contact form, and announcements.</p>
</div>
<div class="section tabs" role="tablist" aria-label="Email sections">
  <button type="button" role="tab" aria-selected="true" data-tab="logs" id="ae-tab-logs" aria-controls="ae-logs">Email log</button>
  <button type="button" role="tab" aria-selected="false" data-tab="contact" id="ae-tab-contact" aria-controls="ae-contact">Contact inbox</button>
  <button type="button" role="tab" aria-selected="false" data-tab="announce" id="ae-tab-announce" aria-controls="ae-announce">Announcement</button>
</div>
<section id="ae-logs" role="tabpanel" aria-labelledby="ae-tab-logs">
  <form class="field-row section" id="ae-log-filter" role="search">
    <div class="field"><label for="ae-status">Status</label>
      <select id="ae-status" name="status"><option value="">All</option><option value="failed">Failed</option><option value="queued">Queued</option><option value="sent">Sent</option><option value="delivered">Delivered</option><option value="bounced">Bounced</option></select></div>
    <div class="field"><label for="ae-q">Search</label><input id="ae-q" name="q" type="search" placeholder="Recipient or template" autocomplete="off"></div>
    <button class="btn btn-ghost" type="submit">Filter</button>
  </form>
  <div id="ae-log-list" aria-live="polite"><div class="skeleton" style="height:14rem"></div></div>
  <div id="ae-log-pager"></div>
</section>
<section id="ae-contact" role="tabpanel" aria-labelledby="ae-tab-contact" hidden>
  <div class="field-row section"><div class="field"><label for="ae-c-status">Show</label>
    <select id="ae-c-status"><option value="new">New</option><option value="answered">Answered</option><option value="closed">Closed</option><option value="">All</option></select></div></div>
  <div id="ae-c-list" aria-live="polite"></div>
</section>
<section id="ae-announce" role="tabpanel" aria-labelledby="ae-tab-announce" hidden>
  <form class="card section" id="ae-a-form" novalidate>
    <div class="field"><label for="ae-a-subject">Subject</label><input id="ae-a-subject" name="subject" required maxlength="150"></div>
    <div class="field"><label for="ae-a-body">Message</label><textarea id="ae-a-body" name="body" rows="10" required maxlength="20000"></textarea><p class="hint">Plain text. Blank lines start new paragraphs. An unsubscribe link is added automatically. People who turned off product news don't receive it.</p></div>
    <div class="field"><label for="ae-a-aud">Audience</label>
      <select id="ae-a-aud" name="audience"><option value="all">Everyone</option><option value="paid">People with a paid plan</option><option value="free">People on Free</option></select></div>
    <div id="ae-a-msg" aria-live="polite"></div>
    <div class="card-foot field-row">
      <button class="btn btn-ghost" type="button" id="ae-a-test">Send a test to me</button>
      <button class="btn btn-primary" type="button" id="ae-a-send" disabled>Send to audience…</button>
    </div>
  </form>
</section>
`;
export default body;
