# Unlock conditions: who can open which lesson

The owner decides which lessons learners can open, in three ways, all from the admin console:

1. **What each plan includes** (Packages, on each plan): every lesson, the first five, or chosen
   levels plus single lessons from other levels.
2. **Closed or open for everyone** (Unlock conditions): one lesson or a whole level closed for
   every learner (for example while it is being fixed), or open to every learner, Free too.
3. **Unlock by progress** (Unlock conditions): when each level opens, per level: from the start,
   after the previous level's boss(es) are beaten, or after every lesson of the previous level is
   finished. A placement test result can open its level and the ones before it (a switch).

Exceptions for one customer (Learning access, Phase 2) still work and win over all of these.

## 1. Which rule wins, for one lesson

1. The placement test and the review drill are always open.
2. An exception for this customer (open or closed).
3. A rule for everyone on this lesson, then on its level.
4. The customer's plan.
5. Then progress: has the lesson's level opened yet for this learner?

One file holds these rules: `shared/lesson-access.js` (`window.TC_ACCESS` in browsers,
`globalThis.TC_ACCESS` in the Worker). The server, the learner's app and the console all run it,
so they always agree.

## 2. Plans: `packages.limits.lessons`

| Value | Means |
| --- | --- |
| `'all'` | every lesson |
| `'first5'` | the first five lessons in course order (the original Free) |
| `{ levels: [1, 2], lessons: ['l40'] }` | whole levels, plus single lessons from other levels |

Choosing every level is stored as `'all'`. The two lesson features (`lessons.all`,
`lessons.first5`) only label the two standard cases: they are set from `limits.lessons` on every
save (`src/package-rules.js`) and are not offered as tick boxes in the console.

**Customers who already paid** keep the lessons their plan had when they bought it (their
subscription keeps a copy, `user_subscriptions.limits`), and also get any lessons the package
gains later (`src/entitlements.js` joins the copy with the package as it is now). Removing lessons
from a package therefore only changes what new buyers get. **Free** is read live: a change
reaches every free learner at once.

`GET /api/packages` describes each package's lessons in words (`lessons: { text, Text, short,
count, all }`, and as the first item of `features`); the two lesson features are left out of the
catalogue there. The current `/admin` (until Phase 6) gets the stored value and keeps a choice made
in the console unless someone picks "First 5" or "All" there.

## 3. Rules for everyone: `platform_settings` row `learning_rules`

No migration: the `platform_settings` table exists since 0003. Stored as JSON:

```json
{ "locks": [{ "scope": "level", "target": 3, "effect": "closed", "reason": "...", "by": "<user id>", "at": "<iso>" },
            { "scope": "lesson", "target": "l40", "effect": "open", "reason": "...", "by": "...", "at": "..." }],
  "progress": { "2": "bosses", "3": "open", "4": "all", "5": "open" },
  "placement": true }
```

No row, or a value that cannot be read, means no rules: everything follows the plans and every
level is open from the start (`src/learning-rules.js` cleans what it reads, so a bad value can only
mean fewer rules). At most 200 rules for everyone.

Browsers only ever see the projection, without reasons or staff ids: `{ closed: { levels, lessons },
open: { levels, lessons }, progress, placement }`, from `GET /api/learning-rules` (public, cached
60 seconds; the app without an account uses it) and as `rules` in `GET /api/me/entitlements`.

## 4. The console: Unlock conditions (`/admin/unlock`)

| Endpoint | Permission | Does |
| --- | --- | --- |
| `GET /api/console/unlock` | `unlock.view` | the course, what each plan includes per level, the rules for everyone (with reason, who, when), the progress rules |
| `POST /api/console/unlock/rules` | `unlock.manage` | `{ scope, target, effect: 'closed' \| 'open' \| 'plans', reason, updatedAt }`; `plans` removes the rule |
| `PUT /api/console/unlock/progress` | `unlock.manage` | `{ progress, placement, reason, updatedAt }` |

- `unlock.view`: Admin and Support by default. `unlock.manage`: Super Admin only by default (it can
  give lessons away to everyone), and it asks for the password again (sensitive).
- A reason (3–300 characters) is required; every change is in the activity log
  (`unlock.rule`, `unlock.progress`) with before and after.
- Every write sends the `updatedAt` the page was drawn from. If someone else saved in between, the
  answer is 409 `rules_changed` and the page reloads their change, so nobody overwrites anybody.

## 5. What is enforced where

- **The plan and the rules for everyone** are enforced on the server for every saved run
  (`POST /api/user/events`, `POST /api/user/progress/lesson-complete`): a lesson the learner may not
  open is refused, `plan_required` for the plan, `closed` ("This lesson is closed for now.") for a
  rule for everyone.
- **Progress** is shown and enforced by the app (locked cards, a sheet saying what opens the level,
  a note under the level's heading), not refused by the server. Progress made offline reaches the
  server later and in a batch, so refusing it there could lose real practice. Progress rules are a
  teaching choice, not something people pay for: the plan rules above still decide what is paid.
- Learners without an account (guest mode) get the rules for everyone and progress too; their plan
  is not checked (nothing is saved to a server for them).

## 6. Words on the site

What Free includes appears in the site's own words through tokens filled at render time
(`src/site.js` `fillFree`), across the whole page including structured data:
`{{free.lessons}}` ("the first 5 lessons"), `{{free.Lessons}}`, `{{free.badge}}` ("First 5 lessons
free") and `{{free.level1}}` … `{{free.level5}}` (a "Free" badge for a level on the practice page).
Pages use them on Home, Pricing, Practice, Features, About, Sign up, the FAQ and the refund policy;
the welcome email gets the same words. A plan's **description** is the owner's own text: the package
page says so when its lessons change.

## 7. Tests

`node --test tests/unlock-rules.test.mjs`: the shared rules, plans with chosen lessons, customers who
paid keeping what they bought, Free read live (server and site words), who may see and change the
rules, closed/open for everyone on the server, the public endpoint, the stale-page check, progress
rules, a broken stored value, and the console page.
