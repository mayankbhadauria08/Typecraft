// /institute-terms — the terms for institutes that buy seats (docs/INSTITUTES.md §10).
// OWNER TODO: read this with a lawyer or CA before the first institute signs: it is a sensible starting
// point, not legal advice. Prices, seats and the term of each institute are agreed in writing (its order
// or invoice); this page covers everything else.
import { UPDATED_INSTITUTES, CITY, sellerBlock } from './legal-common.js';

export const meta = {
  path: '/institute-terms',
  title: 'Terms for institutes',
  description: 'The terms for coaching centres and institutes that buy TypeCraft seats for their students: seats, payment, students, data and closing.',
  changefreq: 'yearly',
  priority: '0.3',
};

export default `
<div class="container">
  <header class="page-head"><span class="eyebrow">Legal</span><h1>Terms for institutes</h1>
    <p class="lede">For coaching centres and other organisations that buy TypeCraft seats for their students. They add to our <a href="/terms">terms of service</a>, which still apply to every account.</p>
    <p class="updated mono muted">Last updated: ${UPDATED_INSTITUTES}</p></header>
  <div class="prose" style="padding-bottom:40px">
    <h2>1. What you buy</h2>
    <ul>
      <li>A number of <b>seats</b> for a <b>term</b> (a first and a last day), at a price per seat, as written on your order or invoice. Each seat gives one student the plan named there, from the first day to the last day.</li>
      <li>A seat is used while a student is in one of your batches. When a student leaves or you remove them, the seat is free for another student. Seats can't be moved to another institute.</li>
      <li>You can add seats or renew for a new term at any time; the price for those is agreed when you ask.</li>
    </ul>
    <h2>2. Payment</h2>
    <ul>
      <li>You pay by bank transfer, UPI or another way we agree, before the term starts. Seats switch on when we have recorded your payment, not before.</li>
      <li>We give you a GST invoice when we are registered for GST; until then, a receipt.</li>
      <li>Refunds follow our <a href="/refund-policy">refund policy</a> unless your order says otherwise.</li>
    </ul>
    <h2>3. Your admins and teachers</h2>
    <ul>
      <li>Your institute's admin is the person whose email you gave us. They can invite other admins and teachers. Each person signs in with their own TypeCraft account; never share passwords.</li>
      <li>You are responsible for what your admins and teachers do in TypeCraft, and for removing anyone who leaves your institute.</li>
    </ul>
    <h2>4. Your students</h2>
    <ul>
      <li>Students join a batch with its code, using their own TypeCraft account. For now, institute seats are for students who are <b>18 or older</b>; each student confirms this when joining.</li>
      <li>Give batch codes only to your own students. Anyone with a code can take a seat; you can make a new code or switch joining off at any time.</li>
      <li>Tell your students that their admins and teachers will see their progress (section 5). A student can leave a batch at any time.</li>
    </ul>
    <h2>5. Data</h2>
    <ul>
      <li>While a student is in one of your batches, your admins see, and their batch's teachers see, the student's name, email, course progress, speeds, accuracy, practice time, weak keys, exam practice results and certificates.</li>
      <li>When the student leaves, is removed, or your term ends, that access stops. The student's account and progress stay theirs: they keep them after your term.</li>
      <li>Use what you see only to teach your students. Don't sell it or give it to anyone else. If you download a report, keep it safe and delete it when you no longer need it.</li>
      <li>We handle personal data as our <a href="/privacy">privacy policy</a> describes.</li>
    </ul>
    <h2>6. Certificates</h2>
    <p>Certificates show the result a student got in TypeCraft, the date, a code anyone can check, and your institute's name when the student had a seat with you then. They are results of tests taken online; they are not issued by any government body or exam board.</p>
    <h2>7. Pausing and closing</h2>
    <ul>
      <li>We may pause your institute if a payment isn't made, or if these terms or our terms of service are broken. While paused, seats don't give the plan and nobody can join; we tell your admin why.</li>
      <li>When your term ends and isn't renewed, seats stop giving the plan. Your batches and history stay, so a renewal carries on where you left off.</li>
      <li>Either of us can end the arrangement by writing to the other. Closing an institute is final: its admins and teachers lose access, and students keep their own accounts.</li>
    </ul>
    <h2>8. Law and disputes</h2>
    <p>These terms are governed by the laws of India. Disputes are first raised with us at <a href="mailto:{{support.email}}">{{support.email}}</a>; if they can't be settled, the courts at ${CITY} have jurisdiction.</p>
    ${sellerBlock}
  </div>
</div>
`;
