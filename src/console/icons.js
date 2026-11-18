// Icons for the admin console: the site's set (site/site.js, through src/layout.js) plus a
// few the console needs and the site does not. Same drawing rules: 24px grid, 1.5px stroke.
import { icon as siteIcon } from '../layout.js';

const wrap = (paths) => '<svg class="ic" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + paths + '</svg>';

const EXTRA = {
  search: wrap('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>'),
  copy: wrap('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>'),
  note: wrap('<path d="M6.5 3.5h8L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z"/><path d="M14.5 3.5V8H19M8.5 12.5h7M8.5 16h5"/>'),
  trash: wrap('<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 11.6a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v5.5M14 11v5.5"/>'),
};

export const icon = (name) => EXTRA[name] || siteIcon(name);
