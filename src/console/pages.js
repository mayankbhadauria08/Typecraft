// The console's pages: the frame of each one (headings, empty tables with loading rows).
// Each page's own script in site/console/ then asks for that page's data only.
// Adding a page: add it here, list its module in ./modules.js with the same key and
// path, and name the permission its API handlers check. See docs/ADMIN-CONSOLE.md §6.
import { icon, esc } from '../layout.js';
import { ROLE_LABELS, IDLE_MS, MAX_MS } from './config.js';
import { LAYERS } from './permissions.js';

const skeletonRows = (n, cols) => Array.from({ length: n }, () =>
  `<tr class="skeleton-row" aria-hidden="true">${Array.from({ length: cols }, (_, c) => `<td><span class="skeleton${c === 0 ? ' skeleton-wide' : ''}"></span></td>`).join('')}</tr>`).join('');

/* ---------- Home ---------- */
function homeBody(me) {
  const role = ROLE_LABELS[me.role] || me.role;
  const canSetup = me.permissions.includes('settings.view');
  const groups = LAYERS.map((layer, i) => {
    const items = me.granted.filter((g) => g.layer === layer.key);
    if (!items.length) return '';
    return `<div class="can"><h3><span class="keychip" aria-hidden="true">${i + 1}</span>${esc(layer.label)}</h3>
<ul>${items.map((g) => `<li>${icon('check')}<span>${esc(g.label)}</span></li>`).join('')}</ul></div>`;
  }).join('');
  return `<div class="page-head">
<h1>Home</h1>
<p class="page-sub">You're signed in as ${esc(role)}.</p>
</div>

<div class="notice">${icon('info')}<div><p><strong>This console is being built in phases.</strong> Roles and permissions are ready here. Customers, payments, packages and emails are still managed in the current admin until each one is rebuilt in this console.</p>
<p><a href="/admin" target="_blank" rel="noopener">Open the current admin</a>. It uses your normal TypeCraft sign-in.</p></div></div>

<div class="cols">
<section class="panel" aria-labelledby="sessionTitle">
<h2 id="sessionTitle">Your session</h2>
<dl class="facts">
<div><dt>Role</dt><dd><span class="badge badge-role">${esc(role)}</span></dd></div>
<div><dt>Signed in with</dt><dd>${me.session.secondFactor ? 'Password and a code sent by email' : 'Password'}</dd></div>
<div><dt>Device</dt><dd>${esc(me.session.device || 'Unknown')}</dd></div>
<div><dt>Started</dt><dd data-time="${esc(me.session.createdAt)}">–</dd></div>
<div><dt>Ends</dt><dd data-session-ends>–</dd></div>
</dl>
<p class="hint">You're signed out after ${Math.round(IDLE_MS / 60000)} minutes without activity, and after ${Math.round(MAX_MS / 3600000)} hours at the latest.</p>
<button type="button" class="btn btn-quiet" data-sign-out>${icon('logout')}<span>Sign out</span></button>
</section>

${canSetup ? `<section class="panel" aria-labelledby="setupTitle">
<div class="panel-head"><h2 id="setupTitle">Setup</h2><span class="panel-meta" id="setupCount"></span></div>
<p class="panel-sub">The services this site depends on, and whether each is switched on. Secret values are never shown.</p>
<ul class="checklist" id="setupList" aria-busy="true">
${Array.from({ length: 6 }, () => '<li class="skeleton-item" aria-hidden="true"><span class="skeleton skeleton-dot"></span><span class="skeleton skeleton-wide"></span></li>').join('')}
</ul>
<p class="hint">Settings are added in Cloudflare: Workers &amp; Pages, typecraft, Settings, Variables and secrets. Choose the type Secret.</p>
</section>` : ''}
</div>

<section class="block" aria-labelledby="canTitle">
<h2 id="canTitle">What your role can do</h2>
${groups ? `<div class="can-grid">${groups}</div>` : '<p class="hint">Your role has no permissions switched on. Ask a Super Admin.</p>'}
</section>`;
}

/* ---------- Roles and permissions ---------- */
function rolesBody() {
  return `<div class="page-head">
<h1>Roles and permissions</h1>
<p class="page-sub">What each role can do. A change applies straight away to everyone with that role.</p>
</div>

<div class="notice notice-quiet" id="readOnlyNote" hidden>${icon('eye')}<div><p>Only a Super Admin can change permissions. You can see them here.</p></div></div>

<section class="block" aria-labelledby="gridTitle">
<div class="block-head"><h2 id="gridTitle">Permissions</h2>
<div class="block-actions" id="gridActions" hidden>
<button type="button" class="btn btn-quiet btn-sm" data-reset="admin" disabled>Reset Admin to defaults</button>
<button type="button" class="btn btn-quiet btn-sm" data-reset="support" disabled>Reset Support to defaults</button>
</div></div>
<div class="table-panel">
<table class="grid" id="grid" aria-busy="true">
<thead><tr>
<th scope="col">Permission</th>
<th scope="col" class="col-role col-owner">Super Admin</th>
<th scope="col" class="col-role">Admin<span class="count" id="countAdmin"></span></th>
<th scope="col" class="col-role">Support<span class="count" id="countSupport"></span></th>
</tr></thead>
<tbody id="gridBody">${skeletonRows(8, 4)}</tbody>
</table>
</div>
<p class="hint">Super Admin always has every permission. A row with a lock can never be given to another role. A dot marks a switch that differs from the default.</p>
</section>

<section class="block" aria-labelledby="staffTitle">
<div class="block-head"><h2 id="staffTitle">People with admin access</h2></div>
<div class="notice notice-warn" id="ownerGap" role="alert" hidden>${icon('alert')}<div><p><strong id="ownerGapCount"></strong> Whoever signs up with that email first becomes Super Admin. Create the account now, or take the email out of OWNER_EMAILS.</p></div></div>
<div class="table-panel">
<table class="list" id="staff" aria-busy="true">
<thead><tr><th scope="col">Person</th><th scope="col" class="col-fit">Role</th><th scope="col" class="col-wide">Last admin sign-in</th><th scope="col" class="col-fit">Account</th></tr></thead>
<tbody id="staffBody">${skeletonRows(2, 4)}</tbody>
</table>
</div>
<p class="hint" id="staffHint">Super Admins are the emails in the OWNER_EMAILS setting in Cloudflare. To give someone the Admin or Support role today, open their profile under <a href="/admin/users" target="_blank" rel="noopener">Users in the current admin</a>. Managing administrators moves into this console in Phase 5.</p>
</section>`;
}

export const PAGES = [
  { key: 'home', path: '', title: 'Home', crumbs: ['Home'], body: homeBody, scripts: ['home.js'] },
  { key: 'roles', path: '/roles', title: 'Roles and permissions', crumbs: ['Infrastructure', 'Roles and permissions'],
    permission: 'roles.view', body: rolesBody, scripts: ['roles.js'] },
];

/** The page for a path below CONSOLE_BASE ('' is home), or null. */
export const findConsolePage = (sub) => PAGES.find((p) => p.path === sub) || null;
