/* Shared by Coupons and Promotions: the dialogs that make or change a coupon or a sale, and the words for them.
   window.DK = { couponDialog({ coupon?, plans }) → Promise<{ id, message } | false>, saleDialog({ sale?, plans }) → same,
                 when(startsAt, endsAt), prices(examples) → <table> } */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;

  function planChoices(plans) {
    return (plans || []).map(function (p) { return { value: p.id, label: p.name + ' (' + AC.money(p.pricePaise) + ')' + (p.onSale ? '' : ', not on sale'), hint: null }; });
  }
  function valueOf(x) { return x ? (x.kind === 'fixed' ? x.value / 100 : x.value) : ''; }
  function amountFields(x) {
    return [
      { name: 'kind', label: 'Takes off', type: 'radio', value: x ? x.kind : 'percent', options: [
        { value: 'percent', label: 'A percentage', hint: 'Rounded to whole rupees. At most 90%.' },
        { value: 'fixed', label: 'An amount in rupees', hint: 'A plan never costs less than ₹1.' }] },
      { name: 'value', label: 'How much (a number: 30 for 30%, or 50 for ₹50)', type: 'number', value: valueOf(x), min: 1, required: true, inputmode: 'decimal' }
    ];
  }
  function body(v) {
    return { kind: v.kind, value: Number(v.value), plans: v.plans, startsAt: AC.fromLocalInput(v.startsAt), endsAt: AC.fromLocalInput(v.endsAt) };
  }

  function couponDialog(opts) {
    var c = opts.coupon || null;
    return AC.formDialog({
      title: c ? 'Change coupon ' + c.code : 'New coupon',
      text: c && c.uses ? 'It has been used ' + c.uses + (c.uses === 1 ? ' time' : ' times') + '. Changes apply from now on; orders already paid keep their price.' : null,
      submitLabel: 'Save coupon',
      fields: [
        { name: 'code', label: 'Code', value: c ? c.code : '', required: true, maxlength: 24, placeholder: 'DIWALI30', hint: 'Letters, numbers and dashes. Customers can type it in small or capital letters.' },
        { name: 'note', label: 'Note for the team (optional)', value: c ? c.note : '', maxlength: 120, placeholder: 'For the Sunrise institute students' }
      ].concat(amountFields(c), [
        { name: 'plans', label: 'Works on', type: 'checks', value: c ? c.plans : [], options: planChoices(opts.plans), hint: 'Tick none for every paid plan.' },
        { name: 'startsAt', label: 'Works from (optional)', type: 'datetime', value: c ? AC.localInput(c.startsAt) : '', hint: 'Empty: straight away. Your computer’s time.' },
        { name: 'endsAt', label: 'Expires (optional)', type: 'datetime', value: c ? AC.localInput(c.endsAt) : '', hint: 'Empty: never.' },
        { name: 'maxUses', label: 'How many times it can be used in all (optional)', type: 'number', value: c && c.maxUses != null ? c.maxUses : '', min: 1, hint: 'Empty: no limit. A use is a paid order.' },
        { name: 'oncePerCustomer', label: 'Once per customer', type: 'checkbox', value: c ? c.oncePerCustomer : true, hint: 'Each customer can use it for one paid order only.' }
      ]),
      submit: function (v) {
        var b = body(v);
        b.code = v.code; b.note = v.note; b.maxUses = v.maxUses === '' ? null : Number(v.maxUses); b.oncePerCustomer = v.oncePerCustomer;
        return c ? AC.api('PUT', '/api/console/coupons/' + encodeURIComponent(c.id), b) : AC.api('POST', '/api/console/coupons', b);
      }
    });
  }

  function saleDialog(opts) {
    var m = opts.sale || null;
    return AC.formDialog({
      title: m ? 'Change ' + m.name : 'New sale',
      text: 'Customers see the sale’s name and the old price crossed out on the pricing page and at checkout. To tell them about it, add a notification as well.',
      submitLabel: 'Save sale',
      fields: [
        { name: 'name', label: 'Name customers see', value: m ? m.name : '', required: true, maxlength: 40, placeholder: 'Diwali sale' }
      ].concat(amountFields(m), [
        { name: 'plans', label: 'On', type: 'checks', value: m ? m.plans : [], options: planChoices(opts.plans), hint: 'Tick none for every paid plan.' },
        { name: 'startsAt', label: 'Starts', type: 'datetime', value: m ? AC.localInput(m.startsAt) : '', hint: 'Empty: straight away. Your computer’s time.' },
        { name: 'endsAt', label: 'Ends', type: 'datetime', value: m ? AC.localInput(m.endsAt) : '', required: true, requiredText: 'A sale needs an end. Choose when it ends.' }
      ]),
      submit: function (v) {
        var b = body(v); b.name = v.name;
        return m ? AC.api('PUT', '/api/console/promotions/' + encodeURIComponent(m.id), b) : AC.api('POST', '/api/console/promotions', b);
      }
    });
  }

  function when(startsAt, endsAt) {
    var from = startsAt ? AC.fmt.dateTime(startsAt) : null, to = endsAt ? AC.fmt.dateTime(endsAt) : null;
    if (from && to) return from + ' to ' + to;
    if (from) return 'From ' + from;
    if (to) return 'Until ' + to;
    return 'No end date';
  }
  /** What each plan would cost: [{ name, listPaise, pricePaise }] → a small table. */
  function prices(examples) {
    if (!examples || !examples.length) return AC.quiet('No paid plans.');
    return AC.table([['Plan'], ['Now', 'num'], ['With it', 'num']], examples.map(function (x) {
      return el('tr', null, [el('td', { text: x.name }), el('td', { class: 'num' }, el('s', { class: 'muted', text: AC.money(x.listPaise) })), el('td', { class: 'num' }, el('b', { text: AC.money(x.pricePaise) }))]);
    }));
  }

  window.DK = { couponDialog: couponDialog, saleDialog: saleDialog, when: when, prices: prices };
})();
