// Entitlements — see docs/SAAS-CONTRACTS.md §3. Placeholder: everyone is on Free until the billing part is built.
export const FREE = { plan: 'free', planName: 'Free', expiresAt: null, features: ['lessons.first5', 'arcade.daily', 'tests.basic'], limits: { lessons: 'first5', dailyTests: 3, historyDays: 7 } };
export async function entitlementsFor(env, userId) { return { ...FREE, subscriptions: [] }; }
export function has(ent, feature) { return ent.features.includes(feature); }
