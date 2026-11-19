// Problem log rows 7–11 (the 19 Nov site check): each fix, so it stays fixed.
//   node --test tests/problem-log.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, startServer } from './server.mjs';
import { kit, assertNoInlineCode } from './console-kit.mjs';

let S, K, owner;
before(async () => {
  const env = makeEnv({ OWNER_EMAILS: 'boss@example.com', SITE_URL: 'https://typecraft.test' });
  S = { env, srv: await startServer(env, 8776) };
  S.base = `http://localhost:${S.srv.port}`;
  K = kit(S, { ipPrefix: '10.76.0.' });
  owner = await K.consoleLogin(await K.owner());
});
after(() => S.srv.server.close());

const titleOf = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1].replace(/&amp;/g, '&');
const descOf = (html) => (html.match(/<meta name="description" content="([^"]*)"/) || [])[1].replace(/&amp;/g, '&');

test('#7 Learning access: a search also finds customers, so you can give one an exception', async () => {
  const asha = await K.customer({ name: 'Asha Verma', email: 'asha.verma@example.com' });
  await K.customer({ name: 'Ravi Kumar', email: 'ravi@example.com' });
  const r = await owner('GET', '/api/console/access?q=Asha');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 0, 'no exceptions yet');
  assert.deepEqual(r.body.customers, [{ id: asha, fullName: 'Asha Verma', email: 'asha.verma@example.com', inForce: 0 }]);
  assert.deepEqual((await owner('GET', '/api/console/access?q=RAVI@EXAMPLE.COM')).body.customers.map((c) => c.email), ['ravi@example.com'], 'any case, by email');
  assert.equal((await owner('GET', '/api/console/access?q=a')).body.customers, null, 'one letter is not a search for a customer');
  assert.equal((await owner('GET', '/api/console/access')).body.customers, null);
  assert.deepEqual((await owner('GET', '/api/console/access?q=nobody-like-this')).body.customers, []);
  const page = await owner('GET', '/console/access');
  assert.equal(page.status, 200);
  assertNoInlineCode(page.text);
  assert.ok(page.text.includes('id="customerMatches"'));
  assert.ok(page.text.includes('placeholder="Customer email or name"'));
});

test('#8 search titles and descriptions fit what Google shows; About is not "About TypeCraft · TypeCraft"', async () => {
  const exam = (await K.client()('GET', '/exam-practice')).text;
  assert.equal(titleOf(exam), 'Free SSC, DEST and CPCT typing test practice · TypeCraft');
  assert.ok(titleOf(exam).length <= 60, titleOf(exam).length);
  assert.ok(descOf(exam).length <= 155, descOf(exam).length);
  assert.equal(titleOf((await K.client()('GET', '/about')).text), 'About TypeCraft');
});

test('#9 About and Privacy say what runs: Cloudflare Web Analytics (no cookies) and Resend for email', async () => {
  const about = (await K.client()('GET', '/about')).text;
  assert.ok(!/third-party trackers|tracking scripts/i.test(about));
  assert.match(about, /Cloudflare Web Analytics, which sets no cookies/);
  const privacy = (await K.client()('GET', '/privacy')).text;
  assert.match(descOf(privacy), /Resend for email/);
  assert.match(privacy, /<b>Resend<\/b>, our email provider/);
  assert.match(privacy, /counts visits with Cloudflare Web Analytics/);
  assert.match(privacy, /<b>Visit counts<\/b>/);
  assert.ok(!/use third-party trackers/.test(privacy));
  assert.ok(!/third-party trackers/.test((await K.client()('GET', '/features')).text));
});

test('#10 the paid pack is "Long passages", not "Exam passages" (which sounded like the free Exam practice)', async () => {
  const learner = (await K.account({ email: 'packs@example.com' })).learner;
  const r = await learner('GET', '/api/content/packs');
  assert.equal(r.status, 200);
  const pack = r.body.packs.find((p) => p.id === 'exam');
  assert.equal(pack.title, 'Long passages');
  assert.match(pack.description, /for a timed, marked test, use Exam practice/);
  assert.ok(!r.body.packs.some((p) => /exam passages/i.test(p.title)));
});

test('#11 the exam page has no empty heading before a test opens', async () => {
  const html = (await K.client()('GET', '/exam-practice')).text;
  assert.ok(!/<h[1-6][^>]*>\s*<\/h[1-6]>/.test(html), 'an empty heading');
  assert.match(html, /<h2 id="exTestName">Typing test<\/h2>/);
});
