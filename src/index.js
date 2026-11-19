// TypeCraft Worker: serves index.html as a static asset and handles /api/* for
// accounts and progress. Static files never reach this code (see wrangler.jsonc).
import { HttpError, json, errorResponse, assertSameOriginWrite } from './http.js';
import { forgetAll } from './memo.js';
import * as auth from './auth.js';
import * as account from './account.js';
import * as progress from './progress.js';
import * as api from './api.js';
import * as admin from './admin.js';
import { rebuildAll } from './pipeline.js';
// SaaS modules: each exports ROUTES ({'METHOD /path': handler}), PATTERNS ([method, regex, names, handler])
// and optionally cron(env, ctx, kind). See docs/SAAS-CONTRACTS.md.
import * as billing from './billing.js';
import * as adminApi from './admin-api.js';
import * as mail from './mail.js';
import * as content from './content.js';
import * as site from './site.js';
import * as learningRules from './learning-rules.js';
import * as courseStore from './course-store.js';   // published course edits (docs/ADMIN-PHASE-3.md) // rules for everyone about lessons (docs/UNLOCK-RULES.md)
import * as exams from './exams.js';          // exam practice and certificate codes (docs/EXAM-MODES.md)
import * as consoleApi from './console/index.js'; // admin console: sign-in, roles and permissions (docs/ADMIN-CONSOLE.md)
const MODULES = [billing, adminApi, mail, content, learningRules, courseStore, exams, consoleApi];

const CORE_ROUTES = {
  'GET /api/auth/me': auth.me,
  'POST /api/auth/signup': auth.signup,
  'POST /api/auth/login': auth.login,
  'POST /api/auth/logout': auth.logout,
  'POST /api/auth/logout-all': auth.logoutEverywhere,
  'POST /api/auth/forgot-password': auth.forgotPassword,
  'POST /api/auth/reset-password': auth.resetPassword,
  'POST /api/auth/change-password': auth.changePassword,
  'POST /api/auth/verify-email': auth.verifyEmail,
  'POST /api/auth/resend-verification': auth.resendVerification,

  'GET /api/user/profile': account.getProfile,
  'PUT /api/user/profile': account.updateProfile,
  'POST /api/user/email-change': account.requestEmailChange,
  'POST /api/user/delete': account.deleteAccount,

  'GET /api/user/progress': progress.getProgress,
  'GET /api/user/progress/summary': progress.getSummary,
  'GET /api/user/progress/current': progress.getCurrent,
  'POST /api/user/progress/lesson-start': progress.savePosition,
  'PUT /api/user/progress/position': progress.savePosition,
  'POST /api/user/progress/lesson-complete': progress.completeLesson,
  'PUT /api/user/progress/state': progress.saveState,
  'POST /api/user/progress/import': progress.importGuest,

  // next version: events, totals and rewards (src/api.js, src/pipeline.js)
  'GET /api/user/state': api.getState,
  'POST /api/user/events': api.postEvents,
  'PUT /api/user/position': api.putPosition,
  'POST /api/user/stats': api.postStats,
  'PUT /api/user/settings': api.putSettings,
  'GET /api/user/history': api.getHistory,
  'POST /api/user/import': api.postImport,
  'GET /api/user/export': api.getExport,
  'POST /api/user/reset': api.postReset,
  'GET /api/admin/health': admin.getHealth,
};
const ROUTES = Object.assign({}, CORE_ROUTES, ...MODULES.map((m) => m.ROUTES || {}));
// routes with a parameter in the path
const PATTERNS = [
  ...MODULES.flatMap((m) => m.PATTERNS || []),
  ['GET', /^\/api\/user\/lessons\/([\w-]{1,20})$/, ['id'], api.getLesson],
  ['GET', /^\/api\/user\/ghosts\/([\w:.-]{1,40})$/, ['key'], api.getGhost],
];

async function handleApi(request, env, ctx) {
  const { pathname } = new URL(request.url);
  let handler = ROUTES[`${request.method} ${pathname}`];
  let params = {};
  if (!handler) {
    for (const [method, re, names, fn] of PATTERNS) {
      const m = pathname.match(re);
      if (m && method === request.method) { handler = fn; params = Object.fromEntries(names.map((n, i) => [n, m[i + 1]])); break; }
    }
  }
  if (!handler) {
    const known = Object.keys(ROUTES).some((r) => r.endsWith(` ${pathname}`)) || PATTERNS.some(([, re]) => re.test(pathname));
    throw new HttpError(known ? 405 : 404, known ? 'method_not_allowed' : 'not_found', known ? 'Method not allowed.' : 'Not found.');
  }
  if (!env.DB) throw new HttpError(503, 'database_not_configured', "Accounts aren't available yet: the site's database isn't connected.");
  // webhooks come from payment/email providers, not from this site's pages: they check their own signatures
  if (request.method !== 'GET' && !pathname.startsWith('/api/webhooks/')) assertSameOriginWrite(request);
  return handler(request, env, ctx, params);
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    // host rules (www → apex, canonical domain) and every HTML page go through src/site.js
    const early = await site.beforeAll(request, env, ctx);
    if (early) return early;
    if (pathname.startsWith('/api/')) {
      try {
        const res = await handleApi(request, env, ctx);
        // an admin or console change (prices, plans, seller details, rules): public pages read it fresh
        if (request.method !== 'GET' && /^\/api\/(admin|console)\//.test(pathname)) forgetAll(env);
        return res;
      } catch (err) {
        if (/no such table/i.test(String(err && err.message))) {
          return errorResponse(new HttpError(503, 'database_not_migrated', "Accounts aren't available yet: the database's tables haven't been created (SETUP.md, step 1)."));
        }
        return errorResponse(err);
      }
    }
    const page = await site.servePage(request, env, ctx);
    if (page) return page;
    return env.ASSETS.fetch(request);
  },

  // Nightly: clean-up of expired sessions and links and old rate-limit windows,
  // then every learner's totals are rebuilt from their saved events and compared
  // with the stored ones; differences are corrected and logged (rebuild_runs, rebuild_diffs).
  // Learning history is kept until the account is deleted.
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    const now = new Date().toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now),
      env.DB.prepare('DELETE FROM password_reset_tokens WHERE expires_at <= ?1').bind(weekAgo),
      env.DB.prepare('DELETE FROM email_tokens WHERE expires_at <= ?1').bind(weekAgo),
      env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?1').bind(Math.floor(Date.now() / 1000) - 24 * 3600),
    ]);
    // every 10 minutes: email retries, payment reconciliation; daily: expiries and reminders
    for (const m of MODULES) {
      if (typeof m.cron !== 'function') continue;
      try { await m.cron(env, ctx, event.cron); } catch (err) { console.error('cron failed:', err && err.message); }
    }
    if (event.cron !== '17 21 * * *') return; // the rest is the nightly job
    try {
      const r = await rebuildAll(env);
      console.log('nightly rebuild:', JSON.stringify(r));
    } catch (err) {
      console.error('nightly rebuild failed:', err && err.message);
    }
  },
};
