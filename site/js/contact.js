/* Contact form → POST /api/contact { name, email, topic, message }. */
(function () {
  'use strict';
  const form = document.getElementById('contactForm');
  if (!form) return;
  const topic = TC.qs('topic');
  if (topic && form.elements.topic.querySelector('option[value="' + topic + '"]')) form.elements.topic.value = topic;
  TC.me().then((me) => {
    if (!me) return;
    if (!form.elements.name.value) form.elements.name.value = me.user.fullName || '';
    if (!form.elements.email.value) form.elements.email.value = me.user.email || '';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = TC.formValues(form);
    const errs = {};
    if (!v.name.trim()) errs.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) errs.email = 'Enter a valid email address so we can reply.';
    if (v.message.trim().length < 10) errs.message = 'Tell us a little more (at least 10 characters).';
    if (Object.keys(errs).length) return TC.formErrors(form, errs);
    const b = form.querySelector('button[type=submit]');
    TC.busy(b, true);
    const r = await TC.api('POST', '/api/contact', { name: v.name.trim(), email: v.email.trim(), topic: v.topic, message: v.message.trim() });
    TC.busy(b, false);
    if (r.status === 404 || r.status === 405) return TC.formErrors(form, null, "The contact form isn't available right now. Please email us at hello@typecrafttyping.com instead.");
    if (!r.ok) return r.error && r.error.fields ? TC.formErrors(form, r.error.fields) : TC.formErrors(form, null, r.error.message);
    TC.formErrors(form, null);
    form.elements.message.value = '';
    TC.formMessage(form, (r.data && r.data.message) || "Thanks, your message has reached us. We've emailed you a copy, and we'll reply to " + v.email.trim() + '.', 'ok');
    form.querySelector('[data-msg]').scrollIntoView({ block: 'nearest' });
  });
})();
