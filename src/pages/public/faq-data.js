// Questions and answers used by the FAQ page, the home and pricing teasers, and the
// FAQPage JSON-LD. Answers are trusted HTML written by us (links and <b> only).
// Prices are never written here: they live in the packages table (see /pricing).
import { esc, icon } from '../../layout.js';

export const FAQ = {
  learning: [
    ['I can already type with two fingers. Is this for me?',
      'Yes. Most people who come to TypeCraft can already type, just not without looking. Start with the <b>placement test</b>: it checks which keys you already know by touch and suggests where to begin, so you don\'t repeat what you can already do.'],
    ['How long does it take to learn touch typing?',
      'It depends on practice, not talent. Learners who do 15–20 minutes a day usually know every letter by touch after a few weeks. Speed comes after that, from steady practice. TypeCraft shows your daily speed and accuracy so you can see the change for yourself.'],
    ['What is in the course?',
      '78 lessons in 5 levels: the home row, the top row and numbers, the bottom row with capitals and symbols, a mastery level for speed and fluency, and optional Pro tracks (numpad, code, office writing and exam-style passages). Each level ends with a boss test.'],
    ['How does the coach work?',
      'Every keystroke you make in a lesson is counted per key and per letter pair. The coach looks for the keys you miss or hesitate on most, and builds short review drills from words full of those keys.'],
    ['Do I need to install anything?',
      'No. TypeCraft runs in your browser on any computer with a physical keyboard. Once loaded, lessons keep working if your internet drops, and your progress is sent when you are back online.'],
    ['Does it work on phones and tablets?',
      'You can read the site, manage your account and buy a plan on a phone. The lessons themselves need a physical keyboard, so use a computer, or a tablet with a keyboard attached.'],
  ],
  plans: [
    ['What do I get for free?',
      '{{free.Lessons}}, the placement test, the review drill, the Daily Challenge in the arcade, and 3 typing tests a day with 7 days of history. No card is needed and the free plan doesn\'t expire.'],
    ['What changes when I buy a plan?',
      'Every plan unlocks all 78 lessons and all 8 arcade games. Higher plans add unlimited typing tests, advanced analytics, custom practice, premium exercise packs, insights and certificates. The <a href="/pricing">pricing page</a> lists exactly what each plan includes.'],
    ['Is it a subscription? Will I be charged again automatically?',
      'No. Every plan is a one-time payment for a fixed period (or for good, with Lifetime). Nothing renews by itself. We send you a reminder a few days before a plan ends; to continue, you simply buy again.'],
    ['What happens if I buy while a plan is still active?',
      'The new period is added after your current one ends, so you never lose days you have paid for.'],
    ['How do I pay?',
      'Payments are handled by <b>Razorpay</b>, so you can pay with UPI, debit or credit cards, net banking or popular wallets. TypeCraft never sees or stores your card or bank details.'],
    ['Can I get a refund?',
      'Yes, within 7 days of your first purchase if you have used the course only lightly. Failed or duplicate charges are always refunded. The full rules are in our <a href="/refund-policy">refund and cancellation policy</a>.'],
    ['Do I get an invoice?',
      'Yes. Every payment creates an invoice you can view and print from your account at any time.'],
  ],
  account: [
    ['Is my progress saved?',
      'Yes. Lessons, stars, speed history and arcade scores are saved to your account as you practise, so you can continue on any computer by signing in.'],
    ['I forgot my password.',
      'Use <a href="/forgot-password">reset your password</a> and we\'ll email you a link. You can also sign in with a one-time code sent to your email.'],
    ['How do I delete my account?',
      'From Account settings you can delete your account and all of its learning data. Payment records and invoices are kept for as long as the law requires.'],
  ],
};

export const ALL_FAQ = [...FAQ.learning, ...FAQ.plans, ...FAQ.account];

/** <details> list for a set of questions. */
export function faqList(items) {
  return `<div class="faq">${items.map(([q, a]) => `<details><summary>${esc(q)}${icon('plus')}</summary><div class="answer"><p>${a}</p></div></details>`).join('')}</div>`;
}

const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
/** schema.org FAQPage for a set of questions. */
export function faqJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: strip(a) } })),
  };
}
