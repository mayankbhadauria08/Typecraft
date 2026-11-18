# Admin console, Phase 3: Learning operations

The work order for Phase 3. Read `docs/ADMIN-CONSOLE.md` and `docs/ADMIN-PHASE-2.md` first: the
rules and conventions there hold here too.

Branch: `admin/phase-3`, started from `admin/unlock-rules` (Unlock conditions, PR #20, is the first
Phase 3 module). One pull request to `main` at the end. Nothing is merged, and nothing is applied to
the live database, without the owner's yes.

## Status

| Step | What | Status |
| --- | --- | --- |
| 0 | Plan, migration 0007, shared course-edit rules, public course edits, the app applies them | built |
| 1 | Lessons, Levels, Modules editors (drafts) | built |
| 2 | Courses: publish, history, go back to a version | built |
| 3 | Exercises: practice packs | built |
| 4 | Student progress | built |
| 5 | Learning analytics | not started |
| 6 | Full check, docs, pull request | not started |
| — | Unlock conditions | built (PR #20, `docs/UNLOCK-RULES.md`) |

## 1. Decisions

- **How much of the course is editable** (the owner did not choose; the recommended option was
  taken, and the owner was told): names, texts and practice packs. Per lesson: its title, the tip
  shown on its Watch step, its key drill, its own words and its written sentences. Per level: its
  name and short description. Per module (the course's units: home row, top row, ...): its name.
  Practice packs and their exercises: edit, add, hide, reorder. **Not** in Phase 3: creating new
  lessons or courses (a course builder, needed for Hindi later), and lesson speed targets.
- **Speed targets stay as they are.** A level's target decides crowns, in the app and when the
  server replays past practice (`shared/rewards-rules.js`). Changing it would add or take away
  crowns already earned. Kept for a later, separate change.
- **Draft, then publish** (the owner chose this). Saving makes a draft; publishing checks every
  draft and makes a new numbered version; every version is kept, and going back to one publishes
  a copy of it.
- **The teaching rule holds for edited text**: a lesson's text may only use keys taught by that
  lesson or an earlier one (`tests/check-lessons.mjs`). Drafts are checked as they are typed and
  again when published.

## 2. Rules

The Phase 2 rules (`docs/ADMIN-PHASE-2.md` §2) hold. In addition:

1. The course in code is the original. Published edits sit on top of it and can always be taken
   back to the original, item by item.
2. Premium texts (practice packs) never reach a browser without the `exercises.premium` check:
   the public course edits (`GET /api/course`) carry lessons, levels and modules only.
3. The app keeps working with no edits, with old cached edits and offline: edits it cannot read are
   ignored.

## 3. Data: `migrations/0007_course.sql`

- `course_drafts (item PRIMARY KEY, value JSON, updated_by, updated_at)`: one draft per item
  (`lesson:l7`, `level:2`, `unit:home`, `pack:numbers`). `{"reset": true}` means "back to the
  original".
- `course_releases (version PRIMARY KEY, edits JSON, items JSON, note, published_by,
  published_at)`: every published version. The live course is the highest version.

Edits (one JSON object):

```json
{ "lessons": { "l7": { "title": "...", "tip": "...", "keys": "eee iii ...", "words": ["..."], "sentences": ["..."] } },
  "levels":  { "2": { "name": "...", "sub": "..." } },
  "units":   { "home": { "name": "..." } },
  "packs":   { "numbers": { "title": "...", "description": "...", "hidden": false,
                            "exercises": [{ "id": "phones", "title": "...", "text": "...", "hidden": false }] },
               "my-pack": { "added": true, "title": "...", "description": "...", "exercises": [] } },
  "packOrder": ["numbers", "my-pack", "code"] }
```

`shared/course-edits.js` (`TC_EDITS`): `check(edits)` (the teaching rule, sizes) and
`apply(edits)` (onto `TC_META` and `TC_COURSE`, from the originals each time, so applying a newer
version never stacks on an older one). Used by the app, the console pages and the server.

## 4. Steps

- **Step 0.** This file; migration 0007; `shared/course-edits.js`; `GET /api/course` (public,
  60 s cache): `{ version, edits }` without packs, `{ version: 0, edits: {} }` before 0007; the app
  applies the cached edits at start and the current ones when they arrive (between lessons only);
  `sw.js` caches the new file.
- **Step 1.** Lessons (list, one lesson's editor with a preview of each step), Levels, Modules.
  Permissions `course.view`, `course.edit`.
- **Step 2.** Courses: drafts waiting, publish with a note (`course.publish`, password check),
  versions, go back, discard a draft.
- **Step 3.** Exercises: practice packs through the same drafts; `src/content.js` serves the
  published packs.
- **Step 4.** Student progress (`progress.view`): learners with their level, lessons done, best
  speed, accuracy, last practice and a "stuck" flag; one learner's lessons, weak keys and practice.
  Read only, from the tables practice already fills (no new table). Staff (admin_users and the
  OWNER_EMAILS accounts) are left out of the list. "Working on" = the level of the lesson after the
  furthest one finished, in course order; "stuck" = a lesson tried 5 times or more and not finished;
  a key counts as weak once it has been typed 20 times. Names come from the published course.
- **Step 5.** Learning analytics (`analytics.view`): active learners, practice time, how far
  learners get per level, hardest lessons, placement results, weak keys across learners.
- **Step 6.** Full check and pull request.

## 5. Going live

1. Bookmark, then apply `migrations/0007_course.sql` (adds two tables; changes no rows). Never
   `wrangler d1 migrations apply`.
2. Merge. Learners see "Update ready, reload" once.
