// Shared bits of the legal pages.
// OWNER TODO before going live (search the site for "placeholder" / "[Your"):
//  1. Admin → Settings → seller: legalName ("[Your full name] (sole proprietor)"), address
//     ("[Your address, City, State, PIN]"), phone; and GSTIN if you register for GST.
//  2. terms.js: the city whose courts have jurisdiction ("[Your city]").
//  3. refund-policy.js: the lesson count for the 7-day refund (REFUND_LESSON_LIMIT below).
//  4. terms.js / refund-policy.js: the notice period before a shutdown (SHUTDOWN_NOTICE_DAYS).
//  5. Read all three pages once with a lawyer or CA: they are a sensible starting point,
//     not legal advice.
export const UPDATED = '15 November 2026';
export const REFUND_DAYS = 7;
export const REFUND_LESSON_LIMIT = 10;      // lessons completed beyond the ones the Free plan includes
export const SHUTDOWN_NOTICE_DAYS = 30;
export const CITY = '<span class="placeholder">[Your city]</span>';

export const sellerBlock = `<div class="card" style="gap:6px">
  <h3>Who runs TypeCraft</h3>
  <p>TypeCraft is run by <b>{{seller.legalName}}</b>.</p>
  <p>Address: {{seller.address}}</p>
  <p>Email: <a href="mailto:{{seller.email}}">{{seller.email}}</a> · Phone: {{seller.phone}}</p>
</div>`;
