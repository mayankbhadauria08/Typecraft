import { icon } from '../../layout.js';

// /get-the-app: installing TypeCraft on a computer (Chrome, Edge; Safari on a Mac).
// The Install button and the status line are wired by site/site.js ([data-install], [data-install-status]).
export const meta = {
  path: '/get-the-app',
  title: 'Get the TypeCraft app for your computer',
  description: 'Install TypeCraft on your Windows PC or Mac from Chrome or Edge: its own window, a place in the Start menu or Dock, and lessons that keep working offline.',
};

export default `
<div class="container">
  <header class="page-head">
    <span class="eyebrow">TypeCraft for your computer</span>
    <h1>Install TypeCraft on your computer.</h1>
    <p class="lede">TypeCraft runs in Chrome or Edge, and you can install it like an app: its own window, a place in your Start menu, taskbar or Dock, and lessons that keep working when the internet drops.</p>
    <div class="actions">
      <button type="button" class="btn btn-primary btn-lg" data-install hidden>${icon('download')}Install TypeCraft</button>
      <a class="btn btn-ghost btn-lg" href="/app">Open the trainer ${icon('arrowRight')}</a>
    </div>
    <div class="install-status" data-install-status data-state="manual" aria-live="polite">
      <p data-when="ready">${icon('check')}Click <b>Install TypeCraft</b>. It takes a few seconds, and you can remove it any time.</p>
      <p data-when="installed">${icon('check')}TypeCraft is installed on this computer. Open it from the Start menu, the taskbar or the Dock.</p>
      <p data-when="manual">${icon('info')}No install button? Follow the steps below for your browser.</p>
      <div data-when="phone" class="install-phone">
        <p>${icon('keyboard')}You're on a phone. TypeCraft needs a keyboard, so open it on your computer.</p>
        <button type="button" class="btn btn-primary btn-sm" data-share-link>${icon('send')}Send this link to my computer</button>
      </div>
    </div>
  </header>
</div>

<section class="section" style="padding-top:0" aria-labelledby="gta-what">
  <div class="container">
    <h2 id="gta-what" class="section-title">What you get</h2>
    <div class="grid-3">
      <div class="card"><span class="card-icon">${icon('monitor')}</span><h3>Its own window</h3><p>No tabs and no address bar: just your lessons, tests and games, so nothing pulls your attention away.</p></div>
      <div class="card"><span class="card-icon">${icon('grid')}</span><h3>One click to start</h3><p>TypeCraft sits in your Start menu, taskbar or Dock. Right-click its icon for <b>Continue learning</b>, <b>Arcade</b> and <b>Typing test</b>.</p></div>
      <div class="card"><span class="card-icon">${icon('refresh')}</span><h3>Keeps working offline</h3><p>Once you've signed in and opened the trainer, lessons and games work without internet. Your progress saves when you're back online.</p></div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="gta-how">
  <div class="container">
    <h2 id="gta-how" class="section-title">Install it yourself</h2>
    <div class="grid-3">
      <div class="card"><h3>Google Chrome</h3><p class="muted">Windows, Mac, Linux, Chromebook</p>
        <ol class="install-steps"><li>Open <a href="/app">typecrafttyping.in/app</a> and sign in.</li><li>Click the install icon at the right end of the address bar, or open the <b>⋮</b> menu and choose <b>Install TypeCraft</b> (in newer Chrome it's under <b>Cast, save, and share</b>).</li><li>Click <b>Install</b>.</li></ol></div>
      <div class="card"><h3>Microsoft Edge</h3><p class="muted">Windows, Mac</p>
        <ol class="install-steps"><li>Open <a href="/app">typecrafttyping.in/app</a> and sign in.</li><li>Click the app icon in the address bar, or open the <b>⋯</b> menu, then <b>Apps</b>, then <b>Install TypeCraft</b>.</li><li>Click <b>Install</b>.</li></ol></div>
      <div class="card"><h3>Safari on a Mac</h3><p class="muted">macOS Sonoma or later</p>
        <ol class="install-steps"><li>Open <a href="/app">typecrafttyping.in/app</a> and sign in.</li><li>Choose <b>File</b>, then <b>Add to Dock</b>.</li><li>Click <b>Add</b>.</li></ol>
        <p class="muted">Firefox can't install apps: use Chrome or Edge.</p></div>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="cta-band">
      <div><h2>Setting up a computer lab?</h2><p>Typing institutes and training centres can put TypeCraft on every lab PC. Tell us how many computers and students you have.</p></div>
      <div class="actions"><a class="btn btn-primary btn-lg" href="/contact?topic=institutes">Talk to us ${icon('arrowRight')}</a></div>
    </div>
  </div>
</section>
`;
