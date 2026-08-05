# TypeCraft — monkeytype redesign, change record

Covers the redesign of the home page and the retheme of the whole app, plus the eight bug
and contrast fixes that went with it.

Merged into `main` via **PR #1** as `4c7e0f4`. Upstream base was `793c891`.

TypeCraft is a single-file app: everything below is one `index.html`.

To view it, double-click **`Launch TypeCraft.bat`**, which opens `index.html` in your default
browser. It resolves the page relative to its own location (`%~dp0`), so the folder can be
moved or renamed without breaking it.

---

## Commits

| SHA | Summary |
|---|---|
| `0ad5265` | Redesign home page in a monkeytype-style visual system; fix 4 UI bugs |
| `f57abd0` | Fix three UI defects found in first real-pixel verification pass |
| `e38a7d3` | Raise light-theme `--sub` to AA contrast |
| `4c7e0f4` | Merge pull request #1 |

---

## 1. The redesign (`0ad5265`)

Home page rebuilt in a monkeytype-style visual system, plus a full retheme onto a
**three-value token system** — `--bg` / `--sub` / `--text` plus a single `--accent` —
replacing the previous blue/slate card treatment. Older rules were remapped onto the new
palette via aliases (`--surface`, `--text-primary`, `--lv-*`) rather than being rewritten
one by one.

View switching was also restructured: the old three-element `display` juggling moved onto
a single `#homeView` wrapper.

## 2. Bug fixes in `0ad5265`

These four were found and fixed during the redesign, and verified statically at the time:

1. **Retry-overlay bug** — the results overlay did not reset correctly on retry.
2. **Missing `.overlay` CSS** — the rule was absent entirely, so the results scrim and
   centred card had no styling.
3. **Invisible `.finger` / `.thumb`** — the hand diagram elements rendered with no fill.
4. **Two dead-code paths** — `lesson.type !== 'code'` in `towText()` (always true), and the
   two-space `"space"` branch in `renderReviewPanel()` (unreachable, because
   `recordKeyResult()` skips spaces and newlines before they can reach it).

Items 2 and 3 were confirmed on real pixels in the later verification pass; see
`screenshots/results-dark.png` and `screenshots/lesson-dark.png`. Items 1 and 4 remain
verified by inspection only.

## 3. Bug fixes in `f57abd0`

Found by rendering every view for the first time — the redesign had until then only ever
been checked statically.

1. **Light-theme `--accent` was not carrying its role.** `#a17f0a` scored 3.14:1 on `--bg`
   and 2.76:1 on `--sub-alt`, where the dark theme's `#e2b714` gets 6.55:1. It was the only
   token that did not survive the theme flip, so accent text and primary buttons read as
   muted rather than emphasised. Changed to **`#665006`** — 6.43:1 / 5.64:1, and
   white-on-accent improves from 3.78:1 to 7.73:1.

2. **`#metroTyper` and `#towTyper` had no CSS at all.** Only `#typer` carried the
   invisible-overlay rule (`position:absolute; inset:0; opacity:0; …`). The Metronome and
   Tug-of-War modes reuse that markup, so each rendered a **default white browser textarea
   sitting on top of the dark UI**. Both were folded into the `#typer` selector, and into
   the 640px `font-size` rule alongside it.

3. **Fun-mode Play buttons did not line up.** The cards stretch to a shared height, but
   Space Invaders has no settings `<select>` above its button, so its Play sat roughly 50px
   higher than the other two. Fixed with `.fun-card .btn:last-child{margin-top:auto}`.

## 4. Contrast fix in `e38a7d3`

**Light-theme `--sub` raised from `#9a9a9a` to `#616161`** (2.34:1 → 5.15:1 on `--bg`,
2.05:1 → 4.52:1 on cards). Affected stat labels, tier filter items, card numbers and the
empty progress dots. The canvas WPM graph samples `--sub` for its gridlines and accuracy
line, so it picks the change up too, via the `paletteCache = null` reset in `applyTheme()`.

**Dark `--sub` was deliberately left failing at 2.17:1** — that is monkeytype's authentic
`serika dark` pairing, not a regression introduced here. The two themes now diverge on this
token on purpose. See `contrast-report.txt`.

---

## What was verified, and how

Verification was done by driving **headless Chrome** directly and screenshotting each view.

Verified on real pixels, both themes: home (empty and populated), tier filter, typing-coach
and problem-keys panels, lesson view, results overlay, fun-mode select, and all three arcade
games. Also the `openLesson → backToDashboard` round trip, asserted programmatically —
`homeView` `flex`, `lessonView` `none`, results hidden. That round trip and the `#homeView`
wrapper were the highest-risk part of the redesign; both are correct.

`index.html` also passes a JS parse check (`node --check` over the extracted `<script>`
blocks) and has balanced CSS braces (553 open / 553 close).

**No defects were found in the app's logic.** Two things that looked like bugs during
verification — a coach message rendering `undefined`, and permanently empty coach/problem-key
panels — were both caused by seeding test data in the wrong shape, not by the app.

### Reproducing the screenshots

```
chrome --headless=new --disable-gpu --no-sandbox --user-data-dir=<tmp>
  --hide-scrollbars --window-size=1440,900 --virtual-time-budget=6000
  --screenshot=<out.png> file:///<path>/index.html
```

To reach non-default states, copy `index.html` to a temp file and splice a `<script>` before
`</body>` that runs on `load`. Three gotchas, each of which produced a convincing fake bug:

- **Read and write the copy as explicit UTF-8.** Otherwise the emoji and em dashes
  double-encode into mojibake that looks like a font/rendering failure.
- **Neutralise animations** with `*{animation-duration:1ms !important; transition:none
  !important}`, or the screenshot catches `fadeSlideIn` mid-flight and the whole view looks
  half-transparent.
- **Use a fresh `--user-data-dir` per shot.** The app persists theme, progress and streak to
  `localStorage` for the `file://` origin, so a shared profile leaks state forward — this
  silently rendered every "dark" shot after the first light one in the *wrong theme*.

### Seeding state — the real data shapes

Guessing these is what produced the phantom bugs above.

| What | Shape |
|---|---|
| lesson ids | lowercase `l1` … `l24` (not `L1`) |
| progress | `progress[id] = {stars, bestWpm, bestAcc}` |
| key stats | `keyStats[ch] = {attempts, errors}` |
| bigram latency | `bigramLatency['a>b'] = {count, totalMs}` — note the `>` separator, and `totalMs` not `total` |
| error classes | `errorClasses = {adjacent, transposition, omission, other}` |

Problem keys only surface for `attempts >= 5 && errors > 0`. The typing coach stays silent
until `totalAnalyticsSamples() >= 15`.

---

## Screenshots

All generated from `e38a7d3`, at 1440px wide.

| File | View |
|---|---|
| `home-dark.png` / `home-light.png` | Home, populated — stats, coach, problem keys, lesson grid |
| `tier-filter.png` | Tier filter applied ("numbers") |
| `lesson-dark.png` / `lesson-light.png` | Lesson view, unfocused — hand diagram, focus keys |
| `results-dark.png` / `results-light.png` | Results overlay — stars, WPM graph, stats |
| `funmode-dark.png` / `funmode-light.png` | Arcade picker — note the levelled Play buttons |
| `game-space-invaders.png` | Space Invaders |
| `game-metronome.png` | Metronome Rhythm — note no white textarea |
| `game-tugofwar.png` | Tug-of-War — note no white textarea |

---

## Open items

- Dark `--sub` remains below AA by design (see above) — worth a conscious decision.
- The retry-overlay and dead-code fixes from `0ad5265` are verified by inspection, not pixels.
