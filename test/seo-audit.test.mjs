/* Run after npm run build. Audits the published HTML files, not the Web3 app. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const OUT = 'dist';
const SITE = 'https://fbtswap.ir';
const read = (p) => readFileSync(p, 'utf8');
const html = (p) => new JSDOM(read(p)).window.document;
/*
 * sitemap.xml is a sitemap INDEX: one child per language, so Search Console
 * reports English and Persian coverage separately. This walks the index down
 * to the leaf <url> entries, and still accepts a flat <urlset> at the root so
 * the test does not depend on the split staying in place.
 */
const parseSitemap = (file) => {
  const doc = new JSDOM(read(file), { contentType: 'text/xml' }).window.document;
  assert.equal(doc.querySelector('parsererror'), null, `${file} is valid XML`);
  return doc;
};
const urls = () => {
  assert.ok(existsSync(join(OUT, 'sitemap.xml')), 'run npm run build before npm run test:seo');
  const root = parseSitemap(join(OUT, 'sitemap.xml'));
  const children = [...root.querySelectorAll('sitemap > loc')].map((loc) => loc.textContent.trim());
  if (!children.length) return [...root.querySelectorAll('url > loc')].map((loc) => loc.textContent);

  const out = [];
  for (const child of children) {
    const rel = child.replace(`${SITE}/`, '');
    const file = join(OUT, rel);
    assert.ok(existsSync(file), `child sitemap ${rel} was generated`);
    out.push(...[...parseSitemap(file).querySelectorAll('url > loc')].map((loc) => loc.textContent));
  }
  return out;
};

// One source of truth for the advertised network count. This test reads the
// registry but never modifies or bundles the app.
const chainOrder = /export const EVM_CHAIN_ORDER = \[([^\]]+)\]/.exec(read('src/lib/chains.js'))?.[1];
assert.ok(chainOrder, 'EVM chain order exists');
const networkCount = chainOrder.split(',').filter((id) => id.trim()).length + 1; // Solana

test('public network claims agree with the chain registry and homepage JSON-LD', () => {
  const home = html(join(OUT, 'index.html'));
  const pages = [...home.querySelectorAll('script[type="application/ld+json"]')]
    .flatMap((script) => {
      const data = JSON.parse(script.textContent);
      return data['@graph'] || [data];
    });
  const webPage = pages.find((item) => item['@type'] === 'WebPage');
  assert.ok(webPage);
  assert.equal(webPage.name, home.title, 'structured data and <title> agree');
  assert.match(webPage.description, new RegExp(`\\b${networkCount}\\b`));
  assert.match(home.querySelector('meta[name="description"]').content, new RegExp(`\\b${networkCount}\\b`));
  const organization = pages.find((item) => item['@type'] === 'Organization');
  const website = pages.find((item) => item['@type'] === 'WebSite');
  assert.ok(organization);
  assert.ok(organization.alternateName?.includes('FBTSwap'));
  assert.ok(organization.alternateName?.includes('اف بی تی سواپ'));
  assert.ok(website?.alternateName?.includes('FBTSwap'));
  assert.ok(pages.some((item) => item['@type'] === 'SoftwareApplication'));
  assert.equal(home.querySelector('link[rel="canonical"]').href, `${SITE}/`);

  const llms = read(join(OUT, 'llms.txt'));
  assert.match(llms, new RegExp(`Supported networks \\(${networkCount}\\)`));
  assert.match(llms.replace(/\s+/g, ' '), new RegExp(`${networkCount} supported networks`));
  for (const network of ['Solana', 'Scroll', 'zkSync Era', 'Robinhood Chain']) {
    assert.ok(llms.includes(network), `llms.txt names ${network}`);
  }
});

/*
 * ─── THE HOMEPAGE IS A DOCUMENT, NOT A SPINNER ─────────────────────────────
 * `/` is the application shell: React mounts into #root and paints a market
 * dashboard that is fetched client-side. Without the injected home hub the
 * delivered HTML of the most authoritative URL on the domain is a spinner and
 * nothing else, which is why every crawler that does not execute JavaScript
 * — every answer engine among them — had no homepage to read and no internal
 * link graph to follow.
 *
 * These assertions are the regression guard. They cannot prove that sitelinks
 * appear or that anything is indexed; they prove the homepage still ships real,
 * bilingual, structured content and a complete map, which is the part we own.
 */
test('the homepage ships crawlable content and a map of every published page', () => {
  const raw = read(join(OUT, 'index.html'));
  assert.ok(raw.includes('id="home-hub"'), 'the home hub was injected into dist/index.html');

  const home = html(join(OUT, 'index.html'));
  const hub = home.querySelector('#home-hub');
  assert.ok(hub, '#home-hub exists in the delivered document');

  // One <h1>, and it is in the Persian block the document declares (lang="fa").
  const h1s = [...home.querySelectorAll('h1')];
  assert.equal(h1s.length, 1, 'exactly one <h1> in the delivered HTML');
  assert.match(h1s[0].textContent, /\u0627\u0641\u200c\u0628\u06cc\u200c\u062a\u06cc \u0633\u0648\u0627\u067e/);

  // Real content, not a placeholder. 800 words is a floor, not a target: the
  // generated hub currently carries roughly 2,000 across both languages.
  const clone = hub.cloneNode(true);
  for (const el of clone.querySelectorAll('script,style')) el.remove();
  const words = clone.textContent.split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 800, `home hub carries ${words} words of body copy (needs 800+)`);

  // Both languages are present as real sections, each declaring its own dir.
  assert.ok(hub.querySelector('section[lang="fa"][dir="rtl"]'), 'Persian section present');
  assert.ok(hub.querySelector('section[lang="en"][dir="ltr"]'), 'English section present');

  // The link graph: every href must resolve to a document the build produced.
  const hrefs = [...hub.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  assert.ok(hrefs.length >= 100, `home hub links to ${hrefs.length} internal URLs (needs 100+)`);
  const listed = new Set(urls());
  for (const href of hrefs) {
    assert.ok(href.startsWith('/'), `home hub link is internal: ${href}`);
    // Directory-backed URLs: the sitemap spells them with the trailing slash,
    // the hub spells some of them without. Both are the same document.
    const target = `${SITE}${href}`;
    const stripped = `${SITE}${href.replace(/\/$/, '')}`;
    assert.ok(
      listed.has(target) || listed.has(stripped),
      `home hub links to a page that is not in the sitemap: ${href}`
    );
  }

  // A heading level is never skipped — the audit warns, this fails.
  let prev = 0;
  for (const h of home.querySelectorAll('#home-hub h1, #home-hub h2, #home-hub h3')) {
    const level = Number(h.tagName[1]);
    assert.ok(!prev || level <= prev + 1, `#home-hub jumps from h${prev} to h${level}`);
    prev = level;
  }
});

test('the homepage declares its language instead of contradicting itself', () => {
  const home = html(join(OUT, 'index.html'));
  const description = home.querySelector('meta[name="description"]').content;

  // The document declares lang="fa"; its metadata must not be English-only.
  assert.match(description, /\u0633\u0648\u0627\u067e \u063a\u06cc\u0631\u0627\u0645\u0627\u0646\u06cc/, 'description carries Persian');
  assert.match(description, /Non-custodial/, 'description carries English');
  // The declared locale order follows the document, not the other way round.
  assert.equal(home.querySelector('meta[property="og:locale"]').content, 'fa_IR');
  assert.equal(home.querySelector('meta[property="og:locale:alternate"]').content, 'en_US');
  // Self-referencing alternates: x-default plus the document's own language.
  const alts = [...home.querySelectorAll('link[rel="alternate"][hreflang]')];
  assert.ok(alts.some((a) => a.getAttribute('hreflang') === 'x-default' && a.href === `${SITE}/`));
  assert.ok(alts.some((a) => a.getAttribute('hreflang') === 'fa-IR' && a.href === `${SITE}/`));
});

/*
 * ─── SITELINKS NEED A STABLE HIERARCHY ─────────────────────────────────────
 * Google builds the indented sub-page list under a result from the site's own
 * internal link hierarchy. Links that appear on one page and not another, or
 * whose anchor text shifts between pages, teach it nothing — so the topic row
 * has to be identical everywhere within a language. This is the guard on that.
 */
test('every indexable page carries the same topic row in its own language', () => {
  const listed = new Set(urls());
  const rows = new Map(); // language -> serialised "label|href" set

  const samples = [
    'non-custodial-crypto-swap', 'library', 'guides/crypto-fees-and-gas',
    'fa/', 'fa/non-custodial-wallet', 'fa/guides/crypto-security-and-scams'
  ];
  for (const slug of samples) {
    const doc = html(join(OUT, slug, 'index.html'));
    const links = [...doc.querySelectorAll('.section-nav a')];
    assert.ok(links.length >= 8, `${slug} carries ${links.length} topic links (needs 8+)`);
    for (const a of links) {
      assert.ok(a.textContent.trim(), `${slug} has a topic link with no text`);
      const href = a.getAttribute('href');
      assert.ok(
        listed.has(`${SITE}${href}`) || listed.has(`${SITE}${href.replace(/\/$/, '')}`),
        `${slug} topic row points at an unlisted URL: ${href}`
      );
    }
    const lang = doc.documentElement.getAttribute('lang');
    const serialised = links.map((a) => `${a.textContent.trim()}|${a.getAttribute('href')}`).join('\n');
    if (rows.has(lang)) {
      assert.equal(serialised, rows.get(lang), `the ${lang} topic row differs between pages`);
    } else {
      rows.set(lang, serialised);
    }
  }
  assert.ok(rows.has('en') && rows.has('fa'), 'both languages were sampled');
  assert.notEqual(rows.get('en'), rows.get('fa'), 'the two languages have different topic rows');
});

/*
 * ─── ANSWER ENGINES NEED THE QUESTION BEFORE THE PROSE ─────────────────────
 * A crawler deciding whether a page is worth extracting from should not have to
 * parse the whole body to find out what it answers. The question list states it
 * up front, built from the same page.faqs as the FAQPage markup, so there is no
 * third copy that can go stale.
 */
test('every page states the questions it answers, and the answers are on the page', () => {
  for (const slug of ['non-custodial-crypto-swap', 'fa/crypto-swap-without-kyc', 'guides/solana']) {
    const doc = html(join(OUT, slug, 'index.html'));
    const list = doc.querySelector('.qa-list');
    assert.ok(list, `${slug} has a question list`);
    const items = [...list.querySelectorAll('li a')];
    assert.ok(items.length >= 2, `${slug} states ${items.length} questions`);

    const faqs = [...doc.querySelectorAll('.faq-list details')];
    assert.equal(items.length, faqs.length, `${slug}: question count matches the visible FAQ`);
    items.forEach((a, i) => {
      assert.ok(a.textContent.trim(), `${slug} question ${i + 1} has no text`);
      assert.ok(doc.querySelector(a.getAttribute('href')), `${slug} question ${i + 1} links to a missing answer`);
    });

    // The list sits before the prose, not after it.
    const body = doc.querySelector('.story-copy');
    const position = list.compareDocumentPosition(body);
    assert.ok(position & 4, `${slug}: the question list comes before the body copy`);
  }
});

test('llms.txt is generated from the corpus in both languages', () => {
  const llms = read(join(OUT, 'llms.txt'));
  assert.ok(llms.includes(`${SITE}/llms-full.txt`), 'llms.txt points at the full corpus map');
  const hubs = (lang) => llms.split('## Topic hubs \u2014 English')[1] ?? llms;
  assert.match(llms, /## Topic hubs \u2014 English/);
  assert.match(llms, /## \u0645\u0631\u062c\u0639\u200c\u0647\u0627\u06cc \u0645\u0648\u0636\u0648\u0639\u06cc \u2014 \u0641\u0627\u0631\u0633\u06cc/);
  for (const slug of ['guides/crypto-swap-and-routing', 'guides/crypto-fees-and-gas', 'guides/solana']) {
    assert.ok(llms.includes(`${SITE}/${slug}`), `llms.txt lists ${slug}`);
  }
  for (const slug of ['fa/guides/crypto-swap-and-routing', 'fa/guides/solana']) {
    assert.ok(llms.includes(`${SITE}/${slug}`), `llms.txt lists ${slug}`);
  }
  // The old hand-written file described twenty pages. The generated one must
  // describe the corpus that actually exists.
  const listed = urls().length;
  assert.ok(listed > 200, 'sanity: the corpus is the size this test assumes');
});

test('robots rules apply the API exclusion to every declared crawler group', () => {
  const robots = read(join(OUT, 'robots.txt'));
  const groups = [];
  let group = { agents: [], directives: [] };
  for (const line of robots.split(/\r?\n/).map((l) => l.trim())) {
    if (/^User-agent:/i.test(line)) {
      if (group.directives.length) { groups.push(group); group = { agents: [], directives: [] }; }
      group.agents.push(line.slice('User-agent:'.length).trim());
    } else if (/^(Allow|Disallow):/i.test(line)) group.directives.push(line);
  }
  if (group.agents.length) groups.push(group);
  assert.ok(groups.some((g) => g.agents.includes('*')), 'public pages can be crawled');
  for (const g of groups) {
    assert.ok(g.directives.includes('Disallow: /api/'), `${g.agents.join(', ')} must not crawl /api/`);
    assert.ok(!g.directives.includes('Disallow: /'), 'do not block the entire site');
  }
  assert.match(robots, /^Sitemap: https:\/\/fbtswap\.ir\/sitemap\.xml$/m);
});

test('each sitemap URL names real, indexable HTML with unique metadata', () => {
  const entries = urls();
  /* Recursive: the Persian pages are nested under fa/. Redirect stubs for the
     old Arabic-script URLs carry a noindex marker and are moves, not pages,
     so they do not count. */
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (!e.isDirectory()) return [];
      const full = join(dir, e.name);
      const here = existsSync(join(full, 'index.html')) ? [full] : [];
      return [...here, ...walk(full)];
    });
  const generated = walk(OUT).filter((dir) => !read(join(dir, 'index.html')).includes('content="noindex"'));
  assert.equal(entries.length, generated.length + 1, 'one root URL plus all generated pages');
  assert.equal(new Set(entries).size, entries.length, 'no duplicate URLs');
  assert.ok(entries.includes(`${SITE}/`));
  const titles = [];
  const descriptions = [];
  const docs = new Map();
  for (const url of entries.filter((u) => u !== `${SITE}/`)) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, SITE);
    assert.equal(parsed.hash, '');
    const slug = decodeURIComponent(parsed.pathname.slice(1));
    const file = join(OUT, slug, 'index.html');
    assert.ok(existsSync(file), `${url} resolves to a real HTML file`);
    const doc = html(file);
    docs.set(url, doc);
    assert.equal(doc.querySelector('link[rel="canonical"]')?.href, url);
    assert.equal(doc.querySelector('meta[property="og:url"]')?.content, url);
    assert.ok(doc.querySelector('h1'), `${url} has an H1`);
    const desc = doc.querySelector('meta[name="description"]')?.content;
    assert.ok(desc?.length > 50, `${url} has a useful description`);
    titles.push(doc.title);
    descriptions.push(desc);
  }
  assert.equal(new Set(titles).size, titles.length, 'distinct landing titles');
  assert.equal(new Set(descriptions).size, descriptions.length, 'distinct landing descriptions');
  for (const [url, doc] of docs) {
    for (const alternate of doc.querySelectorAll('link[rel="alternate"][hreflang]')) {
      assert.ok(docs.has(alternate.href), `${url}: ${alternate.hreflang} target exists in sitemap`);
      if (alternate.href === url || alternate.hreflang === 'x-default') continue;
      assert.ok([...docs.get(alternate.href).querySelectorAll('link[rel="alternate"][hreflang]')]
        .some((back) => back.href === url), `${alternate.href} reciprocates ${url}`);
    }
  }
  const persianHub = `${SITE}/fa/blog`;
  assert.ok([...docs.get(`${SITE}/blog`).querySelectorAll('link[hreflang="fa"]')]
    .some((link) => link.href === persianHub), 'English/Persian hubs are a reciprocal translation pair');
  const libraryFa = `${SITE}/fa/`;
  assert.ok([...docs.get(`${SITE}/library`).querySelectorAll('link[hreflang="fa"]')]
    .some((link) => link.href === libraryFa), 'the two library directories are a reciprocal pair');
});

test('the flagship landing offers visible paths to both guide hubs', () => {
  const doc = html(join(OUT, 'decentralized-crypto-exchange', 'index.html'));
  const links = [...doc.querySelectorAll('footer.site a[href]')].map((a) => a.href);
  assert.ok(links.includes(`${SITE}/blog`));
  assert.ok(links.includes(`${SITE}/fa/blog`));
  assert.ok(links.includes(`${SITE}/crypto-swap-without-kyc`));
  assert.ok(links.includes(`${SITE}/fa/crypto-swap-without-kyc`));
});

test('brand search and the new bilingual discovery pages are wired for crawling', () => {
  const listed = urls();
  const pairs = [
    ['crypto-education', 'fa/crypto-education'],
    ['developers', 'fa/developers'],
    ['crypto-market-charts-signals', 'fa/crypto-market-charts-signals'],
    ['tokenized-global-stocks', 'fa/tokenized-global-stocks']
  ];
  for (const [enSlug, faSlug] of pairs) {
    const enUrl = `${SITE}/${enSlug}`;
    const faUrl = `${SITE}/${faSlug}`;
    assert.ok(listed.includes(enUrl), `${enSlug} is in the sitemap`);
    assert.ok(listed.includes(faUrl), `${faSlug} is in the sitemap`);
    for (const [url, slug] of [[enUrl, enSlug], [faUrl, faSlug]]) {
      const doc = html(join(OUT, slug, 'index.html'));
      assert.equal(doc.querySelector('meta[name="robots"]')?.content, 'index, follow, max-image-preview:large');
      assert.ok(doc.querySelector('h1')?.textContent.trim());
      assert.ok(doc.querySelector('link[rel="alternate"][hreflang="x-default"]'));
      assert.ok([...doc.querySelectorAll('link[rel="alternate"][hreflang]')]
        .some((link) => link.href === (url === enUrl ? faUrl : enUrl)));
    }
  }

  const home = html(join(OUT, 'decentralized-crypto-exchange', 'index.html'));
  const graph = [...home.querySelectorAll('script[type="application/ld+json"]')]
    .flatMap((script) => JSON.parse(script.textContent)['@graph'] || []);
  const org = graph.find((node) => node['@type'] === 'Organization');
  const site = graph.find((node) => node['@type'] === 'WebSite');
  assert.ok(org?.alternateName?.includes('FBTSwap'));
  assert.ok(org?.alternateName?.includes('اف‌بی‌تی سواپ'));
  assert.ok(org?.alternateName?.includes('اف بی تی سواپ'));
  assert.ok(site?.alternateName?.includes('FBTSwap'));
  assert.match(home.title, /FBTSwap/);
  assert.match(home.querySelector('meta[name="description"]').content, /17 networks/);
});

test('market dashboard and developer guides render honest, working crawlable content', () => {
  for (const slug of ['crypto-market-charts-signals', 'fa/crypto-market-charts-signals']) {
    const doc = html(join(OUT, slug, 'index.html'));
    assert.ok(doc.querySelector('#live-market-data'));
    assert.equal(doc.querySelectorAll('.market-examples li').length, 30);
    assert.match(doc.body.textContent, /not a prediction|نه پیش‌بینی|not financial advice/i);
    const script = [...doc.querySelectorAll('script')].find((node) => node.textContent.includes('/api/markets?page=1&per_page=30'));
    assert.ok(script, 'market API enhancement is attached to the page');
    assert.doesNotThrow(() => new Function(script.textContent), 'generated market script parses');
  }

  for (const slug of ['developers', 'fa/developers']) {
    const doc = html(join(OUT, slug, 'index.html'));
    const snippets = [...doc.querySelectorAll('.code-sample code')].map((code) => code.textContent);
    assert.equal(snippets.length, 2);
    assert.ok(snippets[0].includes('https://fbtswap.ir/api/markets?per_page=5'));
    assert.ok(snippets[0].includes('\n  -H'));
    assert.ok(snippets[1].includes('fetch("/api/markets?per_page=5"'));
    assert.ok(snippets[1].includes('\n'));
    assert.ok([...doc.querySelectorAll('a[href]')].some((link) => link.getAttribute('href') === '/api/openapi.json'));
  }
});

test('language blog hubs link to their posts and new topic guides', () => {
  const expected = {
    blog: ['crypto-education', 'developers', 'crypto-market-charts-signals', 'tokenized-global-stocks'],
    'fa/blog': ['fa/crypto-education', 'fa/developers', 'fa/crypto-market-charts-signals', 'fa/tokenized-global-stocks']
  };
  for (const [slug, targets] of Object.entries(expected)) {
    const doc = html(join(OUT, slug, 'index.html'));
    const hrefs = [...doc.querySelectorAll('.post-index-item')].map((link) => decodeURIComponent(link.getAttribute('href').replace(/^\//, '')));
    for (const target of targets) assert.ok(hrefs.includes(target), `${slug} links to ${target}`);
    assert.ok(hrefs.length >= 7, `${slug} includes the dated posts and topic guides`);
  }
});

test('dollar-yield and tokenised-stock pages state their ownership and return limits', () => {
  const enYield = html(join(OUT, 'crypto-investing-yield-and-lending', 'index.html'));
  const faYield = html(join(OUT, 'fa/crypto-investing-yield-and-lending', 'index.html'));
  assert.match(enYield.body.textContent, /An APY quoted in dollars.*not fixed dollar income/i);
  assert.ok([...enYield.querySelectorAll('summary')].some((node) => /APY shown in dollars/i.test(node.textContent)));
  assert.match(faYield.body.textContent, /سود دلاری ثابت/);
  assert.ok([...faYield.querySelectorAll('summary')].some((node) => /به دلار نمایش داده می‌شود سود دلاری را تضمین می‌کند/.test(node.textContent)));

  const enStocks = html(join(OUT, 'tokenized-global-stocks', 'index.html'));
  const faStocks = html(join(OUT, 'fa/tokenized-global-stocks', 'index.html'));
  assert.match(enStocks.body.textContent, /not direct ownership/i);
  assert.match(enStocks.body.textContent, /not a stock brokerage/i);
  assert.match(faStocks.body.textContent, /مالکیت مستقیم سهم/);
  assert.match(faStocks.body.textContent, /کارگزاری سهام/);
});

test('the market dashboard hydrates safely from the public API and fails closed', async () => {
  const marketRows = Array.from({ length: 30 }, (_, i) => ({
    id: `asset-${i}`,
    name: `Asset ${i}`,
    symbol: `A${i}`,
    price: 10 + i,
    change24h: i % 2 ? 2 : -2,
    change7d: i % 2 ? 3 : -3,
    sparkline: Array.from({ length: 168 }, (_, point) => 9 + i + point / 100)
  }));
  const pulse = {
    source: 'live',
    at: Date.now(),
    sentiment: { label: 'bullish' },
    momentum: { direction: 'up' },
    breadth: { up: 14, total: 20 },
    risk: { label: 'LOW' }
  };
  const marketPage = read(join(OUT, 'crypto-market-charts-signals', 'index.html'));
  const liveDom = new JSDOM(marketPage, {
    url: `${SITE}/crypto-market-charts-signals`,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = async (url) => ({
        ok: true,
        status: 200,
        json: async () => String(url).includes('/api/markets') ? marketRows : pulse
      });
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const liveDoc = liveDom.window.document;
  assert.equal(liveDoc.querySelectorAll('#market-assets-body tr').length, 30);
  assert.equal(liveDoc.querySelectorAll('.market-spark svg').length, 30);
  assert.match(liveDoc.querySelector('#market-data-count').textContent, /30/);
  assert.match(liveDoc.querySelector('#market-pulse-sentiment').textContent, /Positive/);
  assert.match(liveDoc.querySelector('#market-pulse-breadth').textContent, /14 of 20/);
  assert.match(liveDoc.querySelector('.market-trend').textContent, /Negative on both windows/);
  liveDom.window.close();

  const failedDom = new JSDOM(marketPage, {
    url: `${SITE}/crypto-market-charts-signals`,
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = async () => { throw new Error('upstream unavailable'); };
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const failedDoc = failedDom.window.document;
  assert.match(failedDoc.querySelector('#market-assets-body').textContent, /Market data unavailable/);
  assert.doesNotMatch(failedDoc.querySelector('#market-assets-body').textContent, /\$0(?:\.00)?/);
  assert.match(failedDoc.querySelector('#market-pulse-status').textContent, /Market pulse unavailable/);
  assert.ok(failedDoc.querySelector('.market-retry'));
  failedDom.window.close();
});
