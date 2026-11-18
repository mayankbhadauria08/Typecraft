/* Opening or closing a lesson or game for one customer: the dialogs the customer page and the
   Learning access page share (AC.access).
   POST /api/console/customers/:id/access { kind, target, effect, days | null, reason } → { access, replaced }
   POST /api/console/access/:id/end       { reason? }                                → { access }
   Each function resolves with the server's answer, or false when the dialog was closed. */
(function () {
  'use strict';
  var AC = window.AC;

  /** customer: { id, fullName, email }; targets: { lesson: [{ id, name }], game: [{ id, name }] } */
  function add(customer, targets) {
    var who = customer.fullName || customer.email;
    var options = [{ value: '', label: 'Choose a lesson or game' },
      { group: 'Lessons', options: targets.lesson.map(function (t) { return { value: 'lesson:' + t.id, label: t.name }; }) },
      { group: 'Arcade games', options: targets.game.map(function (t) { return { value: 'game:' + t.id, label: t.name }; }) }];
    return AC.formDialog({
      title: 'Open or close a lesson or game for ' + who,
      text: 'This applies to ' + who + ' only, whatever their plan says. The placement test, the problem-keys drill and the Daily Challenge are always open.',
      fields: [
        { name: 'item', label: 'Lesson or game', type: 'select', options: options, required: true, requiredText: 'Choose a lesson or game.' },
        { name: 'effect', label: 'What to do', type: 'radio', value: 'allow', options: [
          { value: 'allow', label: 'Open it', hint: 'They can use it, even if their plan does not include it.' },
          { value: 'deny', label: 'Close it', hint: 'They cannot use it, even if their plan includes it. They are told it is closed on their account.' }
        ] },
        { name: 'days', label: 'For how many days', type: 'text', inputmode: 'numeric', maxlength: 3, hint: 'Leave empty to keep it until someone ends it.' },
        { name: 'reason', label: 'Reason', type: 'textarea', rows: 2, maxlength: 300, required: true, requiredText: 'Give a reason.', hint: 'Kept in the activity log. The customer does not see it.' }
      ],
      submitLabel: 'Save',
      submit: function (v) {
        if (v.days && (!/^\d+$/.test(v.days) || Number(v.days) < 1 || Number(v.days) > 365)) {
          return Promise.reject(new AC.ApiError(400, 'bad_days', 'Check the days.', { days: 'Enter a whole number of days from 1 to 365, or leave it empty.' }));
        }
        var parts = String(v.item).split(':');
        return AC.api('POST', '/api/console/customers/' + encodeURIComponent(customer.id) + '/access',
          { kind: parts[0], target: parts[1], effect: v.effect, days: v.days ? Number(v.days) : null, reason: v.reason }).catch(function (err) {
          if (err.fields && (err.fields.kind || err.fields.target)) err.fields.item = err.fields.target || err.fields.kind;   // shown under the one field
          throw err;
        });
      }
    }).then(function (r) {
      if (r && r.access) AC.toast(r.access.targetName + (r.access.effect === 'allow' ? ' opened' : ' closed') + ' for ' + who + '.' + (r.replaced ? ' It replaces the earlier exception.' : ''));
      return r;
    });
  }

  /** item: an exception from the API; who: the customer's name */
  function end(item, who) {
    return AC.formDialog({
      title: 'End this exception?',
      text: item.targetName + ' goes back to what ' + (who ? who + "'s" : 'the') + ' plan says.',
      fields: [{ name: 'reason', label: 'Reason (optional)', type: 'textarea', rows: 2, maxlength: 300, hint: 'Kept in the activity log.' }],
      submitLabel: 'End exception',
      submit: function (v) { return AC.api('POST', '/api/console/access/' + encodeURIComponent(item.id) + '/end', v.reason ? { reason: v.reason } : {}); }
    }).then(function (r) {
      if (r && r.access) AC.toast('Exception ended. ' + item.targetName + ' follows the plan again.');
      return r;
    });
  }

  /** "Until 3 Dec 2026" or "Until ended" for one in force; how it stopped for one that ended. */
  function until(a) {
    if (a.state === 'ended') return 'Ended ' + AC.fmt.date(a.endedAt) + (a.endedBy ? ' by ' + a.endedBy : '');
    if (a.state === 'expired') return 'Ran out ' + AC.fmt.date(a.expiresAt);
    return a.expiresAt ? 'Until ' + AC.fmt.date(a.expiresAt) : 'Until ended';
  }

  AC.access = { add: add, end: end, until: until };
})();
