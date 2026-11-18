// Data the site part reads straight from D1 while rendering pages (no HTTP round trip).
import { packageView, catalogueView } from './package-view.js';
/* ---------- data pages read on the server ---------- */
const parseJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
/** Same shape as GET /api/packages (docs §5), straight from D1. Used for JSON-LD and as the
    pricing page's first paint when the API isn't reachable. null without a database. */
export async function loadPackages(env) {
  if (!env.DB) return null;
  try {
    const [pk, ft] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM packages WHERE active = 1 ORDER BY display_order, price_paise'),
      env.DB.prepare('SELECT key, label, description FROM package_features ORDER BY display_order'),
    ]);
    const label = Object.fromEntries(ft.results.map((f) => [f.key, f.label]));
    const packages = pk.results.map((p) => packageView(p, label));
    const features = catalogueView(ft.results).map((f) => ({ key: f.key, label: f.label, description: f.description }));
    return { packages, features };
  } catch { return null; }
}
const DEFAULT_SETTINGS = {
  seller: { name: 'TypeCraft', legalName: '[Your full name] (sole proprietor)', address: '[Your address, City, State, PIN]', email: 'hello@typecrafttyping.com', phone: '' },
  support: { email: 'hello@typecrafttyping.com', hours: 'Mon–Sat, 10:00–18:00 IST', replyDays: 2 },
};
export async function loadSettings(env) {
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!env.DB) return out;
  try {
    const rows = (await env.DB.prepare("SELECT key, value FROM platform_settings WHERE key IN ('seller', 'support')").all()).results;
    for (const r of rows) Object.assign(out[r.key], parseJson(r.value, {}));
  } catch { /* defaults */ }
  return out;
}
