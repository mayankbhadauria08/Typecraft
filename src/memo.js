// Remember slow-changing reads for a short while, so public pages don't wait on the database
// for data that barely changes (seller details, the plans, the Free plan's lessons).
// Kept per database binding and per Worker instance; an admin or console change clears it on
// the instance that made it, and other instances catch up within the time given (60 s).
const stores = new WeakMap();

function storeFor(env) {
  const key = (env && env.DB) || env;
  if (!key || typeof key !== 'object') return null;
  let s = stores.get(key);
  if (!s) { s = new Map(); stores.set(key, s); }
  return s;
}

/** The value of load() for `key`, read again only after ttlMs. A null or failed read is not kept. */
export async function remember(env, key, ttlMs, load) {
  const store = storeFor(env);
  if (!store) return load();
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.until > now) return hit.value;
  const value = Promise.resolve().then(load);
  store.set(key, { until: now + ttlMs, value });
  try {
    const v = await value;
    if (v == null) store.delete(key);
    return v;
  } catch (err) {
    store.delete(key);
    throw err;
  }
}

/** Forget everything remembered for this database (after an admin or console change). */
export function forgetAll(env) {
  const store = storeFor(env);
  if (store) store.clear();
}

export const PUBLIC_DATA_TTL = 60 * 1000;
