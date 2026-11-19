// Settings: business details, support contact, and the payments and sign-ups switches (docs/ADMIN-PHASE-5.md §1).
// Console-only endpoints: a console session is required.
//
//   GET /api/console/settings            settings.view    → { settings, changed, incomplete, payments, campaigns, can }
//   PUT /api/console/settings/:section   settings.manage  seller | support | payments | signups; the section's fields.
//                                                         Asks for the password again (settings.manage is sensitive).
//
// Checking and saving live in src/settings.js. A save clears the remembered seller
// details on this Worker straight away (src/index.js forgets after every console change).
import { HttpError, json, readJson, clientIp } from '../http.js';
import { readSettings, checkSection, saveSettings, sellerIncomplete, paymentsMode, SECTIONS } from '../settings.js';
import { requireAdmin } from './session.js';
import { can } from './permissions.js';
import { dailyCap } from './campaigns-api.js';

async function view(env, role) {
  const { settings, changed } = await readSettings(env);
  return {
    settings, changed,
    incomplete: sellerIncomplete(settings.seller),
    payments: { configured: !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET), mode: paymentsMode(env), webhook: !!env.RAZORPAY_WEBHOOK_SECRET },
    campaigns: { dailyCap: await dailyCap(env) },
    can: { manage: await can(env, role, 'settings.manage'), campaignLimit: await can(env, role, 'campaigns.limit') },
  };
}

export async function getSettings(request, env) {
  const who = await requireAdmin(env, request, 'settings.view');
  return json(await view(env, who.role));
}

const SAVED = {
  seller: () => 'Saved. New invoices use these details; invoices already issued keep theirs.',
  support: () => 'Saved. Emails and the contact page use these details from now on.',
  payments: (v) => (v.enabled ? 'Payments are on. Customers can buy plans.' : 'Payments are paused. Checkout says so, and nobody is charged. Plans already bought keep working.'),
  signups: (v) => (v.open ? 'Sign-ups are open.' : 'Sign-ups are closed. Nobody can create an account; everyone with one can still sign in.'),
};

export async function putSettings(request, env, ctx, params) {
  const who = await requireAdmin(env, request, 'settings.manage');
  const section = params.section;
  const body = await readJson(request, 8 * 1024);
  // the whole section is sent, so a field left out means a mistake, not "keep it"
  const missing = SECTIONS[section].filter((f) => !(f in body));
  const { values, errors } = checkSection(section, body);
  for (const f of missing) if (!errors[f]) errors[f] = 'This is needed.';
  if (Object.keys(errors).length) throw new HttpError(400, 'invalid_input', Object.values(errors)[0], errors);
  const out = await saveSettings(env, { [section]: values }, { actorId: who.user.id, ip: clientIp(request) });
  return json({ ...(await view(env, who.role)), saved: out.changed.length > 0,
    message: out.changed.length ? SAVED[section](values) : 'Nothing changed.' });
}

export const ROUTES = {
  'GET /api/console/settings': getSettings,
};
export const PATTERNS = [
  ['PUT', /^\/api\/console\/settings\/(seller|support|payments|signups)$/, ['section'], putSettings],
];
