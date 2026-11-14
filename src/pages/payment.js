// Registry of the checkout and payment result pages (owner: pages part). See docs/SAAS-CONTRACTS.md §5, §8.
import * as checkout from './payment/checkout.js';
import * as processing from './payment/processing.js';
import * as success from './payment/success.js';
import * as failure from './payment/failure.js';
import * as pending from './payment/pending.js';

const KIT = '/site/js/pages-kit.js';
const page = (mod, script) => ({ meta: mod.meta, body: mod.body, scripts: [KIT, `/site/js/${script}.js`] });

export const PAGES = [
  page(checkout, 'checkout'),
  page(processing, 'payment-processing'),
  page(success, 'payment-success'),
  page(failure, 'payment-failure'),
  page(pending, 'payment-pending'),
];
export default PAGES;
