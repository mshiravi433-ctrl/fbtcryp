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
const urls = () => {
  assert.ok(existsSync(join(OUT, 'sitemap.xml')), 'run npm run build before npm run test:seo');
  const doc = new JSDOM(read(join(OUT, 'sitemap.xml')), { contentType: 'text/xml' }).window.document;
  assert.equal(doc.querySelector('parsererror'), null, 'sitemap is valid XML');
  return [...doc.querySelectorAll('url > loc')].map((loc) => loc.textContent);
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
