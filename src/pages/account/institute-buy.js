// /institute/buy — a coaching centre buys seats online and becomes an institute, with the buyer as its admin
// (docs/INSTITUTES.md §15). Data: GET /api/institutes/buy; paying: site/js/institute-pay.js.
export const meta = {
  path: '/institute/buy', title: 'Buy seats for your institute', description: 'Buy TypeCraft seats for the students of your coaching centre.',
  access: 'user', layout: 'account', nav: 'institute', noindex: true,
};
export const body = `
<p><a class="back-link" href="/institute">Institute</a></p>
<div class="page-head">
  <h1>Buy seats for your institute</h1>
  <p class="lede muted" id="ib-lede">For coaching centres: each seat gives one student the paid plan for the term. You become the institute's admin.</p>
</div>
<div id="ib-note"><div class="skeleton" style="height:5rem"></div></div>
<div class="buy-grid" id="ib-main" hidden>
  <form class="card ins-form buy-form" id="ib-form" novalidate>
    <h2>Your institute</h2>
    <div class="field"><label for="ib-name">Institute name</label><input id="ib-name" name="name" maxlength="120" autocomplete="organization" required></div>
    <div class="field"><label for="ib-city">City</label><input id="ib-city" name="city" maxlength="80" autocomplete="address-level2"></div>
    <div class="field"><label for="ib-contactName">Contact person</label><input id="ib-contactName" name="contactName" maxlength="120" autocomplete="name"></div>
    <div class="field"><label for="ib-contactEmail">Contact email</label><input id="ib-contactEmail" name="contactEmail" type="email" maxlength="254" autocomplete="email" required>
      <p class="hint">Invoices and reminders go here, and to you.</p></div>
    <div class="field"><label for="ib-contactPhone">Contact phone</label><input id="ib-contactPhone" name="contactPhone" maxlength="30" autocomplete="tel" inputmode="tel"></div>
    <div class="field"><label for="ib-gstin">GSTIN</label><input id="ib-gstin" name="gstin" maxlength="15" autocapitalize="characters" spellcheck="false">
      <p class="hint">Optional. It goes on your invoice.</p></div>
    <h2>Seats and term</h2>
    <div class="field"><label for="ib-seats">Seats</label><input id="ib-seats" name="seats" type="number" inputmode="numeric" step="1" required>
      <p class="hint" id="ib-seats-hint">One student uses one seat. Remove a student who finished and the seat is free for the next one.</p></div>
    <fieldset class="field" id="ib-terms"><legend>Term</legend></fieldset>
    <div class="field"><div class="check"><input type="checkbox" id="ib-agree" name="agree"><label for="ib-agree">I have read and accept the <a href="/institute-terms" target="_blank" rel="noopener">terms for institutes</a>, and our students are 18 or older.</label></div></div>
  </form>
  <aside class="card buy-summary" aria-labelledby="ib-sum-h">
    <h2 id="ib-sum-h">Summary</h2>
    <dl class="buy-dl" id="ib-summary"></dl>
    <div id="ib-msg" aria-live="polite"></div>
    <button type="button" class="btn btn-primary" id="ib-pay" disabled>Pay</button>
    <p class="muted buy-small">Paid securely with Razorpay: UPI, cards or netbanking. Your seats switch on as soon as Razorpay confirms the payment, and the invoice comes by email. No automatic renewal.</p>
  </aside>
</div>
`;
export default body;
