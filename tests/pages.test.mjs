// Pages part: registries for the account, payment and admin pages (docs/SAAS-CONTRACTS.md §8, §11).
// node --test tests/pages.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as account from '../src/pages/account.js';
import * as payment from '../src/pages/payment.js';
import * as admin from '../src/pages/admin.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRIES = { account: account.PAGES, payment: payment.PAGES, admin: admin.PAGES };
const ALL = Object.values(REGISTRIES).flat();
const LAYOUTS = new Set(['site', 'auth', 'account', 'admin', 'bare']);

// [path, access, layout] — the contract table rows owned by this part
const EXPECTED = [
  ['/dashboard', 'user', 'account'],
  ['/account/profile', 'user', 'account'],
  ['/account/history', 'user', 'account'],
  ['/account/analytics', 'user', 'account'],
  ['/account/plans', 'user', 'account'],
  ['/account/payments', 'user', 'account'],
  ['/account/invoices', 'user', 'account'],
  ['/account/invoices/:number', 'user', 'bare'],
  ['/account/settings', 'user', 'account'],
  ['/checkout', 'user', 'account'],
  ['/payment/processing', 'user', 'bare'],
  ['/payment/success', 'user', 'account'],
  ['/payment/failure', 'user', 'account'],
  ['/payment/pending', 'user', 'account'],
  ['/admin', 'admin', 'admin'],
  ['/admin/users', 'admin', 'admin'],
  ['/admin/packages', 'admin', 'admin'],
  ['/admin/payments', 'admin', 'admin'],
  ['/admin/revenue', 'admin', 'admin'],
  ['/admin/emails', 'admin', 'admin'],
  ['/admin/settings', 'admin', 'admin'],
];

const scriptsOf = (p) => p.scripts.map((s) => ({ url: s, file: join(ROOT, s.replace(/^\//, '')) }));
const ownScripts = [...new Set(ALL.flatMap((p) => p.scripts))].filter((s) => s.startsWith('/site/js/'));

test('every contract path exists exactly once with the right access, layout and noindex', () => {
  for (const [path, access, layout] of EXPECTED) {
    const hits = ALL.filter((p) => p.meta.path === path);
    assert.equal(hits.length, 1, `${path} should be registered once, found ${hits.length}`);
    const m = hits[0].meta;
    assert.equal(m.access, access, `${path} access`);
    assert.equal(m.layout, layout, `${path} layout`);
    assert.equal(m.noindex, true, `${path} noindex`);
  }
  assert.equal(ALL.length, EXPECTED.length, 'no pages beyond the contract table');
  for (const p of REGISTRIES.admin) assert.equal(p.meta.access, 'admin');
});

test('page entries have the module shape the site part expects', () => {
  for (const p of ALL) {
    assert.equal(typeof p.body, 'string', p.meta.path);
    assert.ok(p.body.trim().length > 50, `${p.meta.path} body`);
    assert.ok(LAYOUTS.has(p.meta.layout), `${p.meta.path} layout`);
    assert.ok(p.meta.title && p.meta.description, `${p.meta.path} title/description`);
    assert.ok(Array.isArray(p.scripts) && p.scripts.length, `${p.meta.path} scripts`);
    assert.ok(!/<script\b/i.test(p.body), `${p.meta.path}: scripts go in the scripts list, not the body`);
  }
});

test('page modules export meta, body and a default body', async () => {
  for (const dir of ['account', 'payment', 'admin']) {
    for (const p of REGISTRIES[dir]) {
      assert.ok(p.meta && p.meta.path.startsWith('/'), p.meta.path);
    }
  }
  const mod = await import('../src/pages/account/dashboard.js');
  assert.equal(mod.default, mod.body);
});

test('every referenced script file exists, the kit loads before the page script', () => {
  for (const p of ALL) {
    for (const s of scriptsOf(p)) assert.ok(existsSync(s.file), `${p.meta.path}: missing ${s.url}`);
    const kit = p.scripts.indexOf('/site/js/pages-kit.js');
    assert.ok(kit >= 0 && kit < p.scripts.length - 1, `${p.meta.path}: pages-kit.js must come before the page script`);
  }
});

test('each body has exactly one <h1>', () => {
  for (const p of ALL) {
    const n = (p.body.match(/<h1[\s>]/gi) || []).length;
    assert.equal(n, 1, `${p.meta.path} has ${n} <h1>`);
  }
});

test('element ids used by a page script exist in its body (or are made by the script)', () => {
  for (const p of ALL) {
    const own = p.scripts.filter((s) => s.startsWith('/site/js/') && !s.endsWith('pages-kit.js'));
    for (const s of own) {
      const src = readFileSync(join(ROOT, s.slice(1)), 'utf8');
      for (const [, id] of src.matchAll(/\$\('#([\w-]+)'\)/g)) {
        const inBody = p.body.includes(`id="${id}"`);
        const made = src.includes(`id: '${id}'`);
        assert.ok(inBody || made, `${p.meta.path}: ${s} looks for #${id}, which is not in the body`);
      }
    }
  }
});

test('ids are unique within each body', () => {
  for (const p of ALL) {
    const ids = [...p.body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${p.meta.path} duplicate ids`);
  }
});

test('no unescaped HTML from data: scripts never write HTML strings', () => {
  for (const s of ownScripts) {
    const src = readFileSync(join(ROOT, s.slice(1)), 'utf8');
    assert.ok(!/innerHTML\s*\+?=/.test(src), `${s} assigns innerHTML`);
    assert.ok(!/outerHTML\s*=/.test(src), `${s} assigns outerHTML`);
    assert.ok(!/insertAdjacentHTML|document\.write/.test(src), `${s} writes HTML strings`);
    assert.ok(!/\bwindow\.(confirm|alert|prompt)\s*\(|(^|[^.\w])(confirm|alert|prompt)\s*\(/m.test(src.replace(/K\.confirm\(|TCK\.confirm\(/g, '')), `${s} uses a browser dialog instead of an in-page confirmation`);
  }
  // bodies: no event-handler attributes or javascript: links (CSP-friendly)
  for (const p of ALL) assert.ok(!/\son[a-z]+="|javascript:/i.test(p.body), `${p.meta.path} inline handler`);
});

test('payments: success is only shown on server status "paid", Razorpay checkout is loaded on demand', () => {
  const read = (n) => readFileSync(join(ROOT, 'site/js', n), 'utf8');
  const checkout = read('checkout.js');
  assert.match(checkout, /https:\/\/checkout\.razorpay\.com\/v1\/checkout\.js/);
  assert.match(checkout, /\/api\/checkout\/order/);
  assert.match(checkout, /\/api\/checkout\/failed/);
  assert.match(checkout, /ondismiss/);
  assert.match(checkout, /#0b6e63/);
  assert.ok(!/payment\/success/.test(checkout), 'checkout never jumps straight to success');
  const success = read('payment-success.js');
  assert.match(success, /status !== 'paid'/);
  const processing = read('payment-processing.js');
  assert.match(processing, /\/api\/checkout\/verify/);
  assert.match(processing, /status === 'paid' \? go\('success'\)/);
  const pending = read('payment-pending.js');
  assert.match(pending, /EVERY = 5000/);
  assert.match(pending, /LIMIT = 5 \* 60 \* 1000/);
  const kitAndPages = ALL.map((p) => p.body).join('\n');
  assert.ok(!kitAndPages.includes('checkout.razorpay.com'), 'Razorpay is not loaded by any page body');
});

test('admin money inputs convert rupees to paise', () => {
  const src = readFileSync(join(ROOT, 'site/js/admin-packages.js'), 'utf8');
  assert.match(src, /Math\.round\(Number\(f\.elements\.price\.value \|\| 0\) \* 100\)/);
  const pay = readFileSync(join(ROOT, 'site/js/admin-payments.js'), 'utf8');
  assert.match(pay, /Math\.round\(Number\(vals\.amount\) \* 100\)/);
});
