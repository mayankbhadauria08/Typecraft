// Registry of the admin pages (owner: pages part). Access 'admin' = any role from src/roles.js; the API
// checks the exact role for each action (support is read-only, only owner changes roles). §7, §8, §11.
import * as overview from './admin/overview.js';
import * as users from './admin/users.js';
import * as packages from './admin/packages.js';
import * as payments from './admin/payments.js';
import * as revenue from './admin/revenue.js';
import * as emails from './admin/emails.js';
import * as settings from './admin/settings.js';

const KIT = '/site/js/pages-kit.js';
const page = (mod, script) => ({ meta: mod.meta, body: mod.body, scripts: [KIT, `/site/js/${script}.js`] });

export const PAGES = [
  page(overview, 'admin-overview'),
  page(users, 'admin-users'),
  page(packages, 'admin-packages'),
  page(payments, 'admin-payments'),
  page(revenue, 'admin-revenue'),
  page(emails, 'admin-emails'),
  page(settings, 'admin-settings'),
];
export default PAGES;
