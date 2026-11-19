// The console's Infrastructure pages from Phase 5a: Settings, Integrations, System health, and the email
// templates (listed under Email campaigns). Frames only; each page's script in site/console/ fills them.
// docs/ADMIN-PHASE-5.md.
import { esc } from '../layout.js';
import { icon } from './icons.js';
import { CONSOLE_BASE } from './config.js';
import { lines, section } from './page-kit.js';

const tools = (id) => `<div class="block-actions" id="${id}Tools"></div>`;
const tiles = (id, n) => `<div class="tiles" id="${id}">${Array.from({ length: n }, () => '<div class="tile"><span class="skeleton"></span><span class="skeleton skeleton-wide"></span></div>').join('')}</div>`;

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
  { key: 'settings', path: '/settings', title: 'Settings', crumbs: ['Infrastructure', 'Settings'],
    permission: 'settings.view', body: settingsBody, scripts: ['settings.js'] },
  { key: 'integrations', path: '/integrations', title: 'Integrations', crumbs: ['Infrastructure', 'Integrations'],
    permission: 'integrations.view', body: integrationsBody, scripts: ['integrations.js'] },
  { key: 'system-health', path: '/system-health', title: 'System health', crumbs: ['Infrastructure', 'System health'],
    permission: 'health.view', body: healthBody, scripts: ['health.js'] },
  { key: 'emails', path: '/email-templates', title: 'Email templates', crumbs: ['Business growth', ['Email campaigns', '/campaigns'], 'Email templates'],
    permission: 'emails.view', body: templatesBody, scripts: ['email-templates.js'] },
];
