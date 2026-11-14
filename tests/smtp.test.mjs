// SMTP delivery (Google Workspace app password): protocol, MIME, provider choice. A fake server, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendSmtp, buildMessage, parseAddress } from '../src/smtp.js';
import { providerOf, sendTemplate, _setSmtpConnect } from '../src/mail.js';
import { makeEnv } from './server.mjs';

/** A fake SMTP server: answers each command; records what was sent. */
function fakeServer({ authOk = true } = {}) {
  const log = { lines: [], data: '' };
  let pushOut;
  const out = new ReadableStream({ start(c) { pushOut = (s) => c.enqueue(new TextEncoder().encode(s)); } });
  let inData = false, pending = '';
  const reply = (line) => {
    if (inData) {
      log.data += line + '\r\n';
      if (line === '.') { inData = false; pushOut('250 2.0.0 OK 1731650000 abcdef123456 - gsmtp\r\n'); }
      return;
    }
    log.lines.push(line);
    if (line.startsWith('EHLO')) pushOut('250-smtp.example.com\r\n250-AUTH PLAIN LOGIN\r\n250 SMTPUTF8\r\n');
    else if (line.startsWith('AUTH PLAIN')) pushOut(authOk ? '235 2.7.0 Accepted\r\n' : '535 5.7.8 Username and Password not accepted\r\n');
    else if (line.startsWith('MAIL FROM')) pushOut('250 2.1.0 OK\r\n');
    else if (line.startsWith('RCPT TO')) pushOut('250 2.1.5 OK\r\n');
    else if (line === 'DATA') { inData = true; pushOut('354 Go ahead\r\n'); }
    else if (line === 'QUIT') pushOut('221 2.0.0 closing\r\n');
  };
  const writable = new WritableStream({ write(chunk) {
    pending += new TextDecoder().decode(chunk);
    let i;
    while ((i = pending.indexOf('\r\n')) >= 0) { const line = pending.slice(0, i); pending = pending.slice(i + 2); reply(line); }
  } });
  const connect = (addr, opts) => { log.addr = addr; log.opts = opts; setTimeout(() => pushOut('220 smtp.example.com ESMTP ready\r\n'), 0); return { readable: out, writable, close() {} }; };
  return { connect, log };
}
const ENV = { SMTP_USER: 'hello@typecrafttyping.com', SMTP_PASS: 'app-password-x', EMAIL_FROM: 'TypeCraft <hello@typecrafttyping.com>' };

test('sendSmtp: TLS on 465, AUTH PLAIN, envelope and a multipart message', async () => {
  const s = fakeServer();
  const r = await sendSmtp(ENV, { from: ENV.EMAIL_FROM, to: 'asha@example.com', replyTo: 'hello@typecrafttyping.com', subject: 'Your TypeCraft sign-in code', text: 'Your code: 123456', html: '<p>₹199</p>' }, { connectFn: s.connect });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(s.log.addr, { hostname: 'smtp.gmail.com', port: 465 });
  assert.equal(s.log.opts.secureTransport, 'on');
  assert.ok(s.log.lines.includes('MAIL FROM:<hello@typecrafttyping.com>'));
  assert.ok(s.log.lines.includes('RCPT TO:<asha@example.com>'));
  const auth = s.log.lines.find((l) => l.startsWith('AUTH PLAIN ')).slice(11);
  assert.equal(Buffer.from(auth, 'base64').toString(), '\u0000hello@typecrafttyping.com\u0000app-password-x');
  assert.match(s.log.data, /Subject: Your TypeCraft sign-in code/);
  assert.match(s.log.data, /multipart\/alternative/);
  assert.ok(s.log.data.includes(Buffer.from('<p>₹199</p>').toString('base64')));
});

test('sendSmtp: a refused password is a permanent failure; header injection is flattened', async () => {
  const s = fakeServer({ authOk: false });
  const r = await sendSmtp(ENV, { from: ENV.EMAIL_FROM, to: 'a@example.com', subject: 'x', text: 'y', html: 'z' }, { connectFn: s.connect });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'smtp_auth_535');
  assert.equal(r.transient, false);
  const m = buildMessage({ from: ENV.EMAIL_FROM, to: 'a@example.com', subject: 'Hi\r\nBcc: evil@example.com', text: 't', html: 'h', domain: 'typecrafttyping.com' });
  assert.ok(!/\r\nBcc:/.test(m));
  assert.deepEqual(parseAddress('TypeCraft <hello@typecrafttyping.com>'), { name: 'TypeCraft', addr: 'hello@typecrafttyping.com' });
});

test('provider: SMTP when SMTP_USER and SMTP_PASS are set, else Resend, else none; sendTemplate goes through SMTP', async () => {
  assert.equal(providerOf({ ...ENV, RESEND_API_KEY: 'k' }), 'smtp');
  assert.equal(providerOf({ RESEND_API_KEY: 'k' }), 'resend');
  assert.equal(providerOf({}), null);
  const s = fakeServer();
  _setSmtpConnect(s.connect);
  const env = makeEnv({ ...ENV });
  const r = await sendTemplate(env, { waitUntil() {} }, { to: 'asha@example.com', template: 'welcome', data: { name: 'Asha' } });
  _setSmtpConnect(null);
  assert.equal(r.status, 'sent');
  const row = await env.DB.prepare('SELECT provider, status, provider_id FROM email_logs WHERE id = ?1').bind(r.id).first();
  assert.equal(row.provider, 'smtp');
  assert.match(row.provider_id, /^smtp/);
});
