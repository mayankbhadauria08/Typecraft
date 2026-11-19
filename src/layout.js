// Server-rendered page shell (docs/SAAS-CONTRACTS.md §8, §11): <head> with title,
// description, canonical, Open Graph, JSON-LD; one of five layouts (site, auth,
// account, admin, bare) around a page body. Pure functions: no I/O here.
import '../site/site.js'; // defines globalThis.TC_ICONS (the same icons the browser uses)

const ICONS = globalThis.TC_ICONS || {};
export const icon = (name) => ICONS[name] || '';
/** Bump when site/site.css or site/site.js change in a way old cached copies would break. */
export const ASSET_VERSION = '5';

export function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
/** JSON safe to place inside <script type="application/…json">. */
export function scriptJson(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const BRAND_MARK = '<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><rect class="bm-base" x="3" y="7" width="34" height="30" rx="8"/><rect class="bm-top" x="3" y="3" width="34" height="29" rx="8"/><path class="bm-glyph" d="M12.5 11.5h15v4.2h-5.3V25h-4.4v-9.3h-5.3z"/></svg>';
const brand = (href = '/') => `<a class="brand" href="${href}" aria-label="TypeCraft home">${BRAND_MARK}<span>type<em>craft</em></span></a>`;
const FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect x='3' y='7' width='34' height='30' rx='8' fill='%23177a6c'/%3E%3Crect x='3' y='3' width='34' height='29' rx='8' fill='%2345cdb6'/%3E%3Cpath d='M12.5 11.5h15v4.2h-5.3V25h-4.4v-9.3h-5.3z' fill='%230c1615'/%3E%3C/svg%3E";
const FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap';
// same theme as the app: typingMasterSettings.bg 'paper' (or the old 'light' theme) = light, before anything is drawn
const THEME_SCRIPT = "try{var s=JSON.parse(localStorage.getItem('typingMasterSettings')||'{}');if(s.bg==='paper'||(!s.bg&&localStorage.getItem('typingMasterTheme')==='light'))document.documentElement.setAttribute('data-theme','light')}catch(e){}";

/* The site header (docs/SAAS-CONTRACTS.md §8): two dropdown groups, Exam practice, a direct Arcade
   button, Pricing and For institutes. SITE_NAV stays the flat list of every link in it. */
export const NAV_LEARN = [
  ['/app', 'Course and trainer', 'Lessons from the home row to full speed', 'keyboard'],
  ['/practice', 'Typing practice', 'Free drills by level, key and word', 'target'],
  ['/typing-test', 'Typing test', 'Check your speed in 1, 3 or 5 minutes', 'clock'],
];
export const NAV_RESOURCES = [
  ['/features', 'Features', 'Everything TypeCraft does', 'sparkle'],
  ['/verify', 'Verify a certificate', 'Check a TypeCraft certificate is genuine', 'certificate'],
  ['/faq', 'FAQ', 'Answers to common questions', 'help'],
  ['/contact', 'Contact', 'Write to us', 'mail'],
];
const NAV_MORE = [
  ['/pricing', 'Pricing', 'Plans are one payment, nothing renews', 'rupee'],
  ['/contact?topic=institutes', 'For institutes', 'Labs, batches and certificates', 'users'],
];
export const SITE_NAV = [
  ...NAV_LEARN.map(([h, l, , i]) => [h, l, i]),
  ['/exam-practice', 'Exam practice', 'exam-practice'],
  ['/arcade', 'Arcade', 'gamepad'],
  ['/pricing', 'Pricing', 'pricing'],
  ['/contact?topic=institutes', 'For institutes', 'institutes'],
  ...NAV_RESOURCES.map(([h, l, , i]) => [h, l, i]),
];
/** People who help run an institute (or are invited to) get its pages after Certificates (docs/INSTITUTES.md §8). */
const withInstitute = (nav) => { const i = nav.findIndex(([h]) => h === '/account/certificates') + 1; return [...nav.slice(0, i), ['/institute', 'Institute', 'users'], ...nav.slice(i)]; };
export const ACCOUNT_NAV = [
  ['/dashboard', 'Dashboard', 'grid'],
  ['/app', 'Practice', 'keyboard'],
  ['/account/history', 'History', 'history'],
  ['/account/certificates', 'Certificates', 'certificate'],
  ['/account/analytics', 'Analytics', 'chart'],
  ['/account/plans', 'Plans', 'package'],
  ['/account/payments', 'Payments', 'card'],
  ['/account/invoices', 'Invoices', 'receipt'],
  ['/account/profile', 'Profile', 'user'],
  ['/account/settings', 'Settings', 'settings'],
];
export const ADMIN_NAV = [
  ['/admin', 'Overview', 'grid'],
  ['/admin/users', 'Users', 'users'],
  ['/admin/packages', 'Packages', 'package'],
  ['/admin/payments', 'Payments', 'card'],
  ['/admin/revenue', 'Revenue', 'trend'],
  ['/admin/emails', 'Emails', 'mail'],
  ['/admin/settings', 'Settings', 'settings'],
];

function initials(name, email) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const s = parts.length ? (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')) : String(email || '?')[0];
  return s.toUpperCase();
}
function planBadge(ent) {
  if (!ent || !ent.plan) return '';
  const paid = ent.plan !== 'free';
  return `<span class="badge ${paid ? 'badge-brand' : 'badge-muted'}" title="Your plan">${esc(ent.planName || ent.plan)}</span>`;
}
function current(path, href) {
  if (href === '/') return path === '/';
  return path === href || path.startsWith(href + '/');
}

function userMenu(ctx, withTheme) {
  const u = ctx.user;
  const first = String(u.fullName || '').trim().split(/\s+/)[0] || 'Account';
  const admin = ctx.role ? `<a role="menuitem" href="/admin">${icon('shield')}<span>Admin</span></a>` : '';
  return `<details class="user-menu">
  <summary aria-label="Account menu for ${esc(u.fullName || u.email)}"><span class="avatar" aria-hidden="true">${esc(initials(u.fullName, u.email))}</span><span class="um-name">${esc(first)}</span>${planBadge(ctx.entitlements)}${icon('chevronDown')}</summary>
  <div class="menu" role="menu">
    <div class="menu-head"><strong>${esc(u.fullName || '')}</strong><span class="muted">${esc(u.email || '')}</span></div>
    <a role="menuitem" href="/dashboard">${icon('grid')}<span>Dashboard</span></a>
    <a role="menuitem" href="/app">${icon('keyboard')}<span>Open the trainer</span></a>
    <a role="menuitem" href="/arcade">${icon('gamepad')}<span>Arcade</span></a>
    <a role="menuitem" href="/account/certificates">${icon('certificate')}<span>My certificates</span></a>
    ${ctx.institute ? `<a role="menuitem" href="/institute">${icon('users')}<span>Institute</span></a>` : ''}
    <a role="menuitem" href="/account/plans">${icon('package')}<span>Plans &amp; billing</span></a>
    <a role="menuitem" href="/account/profile">${icon('user')}<span>Profile</span></a>
    <a role="menuitem" href="/account/settings">${icon('settings')}<span>Account settings</span></a>
    ${admin}
    ${withTheme ? '<button type="button" role="menuitem" data-theme-toggle="menu" aria-pressed="false"><span>Switch theme</span></button>' : ''}
    <hr>
    <button type="button" role="menuitem" data-signout>${icon('logout')}<span>Sign out</span></button>
  </div>
</details>`;
}
const themeButton = '<button type="button" class="icon-btn" data-theme-toggle aria-pressed="false"><span class="sr-only">Switch theme</span></button>';

function navGroup(ctx, label, items) {
  const here = items.some(([href]) => current(ctx.path, href));
  const links = items.map(([href, text, sub, ic]) =>
    `<a href="${href}"${current(ctx.path, href) ? ' aria-current="page"' : ''}><span class="ng-ic" aria-hidden="true">${icon(ic)}</span><span class="ng-text"><b>${text}</b><small>${sub}</small></span></a>`).join('');
  return `<details class="nav-group"${here ? ' data-here' : ''}><summary>${label}${icon('chevronDown')}</summary><div class="nav-panel">${links}</div></details>`;
}
function navLink(ctx, href, inner, cls) {
  const here = current(ctx.path, href.split('?')[0]) && !href.includes('?');
  return `<a href="${href}"${cls ? ` class="${cls}"` : ''}${here ? ' aria-current="page"' : ''}>${inner}</a>`;
}
/** "4 days · 320 XP" from user_totals, filled in by the page loader for signed-in visitors. */
function streakChip(ctx) {
  const t = ctx.totals;
  if (!t) return '';
  const days = t.streak || 0, xp = t.xp || 0;
  const label = `${days} day${days === 1 ? '' : 's'} streak, ${xp} XP`;
  return `<a class="streak-chip" href="/dashboard" title="${label}" aria-label="${label}">${icon('bolt')}<span>${days} day${days === 1 ? '' : 's'}</span><span class="sc-dot" aria-hidden="true">·</span><span class="sc-xp">${xp} XP</span></a>`;
}
function siteHeader(ctx) {
  const links = [
    navGroup(ctx, 'Learn', NAV_LEARN),
    navLink(ctx, '/exam-practice', 'Exam practice <span class="nav-new">New</span>'),
    navLink(ctx, '/arcade', `${icon('gamepad')}<span>Arcade</span>`, 'nav-arcade'),
    // signed in, Upgrade stands in for Pricing, and both marketing links move into Resources
    ...(ctx.user ? [] : [navLink(ctx, '/pricing', 'Pricing'), navLink(ctx, '/contact?topic=institutes', 'For institutes')]),
    navGroup(ctx, 'Resources', ctx.user ? [...NAV_MORE, ...NAV_RESOURCES] : NAV_RESOURCES),
  ].join('');
  const free = !ctx.entitlements || !ctx.entitlements.plan || ctx.entitlements.plan === 'free';
  const actions = ctx.user
    ? `${streakChip(ctx)}${free ? '<a class="btn btn-upgrade btn-sm hide-sm" href="/account/plans">Upgrade</a>' : ''}<a class="btn btn-primary btn-sm hide-xs" href="/app">${icon('keyboard')}Open trainer</a>${userMenu(ctx, true)}`
    : `<a class="btn btn-ghost btn-sm" href="/login">Sign in</a><a class="btn btn-primary btn-sm" href="/signup">Start free</a>`;
  const mobileOnly = ctx.user ? '<a class="nav-only-mobile" href="/app">Open the trainer</a>' : '<a class="nav-only-mobile" href="/login">Sign in</a>';
  // signed in, the theme switch moves into the account menu to make room for the trainer button
  return `<header class="site-head${ctx.user ? ' signed-in' : ''}"><div class="container head-row">
  ${brand('/')}
  <nav class="site-nav" id="site-nav" aria-label="Main">${links}${mobileOnly}</nav>
  <div class="head-actions">${ctx.user ? '' : themeButton}${actions}
    <button type="button" class="icon-btn nav-toggle" data-nav-toggle aria-controls="site-nav" aria-expanded="false">${icon('menu')}<span class="sr-only">Menu</span></button>
  </div>
</div></header>`;
}

function siteFooter(ctx) {
  const year = new Date().getUTCFullYear();
  return `<footer class="site-foot"><div class="container">
  <div class="foot-grid">
    <div class="foot-brand">${brand('/')}<p class="muted">A calm, thorough typing course: 78 lessons, a coach that finds your weak keys, and an arcade to practise in. Made in India.</p></div>
    <nav aria-label="Product"><h2 class="foot-h">Product</h2><a href="/practice">Typing practice</a><a href="/typing-test">Typing test</a><a href="/exam-practice">Exam practice</a><a href="/features">Features</a><a href="/pricing">Pricing</a></nav>
    <nav aria-label="Company"><h2 class="foot-h">Company</h2><a href="/about">About</a><a href="/contact">Contact</a><a href="/faq">FAQ</a></nav>
    <nav aria-label="Legal"><h2 class="foot-h">Legal</h2><a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a><a href="/refund-policy">Refund &amp; cancellation</a></nav>
  </div>
  <div class="foot-base"><span>© ${year} TypeCraft</span><span>Payments are processed securely by Razorpay</span><a href="mailto:hello@typecrafttyping.com">hello@typecrafttyping.com</a></div>
</div></footer>`;
}

function shellLayout(ctx, body, nav, label) {
  const items = nav.map(([href, text, ic]) =>
    `<a href="${href}"${current(ctx.path, href) && !(href === '/admin' && ctx.path !== '/admin') ? ' aria-current="page"' : ''}>${icon(ic)}<span>${text}</span></a>`).join('');
  const tag = label === 'Admin' ? `<span class="badge badge-warn">${esc(ctx.role || 'admin')}</span>` : '';
  return `<header class="app-head"><div class="head-row">
  ${brand('/')}${tag}
  <div class="head-actions">${themeButton}${ctx.user ? userMenu(ctx) : ''}</div>
</div></header>
<div class="shell">
  <nav class="side-nav" aria-label="${label}">${items}</nav>
  <main id="main" class="shell-main" tabindex="-1">${body}</main>
</div>`;
}

function layoutBody(layout, ctx, body) {
  switch (layout) {
    case 'bare':
      return `<main id="main" class="bare-main" tabindex="-1">${body}</main>`;
    case 'auth':
      return `<header class="auth-head"><div class="container head-row">${brand('/')}<div class="head-actions">${themeButton}<a class="btn btn-ghost btn-sm" href="/">${icon('arrowLeft')}<span>Back to site</span></a></div></div></header>
<main id="main" class="auth-main" tabindex="-1">${body}</main>
<footer class="auth-foot"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Help</a></footer>`;
    case 'account':
      return shellLayout(ctx, body, ctx.institute ? withInstitute(ACCOUNT_NAV) : ACCOUNT_NAV, 'Account');
    case 'admin':
      return shellLayout(ctx, body, ADMIN_NAV, 'Admin');
    default:
      return `${siteHeader(ctx)}<main id="main" class="site-main" tabindex="-1">${body}</main>${siteFooter(ctx)}`;
  }
}

/**
 * page: { meta:{ title, description, path, layout?, noindex?, fullTitle?, ogType? }, body, scripts? }
 * ctx:  { siteUrl, path, user, entitlements, role, nonce, noindex, jsonld:[], data?, extraHead? }
 */
export function renderPage(page, ctx, body) {
  const meta = page.meta || {};
  const layout = meta.layout || 'site';
  const title = meta.fullTitle || `${meta.title} · TypeCraft`;
  const description = meta.description || 'Learn to touch type with TypeCraft: 78 lessons, a coach that finds your weak keys and an arcade.';
  const canonical = ctx.siteUrl + (ctx.canonicalPath || ctx.path);
  const robots = ctx.noindex ? '<meta name="robots" content="noindex, nofollow">' : '';
  const image = ctx.siteUrl + '/site/og-image.png';
  const nonce = ctx.nonce ? ` nonce="${esc(ctx.nonce)}"` : '';
  const jsonld = (ctx.jsonld || []).map((j) => `<script type="application/ld+json">${scriptJson(j)}</script>`).join('\n');
  const boot = { user: ctx.user || null, entitlements: ctx.entitlements || null, role: ctx.role || null };
  const data = ctx.data !== undefined ? `<script type="application/json" id="tc-data">${scriptJson(ctx.data)}</script>` : '';
  const scripts = ['/site/site.js?v=' + ASSET_VERSION, ...(page.scripts || [])]
    .map((src) => `<script src="${esc(src)}" defer></script>`).join('');
  return `<!DOCTYPE html>
<html lang="en-IN" data-theme="dark" data-layout="${esc(layout)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${robots}<link rel="canonical" href="${esc(canonical)}">
<meta property="og:site_name" content="TypeCraft">
<meta property="og:type" content="${esc(meta.ogType || 'website')}">
<meta property="og:title" content="${esc(meta.ogTitle || title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:locale" content="en_IN">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(meta.ogTitle || title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="theme-color" content="#070b0a">
<link rel="icon" type="image/svg+xml" href="${FAVICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="/site/site.css?v=${ASSET_VERSION}">
<script${nonce}>${THEME_SCRIPT}</script>
${jsonld}
<script type="application/json" id="tc-boot">${scriptJson(boot)}</script>
${data}${scripts}
</head>
<body class="layout-${esc(layout)}${page.bodyClass ? ' ' + esc(page.bodyClass) : ''}">
<a class="skip-link" href="#main">Skip to content</a>
${layoutBody(layout, ctx, body)}
</body>
</html>`;
}
