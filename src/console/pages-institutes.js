// The frames of the console's institute pages (docs/INSTITUTES.md §7). Listed into PAGES in ./pages.js.
import { icon } from './icons.js';
import { select, section, panel, lines, listFrame, recordFrame } from './page-kit.js';

function institutesBody(me) {
  return listFrame({
    title: 'Institutes',
    sub: 'Coaching centres that buy seats for their students. Open one to record a payment, change its seats or term, or invite its admin.',
    action: me.permissions.includes('institutes.manage') ? `<button type="button" class="btn btn-quiet" id="newInstituteBtn">${icon('plus')}<span>New institute</span></button>` : '',
    label: 'Find institutes',
    search: { label: 'Search institutes', placeholder: 'Name, city or email' },
    filters: select('status', 'Status', [['', 'All institutes'], ['pending', 'Not paid yet'], ['active', 'On'], ['ending', 'Ending in 30 days'], ['suspended', 'Paused'], ['closed', 'Closed']]),
    heads: [['Institute'], ['Status', 'col-fit'], ['Seats', 'num'], ['Last day', 'col-wide'], ['Admin', 'col-wide'], ['Paid', 'num col-wide']],
    note: `<section class="panel cap-panel" aria-labelledby="capTitle"><h2 id="capTitle">Capacity today</h2><div id="capBody">${lines(2)}</div></section>`,
  });
}

function instituteBody(me) {
  const has = (k) => me.permissions.includes(k);
  const money = has('institutes.payments') || has('revenue.view');
  return recordFrame({
    back: ['Institutes', '/institutes'],
    missing: ['Institute not found', 'There is no institute with this ID.'],
    main: [
      section('batches', 'Batches', lines(3), '<span class="panel-meta">Their admin creates batches in the institute pages</span>'),
      section('staff', 'Admin and teachers', lines(3)),
      money ? section('payments', 'Payments', lines(3)) : '',
      has('audit.view') ? section('activity', 'History', lines(3), '<span class="panel-meta">Every change, and who made it</span>') : '',
    ].join('\n'),
    side: [panel('seats', 'Seats and term', 5), panel('contact', 'Contact', 4)].join('\n'),
    sideLabel: 'Institute details',
  });
}

export const INSTITUTE_PAGES = [
  { key: 'institutes', path: '/institutes', title: 'Institutes', crumbs: ['Core operations', 'Institutes'],
    permission: 'institutes.view', body: institutesBody, scripts: ['institute-actions.js', 'institutes.js'] },
  { key: 'institutes', match: /^\/institutes\/(ins_[0-9a-f]{20})$/, names: ['id'], title: 'Institute', crumbs: ['Core operations', ['Institutes', '/institutes'], 'Institute'],
    permission: 'institutes.view', body: instituteBody, scripts: ['institute-actions.js', 'institute.js'] },
];
