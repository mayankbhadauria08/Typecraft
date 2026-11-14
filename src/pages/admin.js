// admin pages registry (owner: the pages part; docs/SAAS-CONTRACTS.md §8).
// Each entry: { meta: { path, title, description, access?, layout?, noindex? }, body, scripts: ['/site/js/x.js'] }.
// Paths may hold parameters, e.g. '/account/invoices/:number' (the page script reads location.pathname).
export const PAGES = [];
