/* Who may open which lesson: one set of rules for the Worker (import './shared/lesson-access.js',
   then read globalThis.TC_ACCESS) and the browser (classic <script>, after course-meta.js).
   docs/UNLOCK-RULES.md explains them.

   1. A plan's lessons (packages.limits.lessons):
        'all'                              every lesson
        'first5'                           the first five lessons in course order (the original Free)
        { levels: [1, 2], lessons: ['l40'] }  whole levels, plus single lessons from other levels
   2. Rules for everyone (platform_settings 'learning_rules', shown to browsers as `rules`):
        closed / open: { levels: [n], lessons: [id] }, and the progress rules:
        progress: { '2': 'open' | 'bosses' | 'all', ... '5': ... }, placement: true | false
   3. Order for one lesson: the placement test and the review drill are always open; then an
      exception for this learner (open or closed); then a rule for everyone on the lesson, then on
      its level; then the learner's plan. After that, the progress rules decide whether its level
      has opened yet (only the app applies those: see docs/UNLOCK-RULES.md §5). */
(function (root) {
  const META = root.TC_META;
  if (!META) throw new Error('lesson-access.js needs course-meta.js first');
  const ORDER = META.ORDER;
  const LEVELS = META.LEVELS.map((l) => l.n);
  const POS = Object.fromEntries(ORDER.map((id, i) => [id, i]));
  const BY_LEVEL = Object.fromEntries(LEVELS.map((n) => [n, META.LESSONS.filter((l) => l.level === n).map((l) => l.id)]));
  const BOSSES_OF = Object.fromEntries(LEVELS.map((n) => [n, META.LESSONS.filter((l) => l.level === n && l.kind === 'boss').map((l) => l.id)]));
  const FIRST5 = ORDER.slice(0, 5);
  const ALWAYS_OPEN = ['placement', 'review'];
  const MODES = ['open', 'bosses', 'all'];
  const isLevel = (n) => LEVELS.indexOf(n) !== -1;
  const isLesson = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(POS, id);
  const byOrder = (a, b) => POS[a] - POS[b];
  const levelOf = (id) => (META.BY_ID[id] ? META.BY_ID[id].level : null);

  /* ---------- a plan's lessons ---------- */
  /** Checks a plan's lessons value. → { ok: true, value } with the value in its shortest form, or { ok: false, error }. */
  function check(v) {
    if (v === 'all' || v === 'first5') return { ok: true, value: v };
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Lessons must be "all", "first5" or { levels, lessons }.' };
    const extra = Object.keys(v).filter((k) => k !== 'levels' && k !== 'lessons');
    if (extra.length) return { ok: false, error: `Unknown part of lessons: ${extra[0]}.` };
    const levels = v.levels === undefined ? [] : v.levels, lessons = v.lessons === undefined ? [] : v.lessons;
    if (!Array.isArray(levels) || levels.some((n) => !isLevel(n))) return { ok: false, error: `Levels must be numbers from 1 to ${LEVELS.length}.` };
    if (!Array.isArray(lessons) || lessons.length > ORDER.length || lessons.some((id) => !isLesson(id))) return { ok: false, error: 'Lessons must be known lesson IDs.' };
    const lv = [...new Set(levels)].sort((a, b) => a - b);
    if (lv.length === LEVELS.length) return { ok: true, value: 'all' };
    const ls = [...new Set(lessons)].filter((id) => lv.indexOf(levelOf(id)) === -1).sort(byOrder);
    return { ok: true, value: { levels: lv, lessons: ls } };
  }
  /** The lesson IDs a value covers, in course order (all of them for 'all'). A value that does not check counts as 'first5'. */
  function idsOf(v) {
    if (v === 'all') return ORDER.slice();
    if (v === 'first5') return FIRST5.slice();
    const c = check(v);
    if (!c.ok) return FIRST5.slice();
    if (c.value === 'all') return ORDER.slice();
    const set = new Set(c.value.lessons);
    for (const n of c.value.levels) for (const id of BY_LEVEL[n]) set.add(id);
    return [...set].sort(byOrder);
  }
  const covers = (v, id) => v === 'all' || idsOf(v).indexOf(id) !== -1;
  /** What two plans give together: the most generous of each. */
  function union(a, b) {
    if (a === 'all' || b === 'all') return 'all';
    if (a === undefined || a === null) return b === undefined || b === null ? 'first5' : b;
    if (b === undefined || b === null) return a;
    if (a === 'first5' && b === 'first5') return 'first5';
    const set = new Set(idsOf(a).concat(idsOf(b)));
    const levels = LEVELS.filter((n) => BY_LEVEL[n].every((id) => set.has(id)));
    return check({ levels, lessons: [...set] }).value;
  }

  /* ---------- words for a set of lessons ---------- */
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  function levelWords(lv) {
    if (lv.length === 1) return 'Level ' + lv[0];
    const run = lv.every((n, i) => i === 0 || n === lv[i - 1] + 1);
    if (run && lv.length > 2) return 'Levels ' + lv[0] + '–' + lv[lv.length - 1];
    return 'Levels ' + lv.slice(0, -1).join(', ') + ' and ' + lv[lv.length - 1];
  }
  /**
   * A plan's lessons in words. → { text: 'the first 5 lessons' (inside a sentence), Text: same with a capital,
   * short: 'First 5 lessons' (a label), count, all }
   */
  function describe(v) {
    const ids = idsOf(v), n = ids.length, cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const out = (text, short) => ({ text, Text: cap(text), short: cap(short), count: n, all: n === ORDER.length });
    if (n === ORDER.length) return out('all ' + n + ' lessons', 'all lessons');
    if (!n) return out('no lessons', 'no lessons');
    const set = new Set(ids);
    const full = LEVELS.filter((x) => BY_LEVEL[x].every((id) => set.has(id)));
    const inFull = full.reduce((s, x) => s + BY_LEVEL[x].length, 0);
    const prefix = ids.every((id, i) => POS[id] === i);
    if (full.length && inFull === n) return out(levelWords(full) + ' (' + plural(n, 'lesson', 'lessons') + ')', levelWords(full));
    if (prefix) return out(n === 1 ? 'the first lesson' : 'the first ' + n + ' lessons', n === 1 ? 'first lesson' : 'first ' + n + ' lessons');
    if (full.length) return out(levelWords(full) + ' and ' + plural(n - inFull, 'more lesson', 'more lessons') + ' (' + n + ' lessons)', plural(n, 'lesson', 'lessons'));
    return out(plural(n, 'lesson', 'lessons'), plural(n, 'lesson', 'lessons'));
  }

  /* ---------- rules for everyone ---------- */
  const DEFAULT_PROGRESS = Object.fromEntries(LEVELS.slice(1).map((n) => [String(n), 'open']));
  /** The rules for everyone as browsers see them, from any input (missing or broken parts become the defaults). */
  function cleanRules(r) {
    r = r && typeof r === 'object' ? r : {};
    const part = (x) => {
      x = x && typeof x === 'object' ? x : {};
      return {
        levels: Array.isArray(x.levels) ? [...new Set(x.levels.filter(isLevel))].sort((a, b) => a - b) : [],
        lessons: Array.isArray(x.lessons) ? [...new Set(x.lessons.filter(isLesson))].sort(byOrder) : [],
      };
    };
    const progress = {};
    for (const k of Object.keys(DEFAULT_PROGRESS)) progress[k] = r.progress && MODES.indexOf(r.progress[k]) !== -1 ? r.progress[k] : 'open';
    return { closed: part(r.closed), open: part(r.open), progress, placement: r.placement !== false };
  }
  const NO_RULES = cleanRules(null);

  /* ---------- one lesson ---------- */
  /**
   * May this learner open this lesson, before progress? ctx: { lessons: the plan's lessons value, all: true when
   * the plan has the 'lessons.all' feature, overrides: { allow: [ids], deny: [ids] } (exceptions for this learner),
   * rules: cleanRules(...) }.
   * → { open, why }: why is 'always', 'you-open', 'you-closed', 'all-open', 'all-closed', 'plan' or 'not-in-plan'.
   */
  function access(ctx, id) {
    if (ALWAYS_OPEN.indexOf(id) !== -1) return { open: true, why: 'always' };
    const o = ctx.overrides || {};
    if (Array.isArray(o.deny) && o.deny.indexOf(id) !== -1) return { open: false, why: 'you-closed' };
    if (Array.isArray(o.allow) && o.allow.indexOf(id) !== -1) return { open: true, why: 'you-open' };
    const r = ctx.rules || NO_RULES, lv = levelOf(id);
    if (r.closed.lessons.indexOf(id) !== -1) return { open: false, why: 'all-closed' };
    if (r.open.lessons.indexOf(id) !== -1) return { open: true, why: 'all-open' };
    if (lv && r.closed.levels.indexOf(lv) !== -1) return { open: false, why: 'all-closed' };
    if (lv && r.open.levels.indexOf(lv) !== -1) return { open: true, why: 'all-open' };
    if (ctx.all || covers(ctx.lessons === undefined ? 'first5' : ctx.lessons, id)) return { open: true, why: 'plan' };
    return { open: false, why: 'not-in-plan' };
  }
  /**
   * Has this lesson's level opened yet for this learner? ctx: { rules, overrides, done(id) → true when finished,
   * placementLevel: the level the placement test gave (or null), canOpen(id) → true when access() lets the
   * learner open it }. Only lessons the learner can open count towards a level.
   * → { open: true } or { open: false, level: the level to finish first, mode: 'bosses' | 'all', left: lessons still to finish }
   */
  function progress(ctx, id) {
    const lv = levelOf(id), r = ctx.rules || NO_RULES, o = ctx.overrides || {};
    if (!lv || lv === 1 || ALWAYS_OPEN.indexOf(id) !== -1) return { open: true };
    if (Array.isArray(o.allow) && o.allow.indexOf(id) !== -1) return { open: true };
    const mode = r.progress[String(lv)] || 'open';
    if (mode === 'open') return { open: true };
    if (r.placement && ctx.placementLevel && ctx.placementLevel >= lv) return { open: true };
    const prev = lv - 1, can = ctx.canOpen || (() => true);
    const pool = (mode === 'bosses' && BOSSES_OF[prev].length ? BOSSES_OF[prev] : BY_LEVEL[prev]).filter((x) => can(x));
    const left = pool.filter((x) => !ctx.done(x)).length;
    return left ? { open: false, level: prev, mode: mode === 'bosses' && BOSSES_OF[prev].length ? 'bosses' : 'all', left } : { open: true };
  }

  root.TC_ACCESS = {
    LEVELS, BY_LEVEL, BOSSES_OF, FIRST5, ALWAYS_OPEN, MODES, ORDER,
    check, idsOf, covers, union, describe, cleanRules, access, progress, levelOf, isLesson, isLevel,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
