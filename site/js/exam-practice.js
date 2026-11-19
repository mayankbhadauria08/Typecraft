/* /exam-practice (docs/EXAM-MODES.md). Needs shared/exam-passages.js, shared/exam-rules.js, the page kit
   and js/rewards-ui.js (the certificate picture). Works signed out; a free account saves results.
   POST /api/exams/results { id, mode, passageId, typed, seconds, path, today } → { saved, result, verdict }
   GET  /api/exams/results → { results: [...], best, limit }
   ?batchTest=<id>: a batch's scheduled test (docs/INSTITUTES.md §16). GET /api/me/batch-tests/:id → { test, batch, institute, mine };
   POST /api/me/batch-tests/:id/start, then the result is saved with batchTestId → { batchTest: { counted, why } }.
   POST /api/exams/results/:id/certificate → { code, shared } */
(function () {
  'use strict';
  const K = window.TCK, X = window.TC_EXAMS, h = K.h, $ = (id) => document.getElementById(id);
  if (!X) return;
  const intro = $('exIntro'), choose = $('exChoose'), test = $('exTest'), input = $('exInput'), result = $('exResult');
  let M = null, P = null, want = [], started = 0, timer = 0, finished = false, lastPassage = {};
  let me = null, mePromise = K.me().then((m) => { me = m; return m; });
  const fmt = (n, d) => K.num(n, d || 0);
  const clock = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  /* ---------- choosing and starting ---------- */
  function pickPassage(mode) {
    const list = X.passages(mode);
    let tries = list.filter((p) => p.id !== lastPassage[mode]);
    if (!tries.length) tries = list;
    const p = tries[Math.floor(Math.random() * tries.length)];
    lastPassage[mode] = p.id;
    return p;
  }
  function begin(mode, passageId) {
    M = X.MODES[mode]; P = (passageId && X.passage(mode, passageId)) || pickPassage(mode); want = X.words(P.text);
    started = 0; finished = false; clearInterval(timer); timer = 0;
    $('exTestName').textContent = M.name;
    $('exTestRules').textContent = M.minutes + ' minutes. ' + (M.backspace ? 'Backspace works.' : 'Backspace is turned off.') +
      (M.wordLimit ? ' You can type as many words as the passage has.' : '') + ' Goal: ' + M.goal + '.';
    $('exPassageTitle').textContent = P.title;
    $('exPassage').textContent = P.text;
    $('exPassage').scrollTop = 0;
    $('exWordsWrap').hidden = !M.wordLimit;
    $('exStartHint').hidden = false;
    $('exKeysNote').textContent = '';
    input.value = ''; input.disabled = false;
    $('exSubmit').disabled = true;
    showClock();
    choose.hidden = true; intro.hidden = true; result.hidden = true; test.hidden = false;
    test.scrollIntoView({ block: 'start' });
    input.focus({ preventScroll: true });
  }
  function backToChoice() {
    clearInterval(timer); timer = 0; started = 0; finished = true;
    test.hidden = true; result.hidden = true; choose.hidden = false; intro.hidden = false;
    window.scrollTo({ top: 0 });
  }
  choose.addEventListener('click', (e) => { const b = e.target.closest('[data-start]'); if (b) begin(b.getAttribute('data-start')); });

  /* ---------- the clock ---------- */
  const limit = () => M.minutes * 60;
  const elapsed = () => (started ? Math.min(limit(), (Date.now() - started) / 1000) : 0);
  function showClock() {
    $('exClock').textContent = clock(limit() - elapsed());
    if (M.wordLimit) $('exWords').textContent = fmt(Math.max(0, want.length - X.words(input.value).length));
  }
  function start() {
    started = Date.now();
    $('exStartHint').hidden = true; $('exSubmit').disabled = false;
    timer = setInterval(() => { showClock(); if (elapsed() >= limit()) finish(); }, 250);
  }

  /* ---------- typing: the exam's rules ---------- */
  const note = (text) => { $('exKeysNote').textContent = text; };
  const caretAtEnd = () => input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
  input.addEventListener('beforeinput', (e) => {
    if (finished || !M) { e.preventDefault(); return; }
    const t = e.inputType || '';
    if (/^insertFrom(Paste|Drop)|^historyU|^historyR|insertReplacementText/.test(t)) { e.preventDefault(); note('Pasting and undo are turned off, as in the exam.'); return; }
    if (!M.backspace) {
      if (/^delete/.test(t)) { e.preventDefault(); note('Backspace is turned off in this test: keep going.'); return; }
      if (!caretAtEnd()) { e.preventDefault(); input.setSelectionRange(input.value.length, input.value.length); return; }
    }
    if (M.wordLimit && (t === 'insertLineBreak' || t === 'insertParagraph' || (e.data && /\s/.test(e.data)))) {
      const before = input.value.slice(0, input.selectionStart);
      if (X.words(before).length >= want.length && /\S$/.test(before)) { e.preventDefault(); note("You've typed as many words as the passage has. Correct mistakes, or submit."); }
    }
  });
  input.addEventListener('keydown', (e) => {
    if (!M || M.backspace) return;
    if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key) ||
        ((e.ctrlKey || e.metaKey) && /^[xzya]$/i.test(e.key))) { e.preventDefault(); if (/Backspace|Delete/.test(e.key)) note('Backspace is turned off in this test: keep going.'); }
  });
  ['paste', 'drop', 'cut'].forEach((ev) => input.addEventListener(ev, (e) => { e.preventDefault(); }));
  ['mouseup', 'focus', 'select'].forEach((ev) => input.addEventListener(ev, () => {
    if (M && !M.backspace && !caretAtEnd()) input.setSelectionRange(input.value.length, input.value.length);
  }));
  input.addEventListener('input', () => {
    if (finished) return;
    if (!started && input.value.length) start();
    if (M.wordLimit) showClock();
  });
  window.addEventListener('beforeunload', (e) => { if (started && !finished) { e.preventDefault(); e.returnValue = ''; } });

  $('exSubmit').addEventListener('click', async () => {
    if (!started || finished) return;
    const left = limit() - elapsed();
    const ok = await K.confirm({ title: 'Submit now?', text: 'You still have ' + clock(left) + '. The time you used is what counts.', confirmLabel: 'Submit' });
    if (ok) finish(); else input.focus();
  });
  $('exLeave').addEventListener('click', async () => {
    if (started && !finished) {
      const ok = await K.confirm({ title: 'Leave this test?', text: "What you've typed won't be marked.", confirmLabel: 'Leave' });
      if (!ok) { input.focus(); return; }
    }
    backToChoice();
  });

  /* ---------- the result ---------- */
  function tile(label, value, sub) {
    return h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: label }), h('span', { class: 'stat-value', text: value }), sub ? h('span', { class: 'stat-sub', text: sub }) : null);
  }
  function stats(r) {
    const mk = tile('Mistakes', fmt(r.mistakes, 1), r.full + ' full, ' + r.half + ' half: ' + r.mistakesPct + '% of ' + fmt(r.words) + ' words');
    const net = tile('Net speed', fmt(r.netWpm, 1), 'words a minute');
    const gross = tile('Gross speed', fmt(r.grossWpm, 1), 'words a minute');
    if (r.mode === 'ssc-typing') return [tile('Key depressions', fmt(r.strokes), fmt(M.target.strokes) + ' needed in ' + M.minutes + ' minutes'), mk, net, gross];
    if (r.mode === 'ssc-dest') return [tile('Correct key depressions', fmt(r.correctStrokes), fmt(M.target.correctStrokes) + ' needed'), tile('Per hour', fmt(r.kdph), 'correct key depressions'), mk, gross];
    return [tile('Net speed', fmt(r.netWpm, 1), fmt(M.target.netWpm) + ' needed'), gross, mk, tile('Time used', clock(r.seconds), 'of ' + M.minutes + ' minutes')];
  }
  const KIND = { wrong: 'Wrong word', missing: 'Left out', extra: 'Extra word', case: 'Capitals', punct: 'Punctuation', space: 'Spacing' };
  function mistakes(r) {
    const list = r.list || [];
    $('exMistakesSum').textContent = 'The mistakes, word by word (' + list.length + ')';
    $('exMistakesWrap').open = false;
    $('exMistakesWrap').hidden = !list.length;   // the figures already say there were none
    K.mount($('exMistakes'), list.length ? K.table([
      { label: 'Word', num: true, value: (x) => fmt(x.at + 1) },
      { label: 'Mistake', value: (x) => h('span', { class: 'badge ' + (x.kind === 'wrong' || x.kind === 'missing' || x.kind === 'extra' ? 'badge-bad' : 'badge-warn'), text: KIND[x.kind] + (x.kind === 'wrong' || x.kind === 'missing' || x.kind === 'extra' ? ' (full)' : ' (half)') }) },
      { label: 'Passage', value: (x) => h('span', { class: 'mono', text: x.want || '—' }) },
      { label: 'You typed', value: (x) => h('span', { class: 'mono', text: x.got || '—' }) },
    ], list.slice(0, 80), { caption: 'Mistakes' }) : null,
    list.length > 80 ? h('p', { class: 'muted', text: 'The first 80 are shown.' }) : null);
  }
  function verdictBox(v) {
    const box = $('exVerdict');
    box.className = 'alert ' + (v.passed ? 'alert-ok' : 'alert-info');
    box.textContent = v.text;
    const b = $('exBadge'); b.className = 'badge ' + (v.passed ? 'badge-ok' : 'badge-warn'); b.textContent = v.passed ? 'Goal met' : 'Not yet';
  }
  function finish() {
    if (finished) return;
    finished = true; clearInterval(timer); timer = 0;
    input.disabled = true;
    const seconds = Math.max(1, Math.round(elapsed() * 10) / 10);
    const typed = input.value;
    const r = X.score(M.id, P.id, typed, seconds, { optimal: true });
    const forBatch = batchRun;
    batchRun = false; // "Take it again" afterwards is practice
    test.hidden = true; result.hidden = false;
    if (!r.ok) { verdictBox({ passed: false, text: r.message }); K.mount($('exStats')); K.mount($('exSave')); K.mount($('exCert')); return; }
    $('exResultH').textContent = M.name + ': your result';
    verdictBox(X.verdict(r));
    K.mount($('exStats'), stats(r));
    mistakes(r);
    K.mount($('exCert'));
    result.focus();
    save(r, typed, forBatch);
  }

  /* ---------- saving and certificates ---------- */
  function saveNote(...kids) { K.mount($('exSave'), h('p', { class: 'muted' }, kids)); }
  function newId() {
    if (window.crypto && crypto.randomUUID) return 'ex-' + crypto.randomUUID();
    return 'ex-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  const WHY = { already: 'Your first result for this test is the one that counts; this one is saved as practice.', late: 'It came in too late to count for the test; it is saved as practice.',
    not_started: 'Start the test from the box at the top to take part; this result is saved as practice.', other_test: 'This was another passage, so it is saved as practice.',
    cancelled: 'Your teacher cancelled the test; this result is saved as practice.', not_yours: "You're not in this test's batch; this result is saved as practice." };
  async function save(r, typed, forBatch) {
    if (!r.typedWords || r.seconds < 10) return saveNote('Type for longer to get a result worth saving.', forBatch ? ' Nothing was sent to your teacher.' : '');
    await mePromise;
    if (!me || !me.user) return saveNote('Want to keep your results and get a certificate when you meet the goal? ', h('a', { href: '/signup?next=%2Fexam-practice', text: 'Create a free account' }), '.');
    saveNote('Saving…');
    const res = await K.api('POST', '/api/exams/results', { id: newId(), mode: r.mode, passageId: r.passageId, typed, seconds: r.seconds, path: r.path, today: K.today(),
      ...(forBatch ? { batchTestId } : {}) });
    if (!res.ok) return K.mount($('exSave'), K.alert(res.status === 429 || res.status === 503 ? 'info' : 'bad', K.errMsg(res, "We couldn't save this result.")));
    const saved = res.data.result;
    verdictBox(res.data.verdict);
    const bt = res.data.batchTest;
    if (bt) {
      K.mount($('exSave'), K.alert(bt.counted ? 'ok' : 'info', bt.counted ? `This result counts for ${bt.batch ? bt.batch.name : 'your batch'}'s test. Your teacher can see it.` : (WHY[bt.why] || 'It is saved as practice.')));
      batchTest();
    } else saveNote('Saved to your exam results. ', h('a', { href: '#exHistory', text: 'See your attempts' }), '.');
    if (saved.passed) offerCertificate(saved);
    history();
  }
  function offerCertificate(saved) {
    const btn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Get a certificate' });
    btn.addEventListener('click', async () => {
      K.busy(btn, true);
      const res = await K.api('POST', `/api/exams/results/${encodeURIComponent(saved.id)}/certificate`, {});
      K.busy(btn, false);
      if (!res.ok) return K.toast(K.errMsg(res), 'bad');
      showCertificate(saved, res.data.code);
      history();
    });
    K.mount($('exCert'), h('div', { class: 'ex-cert-offer' }, h('p', { text: 'You met the goal. Get a certificate with a code that anyone you share it with can check.' }), btn));
  }
  const verifyUrl = (code) => location.origin + '/verify/' + code;
  function showCertificate(saved, code) {
    const name = (me && me.user && me.user.fullName) || '';
    const M2 = X.MODES[saved.mode];
    const data = { name, wpm: Math.floor(saved.netWpm), accuracy: Math.max(0, Math.floor(100 - saved.mistakesPct)), seconds: M2.minutes * 60, date: saved.createdAt, code, verifyAt: location.host + '/verify' };
    const pic = h('div', { class: 'ex-cert-pic' });
    if (window.TC_REWARDS_UI) K.append(pic, [K.svg(TC_REWARDS_UI.certificate(data))]);
    const copy = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Copy the link' });
    copy.addEventListener('click', () => {
      (navigator.clipboard ? navigator.clipboard.writeText(verifyUrl(code)) : Promise.reject()).then(() => K.toast('Link copied.'), () => K.toast('Select the link and copy it.', 'bad'));
    });
    const canPrint = me && me.entitlements && K.has(me.entitlements, 'certificates');
    const print = canPrint ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Print', onclick: () => TC_REWARDS_UI.printCertificate(data) })
      : h('a', { class: 'btn btn-ghost btn-sm', href: '/pricing', text: 'Printing: see plans' });
    K.mount($('exCert'), h('div', { class: 'ex-cert' }, pic, h('div', { class: 'ex-cert-text' },
      h('p', null, 'Certificate code ', h('b', { class: 'mono', text: code }), '.'),
      h('p', { class: 'muted' }, 'Anyone can check it at ', h('a', { href: verifyUrl(code), text: verifyUrl(code) }), '. You can stop sharing it at any time on ', h('a', { href: '/account/certificates', text: 'your certificates page' }), '.'),
      h('div', { class: 'actions' }, copy, print))));
  }

  /* ---------- your attempts ---------- */
  async function history() {
    await mePromise;
    if (!me || !me.user) return;
    const res = await K.api('GET', '/api/exams/results');
    const host = $('exHistoryBody');
    $('exHistory').hidden = false;
    if (!res.ok) return K.mount(host, K.alert(res.status === 503 ? 'info' : 'bad', K.errMsg(res, "We couldn't load your attempts.")));
    const rows = res.data.results;
    if (!rows.length) return K.mount(host, h('p', { class: 'muted', text: 'Your saved attempts will show here.' }));
    K.mount(host, K.table([
      { label: 'Date', value: (r) => K.dateTime(r.createdAt) },
      { label: 'Test', value: (r) => r.modeName },
      { label: 'Result', value: (r) => (r.mode === 'ssc-dest' ? fmt(r.correctStrokes) + ' correct key depressions' : r.mode === 'ssc-typing' ? fmt(r.strokes) + ' key depressions' : fmt(r.netWpm, 1) + ' net wpm') },
      { label: 'Mistakes', num: true, value: (r) => r.mistakesPct + '%' },
      { label: 'Goal', value: (r) => h('span', { class: 'badge ' + (r.passed ? 'badge-ok' : 'badge-muted'), text: r.passed ? 'Met' : 'Not yet' }) },
      { label: 'Certificate', value: (r) => (r.certificate ? h('a', { class: 'mono', href: verifyUrl(r.certificate.code), text: r.certificate.code })
        : r.passed ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Get one', onclick: async (e) => {
          K.busy(e.currentTarget, true);
          const c = await K.api('POST', `/api/exams/results/${encodeURIComponent(r.id)}/certificate`, {});
          if (!c.ok) { K.busy(e.currentTarget, false); return K.toast(K.errMsg(c), 'bad'); }
          history();
        } }) : '—') },
    ], rows, { caption: 'Your recent exam practice attempts' }));
  }

  /* ---------- a batch's scheduled test ---------- */
  const batchTestId = K.qs('batchTest');
  let batchRun = false;
  const hm = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  async function batchTest() {
    if (!batchTestId) return;
    const box = $('exBatch');
    box.hidden = false;
    await mePromise;
    if (!me || !me.user) {
      return K.mount(box, K.alert('info', "Sign in to take your batch's scheduled test. ", h('a', { href: `/login?next=${encodeURIComponent(location.pathname + location.search)}`, text: 'Sign in' })));
    }
    const res = await K.api('GET', `/api/me/batch-tests/${encodeURIComponent(batchTestId)}`);
    if (!res.ok) return K.mount(box, K.alert(res.status === 503 ? 'info' : 'bad', K.errMsg(res, "We couldn't load the test.")));
    const { test: t, batch, institute, mine } = res.data;
    const head = [h('h2', { text: `Scheduled test: ${t.modeName}` }),
      h('p', { class: 'muted', text: `For ${batch.name} at ${institute.name}. Open ${K.date(t.opensAt)}, ${hm(t.opensAt)} to ${hm(t.closesAt)}. ${t.minutes} minutes once you start typing.` }),
      t.note ? h('p', { text: t.note }) : null];
    let body;
    if (mine.result) {
      const r = mine.result;
      body = K.alert(r.passed ? 'ok' : 'info', `You took this test${mine.submittedAt ? ` at ${hm(mine.submittedAt)}` : ''}: ${t.mode === 'ssc-dest' ? `${fmt(r.correctStrokes)} correct key depressions` : t.mode === 'ssc-typing' ? `${fmt(r.strokes)} key depressions` : `${fmt(r.netWpm, 1)} net wpm`}, mistakes ${r.mistakesPct}%. ${r.passed ? 'Goal met.' : 'Goal not met yet.'} Your teacher can see it.`);
    } else if (t.state === 'upcoming') {
      body = h('div', null, h('p', { text: `It opens at ${hm(t.opensAt)} on ${K.date(t.opensAt)}. Come back then: this page shows a Start button when it opens.` }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: 'Check again', onclick: batchTest }));
    } else if (t.state === 'open') {
      const btn = h('button', { type: 'button', class: 'btn btn-primary', text: mine.starts ? 'Start again' : 'Start the test' });
      btn.addEventListener('click', async () => {
        K.busy(btn, true);
        const s = await K.api('POST', `/api/me/batch-tests/${encodeURIComponent(batchTestId)}/start`, {});
        K.busy(btn, false);
        if (!s.ok) { K.toast(K.errMsg(s), 'bad'); return batchTest(); }
        batchRun = true;
        begin(t.mode, t.passageId);
      });
      body = h('div', null,
        h('p', { text: `Everyone in your batch gets the same passage. The first result you submit after starting is the one that counts${mine.starts ? `; you have opened it ${mine.starts} time${mine.starts === 1 ? '' : 's'}, and your teacher sees that` : ''}. Start before ${hm(t.closesAt)}.` }),
        h('div', { class: 'actions' }, btn));
    } else {
      body = K.alert('info', t.state === 'cancelled' ? 'Your teacher cancelled this test.' : `This test closed at ${hm(t.closesAt)} on ${K.date(t.closesAt)}. You can still practise below.`);
    }
    K.mount(box, h('div', { class: 'card ex-batch-card' }, head, body));
  }

  $('exAgain').addEventListener('click', () => begin(M.id));
  $('exOther').addEventListener('click', backToChoice);
  history();
  batchTest();
  const want0 = K.qs('test');
  if (want0 && X.MODES[want0]) begin(want0);
})();
