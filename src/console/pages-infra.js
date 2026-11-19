// The console's Infrastructure pages (Phase 5): Administrators, Activity logs, Security, Settings, Integrations,
// System health, and the email templates (listed under Email campaigns). Frames only; each page's script in
// site/console/ fills them. docs/ADMIN-PHASE-5.md.
import { esc } from '../layout.js';
import { icon } from './icons.js';
import { CONSOLE_BASE } from './config.js';
import { lines, section, listFrame, select, dayField, downloadButton, skeletonRows } from './page-kit.js';

const tools = (id) => `<div class="block-actions" id="${id}Tools"></div>`;
const tiles = (id, n) => `<div class="tiles" id="${id}">${Array.from({ length: n }, () => '<div class="tile"><span class="skeleton"></span><span class="skeleton skeleton-wide"></span></div>').join('')}</div>`;

/* ---------- Administrators ---------- */
function administratorsBody(me) {
  const manage = me.permissions.includes('admins.manage');
  return `<div class="page-head page-head-row">
<div><h1>Administrators</h1>
<p class="page-sub">Everyone who can use this admin console, and their role. What each role can do is set under <a href="${esc(CONSOLE_BASE)}/roles">Roles and permissions</a>.</p></div>
${manage ? `<button type="button" class="btn btn-primary" id="addAdmin" disabled>${icon('plus')}<span>Add an administrator</span></button>` : ''}
</div>
<div id="adminNote"></div>
<div class="table-panel">
<table class="list fold" id="adminList" aria-busy="true">
<thead><tr><th scope="col">Person</th><th scope="col" class="col-fit">Role</th><th scope="col" class="col-wide">Added</th><th scope="col" class="col-wide">Last admin sign-in</th><th scope="col" class="col-fit"><span class="vh">Actions</span></th></tr></thead>
<tbody id="adminBody">${skeletonRows(3, 5)}</tbody>
</table>
</div>
<p class="hint">Administrators are TypeCraft accounts: the person signs up on the site first, then a Super Admin adds them here. Super Admins are the emails in the OWNER_EMAILS setting in Cloudflare and are changed there. Each person gets an email when their role changes.</p>`;
}

/* ---------- Activity logs ---------- */
function activityBody(me) {
  return listFrame({
    title: 'Activity logs',
    sub: 'Who changed what, and when: every change made in the admin, sign-ins to it, and payments confirmed by Razorpay. Newest first. IP addresses are kept for 90 days.',
    action: downloadButton(),
    label: 'Find activity',
    search: { label: 'Search the activity log', placeholder: "A customer's email, or an action" },
    filters: [
      select('kind', 'Kind', [['', 'Everything']]),
      select('actor', 'Who', [['', 'Anyone']]),
      dayField('from', 'From'),
      dayField('to', 'To'),
    ].join('\n'),
    heads: [['When', 'col-wide'], ['What'], ['Who', 'col-wide'], ['', 'col-fit']],
  });
}

/* ---------- Security ---------- */
function securityBody() {
  return `<div class="page-head page-head-row">
<div><h1>Security</h1>
<p class="page-sub">Who is signed in to the admin console, failed admin sign-ins, accounts locked after wrong passwords, and a few checks.</p></div>
</div>
<div id="securityNote"></div>
<div id="dash" aria-busy="true">
${section('checks', 'Checks', lines(4))}
${section('sessions', 'Signed in to the admin console now', lines(3), '<div class="block-actions" id="sessionsTools"></div>')}
<div class="dash-cols dash-cols-even">
${section('locks', 'Sign-in locks', lines(2))}
${section('failed', 'Failed admin sign-ins (7 days)', lines(2))}
</div>
${section('rules', 'How sign-in is protected', lines(4))}
</div>`;
}

/* ---------- Settings ---------- */
function settingsBody() {
  return `<div class="page-head">
<h1>Settings</h1>
<p class="page-sub">Business details for invoices, the support contact, and the switches for payments and sign-ups. Each change is saved on its own and recorded in the activity log.</p>
</div>
<div id="settingsNote"></div>
<div id="settingsPage" aria-busy="true">
<div class="dash-cols dash-cols-even">
${section('seller', 'Business details', lines(6), tools('seller'))}
${section('support', 'Support contact', lines(3), tools('support'))}
</div>
<div class="dash-cols dash-cols-even">
${section('payments', 'Payments', lines(3), tools('payments'))}
${section('signups', 'Sign-ups', lines(2), tools('signups'))}
</div>
${section('mailLimit', 'Campaign emails', lines(2))}
</div>`;
}

/* ---------- Integrations ---------- */
function integrationsBody() {
  return `<div class="page-head">
<h1>Integrations</h1>
<p class="page-sub">The outside services TypeCraft uses, and whether each is connected and working. Secret values are never shown here: only whether each one is installed.</p>
</div>
<div class="int-grid" id="intList" aria-busy="true">
${Array.from({ length: 4 }, () => `<section class="panel">${lines(4)}</section>`).join('')}
</div>
<p class="hint">Secrets are added in Cloudflare: Workers &amp; Pages, typecraft, Settings, Variables and secrets. Choose the type Secret. A new secret applies from the next request.</p>`;
}

/* ---------- System health ---------- */
function healthBody() {
  return `<div class="page-head page-head-row">
<div><h1>System health</h1>
<p class="page-sub">The background jobs, email sending, payments waiting for the bank, and the database. Problems show at the top.</p></div>
</div>
<div class="dash-bar">
<button type="button" class="btn btn-quiet btn-sm" id="refreshBtn">${icon('refresh')}<span>Refresh</span></button>
<span class="list-meta" id="dashUpdated" aria-live="polite"></span>
</div>
<div id="healthWarnings" aria-live="polite"></div>
<div id="dash" aria-busy="true">
<section class="block" aria-labelledby="jobsTitle"><div class="block-head"><h2 id="jobsTitle">Background jobs</h2><span class="panel-meta" id="jobsMeta"></span></div>
${tiles('jobTiles', 2)}
<div id="jobsBody">${lines(3)}</div></section>
<div class="dash-cols dash-cols-even">
${section('email', 'Email', lines(5))}
${section('payments', 'Payments', lines(4))}
</div>
<div class="dash-cols dash-cols-even">
${section('database', 'Database', lines(3))}
${section('plan', 'Plan and limits', lines(5))}
</div>
${section('migrations', 'Database updates', lines(4), '<span class="panel-meta" id="migrationsMeta"></span>')}
${section('learning', 'Practice saving', lines(3))}
</div>`;
}

/* ---------- Email templates (Email campaigns) ---------- */
function templatesBody() {
  return `<div class="page-head page-head-row">
<div><h1>Email templates</h1>
<p class="page-sub">Every email TypeCraft sends, filled with sample data so you can check how it looks. Nothing is sent from this page.</p></div>
<a class="btn btn-quiet" href="${esc(CONSOLE_BASE)}/campaigns">${icon('arrowLeft')}<span>Email campaigns</span></a>
</div>
<div class="tpl-layout">
<nav class="tpl-nav" id="tplNav" aria-label="Emails" aria-busy="true">${lines(8)}</nav>
<section class="tpl-view" aria-labelledby="tplTitle">
<div class="block-head"><h2 id="tplTitle"><span class="skeleton skeleton-wide"></span></h2>
<div class="seg" role="group" aria-label="Show"><button type="button" data-part="html" aria-pressed="true">Email</button><button type="button" data-part="text" aria-pressed="false">Plain text</button></div></div>
<p class="hint" id="tplAbout"></p>
<dl class="facts" id="tplFacts"></dl>
<div class="tpl-frame-wrap" id="tplFrameWrap"><iframe id="tplFrame" class="tpl-frame" title="Email preview" sandbox="" referrerpolicy="no-referrer"></iframe></div>
<pre class="tpl-text" id="tplText" hidden></pre>
</section>
</div>`;
}

export const INFRA_PAGES = [
  { key: 'administrators', path: '/administrators', title: 'Administrators', crumbs: ['Infrastructure', 'Administrators'],
    permission: 'roles.view', body: administratorsBody, scripts: ['administrators.js'] },
  { key: 'activity-logs', path: '/activity-logs', title: 'Activity logs', crumbs: ['Infrastructure', 'Activity logs'],
    permission: 'audit.view', body: activityBody, scripts: ['activity.js'] },
  { key: 'security', path: '/security', title: 'Security', crumbs: ['Infrastructure', 'Security'],
    permission: 'security.view', body: securityBody, scripts: ['security.js'] },
  { key: 'settings', path: '/settings', title: 'Settings', crumbs: ['Infrastructure', 'Settings'],
    permission: 'settings.view', body: settingsBody, scripts: ['settings.js'] },
  { key: 'integrations', path: '/integrations', title: 'Integrations', crumbs: ['Infrastructure', 'Integrations'],
    permission: 'integrations.view', body: integrationsBody, scripts: ['integrations.js'] },
  { key: 'system-health', path: '/system-health', title: 'System health', crumbs: ['Infrastructure', 'System health'],
    permission: 'health.view', body: healthBody, scripts: ['health.js'] },
  { key: 'emails', path: '/email-templates', title: 'Email templates', crumbs: ['Business growth', ['Email campaigns', '/campaigns'], 'Email templates'],
    permission: 'emails.view', body: templatesBody, scripts: ['email-templates.js'] },
];
