// Page frames for Layer 3, business growth (docs/ADMIN-PHASE-4.md): Support and Business reports.
// Each frame carries no data; its script in site/console/ asks for it.
import { esc } from '../layout.js';
import { icon } from './icons.js';
import { lines, select, section, panel, listFrame, recordFrame } from './page-kit.js';
import { TOPICS } from './support-api.js';

const has = (me, k) => me.permissions.includes(k);
const tiles = (id, n) => `<div class="tiles" id="${id}">${Array.from({ length: n }, () => '<div class="tile" aria-hidden="true"><span class="skeleton"></span><span class="skeleton skeleton-wide"></span></div>').join('')}</div>`;
const block = (id, title, inner, meta = '') => `<section class="block" aria-labelledby="${id}Title"><div class="block-head"><h2 id="${id}Title">${esc(title)}</h2>${meta}</div><div id="${id}Body">${inner}</div></section>`;

/* ---------- Support ---------- */
function supportBody() {
  return listFrame({
    title: 'Support',
    sub: 'Messages sent through the contact form. Open one to reply by email, add a note for the team, or close it. New messages come first.',
    label: 'Find messages',
    search: { label: 'Search messages', placeholder: 'Name, email or words in the message' },
    filters: [
      select('status', 'Status', [['', 'All messages'], ['open', 'Not closed'], ['new', 'New'], ['answered', 'Answered'], ['closed', 'Closed']]),
      select('topic', 'Topic', [['', 'All topics'], ...Object.entries(TOPICS)]),
      select('who', 'Looked after by', [['', 'Anyone'], ['me', 'Given to me'], ['none', 'Not given to anyone']]),
    ].join('\n'),
    heads: [['From'], ['Message', 'col-wide'], ['Topic', 'col-wide'], ['Status', 'col-fit'], ['Looked after by', 'col-wide'], ['Received', 'col-wide']],
    note: '<div class="seg-counts" id="statusCounts" aria-live="polite"></div>',
  });
}

function messageBody(me) {
  const reply = has(me, 'support.reply') ? `<section class="block" aria-labelledby="replyTitle" id="replyBlock" hidden>
<div class="block-head"><h2 id="replyTitle">Reply by email</h2><span class="panel-meta" id="replyTo"></span></div>
<form class="note-form" id="replyForm" novalidate>
<label class="vh" for="replyText">Your reply</label>
<textarea id="replyText" name="body" rows="7" maxlength="5000" placeholder="Write your answer. It is emailed from the support address, and their answer comes back to the support inbox."></textarea>
<p class="err" id="replyErr" hidden></p>
<div class="note-form-foot">
<label class="pick"><span class="vh">After sending</span><select id="replyThen" name="then"><option value="answered">Then mark it answered</option>${has(me, 'support.manage') ? '<option value="closed">Then close it</option>' : ''}</select></label>
<span class="panel-meta" id="replyCount">0 of 5,000</span>
<button type="submit" class="btn btn-primary btn-sm" id="replyBtn">${icon('send')}<span>Send reply</span></button>
</div>
</form>
</section>` : '';
  const note = has(me, 'support.manage') ? `<form class="note-form" id="noteForm" novalidate>
<label class="vh" for="noteText">New note</label>
<textarea id="noteText" name="body" rows="2" maxlength="2000" placeholder="A note for the team. The customer never sees it."></textarea>
<p class="err" id="noteErr" hidden></p>
<div class="note-form-foot"><span class="panel-meta">Only staff see notes</span><button type="submit" class="btn btn-quiet btn-sm" id="noteBtn">Add note</button></div>
</form>` : '';
  return recordFrame({
    back: ['Support', '/support'],
    missing: ['Message not found', 'There is no message with this ID. It may have been deleted with its account.'],
    main: `${section('msg', 'Message', lines(4))}
<section class="block" aria-labelledby="threadTitle"><div class="block-head"><h2 id="threadTitle">Replies and notes</h2></div>
<div id="threadBody">${lines(2)}</div>
${note}
</section>
${reply}`,
    side: `${panel('sender', 'From', 4)}
${panel('handling', 'Handling', 3)}
${panel('earlier', 'Earlier messages from them', 2)}`,
    sideLabel: 'About this message',
  });
}

/* ---------- Business reports ---------- */
function reportsBody() {
  return `<div class="page-head page-head-row">
<div><h1>Business reports</h1>
<p class="page-sub">Sales, refunds and sign-ups over the period you pick, in India days. A sale counts on the day it was paid, a refund on the day it was sent. Staff accounts are left out of sign-ups.</p></div>
<div class="block-actions"><button type="button" class="btn btn-quiet" id="exportDays">${icon('download')}<span>Download by day</span></button>
<button type="button" class="btn btn-quiet" id="exportPlans">${icon('download')}<span>Download by plan</span></button></div>
</div>
<div class="dash-bar">
<div class="seg" role="group" aria-label="Period" id="rangePick">
<button type="button" data-range="7d" aria-pressed="false">Last 7 days</button><button type="button" data-range="30d" aria-pressed="true">Last 30 days</button><button type="button" data-range="90d" aria-pressed="false">Last 90 days</button><button type="button" data-range="12m" aria-pressed="false">Last 12 months</button>
</div>
<button type="button" class="btn btn-quiet btn-sm" id="refreshBtn">${icon('refresh')}<span>Refresh</span></button>
<span class="list-meta" id="dashUpdated" aria-live="polite"></span>
</div>
<div id="dash" aria-busy="true">
<section class="block" aria-labelledby="moneyTitle"><div class="block-head"><h2 id="moneyTitle">Money</h2></div>${tiles('moneyTiles', 4)}</section>
${block('net', 'Net sales', `<div class="chart" id="netChart">${lines(3)}</div>`, '<span class="panel-meta" id="netMeta"></span>')}
<div class="dash-cols dash-cols-even">
${block('plans', 'Sales by plan', lines(4))}
${block('reasons', 'Why money went back', lines(3))}
</div>
<section class="block" aria-labelledby="peopleTitle"><div class="block-head"><h2 id="peopleTitle">Customers</h2></div>${tiles('peopleTiles', 4)}</section>
${block('signups', 'Sign-ups', `<div class="chart" id="signupChart">${lines(3)}</div>`)}
${block('renewals', 'Plans ending soon', lines(4), '<span class="panel-meta" id="renewalsMeta"></span>')}
</div>`;
}

export const GROWTH_PAGES = [
  { key: 'support', path: '/support', title: 'Support', crumbs: ['Business growth', 'Support'],
    permission: 'support.view', body: supportBody, scripts: ['support.js'] },
  { key: 'support', match: /^\/support\/(msg_[\w-]{1,64})$/, names: ['id'], title: 'Message', crumbs: ['Business growth', ['Support', '/support'], 'Message'],
    permission: 'support.view', body: messageBody, scripts: ['support-message.js'] },
  { key: 'reports', path: '/reports', title: 'Business reports', crumbs: ['Business growth', 'Business reports'],
    permission: 'revenue.view', body: reportsBody, scripts: ['charts.js', 'reports.js'] },
];
