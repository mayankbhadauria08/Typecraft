// The exam pages and typing guides (docs/EXAM-MODES.md §6): they render, carry valid JSON-LD, are in
// the sitemap and linked from the site, every link on them works, and what they say about our own
// practice tests matches shared/exam-rules.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './server.mjs';
import worker from '../src/index.js';
import { EXAM_PAGES, GUIDES } from '../src/pages/public/exam-seo.js';
import { EXAMPLE } from '../src/pages/public/guide-ssc-marking.js';
import '../shared/exam-passages.js';
import '../shared/exam-rules.js';

const X = globalThis.TC_EXAMS;
const env = makeEnv({ SITE_URL: 'https://typecrafttyping.in' });
const ctx = { waitUntil() {} };
const BASE = 'https://typecrafttyping.in';
const get = async (path) => {
  const res = await worker.fetch(new Request(BASE + path, { redirect: 'manual' }), env, ctx);
  return { status: res.status, headers: res.headers, text: await res.text() };
};
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const textOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

const EXAMS = EXAM_PAGES.map((p) => p.path);
const GUIDE_PATHS = ['/guides', ...GUIDES.map((p) => p.path)];

test('each exam page renders with its rules, a practice link, an FAQ and JSON-LD', async () => {
  const practice = { '/ssc-chsl-typing-test': 'ssc-typing', '/ssc-dest-typing-test': 'ssc-dest', '/cpct-typing-test': 'cpct' };
  for (const path of EXAMS) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.equal((r.text.match(/<h1[\s>]/g) || []).length, 1, path);
    const title = r.text.match(/<title>([^<]+)<\/title>/)[1];
    assert.ok(title.length <= 60, `${path}: title is ${title.length} characters`);
    const desc = r.text.match(/<meta name="description" content="([^"]+)"/)[1];
    assert.ok(desc.length <= 160, `${path}: description is ${desc.length} characters`);
    assert.ok(!/<meta name="robots"/.test(r.text), `${path} is indexable`);
    if (practice[path]) {
      assert.ok(r.text.includes(`href="/exam-practice?test=${practice[path]}"`), `${path} links to its practice test`);
      assert.match(textOf(r.text), /practice in the style of the exam, not the exam's own software/);
    }
    assert.ok(r.text.includes('<div class="faq">'), `${path} has an FAQ`);
    const blocks = ld(r.text);
    const faq = blocks.find((b) => b['@type'] === 'FAQPage');
    assert.ok(faq && faq.mainEntity.length >= 4, `${path}: FAQPage`);
    for (const q of faq.mainEntity) {
      assert.equal(q['@type'], 'Question'); assert.ok(q.name && q.acceptedAnswer.text && !/[<>]/.test(q.acceptedAnswer.text), q.name);
      assert.ok(r.text.includes(q.name.replace(/'/g, '&#39;')), `${path}: the FAQ question "${q.name}" is on the page`);
    }
    const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList');
    assert.deepEqual(crumbs.itemListElement.map((i) => i.item), [BASE + '/', BASE + '/exam-practice', BASE + path]);
  }
});

test('the guides render as articles, and the worked example is marked the way the guide says', async () => {
  for (const path of GUIDE_PATHS) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.equal((r.text.match(/<h1[\s>]/g) || []).length, 1, path);
    assert.ok(r.text.match(/<title>([^<]+)<\/title>/)[1].length <= 60, path);
    if (path === '/guides') continue;
    assert.match(r.text, /<meta property="og:type" content="article">/);
    const art = ld(r.text).find((b) => b['@type'] === 'Article');
    assert.ok(art && art.headline && art.datePublished && art.author.name === 'TypeCraft', path);
    assert.equal(art.mainEntityOfPage, BASE + path);
    const crumbs = ld(r.text).find((b) => b['@type'] === 'BreadcrumbList');
    assert.deepEqual(crumbs.itemListElement.map((i) => i.item), [BASE + '/', BASE + '/guides', BASE + path]);
  }
  // the example in "How the SSC typing test is marked" is marked the same by our practice tests
  const m = X.mark(X.words(EXAMPLE.passage), X.words(EXAMPLE.typed), {});
  assert.equal(X.words(EXAMPLE.passage).length, EXAMPLE.words);
  assert.equal(m.full, EXAMPLE.full); assert.equal(m.half, EXAMPLE.half);
  const page = textOf((await get('/guides/ssc-typing-test-marking')).text);
  assert.match(page, /2 full mistakes and 3 half mistakes: 2 \+ 3 ÷ 2 = 3\.5 mistakes/);
  assert.match(page, /20 words, so that is 17\.5% of them/);
});

test('what the pages say about our practice tests matches the tests themselves', async () => {
  const min = (mode) => Math.min(...X.passages(mode).map((p) => p.text.length));
  const near = (actual, said) => Math.abs(actual - said) / said < 0.05;
  const chsl = textOf((await get('/ssc-chsl-typing-test')).text);
  assert.ok(near(min('ssc-typing'), 1800) && chsl.includes('about 1,800 key depressions'));
  assert.equal(X.MODES['ssc-typing'].minutes, 10); assert.equal(X.MODES['ssc-typing'].target.strokes, 1750); assert.equal(X.MODES['ssc-typing'].target.mistakesPct, 5);
  assert.ok(chsl.includes('1,750 key depressions with mistakes at 5% of the words or less'));
  const dest = textOf((await get('/ssc-dest-typing-test')).text);
  assert.ok(near(min('ssc-dest'), 2250) && dest.includes('about 2,250 key depressions'));
  assert.equal(X.MODES['ssc-dest'].minutes, 15); assert.equal(X.MODES['ssc-dest'].target.correctStrokes, 2000);
  assert.ok(dest.includes('2,000 correct key depressions'));
  const cpct = textOf((await get('/cpct-typing-test')).text);
  assert.equal(X.MODES.cpct.backspace, false); assert.equal(X.MODES.cpct.minutes, 15); assert.equal(X.MODES.cpct.target.netWpm, 30);
  assert.ok(X.passages('cpct').every((p) => near(p.text.length, 4000) || p.text.length > 4000) && cpct.includes('about 4,000 key depressions'));
  assert.ok(cpct.includes('30 net words a minute over the full 15 minutes'));
});

test('the 10-minute page is the typing test set to 10 minutes; the typing test has 15 s to 15 min and an FAQ', async () => {
  const ten = await get('/10-minute-typing-test');
  assert.ok(ten.text.includes('data-d="600" aria-pressed="true"'));
  assert.equal((ten.text.match(/aria-pressed="true"/g) || []).filter(Boolean).length, 2, 'one length and one text kind chosen');
  assert.ok(ten.text.includes('src="/site/js/typing-test.js"'));
  assert.match(ten.text, /id="ttTime">10:00</);
  const tt = await get('/typing-test');
  for (const d of [15, 30, 60, 120, 300, 600, 900]) assert.ok(tt.text.includes(`data-d="${d}"`), `${d} s`);
  assert.ok(tt.text.includes('data-d="60" aria-pressed="true"'));
  assert.ok(ld(tt.text).some((b) => b['@type'] === 'FAQPage'));
  for (const p of EXAMS.filter((x) => x !== '/typing-test')) assert.ok(tt.text.includes(`href="${p}"`), `typing test links to ${p}`);
});

test('the new pages are in the sitemap, in the footer, and linked from exam practice; every link on them works', async () => {
  const map = (await get('/sitemap.xml')).text;
  for (const p of [...EXAMS, ...GUIDE_PATHS]) assert.ok(map.includes(`<loc>${BASE}${p}</loc>`), `${p} in the sitemap`);
  const home = (await get('/')).text;
  for (const p of [...EXAMS, '/guides']) assert.ok(home.includes(`href="${p}"`), `${p} in the footer`);
  const ex = (await get('/exam-practice')).text;
  for (const p of ['/ssc-chsl-typing-test', '/ssc-dest-typing-test', '/cpct-typing-test', ...GUIDES.map((g) => g.path)]) assert.ok(ex.includes(`href="${p}"`), `exam practice links to ${p}`);
  // every internal link on the new pages leads somewhere
  const seen = new Set();
  for (const path of [...EXAMS, ...GUIDE_PATHS, '/typing-test', '/exam-practice']) {
    const html = (await get(path)).text;
    for (const [, href] of html.matchAll(/href="(\/[^"#]*)"/g)) {
      const u = href.replace(/&amp;/g, '&');
      if (seen.has(u) || u.startsWith('/site/') || u.startsWith('/icons/') || u === '/favicon.ico' || u.startsWith('/manifest')) continue;
      seen.add(u);
      const r = await get(u);
      assert.ok([200, 301, 302].includes(r.status), `${path} links to ${u}: ${r.status}`);
    }
  }
  assert.ok(seen.size > 30);
});
