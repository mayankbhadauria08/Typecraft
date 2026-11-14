/* /admin/packages. Data: GET /api/admin/packages → {packages:[{id, name, description, pricePaise, currency, validityDays, features:[key]|[{key,label}],
   limits:{lessons, dailyTests, historyDays}, highlight, active, displayOrder}], features:[{key,label,description}]};
   PUT /api/admin/packages/:id {name, description, pricePaise, validityDays, features:[key], limits, highlight, active, displayOrder}. */
(function () {
  'use strict';
  const K = window.TCK, h = K.h, $ = K.$;
  let pkgs = [], catalogue = [], current = null, role = null;
  const canWrite = () => role === 'owner' || role === 'admin';
  const keysOf = (f) => (Array.isArray(f) ? f.map((x) => (typeof x === 'string' ? x : x.key)) : []);
  const label = (key) => (catalogue.find((f) => f.key === key) || { label: key }).label;

  function tabs() {
    K.mount($('#ap-tabs'), pkgs.map((p) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(current && current.id === p.id), text: p.name + (p.active === false || p.active === 0 ? ' (off)' : ''),
      onclick: () => { current = p; tabs(); renderForm(); } })));
  }

  function values() {
    const f = $('#ap-form');
    const num = (n) => (f.elements[n].value.trim() === '' ? null : Number(f.elements[n].value));
    return {
      name: f.elements.name.value.trim(),
      description: f.elements.description.value.trim(),
      pricePaise: Math.round(Number(f.elements.price.value || 0) * 100),
      validityDays: num('validityDays'),
      features: K.$$('input[name=feature]:checked', f).map((i) => i.value),
      limits: { lessons: f.elements.lessons.value, dailyTests: num('dailyTests'), historyDays: num('historyDays') },
      highlight: f.elements.highlight.checked,
      active: f.elements.active.checked,
      displayOrder: Number(f.elements.displayOrder.value || 0),
    };
  }

  function preview() {
    const v = values();
    K.mount($('#ap-preview'), h('article', { class: v.highlight ? 'plan-card recommended card' : 'plan-card card' },
      v.highlight ? h('span', { class: 'badge badge-brand', text: 'Recommended' }) : null,
      v.active ? null : h('span', { class: 'badge badge-muted', text: 'Hidden: not active' }),
      h('h3', { text: v.name || 'Untitled' }),
      h('p', { class: 'price' }, h('span', { class: 'mono', text: v.pricePaise ? K.money(v.pricePaise) : '₹0' }), h('span', { class: 'muted', text: ` · ${current.id === 'free' ? 'free forever' : K.validity(v.validityDays)}` })),
      h('p', { class: 'muted', text: v.description }),
      h('ul', null, v.features.map((k) => h('li', { text: label(k) }))),
      h('span', { class: 'btn btn-primary btn-block', 'aria-hidden': 'true', text: v.pricePaise ? `Buy ${v.name}` : 'Start free' })));
  }

  function field(id, lbl, input, hint) { input.id = id; return h('div', { class: 'field' }, h('label', { for: id, text: lbl }), input, hint ? h('p', { class: 'hint', text: hint }) : null); }

  function renderForm() {
    const p = current;
    const lim = typeof p.limits === 'string' ? JSON.parse(p.limits || '{}') : p.limits || {};
    const have = new Set(keysOf(p.features));
    const isFree = p.id === 'free';
    const price = p.pricePaise || 0;
    const ro = !canWrite();
    K.mount($('#ap-fields'),
      ro ? K.alert('info', 'Your role can view packages but not change them.') : null,
      h('p', { class: 'muted' }, 'Package id: ', h('span', { class: 'mono', text: p.id })),
      field('ap-name', 'Name', h('input', { name: 'name', value: p.name || '', required: true, maxlength: 40 })),
      field('ap-desc', 'Description', h('textarea', { name: 'description', rows: 3, maxlength: 300, value: p.description || '' })),
      h('div', { class: 'field-row' },
        field('ap-price', 'Price (₹)', h('input', { name: 'price', type: 'number', min: isFree ? 0 : 1, max: 100000, step: '0.01', inputmode: 'decimal', value: (price / 100).toString(), disabled: isFree }), isFree ? 'Free stays ₹0.' : 'Saved in paise. Includes all charges.'),
        field('ap-valid', 'Validity (days)', h('input', { name: 'validityDays', type: 'number', min: 1, max: 3650, inputmode: 'numeric', value: p.validityDays ?? '', disabled: isFree }), 'Empty = never expires.')),
      h('fieldset', { class: 'field' }, h('legend', { text: 'Features' }),
        catalogue.map((f) => h('div', { class: 'check' }, h('input', { type: 'checkbox', name: 'feature', id: `ap-f-${f.key}`, value: f.key, checked: have.has(f.key) }),
          h('label', { for: `ap-f-${f.key}` }, h('span', { text: f.label }), ' ', h('span', { class: 'muted mono', text: f.key }))))),
      h('fieldset', { class: 'field' }, h('legend', { text: 'Limits' }),
        h('div', { class: 'field-row' },
          field('ap-lessons', 'Lessons', h('select', { name: 'lessons' }, h('option', { value: 'first5', text: 'First 5', selected: lim.lessons !== 'all' }), h('option', { value: 'all', text: 'All', selected: lim.lessons === 'all' }))),
          field('ap-tests', 'Tests per day', h('input', { name: 'dailyTests', type: 'number', min: 0, max: 1000, value: lim.dailyTests ?? '' }), 'Empty = unlimited.'),
          field('ap-hist', 'History (days)', h('input', { name: 'historyDays', type: 'number', min: 1, max: 3650, value: lim.historyDays ?? '' }), 'Empty = full history.'))),
      h('div', { class: 'field-row' },
        h('div', { class: 'check' }, h('input', { type: 'checkbox', name: 'highlight', id: 'ap-hl', checked: !!p.highlight }), h('label', { for: 'ap-hl', text: 'Recommended (highlighted)' })),
        h('div', { class: 'check' }, h('input', { type: 'checkbox', name: 'active', id: 'ap-active', checked: p.active !== false && p.active !== 0, disabled: isFree }), h('label', { for: 'ap-active', text: 'On sale (active)' }))),
      field('ap-order', 'Display order', h('input', { name: 'displayOrder', type: 'number', min: 0, max: 100, value: p.displayOrder ?? 0 }), 'Lower shows first.'),
      h('div', { class: 'card-foot field-row' },
        h('button', { type: 'submit', class: 'btn btn-primary', text: 'Save package…', disabled: ro }),
        h('button', { type: 'button', class: 'btn btn-ghost', text: 'Undo changes', onclick: () => renderForm() })));
    if (ro) K.$$('#ap-fields input, #ap-fields select, #ap-fields textarea').forEach((i) => { i.disabled = true; });
    preview();
  }

  $('#ap-form').addEventListener('input', () => current && preview());
  $('#ap-form').addEventListener('change', () => current && preview());
  $('#ap-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    K.formErrors(form, null);
    const v = values();
    const f = {};
    if (!v.name) f.name = 'Give the package a name.';
    if (current.id !== 'free' && !(v.pricePaise >= 100)) f.price = 'Price must be at least ₹1.';
    if (v.validityDays != null && !(Number.isInteger(v.validityDays) && v.validityDays >= 1)) f.validityDays = 'Whole days, 1 or more, or empty.';
    if (Object.keys(f).length) return K.formErrors(form, f);
    if (current.id === 'free') { v.pricePaise = 0; v.validityDays = null; v.active = true; }
    const oldPrice = current.pricePaise || 0;
    const changes = [];
    if (v.pricePaise !== oldPrice) changes.push(`price ${K.money(oldPrice)} → ${K.money(v.pricePaise)}`);
    if ((current.validityDays ?? null) !== v.validityDays) changes.push(`validity → ${K.validity(v.validityDays)}`);
    const wasActive = current.active !== false && current.active !== 0;
    if (wasActive !== v.active) changes.push(v.active ? 'put on sale' : 'taken off sale');
    const ok = await K.confirm({ title: `Save ${v.name}?`, danger: wasActive && !v.active, confirmLabel: 'Save package',
      text: `${changes.length ? `Changes: ${changes.join('; ')}. ` : ''}New purchases use these settings immediately. Existing plan periods keep what was bought.` });
    if (!ok) return;
    const btn = form.querySelector('[type=submit]');
    K.busy(btn, true);
    const res = await K.api('PUT', `/api/admin/packages/${encodeURIComponent(current.id)}`, v);
    K.busy(btn, false);
    if (!res.ok) return K.formFail(form, res);
    const saved = (res.data && res.data.package) || { ...current, ...v };
    pkgs = pkgs.map((p) => (p.id === current.id ? saved : p));
    current = saved;
    tabs(); renderForm();
    K.toast('Package saved.', 'ok');
  });

  async function load() {
    const [res, r] = await Promise.all([K.api('GET', '/api/admin/packages'), K.role()]);
    role = r;
    if (!res.ok) { K.mount($('#ap-tabs')); return K.error($('#ap-fields'), res, load); }
    pkgs = res.data.packages.slice().sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    catalogue = res.data.features;
    if (!pkgs.length) { K.mount($('#ap-tabs')); return K.empty($('#ap-fields'), { title: 'No packages', text: 'Run the database migration to seed the plans.' }); }
    current = pkgs.find((p) => p.id === K.qs('id')) || pkgs.find((p) => p.highlight) || pkgs[0];
    tabs(); renderForm();
  }
  load();
})();
