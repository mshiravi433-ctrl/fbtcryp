import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { BRAND_ALIASES, INDEXABLE_ROBOTS, HOME_CONTENT_UPDATED, DISCOVERY_COPY } from '../scripts/content/discovery.mjs';
import { injectHomeHub } from '../scripts/content/home-hub.mjs';
import { hideReferenceBlock } from '../src/lib/homeHub.js';

const OUT = 'dist';
const SITE = 'https://fbtswap.ir';
const XHTML = 'http://www.w3.org/1999/xhtml';
const read = (path) => readFileSync(path, 'utf8');
const canon = (url) => url === `${SITE}/` ? url : url.replace(/\/+$/, '');
const graph = (doc) => [...doc.querySelectorAll('script[type="application/ld+json"]')]
  .flatMap((script) => { const data = JSON.parse(script.textContent); return data['@graph'] || [data]; });
const documents = new Map();
const documentAt = (url) => {
  const key = canon(url);
  if (!documents.has(key)) {
    const slug = decodeURI(new URL(url).pathname).replace(/^\/+|\/+$/g, '');
    documents.set(key, new JSDOM(read(join(OUT, slug, 'index.html'))).window.document);
  }
  return documents.get(key);
};
const sitemap = () => ['sitemap-en.xml', 'sitemap-fa.xml'].flatMap((name) => {
  const doc = new JSDOM(read(join(OUT, name)), { contentType: 'text/xml' }).window.document;
  assert.equal(doc.querySelector('parsererror'), null, `${name} is valid XML`);
  return [...doc.querySelectorAll('url')].map((entry) => ({
    url: entry.querySelector('loc').textContent,
    lastmod: entry.querySelector('lastmod')?.textContent,
    alternates: [...entry.getElementsByTagNameNS(XHTML, 'link')]
      .map((link) => `${link.getAttribute('hreflang')}|${canon(link.getAttribute('href'))}`).sort()
  }));
});
const pairs = ['fbt-swap', 'crypto-profit-and-risk', 'crypto-access-and-restrictions']
  .map((slug) => [slug, `fa/${slug}`]);

/*
 * ─── THE REFERENCE DOCUMENT IS FOR CRAWLERS, NEVER FOR THE APP ─────────────
 * Reported: «پایین صفحه FBT Swap · اف‌بی‌تی سواپ اومده با توضیحات و لینک
 * راهنمایی … گفتیم فقط برای صفحات سئو باشد نه صفحات اصلی، صفحات اصلی اپ زشت
 * شده». The delivered HTML must keep the whole document (a crawler that does
 * not run JavaScript reads it), and the app must show NONE of it — on any
 * route. Both halves are asserted here, because a regression in either one
 * fails silently in production: hiding it in the delivered document loses the
 * crawlable homepage, and showing it in the app is the bug being fixed.
 */
test('the homepage reference document ships in the HTML and is never shown by the app', () => {
  const home = documentAt(`${SITE}/`);
  const root = home.getElementById('root');
  const hub = home.getElementById('home-hub');
  assert.ok(root && hub);
  assert.ok(root.compareDocumentPosition(hub) & 4, '#root precedes #home-hub in DOM order');
  assert.equal(hub.hidden, false, 'the delivered homepage has visible reference content');
  assert.equal(hub.querySelectorAll('.search-guides').length, 2);

  const main = read('src/main.jsx');
  assert.match(main, /hideReferenceBlock\(\{ document \}\)/,
    'the app retires the block before its first React render');
  assert.doesNotMatch(main, /syncHomeHub/,
    'visibility is no longer decided per route — nothing may re-show it on the homepage');
  assert.doesNotMatch(main, /window\.addEventListener\('hashchange'/,
    'and no route listener resurrects it either');
  assert.doesNotMatch(main, /homeHub\.remove\(|home-hub['"]\)[\s\S]{0,100}\.remove\(/,
    'the node is hidden, never deleted: a rendering crawler must still find it');

  assert.match(read('scripts/content/home-hub.mjs'), /#boot, #root:empty \{ display: none !important; \}/,
    'no-JS readers do not get a blank viewport above the reference document');
  assert.match(read('scripts/content/home-hub.mjs'), /#home-hub\[hidden\] \{ display: none !important; \}/,
    'the hidden block cannot be re-shown by a later author display rule');
});

test('every app view retires the block, and the content survives for the next crawl', () => {
  const dom = new JSDOM('<div id="root"></div><div id="home-hub"><a href="/fa/fbt-swap">اف بی تی</a></div>');
  const doc = dom.window.document;
  const hub = doc.getElementById('home-hub');
  assert.equal(hideReferenceBlock({ document: doc }), 1);
  assert.equal(hub.hidden, true, 'the app never shows the reference block');
  assert.equal(doc.getElementById('home-hub'), hub, 'the node is retained');
  assert.ok(hub.querySelector('a'), 'content is retained in the DOM for rendering crawlers');
  assert.equal(hideReferenceBlock({ document: doc }), 1);
  assert.equal(hub.hidden, true, 'a second call neither throws nor un-hides it');

  /* The source-only placeholder is retired by the same call, so a `vite dev`
     document and a built one behave identically for the visitor. */
  const dev = new JSDOM('<div id="root"></div><main id="no-js-content"><a href="/fa/">راهنما</a></main>');
  assert.equal(hideReferenceBlock({ document: dev.window.document }), 1);
  assert.equal(dev.window.document.getElementById('no-js-content').hidden, true);

  assert.equal(hideReferenceBlock({ document: new JSDOM('<div id="root"></div>').window.document }), 0);
  assert.equal(hideReferenceBlock(), 0, 'a document-less call is a no-op, not a crash');
  dom.window.close();
  dev.window.close();
});

test('homepage injection is idempotent and rejects missing or incorrectly positioned markers', () => {
  const markers = '<!-- HOME-HUB:START --><p>old</p><!-- HOME-HUB:END -->';
  const source = `<body><div id="root"></div>${markers}</body>`;
  const inject = (html) => injectHomeHub({ file: 'fixture.html', html, hub: '<div id="home-hub">Readable content</div>' });
  assert.equal(inject(inject(source)), inject(source));
  assert.throws(() => inject('<body><div id="root"></div></body>'), /missing/);
  assert.throws(() => inject(`<body>${markers}<div id="root"></div></body>`), /must precede/);
  assert.throws(() => inject(`<body>${markers}</body>`), /must precede/);
});

test('all HTML pages keep topic and discovery navigation at the bottom, not above the logo', () => {
  for (const { url } of sitemap()) {
    const doc = documentAt(url);
    const discoveries = [...doc.querySelectorAll('.search-guides')];
    assert.ok(discoveries.length, `${url} has reference navigation`);
    if (url === `${SITE}/`) continue;
    const risk = doc.querySelector('.risk-panel');
    assert.ok(risk, `${url} has a risk notice`);
    for (const nav of [...discoveries, ...doc.querySelectorAll('.section-nav')]) {
      assert.equal(nav.closest('header'), null, `${url}: reference links are not in the header`);
      assert.ok(risk.compareDocumentPosition(nav) & 4, `${url}: reference links follow the main content`);
    }
    const hero = doc.querySelector('header.hero-panel');
    if (hero) {
      assert.ok(hero.firstElementChild.classList.contains('brand-row'), `${url}: logo row is first`);
      assert.equal(hero.querySelector('.section-nav'), null, `${url}: no topic keywords above the logo`);
      assert.ok(doc.querySelector('.topics-panel .section-nav'));
    }
  }
});

test('brand aliases and useful excerpt directives agree on every public HTML page', () => {
  for (const { url } of sitemap()) {
    const doc = documentAt(url);
    assert.equal(doc.querySelector('meta[name="robots"]')?.content, INDEXABLE_ROBOTS, url);
    assert.ok(doc.querySelector('link[rel="alternate"][type="application/rss+xml"]'), `${url}: feed discovery`);
    const data = graph(doc);
    for (const type of ['Organization', 'WebSite']) {
      const entity = data.find((item) => item['@type'] === type);
      assert.deepEqual(entity?.alternateName, BRAND_ALIASES, `${url}: ${type} aliases`);
      assert.ok(!entity.alternateName.some((alias) => /^(swap|crypto)$/i.test(alias)));
    }
  }
});

test('sitemap language annotations mirror HTML, including self and reciprocal references', () => {
  const entries = sitemap();
  const byUrl = new Map(entries.map((entry) => [canon(entry.url), entry]));
  for (const entry of entries) {
    const doc = documentAt(entry.url);
    const head = [...doc.querySelectorAll('link[rel="alternate"][hreflang]')]
      .map((link) => `${link.getAttribute('hreflang')}|${canon(link.href)}`).sort();
    assert.deepEqual(entry.alternates, head, entry.url);
    for (const alternate of head) {
      const [language, url] = alternate.split('|');
      const mate = byUrl.get(canon(url));
      assert.ok(mate, `${entry.url}: ${language} alternate is a real generated URL`);
      if (language !== 'x-default') {
        assert.ok(mate.alternates.some((back) => back.split('|')[1] === canon(entry.url)), `${entry.url}: reciprocal sitemap alternate`);
      }
    }
    if (entry.lastmod) {
      assert.equal(graph(doc).find((item) => item['@type'] === 'WebPage')?.dateModified, entry.lastmod, entry.url);
    }
  }
  assert.equal(byUrl.get(`${SITE}/`).lastmod, HOME_CONTENT_UPDATED);
  assert.equal(byUrl.get(`${SITE}/decentralized-crypto-exchange`).lastmod, HOME_CONTENT_UPDATED);
});

test('new bilingual intent pages have distinct content, dates and visible FAQ answers matching schema', () => {
  const listed = new Map(sitemap().map((entry) => [canon(entry.url), entry]));
  for (const pair of pairs) for (const slug of pair) {
    const url = `${SITE}/${slug}`;
    assert.ok(listed.has(url), `${slug}: listed in the sitemap, not a fragment route`);
    const doc = documentAt(url);
    const data = graph(doc);
    const article = data.find((item) => item['@type'] === 'Article');
    assert.equal(article?.datePublished, '2026-10-13', slug);
    assert.equal(article?.dateModified, '2026-10-13', slug);
    assert.equal(doc.documentElement.lang, slug.startsWith('fa/') ? 'fa' : 'en');
    assert.equal(doc.documentElement.dir, slug.startsWith('fa/') ? 'rtl' : 'ltr');
    const visible = [...doc.querySelectorAll('.faq-list details')];
    const questions = data.find((item) => item['@type'] === 'FAQPage')?.mainEntity;
    assert.equal(visible.length, questions?.length, slug);
    assert.ok(visible.length >= 4, slug);
    visible.forEach((detail, index) => {
      assert.equal(detail.querySelector('summary span').textContent, questions[index].name);
      assert.equal(detail.querySelector('p').textContent, questions[index].acceptedAnswer.text);
    });
    const breadcrumbs = data.find((item) => item['@type'] === 'BreadcrumbList').itemListElement;
    assert.equal(doc.querySelectorAll('.crumb a').length + 1, breadcrumbs.length, `${slug}: visible hierarchy matches the schema`);
    assert.match(doc.querySelector('.post-meta').textContent, /FBT Swap/);
  }
});

test('profit and sanctions queries receive bounded, factual answers rather than promises', () => {
  const profitEn = documentAt(`${SITE}/crypto-profit-and-risk`);
  const profitFa = documentAt(`${SITE}/fa/crypto-profit-and-risk`);
  const accessEn = documentAt(`${SITE}/crypto-access-and-restrictions`);
  const accessFa = documentAt(`${SITE}/fa/crypto-access-and-restrictions`);
  assert.match(profitEn.querySelector('.story-copy').textContent, /never guaranteed/);
  assert.match(profitFa.querySelector('.story-copy').textContent, /تضمینی نیست/);
  assert.match(profitEn.querySelector('.post-body').textContent, /hypothetical/);
  assert.match(profitEn.querySelector('.post-body').textContent, /\$16\.07 loss/);
  assert.equal(Number((10 - 7 - 7.07 - 8 - 4).toFixed(2)), -16.07);
  assert.match(accessEn.querySelector('.story-copy').textContent, /does not guarantee/);
  assert.match(accessFa.querySelector('.story-copy').textContent, /تضمین نمی‌کند/);
  assert.match(accessEn.querySelector('.post-body').textContent, /issuer-administered/);
  assert.match(accessFa.querySelector('.post-body').textContent, /صادرکننده/);
});

test('AI briefs and both homepage languages link directly to the requested search intents', () => {
  const home = documentAt(`${SITE}/`);
  const short = read(join(OUT, 'llms.txt'));
  const full = read(join(OUT, 'llms-full.txt'));
  assert.match(short, /Brand identity/);
  assert.match(short, /no FBT KYC is not a guarantee/);
  assert.match(short, /سود با کریپتو تضمینی نیست/);
  for (const lang of ['en', 'fa']) {
    const links = [...home.querySelectorAll(`.search-guides[lang="${lang}"] a`)].map((a) => a.getAttribute('href'));
    for (const [slug] of DISCOVERY_COPY[lang].links) assert.ok(links.includes(`/${slug}`));
  }
  for (const pair of pairs) for (const slug of pair) {
    assert.ok(short.includes(`${SITE}/${slug}`), `short brief includes ${slug}`);
    assert.ok(full.includes(`${SITE}/${slug}`), `full brief includes ${slug}`);
  }
});

test('IndexNow is production-only by default and dry-run cannot send a request', () => {
  const env = { ...process.env, VERCEL_ENV: 'preview', INDEXNOW_DISABLED: '' };
  const run = (...args) => execFileSync(process.execPath, ['scripts/submit-indexnow.mjs', ...args], { env, encoding: 'utf8', timeout: 15000 });
  assert.match(run(), /skipped outside a production deployment/);
  const output = run('--dry-run');
  const recent = sitemap().filter((entry) => {
    const date = Date.parse(entry.lastmod || '');
    return Number.isFinite(date) && date >= Date.now() - 30 * 86400000 && date <= Date.now();
  });
  if (!recent.length) {
    assert.match(output, /nothing changed, submitting nothing/);
    return;
  }
  assert.match(output, /no engine was contacted/);
  const start = output.indexOf('{');
  const end = output.indexOf('\n}', start) + 2;
  const body = JSON.parse(output.slice(start, end));
  assert.equal(body.dryRun, true);
  assert.equal(body.host, 'fbtswap.ir');
  assert.deepEqual(body.urlList.sort(), recent.map((entry) => entry.url).sort());
  assert.ok(body.urlList.every((url) => url.startsWith(`${SITE}/`) && !url.includes('#')));
});
