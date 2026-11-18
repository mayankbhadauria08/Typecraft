/* Exam practice (docs/EXAM-MODES.md): the tests, and how a test is marked. The same file marks a
   test in the browser (to show the result at once) and in the Worker (the result that is saved),
   so the two always agree. Load shared/exam-passages.js first; then read globalThis.TC_EXAMS.

   The browser has time to line the words up the best possible way (align()); a Worker request has
   about 10 ms of CPU on the free plan, so the browser sends its path along with the text, and the
   Worker only checks that the path really turns the passage into what was typed and counts the
   mistakes on it (replay()). A path can't hide a mistake: every step is checked. Without a path
   (or with a wrong one) the Worker uses a quick path of its own (alignFast()).

   Marking (the full and half mistake method published for Indian recruitment typing tests):
   - full mistake: a passage word left out, a wrong or misspelt word, an extra word (one per word);
   - half mistake: the right word with wrong capitals or punctuation, two words typed without the
     space between them, or a space typed inside a word;
   - mistakes = full + half / 2. Gross speed = key depressions / 5 / minutes; net speed = gross
     speed - mistakes / minutes; correct key depressions = letters and spaces of the words typed
     exactly right; mistakes % = mistakes / passage words reached x 100 (two decimals).
   The words are lined up with the passage first, so one skipped word does not make every word after
   it wrong. Whatever is left of the passage when time runs out is not a mistake. */
(function (root) {
  const P = root.TC_EXAM_PASSAGES;
  if (!P) throw new Error('exam-rules.js needs exam-passages.js first');

  const MODES = {
    'ssc-typing': {
      id: 'ssc-typing', name: 'SSC-style typing test', short: 'SSC typing', posts: 'LDC, JSA, PA and SA posts',
      minutes: 10, backspace: true, wordLimit: true, set: 'ssc',
      target: { strokes: 1750, mistakesPct: 5 },
      goal: '1,750 key depressions in 10 minutes (35 wpm), with mistakes at 5% of the words or less',
      certificate: '10-minute typing test with a set passage',
    },
    'ssc-dest': {
      id: 'ssc-dest', name: 'SSC-style data entry test', short: 'SSC data entry', posts: 'DEO posts and the DEST',
      minutes: 15, backspace: true, wordLimit: true, set: 'dest',
      target: { correctStrokes: 2000 },
      goal: '2,000 correct key depressions in 15 minutes (8,000 an hour)',
      certificate: '15-minute data entry test with a set passage',
    },
    'cpct': {
      id: 'cpct', name: 'CPCT-style English typing test', short: 'CPCT English', posts: 'the MP CPCT',
      minutes: 15, backspace: false, wordLimit: false, set: 'cpct',
      target: { netWpm: 30 },
      goal: '30 net words a minute over 15 minutes',
      certificate: '15-minute typing test with a set passage and no corrections',
    },
  };
  const ORDER = ['ssc-typing', 'ssc-dest', 'cpct'];

  // CPCT-style passages are two passages in a row, long enough for 15 fast minutes
  const PAIRS = [['c1', 's1', 'd2'], ['c2', 's2', 'd3'], ['c3', 's3', 'd1'], ['c4', 's4', 'd2']];
  const byId = {};
  P.ssc.concat(P.dest).forEach((p) => { byId[p.id] = p; });
  const SETS = {
    ssc: P.ssc,
    dest: P.dest,
    cpct: PAIRS.map(([id, a, b]) => ({ id, title: byId[a].title + ', then ' + byId[b].title.toLowerCase(), text: byId[a].text + ' ' + byId[b].text })),
  };
  function passages(mode) { const m = MODES[mode]; return m ? SETS[m.set] : []; }
  function passage(mode, id) { return passages(mode).find((p) => p.id === id) || null; }

  const MAX_TYPED = 30000;
  const TYPEABLE = /^[\x20-\x7e\n\r\t]*$/;
  const words = (text) => String(text || '').split(/\s+/).filter(Boolean);
  const bare = (w) => w.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  /** 'ok' | 'case' | 'punct' | 'wrong': how a typed word compares with the passage word */
  function compare(want, got) {
    if (want === got) return 'ok';
    if (bare(want) !== bare(got)) return 'wrong';
    if (!bare(want)) return 'punct';     // both only punctuation, but different
    return want.replace(/[^A-Za-z0-9]/g, '') === got.replace(/[^A-Za-z0-9]/g, '') ? 'punct' : 'case';
  }

  /* Lines the typed words up with the passage: the cheapest way, in mistakes, to turn the start of
     the passage (all of it with endFree false) into what was typed. A band around the diagonal keeps
     it to a few milliseconds: the typing may drift up to BAND words from the passage. → path | null */
  const BAND = 40;
  const OP = { NONE: 0, MATCH: 1, OMIT: 2, EXTRA: 3, MERGE: 4, SPLIT: 5 };
  function align(want, got, endFree = true) {
    const m = want.length, n = got.length, W = 2 * BAND + 1;
    const size = (n + 2) * W;
    // costs are counted in half mistakes (integers): a full mistake is 2, a half mistake 1
    const BIG = 0x3fffffff;
    const cost = new Int32Array(size).fill(BIG), good = new Int32Array(size), op = new Uint8Array(size), how = new Uint8Array(size);
    // cell of (i passage words, j typed words) used, or -1 outside the band
    const at = (i, j) => { const k = i - j + BAND; return k < 0 || k >= W || i > m ? -1 : j * W + k; };
    // each word's letters and digits, worked out once (comparing in the loop must stay cheap)
    const alnum = (w) => w.replace(/[^A-Za-z0-9]/g, '');
    const wA = want.map(alnum), gA = got.map(alnum), wB = wA.map((x) => x.toLowerCase()), gB = gA.map((x) => x.toLowerCase());
    const wL = new Int32Array(m), gL = new Int32Array(n);
    for (let i = 0; i < m; i++) wL[i] = want[i].length;
    for (let j = 0; j < n; j++) gL[j] = got[j].length;
    cost[at(0, 0)] = 0;
    for (let j = 0; j <= n; j++) {
      const lo = j - BAND > 0 ? j - BAND : 0, hi = j + BAND < m ? j + BAND : m, row = j * W - j + BAND;
      for (let i = lo; i <= hi; i++) {
        const k = row + i, c = cost[k];
        if (c === BIG) continue;
        const g = good[k];
        let t, cc, gg;
        // (i+1, j): leave out passage word i (same row, one step right in the band)
        if (i < m && i - j + 1 + BAND < W) {
          t = k + 1; cc = c + 2;
          if (cc < cost[t] || (cc === cost[t] && g > good[t])) { cost[t] = cc; good[t] = g; op[t] = 2; how[t] = 0; }
        }
        if (j === n) continue;
        // (i, j+1): an extra typed word (next row, one step left in the band)
        if (i - j - 1 + BAND >= 0) {
          t = k + W - 1; cc = c + 2;
          if (cc < cost[t] || (cc === cost[t] && g > good[t])) { cost[t] = cc; good[t] = g; op[t] = 3; how[t] = 0; }
        }
        if (i === m) continue;
        // (i+1, j+1): passage word i typed as typed word j. 0 ok, 1 case, 2 punct, 3 wrong
        const h = want[i] === got[j] ? 0 : wB[i] !== gB[j] ? 3 : !wB[i] ? 2 : wA[i] === gA[j] ? 2 : 1;
        t = k + W; cc = c + (h === 0 ? 0 : h === 3 ? 2 : 1); gg = h === 0 ? g + wL[i] + 1 : g;
        if (cc < cost[t] || (cc === cost[t] && gg > good[t])) { cost[t] = cc; good[t] = gg; op[t] = 1; how[t] = h; }
        // two passage words typed as one (i+2, j+1), or one word typed with a space inside (i+1, j+2)
        if (h === 3) {
          if (i + 1 < m && gL[j] === wL[i] + wL[i + 1] && i - j + 1 + BAND < W && got[j] === want[i] + want[i + 1]) {
            t = k + W + 1; cc = c + 1;
            if (cc < cost[t] || (cc === cost[t] && g > good[t])) { cost[t] = cc; good[t] = g; op[t] = 4; how[t] = 0; }
          }
          if (j + 1 < n && wL[i] === gL[j] + gL[j + 1] && i - j - 1 + BAND >= 0 && want[i] === got[j] + got[j + 1]) {
            t = k + 2 * W - 1; cc = c + 1;
            if (cc < cost[t] || (cc === cost[t] && g > good[t])) { cost[t] = cc; good[t] = g; op[t] = 5; how[t] = 0; }
          }
        }
      }
    }
    // everything typed is used; the rest of the passage is free (time ran out)
    let best = -1, bestI = 0;
    for (let i = endFree ? Math.max(0, n - BAND) : m; i <= Math.min(m, n + BAND); i++) {
      const k = at(i, n); if (k < 0 || cost[k] === BIG) continue;
      if (best < 0 || cost[k] < cost[best] || (cost[k] === cost[best] && good[k] > good[best])) { best = k; bestI = i; }
    }
    if (best < 0) return null; // drifted beyond the band: far too many mistakes to line up
    // walk back for the path: M a passage word typed (right or not), O left out, X extra, J two words
    // typed as one, S one word typed in two
    const ops = []; let i = bestI, j = n;
    while (i > 0 || j > 0) {
      const o = op[at(i, j)];
      if (o === OP.MATCH) { ops.push('M'); i--; j--; }
      else if (o === OP.OMIT) { ops.push('O'); i--; }
      else if (o === OP.EXTRA) { ops.push('X'); j--; }
      else if (o === OP.MERGE) { ops.push('J'); i -= 2; j--; }
      else if (o === OP.SPLIT) { ops.push('S'); i--; j -= 2; }
      else return null;
    }
    return ops.reverse().join('');
  }

  /* The same result, quickly: words typed exactly right are taken as they come; at a slip, the next
     place where three words in a row agree again is found through an index of the passage, and
     only the few words in between go through align(). A run with no such place left (typing that
     has lost the passage altogether) is compared word by word. */
  const K = 50, TAIL = 80;
  const straight = (di, dj) => 'M'.repeat(Math.min(di, dj)) + 'O'.repeat(Math.max(0, di - dj)) + 'X'.repeat(Math.max(0, dj - di));
  function alignFast(want, got) {
    const m = want.length, n = got.length;
    const index = new Map();
    for (let i = 0; i + 2 < m; i++) {
      const key = want[i] + ' ' + want[i + 1] + ' ' + want[i + 2];
      const at = index.get(key); if (at) at.push(i); else index.set(key, [i]);
    }
    let i = 0, j = 0;
    const out = [];
    while (j < n) {
      if (i < m && want[i] === got[j]) { out.push('M'); i++; j++; continue; }
      // the nearest place, from here, where three words agree again
      let best = null;
      for (let dj = 0; dj <= K && j + dj + 2 < n; dj++) {
        if (best && dj >= best.d) break;
        const at = index.get(got[j + dj] + ' ' + got[j + dj + 1] + ' ' + got[j + dj + 2]);
        if (!at) continue;
        for (const pos of at) {
          if (pos < i) continue;
          if (pos - i > K) break;
          if (!best || pos - i + dj < best.d) best = { i2: pos, j2: j + dj, d: pos - i + dj };
          break;
        }
      }
      if (best) {
        out.push(align(want.slice(i, best.i2), got.slice(j, best.j2), false) || straight(best.i2 - i, best.j2 - j));
        i = best.i2; j = best.j2; continue;
      }
      // no place to meet again: the end of what was typed
      const tail = n - j <= TAIL ? align(want.slice(i, Math.min(m, i + (n - j) + BAND)), got.slice(j), true) : null;
      out.push(tail !== null ? tail : straight(Math.min(m - i, n - j), n - j));
      break;
    }
    return out.join('');
  }

  /** Counts the mistakes along a path (from align() or alignFast(), or sent by a browser), checking
      that it really turns the start of the passage into what was typed. → null when it does not. */
  function replay(want, got, path) {
    if (typeof path !== 'string' || path.length > 4 * (want.length + got.length) + 10) return null;
    const m = want.length, n = got.length, list = [];
    let i = 0, j = 0, full = 0, half = 0, good = 0;
    for (let k = 0; k < path.length; k++) {
      const o = path[k];
      if (o === 'M') {
        if (i >= m || j >= n) return null;
        const h = compare(want[i], got[j]);
        if (h === 'ok') good += want[i].length + 1;
        else { if (h === 'wrong') full++; else half++; list.push({ at: i, kind: h, want: want[i], got: got[j] }); }
        i++; j++;
      } else if (o === 'O') {
        if (i >= m) return null;
        full++; list.push({ at: i, kind: 'missing', want: want[i], got: '' }); i++;
      } else if (o === 'X') {
        if (j >= n) return null;
        full++; list.push({ at: i, kind: 'extra', want: '', got: got[j] }); j++;
      } else if (o === 'J') {
        if (i + 1 >= m || j >= n || got[j] !== want[i] + want[i + 1]) return null;
        half++; list.push({ at: i, kind: 'space', want: want[i] + ' ' + want[i + 1], got: got[j] }); i += 2; j++;
      } else if (o === 'S') {
        if (i >= m || j + 1 >= n || want[i] !== got[j] + got[j + 1]) return null;
        half++; list.push({ at: i, kind: 'space', want: want[i], got: got[j] + ' ' + got[j + 1] }); i++; j += 2;
      } else return null;
    }
    if (j !== n) return null;
    return { reached: i, full, half, correctStrokes: good, list, path };
  }

  /** The fewest mistakes found: the path sent (checked), the quick path, and with optimal the full
      alignment as well (browsers have the time for it; the Worker does not, and checks a path instead). */
  function mark(want, got, opts) {
    const o = opts || {};
    if (!got.length) return { reached: 0, full: 0, half: 0, correctStrokes: 0, list: [], path: '' };
    // a path from the browser is used as it stands once checked: the browser already kept the
    // cheapest of its paths, and any path that really fits costs at least the fewest mistakes
    if (o.path) { const r = replay(want, got, o.path); if (r) return r; }
    const tries = [replay(want, got, alignFast(want, got))];
    if (o.optimal) { const p = align(want, got, true); if (p !== null) tries.push(replay(want, got, p)); }
    let best = null;
    for (const t of tries) {
      if (!t) continue;
      const c = t.full * 2 + t.half;
      if (!best || c < best.c || (c === best.c && t.correctStrokes > best.t.correctStrokes)) best = { c, t };
    }
    return best.t;
  }

  const r1 = (x) => Math.round(x * 10) / 10, r2 = (x) => Math.round(x * 100) / 100;
  /**
   * Marks one attempt. typed: the text as typed; seconds: the time used.
   * → { ok: true, ... } or { ok: false, field, message }
   */
  function score(mode, passageId, typed, seconds, opts) {
    const M = MODES[mode];
    if (!M) return { ok: false, field: 'mode', message: 'Unknown test.' };
    const p = passage(mode, passageId);
    if (!p) return { ok: false, field: 'passageId', message: 'Unknown passage.' };
    if (typeof typed !== 'string' || typed.length > MAX_TYPED || !TYPEABLE.test(typed)) return { ok: false, field: 'typed', message: 'The typed text has characters the test does not use.' };
    const limit = M.minutes * 60;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 1 || seconds > limit + 5) return { ok: false, field: 'seconds', message: `The time must be from 1 second to ${M.minutes} minutes.` };
    const secs = Math.min(seconds, limit);
    const want = words(p.text), got = words(typed);
    const text = typed.replace(/\r/g, '').replace(/[\n\t]/g, ' ').replace(/\s+$/, '');
    const strokes = text.length;
    const a = mark(want, got, opts);
    const minutes = secs / 60;
    const mistakes = a.full + a.half / 2;
    const gross = strokes / 5 / minutes;
    const net = Math.max(0, gross - mistakes / minutes);
    const correct = Math.min(a.correctStrokes, strokes);
    const pct = a.reached ? (100 * mistakes) / a.reached : 0;
    const finished = a.reached >= want.length;
    const full = finished || secs >= limit - 2;          // the whole test was taken
    const T = M.target;
    let passed;
    if (T.strokes) passed = strokes >= T.strokes && pct <= T.mistakesPct;
    else if (T.correctStrokes) passed = correct >= T.correctStrokes;
    else passed = full && net >= T.netWpm;
    return {
      ok: true, mode, passageId, seconds: r1(secs), minutes: M.minutes, strokes, correctStrokes: correct,
      words: a.reached, passageWords: want.length, typedWords: got.length, finished,
      full: a.full, half: a.half, mistakes, mistakesPct: r2(pct),
      grossWpm: r1(gross), netWpm: r1(net), kdph: Math.round((correct * 60) / minutes),
      accuracy: strokes ? r1((100 * correct) / strokes) : 0,
      passed: !!passed, list: a.list, path: a.path,
    };
  }

  /** How far the result is from the goal, in words (for the result card). */
  function verdict(res) {
    const M = MODES[res.mode], T = M.target;
    if (res.passed) return { passed: true, text: 'You met the goal: ' + M.goal + '.' };
    if (T.strokes) {
      if (res.strokes < T.strokes) return { passed: false, text: 'Not enough typed: ' + res.strokes.toLocaleString('en-IN') + ' of the ' + T.strokes.toLocaleString('en-IN') + ' key depressions needed in ' + M.minutes + ' minutes.' };
      return { passed: false, text: 'Speed reached, but mistakes were ' + res.mistakesPct + '% of the words. Aim for ' + T.mistakesPct + '% or less.' };
    }
    if (T.correctStrokes) return { passed: false, text: res.correctStrokes.toLocaleString('en-IN') + ' correct key depressions of the ' + T.correctStrokes.toLocaleString('en-IN') + ' needed.' };
    if (res.netWpm >= T.netWpm) return { passed: false, text: 'Fast enough, but the test was stopped early. Type for the full ' + M.minutes + ' minutes to pass.' };
    return { passed: false, text: 'Net speed ' + res.netWpm + ' wpm, below the ' + T.netWpm + ' wpm needed.' };
  }

  root.TC_EXAMS = { MODES, ORDER, passages, passage, words, compare, align, alignFast, replay, mark, score, verdict, MAX_TYPED, BAND };
})(typeof globalThis !== 'undefined' ? globalThis : window);
