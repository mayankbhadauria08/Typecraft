// The admin console's server side, as one module for src/index.js (ROUTES, PATTERNS, cron).
// Pages are served by ./router.js (called from src/site.js). See docs/ADMIN-CONSOLE.md.
import { HttpError } from '../http.js';
import * as auth from './auth.js';
import * as access from './access-api.js';
import * as customers from './customers-api.js';
import * as payments from './payments-api.js';
import * as refunds from './refunds-api.js';
import * as subscriptions from './subscriptions-api.js';
import * as learning from './learning-access-api.js';
import * as packages from './packages-api.js';
import * as dashboard from './dashboard-api.js';
import * as search from './search-api.js';
import * as unlock from './unlock-api.js';
import * as course from './course-api.js';
import * as progress from './progress-api.js';
import * as analytics from './analytics-api.js';
import * as support from './support-api.js';
import * as reports from './reports-api.js';

const PARTS = [auth, access, customers, payments, refunds, subscriptions, learning, packages, dashboard, search, unlock, course, progress, analytics, support, reports];

// A console table that doesn't exist yet means its database update hasn't been applied: say so plainly.
const TABLE_UPDATE = { admin_sessions: '0005', role_permissions: '0005', customer_notes: '0006', access_overrides: '0006', refund_choices: '0006',
  course_drafts: '0007', course_releases: '0007', support_replies: '0011', support_assignments: '0011' };
const whenReady = (handler) => async (request, env, ctx, params) => {
  try { return await handler(request, env, ctx, params); } catch (err) {
    const m = String(err && err.message).match(/no such table: (\w+)/i);
    if (m && TABLE_UPDATE[m[1]]) {
      throw new HttpError(503, 'console_not_ready', `This part of the admin console isn't switched on yet: database update ${TABLE_UPDATE[m[1]]} hasn't been applied.`);
    }
    throw err;
  }
};
export const ROUTES = Object.fromEntries(PARTS.flatMap((part) => Object.entries(part.ROUTES || {})).map(([route, fn]) => [route, whenReady(fn)]));
export const PATTERNS = PARTS.flatMap((part) => part.PATTERNS || []).map(([method, re, names, fn]) => [method, re, names, whenReady(fn)]);

/** Nightly: console sign-ins older than 30 days leave the history. */
export async function cron(env, ctx, kind) {
  if (kind !== '17 21 * * *') return;
  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  await env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?1').bind(cutoff).run();
}
