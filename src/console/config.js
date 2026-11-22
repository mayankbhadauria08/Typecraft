// Admin console settings shared by the server modules in src/console/.
// See docs/ADMIN-CONSOLE.md.

/** Where the console's pages live. Since Phase 6 the console is the admin: /console redirects here (src/site.js). */
export const CONSOLE_BASE = '/admin';

// __Host- cookies: Secure, Path=/, no Domain (see src/http.js). Strict: never sent on cross-site requests.
export const ADMIN_COOKIE = '__Host-tc_admin';
export const STEP_COOKIE = '__Host-tc_admin_step';

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/**
 * How long an admin sign-in lasts. A Super Admin picks one under Security (platform_settings 'admin_session',
 * { length: '1d' }); it is read on every request, so a change applies at once to everyone signed in.
 * idleMs: signed out after this long without a request. maxMs: signed out this long after signing in,
 * whatever the activity. The sensitive-change password check (FRESH_MS) is the same for every choice.
 */
export const SESSION_LENGTHS = {
  '30m': { idleMs: 30 * MIN, maxMs: 8 * HOUR, idle: '30 minutes', max: '8 hours' },
  '2h': { idleMs: 2 * HOUR, maxMs: 12 * HOUR, idle: '2 hours', max: '12 hours' },
  '8h': { idleMs: 8 * HOUR, maxMs: DAY, idle: '8 hours', max: '1 day' },
  '1d': { idleMs: DAY, maxMs: 7 * DAY, idle: '1 day', max: '7 days' },
};
export const DEFAULT_SESSION_LENGTH = '30m';
export const SESSION_SETTING = 'admin_session';
/** The cookie outlives every choice: the server alone decides when a session has ended. */
export const COOKIE_MAX_MS = Math.max(...Object.values(SESSION_LENGTHS).map((l) => l.maxMs));

/** The rules for a stored setting (its JSON text, or null): { key, idleMs, maxMs, idle, max }. Anything unknown is the default. */
export function sessionLength(value) {
  let key = DEFAULT_SESSION_LENGTH;
  try { const v = JSON.parse(value || '{}'); if (v && Object.prototype.hasOwnProperty.call(SESSION_LENGTHS, v.length)) key = v.length; } catch { /* the default */ }
  return { key, ...SESSION_LENGTHS[key] };
}
export const FRESH_MS = 10 * 60 * 1000;     // sensitive actions need the password confirmed in the last 10 minutes
export const TOUCH_MS = 60 * 1000;          // last_seen_at is written at most once a minute
export const STEP_MS = 10 * 60 * 1000;      // time to enter the emailed code after the password step

export const ROLE_LABELS = { owner: 'Super Admin', admin: 'Admin', support: 'Support' };
