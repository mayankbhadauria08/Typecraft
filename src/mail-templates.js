// Email templates (see docs/SAAS-CONTRACTS.md §4). Each template is a function
// (data, site) → { subject, html, text }. `site` = { siteUrl, supportEmail, unsubscribeUrl? }.
// HTML is table-based with inline styles (works in Gmail, Outlook, Apple Mail), light
// background with the TypeCraft teal accent. Every value from `data` is escaped.
//
// data keys per template (all optional unless marked *):
//   welcome                       { name, freeLessons (what Free includes, in words) }
//   verify_email                  { name, link*, code (6 digits), newEmail (set for an email change) }
//   otp_login                     { name, code*, minutes = 10 }
//   admin_otp                     { name, code*, minutes = 10, device }   (admin console sign-in)
//   login_alert                   { name, device*, time (ISO), location }
//   password_reset                { name, link*, minutes = 60 }
//   password_changed              { name, time (ISO) }
//   security_alert                { name, title, message*, time (ISO) }
//   email_changed                 { name, oldEmail*, newEmail*, time (ISO) }
//   payment_success               { name, packageName*, amountPaise*, currency = 'INR', orderId, paymentId,
//                                   invoiceNumber, invoiceUrl, startsAt, expiresAt (null = never) }
//   payment_failed                { name, packageName*, amountPaise, reason, retryUrl }
//   invoice                       { name, invoiceNumber*, amountPaise*, issuedAt, invoiceUrl,
//                                   lines: [{ description, amountPaise }] }
//   subscription_renewal_reminder { name, packageName*, expiresAt*, renewUrl }
//   subscription_expired          { name, packageName*, expiredAt, renewUrl }
//   refund_processed              { name, amountPaise*, packageName, orderId, refundId, reason }
//   announcement                  { name, subject*, body* (plain text; blank lines = paragraphs) }
//   account_update                { name, title*, message*, ctaLabel, ctaUrl }
//   test_completed                { name, wpm*, accuracy*, duration (s), errors, best (bool) }
//   contact_received              { name, topic, message*, replyDays = 2 }
//   contact_forward               { name*, email*, topic, message*, userId, priority (bool), plan, messageId }
//   institute_invite              { name, instituteName*, role* ('admin' | 'teacher'), invitedBy, email*, link* }
//   student_invite                { name, instituteName*, batchName*, batchCode*, joinPath* }  (not 'code'/'link': kept for retries)
//   institute_reminder            { name, instituteName*, kind* ('seats' | 'ends'), seats, seatsUsed, lastDay, days, link }
// URLs given in data may be absolute https URLs or site paths ('/pricing'); anything else is dropped.

const ACCENT = '#0b6e63';
const INK = '#14201e';
const MUTED = '#5b6b68';
const LINE = '#e1e7e5';
const BG = '#f3f6f5';

export function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function money(paise, currency = 'INR') {
  const n = Number(paise) / 100;
  if (!Number.isFinite(n)) return '';
  const whole = Number.isInteger(n);
  const s = n.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return currency === 'INR' ? `₹${s}` : `${currency} ${s}`;
}

export function dateTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' IST';
  } catch { return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
}

export function dateOnly(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  try { return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return d.toISOString().slice(0, 10); }
}

function url(site, value) {
  if (typeof value !== 'string' || !value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return site.siteUrl + value;
  return /^https:\/\/[^\s"'<>]+$/i.test(value) ? value : null;
}

const firstName = (name) => (typeof name === 'string' && name.trim() ? name.trim().split(/\s+/)[0] : '');
const hi = (d) => (firstName(d.name) ? `Hi ${firstName(d.name)},` : 'Hi,');

/* ---------- building blocks: each returns { html, text } ---------- */
const P = (text) => ({ html: `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};">${esc(text)}</p>`, text });
const Small = (text) => ({ html: `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:${MUTED};">${esc(text)}</p>`, text });
const Raw = (html, text) => ({ html, text }); // html built here from escaped parts only

function Button(label, href) {
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr>
<td align="center" bgcolor="${ACCENT}" style="border-radius:10px;background:${ACCENT};">
<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(label)}</a>
</td></tr></table>`,
    text: `${label}: ${href}`,
  };
}

function Code(code, label = 'Your code') {
  const c = String(code || '');
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px;"><tr>
<td align="center" style="padding:20px 12px 18px;border:1px dashed #9cc9c1;border-radius:14px;background:#effaf7;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${ACCENT};margin:0 0 8px;">${esc(label)}</div>
<div style="font-family:'Courier New',Courier,monospace;font-size:38px;line-height:1.1;font-weight:bold;letter-spacing:12px;color:${INK};padding-left:12px;">${esc(c)}</div>
</td></tr></table>`,
    text: `Your code: ${c}`,
  };
}

/** rows: [[label, value]] — a two-column summary table. */
function Rows(rows) {
  const list = rows.filter(([, v]) => v !== null && v !== undefined && v !== '');
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 22px;border:1px solid ${LINE};border-radius:10px;border-collapse:separate;">
${list.map(([k, v], i) => `<tr><td style="padding:10px 14px;font-size:14px;color:${MUTED};${i ? `border-top:1px solid ${LINE};` : ''}">${esc(k)}</td><td align="right" style="padding:10px 14px;font-size:14px;color:${INK};font-weight:bold;${i ? `border-top:1px solid ${LINE};` : ''}">${esc(v)}</td></tr>`).join('\n')}
</table>`;
  return { html, text: list.map(([k, v]) => `${k}: ${v}`).join('\n') };
}

function Quote(text) {
  const body = String(text || '');
  return {
    html: `<div style="margin:0 0 20px;padding:12px 16px;border-left:3px solid ${ACCENT};background:#f7faf9;font-size:15px;line-height:1.6;color:${INK};white-space:pre-wrap;">${esc(body)}</div>`,
    text: body.split('\n').map((l) => `> ${l}`).join('\n'),
  };
}

/** Plain text written by an admin: blank lines split paragraphs, https links become links. */
function Paragraphs(body) {
  const paras = String(body || '').replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const link = (s) => esc(s).replace(/https:\/\/[^\s<>"']+/g, (u) => `<a href="${u}" style="color:${ACCENT};">${u}</a>`).replace(/\n/g, '<br>');
  return {
    html: paras.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${INK};">${link(p)}</p>`).join('\n'),
    text: paras.join('\n\n'),
  };
}

/* ---------- the frame ---------- */
// Headline and small label shown at the top of each email (by template name; set in renderTemplate).
const HEADS = {
  welcome: ['Welcome', 'Welcome to TypeCraft'],
  verify_email: ['Account', 'Confirm your email'],
  otp_login: ['Sign in', 'Your sign-in code'],
  admin_otp: ['Admin sign-in', 'Your admin sign-in code'],
  login_alert: ['Security', 'New sign-in to your account'],
  password_reset: ['Security', 'Reset your password'],
  password_changed: ['Security', 'Your password was changed'],
  security_alert: ['Security', 'Security notice'],
  email_changed: ['Security', 'Your email was changed'],
  payment_success: ['Payment', 'Payment received'],
  payment_failed: ['Payment', "Your payment didn't go through"],
  invoice: ['Invoice', 'Your invoice'],
  subscription_renewal_reminder: ['Your plan', 'Your plan ends soon'],
  subscription_expired: ['Your plan', 'Your plan has ended'],
  refund_processed: ['Refund', 'Your refund is on its way'],
  announcement: ['News', null],
  account_update: ['Account', null],
  test_completed: ['Typing test', 'Your typing test result'],
  contact_received: ['Support', 'We got your message'],
  contact_forward: ['Support', 'New contact message'],
  institute_invite: ['Institute', null],
  student_invite: ['Institute', null],
  institute_reminder: ['Institute', null],
};
const DARK = '#0f1b19';

function layout(site, { subject, preheader, blocks, unsubscribe = false, heading }) {
  const support = site.supportEmail;
  const home = site.siteUrl;
  const homeLabel = home.replace(/^https?:\/\//, '');
  const unsub = unsubscribe && site.unsubscribeUrl ? site.unsubscribeUrl : null;
  const eyebrow = site.eyebrow || '';
  const title = heading || site.heading || subject;
  const link = (path, label) => `<a href="${esc(home + path)}" style="color:${MUTED};text-decoration:underline;">${esc(label)}</a>`;
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${BG};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};">${esc(preheader || '')}&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background:${BG};">
<tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;">
<tr><td bgcolor="${DARK}" style="background:${DARK};border-radius:16px 16px 0 0;padding:20px 28px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="middle" style="padding-right:10px;"><a href="${esc(home)}" style="text-decoration:none;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="34" height="34" bgcolor="#45cdb6" style="width:34px;height:34px;background:#45cdb6;border-radius:9px;border-bottom:3px solid #177a6c;font-family:Georgia,'Times New Roman',serif;font-size:19px;font-weight:bold;color:${DARK};">T</td></tr></table></a></td>
    <td valign="middle" style="font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#ece7d9;"><a href="${esc(home)}" style="color:#ece7d9;text-decoration:none;">type<em style="color:#5fd6c0;font-style:italic;">craft</em></a></td>
  </tr></table>
</td></tr>
<tr><td bgcolor="#ffffff" style="background:#ffffff;border:1px solid ${LINE};border-top:0;border-radius:0 0 16px 16px;padding:30px 30px 26px;font-family:Arial,Helvetica,sans-serif;">
${eyebrow ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${ACCENT};margin:0 0 8px;">${esc(eyebrow)}</div>` : ''}
<h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;font-weight:bold;color:${INK};">${esc(title)}</h1>
${blocks.map((b) => b.html).join('\n')}
<div style="margin-top:8px;padding-top:16px;border-top:1px solid ${LINE};font-size:14px;line-height:1.6;color:${MUTED};">Happy typing,<br><span style="color:${INK};font-weight:bold;">The TypeCraft team</span></div>
</td></tr>
<tr><td align="center" style="padding:20px 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:${MUTED};">
${link('/dashboard', 'Dashboard')} &nbsp;·&nbsp; ${link('/faq', 'Help')} &nbsp;·&nbsp; ${link('/privacy', 'Privacy')}<br>
Questions? Write to <a href="mailto:${esc(support)}" style="color:${ACCENT};">${esc(support)}</a> or reply to this email.<br>
<a href="${esc(home)}" style="color:${MUTED};">${esc(homeLabel)}</a> · TypeCraft, touch typing made in India${unsub ? `<br><a href="${esc(unsub)}" style="color:${MUTED};">Unsubscribe from announcements</a>` : ''}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = [
    title,
    ...blocks.map((b) => b.text).filter(Boolean),
    'Happy typing,\nThe TypeCraft team',
    '—',
    `TypeCraft · ${home}`,
    `Questions? ${support} (or reply to this email)`,
    unsub ? `Unsubscribe from announcements: ${unsub}` : '',
  ].filter(Boolean).join('\n\n');
  return { subject, html, text };
}

/* ---------- templates ---------- */
export const TEMPLATES = {
  welcome(d, site) {
    const subject = 'Welcome to TypeCraft';
    return layout(site, { subject, preheader: 'Your first lesson takes about five minutes.', blocks: [
      P(hi(d)),
      P('Welcome to TypeCraft. Your account is ready, and your progress is saved to it on every device you sign in on.'),
      P('Start with the home row: the first lesson takes about five minutes, and a few minutes a day is all it takes to build real speed.'),
      Button('Start your first lesson', `${site.siteUrl}/app`),
      Small(d.freeLessons ? `Free includes ${d.freeLessons}, the Daily Challenge and typing tests. You can see every plan at any time on the pricing page.`
        : 'You can see every plan, and what each includes, at any time on the pricing page.'),
    ] });
  },

  verify_email(d, site) {
    const change = !!d.newEmail;
    const subject = change ? 'Confirm your new TypeCraft email' : 'Confirm your TypeCraft email';
    const blocks = [P(hi(d))];
    if (change) blocks.push(P(`To make ${d.newEmail} the email for your TypeCraft account, confirm it with the button below.`));
    else blocks.push(P('Please confirm this email address for your TypeCraft account.'));
    blocks.push(Button(change ? 'Confirm new email' : 'Confirm email', d.link));
    if (d.code) {
      blocks.push(P('Or enter this code on the confirmation page:'), Code(d.code, 'Confirmation code'));
      blocks.push(Small('The code expires in 10 minutes. The link works once and expires in 24 hours.'));
    } else {
      blocks.push(Small('The link works once and expires in 24 hours.'));
    }
    blocks.push(Small("If you didn't ask for this, you can ignore this email."));
    return layout(site, { subject, preheader: d.code ? `Your code is ${d.code}` : 'Confirm your email address', blocks });
  },

  otp_login(d, site) {
    const minutes = d.minutes || 10;
    const subject = 'Your TypeCraft sign-in code'; // never the code itself: subjects are kept in email_logs
    return layout(site, { subject, preheader: `Expires in ${minutes} minutes.`, blocks: [
      P(hi(d)),
      P('Use this code to sign in to TypeCraft:'),
      Code(d.code, 'Enter this code'),
      Small(`It expires in ${minutes} minutes and works once. Never share it: TypeCraft staff will never ask you for it.`),
      Small("If you didn't try to sign in, you can ignore this email; nobody can sign in without the code."),
    ] });
  },

  admin_otp(d, site) {
    const minutes = d.minutes || 10;
    const subject = 'Your TypeCraft admin sign-in code'; // never the code itself: subjects are kept in email_logs
    return layout(site, { subject, preheader: `Expires in ${minutes} minutes.`, blocks: [
      P(hi(d)),
      P('Someone entered your password on the TypeCraft admin sign-in page. Use this code to finish signing in:'),
      Code(d.code, 'Admin sign-in code'),
      ...(d.device ? [Rows([['Device', d.device]])] : []),
      Small(`It expires in ${minutes} minutes and works once. Never share it: nobody at TypeCraft will ask you for it.`),
      Small("If this wasn't you, your password is known to someone else: change it now. Without this code nobody can open the admin."),
    ] });
  },

  login_alert(d, site) {
    const subject = 'New sign-in to your TypeCraft account';
    return layout(site, { subject, preheader: `Signed in on ${d.device || 'a new device'}`, blocks: [
      P(hi(d)),
      P('Your TypeCraft account was just signed in to from a device we have not seen before.'),
      Rows([['Device', d.device || 'Unknown'], ['When', dateTime(d.time)], ['Where', d.location || null]]),
      P('If this was you, there is nothing to do.'),
      P("If it wasn't you, change your password now. Changing it signs out every other device."),
      Button('Change password', `${site.siteUrl}/forgot-password`),
      Small('You can turn these alerts off in your account settings.'),
    ] });
  },

  password_reset(d, site) {
    const minutes = d.minutes || 60;
    const subject = 'Reset your TypeCraft password';
    return layout(site, { subject, preheader: 'This link expires in 1 hour.', blocks: [
      P(hi(d)),
      P('Someone (hopefully you) asked to reset the password for your TypeCraft account. To choose a new password, use the button below.'),
      Button('Choose a new password', d.link),
      Small(`The link works once and expires in ${minutes === 60 ? '1 hour' : `${minutes} minutes`}.`),
      Small("If you didn't ask for this, ignore this email; your password stays the same."),
    ] });
  },

  password_changed(d, site) {
    const subject = 'Your TypeCraft password was changed';
    return layout(site, { subject, preheader: 'Other devices have been signed out.', blocks: [
      P(hi(d)),
      P(`The password for your TypeCraft account was changed on ${dateTime(d.time)}. Every other device has been signed out.`),
      P(`If you did this, there is nothing to do. If you didn't, reset your password right away and write to us at ${site.supportEmail}.`),
      Button('Reset password', `${site.siteUrl}/forgot-password`),
    ] });
  },

  security_alert(d, site) {
    const title = d.title || 'Security notice';
    const subject = `Security alert: ${title}`;
    return layout(site, { subject, preheader: title, blocks: [
      P(hi(d)),
      P(d.message || ''),
      Rows([['When', dateTime(d.time)]]),
      P(`If this wasn't you, reset your password and contact us at ${site.supportEmail}.`),
      Button('Review your account', `${site.siteUrl}/account/settings`),
    ] });
  },

  email_changed(d, site) {
    const subject = 'The email on your TypeCraft account was changed';
    return layout(site, { subject, preheader: `It is now ${d.newEmail}`, blocks: [
      P(hi(d)),
      P(`The email address for your TypeCraft account was changed from ${d.oldEmail} to ${d.newEmail} on ${dateTime(d.time)}.`),
      P(`From now on we'll write to the new address. If you didn't make this change, write to us at ${site.supportEmail} right away so we can secure your account.`),
    ] });
  },

  payment_success(d, site) {
    const subject = `Payment received: TypeCraft ${d.packageName}`;
    const invoice = url(site, d.invoiceUrl) || (d.invoiceNumber ? `${site.siteUrl}/account/invoices/${encodeURIComponent(d.invoiceNumber)}` : null);
    const blocks = [
      P(hi(d)),
      P(`Thank you. Your payment was successful and ${d.packageName} is now active on your account.`),
      Rows([
        ['Plan', d.packageName],
        ['Amount paid', money(d.amountPaise, d.currency)],
        ['Active from', d.startsAt ? dateOnly(d.startsAt) : null],
        ['Valid until', d.expiresAt ? dateOnly(d.expiresAt) : 'Never expires'],
        ['Order', d.orderId || null],
        ['Payment ID', d.paymentId || null],
        ['Invoice', d.invoiceNumber || null],
      ]),
      Button('Start practising', `${site.siteUrl}/app`),
    ];
    if (invoice) blocks.push(Raw(`<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:${MUTED};">Your invoice: <a href="${esc(invoice)}" style="color:${ACCENT};">${esc(d.invoiceNumber || 'view invoice')}</a></p>`, `Your invoice: ${invoice}`));
    return layout(site, { subject, preheader: `${d.packageName} is active.`, blocks });
  },

  payment_failed(d, site) {
    const subject = `Your TypeCraft payment didn't go through`;
    const retry = url(site, d.retryUrl) || `${site.siteUrl}/pricing`;
    return layout(site, { subject, preheader: 'No money was taken for a failed payment.', blocks: [
      P(hi(d)),
      P(`Your payment for ${d.packageName}${d.amountPaise ? ` (${money(d.amountPaise)})` : ''} didn't go through, so the plan hasn't been activated.`),
      d.reason ? Rows([['Reason', d.reason]]) : Raw('', ''),
      P('If money was taken from your account, it is returned automatically by your bank within 5–7 working days. You can try again at any time.'),
      Button('Try again', retry),
    ] });
  },

  invoice(d, site) {
    const subject = `Your TypeCraft invoice ${d.invoiceNumber}`;
    const link = url(site, d.invoiceUrl) || `${site.siteUrl}/account/invoices/${encodeURIComponent(d.invoiceNumber || '')}`;
    const lines = Array.isArray(d.lines) ? d.lines.slice(0, 20).map((l) => [String(l.description || ''), money(l.amountPaise)]) : [];
    return layout(site, { subject, preheader: `Invoice ${d.invoiceNumber} for ${money(d.amountPaise)}`, blocks: [
      P(hi(d)),
      P('Here is your invoice for your TypeCraft purchase.'),
      Rows([['Invoice', d.invoiceNumber], ['Date', d.issuedAt ? dateOnly(d.issuedAt) : null], ...lines, ['Total', money(d.amountPaise)]]),
      Button('View and print invoice', link),
    ] });
  },

  subscription_renewal_reminder(d, site) {
    const subject = `Your TypeCraft ${d.packageName} plan ends on ${dateOnly(d.expiresAt)}`;
    return layout(site, { subject, preheader: 'Renew to keep every lesson and your analytics.', blocks: [
      P(hi(d)),
      P(`Your ${d.packageName} plan ends on ${dateOnly(d.expiresAt)}. After that your account moves to Free: your progress is kept, but locked lessons and features are paused.`),
      P('Renewing now adds a new period after the current one ends, so you lose no days.'),
      Button('Renew plan', url(site, d.renewUrl) || `${site.siteUrl}/pricing`),
    ] });
  },

  subscription_expired(d, site) {
    const subject = `Your TypeCraft ${d.packageName} plan has ended`;
    return layout(site, { subject, preheader: 'Your progress is safe.', blocks: [
      P(hi(d)),
      P(`Your ${d.packageName} plan ended${d.expiredAt ? ` on ${dateOnly(d.expiredAt)}` : ''}. Your account is on Free now, and all your progress, stars and history are kept.`),
      P('Pick a plan whenever you are ready to carry on where you left off.'),
      Button('See plans', url(site, d.renewUrl) || `${site.siteUrl}/pricing`),
    ] });
  },

  refund_processed(d, site) {
    const subject = `Refund processed: ${money(d.amountPaise)}`;
    return layout(site, { subject, preheader: 'It reaches your account in 5–7 working days.', blocks: [
      P(hi(d)),
      P(`We've processed a refund of ${money(d.amountPaise)}${d.packageName ? ` for ${d.packageName}` : ''}. Banks usually show it within 5–7 working days.`),
      Rows([['Amount', money(d.amountPaise)], ['Order', d.orderId || null], ['Refund ID', d.refundId || null], ['Reason', d.reason || null]]),
    ] });
  },

  announcement(d, site) {
    const subject = String(d.subject || 'News from TypeCraft');
    return layout(site, { subject, preheader: subject, unsubscribe: true, blocks: [
      P(hi(d)),
      Paragraphs(d.body),
    ] });
  },

  account_update(d, site) {
    const subject = String(d.title || 'An update to your TypeCraft account');
    const cta = url(site, d.ctaUrl);
    return layout(site, { subject, preheader: subject, blocks: [
      P(hi(d)),
      Paragraphs(d.message),
      cta ? Button(d.ctaLabel || 'Open TypeCraft', cta) : Raw('', ''),
    ] });
  },

  institute_invite(d, site) {
    const admin = d.role === 'admin';
    const subject = `You're invited to ${String(d.instituteName || 'an institute').replace(/[\r\n]+/g, ' ')} on TypeCraft`;
    return layout(site, { subject, preheader: admin ? 'Set up batches and see your students\u2019 progress.' : 'See the progress of the batches you teach.', blocks: [
      P(hi(d)),
      P(`${d.invitedBy || 'TypeCraft'} has invited you to ${d.instituteName} on TypeCraft as ${admin ? 'its admin' : 'a teacher'}.`),
      P(admin ? 'As the admin you set up batches, invite teachers, add students and see everyone\u2019s progress.'
        : 'As a teacher you see the progress of the batches you teach and print their certificates.'),
      P(`Sign in, or create an account, with this email address${d.email ? ` (${d.email})` : ''}. Then accept the invitation.`),
      Button('Open the invitation', url(site, d.link) || `${site.siteUrl}/institute`),
      Small("If you weren't expecting this, you can ignore this email: nothing happens unless you accept."),
    ] });
  },

  student_invite(d, site) {
    const subject = `Join ${String(d.batchName || 'your batch').replace(/[\r\n]+/g, ' ')} at ${String(d.instituteName || 'your institute').replace(/[\r\n]+/g, ' ')} on TypeCraft`;
    return layout(site, { subject, preheader: `Your batch code is ${d.batchCode}.`, blocks: [
      P(hi(d)),
      P(`${d.instituteName} uses TypeCraft for typing practice, and has added you to its batch ${d.batchName}. Joining gives you the institute's plan while you study there.`),
      Code(d.batchCode, 'Batch code'),
      Button('Join the batch', url(site, d.joinPath) || `${site.siteUrl}/join`),
      P('Sign in, or create an account with any email address, then confirm that you are 18 or older. Your teachers will see your typing progress while you are in the batch.'),
      Small("If you don't study at this institute, you can ignore this email."),
    ] });
  },

  institute_reminder(d, site) {
    const seats = d.kind === 'seats';
    const subject = seats ? `${d.instituteName}: ${d.seatsUsed} of ${d.seats} TypeCraft seats are in use`
      : `${d.instituteName}: your TypeCraft seats end on ${d.lastDay}`;
    return layout(site, { subject: subject.replace(/[\r\n]+/g, ' '), preheader: seats ? 'Add seats before you run out.' : 'Renew to keep your students practising.', blocks: [
      P(hi(d)),
      P(seats ? `${d.seatsUsed} of your ${d.seats} seats are in use. When every seat is taken, new students can't join your batches. To add seats, reply to this email.`
        : `Your institute's seats end on ${d.lastDay}${d.days != null ? `, in ${d.days} day${d.days === 1 ? '' : 's'}` : ''}. After that your students go back to the Free plan; their progress and your batches stay. To renew, reply to this email.`),
      Button('Open your institute', url(site, d.link) || `${site.siteUrl}/institute`),
    ] });
  },

  test_completed(d, site) {
    const subject = `Typing test: ${Math.round(Number(d.wpm) || 0)} WPM at ${Math.round(Number(d.accuracy) || 0)}% accuracy`;
    return layout(site, { subject, preheader: d.best ? 'A new personal best!' : 'Your result is saved.', blocks: [
      P(hi(d)),
      P(d.best ? 'A new personal best. Nicely done.' : 'Your typing test result is saved to your history.'),
      Rows([
        ['Speed', `${Math.round(Number(d.wpm) || 0)} WPM`],
        ['Accuracy', `${Math.round(Number(d.accuracy) || 0)}%`],
        ['Duration', d.duration ? `${Math.round(d.duration / 60 * 10) / 10} min` : null],
        ['Errors', d.errors != null ? String(d.errors) : null],
      ]),
      Button('Take another test', `${site.siteUrl}/typing-test`),
      Small('You can turn test result emails off in your account settings.'),
    ] });
  },

  contact_received(d, site) {
    const days = d.replyDays || 2;
    const subject = 'We got your message';
    return layout(site, { subject, preheader: `We usually reply within ${days} working days.`, blocks: [
      P(hi(d)),
      P(`Thanks for writing to TypeCraft. We've received your message and usually reply within ${days} working days.`),
      Small('Your message:'),
      Quote(d.message),
      Small('To add anything, just reply to this email.'),
    ] });
  },

  contact_forward(d, site) {
    const subject = `${d.priority ? '[Priority] ' : ''}Contact: ${d.topic || 'general'} from ${d.name}`;
    return layout(site, { subject, preheader: String(d.message || '').slice(0, 90), blocks: [
      Rows([
        ['From', d.name], ['Email', d.email], ['Topic', d.topic || 'general'],
        ['Account', d.userId || 'not signed in'], ['Plan', d.plan || null],
        ['Priority', d.priority ? 'yes' : null], ['Message ID', d.messageId || null],
      ]),
      Quote(d.message),
      Small('Reply to this email to answer the sender directly.'),
    ] });
  },
};

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/** Renders a template; throws for an unknown name. */
export function renderTemplate(name, data = {}, site) {
  const fn = Object.prototype.hasOwnProperty.call(TEMPLATES, name) ? TEMPLATES[name] : null;
  if (!fn) throw new Error(`unknown email template: ${name}`);
  const s = {
    siteUrl: String(site && site.siteUrl || 'https://typecrafttyping.in').replace(/\/+$/, ''),
    supportEmail: (site && site.supportEmail) || 'hello@typecrafttyping.com',
    unsubscribeUrl: site && site.unsubscribeUrl || null,
    eyebrow: (HEADS[name] || [])[0] || '',
    heading: (HEADS[name] || [])[1] || null,
  };
  const out = fn(data || {}, s);
  return { subject: String(out.subject).replace(/[\r\n]+/g, ' ').slice(0, 200), html: out.html, text: out.text };
}
