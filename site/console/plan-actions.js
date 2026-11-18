/* Giving, extending and ending plans: the dialogs the customer page and the Subscriptions page share (AC.plans).
   POST /api/console/customers/:id/subscriptions { packageId, days | null, reason } → { subscription, plan }
   POST /api/console/subscriptions/:id/extend    { days, reason }                  → { subscription, moved, plan }
   POST /api/console/subscriptions/:id/revoke    { reason }                        → { subscription, plan }
   POST /api/console/subscriptions/extend-all    { days, reason }                  → { plans, days }
   No email goes to customers from these yet, and every dialog says so.
   Each function resolves with the server's answer, or false when the dialog was closed. */
(function () {
  'use strict';
  var AC = window.AC;
  var NO_EMAIL = 'No email goes to the customer.';
  var reason = { name: 'reason', label: 'Reason', type: 'textarea', rows: 2, maxlength: 300, required: true, requiredText: 'Give a reason.',
    hint: 'Kept in the activity log. The customer does not see it.' };
  function days(n) { return Number(n).toLocaleString('en-IN') + (Number(n) === 1 ? ' day' : ' days'); }
  function wholeDays(text, max) {
    if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > max) {
      return Promise.reject(new AC.ApiError(400, 'bad_days', 'Check the days.', { days: 'Enter a whole number of days from 1 to ' + max.toLocaleString('en-IN') + '.' }));
    }
    return null;
  }
  function toastPlan(text, plan) {
    AC.toast(text + (plan ? (plan.id === 'free' ? ' The customer is on Free now.' : ' The customer is on ' + plan.name + ' now.') : ''));
  }

  /** customer: { id, fullName, email }; packages: [{ id, name, validityDays, onSale }] */
  function grant(customer, packages) {
    var options = [{ value: '', label: 'Choose a plan' }].concat(packages.map(function (p) {
      return { value: p.id, label: p.name + ' (' + (p.validityDays ? days(p.validityDays) : 'no end date') + ')' + (p.onSale ? '' : ', off sale') };
    }));
    return AC.formDialog({
      title: 'Give ' + (customer.fullName || customer.email) + ' a plan',
      text: 'It starts now and costs the customer nothing. To add days to a plan they already have, extend that plan instead. ' + NO_EMAIL,
      fields: [
        { name: 'packageId', label: 'Plan', type: 'select', options: options, required: true, requiredText: 'Choose a plan.' },
        { name: 'days', label: 'Days', type: 'text', inputmode: 'numeric', maxlength: 4, hint: "Leave empty for the plan's usual length." },
        reason
      ],
      submitLabel: 'Give plan',
      submit: function (v) {
        var bad = v.days ? wholeDays(v.days, 3650) : null;
        if (bad) return bad;
        return AC.api('POST', '/api/console/customers/' + encodeURIComponent(customer.id) + '/subscriptions',
          { packageId: v.packageId, days: v.days ? Number(v.days) : null, reason: v.reason });
      }
    }).then(function (r) {
      if (r && r.subscription) toastPlan(r.subscription.packageName + ' given' + (r.subscription.expiresAt ? ' until ' + AC.fmt.date(r.subscription.expiresAt) : ', with no end date') + '.');
      return r;
    });
  }

  /** sub: a plan from the API; who: the customer's name, for the title */
  function extend(sub, who) {
    return AC.formDialog({
      title: 'Extend ' + sub.packageName + (who ? ' for ' + who : ''),
      text: 'It ends on ' + AC.fmt.date(sub.expiresAt) + ' now. A plan the customer bought to follow it moves by the same days. ' + NO_EMAIL,
      fields: [
        { name: 'days', label: 'Days to add', type: 'text', inputmode: 'numeric', maxlength: 3, value: '7', required: true, requiredText: 'Enter the days to add.', hint: 'From 1 to 365.' },
        reason
      ],
      submitLabel: 'Extend plan',
      submit: function (v) {
        return wholeDays(v.days, 365) || AC.api('POST', '/api/console/subscriptions/' + encodeURIComponent(sub.id) + '/extend', { days: Number(v.days), reason: v.reason });
      }
    }).then(function (r) {
      if (r && r.subscription) AC.toast(sub.packageName + ' ends on ' + AC.fmt.date(r.subscription.expiresAt) + ' now.' + (r.moved ? ' The plan after it moved by the same days.' : ''));
      return r;
    });
  }

  function end(sub, who) {
    return AC.formDialog({
      title: 'End ' + sub.packageName + (who ? ' for ' + who : '') + ' now?',
      text: 'The customer loses what this plan gives at once. Other plans they have stay. '
        + (sub.orderId ? "This does not refund the payment: if money is owed, send a refund from the payment's page. " : '') + NO_EMAIL,
      fields: [reason],
      submitLabel: 'End plan',
      danger: true,
      submit: function (v) { return AC.api('POST', '/api/console/subscriptions/' + encodeURIComponent(sub.id) + '/revoke', { reason: v.reason }); }
    }).then(function (r) {
      if (r && r.subscription) toastPlan(sub.packageName + ' ended.', r.plan);
      return r;
    });
  }

  /** count: how many plans it would change now */
  function extendAll(count) {
    return AC.formDialog({
      title: 'Extend every plan',
      text: 'Adds the same days to every active plan that has an end date: ' + Number(count).toLocaleString('en-IN') + (count === 1 ? ' plan' : ' plans')
        + ' now. Plans without an end date stay as they are. ' + 'No email goes to customers.',
      fields: [
        { name: 'days', label: 'Days to add', type: 'text', inputmode: 'numeric', maxlength: 2, required: true, requiredText: 'Enter the days to add.', hint: 'From 1 to 30.' },
        reason
      ],
      submitLabel: 'Extend every plan',
      danger: true,
      submit: function (v) { return wholeDays(v.days, 30) || AC.api('POST', '/api/console/subscriptions/extend-all', { days: Number(v.days), reason: v.reason }); }
    }).then(function (r) {
      if (r && r.days) AC.toast('Added ' + days(r.days) + ' to ' + Number(r.plans).toLocaleString('en-IN') + (r.plans === 1 ? ' plan.' : ' plans.'));
      return r;
    });
  }

  AC.plans = { grant: grant, extend: extend, end: end, extendAll: extendAll };
})();
