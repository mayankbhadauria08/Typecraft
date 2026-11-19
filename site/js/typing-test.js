/* Typing test (/typing-test, /10-minute-typing-test): a timed test with live speed and accuracy.
   The length is the pressed button in #ttDur, or ?d=<seconds> when it names one of them.
   Works signed out; signed-in results are saved with POST /api/me/tests (daily limit on Free). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var box = $('ttBox'), wordsEl = $('ttWords'), input = $('ttInput'), hint = $('ttHint');
  if (!box || !wordsEl || !input) return;

  /* ---------- text (all written for TypeCraft) ---------- */
  var COMMON = ('the of and to in is you that it he was for on are as with his they at be this have from or one had by ' +
    'word but not what all were we when your can said there use an each which she do how their if will up other about out ' +
    'many then them these so some her would make like him into time has look two more write go see number no way could people ' +
    'my than first water been call who oil its now find long down day did get come made may part over new sound take only ' +
    'little work know place year live me back give most very after thing our just name good sentence man think say great where ' +
    'help through much before line right too mean old any same tell boy follow came want show also around form three small set ' +
    'put end does another well large must big even such because turn here why ask went men read need land different home us ' +
    'move try kind hand picture again change off play spell air away animal house point page letter mother answer found study ' +
    'still learn should world high every near add food between own below country plant last school father keep tree never start ' +
    'city earth eye light thought head under story saw left few while along might close something seem next hard open example ' +
    'begin life always those both paper together got group often run important until children side feet car mile night walk').split(' ');
  var SENTENCES = [
    'Practise a little every day and your fingers will learn the way home.',
    'Keep your eyes on the screen and let your hands find the keys.',
    'Speed comes from accuracy, so slow down when the mistakes pile up.',
    'The small train left the station at half past seven in the morning.',
    'A cup of tea and a quiet desk make the best place to practise.',
    'She saved the report, closed the window and walked to the bus stop.',
    'Good typists rest their fingers lightly on the home row between words.',
    'The market was busy, so we bought mangoes, rice and fresh green chillies.',
    'Write short sentences first, then join them into a clear paragraph.',
    'Every key has a home finger, and every finger has a short road to travel.',
    'Rain tapped on the roof while the children finished their homework.',
    'Check the date, the amount and the name before you send the invoice.',
    'Our team meets on Monday to plan the week and share the numbers.',
    'Breathe out, relax your shoulders and keep a steady, even rhythm.',
    'The library opens at nine and closes at six from Monday to Saturday.',
  ];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function numberToken() {
    var kinds = [
      function () { return String(10 + Math.floor(Math.random() * 990)); },
      function () { return (Math.floor(Math.random() * 28) + 1) + '/' + (Math.floor(Math.random() * 12) + 1) + '/20' + (24 + Math.floor(Math.random() * 4)); },
      function () { return 'Rs ' + (100 + Math.floor(Math.random() * 9900)) + '.' + String(Math.floor(Math.random() * 100)).padStart(2, '0'); },
      function () { return String(400000 + Math.floor(Math.random() * 99999)); },
    ];
    return pick(kinds)();
  }
  function makeText(kind, approxChars) {
    var out = [];
    var len = 0;
    while (len < approxChars) {
      var piece;
      if (kind === 'quotes') piece = pick(SENTENCES);
      else if (kind === 'numbers') piece = Math.random() < 0.35 ? numberToken() : pick(COMMON);
      else piece = pick(COMMON);
      out.push(piece); len += piece.length + 1;
    }
    return out.join(' ');
  }

  /* ---------- state ---------- */
  var kind = 'words';
  var duration = (function () {
    var group = $('ttDur'); if (!group) return 60;
    var want = new URLSearchParams(location.search).get('d');
    var btn = want && /^\d{1,4}$/.test(want) ? group.querySelector('[data-d="' + want + '"]') : null;
    if (btn) group.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === btn ? 'true' : 'false'); });
    var on = btn || group.querySelector('[aria-pressed="true"]');
    return (on && parseInt(on.getAttribute('data-d'), 10)) || 60;
  })();
  var target = '', typed = '';
  var started = 0, timer = 0, finished = false;
  var keys = 0, wrongKeys = 0;
  var charEls = [];

  function render() {
    wordsEl.textContent = '';
    charEls = [];
    var words = target.split(' ');
    var idx = 0;
    words.forEach(function (w, wi) {
      var span = document.createElement('span'); span.className = 'w';
      var text = wi < words.length - 1 ? w + ' ' : w;
      for (var i = 0; i < text.length; i++) {
        var c = document.createElement('span'); c.className = 'c'; c.textContent = text[i];
        span.appendChild(c); charEls[idx++] = c;
      }
      wordsEl.appendChild(span);
    });
    paint(0);
  }
  var lastLen = 0;
  function paint(from) {
    var n = typed.length;
    var lo = Math.max(0, Math.min(from, lastLen) - 1), hi = Math.min(charEls.length, Math.max(n, lastLen) + 1);
    for (var i = lo; i < hi; i++) {
      var el = charEls[i]; if (!el) continue;
      var cls = 'c';
      if (i < n) cls += typed[i] === target[i] ? ' ok' : ' bad';
      if (i === n) cls += ' cur';
      el.className = cls;
    }
    lastLen = n;
    scrollToCaret();
  }
  function scrollToCaret() {
    var cur = charEls[Math.min(typed.length, charEls.length - 1)];
    if (!cur) return;
    var lineH = cur.offsetHeight || 40;
    var top = cur.offsetTop;
    var shift = Math.max(0, top - lineH); // keep the caret on the second line
    wordsEl.style.transform = 'translateY(' + (-shift) + 'px)';
  }

  function correctChars() { var n = 0; for (var i = 0; i < typed.length; i++) if (typed[i] === target[i]) n++; return n; }
  function elapsed() { return started ? Math.min(duration, (Date.now() - started) / 1000) : 0; }
  function stats() {
    var secs = Math.max(elapsed(), 1);
    var min = secs / 60;
    var wpm = Math.round(correctChars() / 5 / min);
    var raw = Math.round(typed.length / 5 / min);
    var acc = keys ? Math.max(0, Math.round(100 * (keys - wrongKeys) / keys)) : 100;
    var errs = 0; for (var i = 0; i < typed.length; i++) if (typed[i] !== target[i]) errs++;
    return { wpm: wpm, raw: raw, acc: acc, errs: errs, chars: typed.length, secs: secs };
  }
  function setStat(id, value, unit) {
    var el = $(id); if (!el) return;
    el.textContent = String(value);
    if (unit) { var s = document.createElement('small'); s.textContent = unit; el.appendChild(s); }
  }
  function live() {
    var s = stats();
    var left = Math.max(0, Math.ceil(duration - elapsed()));
    if (duration > 120) setStat('ttTime', Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'));
    else setStat('ttTime', left, 's');
    setStat('ttWpm', started ? s.wpm : 0, 'wpm');
    setStat('ttAcc', s.acc, '%');
    setStat('ttErr', s.errs);
  }

  function reset(newText) {
    clearInterval(timer); timer = 0;
    started = 0; finished = false; typed = ''; keys = 0; wrongKeys = 0; lastLen = 0;
    if (newText !== false) target = makeText(kind, Math.max(400, duration * 14));
    input.value = ''; input.disabled = false;
    $('ttResult').hidden = true;
    render(); live();
    if (hint) hint.hidden = document.activeElement === input;
  }

  function start() {
    started = Date.now();
    timer = setInterval(function () { live(); if (elapsed() >= duration) finish(); }, 200);
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(timer); timer = 0;
    input.disabled = true;
    var s = stats();
    live();
    $('rWpm').textContent = s.wpm;
    $('rAcc').textContent = s.acc + '%';
    $('rRaw').textContent = s.raw;
    $('rChars').textContent = s.chars;
    $('rErrs').textContent = s.errs === 1 ? '1 error left' : s.errs + ' errors left';
    $('ttResLen').textContent = duration >= 60 ? (duration / 60) + ' min' : duration + ' s';
    var v;
    if (s.wpm < 25) v = 'A good start. The lessons build the habits that make this number climb.';
    else if (s.wpm < 40) v = 'Solid everyday speed. Touch typing practice will take you past 40.';
    else if (s.wpm < 60) v = 'Comfortable touch typing speed. Keep accuracy above 95% as you push.';
    else v = 'Fast. From here, accuracy and rhythm matter more than raw speed.';
    if (s.acc < 90) v += ' Your accuracy is under 90%: slowing down slightly will raise your real speed.';
    $('rVerdict').textContent = v;
    var res = $('ttResult'); res.hidden = false; res.focus();
    save(s);
  }

  function saveNote(text, link) {
    var box = $('rSave'); box.textContent = '';
    var p = document.createElement('p'); p.className = 'muted'; p.textContent = text;
    if (link) { p.appendChild(document.createTextNode(' ')); var a = document.createElement('a'); a.href = link.href; a.textContent = link.text; p.appendChild(a); }
    box.appendChild(p);
  }
  function newId() {
    if (window.crypto && crypto.randomUUID) return 'tt-' + crypto.randomUUID();
    return 'tt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  async function save(s) {
    if (s.chars < 5) return saveNote('Type a little more to get a result worth saving.');
    var who = window.TC && TC.me ? await TC.me() : null;
    if (!who || !who.user) {
      return saveNote('Want to keep your results and see your progress?', { href: '/signup?next=' + encodeURIComponent(location.pathname), text: 'Create a free account' });
    }
    var d = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
    var r = await TC.api('POST', '/api/me/tests', {
      id: newId(), duration: duration, wpm: s.wpm, rawWpm: s.raw, accuracy: s.acc, errors: s.errs, chars: s.chars,
      textKind: kind, today: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
    });
    if (r.ok) {
      var t = r.data && r.data.today;
      var left = t && t.limit != null ? ' (' + Math.max(0, t.limit - t.used) + ' saved tests left today)' : '';
      return saveNote('Saved to your history' + left + '.', { href: '/account/history', text: 'See your history' });
    }
    if (r.status === 402) return saveNote(r.error && r.error.message ? r.error.message : "You've used today's saved tests.", { href: '/pricing', text: 'See plans' });
    saveNote(r.error && r.error.message ? r.error.message : "We couldn't save this result.");
  }

  /* ---------- input ---------- */
  input.addEventListener('input', function () {
    if (finished) return;
    var v = input.value.replace(/\n/g, '');
    if (v.length > target.length) v = v.slice(0, target.length);
    if (!started && v.length) start();
    if (v.length > typed.length) { // count every new key, right or wrong
      for (var i = typed.length; i < v.length; i++) { keys++; if (v[i] !== target[i]) wrongKeys++; }
    }
    var from = Math.min(typed.length, v.length);
    typed = v;
    if (input.value !== v) input.value = v;
    paint(from); live();
    if (typed.length >= target.length) finish();
  });
  var tabArmed = false;
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') { e.preventDefault(); tabArmed = true; $('ttRestart').focus(); return; }
    if (e.key === 'Escape') { if (started && !finished) finish(); }
  });
  $('ttRestart').addEventListener('keydown', function (e) { if (e.key === 'Enter' && tabArmed) { e.preventDefault(); tabArmed = false; reset(); input.focus(); } });
  $('ttRestart').addEventListener('click', function () { reset(); input.focus(); });
  $('ttAgain').addEventListener('click', function () { reset(); input.focus(); });
  input.addEventListener('focus', function () { box.classList.add('focused'); if (hint) hint.hidden = true; });
  input.addEventListener('blur', function () { box.classList.remove('focused'); if (hint && !started) hint.hidden = false; });
  box.addEventListener('click', function () { if (!input.disabled) input.focus(); });

  function group(id, attr, onPick) {
    var g = $(id); if (!g) return;
    g.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      g.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      onPick(b.getAttribute(attr));
      reset(); input.focus();
    });
  }
  group('ttDur', 'data-d', function (d) { duration = parseInt(d, 10) || 60; });
  group('ttKind', 'data-k', function (k) { kind = /^(words|quotes|numbers)$/.test(k) ? k : 'words'; });

  reset();
})();
