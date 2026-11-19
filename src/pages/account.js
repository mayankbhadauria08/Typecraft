// Registry of the signed-in account pages (owner: pages part). See docs/SAAS-CONTRACTS.md §8, §11.
import * as dashboard from './account/dashboard.js';
import * as profile from './account/profile.js';
import * as history from './account/history.js';
import * as certificates from './account/certificates.js';
import * as analytics from './account/analytics.js';
import * as plans from './account/plans.js';
import * as payments from './account/payments.js';
import * as invoices from './account/invoices.js';
import * as invoice from './account/invoice.js';
import * as settings from './account/settings.js';
import * as join from './account/join.js';
import * as instituteHome from './account/institute-home.js';
import * as instituteOne from './account/institute-one.js';
import * as instituteBatch from './account/institute-batch.js';
import * as instituteStudent from './account/institute-student.js';
import * as instituteInvoice from './account/institute-invoice.js';

const KIT = '/site/js/pages-kit.js';
// course-meta.js (static, shared with the app) gives lesson titles for "Continue lesson".
const COURSE = '/shared/course-meta.js';
const page = (mod, script, extra = []) => ({ meta: mod.meta, body: mod.body, scripts: [...extra, KIT, `/site/js/${script}.js`] });

export const PAGES = [
  // the student's batch: target, assignments, leaderboard (docs/INSTITUTES.md §12)
  { ...page(dashboard, 'account-dashboard', [COURSE]), scripts: [...page(dashboard, 'account-dashboard', [COURSE]).scripts, '/site/js/my-batch.js'] },
  page(profile, 'account-profile'),
  page(history, 'account-history'),
  page(certificates, 'account-certificates', ['/js/rewards-ui.js']),
  page(analytics, 'account-analytics'),
  page(plans, 'account-plans'),
  page(payments, 'account-payments'),
  page(invoices, 'account-invoices'),
  page(invoice, 'account-invoice'),
  page(settings, 'account-settings'),
  // a student joins their institute's batch with its code (docs/INSTITUTES.md §4)
  page(join, 'account-join'),
  { ...page(join, 'account-join'), meta: join.codeMeta },
  // the institute's own pages, for its admin and teachers (docs/INSTITUTES.md §8)
  page(instituteHome, 'institute-home'),
  page(instituteOne, 'institute-one'),
  page(instituteBatch, 'institute-batch', ['/js/rewards-ui.js']),
  page(instituteStudent, 'institute-student'),
  page(instituteInvoice, 'institute-invoice'),
];
export default PAGES;
