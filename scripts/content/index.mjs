/**
 * CONTENT ENTRY POINT
 * ---------------------------------------------------------------------------
 * Collects every authored article, builds the cluster hub pages around them,
 * and hands scripts/gen-landing.mjs three things:
 *
 *   CONTENT_PAGES       page objects, ready to push into PAGES
 *   CONTENT_ALTERNATES  [enSlug, faSlug] pairs for reciprocal hreflang
 *   CLUSTER_INDEX       cluster id -> { hub, spokes } per language, used by
 *                       render() to build cluster-aware sibling links
 *
 * Two invariants are enforced here rather than left to review, because both
 * are silent failures that only show up in Search Console weeks later:
 *
 *  1. NO ORPHANS. Every article names a cluster, every cluster emits a hub for
 *     each language that has spokes, and the hub links to all of them. An
 *     article whose cluster has no hub in its language is a build error.
 *
 *  2. NO ONE-WAY HREFLANG. A pair is only emitted when BOTH pages exist. A
 *     declared alternate pointing at a 404 is worse than no annotation at all.
 */

import { CLUSTERS, CLUSTER_BY_ID } from './clusters.mjs';
import { HUB_COPY } from './hubs.mjs';

import enSwap from './en/swap.mjs';
import enFees from './en/fees.mjs';
import enWallets from './en/wallets.mjs';
import enSecurity from './en/security.mjs';
import enNetworks from './en/networks.mjs';
import enDefi from './en/defi.mjs';
import enMarkets from './en/markets.mjs';
import enSolana from './en/solana.mjs';
import enAi from './en/ai.mjs';
import enTokenized from './en/tokenized.mjs';

import faSwap from './fa/swap.mjs';
import faFees from './fa/fees.mjs';
import faWallets from './fa/wallets.mjs';
import faSecurity from './fa/security.mjs';
import faNetworks from './fa/networks.mjs';
import faDefi from './fa/defi.mjs';
import faMarkets from './fa/markets.mjs';
import faSolana from './fa/solana.mjs';
import faAi from './fa/ai.mjs';

/** Every authored spoke, in cluster order so hub listings are deterministic. */
export const ARTICLES = [
  ...enSwap, ...enFees, ...enWallets, ...enSecurity, ...enNetworks,
  ...enDefi, ...enMarkets, ...enSolana, ...enAi, ...enTokenized,
  ...faSwap, ...faFees, ...faWallets, ...faSecurity, ...faNetworks,
  ...faDefi, ...faMarkets, ...faSolana, ...faAi
];

const fail = (why) => { throw new Error(`[content/index] ${why}`); };

/* ── group spokes by cluster and language ─────────────────────────────────── */

/** `${clusterId}.${lang}` -> article[] */
const spokesByKey = new Map();
for (const page of ARTICLES) {
  const key = `${page.cluster}.${page.lang}`;
  if (!spokesByKey.has(key)) spokesByKey.set(key, []);
  spokesByKey.get(key).push(page);
}

/* ── build one hub per cluster per language that actually has spokes ──────── */

const HUBS = [];

for (const cluster of CLUSTERS) {
  for (const lang of ['en', 'fa']) {
    const spokes = spokesByKey.get(`${cluster.id}.${lang}`) || [];
    if (!spokes.length) continue;

    const meta = cluster[lang];
    const copy = HUB_COPY[`${cluster.id}.${lang}`];
    if (!meta) fail(`cluster "${cluster.id}" has ${spokes.length} ${lang} spokes but no ${lang} metadata`);
    if (!copy) fail(`cluster "${cluster.id}" has ${spokes.length} ${lang} spokes but no ${lang} hub copy in hubs.mjs`);
    if (lang === 'fa' && !meta.slug.startsWith('fa/')) fail(`Persian hub "${meta.slug}" must live under fa/`);
    if (meta.title.length > 70) fail(`hub "${meta.slug}" title is ${meta.title.length} chars (max 70)`);
    if (meta.description.length < 80 || meta.description.length > 168)
      fail(`hub "${meta.slug}" description is ${meta.description.length} chars (need 80-168)`);

    HUBS.push({
      kind: 'cluster',
      slug: meta.slug,
      cluster: cluster.id,
      lang,
      dir: lang === 'fa' ? 'rtl' : 'ltr',
      icon: cluster.icon,
      topic: cluster.topic,
      route: cluster.route,
      datePublished: '2026-10-05',
      dateModified: '2026-10-05',
      title: meta.title,
      description: meta.description,
      h1: meta.h1,
      body: [...meta.intro, ...copy.body],
      facts: copy.facts,
      faqs: copy.faqs,
      /* Slugs only — render() resolves them so the hub can never advertise a
         page this generator did not emit. */
      spokeSlugs: spokes.map((s) => s.slug),
      ...(lang === 'fa' ? { glanceLabel: 'یک نگاه کلی' } : {})
    });
  }
}

/* ── every article must be reachable from a hub in its own language ───────── */

const hubByKey = new Map(HUBS.map((h) => [`${h.cluster}.${h.lang}`, h]));
for (const page of ARTICLES) {
  if (!hubByKey.has(`${page.cluster}.${page.lang}`)) {
    fail(`orphan: "${page.slug}" is in cluster "${page.cluster}" but no ${page.lang} hub exists`);
  }
}

/* ── reciprocal hreflang pairs, emitted only when both sides exist ────────── */

const bySlug = new Map([...ARTICLES, ...HUBS].map((p) => [p.slug, p]));

const CONTENT_ALTERNATES = [];
for (const page of [...ARTICLES, ...HUBS]) {
  if (page.lang !== 'en') continue;
  /* Persian pages mirror the English slug under fa/. Hubs already carry an
     explicit Persian slug in clusters.mjs; articles use the convention. */
  const faSlug = page.kind === 'cluster'
    ? CLUSTER_BY_ID[page.cluster]?.fa?.slug
    : `fa/${page.slug}`;
  if (faSlug && bySlug.has(faSlug)) CONTENT_ALTERNATES.push([page.slug, faSlug]);
}

/* ── a Persian page with no English counterpart is allowed; the reverse of an
      unpaired page is simply no annotation. But a duplicate slug is not. ──── */

const seen = new Set();
for (const page of [...ARTICLES, ...HUBS]) {
  if (seen.has(page.slug)) fail(`duplicate slug "${page.slug}"`);
  seen.add(page.slug);
}

/** Hubs first so a crawler walking PAGES in order meets pillars before spokes. */
export const CONTENT_PAGES = [...HUBS, ...ARTICLES];

export { CONTENT_ALTERNATES, HUBS };

/**
 * cluster id -> { en: {hub, spokes}, fa: {hub, spokes} }
 * render() uses this to link an article to its hub and its closest siblings
 * instead of to every page on the site.
 */
export const CLUSTER_INDEX = {};
for (const cluster of CLUSTERS) {
  CLUSTER_INDEX[cluster.id] = {};
  for (const lang of ['en', 'fa']) {
    const hub = hubByKey.get(`${cluster.id}.${lang}`);
    if (!hub) continue;
    CLUSTER_INDEX[cluster.id][lang] = {
      hub: hub.slug,
      label: cluster[lang].label,
      spokes: (spokesByKey.get(`${cluster.id}.${lang}`) || []).map((s) => s.slug)
    };
  }
}

/** Sibling clusters, so the hub graph is connected rather than ten islands. */
export const CLUSTER_ORDER = CLUSTERS.map((c) => c.id);
