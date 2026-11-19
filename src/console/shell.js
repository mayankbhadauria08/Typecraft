// HTML for the admin console: the sign-in page and the shell (sidebar with the four
// layers, top bar) around each page body. Pure functions: no I/O here.
// Styles and behaviour: site/console/console.css, console.js. No inline scripts or styles,
// so the console's Content-Security-Policy can refuse both.
import { esc, scriptJson } from '../layout.js';
import { icon } from './icons.js';
import { CONSOLE_BASE, ROLE_LABELS } from './config.js';
import { HOME, LAYERS } from './modules.js';

/** Bump whenever a file in site/console/ changes: browsers and the service worker keep the old address cached. */
export const CONSOLE_ASSETS = '26';
// a name starting with / is a file from elsewhere on the site (the shared course rules in /shared/)
const asset = (name) => `${name.startsWith('/') ? name : '/site/console/' + name}?v=${CONSOLE_ASSETS}`;

const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap';
const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect x='3' y='7' width='34' height='30' rx='8' fill='%23177a6c'/%3E%3Crect x='3' y='3' width='34' height='29' rx='8' fill='%2345cdb6'/%3E%3Cpath d='M12.5 11.5h15v4.2h-5.3V25h-4.4v-9.3h-5.3z' fill='%230c1615'/%3E%3C/svg%3E";
const MARK = '<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="7" width="34" height="30" rx="8" fill="#177a6c"/><rect x="3" y="3" width="34" height="29" rx="8" fill="#45cdb6"/><path d="M12.5 11.5h15v4.2h-5.3V25h-4.4v-9.3h-5.3z" fill="#0c1615"/></svg>';
// icons the browser code draws (toasts, dialogs, tables): AC.icon() clones them from here
const CLIENT_ICONS = ['check', 'x', 'alert', 'info', 'lock', 'shield', 'refresh', 'external', 'minus', 'clock', 'mail', 'user', 'users', 'eye',
  'search', 'copy', 'note', 'trash', 'download', 'arrowLeft', 'arrowRight', 'chevronRight', 'calendar', 'card', 'devices', 'history', 'package', 'logout', 'chart', 'unlock', 'send', 'plus', 'sparkle', 'receipt'];

function head(title) {
  return `<!DOCTYPE html>
<html lang="en" data-console-base="${esc(CONSOLE_BASE)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${esc(title)} – TypeCraft Admin</title>
<link rel="icon" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${asset('console.css')}">
<script src="${asset('theme.js')}"></script>
</head>`;
}
const iconBank = () => `<template id="ac-icons">${CLIENT_ICONS.map((n) => `<span data-icon="${n}">${icon(n)}</span>`).join('')}</template>`;

function initials(name, email) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const s = parts.length ? parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '') : String(email || '?')[0];
  return s.toUpperCase();
}

/* ---------- sidebar ---------- */
function navItem(m, currentKey) {
  const cur = m.key === currentKey;
  return `<a class="nav-item${cur ? ' is-current' : ''}" href="${esc(CONSOLE_BASE + m.path)}"${cur ? ' aria-current="page"' : ''}>${icon(m.icon)}<span class="nav-label">${esc(m.label)}</span></a>`;
}
// a module that is not built yet: a label, not a link
function navSoon(m) {
  return `<span class="nav-item is-soon">${icon(m.icon)}<span class="nav-label">${esc(m.label)}</span><span class="chip">Phase ${m.phase}<span class="vh">, not built yet</span></span></span>`;
}
// `prefs`: { layerKey: true | false } for the layers the person opened or closed themselves (a cookie, see ./router.js)
function sidebar(permissions, currentKey, prefs) {
  const allowed = (m) => !m.permission || permissions.includes(m.permission);
  const groups = LAYERS.map((layer, i) => {
    const rows = layer.modules.map((m) => (m.path !== undefined ? (allowed(m) ? navItem(m, currentKey) : '') : navSoon(m))).join('');
    if (!rows) return ''; // nothing in this layer for this role
    // open: the layer you are in; otherwise your own choice; otherwise the layers that have something built
    const open = layer.modules.some((m) => m.key === currentKey)
      || (prefs[layer.key] !== undefined ? prefs[layer.key] : layer.modules.some((m) => m.path !== undefined && allowed(m)));
    return `<details class="nav-group" data-group="${esc(layer.key)}"${open ? ' open' : ''}>
<summary><span class="keychip" aria-hidden="true">${i + 1}</span><span class="nav-layer"><span class="vh">Layer ${i + 1}: </span>${esc(layer.label)}</span>${icon('chevronDown')}</summary>
<div class="nav-list">${rows}</div>
</details>`;
  }).join('\n');
  return `<aside class="side" id="side" aria-label="Admin navigation">
<div class="side-head"><a class="brand" href="${esc(CONSOLE_BASE)}" aria-label="TypeCraft admin home">${MARK}<span class="brand-name">TypeCraft</span><span class="brand-tag">Admin</span></a>
<button type="button" class="icon-btn nav-close" id="navClose" aria-label="Close navigation">${icon('x')}</button></div>
<div class="nav-search" id="navSearch">
<label class="vh" for="consoleSearch">Search customers, payments and pages</label>
<div class="nav-search-box">${icon('search')}<input id="consoleSearch" type="text" role="combobox" aria-expanded="false" aria-controls="consoleSearchList" aria-autocomplete="list" aria-describedby="consoleSearchKey" placeholder="Search" autocomplete="off" spellcheck="false" maxlength="80"><kbd id="consoleSearchKey" aria-label="Shortcut: Control K">Ctrl K</kbd></div>
<div class="nav-search-pop" id="consoleSearchPop" hidden><ul id="consoleSearchList" role="listbox" aria-label="Search results"></ul><p class="nav-search-note" id="consoleSearchNote" role="status"></p></div>
</div>
<nav class="side-nav" aria-label="Sections">
<div class="nav-list nav-top">${navItem(HOME, currentKey)}</div>
${groups}
</nav>
<div class="side-foot"><a class="nav-item" href="/" target="_blank" rel="noopener">${icon('external')}<span class="nav-label">Open the site</span></a></div>
</aside>`;
}

/* ---------- top bar ---------- */
function topbar(me, crumbs) {
  const first = String(me.user.fullName || '').trim().split(/\s+/)[0] || 'Account';
  const role = ROLE_LABELS[me.role] || me.role;
  // a crumb is a label, or [label, path below CONSOLE_BASE] for one that links back
  const trail = crumbs.map((c, i) => {
    const here = i === crumbs.length - 1;
    if (Array.isArray(c) && !here) return `<a class="crumb" href="${esc(CONSOLE_BASE + c[1])}">${esc(c[0])}</a>`;
    return `<span class="${here ? 'crumb is-here' : 'crumb'}">${esc(Array.isArray(c) ? c[0] : c)}</span>`;
  }).join('<span class="crumb-sep" aria-hidden="true">/</span>');
  return `<header class="top">
<button type="button" class="icon-btn nav-open" id="navOpen" aria-label="Open navigation" aria-controls="side" aria-expanded="false">${icon('menu')}</button>
<div class="crumbs">${trail}</div>
<div class="top-actions">
<button type="button" class="icon-btn" id="themeToggle" aria-label="Switch to dark theme"><span class="when-light">${icon('moon')}</span><span class="when-dark">${icon('sun')}</span></button>
<details class="user" id="userMenu">
<summary><span class="avatar" aria-hidden="true">${esc(initials(me.user.fullName, me.user.email))}</span><span class="user-name">${esc(first)}</span><span class="badge badge-role">${esc(role)}</span>${icon('chevronDown')}<span class="vh">Your admin account</span></summary>
<div class="menu">
<div class="menu-head"><strong>${esc(me.user.fullName || '')}</strong><span>${esc(me.user.email || '')}</span></div>
<dl class="facts facts-menu">
<div><dt>Role</dt><dd>${esc(role)}</dd></div>
<div><dt>Session ends</dt><dd data-session-ends>at the latest in 8 hours</dd></div>
</dl>
<button type="button" class="btn btn-quiet btn-block" data-sign-out>${icon('logout')}<span>Sign out</span></button>
</div>
</details>
</div>
</header>`;
}

/**
 * A console page. `page`: { key, title, crumbs?, body, scripts?, params? }; `me`: describe() from ./auth.js;
 * `navPrefs`: which layers the person keeps open or closed.
 */
export function renderShell(me, page, navPrefs = {}) {
  const crumbs = page.crumbs || [page.title];
  const boot = { me, page: { key: page.key, title: page.title, params: page.params || {} } };
  const scripts = ['console.js', ...(page.scripts || [])].map((s) => `<script src="${asset(s)}" defer></script>`).join('\n');
  return `${head(page.title)}
<body class="console">
<a class="skip" href="#main">Skip to content</a>
<div class="app">
${sidebar(me.permissions, page.key, navPrefs)}
<div class="scrim" id="scrim" hidden></div>
<div class="main">
${topbar(me, crumbs)}
<main id="main" class="content" tabindex="-1">
${page.body}
</main>
</div>
</div>
<div class="toasts" id="toasts" role="status" aria-live="polite"></div>
${iconBank()}
<script type="application/json" id="console-boot">${scriptJson(boot)}</script>
${scripts}
</body>
</html>`;
}

/** The sign-in page (public). `next`: a checked console path to open after signing in. */
export function renderLogin({ next = '', notReady = false } = {}) {
  const forms = notReady
    ? `<div class="login-form">
<h1>Admin sign in</h1>
<div class="alert alert-warn" role="alert">${icon('alert')}<span>The admin console isn't switched on yet. Database update 0005 has to be applied first.</span></div>
</div>`
    : `<form id="stepPassword" class="login-form" novalidate>
<h1>Admin sign in</h1>
<p class="lede">For TypeCraft staff. Use the email and password of your TypeCraft account.</p>
<div class="alert alert-info" id="endedNote" hidden>${icon('clock')}<span>Your admin session ended. Sign in again to carry on.</span></div>
<div class="alert alert-bad" id="loginError" role="alert" hidden>${icon('alert')}<span></span></div>
<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" required><p class="err" id="emailErr" hidden></p></div>
<div class="field"><label for="password">Password</label><div class="with-action"><input id="password" name="password" type="password" autocomplete="current-password" required><button type="button" class="field-action" id="showPassword" aria-pressed="false">Show</button></div><p class="err" id="passwordErr" hidden></p></div>
<button type="submit" class="btn btn-primary btn-block" id="loginBtn">Continue</button>
</form>

<form id="stepCode" class="login-form" novalidate hidden>
<h1>Check your email</h1>
<p class="lede">We sent a 6-digit code to <strong id="sentTo"></strong>. It works once and expires in 10 minutes.</p>
<div class="alert alert-bad" id="codeError" role="alert" hidden>${icon('alert')}<span></span></div>
<div class="alert alert-ok" id="codeNote" hidden>${icon('check')}<span></span></div>
<div class="field"><label for="code">Sign-in code</label><input id="code" name="code" class="code-input" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000" required><p class="err" id="codeErr" hidden></p></div>
<button type="submit" class="btn btn-primary btn-block" id="codeBtn">Sign in</button>
<div class="login-row"><button type="button" class="btn-link" id="resendBtn">Send a new code</button><button type="button" class="btn-link" id="restartBtn">Use a different account</button></div>
</form>`;
  return `${head('Sign in')}
<body class="console login-page">
<main class="login" id="main" data-next="${esc(next)}">
<div class="login-card">
<div class="login-brand">${MARK}<span class="brand-name">TypeCraft</span><span class="brand-tag">Admin</span></div>
${forms}
<p class="login-foot">${icon('shield')}<span>Sign-ins to this area are recorded.</span></p>
</div>
<p class="login-back"><a href="/">Back to the TypeCraft site</a></p>
</main>
${notReady ? '' : `<script src="${asset('login.js')}" defer></script>`}
</body>
</html>`;
}

/** A plain message inside the shell (no access, not found). */
export function messageBody(kind, title, text) {
  return `<section class="empty empty-page">
<div class="empty-icon">${icon(kind === 'forbidden' ? 'lock' : 'help')}</div>
<h1>${esc(title)}</h1>
<p>${esc(text)}</p>
<a class="btn btn-quiet" href="${esc(CONSOLE_BASE)}">Back to admin home</a>
</section>`;
}
