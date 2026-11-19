/* Shared by the campaign pages: the audience choices and the dialog that writes or changes a draft.
   window.CK = { audienceOptions(plans, days), edit({ campaign?, plans, inactiveDays }) → Promise<id | false>, progressText(p, total) } */
(function () {
  'use strict';
  var AC = window.AC;

  /** The "Who gets it" choices: everyone, Free, any paid plan, one plan, and not practising lately. */
  function audienceOptions(plans, days) {
    return [
      { group: 'Everyone', options: [{ value: 'all', label: 'Everyone who gets product news' }] },
      { group: 'By plan', options: [{ value: 'free', label: 'People on Free' }, { value: 'paid', label: 'People with any paid plan' }]
        .concat((plans || []).map(function (p) { return { value: 'plan:' + p.id, label: 'People on ' + p.name + (p.onSale ? '' : ' (not on sale)') }; })) },
      { group: 'Coming back', options: (days || [7, 14, 30]).map(function (d) { return { value: 'inactive:' + d, label: 'Haven’t practised for ' + d + ' days' }; }) }
    ];
  }

  /** Writes a new draft, or changes one. → the campaign's id once saved, or false when cancelled. */
  function edit(opts) {
    var c = opts.campaign || null;
    var saved = null;
    return AC.formDialog({
      title: c ? 'Change the draft' : 'New campaign',
      text: c ? null : 'It is saved as a draft. Nothing is sent until someone schedules it.',
      submitLabel: 'Save draft',
      fields: [
        { name: 'name', label: 'Name', value: c ? c.name : '', required: true, maxlength: 80, placeholder: 'November offer', hint: 'For the team. Customers never see it.' },
        { name: 'subject', label: 'Subject', value: c ? c.subject : '', required: true, maxlength: 150 },
        { name: 'body', label: 'Email', type: 'textarea', rows: 10, value: c ? c.body : '', required: true, maxlength: 20000,
          hint: 'Plain text. A blank line starts a new paragraph. Links like https://typecrafttyping.in/pricing work as they are. The greeting, the sign-off and an unsubscribe link are added for you.' },
        { name: 'audience', label: 'Who gets it', type: 'select', value: c ? c.audience : 'all', options: audienceOptions(opts.plans, opts.inactiveDays),
          hint: 'Only people with a confirmed email address who get product news. Who is in it is fixed when sending starts.' }
      ],
      submit: function (v) {
        return (c ? AC.api('PUT', '/api/console/campaigns/' + encodeURIComponent(c.id), v) : AC.api('POST', '/api/console/campaigns', v))
          .then(function (res) { saved = res.id; return res.id; });
      }
    }).then(function (result) { return result ? saved : false; });
  }

  function progressText(p, total) {
    var done = p.sent + p.failed + p.skipped;
    return done.toLocaleString('en-IN') + ' of ' + (total || 0).toLocaleString('en-IN') + ' done';
  }

  window.CK = { audienceOptions: audienceOptions, edit: edit, progressText: progressText };
})();
