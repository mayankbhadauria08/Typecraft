/* Institute actions, shared by the Institutes list and an institute's page (docs/INSTITUTES.md §7).
   Each opens a dialog, sends the change and resolves true when something changed (false when cancelled).
     POST /api/console/institutes                        create
     PUT  /api/console/institutes/:id                    details
     POST /api/console/institutes/:id/term               seats, first and last day, price per seat, reason
     POST /api/console/institutes/:id/status             { status, reason }
     POST /api/console/institutes/:id/payments           record money received
     POST /api/console/institutes/:id/payments/:pid/remove { reason }
     POST /api/console/institutes/:id/staff              { email, role }
     POST /api/console/institutes/:id/staff/:sid/resend
     POST /api/console/institutes/:id/staff/:sid/remove  { reason } */
(function () {
  'use strict';
  var AC = window.AC;
  var paise = function (rupees) { return rupees === '' || rupees == null ? NaN : Math.round(Number(rupees) * 100); };
  var rupees = function (p) { return p == null ? '' : String(p / 100); };
  var url = function (i, tail) { return '/api/console/institutes/' + encodeURIComponent(i.id) + (tail || ''); };
  var addDays = function (day, n) { var d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  var reasonField = function (hint) { return { name: 'reason', label: 'Reason', type: 'textarea', required: true, maxlength: 300, hint: hint || 'Kept in the activity log.' }; };
  var emailNote = function (status) {
    return status === 'sent' ? 'The invitation email is on its way.'
      : status === 'cancelled' ? 'The invitation is saved, but the email was held back: too many emails to this address in the last hour.'
        : 'The invitation is saved, but the email could not be sent. Check Email in the current admin, or send it again later.';
  };

  function create(packages, today) {
    var choices = packages.filter(function (p) { return p.active; }).concat(packages.filter(function (p) { return !p.active; }))
      .map(function (p) { return { value: p.id, label: p.name + (p.active ? '' : ' (off sale)') }; });
    var onSale = packages.filter(function (p) { return p.active; });
    var best = onSale.length ? { value: onSale[onSale.length - 1].id } : null;
    return AC.formDialog({
      title: 'New institute', submitLabel: 'Create institute',
      text: 'It starts as "not paid yet": their admin can set up batches, but no student can join until you record a payment.',
      fields: [
        { name: 'name', label: 'Institute name', required: true, maxlength: 120 },
        { name: 'city', label: 'City', maxlength: 80 },
        { name: 'contactName', label: 'Contact person', maxlength: 120 },
        { name: 'contactEmail', label: 'Contact email', type: 'email', required: true, maxlength: 254, hint: 'For invoices and reminders.' },
        { name: 'contactPhone', label: 'Contact phone', maxlength: 30 },
        { name: 'gstin', label: 'GSTIN', maxlength: 15, hint: 'Leave empty if they have none.' },
        // the most complete plan on sale is the usual choice for a class
        { name: 'packageId', label: 'Plan a seat gives', type: 'select', options: choices, value: (best || choices[0] || {}).value },
        { name: 'seats', label: 'Seats', type: 'number', min: 1, max: 10000, required: true, value: 20 },
        { name: 'price', label: 'Price per seat for the term (₹)', type: 'number', min: 0, step: '0.01', required: true, inputmode: 'decimal' },
        { name: 'startDate', label: 'First day', type: 'date', required: true, value: today },
        { name: 'endDate', label: 'Last day', type: 'date', required: true, value: addDays(today, 364) },
        { name: 'adminEmail', label: "Their admin's email", type: 'email', maxlength: 254, hint: 'We email them an invitation. You can also invite them later.' },
        { name: 'notes', label: 'Private notes', type: 'textarea', maxlength: 2000, hint: 'Only TypeCraft staff see these.' }
      ],
      submit: function (v) {
        return AC.api('POST', '/api/console/institutes', {
          name: v.name, city: v.city, contactName: v.contactName, contactEmail: v.contactEmail, contactPhone: v.contactPhone, gstin: v.gstin,
          packageId: v.packageId, seats: Number(v.seats), pricePaise: paise(v.price), startDate: v.startDate, endDate: v.endDate,
          adminEmail: v.adminEmail, notes: v.notes
        }).then(function (d) { if (d.invite) AC.toast(emailNote(d.invite.emailStatus), d.invite.emailStatus === 'sent' ? null : 'bad'); return d.institute; },
          function (err) { if (err.fields && err.fields.pricePaise) err.fields.price = err.fields.pricePaise; throw err; });
      }
    });
  }

  function edit(i) {
    return AC.formDialog({
      title: 'Edit details', submitLabel: 'Save',
      fields: [
        { name: 'name', label: 'Institute name', required: true, maxlength: 120, value: i.name },
        { name: 'city', label: 'City', maxlength: 80, value: i.city },
        { name: 'contactName', label: 'Contact person', maxlength: 120, value: i.contactName },
        { name: 'contactEmail', label: 'Contact email', type: 'email', required: true, maxlength: 254, value: i.contactEmail },
        { name: 'contactPhone', label: 'Contact phone', maxlength: 30, value: i.contactPhone },
        { name: 'gstin', label: 'GSTIN', maxlength: 15, value: i.gstin },
        { name: 'notes', label: 'Private notes', type: 'textarea', maxlength: 2000, value: i.notes }
      ],
      submit: function (v) { return AC.api('PUT', url(i), v).then(function (d) { AC.toast(d.changed.length ? 'Saved.' : 'Nothing changed.'); return d.changed.length > 0; }); }
    });
  }

  /** Seats, term and price: adding seats, renewing (a later last day), or correcting a mistake. */
  function term(i, money) {
    var fields = [
      { name: 'seats', label: 'Seats', type: 'number', min: Math.max(1, i.seatsUsed), max: 10000, required: true, value: i.seats,
        hint: i.seatsUsed + ' in use. Seats can go down to that number.' },
      { name: 'startDate', label: 'First day', type: 'date', required: true, value: i.startDate },
      { name: 'endDate', label: 'Last day', type: 'date', required: true, value: i.lastDay, hint: 'To renew, move the last day on. Seats stop giving the plan after this day.' }
    ];
    if (money) fields.push({ name: 'price', label: 'Price per seat for the term (₹)', type: 'number', min: 0, step: '0.01', required: true, value: rupees(money.pricePaise), inputmode: 'decimal' });
    fields.push(reasonField('For example "Renewed for 2027" or "10 more seats".'));
    return AC.formDialog({
      title: 'Change seats or term', submitLabel: 'Save changes', fields: fields,
      submit: function (v) {
        var body = { seats: Number(v.seats), startDate: v.startDate, endDate: v.endDate, reason: v.reason };
        if (money) body.pricePaise = paise(v.price);
        return AC.api('POST', url(i, '/term'), body).then(function (d) { AC.toast(d.changed.length ? 'Saved.' : 'Nothing changed.'); return d.changed.length > 0; },
          function (err) { if (err.fields && err.fields.pricePaise) err.fields.price = err.fields.pricePaise; throw err; });
      }
    });
  }

  var STATUS_TEXT = {
    active: ['Switch on', 'Students can join with the batch codes, and seats give the plan until the last day.', 'Switch on'],
    suspended: ['Pause', 'Students keep their seats and progress, but their seats stop giving the plan until you switch the institute on again. Nobody can join.', 'Pause'],
    closed: ['Close for good', 'Seats stop giving the plan, nobody can join, and the institute’s admin and teachers lose access. A closed institute cannot be opened again.', 'Close institute']
  };
  function status(i, to) {
    var t = STATUS_TEXT[to];
    return AC.formDialog({
      title: t[0] + ': ' + i.name, text: t[1], submitLabel: t[2], danger: to !== 'active',
      fields: [reasonField()],
      submit: function (v) { return AC.api('POST', url(i, '/status'), { status: to, reason: v.reason }).then(function (d) { AC.toast(d.changed ? 'Done.' : 'Nothing changed.'); return d.changed; }); }
    });
  }

  function payment(i, today, due) {
    return AC.formDialog({
      title: 'Record a payment', submitLabel: 'Record payment',
      text: (i.status === 'pending' ? 'Recording the first payment switches this institute on. ' : '') + 'Only record money that has reached your bank account.',
      fields: [
        { name: 'amount', label: 'Amount received (₹)', type: 'number', min: 1, step: '0.01', required: true, inputmode: 'decimal', value: due > 0 ? rupees(due) : '' },
        { name: 'method', label: 'How they paid', type: 'select', options: [{ value: 'bank_transfer', label: 'Bank transfer (NEFT, RTGS, IMPS)' }, { value: 'upi', label: 'UPI' },
          { value: 'cheque', label: 'Cheque' }, { value: 'cash', label: 'Cash' }, { value: 'other', label: 'Other' }], value: 'bank_transfer' },
        { name: 'reference', label: 'Reference', maxlength: 80, hint: 'The UTR, UPI reference or cheque number.' },
        { name: 'paidOn', label: 'Day the money arrived', type: 'date', required: true, value: today, max: today },
        { name: 'note', label: 'Note', type: 'textarea', maxlength: 300 }
      ],
      submit: function (v) {
        return AC.api('POST', url(i, '/payments'), { amountPaise: paise(v.amount), method: v.method, reference: v.reference, paidOn: v.paidOn, note: v.note })
          .then(function (d) { AC.toast(d.switchedOn ? 'Payment recorded. The institute is on: students can join.' : 'Payment recorded.'); return true; },
            function (err) { if (err.fields && err.fields.amountPaise) err.fields.amount = err.fields.amountPaise; throw err; });
      }
    });
  }
  function removePayment(i, p) {
    return AC.formDialog({
      title: 'Remove this payment?', danger: true, submitLabel: 'Remove payment',
      text: AC.money(p.amountPaise) + (p.reference ? ' · ' + p.reference : '') + '. Only for a payment recorded by mistake. The activity log keeps what it said. The institute stays on.',
      fields: [reasonField()],
      submit: function (v) { return AC.api('POST', url(i, '/payments/' + encodeURIComponent(p.id) + '/remove'), { reason: v.reason }).then(function () { AC.toast('Payment removed.'); return true; }); }
    });
  }

  function invite(i) {
    return AC.formDialog({
      title: 'Invite an admin or teacher', submitLabel: 'Send invitation',
      text: 'They get an email. They sign in, or create an account, with this address and accept. Usually you invite the admin, and they invite their teachers.',
      fields: [
        { name: 'email', label: 'Email', type: 'email', required: true, maxlength: 254 },
        { name: 'role', label: 'Role', type: 'radio', value: 'admin', options: [
          { value: 'admin', label: 'Admin', hint: 'Sets up batches, invites teachers, adds and removes students, sees every batch.' },
          { value: 'teacher', label: 'Teacher', hint: 'Sees the batches they are given.' }] }
      ],
      submit: function (v) { return AC.api('POST', url(i, '/staff'), { email: v.email, role: v.role }).then(function (d) { AC.toast(emailNote(d.invite.emailStatus), d.invite.emailStatus === 'sent' ? null : 'bad'); return true; }); }
    });
  }
  function resend(i, s) {
    return AC.api('POST', url(i, '/staff/' + encodeURIComponent(s.id) + '/resend'), {}).then(function (d) {
      AC.toast(emailNote(d.emailStatus), d.emailStatus === 'sent' ? null : 'bad'); return false;
    }, function (err) { AC.toast(err.message, 'bad'); return false; });
  }
  function removeStaff(i, s) {
    return AC.formDialog({
      title: 'Remove ' + (s.name || s.email) + '?', danger: true, submitLabel: 'Remove',
      text: s.status === 'invited' ? 'The invitation stops working.' : 'They lose access to this institute at once. Their batches stay, and the institute’s admins see them.',
      fields: [reasonField()],
      submit: function (v) { return AC.api('POST', url(i, '/staff/' + encodeURIComponent(s.id) + '/remove'), { reason: v.reason }).then(function () { AC.toast('Removed.'); return true; }); }
    });
  }

  AC.institutes = { create: create, edit: edit, term: term, status: status, payment: payment, removePayment: removePayment, invite: invite, resend: resend, removeStaff: removeStaff };
})();
