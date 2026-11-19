/* Email templates: every email TypeCraft sends, filled with sample data. Nothing is sent from here.
   GET /api/console/email-templates → { groups, templates: [{ name, title, group, about }] }
   GET /api/console/email-templates/:name → { name, title, group, about, subject, text, previewUrl }
   The email itself loads in a sandboxed frame from /console/email-preview/:name (its own page: emails need inline styles). */
(function () {
  'use strict';
  var AC = window.AC, el = AC.el;
  var byId = function (id) { return document.getElementById(id); };
  var nav = byId('tplNav'), frame = byId('tplFrame'), wrap = byId('tplFrameWrap'), textBox = byId('tplText');
  var part = 'html', asked = 0;

  function choose(name, push) {
    var mine = ++asked;
    Array.prototype.forEach.call(nav.querySelectorAll('a[data-name]'), function (a) {
      if (a.getAttribute('data-name') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    AC.api('GET', '/api/console/email-templates/' + encodeURIComponent(name)).then(function (t) {
      if (mine !== asked) return; // a later choice wins
      byId('tplTitle').textContent = t.title;
      byId('tplAbout').textContent = t.about;
      var facts = AC.clear(byId('tplFacts'));
      facts.appendChild(AC.fact('Subject', t.subject));
      facts.appendChild(AC.fact('Template name', el('span', { class: 'mono', text: t.name })));
      frame.setAttribute('src', t.previewUrl);
      textBox.textContent = t.text;
      show();
      if (push) history.replaceState(null, '', '#' + t.name);
    }, function (err) {
      if (mine !== asked) return;
      byId('tplTitle').textContent = 'Couldn’t load this email';
      byId('tplAbout').textContent = err.message;
    });
  }
  function show() {
    wrap.hidden = part !== 'html';
    textBox.hidden = part !== 'text';
    Array.prototype.forEach.call(document.querySelectorAll('[data-part]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-part') === part)); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-part]'), function (b) {
    b.addEventListener('click', function () { part = b.getAttribute('data-part'); show(); });
  });

  AC.api('GET', '/api/console/email-templates').then(function (d) {
    AC.clear(nav); nav.removeAttribute('aria-busy');
    d.groups.forEach(function (g) {
      var mine = d.templates.filter(function (t) { return t.group === g; });
      if (!mine.length) return;
      nav.appendChild(el('h3', { class: 'tpl-group', text: g }));
      nav.appendChild(el('ul', null, mine.map(function (t) {
        return el('li', null, el('a', { href: '#' + t.name, 'data-name': t.name, text: t.title, on: { click: function (e) { e.preventDefault(); choose(t.name, true); } } }));
      })));
    });
    var wanted = location.hash.slice(1);
    var first = d.templates.some(function (t) { return t.name === wanted; }) ? wanted : d.templates[0].name;
    choose(first, false);
  }, function (err) {
    AC.clear(nav); nav.removeAttribute('aria-busy');
    nav.appendChild(AC.quiet("Couldn't load the emails. " + err.message));
  });
})();
