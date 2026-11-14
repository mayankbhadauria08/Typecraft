import { icon } from '../../layout.js';

export const meta = { path: '/404', title: 'Page not found', description: 'This page does not exist.', noindex: true };

export default `
<div class="container narrow" style="padding:clamp(56px,10vw,120px) 18px">
  <div class="stack" style="gap:16px;align-items:flex-start">
    <span class="eyebrow">Error 404</span>
    <h1>That key isn't on this keyboard</h1>
    <p class="lede">The page you were looking for doesn't exist, or it has moved. Check the address, or pick up from one of these.</p>
    <div class="actions"><a class="btn btn-primary" href="/">${icon('home')} Home</a><a class="btn btn-ghost" href="/practice">Typing practice</a><a class="btn btn-ghost" href="/contact">Contact us</a></div>
  </div>
</div>
`;
