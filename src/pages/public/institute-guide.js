// /institute-guide — a one-page how-to for an institute's admin (docs/INSTITUTES.md §10).
export const meta = {
  path: '/institute-guide',
  title: 'Guide for institutes',
  ogTitle: 'TypeCraft for institutes: a guide for admins and teachers',
  description: 'How a coaching centre runs its batches on TypeCraft: accept the invitation, make batches, give students their code, follow progress and print certificates.',
  changefreq: 'monthly',
  priority: '0.5',
};

export default `
<div class="container">
  <header class="page-head"><span class="eyebrow">Institutes</span><h1>Guide for institutes</h1>
    <p class="lede">How a coaching centre runs its typing batches on TypeCraft, from the first login to printing certificates. It takes about ten minutes to set up.</p></header>
  <div class="prose" style="padding-bottom:40px">
    <h2>1. Get your seats</h2>
    <p>Tell us how many students you want to train and for how long: <a href="/contact?topic=institutes">write to us</a>. We agree the seats, the term and the price, you pay by bank transfer or UPI, and we switch your seats on. Your admin gets an email invitation.</p>
    <h2>2. Accept the invitation</h2>
    <p>Sign in, or create an account, with the email address the invitation went to, and confirm that address from the email we send. Then open <a href="/institute">Institute</a> and press Accept. Before we have your payment you can already prepare: make batches and invite teachers.</p>
    <h2>3. Make a batch for each class</h2>
    <p>On your institute's page press <b>New batch</b> and give it a name, like "Morning SSC batch". Each batch gets its own code of eight letters and numbers, and a link.</p>
    <h2>4. Invite your teachers</h2>
    <p>Under <b>Admins and teachers</b> press <b>Invite a teacher</b>. They accept the same way you did. Then, on each batch's page, tick the teachers who teach it. Teachers see only their batches; admins see all of them.</p>
    <h2>5. Give students the code</h2>
    <p>Share the batch's link on your class WhatsApp group, or write the code on the board. Students open <b>typecrafttyping.in/join</b>, sign in or create an account, confirm they are 18 or older, and join. Each student takes one seat. Give codes only to your own students; you can make a new code or switch joining off at any time.</p>
    <h2>6. Follow their progress</h2>
    <p>Each batch's page shows every student's lessons, level, best speed, accuracy, practice this week and weak keys. Press a name to see one student in detail. <b>Download CSV</b> gives you the same list as a spreadsheet for Excel or Google Sheets.</p>
    <h2>7. Print certificates</h2>
    <p>On a batch's page press <b>Print certificates</b>: one certificate a page, with your institute's name and a code anyone can check at <a href="/verify">typecrafttyping.in/verify</a>. In the print window choose your printer, or "Save as PDF" to send them by email.</p>
    <h2>8. When a batch finishes</h2>
    <p>Press <b>Archive the batch</b>. Its students are removed and their seats go back to you for the next batch. Students keep their own progress. To move one student to another batch, use <b>Move</b>.</p>
    <h2>9. More seats, or another year</h2>
    <p>Write to us before your last day. We add seats or move your last day on; your batches and history carry on.</p>
    <p>What your staff can see, and the rest of the rules, are in our <a href="/institute-terms">terms for institutes</a> and <a href="/privacy">privacy policy</a>.</p>
  </div>
</div>
`;
