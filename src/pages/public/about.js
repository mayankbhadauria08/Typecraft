import { icon } from '../../layout.js';

export const meta = {
  path: '/about',
  title: 'About TypeCraft',
  description: 'Why TypeCraft exists, how the course is built, and the principles behind it: teach the movement first, measure honestly, no ads.',
};

export default `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">About</span>
    <h1>Typing is a craft. It can be taught properly.</h1>
    <p class="lede">TypeCraft started from a simple frustration: most typing websites measure your speed but never teach you how to get faster. We wanted a course that teaches the movement first, patiently, and then helps you build speed on top of it.</p>
  </header>
</div>
<section class="section" style="padding-top:0">
  <div class="container split" style="align-items:start">
    <div class="prose">
      <h2 style="margin-top:0">What we built</h2>
      <p>A course of 78 lessons in five levels, from the first time your fingers find F and J to 10-minute exam-style passages. Every lesson follows the same rhythm: see the reach, practise the new keys slowly, mix them into real words, then try a short challenge.</p>
      <p>Behind the lessons is a coach. It counts every keystroke per key and per letter pair, notices what you miss or hesitate on, and turns that into review drills. Around the course is an arcade of eight small games, because practice you enjoy is practice you keep doing.</p>
      <h2>Who it's for</h2>
      <p>Students preparing for computer and typing tests, people starting office jobs, programmers who want to stop looking down, and anyone who types every day and suspects they could do it with less effort. Everything is written in plain English, and the exam tracks follow the style of Indian clerk and data-entry tests.</p>
      <h2>Who we are</h2>
      <p>TypeCraft is an independent, owner-run product from India. There are no investors to please and no advertising to sell, which is why it is paid for directly by the people who use it. If you write to us, a person reads it.</p>
    </div>
    <div class="stack">
      <div class="card"><span class="card-icon">${icon('target')}</span><h3>Teach, then measure</h3><p>Speed comes from accurate, relaxed movement. Lessons put accuracy first; speed targets come later in each level.</p></div>
      <div class="card"><span class="card-icon">${icon('shield')}</span><h3>Honest numbers</h3><p>Your speed, accuracy and history come from your own keystrokes. We don't publish testimonials or invented success rates.</p></div>
      <div class="card"><span class="card-icon">${icon('sparkle')}</span><h3>No ads, no tracking scripts</h3><p>The site carries no advertising and no third-party trackers. Plans are one-time payments that never renew on their own.</p></div>
    </div>
  </div>
</section>
<section class="section">
  <div class="container">
    <div class="cta-band">
      <div><h2>See it for yourself</h2><p>You can start free with {{free.lessons}}. Try them, and decide afterwards whether TypeCraft is for you.</p></div>
      <div class="actions"><a class="btn btn-primary btn-lg" href="/signup" data-auth-swap>Start free ${icon('arrowRight')}</a><a class="btn btn-ghost btn-lg" href="/contact">Contact us</a></div>
    </div>
  </div>
</section>
`;
