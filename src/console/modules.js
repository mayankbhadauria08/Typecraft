// The admin console's four layers and their modules (docs/ADMIN-CONSOLE.md §2).
// This list drives the sidebar. A module with `path` is built: it shows as a link to
// people whose role has its `permission`. A module with `phase` is not built yet and
// shows as a plain, non-clickable row until its phase ships.
//
// Paths are relative to CONSOLE_BASE (./config.js).

export const HOME = { key: 'home', label: 'Home', icon: 'home', path: '' };

export const LAYERS = [
  {
    key: 'core', label: 'Core operations', hint: 'Run the business',
    modules: [
      { key: 'dashboard', label: 'Dashboard', icon: 'chart', path: '/dashboard', permission: 'dashboard.view' },
      { key: 'customers', label: 'Customers', icon: 'users', path: '/customers', permission: 'customers.view' },
      { key: 'payments', label: 'Payments', icon: 'card', path: '/payments', permission: 'payments.view' },
      { key: 'refunds', label: 'Refunds', icon: 'refresh', path: '/refunds', permission: 'refunds.view' },
      { key: 'packages', label: 'Packages', icon: 'package', path: '/packages', permission: 'packages.view' },
      { key: 'subscriptions', label: 'Subscriptions', icon: 'calendar', path: '/subscriptions', permission: 'subscriptions.view' },
      { key: 'access', label: 'Learning access', icon: 'unlock', path: '/access', permission: 'access.view' },
      { key: 'institutes', label: 'Institutes', icon: 'users', path: '/institutes', permission: 'institutes.view' },
    ],
  },
  {
    key: 'learning', label: 'Learning operations', hint: 'Control the typing platform',
    modules: [
      { key: 'courses', label: 'Courses', icon: 'book', path: '/course', permission: 'course.view' },
      { key: 'course-modules', label: 'Modules', icon: 'layers', path: '/course/modules', permission: 'course.view' },
      { key: 'levels', label: 'Levels', icon: 'trend', path: '/course/levels', permission: 'course.view' },
      { key: 'lessons', label: 'Lessons', icon: 'keyboard', path: '/course/lessons', permission: 'course.view' },
      { key: 'exercises', label: 'Exercises', icon: 'target', path: '/course/exercises', permission: 'course.view' },
      { key: 'access-rules', label: 'Unlock conditions', icon: 'lock', path: '/unlock', permission: 'unlock.view' },
      { key: 'progress', label: 'Student progress', icon: 'history', path: '/progress', permission: 'progress.view' },
      { key: 'analytics', label: 'Learning analytics', icon: 'chart', path: '/learning-analytics', permission: 'analytics.view' },
    ],
  },
  {
    key: 'growth', label: 'Business growth', hint: 'Sales and retention',
    modules: [
      { key: 'coupons', label: 'Coupons', icon: 'hash', phase: 4 },
      { key: 'promotions', label: 'Promotions', icon: 'sparkle', phase: 4 },
      { key: 'emails', label: 'Email campaigns', icon: 'mail', phase: 4 },
      { key: 'support', label: 'Support', icon: 'inbox', path: '/support', permission: 'support.view' },
      { key: 'notifications', label: 'Notifications', icon: 'send', phase: 4 },
      { key: 'reports', label: 'Business reports', icon: 'receipt', path: '/reports', permission: 'revenue.view' },
    ],
  },
  {
    key: 'infra', label: 'Infrastructure', hint: 'Maintain and protect',
    modules: [
      { key: 'administrators', label: 'Administrators', icon: 'user', phase: 5 },
      { key: 'roles', label: 'Roles and permissions', icon: 'shield', path: '/roles', permission: 'roles.view' },
      { key: 'activity-logs', label: 'Activity logs', icon: 'history', phase: 5 },
      { key: 'system-health', label: 'System health', icon: 'bolt', phase: 5 },
      { key: 'integrations', label: 'Integrations', icon: 'globe', phase: 5 },
      { key: 'security', label: 'Security', icon: 'lock', phase: 5 },
      { key: 'settings', label: 'Settings', icon: 'settings', phase: 5 },
    ],
  },
];

/** { layer, module } for a module key, or null. */
export function findModule(key) {
  if (key === HOME.key) return { layer: null, module: HOME };
  for (const layer of LAYERS) {
    const module = layer.modules.find((m) => m.key === key);
    if (module) return { layer, module };
  }
  return null;
}
