// Registry of the signed-in account pages (owner: pages part). See docs/SAAS-CONTRACTS.md §8, §11.
import * as dashboard from './account/dashboard.js';
import * as profile from './account/profile.js';
import * as history from './account/history.js';
import * as analytics from './account/analytics.js';
import * as plans from './account/plans.js';
import * as payments from './account/payments.js';
import * as invoices from './account/invoices.js';
import * as invoice from './account/invoice.js';
import * as settings from './account/settings.js';

const KIT = '/site/js/pages-kit.js';
// course-meta.js (static, shared with the app) gives lesson titles for "Continue lesson".
const COURSE = '/shared/course-meta.js';
const page = (mod, script, extra = []) => ({ meta: mod.meta, body: mod.body, scripts: [...extra, KIT, `/site/js/${script}.js`] });

export const PAGES = [
  page(dashboard, 'account-dashboard', [COURSE]),
  page(profile, 'account-profile'),
  page(history, 'account-history'),
  page(analytics, 'account-analytics'),
  page(plans, 'account-plans'),
  page(payments, 'account-payments'),
  page(invoices, 'account-invoices'),
  page(invoice, 'account-invoice'),
  page(settings, 'account-settings'),
];
export default PAGES;
