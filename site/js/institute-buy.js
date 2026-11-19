/* /institute/buy. GET /api/institutes/buy → { open, packageName, minSeats, terms: [{ months, pricePerSeatPaise }], maxSeats, maxPaise,
   emailVerified, you: { name, email, phone } }. Paying: K.buySeats (institute-pay.js) with { kind: 'new', seats, months, …details, agree }.
   The total here is a preview: the server works out the amount itself. docs/INSTITUTES.md §15. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  const form = $('#ib-form'), pay = $('#ib-pay');
  let info = null;

  const say = (kind, text) => K.mount($('#ib-msg'), kind ? K.alert(kind, text) : null);
  const months = () => { const r = K.$$('input[name=months]', form).find((x) => x.checked); return r ? Number(r.value) : null; };
  const termOf = (m) => info.terms.find((t) => t.months === m) || null;
  const words = (m) => `${m} months`;
  function lastDay(m) {
    // the same date m months on, less a day (the server decides the real dates on the day it is paid)
    const d = new Date(K.today() + 'T00:00:00Z');
    const day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString();
  }

  function summary() {
    const seats = Number($('#ib-seats').value);
    const t = termOf(months());
    const ok = Number.isInteger(seats) && seats >= info.minSeats && seats <= info.maxSeats && t;
    const total = ok ? seats * t.pricePerSeatPaise : null;
    const row = (label, value) => [h('dt', { class: 'muted', text: label }), h('dd', { text: value })];
    K.mount($('#ib-summary'),
      row('Plan', `${info.packageName} for each student`),
      row('Seats', Number.isInteger(seats) && seats > 0 ? String(seats) : '—'),
      row('Term', t ? `${words(t.months)}, from the day you pay to ${K.date(lastDay(t.months))}` : 'Choose a term'),
      row('Price', t ? `${K.money(t.pricePerSeatPaise)} a seat` : '—'),
      row('Total', total == null ? '—' : K.money(total)));
    const tooMuch = total != null && total > info.maxPaise;
    pay.disabled = !ok || tooMuch || !info.emailVerified;
    pay.textContent = total == null ? 'Pay' : `Pay ${K.money(total)}`;
    if (tooMuch) say('info', `Online payments go up to ${K.money(info.maxPaise)}. For more seats, write to us and pay by bank transfer.`);
    else if ($('#ib-msg').textContent.startsWith('Online payments go up to')) say(null);
  }

  async function submit(e) {
    if (e) e.preventDefault();
    const v = K.formValues(form);
    K.formErrors(form, null);
    const out = await K.buySeats({ kind: 'new', seats: Number(v.seats), months: months(), name: v.name, city: v.city, contactName: v.contactName,
      contactEmail: v.contactEmail, contactPhone: v.contactPhone, gstin: v.gstin, agree: !!v.agree }, { button: pay, say });
    if (out && out.error && out.error.error && out.error.error.fields) {
      K.formErrors(form, out.error.error.fields);
      return say('bad', 'Check the highlighted fields. Nothing has been charged.');
    }
    if (K.buyOutcome(out, say)) location.href = `/institute/${encodeURIComponent(out.instituteId)}?paid=1`;
  }

  async function load() {
    const res = await K.api('GET', '/api/institutes/buy');
    if (!res.ok) return K.error($('#ib-note'), res, load);
    info = res.data;
    if (!info.open) {
      return K.mount($('#ib-note'), h('div', { class: 'card' },
        K.alert('info', 'Buying seats online isn’t open right now. Write to us and we’ll set up your institute; you can pay by bank transfer or UPI.'),
        h('p', null, h('a', { class: 'btn btn-primary', href: '/contact', text: 'Write to us' }), ' ', h('a', { class: 'btn btn-ghost', href: '/institute-guide', text: 'How institutes work' }))));
    }
    K.mount($('#ib-note'), info.emailVerified ? null
      : K.alert('info', 'Confirm your email address before you pay: open the link we emailed you when you signed up, or send it again from Settings.', ' ', h('a', { href: '/account/settings', text: 'Settings' })));
    $('#ib-lede').textContent = `For coaching centres: each seat gives one student the ${info.packageName} plan for the term. You become the institute's admin.`;
    $('#ib-contactName').value = info.you.name || '';
    $('#ib-contactEmail').value = info.you.email || '';
    $('#ib-contactPhone').value = info.you.phone || '';
    const seats = $('#ib-seats');
    seats.min = String(info.minSeats); seats.max = String(info.maxSeats); seats.value = String(Math.max(info.minSeats, 20));
    $('#ib-seats-hint').textContent = `At least ${info.minSeats}. One student uses one seat; when a student finishes, remove them and the seat is free for the next one.`;
    const best = info.terms[info.terms.length - 1];
    K.append($('#ib-terms'), info.terms.map((t) => h('label', { class: 'buy-term' },
      h('input', { type: 'radio', name: 'months', value: String(t.months), checked: t === best }),
      h('span', { class: 'buy-term-name', text: words(t.months) }),
      h('span', { class: 'muted', text: `${K.money(t.pricePerSeatPaise)} a seat` }))));
    $('#ib-main').hidden = false;
    form.addEventListener('input', summary);
    form.addEventListener('change', summary);
    form.addEventListener('submit', submit);
    pay.addEventListener('click', submit);
    summary();
  }
  load();
})();
