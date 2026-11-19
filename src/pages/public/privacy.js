import { sellerBlock } from './legal-common.js';

// its own date: exam practice and certificate checks were added on this day (docs/EXAM-MODES.md)
const UPDATED = '19 November 2026';

export const meta = {
  path: '/privacy',
  title: 'Privacy policy',
  description: 'What TypeCraft collects, why, who processes it (Cloudflare, Razorpay, our email provider), how long it is kept, and your rights under Indian law.',
  changefreq: 'yearly',
  priority: '0.3',
};

export default `
<div class="container">
  <header class="page-head"><span class="eyebrow">Legal</span><h1>Privacy policy</h1>
    <p class="lede">We collect what's needed to teach you, keep your account safe and take payments. We don't sell data, show ads or use third-party trackers.</p>
    <p class="updated mono muted">Last updated: ${UPDATED}</p></header>
  <div class="prose" style="padding-bottom:40px">
    <h2>1. What we collect</h2>
    <ul>
      <li><b>Account details</b>: your name, email address, phone number and a securely hashed password (we never store the password itself).</li>
      <li><b>Learning data</b>: which lessons and games you completed, your speed, accuracy and errors, and per-key and letter-pair counts used by the coach. We store results and counts, not a recording of everything you type.</li>
      <li><b>Typing tests</b>: the length, speed, accuracy and error count of tests you take while signed in.</li>
      <li><b>Exam practice</b>: for tests you save, the test, the time used, and the counts of key depressions and mistakes. What you typed is marked and then discarded, not stored.</li>
      <li><b>Institutes</b>: if you join an institute's batch with its code, which institute and batch, when you joined and left, and that you confirmed you are 18 or older. If you help run an institute, your role there and the invitations you sent or received.</li>
      <li><b>Payments</b>: the plan, amount, status, dates and the payment reference from Razorpay. Card numbers, UPI PINs and bank logins go directly to Razorpay and never reach us.</li>
      <li><b>Messages</b>: what you send through the contact form or by email, and a record of the emails we send you (type, time, delivery status).</li>
      <li><b>Security data</b>: your IP address and browser type, used to limit repeated sign-in attempts and to tell you about sign-ins from a new device.</li>
    </ul>
    <h2>2. Why we use it</h2>
    <ul>
      <li>To run your account and save your progress across devices.</li>
      <li>To build your review drills, analytics and certificates.</li>
      <li>To let anyone you give a certificate code check that certificate: the check shows your name, the result and the date, and nothing else. You can stop sharing a certificate at any time on your Certificates page.</li>
      <li>If you are in an institute's batch: to show that institute's admins, and your batch's teachers, your name, email, course progress, speeds, accuracy, practice time, weak keys, exam practice results and certificates, so they can teach you. This stops when you leave the batch (you can, any time, from Plans), when the institute removes you, or when its term ends. Your progress stays in your own account. The institute is a separate organisation and uses what it sees under our <a href="/institute-terms">terms for institutes</a>. If your institute turns on its batch leaderboard, the other students in your batch see your first name and your best speed of the last 7 days.</li>
      <li>To take payments, activate plans and issue invoices, as required by law.</li>
      <li>To send account emails: verification codes, password resets, receipts, plan reminders and security alerts. Announcements are optional and you can turn them off in your account settings.</li>
      <li>To keep the service secure and to fix problems.</li>
    </ul>
    <h2>3. Who processes it for us</h2>
    <p>We use a small number of service providers, only for the purposes above:</p>
    <ul>
      <li><b>Cloudflare</b> hosts the website and its database.</li>
      <li><b>Razorpay</b> processes payments under its own privacy policy and Indian payment regulations.</li>
      <li><b>Our email provider</b> (Resend) delivers account and receipt emails.</li>
      <li><b>Google Fonts</b> serves the typefaces this site uses, so your browser contacts Google's servers to fetch them.</li>
    </ul>
    <p>Some of these providers may process data outside India. We don't share your data with anyone else unless the law requires it.</p>
    <h2>4. Cookies and local storage</h2>
    <p>We use one essential cookie to keep you signed in. Your browser also keeps your settings (theme, sound) and, for offline use, a copy of unsent progress in local storage. There are no advertising or analytics cookies.</p>
    <h2>5. How long we keep it</h2>
    <p>Account and learning data are kept until you delete your account. Payment records and invoices are kept for as long as Indian tax and accounting law requires, even after an account is deleted. Security logs are kept for a short period and then removed.</p>
    <h2>6. Your rights</h2>
    <p>Under the Digital Personal Data Protection Act, 2023 you can ask to see, correct or erase your personal data, and you can withdraw consent. You can export your learning data and delete your account yourself from Account settings, or write to us. If you are under 18, please use TypeCraft with the consent of a parent or guardian.</p>
    <h2>7. Security</h2>
    <p>Connections are encrypted (HTTPS), passwords are hashed, sessions can be signed out everywhere from your account, and admin access is limited and logged.</p>
    <h2>8. Grievances and contact</h2>
    <p>For any privacy question or complaint, write to <a href="mailto:{{support.email}}">{{support.email}}</a>. Our grievance officer is {{seller.legalName}}; we aim to respond within 30 days.</p>
    <h2>9. Changes</h2>
    <p>If we change this policy in a way that matters, we'll update the date above and tell signed-in users by email or on the site.</p>
    ${sellerBlock}
  </div>
</div>
`;
