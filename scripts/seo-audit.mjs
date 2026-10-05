#!/usr/bin/env node
/**
 * FULL-SITE SEO / AEO AUDIT — reads dist/, reports, exits non-zero on errors.
 * ---------------------------------------------------------------------------
 * `npm run test:seo` asserts a handful of hand-picked invariants. This walks
 * EVERY generated document and grades it against the checks that actually move
 * a page in search and in AI answers, then prints one report a human can read
 * from a phone.
 *
 * ─── WHAT IT CAN AND CANNOT PROVE ──────────────────────────────────────────
 * It proves what the BUILD OUTPUT contains: titles, descriptions, canonicals,
 * reciprocal hreflang, structured data, internal link graph, crawl directives,
 * orphan pages, thin content, duplicate metadata, broken internal links.
 *
 * It CANNOT prove indexation, ranking, or that any crawler fetched anything.
 * Those live in Search Console / Bing Webmaster Tools against the deployed
 * property. Nothing in this file should be read as "we rank" — it reads as
 * "nothing in the output is structurally stopping us from ranking".
 *
 * Usage:
 *   node scripts/seo-audit.mjs            # human report
 *   node scripts/seo-audit.mjs --json     # machine-readable
 *   node scripts/seo-audit.mjs --strict   # warnings also fail the run
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { JSDOM } from 'jsdom';

const OUT = 'dist';
const SITE = (process.env.VITE_PUBLIC_URL || 'https://fbtswap.ir').replace(/\/+$/, '');
const JSON_MODE = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

const read = (p) => readFileSync(p, 'utf8');

/* ─── Findings ────────────────────────────────────────────────────────────── */
const findings = [];
const add = (level, check, detail, page = null) => findings.push({ level, check, detail, page });
const error = (check, detail, page) => add('error', check, detail, page);
const warn = (check, detail, page) => add('warn', check, detail, page);
const ok = (check, detail) => add('ok', check, detail);

if (!existsSync(OUT)) {
  console.error('✗ dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

/* ─── 1. Collect every generated document ────────────────────────────────── */
function walkDirs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(dir, entry.name);
    if (existsSync(join(full, 'index.html'))) out.push(full);
    out.push(...walkDirs(full));
  }
  return out;
}

const docDirs = [OUT, ...walkDirs(OUT)].filter((d) => existsSync(join(d, 'index.html')));
const docs = new Map(); // url -> { doc, file, slug, raw, noindex }

/* One canonical spelling for a URL before any two of them are compared.
 * A directory-backed static host serves /fa and /fa/ as the same document, so
 * the generator is free to emit either; the auditor must not invent a defect
 * out of that choice. Everything below compares canon(a) === canon(b). */
const canon = (u) => {
  if (!u) return u;
  const s = String(u).trim();
  return s === `${SITE}/` || s === SITE ? `${SITE}/` : s.replace(/\/+$/, '');
};
/* Resolve a URL to a document regardless of how its trailing slash is spelled. */
const docAt = (u) => docs.get(canon(u)) || docs.get(`${canon(u)}/`) || docs.get(u);

for (const dir of docDirs) {
  const file = join(dir, 'index.html');
  const raw = read(file);
  const slug = dir === OUT ? '' : relative(OUT, dir).split(sep).join('/');
  const dom = new JSDOM(raw);
  const doc = dom.window.document;
  const robots = doc.querySelector('meta[name="robots"]')?.content || '';
  const url = slug
    ? `${SITE}/${slug.split('/').map(encodeURIComponent).join('/')}`
    : `${SITE}/`;
  docs.set(url, {
    doc,
    raw,
    file,
    slug,
    url,
    noindex: /noindex/i.test(robots),
    isApp: slug === '' // the SPA shell
  });
}

const indexable = [...docs.values()].filter((d) => !d.noindex);
ok('inventory', `${docs.size} HTML documents, ${indexable.length} indexable`);

/* ─── 2. Sitemap ─────────────────────────────────────────────────────────── */
const sitemapIndexFile = join(OUT, 'sitemap.xml');
let sitemapUrls = [];
let sitemapFiles = [];

if (!existsSync(sitemapIndexFile)) {
  error('sitemap', 'dist/sitemap.xml is missing — robots.txt advertises a 404');
} else {
  const parse = (file) => {
    const xml = read(file);
    const sdoc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
    if (sdoc.querySelector('parsererror')) {
      error('sitemap', `${relative(OUT, file)} is not valid XML`);
      return { urls: [], children: [] };
    }
    return {
      urls: [...sdoc.querySelectorAll('url')].map((u) => ({
        loc: u.querySelector('loc')?.textContent?.trim(),
        lastmod: u.querySelector('lastmod')?.textContent?.trim() || null,
        alternates: [...u.querySelectorAll('link')].map((l) => l.getAttribute('href'))
      })),
      children: [...sdoc.querySelectorAll('sitemap > loc')].map((l) => l.textContent.trim())
    };
  };

  const root = parse(sitemapIndexFile);
  sitemapFiles.push(sitemapIndexFile);
  if (root.children.length) {
    ok('sitemap', `sitemap index with ${root.children.length} child sitemaps`);
    for (const child of root.children) {
      const rel = child.replace(`${SITE}/`, '');
      const f = join(OUT, rel);
      if (!existsSync(f)) {
        error('sitemap', `child sitemap listed but not generated: ${rel}`);
        continue;
      }
      sitemapFiles.push(f);
      sitemapUrls.push(...parse(f).urls);
    }
  }
  sitemapUrls.push(...root.urls);

  const locs = sitemapUrls.map((u) => u.loc);
  if (new Set(locs).size !== locs.length) error('sitemap', 'duplicate <loc> entries');
  for (const u of sitemapUrls) {
    if (!u.loc?.startsWith(SITE)) error('sitemap', `off-site or relative loc: ${u.loc}`);
    if (u.loc?.includes('#')) error('sitemap', `fragment URL in sitemap: ${u.loc}`);
    const sdoc = docAt(u.loc);
    if (!sdoc) error('sitemap', `listed URL has no generated document: ${u.loc}`);
    else if (sdoc.noindex) error('sitemap', `noindex page listed in sitemap: ${u.loc}`);
  }
  const listed = new Set(locs.map(canon));
  for (const d of indexable) {
    if (!listed.has(canon(d.url))) error('sitemap', `indexable page missing from sitemap: ${d.url}`);
  }
  if (sitemapUrls.length > 50000) error('sitemap', 'a single sitemap may not exceed 50,000 URLs');
  const withLastmod = sitemapUrls.filter((u) => u.lastmod).length;
  ok('sitemap', `${sitemapUrls.length} URLs, ${withLastmod} carry <lastmod>`);
  for (const f of sitemapFiles) {
    const bytes = statSync(f).size;
    if (bytes > 50 * 1024 * 1024) error('sitemap', `${relative(OUT, f)} exceeds the 50 MB limit`);
  }
}

/* ─── 3. robots.txt ──────────────────────────────────────────────────────── */
const robotsFile = join(OUT, 'robots.txt');
if (!existsSync(robotsFile)) {
  error('robots', 'dist/robots.txt is missing');
} else {
  const robots = read(robotsFile);
  const groups = [];
  let group = { agents: [], directives: [] };
  for (const line of robots.split(/\r?\n/).map((l) => l.trim())) {
    if (/^User-agent:/i.test(line)) {
      if (group.directives.length) { groups.push(group); group = { agents: [], directives: [] }; }
      group.agents.push(line.slice('User-agent:'.length).trim());
    } else if (/^(Allow|Disallow|Crawl-delay):/i.test(line)) group.directives.push(line);
  }
  if (group.agents.length) groups.push(group);

  if (!groups.some((g) => g.agents.includes('*'))) error('robots', 'no wildcard User-agent group');
  for (const g of groups) {
    if (g.directives.includes('Disallow: /')) error('robots', `${g.agents.join(', ')} is blocked from the whole site`);
    if (!g.directives.some((d) => /^Disallow: \/api\//i.test(d)))
      error('robots', `${g.agents.join(', ')} is not kept out of /api/`);
  }
  if (!/^Sitemap:\s*https?:\/\//mi.test(robots)) error('robots', 'robots.txt does not point at an absolute sitemap URL');

  /* Answer engines. Being absent from robots.txt is not a block, but being
     explicitly welcomed removes any ambiguity for crawlers that look for a
     named group before fetching. */
  const AI_AGENTS = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'anthropic-ai',
    'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended',
    'CCBot', 'Amazonbot', 'meta-externalagent', 'DuckAssistBot', 'cohere-ai',
    'YouBot', 'Bytespider', 'Diffbot', 'Timpibot', 'MistralAI-User'
  ];
  const declared = new Set(groups.flatMap((g) => g.agents.map((a) => a.toLowerCase())));
  const missing = AI_AGENTS.filter((a) => !declared.has(a.toLowerCase()));
  if (missing.length) warn('robots-ai', `no explicit group for ${missing.length} answer engines: ${missing.join(', ')}`);
  else ok('robots-ai', `all ${AI_AGENTS.length} tracked answer engines have an explicit group`);
}

/* ─── 4. AI / answer-engine surfaces ─────────────────────────────────────── */
for (const [f, label] of [
  ['llms.txt', 'llms.txt (short AI brief)'],
  ['llms-full.txt', 'llms-full.txt (full AI corpus)'],
  ['feed.xml', 'RSS feed'],
  ['.well-known/security.txt', 'security.txt']
]) {
  if (existsSync(join(OUT, f))) ok('ai-surface', `${label} published`);
  else warn('ai-surface', `${label} is missing (${f})`);
}

/* ─── 5. Per-document checks ─────────────────────────────────────────────── */
const titles = new Map();
const descriptions = new Map();
const h1s = new Map();
const inboundLinks = new Map([...docs.keys()].map((u) => [u, 0]));
const linkGraph = new Map();

const STOP_SLUGS = new Set(['', 'library', 'fa/']);

for (const entry of docs.values()) {
  const { doc, url, slug, noindex, isApp } = entry;
  const where = `/${slug}`;

  const title = doc.title?.trim() || '';
  const desc = doc.querySelector('meta[name="description"]')?.content?.trim() || '';
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || '';
  const htmlLang = doc.documentElement.getAttribute('lang');
  const dirAttr = doc.documentElement.getAttribute('dir');

  /* -- metadata -- */
  if (!title) error('title', 'missing <title>', where);
  else {
    if (title.length < 20) warn('title', `only ${title.length} chars`, where);
    if (title.length > 70) warn('title', `${title.length} chars — likely truncated in SERP`, where);
    if (!noindex) titles.set(title, [...(titles.get(title) || []), where]);
  }

  if (!desc) {
    // A noindex redirect stub is never shown in a SERP, so it owes no description.
    if (!noindex) error('description', 'missing meta description', where);
  } else {
    if (desc.length < 70) warn('description', `only ${desc.length} chars`, where);
    if (desc.length > 170) warn('description', `${desc.length} chars — will be rewritten by Google`, where);
    if (!noindex) descriptions.set(desc, [...(descriptions.get(desc) || []), where]);
  }

  if (!canonical) error('canonical', 'missing rel=canonical', where);
  else if (!noindex && canon(canonical) !== canon(url)) error('canonical', `canonical ${canonical} ≠ page URL ${url}`, where);

  if (!htmlLang) error('lang', 'missing <html lang>', where);
  if (htmlLang === 'fa' && dirAttr !== 'rtl') error('lang', 'Persian page without dir="rtl"', where);

  /* -- headings -- */
  const headings = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const pageH1 = doc.querySelectorAll('h1');
  if (!isApp && !noindex && pageH1.length === 0) error('h1', 'no <h1>', where);
  if (pageH1.length > 1) warn('h1', `${pageH1.length} <h1> elements`, where);
  if (pageH1.length === 1 && !noindex) {
    const text = pageH1[0].textContent.trim();
    h1s.set(text, [...(h1s.get(text) || []), where]);
  }
  let prev = 0;
  for (const h of headings) {
    const level = Number(h.tagName[1]);
    if (prev && level > prev + 1) {
      warn('heading-order', `h${prev} jumps to h${level} ("${h.textContent.trim().slice(0, 40)}")`, where);
      break;
    }
    prev = level;
  }

  /* -- social -- */
  if (!noindex) {
    for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type']) {
      if (!doc.querySelector(`meta[property="${tag}"]`)) warn('open-graph', `missing ${tag}`, where);
    }
    if (!doc.querySelector('meta[name="twitter:card"]')) warn('open-graph', 'missing twitter:card', where);
    const ogUrl = doc.querySelector('meta[property="og:url"]')?.content;
    if (ogUrl && canon(ogUrl) !== canon(url)) error('open-graph', `og:url ${ogUrl} ≠ ${url}`, where);
  }

  /* -- structured data -- */
  const blocks = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  if (!noindex && !isApp && !blocks.length) error('schema', 'no JSON-LD', where);
  const graph = [];
  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b.textContent);
      graph.push(...(parsed['@graph'] || [parsed]));
    } catch (err) {
      error('schema', `invalid JSON-LD: ${err.message}`, where);
    }
  }
  const types = new Set(graph.map((n) => n['@type']).flat().filter(Boolean));
  if (!noindex && !isApp) {
    if (!types.has('BreadcrumbList')) warn('schema', 'no BreadcrumbList', where);
    if (!types.has('Organization')) warn('schema', 'no Organization node', where);
    /* A visible FAQ with no FAQPage markup wastes the richest AEO surface
       this template has; the reverse (markup with no visible answer) is a
       guideline violation. Both directions are checked. */
    const visibleFaq = doc.querySelectorAll('.faq-list details').length;
    if (visibleFaq && !types.has('FAQPage')) warn('schema', `${visibleFaq} visible FAQs but no FAQPage markup`, where);
    if (types.has('FAQPage') && !visibleFaq) error('schema', 'FAQPage markup with no visible FAQ', where);
    const visibleSteps = doc.querySelectorAll('.howto-list li').length;
    if (types.has('HowTo') && !visibleSteps) error('schema', 'HowTo markup with no visible steps', where);
  }

  /* -- content depth -- */
  const clone = doc.body?.cloneNode(true);
  if (clone) {
    for (const el of clone.querySelectorAll('script,style,nav,footer,.related-links,.lib-grid,.post-index')) el.remove();
    const words = clone.textContent.split(/\s+/).filter(Boolean).length;
    entry.words = words;
    if (!noindex && !isApp && words < 300) error('thin-content', `${words} words of body copy`, where);
    else if (!noindex && !isApp && words < 450) warn('thin-content', `${words} words of body copy`, where);
  }

  /* -- images -- */
  for (const img of doc.querySelectorAll('img')) {
    if (img.getAttribute('alt') === null) error('image-alt', `img without alt: ${img.getAttribute('src')}`, where);
    if (!img.getAttribute('width') || !img.getAttribute('height'))
      warn('image-size', `img without width/height (CLS risk): ${img.getAttribute('src')}`, where);
  }

  /* -- internal links -- */
  const outbound = new Set();
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    let target;
    try {
      target = new URL(href, url);
    } catch { continue; }
    if (target.origin !== SITE) continue;
    if (target.hash) continue; // in-app hash route, resolves to the SPA shell
    // Express owns /api/* at runtime; there is no prerendered document to find.
    if (target.pathname.startsWith('/api/')) continue;
    const normalized = canon(`${SITE}${target.pathname}`);
    outbound.add(normalized);
    if (!docAt(normalized)) {
      error('broken-link', `links to a URL with no document: ${target.pathname}`, where);
    }
    if (!a.textContent.trim() && !a.querySelector('img')) warn('link-text', `empty anchor text → ${target.pathname}`, where);
  }
  linkGraph.set(url, outbound);
  for (const t of outbound) if (inboundLinks.has(t)) inboundLinks.set(t, inboundLinks.get(t) + 1);

  if (outbound.size > 250) warn('link-volume', `${outbound.size} internal links on one page dilutes every one of them`, where);

  /* -- hreflang -- */
  const alts = [...doc.querySelectorAll('link[rel="alternate"][hreflang]')];
  for (const alt of alts) {
    const href = alt.getAttribute('href');
    const lang = alt.getAttribute('hreflang');
    const target = docAt(href);
    if (!target) { error('hreflang', `${lang} alternate has no document: ${href}`, where); continue; }
    if (canon(href) === canon(url) || lang === 'x-default') continue;
    const back = [...target.doc.querySelectorAll('link[rel="alternate"][hreflang]')]
      .some((l) => canon(l.getAttribute('href')) === canon(url));
    if (!back) error('hreflang', `${href} does not reciprocate ${url}`, where);
  }
  if (alts.length && !alts.some((a) => a.getAttribute('hreflang') === 'x-default'))
    warn('hreflang', 'alternate set without x-default', where);
  if (alts.length && !alts.some((a) => canon(a.getAttribute('href')) === canon(url)))
    error('hreflang', 'alternate set does not include a self-reference', where);
}

/* ─── 6. Duplicates ──────────────────────────────────────────────────────── */
for (const [title, pages] of titles) {
  if (pages.length > 1) error('duplicate-title', `${pages.length} pages share "${title.slice(0, 60)}": ${pages.join(', ')}`);
}
for (const [desc, pages] of descriptions) {
  if (pages.length > 1) error('duplicate-description', `${pages.length} pages share one description: ${pages.join(', ')}`);
}
for (const [h1, pages] of h1s) {
  if (pages.length > 1) warn('duplicate-h1', `${pages.length} pages share H1 "${h1.slice(0, 50)}": ${pages.join(', ')}`);
}

/* ─── 7. Orphans and crawl depth ─────────────────────────────────────────── */
for (const d of indexable) {
  if (STOP_SLUGS.has(d.slug)) continue;
  if ((inboundLinks.get(d.url) || 0) === 0) error('orphan', `no internal page links to ${d.url}`);
}

/* BFS from the root: anything more than 4 clicks deep is effectively invisible
   to a crawl budget, which for a new .ir domain is small. */
const depth = new Map([[`${SITE}/`, 0]]);
const queue = [`${SITE}/`];
while (queue.length) {
  const cur = queue.shift();
  for (const next of linkGraph.get(cur) || []) {
    if (depth.has(next)) continue;
    depth.set(next, depth.get(cur) + 1);
    queue.push(next);
  }
}
const deep = indexable.filter((d) => (depth.get(d.url) ?? 99) > 4);
if (deep.length) warn('crawl-depth', `${deep.length} pages are more than 4 clicks from the homepage`);
const unreachable = indexable.filter((d) => !depth.has(d.url));
if (unreachable.length) error('crawl-depth', `${unreachable.length} pages are unreachable by following links from /`);

/* ─── 8. Report ──────────────────────────────────────────────────────────── */
const errors = findings.filter((f) => f.level === 'error');
const warnings = findings.filter((f) => f.level === 'warn');

if (JSON_MODE) {
  console.log(JSON.stringify({
    site: SITE,
    documents: docs.size,
    indexable: indexable.length,
    sitemapUrls: sitemapUrls.length,
    errors: errors.length,
    warnings: warnings.length,
    findings
  }, null, 2));
} else {
  const group = (list) => {
    const byCheck = new Map();
    for (const f of list) byCheck.set(f.check, [...(byCheck.get(f.check) || []), f]);
    return [...byCheck.entries()].sort((a, b) => b[1].length - a[1].length);
  };
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`  SEO / AEO AUDIT — ${SITE}`);
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  documents: ${docs.size}   indexable: ${indexable.length}   sitemap: ${sitemapUrls.length}`);
  console.log(`  errors: ${errors.length}   warnings: ${warnings.length}\n`);

  for (const f of findings.filter((x) => x.level === 'ok')) console.log(`  ✓ ${f.check}: ${f.detail}`);

  if (errors.length) {
    console.log('\n  ── ERRORS ──────────────────────────────────────────────────');
    for (const [check, list] of group(errors)) {
      console.log(`\n  ✗ ${check} (${list.length})`);
      for (const f of list.slice(0, 12)) console.log(`      ${f.page ? f.page + ' — ' : ''}${f.detail}`);
      if (list.length > 12) console.log(`      … and ${list.length - 12} more`);
    }
  }
  if (warnings.length) {
    console.log('\n  ── WARNINGS ────────────────────────────────────────────────');
    for (const [check, list] of group(warnings)) {
      console.log(`\n  ! ${check} (${list.length})`);
      for (const f of list.slice(0, 8)) console.log(`      ${f.page ? f.page + ' — ' : ''}${f.detail}`);
      if (list.length > 8) console.log(`      … and ${list.length - 8} more`);
    }
  }
  console.log(`\n  ${errors.length ? '✗ FAILED' : '✓ PASSED'} — ${errors.length} errors, ${warnings.length} warnings`);
  console.log('  Indexation and ranking are NOT proven here; verify in Search Console.\n');
}

process.exit(errors.length || (STRICT && warnings.length) ? 1 : 0);
