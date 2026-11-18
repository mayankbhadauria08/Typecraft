// Building blocks for the console's page frames (./pages.js, ./pages-core.js).
// A frame is the part of a page that never changes: headings, the filter bar, an empty table
// with loading rows. It carries no data; the page's script asks for that.
// The ids used here (filters, q, list, listBody, listCount, pager, clearFilters, recPage, …)
// are the ones AC.listPage() and AC.record() in site/console/console.js look for.
import { esc } from '../layout.js';
import { icon } from './icons.js';
import { CONSOLE_BASE } from './config.js';

export const skeletonRows = (n, cols) => Array.from({ length: n }, () =>
  `<tr class="skeleton-row" aria-hidden="true">${Array.from({ length: cols }, (_, c) => `<td><span class="skeleton${c === 0 ? ' skeleton-wide' : ''}"></span></td>`).join('')}</tr>`).join('');

export const lines = (n) => `<div class="loading-lines" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<span class="skeleton${i % 2 ? '' : ' skeleton-wide'}"></span>`).join('')}</div>`;

/* ---------- filters ---------- */
const option = ([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`;
/** A filter: a select whose first option means "any". */
export const select = (name, label, options) => `<label class="pick"><span class="vh">${esc(label)}</span><select name="${esc(name)}">${options.map(option).join('')}</select></label>`;
/** A filter: a day, with its label shown (a date field has no placeholder). */
export const dayField = (name, label) => `<label class="pick pick-day"><span>${esc(label)}</span><input type="date" name="${esc(name)}" min="2024-01-01" max="2099-12-31"></label>`;

/* ---------- a list page ---------- */
/**
 * { title, sub, action (html beside the title), label (what the filter bar finds),
 *   search: { label, placeholder } | null, filters (html), heads: [[text, class]], note (html under the title) }
 */
export function listFrame({ title, sub, action = '', label, search = null, filters = '', heads, note = '' }) {
  return `<div class="page-head page-head-row">
<div><h1>${esc(title)}</h1>
<p class="page-sub">${esc(sub)}</p></div>
${action}
</div>
${note}
<form class="toolbar" id="filters" role="search" aria-label="${esc(label)}">
${search ? `<div class="search">${icon('search')}<label class="vh" for="q">${esc(search.label)}</label><input id="q" name="q" type="search" placeholder="${esc(search.placeholder)}" autocomplete="off" spellcheck="false" maxlength="80"></div>` : ''}
${filters}
<button type="button" class="btn-link" id="clearFilters" hidden>Clear filters</button>
</form>

<p class="list-meta" id="listCount" aria-live="polite">&nbsp;</p>
<div class="table-panel">
<table class="list fold" id="list" aria-busy="true">
<thead><tr>${heads.map(([text, cls]) => `<th scope="col"${cls ? ` class="${esc(cls)}"` : ''}>${esc(text)}</th>`).join('')}</tr></thead>
<tbody id="listBody">${skeletonRows(8, heads.length)}</tbody>
</table>
</div>
<nav class="pager" id="pager" aria-label="Pages" hidden></nav>`;
}
export const downloadButton = (label = 'Download list') => `<button type="button" class="btn btn-quiet" id="exportBtn">${icon('download')}<span>${esc(label)}</span></button>`;

/* ---------- a record's page ---------- */
/** A titled part of a record's page; its script fills #<id>Body. */
export const section = (id, title, inner, meta = '') => `<section class="block" aria-labelledby="${id}Title">
<div class="block-head"><h2 id="${id}Title">${esc(title)}</h2>${meta}</div>
<div id="${id}Body">${inner}</div>
</section>`;
/** A boxed part for the narrow column. */
export const panel = (id, title, n = 3) => `<section class="panel" aria-labelledby="${id}Title"><h2 id="${id}Title">${esc(title)}</h2><div id="${id}Body">${lines(n)}</div></section>`;

/**
 * { back: [label, path below the console], missing: [title, text], main (html), side (html), sideLabel }
 * The script fills #recTitle, #recSub, #recBadges, #recActions and #recNote, and the sections.
 */
export function recordFrame({ back, missing, main, side = '', sideLabel = 'Details' }) {
  const backPath = esc(CONSOLE_BASE + back[1]);
  return `<a class="back" href="${backPath}">${icon('arrowLeft')}<span>${esc(back[0])}</span></a>

<div class="empty empty-page" id="recMissing" hidden>
<div class="empty-icon">${icon('help')}</div>
<h1 id="recMissingTitle">${esc(missing[0])}</h1>
<p id="recMissingText">${esc(missing[1])}</p>
<a class="btn btn-quiet" href="${backPath}">Back to ${esc(back[0].toLowerCase())}</a>
</div>

<div id="recPage" aria-busy="true">
<div class="detail-head">
<div class="detail-title"><h1 id="recTitle"><span class="skeleton skeleton-wide"></span></h1>
<p class="page-sub" id="recSub"><span class="skeleton"></span></p>
<div class="badges" id="recBadges"></div></div>
<div class="detail-actions" id="recActions"></div>
</div>
<div id="recNote"></div>

<div class="detail-grid${side ? '' : ' detail-grid-one'}">
<div class="detail-main">
${main}
</div>
${side ? `<aside class="detail-side" aria-label="${esc(sideLabel)}">
${side}
</aside>` : ''}
</div>
</div>`;
}
