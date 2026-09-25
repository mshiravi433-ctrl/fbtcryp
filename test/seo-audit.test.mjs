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
  assert.ok(pages.some((item) => item['@type'] === 'Organization'));
  assert.ok(pages.some((item) => item['@type'] === 'WebSite'));
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
  const generated = readdirSync(OUT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(OUT, e.name, 'index.html')));
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
  const persianHub = `${SITE}/${encodeURIComponent('وبلاگ')}`;
  assert.ok([...docs.get(`${SITE}/blog`).querySelectorAll('link[hreflang="fa"]')]
    .some((link) => link.href === persianHub), 'English/Persian hubs are a reciprocal translation pair');
});

test('the flagship landing offers visible paths to both guide hubs', () => {
  const doc = html(join(OUT, 'صرافی-غیرمتمرکز', 'index.html'));
  const links = [...doc.querySelectorAll('footer.site a[href]')].map((a) => a.href);
  assert.ok(links.includes(`${SITE}/blog`));
  assert.ok(links.includes(`${SITE}/${encodeURIComponent('وبلاگ')}`));
  assert.ok(links.includes(`${SITE}/crypto-swap-without-kyc`));
  assert.ok(links.includes(`${SITE}/${encodeURIComponent('سواپ-ارز-دیجیتال')}`));
});
