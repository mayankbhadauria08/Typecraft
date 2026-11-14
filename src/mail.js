// Central email service — see docs/SAAS-CONTRACTS.md §4. Placeholder until the email part is built.
export const ROUTES = {};
export const PATTERNS = [];
export async function cron(env, ctx, kind) {}
/** Queue and send one templated email. Never throws; returns { id, status }. */
export async function sendTemplate(env, ctx, { to, userId = null, template, data = {}, category = 'transactional' }) {
  return { id: null, status: 'skipped' };
}
