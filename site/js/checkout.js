/* /checkout?plan=<id>. Data: GET /api/packages, TC.me() (entitlements for stacking), POST /api/checkout/order {packageId}
   → {orderId, razorpayOrderId, amountPaise, currency, keyId, packageName, prefill:{name,email,contact}},
   POST /api/checkout/failed {orderId, code, description}. Razorpay Checkout is loaded only when the learner presses Pay. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const RZP_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
  const planId = K.qs('plan');
  const payBtn = $('#co-pay');
  let pkg = null, rzpLoading = null;

  function msg(kind, text, ...more) { K.mount($('#co-msg'), kind ? K.alert(kind, text, ...more) : null); }
  function stop(text, action) {
    $('#co-main').hidden = true;
    $('#co-pay-card').hidden = true;
    K.mount($('#co-alert'), h('div', { class: 'card' }, K.alert('bad', text), h('p', null, h('a', { class: 'btn btn-primary', href: (action && action.href) || '/pricing', text: (action && action.label) || 'See all plans' }))));
  }

  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    if (rzpLoading) return rzpLoading;
    rzpLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = RZP_SRC; s.async = true;
      s.onload = () => (window.Razorpay ? resolve() : reject(new Error('missing')));
      s.onerror = () => { rzpLoading = null; s.remove(); reject(new Error('blocked')); };
      document.head.appendChild(s);
    });
    return rzpLoading;
  }

  function render(ent, catalogue) {
    const price = K.money(pkg.pricePaise, pkg.currency);
    document.title = `Checkout: ${pkg.name} · TypeCraft`;
    const active = ent && ent.plan && ent.plan !== 'free';
    const lifetimeOwned = active && !ent.expiresAt;
    const stackFrom = active && ent.expiresAt && Date.parse(ent.expiresAt) > Date.now() ? ent.expiresAt : null;
    let starts = 'Starts as soon as the payment is confirmed.';
    let ends = pkg.validityDays == null ? 'Never expires.' : `Lasts ${K.validity(pkg.validityDays)} (${pkg.validityDays} days).`;
    if (stackFrom) {
      starts = `Starts on ${K.date(stackFrom)}, when your current ${ent.planName || 'plan'} ends, so no days are lost.`;
      if (pkg.validityDays != null) ends = `Lasts ${pkg.validityDays} days, until about ${K.date(new Date(Date.parse(stackFrom) + pkg.validityDays * 86400000).toISOString())}.`;
    }
    K.mount($('#co-summary'),
      h('p', null, pkg.highlight ? h('span', { class: 'badge badge-brand', text: 'Recommended' }) : null),
      h('h3', { text: `${pkg.name} plan` }),
      pkg.description ? h('p', { class: 'muted', text: pkg.description }) : null,
      h('dl', { class: 'co-dl', style: 'display:grid;grid-template-columns:auto 1fr;gap:.4rem 1rem;margin:1rem 0' },
        h('dt', { class: 'muted', text: 'Validity' }), h('dd', { style: 'margin:0', text: ends }),
        h('dt', { class: 'muted', text: 'Starts' }), h('dd', { style: 'margin:0', text: starts }),
        h('dt', { class: 'muted', text: 'Renewal' }), h('dd', { style: 'margin:0', text: 'No automatic renewal. You choose whether to buy again.' }),
        h('dt', { class: 'muted', text: 'Total' }), h('dd', { style: 'margin:0' }, h('span', { class: 'price mono', text: price }), h('span', { class: 'muted', text: ' incl. all charges' }))));
    const labels = Object.fromEntries((catalogue || []).map((f) => [f.key, f]));
    const feats = (pkg.features || []).map((f) => (typeof f === 'string' ? labels[f] || { key: f, label: f } : f));
    const have = new Set((ent && ent.features) || []);
    K.mount($('#co-features'), feats.length
      ? h('ul', { style: 'list-style:none;padding:0;margin:0;display:grid;gap:.5rem' }, feats.map((f) => h('li', { style: 'display:flex;gap:.5rem' }, K.icon('check'),
        h('span', null, h('span', { text: f.label }), have.has(f.key) ? h('span', { class: 'muted', text: ' (you have this now)' }) : null))))
      : h('p', { class: 'muted', text: 'See the pricing page for what this plan includes.' }));
    if (lifetimeOwned) {
      msg('info', `You already have ${ent.planName || 'a plan'} that never expires, so you don't need to buy anything.`, ' ', h('a', { href: '/account/plans', text: 'Your plan' }));
      payBtn.textContent = 'Already included';
      return;
    }
    payBtn.textContent = `Pay ${price}`;
    payBtn.disabled = false;
  }

  async function pay() {
    msg(null);
    K.busy(payBtn, true);
    const [res] = await Promise.all([K.api('POST', '/api/checkout/order', { packageId: pkg.id }), loadRazorpay().catch(() => null)]);
    if (!res.ok) {
      K.busy(payBtn, false);
      if (res.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
      if (res.error && res.error.code === 'payments_unavailable') return msg('bad', 'Payments are paused for a short while. Nothing has been charged. Please try again later.');
      return msg('bad', K.errMsg(res, 'We could not start the payment. Nothing has been charged.'));
    }
    try { await loadRazorpay(); } catch {
      K.busy(payBtn, false);
      return msg('bad', 'The Razorpay payment window could not load. Check your connection, turn off any blocker for checkout.razorpay.com, and try again. Nothing has been charged.');
    }
    const o = res.data;
    let finished = false;
    const rzp = new window.Razorpay({
      key: o.keyId,
      order_id: o.razorpayOrderId,
      amount: o.amountPaise,
      currency: o.currency || 'INR',
      name: 'TypeCraft',
      description: `${o.packageName || pkg.name} plan`,
      prefill: o.prefill || {},
      notes: { orderId: o.orderId },
      theme: { color: '#0b6e63' },
      modal: {
        ondismiss() {
          if (finished) return;
          K.busy(payBtn, false);
          msg('info', 'Payment window closed. Nothing has been charged. Press Pay to try again whenever you are ready.');
        },
      },
      handler(resp) {
        finished = true;
        try {
          sessionStorage.setItem(`tc:pay:${o.orderId}`, JSON.stringify({
            orderId: o.orderId, razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature,
          }));
        } catch { /* storage blocked: the processing page asks the server instead */ }
        location.href = `/payment/processing?order=${encodeURIComponent(o.orderId)}`;
      },
    });
    rzp.on('payment.failed', async (resp) => {
      if (finished) return;
      finished = true;
      const err = (resp && resp.error) || {};
      await K.api('POST', '/api/checkout/failed', { orderId: o.orderId, code: String(err.code || 'payment_failed'), description: String(err.description || err.reason || '') });
      try { rzp.close(); } catch { /* already closed */ }
      location.href = `/payment/failure?order=${encodeURIComponent(o.orderId)}`;
    });
    rzp.open();
  }

  async function load() {
    if (!planId) return stop('Choose a plan first.');
    const [pkgRes, me] = await Promise.all([K.api('GET', '/api/packages'), K.me()]);
    if (!pkgRes.ok) { K.error($('#co-summary'), pkgRes, load); K.mount($('#co-features')); return; }
    pkg = K.list(pkgRes.data, 'packages').find((p) => p.id === planId) || null;
    if (!pkg) return stop("That plan isn't available. Please choose one of the current plans.");
    if (!(pkg.pricePaise > 0)) return stop('The Free plan needs no payment: it is already part of your account.', { href: '/dashboard', label: 'Go to dashboard' });
    render(me && me.entitlements, K.list(pkgRes.data, 'features'));
    if (K.qs('retry')) msg('info', 'Your previous attempt did not go through and nothing was activated. You can try again below.');
  }
  payBtn.addEventListener('click', pay);
  load();
})();
