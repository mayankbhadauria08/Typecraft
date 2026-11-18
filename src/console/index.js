// The admin console's server side, as one module for src/index.js (ROUTES, PATTERNS, cron).
// Pages are served by ./router.js (called from src/site.js). See docs/ADMIN-CONSOLE.md.
import { HttpError } from '../http.js';
import * as auth from './auth.js';
import * as access from './access-api.js';

// Until migration 0005 is applied the console's tables don't exist: say so plainly.
const whenReady = (handler) => async (request, env, ctx, params) => {
  try { return await handler(request, env, ctx, params); } catch (err) {
    if (/no such table: (admin_sessions|role_permissions)/i.test(String(err && err.message))) {
      throw new HttpError(503, 'console_not_ready', "The admin console isn't switched on yet: database update 0005 hasn't been applied.");
    }
    throw err;
  }
};
export const ROUTES = Object.fromEntries(Object.entries({ ...auth.ROUTES, ...access.ROUTES }).map(([route, fn]) => [route, whenReady(fn)]));
export const PATTERNS = [];

/** Nightly: console sign-ins older than 30 days leave the history. */
export async function cron(env, ctx, kind) {
  if (kind !== '17 21 * * *') return;
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?1').bind(cutoff).run();
}
