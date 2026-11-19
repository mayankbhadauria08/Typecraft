// Email templates: what every email TypeCraft sends looks like, filled with sample data (docs/ADMIN-PHASE-5.md §5).
// Nothing is sent from here.
//
//   GET /api/console/email-templates          emails.view  → { groups, templates: [{ name, title, group, about }] }
//   GET /api/console/email-templates/:name    emails.view  → { name, title, group, about, subject, text, previewUrl }
//   GET /console/email-preview/:name          emails.view  the email itself, for the page's frame (served by ./router.js)
//
// The preview is an email's own HTML, which needs inline styles; so it is served on its own address with its own
// policy (no scripts at all, sandboxed, framable by the console only) instead of being put into a console page.
import { HttpError, json } from '../http.js';
import { TEMPLATE_NAMES } from '../mail-templates.js';
import { renderPreview } from '../mail.js';
import { SAMPLES, ABOUT, GROUPS } from '../mail-samples.js';
import { requireAdmin } from './session.js';
import { CONSOLE_BASE } from './config.js';

const known = (name) => typeof name === 'string' && TEMPLATE_NAMES.includes(name);
const describe = (name) => ({ name, title: ABOUT[name].title, group: ABOUT[name].group, about: ABOUT[name].about });

export async function getTemplates(request, env) {
  await requireAdmin(env, request, 'emails.view');
  const templates = TEMPLATE_NAMES.map(describe)
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || TEMPLATE_NAMES.indexOf(a.name) - TEMPLATE_NAMES.indexOf(b.name));
  return json({ groups: GROUPS, templates });
}

export async function getTemplate(request, env, ctx, params) {
  await requireAdmin(env, request, 'emails.view');
  if (!known(params.name)) throw new HttpError(404, 'not_found', 'There is no email with this name.');
  const out = await renderPreview(env, params.name, SAMPLES[params.name]);
  return json({ ...describe(params.name), subject: out.subject, text: out.text, previewUrl: `${CONSOLE_BASE}/email-preview/${params.name}` });
}

// The preview's own policy: the email's inline styles, nothing else; no scripts, forms or plugins; only the
// console may show it in a frame.
const PREVIEW_CSP = ["default-src 'none'", "style-src 'unsafe-inline'", 'img-src data:', "base-uri 'none'", "form-action 'none'",
  "frame-ancestors 'self'", 'sandbox'].join('; ');

/** For ./router.js: the preview document, or null when the address is not a preview. `can(permission)` → boolean. */
export async function servePreview(request, env, sub, can) {
  const m = sub.match(/^\/email-preview\/([a-z_]{1,40})$/);
  if (!m) return null;
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PREVIEW_CSP, 'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow',
    'Cross-Origin-Resource-Policy': 'same-origin' };
  const text = (status, body) => new Response(request.method === 'HEAD' ? null : body, { status, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } });
  if (!(await can('emails.view'))) return text(403, "Your role doesn't include email previews.");
  if (!known(m[1])) return text(404, 'There is no email with this name.');
  const out = await renderPreview(env, m[1], SAMPLES[m[1]]);
  return new Response(request.method === 'HEAD' ? null : out.html, { status: 200, headers });
}

export const ROUTES = {
  'GET /api/console/email-templates': getTemplates,
};
export const PATTERNS = [
  ['GET', /^\/api\/console\/email-templates\/([a-z_]{1,40})$/, ['name'], getTemplate],
];
