// Admin console settings shared by the server modules in src/console/.
// See docs/ADMIN-CONSOLE.md.

/** Where the console's pages live. Becomes '/admin' when it replaces the current admin pages. */
export const CONSOLE_BASE = '/console';

// __Host- cookies: Secure, Path=/, no Domain (see src/http.js). Strict: never sent on cross-site requests.
export const ADMIN_COOKIE = '__Host-tc_admin';
export const STEP_COOKIE = '__Host-tc_admin_step';

export const IDLE_MS = 30 * 60 * 1000;      // signed out after 30 minutes without activity
export const MAX_MS = 8 * 60 * 60 * 1000;   // and after 8 hours whatever the activity
export const FRESH_MS = 10 * 60 * 1000;     // sensitive actions need the password confirmed in the last 10 minutes
export const TOUCH_MS = 60 * 1000;          // last_seen_at is written at most once a minute
export const STEP_MS = 10 * 60 * 1000;      // time to enter the emailed code after the password step

export const ROLE_LABELS = { owner: 'Super Admin', admin: 'Admin', support: 'Support' };
