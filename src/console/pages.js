// The console's pages: the frame of each one (headings, empty tables with loading rows).
// Each page's own script in site/console/ then asks for that page's data only.
// Adding a page: add it here, list its module in ./modules.js with the same key and
// path, and name the permission its API handlers check. See docs/ADMIN-CONSOLE.md §6.
// A page with an id in its address has `match` and `names` in place of `path`, and keeps
// its module's key so the sidebar shows where you are.
import { esc } from '../layout.js';
import { icon } from './icons.js';
import { CONSOLE_BASE, ROLE_LABELS, IDLE_MS, MAX_MS } from './config.js';
import { LAYERS } from './permissions.js';
import { LAYERS as MODULE_LAYERS } from './modules.js';
import { skeletonRows, lines, select, section, listFrame, downloadButton } from './page-kit.js';
import { CORE_PAGES } from './pages-core.js';

/* ---------- Home ---------- */
// What the current admin (/admin) looks after, by the console module that takes it over.
const OLD_ADMIN = [['customers', 'customers'], ['payments', 'payments'], ['packages', 'packages'], ['emails', 'emails']];

const wordList = (words) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

/** The notice on Home: what is ready here and what the current admin still looks after.
 *  Read from the module list, so it stays true as each module is built. */
function phaseNotice(me) {
  const built = MODULE_LAYERS.flatMap((layer) => layer.modules).filter((m) => m.path);
  const open = built.filter((m) => me.permissions.includes(m.permission));
  const waiting = OLD_ADMIN.filter(([key]) => !built.some((m) => m.key === key)).map(([, word]) => word);
  const ready = open.length ? ` Ready here: ${open.map((m) => `<a href="${CONSOLE_BASE}${m.path}">${esc(m.label)}</a>`).join(', ')}.` : '';
  const list = wordList(waiting);
  const old = waiting.length
    ? ` ${list.charAt(0).toUpperCase()}${list.slice(1)} ${waiting.length === 1 ? 'is' : 'are'} still managed in the current admin until ${waiting.length === 1 ? 'it is' : 'each one is'} rebuilt in this console.`
    : '';
  return `<div class="notice">${icon('info')}<div><p><strong>This console is being built in phases.</strong>${ready}${old}</p>
<p><a href="/admin" target="_blank" rel="noopener">Open the current admin</a>. It uses your normal TypeCraft sign-in.</p></div></div>`;
}

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

${phaseNotice(me)}

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
<table class="list fold" id="staff" aria-busy="true">
<thead><tr><th scope="col">Person</th><th scope="col" class="col-fit">Role</th><th scope="col" class="col-wide">Last admin sign-in</th><th scope="col" class="col-fit">Account</th></tr></thead>
<tbody id="staffBody">${skeletonRows(2, 4)}</tbody>
</table>
</div>
<p class="hint" id="staffHint">Super Admins are the emails in the OWNER_EMAILS setting in Cloudflare. To give someone the Admin or Support role today, open their profile under <a href="/admin/users" target="_blank" rel="noopener">Users in the current admin</a>. Managing administrators moves into this console in Phase 5.</p>
</section>`;
}

/* ---------- Customers ---------- */
function customersBody(me) {
  return listFrame({
    title: 'Customers',
    sub: 'Everyone with a TypeCraft account. Open a customer to see their plan, payments and progress.',
    action: me.permissions.includes('customers.export') ? downloadButton() : '',
    label: 'Find customers',
    search: { label: 'Search customers', placeholder: 'Name, email or phone' },
    filters: [
      select('plan', 'Plan', [['', 'All plans'], ['free', 'Free'], ['paid', 'Any paid plan']]),
      select('status', 'Account', [['', 'All accounts'], ['active', 'Active'], ['disabled', 'Disabled']]),
      select('verified', 'Email', [['', 'Email: any'], ['1', 'Email verified'], ['0', 'Email not verified']]),
      select('joined', 'Joined', [['', 'Joined: any time'], ['today', 'Joined today'], ['7d', 'Joined in the last 7 days'], ['30d', 'Joined in the last 30 days']]),
      select('sort', 'Order', [['', 'Newest first'], ['oldest', 'Oldest first'], ['login', 'Last sign-in'], ['name', 'Name A to Z']]),
    ].join('\n'),
    heads: [['Customer'], ['Phone', 'col-wide'], ['Plan'], ['Account', 'col-fit'], ['Joined', 'col-wide'], ['Last sign-in', 'col-wide']],
  });
}

function customerBody(me) {
  const has = (k) => me.permissions.includes(k);
  return `<a class="back" href="${esc(CONSOLE_BASE)}/customers">${icon('arrowLeft')}<span>Customers</span></a>

<div class="empty empty-page" id="custMissing" hidden>
<div class="empty-icon">${icon('help')}</div>
<h1 id="custMissingTitle">Customer not found</h1>
<p id="custMissingText">There is no account with this ID. It may have been deleted.</p>
<a class="btn btn-quiet" href="${esc(CONSOLE_BASE)}/customers">Back to customers</a>
</div>

<div id="custPage" aria-busy="true">
<div class="detail-head">
<span class="avatar avatar-lg" id="custAvatar" aria-hidden="true"></span>
<div class="detail-title"><h1 id="custName"><span class="skeleton skeleton-wide"></span></h1>
<p class="page-sub" id="custEmail"><span class="skeleton"></span></p>
<div class="badges" id="custBadges"></div></div>
<div class="detail-actions" id="custActions"></div>
</div>
<p class="hint" id="custBlock" hidden></p>

<div class="detail-grid">
<div class="detail-main">
${section('plan', 'Plan', lines(3))}
${has('payments.view') ? section('orders', 'Payments', lines(3)) : ''}
${section('progress', 'Progress', lines(4))}
<section class="block" aria-labelledby="notesTitle">
<div class="block-head"><h2 id="notesTitle">Notes</h2><span class="panel-meta">Only staff see these</span></div>
${has('customers.notes') ? `<form class="note-form" id="noteForm" novalidate>
<label class="vh" for="noteText">New note</label>
<textarea id="noteText" name="body" rows="3" maxlength="2000" placeholder="For example: asked for an invoice copy by email on 12 Nov."></textarea>
<p class="err" id="noteErr" hidden></p>
<div class="note-form-foot"><span class="panel-meta" id="noteCount">0 of 2,000</span><button type="submit" class="btn btn-quiet btn-sm" id="noteBtn">Add note</button></div>
</form>` : ''}
<div id="notesBody">${lines(2)}</div>
</section>
${has('emails.view') ? section('emails', 'Emails sent', lines(3)) : ''}
${has('audit.view') ? section('activity', 'Admin activity', lines(3), '<span class="panel-meta">Changes staff made to this account</span>') : ''}
</div>
<aside class="detail-side" aria-label="Account details">
<section class="panel" aria-labelledby="accountTitle"><h2 id="accountTitle">Account</h2><div id="accountBody">${lines(5)}</div></section>
<section class="panel" aria-labelledby="devicesTitle"><h2 id="devicesTitle">Devices and sign-ins</h2><div id="devicesBody">${lines(3)}</div></section>
</aside>
</div>
</div>`;
}

export const PAGES = [
  { key: 'home', path: '', title: 'Home', crumbs: ['Home'], body: homeBody, scripts: ['home.js'] },
  { key: 'customers', path: '/customers', title: 'Customers', crumbs: ['Core operations', 'Customers'],
    permission: 'customers.view', body: customersBody, scripts: ['customers.js'] },
  { key: 'customers', match: /^\/customers\/([\w-]{1,64})$/, names: ['id'], title: 'Customer', crumbs: ['Core operations', ['Customers', '/customers'], 'Customer'],
    permission: 'customers.view', body: customerBody, scripts: ['plan-actions.js', 'customer.js'] },
  ...CORE_PAGES,
  { key: 'roles', path: '/roles', title: 'Roles and permissions', crumbs: ['Infrastructure', 'Roles and permissions'],
    permission: 'roles.view', body: rolesBody, scripts: ['roles.js'] },
];

/** The page for a path below CONSOLE_BASE ('' is home): { page, params }, or null. An exact address wins over one with an id. */
export function findConsolePage(sub) {
  const exact = PAGES.find((page) => page.path === sub);
  if (exact) return { page: exact, params: {} };
  for (const page of PAGES) {
    const m = page.match && sub.match(page.match);
    if (m) return { page, params: Object.fromEntries(page.names.map((n, i) => [n, m[i + 1]])) };
  }
  return null;
}
