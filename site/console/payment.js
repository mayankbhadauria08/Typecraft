/* One order: its payment attempts, refunds, invoice and the plan it started.
   GET  /api/console/payments/:orderId → { order, customer, attempts, refunds, invoice | null, plan | null, activity | null, emailsOn,
                                            can: { recheck, recheckBlock, refund, refundBlock, recheckRefund } }
   POST /api/console/payments/:orderId/recheck → { before, status, changed, outcome, attempts }
   POST /api/console/refunds { paymentId, amountPaise, reasonCode, reasonText, planAction } → { refundId, amountPaise, status, planEnded, … }
   POST /api/console/refunds/:id/recheck → { status, changed } */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var id = (AC.boot.page.params || {}).id;
  var api = '/api/console/payments/' + encodeURIComponent(id);

  // what the order's state means, in a sentence
  var MEANS = {
    created: 'The customer opened the payment window, but no payment has been confirmed. Orders like this close by themselves after a day.',
    attempted: 'The customer opened the payment window, but no payment has been confirmed. Orders like this close by themselves after a day.',
    pending: 'Razorpay has a payment for this order that is not finished yet. It is checked automatically every 10 minutes.',
    cancelled: 'No payment arrived for this order, so it was closed.'
  };
  // what "Check with Razorpay" found
  var FOUND = {
    paid: ['Razorpay confirms the payment. The order is paid and the plan is active.', 'ok'],
    pending: ['Razorpay has the payment but has not finished taking the money. Check again in a few minutes.', 'info'],
    failed: ['Razorpay shows only failed attempts for this order. No money was taken.', 'info'],
    mismatch: ['Razorpay shows a payment that does not match this order, so nothing was changed. Look at it in your Razorpay dashboard.', 'bad'],
    cancelled: ['Razorpay has no payment for this order after more than a day, so it was closed.', 'info'],
    waiting: ['Razorpay has no completed payment for this order. Nothing was changed.', 'info']
  };
  var VIA = { signature: 'Recorded at checkout', webhook: 'Recorded from a Razorpay notice', api: 'Recorded from a Razorpay check' };
  var ACTION = { 'order.paid': 'Payment confirmed', 'payment.recheck': 'Checked with Razorpay', 'payment.refund': 'Refund requested', 'refund.processed': 'Refund sent',
    'refund.failed': 'Refund failed', 'refund.recheck': 'Refund checked with Razorpay', 'subscription.revoke': 'Plan ended', 'checkout.bad_signature': 'Checkout could not confirm the payment' };

  /* ---------- refunds ---------- */
  var REASONS = [['', 'Choose a reason'], ['duplicate', 'Duplicate payment'], ['request', 'Customer request'], ['technical', 'Technical problem'],
    ['unauthorised', 'Payment not made by the card holder'], ['other', 'Other']];
  /** "199" or "99.50" from paise, for the amount field. */
  function rupeesText(paise) { return paise % 100 ? (paise / 100).toFixed(2) : String(paise / 100); }
  /** Paise from what was typed ("199", "99.5", "\u20b91,499.00"), or NaN. */
  function paiseOf(text) {
    var t = String(text || '').replace(/[\u20b9,\s]/g, '');
    return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(parseFloat(t) * 100) : NaN;
  }
  function refundDialog(d) {
    var o = d.order, c = d.customer, p = d.plan;
    var open = d.attempts.filter(function (y) { return y.refundablePaise > 0; });
    if (!open.length) return;
    var first = open[0], fields = [];
    if (open.length > 1) {
      fields.push({ name: 'paymentId', label: 'Payment', type: 'select', value: first.id,
        options: open.map(function (y) { return { value: y.id, label: y.razorpayPaymentId + ', up to ' + AC.money(y.refundablePaise, y.currency) }; }) });
    }
    fields.push({ name: 'amountPaise', label: 'Amount (\u20b9)', type: 'text', inputmode: 'decimal', maxlength: 12, value: rupeesText(first.refundablePaise),
      required: true, requiredText: 'Enter the amount to send back.',
      hint: open.length > 1 ? 'Up to what is left on the payment you chose. Lower it to send back part of it.'
        : 'Up to ' + AC.money(first.refundablePaise, first.currency) + '. Lower it to send back part of the payment.' });
    fields.push({ name: 'reasonCode', label: 'Reason', type: 'select', value: '', required: true, requiredText: 'Choose a reason.',
      options: REASONS.map(function (r) { return { value: r[0], label: r[1] }; }) });
    fields.push({ name: 'reasonText', label: 'Details', type: 'textarea', rows: 2, maxlength: 250,
      hint: 'Needed for Other. Kept in the activity log and with the refund at Razorpay. The customer does not see it.' });
    if (p && (p.status === 'active' || p.status === 'upcoming')) {
      fields.push({ name: 'planAction', label: 'The ' + o.packageName + ' plan', type: 'radio', value: 'auto', options: [
        { value: 'auto', label: 'Usual rule', hint: 'It ends if everything is refunded, and stays if only part is.' },
        { value: 'keep', label: 'Keep the plan', hint: 'The customer keeps ' + o.packageName + (p.expiresAt ? ' until ' + AC.fmt.date(p.expiresAt) : '') + '.' },
        { value: 'end', label: 'End the plan', hint: 'It ends when the refund goes through, also when only part is refunded.' }
      ] });
    }
    AC.formDialog({
      title: 'Refund this payment',
      text: 'The money goes back to ' + (c.fullName || c.email) + ' through Razorpay, to the card or account it came from. Banks usually show it within 5 to 7 working days. '
        + (d.emailsOn ? 'The customer gets an email when it is sent.' : 'No email goes to the customer: email sending is not switched on yet.'),
      fields: fields,
      submitLabel: 'Send refund',
      danger: true,
      submit: function (v) {
        var amount = paiseOf(v.amountPaise);
        if (!(amount > 0)) return Promise.reject(new AC.ApiError(400, 'bad_amount', 'Check the amount.', { amountPaise: 'Enter an amount like 199 or 99.50.' }));
        return AC.api('POST', '/api/console/refunds', { paymentId: v.paymentId || first.id, amountPaise: amount, reasonCode: v.reasonCode, reasonText: v.reasonText,
          planAction: v.planAction || 'auto' });
      }
    }).then(function (r) {
      if (!r || r === true) return;
      var sum = AC.money(r.amountPaise, o.currency);
      if (r.status === 'processed') AC.toast('Refund of ' + sum + ' sent.' + (r.planEnded ? ' The plan has ended.' : ''));
      else if (r.status === 'pending') AC.toast('Refund of ' + sum + ' requested. Razorpay is processing it; this page shows when it is sent.', 'info');
      else AC.toast('Razorpay could not send the refund of ' + sum + '.', 'bad');
      page.load();
    });
  }
  function recheckRefund(r, button) {
    AC.busy(button, true);
    AC.api('POST', '/api/console/refunds/' + encodeURIComponent(r.id) + '/recheck', {}).then(function (x) {
      if (x.status === 'processed') AC.toast('Razorpay has sent this refund.');
      else if (x.status === 'failed') AC.toast('Razorpay could not send this refund. The amount can be refunded again.', 'bad');
      else AC.toast('Razorpay is still processing this refund. Check again later.', 'info');
      page.load();
    }, function (err) {
      AC.busy(button, false);
      if (err.code !== 'cancelled') AC.toast(err.message, 'bad');
    });
  }

  function recheck(button) {
    AC.busy(button, true);
    AC.api('POST', api + '/recheck').then(function (r) {
      var found = FOUND[r.outcome] || FOUND.waiting;
      AC.toast(r.outcome === 'waiting' && !r.attempts ? 'Razorpay has no payment for this order. The customer has not paid.' : found[0], found[1]);
      page.load();
    }, function (err) {
      AC.busy(button, false);
      if (err.code !== 'cancelled') AC.toast(err.message, 'bad');
    });
  }

  function head(d) {
    var o = d.order, c = d.customer;
    var actions = [];
    if (d.can.recheck) {
      var button = el('button', { type: 'button', class: 'btn btn-quiet', on: { click: function () { recheck(button); } } }, [AC.icon('refresh'), el('span', { text: 'Check with Razorpay' })]);
      actions.push(button);
    }
    if (d.can.refund) actions.push(el('button', { type: 'button', class: 'btn btn-quiet', text: 'Refund', on: { click: function () { refundDialog(d); } } }));
    var note = o.status === 'failed' ? AC.notice(o.failureReason ? 'Why it failed: ' + o.failureReason : 'The payment did not go through.', 'warn')
      : MEANS[o.status] ? AC.notice(MEANS[o.status]) : null;
    AC.head({
      title: AC.money(o.amountPaise, o.currency) + ' for ' + o.packageName,
      crumb: AC.fmt.date(o.createdAt),
      sub: (c.fullName || c.email) + ', ' + AC.fmt.dateTime(o.createdAt),
      badges: [AC.status('order', o.status), o.refundedPaise ? AC.badge(AC.money(o.refundedPaise, o.currency) + ' refunded') : null],
      actions: actions,
      note: [note, d.can.recheckBlock ? el('p', { class: 'hint', text: d.can.recheckBlock }) : null, d.can.refundBlock ? el('p', { class: 'hint', text: d.can.refundBlock }) : null]
    });
  }

  function attempts(d) {
    var rows = d.attempts.map(function (y) {
      return el('tr', null, [
        el('td', { class: 'col-wide nowrap', text: AC.fmt.dateTime(y.createdAt) }),
        el('td', null, [el('span', { class: 'mono id-text', text: y.razorpayPaymentId }), el('div', { class: 'cell-sub', text: y.error || VIA[y.verifiedBy] || '' }),
          el('div', { class: 'person-extra' }, [AC.status('payment', y.status), el('span', { text: AC.method(y.method) }), el('span', { text: AC.fmt.dateTime(y.createdAt) })])]),
        el('td', { class: 'col-wide', text: AC.method(y.method) }),
        el('td', { class: 'num', text: AC.money(y.amountPaise, y.currency) }),
        el('td', { class: 'col-fit' }, AC.status('payment', y.status))
      ]);
    });
    AC.fill('attemptsBody', rows.length
      ? AC.table([['When', 'col-wide'], ['Razorpay payment ID'], ['Paid with', 'col-wide nowrap'], ['Amount', 'num'], ['Status', 'col-fit']], rows, true)
      : AC.quiet('No payment has reached us for this order.'));
  }

  function refunds(d) {
    var rows = d.refunds.map(function (r) {
      return el('tr', null, [
        el('td', { class: 'col-wide nowrap', title: AC.fmt.dateTime(r.createdAt), text: AC.fmt.date(r.createdAt) }),
        el('td', { class: 'num', text: AC.money(r.amountPaise, d.order.currency) }),
        el('td', { class: 'col-fit' }, AC.status('refund', r.status)),
        el('td', null, [el('div', { class: 'measure', text: r.reason || '–' }), el('div', { class: 'cell-sub', text: r.requestedBy ? 'By ' + r.requestedBy : 'Started at Razorpay' }),
          el('div', { class: 'person-extra' }, [AC.status('refund', r.status), el('span', { text: AC.fmt.date(r.createdAt) })]),
          r.status === 'pending' && d.can.recheckRefund ? checkButton(r) : null])
      ]);
    });
    function checkButton(r) {
      var b = el('button', { type: 'button', class: 'btn-link', text: 'Check with Razorpay', on: { click: function () { recheckRefund(r, b); } } });
      return el('div', { class: 'cell-action' }, b);
    }
    AC.fill('refundsBody', rows.length ? [AC.table([['Date', 'col-wide'], ['Amount', 'num'], ['Status', 'col-fit'], ['Reason']], rows, true),
      d.order.refundedPaise ? el('p', { class: 'hint', text: AC.money(d.order.refundedPaise, d.order.currency) + ' of ' + AC.money(d.order.amountPaise, d.order.currency) + ' has been sent back.' }) : null]
      : AC.quiet('Nothing has been refunded.'));
  }

  function activity(d) {
    if (!d.activity) return;
    AC.fill('activityBody', AC.timeline(d.activity.map(function (a) {
      return { action: a.action, reason: a.reason, note: a.amountPaise ? AC.money(a.amountPaise, d.order.currency) : null, actor: a.actor, createdAt: a.createdAt };
    }), ACTION, 'Nothing has been recorded for this order yet.'));
  }

  function side(d) {
    var o = d.order, c = d.customer, p = d.plan, inv = d.invoice;
    AC.fill('orderBody', AC.facts([
      AC.fact('Amount', AC.money(o.amountPaise, o.currency)),
      d.discount ? AC.fact('Discount', AC.el('span', null, [AC.money(d.discount.discountPaise, o.currency) + ' off ' + AC.money(d.discount.listPaise, o.currency) + ' (',
        d.discount.couponId && AC.can('coupons.view') ? AC.el('a', { href: AC.base + '/coupons/' + encodeURIComponent(d.discount.couponId), text: d.discount.label }) : d.discount.label, ')'])) : null,
      AC.fact('Started', AC.fmt.dateTime(o.createdAt)),
      o.paidAt ? AC.fact('Paid', AC.fmt.dateTime(o.paidAt)) : null,
      AC.idFact('Order ID', o.id, 'order ID'),
      AC.idFact('Razorpay order ID', o.razorpayOrderId, 'Razorpay order ID')
    ]));
    AC.fill('customerBody', AC.facts([
      AC.fact('Name', AC.can('customers.view') ? el('a', { href: AC.base + '/customers/' + encodeURIComponent(c.id), text: c.fullName || 'No name' }) : (c.fullName || 'No name')),
      AC.fact('Email', c.email),
      c.status === 'active' ? null : AC.fact('Account', AC.badge('Disabled', 'bad'))
    ]));
    var planLine = !p ? 'No plan was started, because the order is not paid.'
      : p.status === 'active' ? (p.expiresAt ? 'Active until ' + AC.fmt.date(p.expiresAt) + '.' : 'Active, with no end date.')
        : p.status === 'upcoming' ? 'Starts on ' + AC.fmt.date(p.startsAt) + ', after the plan the customer already has.'
          : p.status === 'revoked' ? 'Ended by staff or by a refund.' : 'Ended on ' + AC.fmt.date(p.expiresAt) + '.';
    AC.fill('planBody', AC.facts([
      AC.fact(o.packageName + ' plan', planLine),
      inv ? AC.fact('Invoice', el('span', { class: 'mono id-text', text: inv.number }), AC.copyButton(inv.number, 'invoice number')) : AC.fact('Invoice', 'None yet')
    ]));
  }

  var page = AC.record({
    endpoint: api,
    notFound: ['Payment not found', 'There is no order with this ID.'],
    render: function (d) { head(d); attempts(d); refunds(d); activity(d); side(d); }
  });
})();
