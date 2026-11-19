// Public pages registry (owner: the site part; docs/SAAS-CONTRACTS.md §8).
// Each entry: { meta, body, scripts, load?(env, ctx) → { data?, … }, jsonld?(ctx, loaded) }.
import { loadPackages } from '../site-data.js';
import { remember, PUBLIC_DATA_TTL } from '../memo.js';
import { ALL_FAQ, FAQ, faqJsonLd } from './public/faq-data.js';
import home, { meta as homeMeta } from './public/home.js';
import about, { meta as aboutMeta } from './public/about.js';
import features, { meta as featuresMeta } from './public/features.js';
import practice, { meta as practiceMeta } from './public/practice.js';
import typingTest, { meta as typingTestMeta } from './public/typing-test.js';
import examPractice, { meta as examPracticeMeta } from './public/exam-practice.js';
import verify, { meta as verifyMeta, codeMeta as verifyCodeMeta } from './public/verify.js';
import pricing, { meta as pricingMeta } from './public/pricing.js';
import faq, { meta as faqMeta } from './public/faq.js';
import contact, { meta as contactMeta } from './public/contact.js';
import privacy, { meta as privacyMeta } from './public/privacy.js';
import terms, { meta as termsMeta } from './public/terms.js';
import refund, { meta as refundMeta } from './public/refund-policy.js';

const organization = (ctx) => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'TypeCraft',
  url: ctx.siteUrl + '/',
  logo: ctx.siteUrl + '/icons/icon.svg',
  email: 'hello@typecrafttyping.com',
  contactPoint: [{ '@type': 'ContactPoint', contactType: 'customer support', email: 'hello@typecrafttyping.com', areaServed: 'IN', availableLanguage: ['en'] }],
});
const website = (ctx) => ({ '@context': 'https://schema.org', '@type': 'WebSite', name: 'TypeCraft', url: ctx.siteUrl + '/', inLanguage: 'en-IN' });

function productLd(ctx, loaded) {
  const list = (loaded && loaded.data && loaded.data.packages) || [];
  const offers = list.map((p) => ({
    '@type': 'Offer',
    name: p.name,
    description: p.description,
    price: (p.pricePaise / 100).toFixed(2),
    priceCurrency: p.currency || 'INR',
    availability: 'https://schema.org/InStock',
    url: ctx.siteUrl + (p.pricePaise > 0 ? '/checkout?plan=' + encodeURIComponent(p.id) : '/signup'),
    category: p.validityDays ? `${p.validityDays}-day access` : (p.pricePaise > 0 ? 'Lifetime access' : 'Free'),
  }));
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'TypeCraft touch typing course',
    description: '78 lessons in 5 levels, a coach for weak keys, typing tests, analytics and an arcade of 8 games.',
    brand: { '@type': 'Brand', name: 'TypeCraft' },
    url: ctx.siteUrl + '/pricing',
    ...(offers.length ? { offers } : {}),
  };
}
const packagesData = async (env) => { const d = await remember(env, 'packages', PUBLIC_DATA_TTL, () => loadPackages(env)); return d ? { data: d } : {}; };

export const PAGES = [
  { meta: homeMeta, body: home, scripts: ['/site/js/home.js'], load: packagesData, jsonld: (ctx) => [organization(ctx), website(ctx)] },
  { meta: aboutMeta, body: about, scripts: [] },
  { meta: featuresMeta, body: features, scripts: [] },
  { meta: practiceMeta, body: practice, scripts: [] },
  { meta: typingTestMeta, body: typingTest, scripts: ['/site/js/typing-test.js'] },
  { meta: examPracticeMeta, body: examPractice,
    scripts: ['/shared/exam-passages.js', '/shared/exam-rules.js', '/site/js/pages-kit.js', '/js/rewards-ui.js', '/site/js/exam-practice.js'] },
  { meta: verifyMeta, body: verify, scripts: ['/site/js/pages-kit.js', '/js/rewards-ui.js', '/site/js/verify.js'] },
  { meta: verifyCodeMeta, body: verify, scripts: ['/site/js/pages-kit.js', '/js/rewards-ui.js', '/site/js/verify.js'] },
  { meta: pricingMeta, body: pricing, scripts: ['/site/js/pricing.js'], load: packagesData, jsonld: (ctx, loaded) => [productLd(ctx, loaded), faqJsonLd(FAQ.plans)] },
  { meta: faqMeta, body: faq, scripts: [], jsonld: () => faqJsonLd(ALL_FAQ) },
  { meta: contactMeta, body: contact, scripts: ['/site/js/contact.js'] },
  { meta: privacyMeta, body: privacy, scripts: [] },
  { meta: termsMeta, body: terms, scripts: [] },
  { meta: refundMeta, body: refund, scripts: [] },
];
