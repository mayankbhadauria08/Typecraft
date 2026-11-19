// A package as the public sees it (GET /api/packages, and the pricing page's first paint in
// src/site-data.js). Which lessons it includes is given in words (`lessons`, from
// shared/lesson-access.js describe()), and as the first item of `features` so every list of
// features names it. The two lesson features themselves are left out: they only cover the
// "first five" and "every lesson" cases.
import '../shared/course-meta.js';
import '../shared/lesson-access.js';

const A = globalThis.TC_ACCESS;
const LESSON_FEATURES = ['lessons.first5', 'lessons.all'];
const parse = (text, def) => { try { const v = JSON.parse(text); return v == null ? def : v; } catch { return def; } };

/** The lessons value of a stored package: limits.lessons, or every lesson for an older package with the 'lessons.all' feature. */
export function lessonsOf(p) {
  const features = parse(p.features, []), limits = parse(p.limits, {});
  if (features.includes('lessons.all')) return 'all';
  const c = A.check(limits.lessons === undefined ? 'first5' : limits.lessons);
  return c.ok ? c.value : 'first5';
}

export function packageView(p, labels) {
  const lessonsValue = lessonsOf(p), words = A.describe(lessonsValue);
  const limits = { ...parse(p.limits, {}), lessons: lessonsValue };
  const features = parse(p.features, []).filter((k) => !LESSON_FEATURES.includes(k));
  return {
    id: p.id, name: p.name, description: p.description, pricePaise: p.price_paise, currency: p.currency, validityDays: p.validity_days,
    features: [{ key: 'lessons', label: words.Text }, ...features.map((key) => ({ key, label: labels[key] || key }))],
    lessons: { text: words.text, Text: words.Text, short: words.short, count: words.count, all: words.all },
    limits, highlight: !!p.highlight,
  };
}

/** The feature catalogue without the two lesson features (each package's `lessons` says that instead). */
export const catalogueView = (rows) => rows.filter((f) => !LESSON_FEATURES.includes(f.key));

/** What the Free plan includes, in words (describe()), read live: used by the site's wording and the welcome email. */
export async function freeLessons(env) {
  let value = 'first5';
  try {
    const row = env.DB ? await env.DB.prepare("SELECT features, limits FROM packages WHERE id = 'free'").first() : null;
    if (row) value = lessonsOf(row);
  } catch { /* the original Free */ }
  return { value, ...A.describe(value) };
}
