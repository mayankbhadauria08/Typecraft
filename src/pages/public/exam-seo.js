// Shared pieces for the exam pages and the typing guides (docs/EXAM-MODES.md §6): the lists that
// link them to each other, the facts table, the FAQ section and the JSON-LD.
// Rules on these pages come from the exams' own notices where we could read them; where a
// notice is silent the page says so. Every page says the tests are TypeCraft's practice, not
// the exams' own software.
import { esc, icon } from '../../layout.js';
import { faqList, faqJsonLd } from './faq-data.js';

/** When the facts on these pages were last checked against the notices. */
export const CHECKED = '2026-11-20';
export const CHECKED_TEXT = '20 November 2026';

export const EXAM_PAGES = [
  { path: '/ssc-chsl-typing-test', name: 'SSC CHSL typing test', about: 'LDC and JSA: 35 words a minute in English, 10 minutes' },
  { path: '/ssc-dest-typing-test', name: 'SSC DEST and DEO skill test', about: '8,000 key depressions an hour, 15 minutes' },
  { path: '/cpct-typing-test', name: 'MP CPCT typing test', about: '30 net words a minute in English, 15 minutes, no Backspace' },
  { path: '/10-minute-typing-test', name: '10-minute typing test', about: 'The length of the SSC typing test, with live speed' },
];
export const GUIDES = [
  { path: '/guides/ssc-typing-test-marking', name: 'How the SSC typing test is marked', about: 'Full and half mistakes, with a worked example' },
  { path: '/guides/key-depressions-per-hour', name: 'Key depressions per hour, explained', about: 'What 8,000 an hour means, and how to work out yours' },
  { path: '/guides/gross-and-net-typing-speed', name: 'Gross speed, net speed and accuracy', about: 'How exam typing speed is worked out' },
];

/** Cards linking to other pages; `except` is the current page's path. */
export function linkCards(list, except, cls = 'grid-4') {
  return `<div class="${cls}">${list.filter((p) => p.path !== except).map((p) =>
    `<div class="card"><h3><a href="${p.path}">${esc(p.name)}</a></h3><p class="muted">${esc(p.about)}</p></div>`).join('')}</div>`;
}

/** The "more for your exam" block at the foot of every exam page and guide. */
export function related(except) {
  return `<section class="section" aria-labelledby="more-h">
  <div class="container">
    <h2 id="more-h" class="section-title">Exam pages and guides</h2>
    ${linkCards(EXAM_PAGES, except)}
    <div style="margin-top:16px">${linkCards(GUIDES, except)}</div>
    <p class="muted" style="margin-top:16px">Or go straight to <a href="/exam-practice">exam practice</a>: three full-length tests, marked with full and half mistakes.</p>
  </div>
</section>`;
}

/** A two-column table of facts: rows are [label, trusted HTML]. */
export function factsTable(caption, rows) {
  return `<div class="table-wrap"><table class="table"><caption class="sr-only">${esc(caption)}</caption><tbody>${rows.map(([k, v]) =>
    `<tr><th scope="row" style="width:30%">${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table></div>`;
}

/** A table with a header row: head is [text], rows are [[trusted HTML]]; `num` marks right-aligned columns. */
export function dataTable(caption, head, rows, num = []) {
  const cls = (i) => (num.includes(i) ? ' class="num"' : '');
  return `<div class="table-wrap"><table class="table"><caption class="sr-only">${esc(caption)}</caption>
  <thead><tr>${head.map((h, i) => `<th scope="col"${cls(i)}>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td${cls(i)}>${c}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function faqSection(items, heading = 'Questions') {
  return `<section class="section" aria-labelledby="faq-h">
  <div class="container"><div style="max-width:760px">
    <h2 id="faq-h" style="margin-bottom:12px">${esc(heading)}</h2>
    ${faqList(items)}
  </div></div>
</section>`;
}

/** The line every exam page carries: practice, not the exam's software; the notice decides. */
export function practiceNote(notice) {
  return `<div class="alert alert-info">${icon('info')}<div>TypeCraft's tests are practice in the style of the exam, not the exam's own software. ${notice} Facts on this page were checked on ${CHECKED_TEXT}.</div></div>`;
}

const crumbs = (ctx, trail) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: ctx.siteUrl + path })),
});

/** JSON-LD for an exam page: where it sits, and its questions. */
export function examLd(meta, faq) {
  return (ctx) => [crumbs(ctx, [['Home', '/'], ['Exam practice', '/exam-practice'], [meta.crumb, meta.path]]), faqJsonLd(faq)];
}

/** JSON-LD for a guide: an Article, where it sits, and its questions if it has some. */
export function guideLd(meta, faq) {
  return (ctx) => [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: meta.headline,
      description: meta.description,
      inLanguage: 'en-IN',
      datePublished: meta.published,
      dateModified: meta.modified || meta.published,
      mainEntityOfPage: ctx.siteUrl + meta.path,
      image: ctx.siteUrl + '/site/og-image.png',
      author: { '@type': 'Organization', name: 'TypeCraft', url: ctx.siteUrl + '/' },
      publisher: { '@type': 'Organization', name: 'TypeCraft', url: ctx.siteUrl + '/', logo: { '@type': 'ImageObject', url: ctx.siteUrl + '/icons/icon-512.png' } },
    },
    crumbs(ctx, [['Home', '/'], ['Guides', '/guides'], [meta.crumb, meta.path]]),
    ...(faq ? [faqJsonLd(faq)] : []),
  ];
}
