# Exam practice and verifiable certificates

Practice tests in the style of the government typing tests Indian learners prepare for, and a
code on every certificate that anyone can check on a public page.

## Status

| Step | What | Status |
| --- | --- | --- |
| 0 | This plan, migration 0008, shared rules and passages | built |
| 1 | Exam practice page and saving results | built |
| 2 | Certificate codes, verify page, Certificates page in the account | built |
| 3 | Codes on the certificates printed from the app | built |
| 4 | Tests, walk-through, docs, pull request | built |

## 1. Decisions

- **Three tests, English only** (Hindi comes with Hindi typing, later):

  | Test | Time | Passage | Backspace | Words | Passes when |
  | --- | --- | --- | --- | --- | --- |
  | SSC-style typing test (LDC, JSA, PA, SA) | 10 min | about 1,800 key depressions | allowed | only as many words as the passage | 1,750 key depressions typed (35 wpm) and mistakes 5% of the words or less |
  | SSC-style data entry test (DEO, DEST) | 15 min | about 2,250 key depressions | allowed | only as many words as the passage | 2,000 correct key depressions (8,000 an hour) |
  | CPCT-style English typing test (MP) | 15 min | two passages, about 4,000 key depressions | **off** | no limit | 30 net words a minute over the full 15 minutes |

  Sources: SSC's skill-test notices (master text on screen, about 1,750 key depressions in English,
  only as many words as the master text, arrow keys and Backspace allowed to correct), the SSC CHSL
  scheme (35 wpm English in 10 minutes = about 10,500 key depressions an hour; DEO 8,000 key
  depressions an hour, 15 minutes, 2,000 to 2,200 key depressions, judged on correct entry), and
  published CPCT guides (15 minutes English, 30 net wpm to qualify, Backspace disabled). SSC does not
  publish one error allowance; 5% is the strictest figure guides quote, so it is our bar.
- **Marking** follows the full and half mistake method Indian recruitment typing tests publish:
  - full mistake: a word left out, a wrong or misspelt word, an extra word (one per word at most);
  - half mistake: wrong capitals, wrong or missing punctuation, a missing space between two words or
    a space inside a word;
  - mistakes = full + half / 2; gross speed = key depressions / 5 / minutes; net speed = gross speed −
    mistakes / minutes; correct key depressions = the letters and spaces of the words typed right;
    mistakes % = mistakes / words of the passage reached × 100.
- **Practice, not the real thing.** Every page says these are practice tests in the style of the
  exams, not the exams' own software, and that each exam's notice has the final word. Certificates
  never name SSC or CPCT: they say "10-minute typing test with a set passage".
- **The server marks the test.** The browser sends what was typed and how long it took; the
  Worker scores it with the same shared rules and stores the numbers only, never the typed text.
  Impossible results (faster than 200 wpm, longer than the test) are refused.
  Lining the words up the best way takes a few milliseconds of CPU, and a free-plan Worker has 10 ms
  a request, so the browser does it and sends its path (one letter per step: M a word typed, O left
  out, X extra, J two words run together, S a word split). The Worker replays the path against the
  passage and the typing, refuses one that does not fit, and counts the mistakes itself, in about
  1 ms. A path cannot hide a mistake; a wrong path only costs more. Without a usable path the
  Worker uses its own quick path, which can count a mistake or two more in rare cases (a skipped
  line and a repeated line close together).
- **Certificate figures are rounded down** (41.6 net wpm shows as 41; 0.29% mistakes as 99% right),
  so a certificate never claims more than was typed.
- **Free for everyone.** Anyone can take a test; a free account saves results (20 a day).
- **Certificates:** every speed certificate from the course and every passed exam test gets a code
  (12 letters and digits, in three groups). Anyone can check a code at `/verify`; the page shows the
  holder's name, the result and the date, and says the test was taken online without supervision.
  The holder can stop sharing a certificate (the page then says the code can't be checked) and
  share it again. Printing stays a Premium feature, as today; the code and link work on every plan.

## 2. Data: `migrations/0008_exams.sql`

- `exam_results`: one row per saved attempt (the numbers, never the typed text).
- `certificate_codes`: `code` → `user_id`, `kind` ('level' | 'exam'), `ref` (the level, or the
  exam result's id), `shared`, `created_at`, `updated_at`. One code per certificate.

Before 0008 is applied: the exam page still works without saving ("not switched on yet"), the
verify page says checking isn't switched on yet, and the app prints certificates without a code.

## 3. Files

- `shared/exam-rules.js` (TC_EXAMS): the tests, the passages, `score(mode, passageId, typed, seconds)`.
- `src/exams.js`: `POST /api/exams/results`, `GET /api/exams/results`,
  `POST /api/exams/results/:id/certificate`, `GET /api/me/certificates`,
  `PUT /api/me/certificates/:code`, `GET /api/certificates/:code` (public).
- Pages: `/exam-practice` (public, in the site menu), `/verify` and `/verify/:code` (public, not
  indexed), `/account/certificates` (account menu). The app's account menu links to both, and its
  Progress screen shows each speed certificate's code (on the picture and as a link).
- `js/rewards-ui.js`: the certificate picture prints the code and where to check it.
- Privacy policy: two lines on exam results and certificate checks (its own date, 19 November 2026).
- Tests: `tests/exams.test.mjs`.

## 4. Going live

1. Bookmark, then apply `migrations/0008_exams.sql` (two new tables; no row changes). Never
   `wrangler d1 migrations apply`. **Done 19 Nov 2026** (bookmark in `docs/LAUNCH.md` §1f).
2. Merge. Learners see "Update ready, reload" once (`sw.js` typecraft-next-8).


Institutes (docs/INSTITUTES.md §9): the verify answer also carries `institute` (where the holder had a seat when they earned the certificate, or null), and the certificate picture prints "Trained at <institute>" when given one.
