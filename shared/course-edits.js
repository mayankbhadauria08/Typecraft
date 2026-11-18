/* Course edits made in the admin console (docs/ADMIN-PHASE-3.md §3), checked and applied the same
   way everywhere: the Worker (import './shared/course-edits.js' after course-meta.js and
   js/course.js, then read globalThis.TC_EDITS) and browsers (classic <script> after both).

   Edits: { lessons: { l7: { title, tip, keys, words: [..], sentences: [..] } },
            levels: { '2': { name, sub } }, units: { home: { name } },
            packs: { id: { added?, title, description, hidden?, exercises: [{ id, title, text, hidden? }] } },
            packOrder: [ids] }
   check(edits) → { ok, errors: [{ item, field, message }], edits: the same, cleaned }
   apply(edits) → puts lessons, levels and units onto TC_META and TC_COURSE, starting from the
   originals every time. Packs are the server's (src/course-store.js): apply() ignores them.

   The teaching rule (tests/check-lessons.mjs) holds for edited text too: a lesson's typed text
   may only use keys taught by that lesson or an earlier one. Titles, tips and names are only
   read, never typed, so any text without control characters is fine there. */
(function (root) {
  const META = root.TC_META;
  if (!META) throw new Error('course-edits.js needs course-meta.js first');
  const course = () => root.TC_COURSE || null;

  const LIMITS = { title: 60, tip: 300, keys: 400, word: 30, words: 200, sentence: 400, sentences: 12,
    levelName: 30, levelSub: 80, unitName: 40, packTitle: 60, packDesc: 300, exTitle: 80, exText: 6000, exercises: 60, packs: 30 };
  const UNITS = [...new Set(META.LESSONS.map((l) => l.unit))];
  const LESSON_FIELDS = ['title', 'tip', 'keys', 'words', 'sentences'];
  const PACK_ID = /^[a-z][a-z0-9-]{1,39}$/;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  // read-only text: no control characters, single spaces
  const plain = (s) => typeof s === 'string' && !/[\u0000-\u001f\u007f]/.test(s);
  const tidy = (s) => String(s).replace(/\s+/g, ' ').trim();
  // practice pack text is typed: printable ASCII, the rupee sign, and line breaks (typed with Enter)
  const typeable = (s) => /^[\x20-\x7e₹\n]*$/.test(s);

  /* ---------- which fields a lesson has ---------- */
  /** The fields this lesson can change, from the steps it has in the original course. */
  function fieldsOf(id) {
    const C = course(), m = META.BY_ID[id];
    if (!m) return [];
    const out = ['title'];
    if (!C) return out;
    const l = C.byId(id), steps = C.steps(origLesson(l));
    if (steps.indexOf('watch') !== -1) out.push('tip');
    if (steps.indexOf('character') !== -1) out.push('keys');
    if (m.kind !== 'boss' && m.kind !== 'intro' && !l.noWords) out.push('words', 'sentences');
    return out;
  }
  // the lesson as it was before any edits (steps depend on its word list)
  function origLesson(l) {
    if (!originals || !originals.course[l.id]) return l;
    const o = originals.course[l.id];
    return Object.assign({}, l, { wordDrill: o.wordDrill, paragraphDrill: o.paragraphDrill, paragraphs: o.paragraphs, charDrill: o.charDrill });
  }
  /** Keys this lesson may use in typed text, as a readable string. */
  function allowedOf(id) {
    const C = course(), l = C && C.byId(id);
    return l ? l.allowed : null;
  }
  const missingKeys = (text, allowed) => [...new Set([...text].filter((c) => !allowed.has(c)))];
  const keyList = (cs) => cs.map((c) => (c === ' ' ? 'space' : c)).join(' ');

  /* ---------- checking ---------- */
  function check(input) {
    const errors = [], out = {};
    const err = (item, field, message) => errors.push({ item, field, message });
    const e = isObj(input) ? input : {};
    const known = ['lessons', 'levels', 'units', 'packs', 'packOrder'];
    Object.keys(e).filter((k) => known.indexOf(k) === -1).forEach((k) => err(k, null, 'Unknown part of the course: ' + k + '.'));

    if (e.lessons !== undefined) {
      if (!isObj(e.lessons)) err('lessons', null, 'Lessons must be an object.');
      else {
        out.lessons = {};
        for (const id of Object.keys(e.lessons)) {
          const item = 'lesson:' + id, v = e.lessons[id];
          if (!META.BY_ID[id]) { err(item, null, 'There is no lesson ' + id + '.'); continue; }
          if (!isObj(v)) { err(item, null, 'A lesson’s changes must be an object.'); continue; }
          const can = fieldsOf(id), allowed = allowedOf(id), n = META.BY_ID[id].n, c = {};
          for (const f of Object.keys(v)) {
            if (LESSON_FIELDS.indexOf(f) === -1 || (course() && can.indexOf(f) === -1)) { err(item, f, 'Lesson ' + n + ' has no ' + f + ' to change.'); continue; }
            const x = v[f];
            if (f === 'title' || f === 'tip') {
              const max = LIMITS[f];
              if (!plain(x) || !tidy(x)) err(item, f, f === 'title' ? 'Give the lesson a title.' : 'Write the tip, or take it back to the original.');
              else if (tidy(x).length > max) err(item, f, 'Keep it under ' + max + ' characters.');
              else c[f] = tidy(x);
            } else if (f === 'keys') {
              const t = typeof x === 'string' ? tidy(x) : '';
              if (!t) err(item, f, 'Write the key drill, or take it back to the original.');
              else if (t.length > LIMITS.keys) err(item, f, 'Keep the key drill under ' + LIMITS.keys + ' characters.');
              else if (allowed && missingKeys(t, allowed).length) err(item, f, 'Uses keys lesson ' + n + ' has not taught yet: ' + keyList(missingKeys(t, allowed)) + '.');
              else c[f] = t;
            } else if (f === 'words') {
              if (!Array.isArray(x)) { err(item, f, 'Words must be a list.'); continue; }
              const words = [...new Set(x.map((w) => (typeof w === 'string' ? w.trim() : '')).filter(Boolean))];
              const bad = words.filter((w) => /\s/.test(w) || w.length > LIMITS.word);
              const keys = allowed ? missingKeys(words.join(''), allowed) : [];
              if (words.length > LIMITS.words) err(item, f, 'Keep it to ' + LIMITS.words + ' words or fewer.');
              else if (bad.length) err(item, f, 'One word per line, each under ' + LIMITS.word + ' characters: ' + bad[0].slice(0, 30) + '.');
              else if (keys.length) err(item, f, 'Uses keys lesson ' + n + ' has not taught yet: ' + keyList(keys) + '.');
              else c[f] = words;
            } else if (f === 'sentences') {
              if (!Array.isArray(x)) { err(item, f, 'Sentences must be a list.'); continue; }
              const lines = x.map((s) => (typeof s === 'string' ? tidy(s) : '')).filter(Boolean);
              const long = lines.find((s) => s.length > LIMITS.sentence);
              const keys = allowed ? missingKeys(lines.join(' '), allowed) : [];
              if (lines.length > LIMITS.sentences) err(item, f, 'Keep it to ' + LIMITS.sentences + ' passages or fewer.');
              else if (long) err(item, f, 'Keep each passage under ' + LIMITS.sentence + ' characters.');
              else if (keys.length) err(item, f, 'Uses keys lesson ' + n + ' has not taught yet: ' + keyList(keys) + '.');
              else c[f] = lines;
            }
          }
          if (Object.keys(c).length) out.lessons[id] = c;
        }
      }
    }
    if (e.levels !== undefined) {
      if (!isObj(e.levels)) err('levels', null, 'Levels must be an object.');
      else {
        out.levels = {};
        for (const k of Object.keys(e.levels)) {
          const item = 'level:' + k, v = e.levels[k], L = META.LEVELS.find((x) => String(x.n) === k);
          if (!L) { err(item, null, 'There is no level ' + k + '.'); continue; }
          if (!isObj(v)) { err(item, null, 'A level’s changes must be an object.'); continue; }
          const c = {};
          for (const f of Object.keys(v)) {
            if (f !== 'name' && f !== 'sub') { err(item, f, 'A level has no ' + f + ' to change.'); continue; }
            const max = f === 'name' ? LIMITS.levelName : LIMITS.levelSub;
            if (!plain(v[f]) || !tidy(v[f])) err(item, f, f === 'name' ? 'Give the level a name.' : 'Write the description, or take it back to the original.');
            else if (tidy(v[f]).length > max) err(item, f, 'Keep it under ' + max + ' characters.');
            else c[f] = tidy(v[f]);
          }
          if (Object.keys(c).length) out.levels[k] = c;
        }
      }
    }
    if (e.units !== undefined) {
      if (!isObj(e.units)) err('units', null, 'Modules must be an object.');
      else {
        out.units = {};
        for (const k of Object.keys(e.units)) {
          const item = 'unit:' + k, v = e.units[k];
          if (UNITS.indexOf(k) === -1) { err(item, null, 'There is no module ' + k + '.'); continue; }
          if (!isObj(v) || Object.keys(v).some((f) => f !== 'name')) { err(item, null, 'A module only has a name to change.'); continue; }
          if (v.name === undefined) continue;
          if (!plain(v.name) || !tidy(v.name)) err(item, 'name', 'Give the module a name.');
          else if (tidy(v.name).length > LIMITS.unitName) err(item, 'name', 'Keep it under ' + LIMITS.unitName + ' characters.');
          else out.units[k] = { name: tidy(v.name) };
        }
      }
    }
    if (e.packs !== undefined) {
      if (!isObj(e.packs)) err('packs', null, 'Practice packs must be an object.');
      else {
        out.packs = {};
        const ids = Object.keys(e.packs);
        if (ids.length > LIMITS.packs) err('packs', null, 'At most ' + LIMITS.packs + ' practice packs.');
        for (const id of ids) {
          const item = 'pack:' + id, v = e.packs[id];
          if (!PACK_ID.test(id)) { err(item, null, 'A pack ID uses lower-case letters, digits and hyphens.'); continue; }
          if (!isObj(v)) { err(item, null, 'A pack’s changes must be an object.'); continue; }
          const c = {};
          if (v.added) c.added = true;
          if (!plain(v.title) || !tidy(v.title)) err(item, 'title', 'Give the pack a title.');
          else if (tidy(v.title).length > LIMITS.packTitle) err(item, 'title', 'Keep the title under ' + LIMITS.packTitle + ' characters.');
          else c.title = tidy(v.title);
          if (v.description !== undefined && (!plain(v.description) || tidy(v.description).length > LIMITS.packDesc)) err(item, 'description', 'Keep the description under ' + LIMITS.packDesc + ' characters.');
          else c.description = tidy(v.description || '');
          c.hidden = v.hidden === true;
          if (!Array.isArray(v.exercises)) { err(item, 'exercises', 'Exercises must be a list.'); continue; }
          if (v.exercises.length > LIMITS.exercises) err(item, 'exercises', 'At most ' + LIMITS.exercises + ' exercises in a pack.');
          const seen = new Set();
          c.exercises = [];
          v.exercises.forEach((x, i) => {
            const at = 'exercises.' + i;
            if (!isObj(x)) return err(item, at, 'Exercise ' + (i + 1) + ' is not readable.');
            if (typeof x.id !== 'string' || !PACK_ID.test(x.id) || seen.has(x.id)) return err(item, at + '.id', 'Exercise ' + (i + 1) + ' needs its own ID: lower-case letters, digits and hyphens.');
            seen.add(x.id);
            const text = typeof x.text === 'string' ? x.text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim() : '';
            if (!plain(x.title) || !tidy(x.title)) return err(item, at + '.title', 'Give exercise ' + (i + 1) + ' a title.');
            if (tidy(x.title).length > LIMITS.exTitle) return err(item, at + '.title', 'Keep the title of exercise ' + (i + 1) + ' under ' + LIMITS.exTitle + ' characters.');
            if (!text) return err(item, at + '.text', 'Write the text of exercise ' + (i + 1) + '.');
            if (text.length > LIMITS.exText) return err(item, at + '.text', 'Keep exercise ' + (i + 1) + ' under ' + LIMITS.exText.toLocaleString('en-IN') + ' characters.');
            if (!typeable(text)) {
              const bad = [...new Set([...text].filter((ch) => !typeable(ch)))].slice(0, 5).join(' ');
              return err(item, at + '.text', 'Exercise ' + (i + 1) + ' uses characters a keyboard cannot type: ' + bad + '.');
            }
            c.exercises.push({ id: x.id, title: tidy(x.title), text, hidden: x.hidden === true });
          });
          out.packs[id] = c;
        }
      }
    }
    if (e.packOrder !== undefined) {
      if (!Array.isArray(e.packOrder) || e.packOrder.some((x) => typeof x !== 'string' || !PACK_ID.test(x))) err('packOrder', null, 'The pack order must be a list of pack IDs.');
      else out.packOrder = [...new Set(e.packOrder)];
    }
    return { ok: !errors.length, errors, edits: out };
  }

  /* ---------- applying (browsers) ---------- */
  let originals = null;
  function remember() {
    if (originals) return;
    const C = course();
    originals = {
      meta: Object.fromEntries(META.LESSONS.map((l) => [l.id, l.title])),
      levels: Object.fromEntries(META.LEVELS.map((L) => [L.n, { name: L.name, sub: L.sub }])),
      course: C ? Object.fromEntries(C.lessons.map((l) => [l.id, {
        title: l.title, tier: l.tier, note: l.watch ? l.watch.note : '', charDrill: l.charDrill, wordDrill: (l.wordDrill || []).slice(),
        paragraphDrill: l.paragraphDrill, paragraphs: l.paragraphs ? l.paragraphs.slice() : undefined,
      }])) : {},
    };
  }
  /** A module's name in the original course, from its lessons' tier label ("Beginner — Home Row" → "Home Row"). */
  function unitName(unit) {
    const C = course(), tier = C && C.TIER ? C.TIER[unit] : '';
    return tier ? tier.split('—').pop().trim() : unit;
  }
  function apply(input) {
    remember();
    const e = isObj(input) ? input : {};
    const lessons = isObj(e.lessons) ? e.lessons : {}, levels = isObj(e.levels) ? e.levels : {}, units = isObj(e.units) ? e.units : {};
    // levels
    META.LEVELS.forEach((L) => {
      const o = originals.levels[L.n], v = levels[String(L.n)] || {};
      L.name = typeof v.name === 'string' && v.name ? v.name : o.name;
      L.sub = typeof v.sub === 'string' && v.sub ? v.sub : o.sub;
    });
    // lesson titles in the course map
    META.LESSONS.forEach((l) => {
      const v = lessons[l.id] || {}, t = typeof v.title === 'string' && v.title ? v.title : originals.meta[l.id];
      l.title = t; if (META.BY_ID[l.id]) META.BY_ID[l.id].title = t;
    });
    const C = course();
    if (C) {
      C.lessons.forEach((l) => {
        const o = originals.course[l.id], v = lessons[l.id] || {};
        const str = (x) => typeof x === 'string' && x;
        const list = (x) => Array.isArray(x) && x.every((w) => typeof w === 'string') ? x : null;
        l.title = str(v.title) || o.title;
        if (l.watch) l.watch.note = str(v.tip) || o.note;
        l.charDrill = str(v.keys) || o.charDrill;
        l.wordDrill = list(v.words) ? v.words.slice() : o.wordDrill.slice();
        const sentences = list(v.sentences);
        l.paragraphDrill = sentences ? (sentences[0] || '') : o.paragraphDrill;
        l.paragraphs = sentences ? sentences.slice(1) : (o.paragraphs ? o.paragraphs.slice() : undefined);
        // the tier label: level name and module name, when either is renamed
        const lv = levels[String(l.level)], un = units[l.unit];
        if ((lv && lv.name) || (un && un.name)) {
          const prefix = o.tier.split('—')[0].trim();
          l.tier = (lv && lv.name ? lv.name : prefix) + ' — ' + (un && un.name ? un.name : unitName(l.unit));
        } else l.tier = o.tier;
      });
      if (C.resetCaches) C.resetCaches();
    }
  }

  root.TC_EDITS = { check, apply, fieldsOf, allowedOf, unitName, UNITS, LIMITS, LESSON_FIELDS };
})(typeof globalThis !== 'undefined' ? globalThis : window);
