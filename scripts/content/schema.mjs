/**
 * ARTICLE SCHEMA HELPERS
 * ---------------------------------------------------------------------------
 * A thin constructor so a thousand lines of content stay readable and so that
 * every article is forced to carry the fields that make it indexable: a
 * cluster (there are no orphan articles), a date, a description long enough to
 * be a real snippet, at least one fact table and at least two FAQ entries.
 *
 * The validation is deliberately loud. A page that reaches the generator
 * missing a description does not silently publish a blank snippet — it fails
 * the build, which is the only moment anyone is looking.
 */

import { CLUSTER_BY_ID } from './clusters.mjs';

const seen = new Set();

/**
 * Build one article page object in the shape scripts/gen-landing.mjs renders.
 *
 * @param {object} spec
 * @param {string} spec.slug        URL path without a leading slash.
 * @param {string} spec.cluster     Cluster id from clusters.mjs.
 * @param {'en'|'fa'} [spec.lang]
 * @param {string} spec.title       <title>; aim for 45–65 characters.
 * @param {string} spec.description Meta description; 90–160 characters.
 * @param {string} spec.h1
 * @param {string[]} spec.intro     Lede paragraphs rendered above the fold.
 * @param {Array<[string, string[]]>} spec.sections  [h2, paragraphs]
 * @param {Array<[string, string]>} spec.facts       "At a glance" rows.
 * @param {Array<{q: string, a: string}>} spec.faqs
 * @param {Array<[string, string]>} [spec.howTo]     Visible + marked-up steps.
 * @param {string} [spec.route]     In-app hash destination for the CTA.
 * @param {string} [spec.icon]
 * @param {string} [spec.date]      ISO publication date.
 * @param {string} [spec.updated]   ISO modification date.
 * @param {string} [spec.risk]      Page-specific risk statement.
 */
export function article(spec) {
  const {
    slug, cluster, lang = 'en', title, description, h1, intro, sections,
    facts, faqs, howTo, route, icon, date = '2026-10-05', updated, risk,
    ctaLabel, kind = 'article'
  } = spec;

  const where = `${lang}:${slug}`;
  const fail = (why) => { throw new Error(`[content] ${where}: ${why}`); };

  if (!slug) fail('missing slug');
  if (seen.has(slug)) fail('duplicate slug');
  seen.add(slug);

  const group = CLUSTER_BY_ID[cluster];
  if (!group) fail(`unknown cluster "${cluster}"`);
  if (lang === 'fa' && !slug.startsWith('fa/')) fail('Persian pages must live under fa/');
  if (lang === 'en' && slug.startsWith('fa/')) fail('English page under fa/');

  if (!title || title.length > 70) fail(`title must be 1–70 chars (got ${title?.length})`);
  if (!description || description.length < 80 || description.length > 168)
    fail(`description must be 80–168 chars (got ${description?.length})`);
  if (!h1) fail('missing h1');
  if (!Array.isArray(intro) || intro.length < 2) fail('needs at least two lede paragraphs');
  if (!Array.isArray(sections) || sections.length < 3) fail('needs at least three H2 sections');
  for (const [heading, paras] of sections) {
    if (!heading) fail('section without a heading');
    if (!Array.isArray(paras) || !paras.length) fail(`section "${heading}" has no paragraphs`);
  }
  if (!Array.isArray(facts) || facts.length < 3) fail('needs at least three facts');
  if (!Array.isArray(faqs) || faqs.length < 2) fail('needs at least two FAQ entries');

  const words = [...intro, ...sections.flatMap(([, p]) => p)].join(' ').split(/\s+/).length;
  if (lang === 'en' && words < 280) fail(`thin: only ${words} words of prose`);
  if (lang === 'fa' && words < 230) fail(`thin: only ${words} words of prose`);

  return {
    kind,
    slug,
    cluster,
    lang,
    dir: lang === 'fa' ? 'rtl' : 'ltr',
    icon: icon || group.icon,
    topic: group.topic,
    route: route || group.route,
    datePublished: date,
    dateModified: updated || date,
    title,
    description,
    h1,
    body: intro,
    sections,
    facts,
    faqs,
    ...(howTo ? { howTo } : {}),
    ...(risk ? { riskText: risk } : {}),
    ...(ctaLabel ? { ctaLabel } : {}),
    ...(lang === 'fa' ? { glanceLabel: 'یک نگاه کلی' } : {})
  };
}

/** Pair an English and Persian article for reciprocal hreflang. */
export const pair = (enSlug, faSlug) => [enSlug, faSlug];

/** Reset the duplicate-slug guard (used by unit tests only). */
export const __resetSlugGuard = () => seen.clear();
