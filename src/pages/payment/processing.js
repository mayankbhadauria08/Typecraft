// /payment/processing?order=<id> — bare page shown while the server confirms the payment.
export const meta = {
  path: '/payment/processing', title: 'Confirming your payment', description: 'Confirming your payment.',
  access: 'user', layout: 'bare', nav: 'plans', noindex: true,
};
export const body = `
<div class="container narrow pp-wrap">
  <div class="card pp-card" role="status" aria-live="polite">
    <div class="pp-spinner" aria-hidden="true"></div>
    <h1 id="pp-title">Confirming your payment…</h1>
    <p class="muted" id="pp-text">Please keep this page open. This usually takes a few seconds.</p>
    <div id="pp-extra"></div>
  </div>
</div>
<style>
.pp-wrap{min-height:80vh;display:grid;place-items:center;padding:2rem 1rem}
.pp-card{text-align:center;max-width:28rem;padding:2rem 1.5rem}
.pp-card h1{font-size:1.5rem;margin:1rem 0 .5rem}
.pp-spinner{width:44px;height:44px;margin:0 auto;border-radius:50%;border:3px solid var(--line);border-top-color:var(--teal);animation:ppSpin .9s linear infinite}
@keyframes ppSpin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.pp-spinner{animation-duration:3s}}
</style>
`;
export default body;
