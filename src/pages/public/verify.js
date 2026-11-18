// /verify and /verify/:code — anyone can check a TypeCraft certificate code (docs/EXAM-MODES.md).
// The page script (site/js/verify.js) asks GET /api/certificates/:code. Not indexed: codes are private links.
export const meta = {
  path: '/verify', title: 'Check a certificate', ogTitle: 'Check a TypeCraft certificate',
  description: 'Check that a TypeCraft typing certificate is genuine: enter the code printed on it.',
  noindex: true, sitemap: false,
};
export const codeMeta = { ...meta, path: '/verify/:code' };

export default `
<div class="container narrow">
  <header class="page-head">
    <span class="eyebrow">Certificates</span>
    <h1>Check a certificate</h1>
    <p class="lede">Every TypeCraft certificate has a code of twelve letters and numbers, printed at the top. Enter it to see whose certificate it is and what it certifies.</p>
  </header>
  <form class="card verify-form" id="verifyForm" novalidate>
    <div class="field">
      <label for="verifyCode">Certificate code</label>
      <input id="verifyCode" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="ABCD-EFGH-JKLM" inputmode="text">
      <p class="hint">Letters and numbers; the dashes are optional.</p>
    </div>
    <div class="actions"><button type="submit" class="btn btn-primary" id="verifyBtn">Check</button></div>
  </form>
  <section id="verifyResult" aria-live="polite"></section>
  <p class="muted verify-small">TypeCraft certificates come from tests taken online without supervision. The holder chooses who gets the code and can stop sharing it at any time.</p>
</div>
`;
