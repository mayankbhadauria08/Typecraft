// SMTP sending for the email service (src/mail.js), e.g. Google Workspace with an app password.
// Implicit TLS (port 465) through Cloudflare's TCP sockets. Settings: SMTP_HOST (default
// smtp.gmail.com), SMTP_PORT (default 465), SMTP_USER and SMTP_PASS (secrets).
// Never logs the password, the message or the recipient.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function smtpConfigured(env) {
  return !!(env.SMTP_USER && env.SMTP_PASS);
}

const b64 = (s) => {
  const bytes = enc.encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');
const oneLine = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
/** RFC 2047 encoded-word for non-ASCII header text. */
const headerText = (s) => (/^[\x20-\x7e]*$/.test(oneLine(s)) ? oneLine(s) : `=?UTF-8?B?${b64(oneLine(s))}?=`);
/** "Name <addr>" → { name, addr } */
export function parseAddress(value) {
  const v = oneLine(value);
  const m = v.match(/^(.*)<([^<>\s]+@[^<>\s]+)>$/);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, ''), addr: m[2] };
  return { name: '', addr: v };
}
const formatAddress = ({ name, addr }) => (name ? `${headerText(name)} <${addr}>` : `<${addr}>`);

/** Builds the MIME message (multipart/alternative, base64 parts). */
export function buildMessage({ from, to, replyTo, subject, text, html, headers = {}, domain, now = new Date() }) {
  const boundary = `tc_${crypto.randomUUID().replace(/-/g, '')}`;
  const lines = [
    `From: ${formatAddress(parseAddress(from))}`,
    `To: <${oneLine(to)}>`,
    replyTo ? `Reply-To: ${formatAddress(parseAddress(replyTo))}` : null,
    `Subject: ${headerText(subject)}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    ...Object.entries(headers).map(([k, v]) => `${oneLine(k)}: ${oneLine(v)}`),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text || '')),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(html || '')),
    `--${boundary}--`,
    '',
  ].filter((l) => l !== null);
  return lines.join('\r\n');
}

/** Reads one SMTP reply (all lines up to "NNN text"). */
function replyReader(readable) {
  const reader = readable.getReader();
  let buf = '';
  return async function next() {
    for (;;) {
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          const reply = lines.slice(0, i + 1);
          buf = lines.slice(i + 1).join('\r\n');
          return { code: parseInt(lines[i].slice(0, 3), 10), text: reply.join('\n') };
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('smtp_closed');
      buf += dec.decode(value, { stream: true });
    }
  };
}

/**
 * Sends one email. → { ok, providerId?, error?, transient? }  (never throws)
 * `connectFn(address, options)` is Cloudflare's `connect` (tests pass a fake).
 */
export async function sendSmtp(env, msg, { connectFn } = {}) {
  const host = env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(env.SMTP_PORT || 465);
  const fromAddr = parseAddress(msg.from).addr;
  const domain = (fromAddr.split('@')[1] || 'localhost').toLowerCase();
  let socket = null;
  try {
    if (!connectFn) ({ connect: connectFn } = await import('cloudflare:sockets'));
    socket = connectFn({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
    const writer = socket.writable.getWriter();
    const next = replyReader(socket.readable);
    const send = (line) => writer.write(enc.encode(line + '\r\n'));
    const expect = async (codes, step) => {
      const r = await next();
      if (!codes.includes(r.code)) {
        const err = new Error(`smtp_${step}_${r.code}`);
        err.transient = r.code >= 400 && r.code < 500;
        throw err;
      }
      return r;
    };
    await expect([220], 'greeting');
    await send(`EHLO ${domain}`); await expect([250], 'ehlo');
    await send(`AUTH PLAIN ${b64(`\u0000${env.SMTP_USER}\u0000${env.SMTP_PASS}`)}`); await expect([235], 'auth');
    await send(`MAIL FROM:<${fromAddr}>`); await expect([250], 'mail');
    await send(`RCPT TO:<${oneLine(msg.to)}>`); await expect([250, 251], 'rcpt');
    await send('DATA'); await expect([354], 'data');
    const body = buildMessage({ ...msg, domain }).replace(/\r\n\./g, '\r\n..'); // dot-stuffing
    await writer.write(enc.encode(body + '\r\n.\r\n'));
    const done = await expect([250], 'send');
    try { await send('QUIT'); } catch { /* closing anyway */ }
    const id = (done.text.match(/[\w.-]{10,}/g) || []).pop() || null;
    return { ok: true, providerId: id ? `smtp:${id}`.slice(0, 120) : 'smtp' };
  } catch (err) {
    const code = String((err && err.message) || 'smtp_error').slice(0, 60);
    // auth or policy refusals are not worth retrying; network trouble and 4xx replies are
    const transient = !!(err && err.transient) || !/^smtp_(auth|rcpt|mail)_5/.test(code);
    return { ok: false, error: code, transient };
  } finally {
    try { socket && socket.close(); } catch { /* ignore */ }
  }
}
