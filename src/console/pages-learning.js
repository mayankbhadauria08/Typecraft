// The frames of the Learning operations pages built in Phase 3 (docs/ADMIN-PHASE-3.md).
// Listed into PAGES in ./pages.js. Course pages load the course itself (/shared/course-meta.js,
// /js/course.js, /shared/course-edits.js), so previews and checks are exactly what learners get.
import { esc } from '../layout.js';
import { icon } from './icons.js';
import { CONSOLE_BASE } from './config.js';
import { select, section, panel, lines, skeletonRows, recordFrame, listFrame } from './page-kit.js';

const COURSE = ['/shared/course-meta.js', '/js/course.js', '/shared/course-edits.js'];
const has = (me, k) => me.permissions.includes(k);
const draftNote = 'Changes are saved as drafts. Learners see them when they are published on the Courses page.';

function tableFrame(heads, n = 8) {
  return `<div class="table-panel">
<table class="list fold" id="list" aria-busy="true">
<thead><tr>${heads.map(([text, cls]) => `<th scope="col"${cls ? ` class="${esc(cls)}"` : ''}>${esc(text)}</th>`).join('')}</tr></thead>
<tbody id="listBody">${skeletonRows(n, heads.length)}</tbody>
</table>
</div>`;
}

/* ---------- Courses: publishing ---------- */
function courseBody(me) {
  const publish = has(me, 'course.publish');
  return `<div class="page-head"><h1>Courses</h1>
<p class="page-sub">TypeCraft has one course: touch typing in English, in 5 levels and 78 lessons. Change it on the Levels, Modules, Lessons and Exercises pages; every change waits here as a draft until it is published.</p></div>
<div id="courseNote"></div>
<div class="detail-grid">
<div class="detail-main">
${section('live', 'What learners have now', lines(2))}
<section class="block" aria-labelledby="draftsTitle"><div class="block-head"><h2 id="draftsTitle">Drafts waiting</h2><span class="panel-meta" id="draftsMeta"></span></div>
<div id="draftsBody">${lines(3)}</div>
${publish ? `<form id="publishForm" class="publish-form" novalidate hidden>
<div class="field" data-field="note"><label for="f-note">What changed</label><textarea id="f-note" name="note" rows="2" maxlength="300"></textarea>
<p class="hint">A few words for the version history. Learners do not see it.</p><p class="err" id="f-note-err" hidden></p></div>
<div class="form-actions"><button type="submit" class="btn btn-primary" id="publishBtn">Publish</button></div>
</form>` : ''}
</section>
${section('versions', 'Versions', lines(3), '<span class="panel-meta">Every published version is kept</span>')}
</div>
<aside class="detail-side" aria-label="The course">
${panel('course', 'The course', 4)}
</aside>
</div>`;
}

/* ---------- Lessons ---------- */
function lessonsBody() {
  return `<div class="page-head"><h1>Lessons</h1>
<p class="page-sub">All 78 lessons in course order. Open one to change its title, its tip and the text learners type. ${esc(draftNote)}</p></div>
<form class="toolbar" id="filters" role="search" aria-label="Find lessons">
<div class="search">${icon('search')}<label class="vh" for="q">Search lessons</label><input id="q" name="q" type="search" placeholder="Number or title" autocomplete="off" spellcheck="false" maxlength="60"></div>
${select('level', 'Level', [['', 'All levels']])}
${select('state', 'State', [['', 'All lessons'], ['edited', 'Changed from the original'], ['draft', 'With a draft']])}
<button type="button" class="btn-link" id="clearFilters" hidden>Clear filters</button>
</form>
<p class="list-meta" id="listCount" aria-live="polite">&nbsp;</p>
${tableFrame([['Lesson'], ['Level', 'col-wide'], ['Module', 'col-wide'], ['Steps', 'col-wide'], ['State', 'col-fit']])}`;
}

function lessonBody(me) {
  const edit = has(me, 'course.edit');
  const area = (name, label, rows, hint) => `<div class="field" data-field="${name}" hidden>
<label for="f-${name}">${esc(label)}</label><textarea id="f-${name}" name="${name}" rows="${rows}" spellcheck="false"${edit ? '' : ' readonly'}></textarea>
<p class="hint" id="f-${name}-hint">${esc(hint)}</p><p class="err" id="f-${name}-err" hidden></p></div>`;
  return recordFrame({
    back: ['Lessons', '/course/lessons'],
    missing: ['Lesson not found', 'There is no lesson with this ID.'],
    main: `<section class="block" aria-labelledby="editTitle"><div class="block-head"><h2 id="editTitle">Title and texts</h2><span class="panel-meta" id="keysNote"></span></div>
<form id="lessonForm" class="lesson-form" novalidate${edit ? '' : ' data-readonly'}>
<div class="field" data-field="title"><label for="f-title">Title</label><input id="f-title" name="title" type="text" maxlength="60" autocomplete="off"${edit ? '' : ' readonly'}>
<p class="hint" id="f-title-hint"></p><p class="err" id="f-title-err" hidden></p></div>
${area('tip', 'Tip on the Watch step', 2, 'What to do with the fingers. Shown, not typed.')}
${area('keys', 'Key drill (Keys step)', 2, 'Groups of keys, separated by spaces.')}
${area('words', 'Words (one per line)', 6, '')}
${area('sentences', 'Sentences (one passage per line)', 5, '')}
${edit ? `<div class="form-actions"><button type="submit" class="btn btn-primary" id="saveDraft">Save draft</button>
<button type="button" class="btn btn-quiet" id="discardDraft" hidden>Discard draft</button>
<button type="button" class="btn btn-quiet" id="toOriginal" hidden>Back to the original</button></div>` : ''}
</form></section>
${section('preview', 'Preview', lines(4), '<button type="button" class="btn-link" id="previewAgain">Show other examples</button>')}`,
    side: `${panel('about', 'About this lesson', 4)}
<section class="panel" aria-labelledby="keysTitle"><h2 id="keysTitle">Keys it may use</h2><div id="keysBody">${lines(2)}</div></section>`,
    sideLabel: 'About this lesson',
  });
}

/* ---------- Levels and Modules ---------- */
function levelsBody() {
  return `<div class="page-head"><h1>Levels</h1>
<p class="page-sub">The five levels of the course: their names and short descriptions. ${esc(draftNote)}</p></div>
${tableFrame([['Level'], ['Description', 'col-wide'], ['Lessons', 'num col-wide'], ['Speed target', 'num col-wide'], ['State', 'col-fit'], ['', 'col-act']], 5)}
<p class="hint">Speed targets decide crowns, including crowns already earned, so they are not changed here.</p>`;
}
function modulesBody() {
  return `<div class="page-head"><h1>Modules</h1>
<p class="page-sub">The parts of each level, like the home row or the numbers. A module's name shows above its lessons in the trainer. ${esc(draftNote)}</p></div>
${tableFrame([['Module'], ['Level', 'col-wide'], ['Lessons', 'num col-wide'], ['State', 'col-fit'], ['', 'col-act']], 8)}`;
}

/* ---------- Exercises: practice packs ---------- */
function exercisesBody(me) {
  const edit = has(me, 'course.edit');
  return `<div class="page-head page-head-row"><div><h1>Exercises</h1>
<p class="page-sub">The practice packs in the trainer: real-world texts like phone numbers, letters, code and exam passages, for plans with practice packs. ${esc(draftNote)}</p></div>
${edit ? `<button type="button" class="btn btn-quiet" id="newPack">${icon('package')}<span>New pack</span></button>` : ''}
</div>
${tableFrame([['Pack'], ['Exercises', 'num col-wide'], ['In the trainer', 'col-wide'], ['State', 'col-fit'], ['', 'col-act']], 5)}
<p class="hint">Learners see the packs in this order. A hidden pack, or one with no exercises shown, is not in the trainer.</p>`;
}
function exerciseBody(me) {
  const edit = has(me, 'course.edit');
  return recordFrame({
    back: ['Exercises', '/course/exercises'],
    missing: ['Pack not found', 'There is no practice pack with this ID.'],
    main: `<form id="packForm" class="pack-form" novalidate${edit ? '' : ' data-readonly'}>
<section class="block" aria-labelledby="packTitle"><div class="block-head"><h2 id="packTitle">The pack</h2></div>
<div class="field" data-field="title"><label for="f-title">Title</label><input id="f-title" name="title" type="text" maxlength="60" autocomplete="off"${edit ? '' : ' readonly'}>
<p class="err" id="f-title-err" hidden></p></div>
<div class="field" data-field="description"><label for="f-description">Description</label><textarea id="f-description" name="description" rows="2" maxlength="300"${edit ? '' : ' readonly'}></textarea>
<p class="hint">Shown on the pack's card in the trainer.</p><p class="err" id="f-description-err" hidden></p></div>
<label class="tick" for="f-hidden"><input type="checkbox" id="f-hidden" name="hidden"${edit ? '' : ' disabled'}><span><span class="tick-label">Hide this pack</span><span class="tick-hint">It stays here, but learners do not see it.</span></span></label>
</section>
<section class="block" aria-labelledby="exTitle"><div class="block-head"><h2 id="exTitle">Exercises</h2><span class="panel-meta" id="exMeta"></span></div>
<p class="hint">Learners type each text exactly: letters, digits, punctuation, the rupee sign and line breaks (typed with Enter).</p>
<ol class="exercise-list" id="exercises"></ol>
${edit ? `<button type="button" class="btn btn-quiet" id="addExercise">Add an exercise</button>` : ''}
<p class="err" id="f-exercises-err" hidden></p>
</section>
${edit ? `<div class="form-actions"><button type="submit" class="btn btn-primary" id="saveDraft">Save draft</button>
<button type="button" class="btn btn-quiet" id="discardDraft" hidden>Discard draft</button>
<button type="button" class="btn btn-quiet" id="toOriginal" hidden>Back to the original</button>
<button type="button" class="btn btn-quiet btn-quiet-danger" id="removePack" hidden>Remove this pack</button></div>` : ''}
</form>`,
    side: panel('about', 'About this pack', 4),
    sideLabel: 'About this pack',
  });
}

/* ---------- Student progress ---------- */
function progressBody() {
  return listFrame({
    title: 'Student progress',
    sub: 'How each learner is getting on: the level they are working on, lessons finished, speed and accuracy, and when they last practised. Staff accounts are left out.',
    label: 'Find learners',
    search: { label: 'Search learners', placeholder: 'Name or email' },
    filters: [
      select('level', 'Level', [['', 'All levels']]),
      select('activity', 'Practice', [['', 'Any practice'], ['active7', 'Practised in the last 7 days'], ['quiet30', 'Not for 30 days or more'], ['never', 'Never practised']]),
      select('stuck', 'Stuck', [['', 'Stuck or not'], ['1', 'Stuck on a lesson']]),
      select('sort', 'Sort', [['', 'Last practice first'], ['done', 'Most lessons finished'], ['speed', 'Fastest first'], ['name', 'Name']]),
    ].join('\n'),
    heads: [['Learner'], ['Working on', 'col-wide'], ['Lessons', 'num'], ['Best speed', 'num col-wide'], ['Accuracy', 'num col-wide'], ['Last practice', 'col-wide'], ['', 'col-fit']],
  });
}
function progressOneBody(me) {
  return recordFrame({
    back: ['Student progress', '/progress'],
    missing: ['Learner not found', 'There is no learner with this ID.'],
    main: [
      `<div class="figures" id="figures" aria-busy="true">${lines(2)}</div>`,
      section('days', 'Practice in the last 30 days', '<div id="daysChart">' + lines(3) + '</div>', '<span class="panel-meta">Minutes a day, in the learner\'s own days</span>'),
      section('lessons', 'Lessons', lines(6), '<span class="panel-meta" id="lessonsMeta"></span>'),
    ].join('\n'),
    side: [panel('about', 'Learner', 4), panel('keys', 'Weakest keys', 4), panel('placement', 'Placement test', 2)].join('\n'),
    sideLabel: 'About this learner',
  });
}

const tiles = (id, n) => `<div class="tiles" id="${id}">${Array.from({ length: n }, () => '<div class="tile" aria-hidden="true"><span class="skeleton"></span><span class="skeleton skeleton-wide"></span></div>').join('')}</div>`;
const block = (id, title, inner, meta = '') => `<section class="block" aria-labelledby="${id}Title"><div class="block-head"><h2 id="${id}Title">${esc(title)}</h2>${meta}</div><div id="${id}Body">${inner}</div></section>`;
function analyticsBody() {
  return `<div class="page-head">
<h1>Learning analytics</h1>
<p class="page-sub">How learners as a whole are getting on. Practice is counted over the period you pick, in India days; how far learners get, the hardest lessons, placement, speed and weak keys are counted since the start. Staff accounts are left out.</p>
</div>
<div class="dash-bar">
<div class="seg" role="group" aria-label="Period" id="rangePick">
<button type="button" data-range="7d" aria-pressed="false">Last 7 days</button><button type="button" data-range="30d" aria-pressed="true">Last 30 days</button><button type="button" data-range="90d" aria-pressed="false">Last 90 days</button>
</div>
<button type="button" class="btn btn-quiet btn-sm" id="refreshBtn">${icon('refresh')}<span>Refresh</span></button>
<span class="list-meta" id="dashUpdated" aria-live="polite"></span>
</div>
<div id="dash" aria-busy="true">
<section class="block" aria-labelledby="practiceTitle"><div class="block-head"><h2 id="practiceTitle">Practice</h2></div>${tiles('practiceTiles', 4)}</section>
${block('active', 'Learners who practised each day', `<div class="chart" id="activeChart">${lines(3)}</div>`)}
${block('levels', 'How far learners get', lines(5), '<span class="panel-meta" id="levelsMeta"></span>')}
${block('hardest', 'Hardest lessons', lines(5), '<span class="panel-meta" id="hardestMeta"></span>')}
<div class="dash-cols dash-cols-even">
${block('speed', 'Best speed', lines(4), '<span class="panel-meta">Learners, by their fastest lesson</span>')}
${block('placement', 'Placement test', lines(4), '<span class="panel-meta" id="placementMeta"></span>')}
</div>
${block('keys', 'Weakest keys across learners', lines(4), '<span class="panel-meta" id="keysMeta"></span>')}
</div>`;
}

export const LEARNING_PAGES = [
  { key: 'progress', path: '/progress', title: 'Student progress', crumbs: ['Learning operations', 'Student progress'],
    permission: 'progress.view', body: progressBody, scripts: ['progress.js'] },
  { key: 'progress', match: /^\/progress\/([\w-]{1,64})$/, names: ['id'], title: 'Learner progress', crumbs: ['Learning operations', ['Student progress', '/progress'], 'Learner'],
    permission: 'progress.view', body: progressOneBody, scripts: ['charts.js', 'progress-one.js'] },
  { key: 'analytics', path: '/learning-analytics', title: 'Learning analytics', crumbs: ['Learning operations', 'Learning analytics'],
    permission: 'analytics.view', body: analyticsBody, scripts: ['charts.js', 'analytics.js'] },
  { key: 'courses', path: '/course', title: 'Courses', crumbs: ['Learning operations', 'Courses'],
    permission: 'course.view', body: courseBody, scripts: ['course-kit.js', 'course-home.js'] },
  { key: 'lessons', path: '/course/lessons', title: 'Lessons', crumbs: ['Learning operations', 'Lessons'],
    permission: 'course.view', body: lessonsBody, scripts: ['course-kit.js', 'lessons.js'] },
  { key: 'lessons', match: /^\/course\/lessons\/(l\d{1,3})$/, names: ['id'], title: 'Lesson', crumbs: ['Learning operations', ['Lessons', '/course/lessons'], 'Lesson'],
    permission: 'course.view', body: lessonBody, scripts: [...COURSE, 'course-kit.js', 'lesson.js'] },
  { key: 'levels', path: '/course/levels', title: 'Levels', crumbs: ['Learning operations', 'Levels'],
    permission: 'course.view', body: levelsBody, scripts: ['course-kit.js', 'levels.js'] },
  { key: 'exercises', path: '/course/exercises', title: 'Exercises', crumbs: ['Learning operations', 'Exercises'],
    permission: 'course.view', body: exercisesBody, scripts: ['course-kit.js', 'exercises.js'] },
  { key: 'exercises', match: /^\/course\/exercises\/([a-z][a-z0-9-]{1,39})$/, names: ['id'], title: 'Practice pack', crumbs: ['Learning operations', ['Exercises', '/course/exercises'], 'Practice pack'],
    permission: 'course.view', body: exerciseBody, scripts: ['/shared/course-meta.js', '/shared/course-edits.js', 'course-kit.js', 'exercise.js'] },
  { key: 'course-modules', path: '/course/modules', title: 'Modules', crumbs: ['Learning operations', 'Modules'],
    permission: 'course.view', body: modulesBody, scripts: ['course-kit.js', 'levels.js'] },
];
