// Entitlements — see docs/SAAS-CONTRACTS.md §3. Placeholder until the billing part is built:
// Free plus the union of the user's active user_subscriptions rows (features snapshot).
// The billing part replaces this file (same API); on merge, take the billing version.
export const FREE = { plan: 'free', planName: 'Free', expiresAt: null, features: ['lessons.first5', 'arcade.daily', 'tests.basic'], limits: { lessons: 'first5', dailyTests: 3, historyDays: 7 } };
export async function entitlementsFor(env, userId) {
  let rows = [];
  try {
    rows = (await env.DB.prepare(`SELECT s.id, s.package_id, s.features, s.expires_at, p.name, p.display_order FROM user_subscriptions s JOIN packages p ON p.id = s.package_id
      WHERE s.user_id = ?1 AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?2) ORDER BY p.display_order DESC`).bind(userId, new Date().toISOString()).all()).results;
  } catch { rows = []; }
  if (!rows.length) return { ...FREE, subscriptions: [] };
  const features = new Set(FREE.features);
  for (const r of rows) { try { for (const f of JSON.parse(r.features)) features.add(f); } catch { /* bad snapshot: ignored */ } }
  const best = rows[0];
  return { plan: best.package_id, planName: best.name, expiresAt: rows.some((r) => !r.expires_at) ? null : rows.map((r) => r.expires_at).sort().pop(),
    features: [...features], limits: { lessons: features.has('lessons.all') ? 'all' : 'first5', dailyTests: null, historyDays: features.has('history.full') ? null : 7 },
    subscriptions: rows.map((r) => ({ id: r.id, packageId: r.package_id, packageName: r.name })) };
}
export function has(ent, feature) { return ent.features.includes(feature); }
