/* One order: its payment attempts, refunds, invoice and the plan it started.
   GET  /api/console/payments/:orderId → { order, customer, attempts, refunds, invoice | null, plan | null, activity | null,
                                            can: { recheck, recheckBlock } }
   POST /api/console/payments/:orderId/recheck → { before, status, changed, outcome, attempts } */
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
    var note = o.status === 'failed' ? AC.notice(o.failureReason ? 'Why it failed: ' + o.failureReason : 'The payment did not go through.', 'warn')
      : MEANS[o.status] ? AC.notice(MEANS[o.status]) : null;
    AC.head({
      title: AC.money(o.amountPaise, o.currency) + ' for ' + o.packageName,
      crumb: AC.fmt.date(o.createdAt),
      sub: (c.fullName || c.email) + ', ' + AC.fmt.dateTime(o.createdAt),
      badges: [AC.status('order', o.status), o.refundedPaise ? AC.badge(AC.money(o.refundedPaise, o.currency) + ' refunded') : null],
      actions: actions,
      note: [note, d.can.recheckBlock ? el('p', { class: 'hint', text: d.can.recheckBlock }) : null]
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
        el('td', null, [r.reason || '–', el('div', { class: 'cell-sub', text: r.requestedBy ? 'By ' + r.requestedBy : 'Started at Razorpay' }),
          el('div', { class: 'person-extra' }, [AC.status('refund', r.status), el('span', { text: AC.fmt.date(r.createdAt) })])])
      ]);
    });
    AC.fill('refundsBody', rows.length ? AC.table([['Date', 'col-wide'], ['Amount', 'num'], ['Status', 'col-fit'], ['Reason']], rows, true) : AC.quiet('Nothing has been refunded.'));
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
