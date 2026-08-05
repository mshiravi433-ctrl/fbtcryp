#!/usr/bin/env node
/**
 * TELL SEARCH ENGINES THE SITE EXISTS — free, no account, instantly.
 * ---------------------------------------------------------------------------
 * Asked for: «سایت جدید را وارد موتور جستجو کن».
 *
 * ─── THE PROBLEM ────────────────────────────────────────────────────────────
 * fbtswap.ir is a brand-new domain. Left alone, a crawler finds it whenever it
 * happens to — which for a new .ir with no inbound links is months, not days.
 * Every landing page we generated, including the Persian one that is our best
 * ranking opportunity, sits unindexed in the meantime.
 *
 * ─── WHY IndexNow AND NOT "SUBMIT TO GOOGLE" ────────────────────────────────
 * Google Search Console needs a human to log in, verify the property and click
 * submit. It cannot be scripted, and the owner works from a phone.
 *
 * IndexNow is a protocol Bing, Yandex, Seznam and Naver all consume from one
 * endpoint. It needs NO account and NO login: ownership is proven by hosting a
 * key file at the site root, which `public/<key>.txt` does. One POST and every
 * participating engine is told.
 *
 * That matters more for us than the Google-shaped hole suggests. Bing powers
 * DuckDuckGo, Ecosia and ChatGPT's browsing; Yandex is heavily used across the
 * region this app targets. And Google still gets the sitemap it reads on its
 * own — this is additive, not a replacement.
 *
 * ─── AND WHY THIS IS NOT SPAM ───────────────────────────────────────────────
 * Their own FAQ, verbatim: "you should publish only URLs changing (added,
 * updated, or deleted) since the time you start to use IndexNow." So this
 * submits the small fixed list of real, server-rendered pages and nothing
 * else — no hash routes, which resolve to the same document and would look
 * like padding.
 *
 * ─── IT RUNS ON EVERY PRODUCTION BUILD ──────────────────────────────────────
 * Chained onto `build:full`, which is what Vercel runs. Doing it by hand was
 * the original plan and it was wrong twice over: the owner works from a phone
 * and cannot run node scripts, and a step someone has to remember after every
 * deploy is a step that stops happening by the third deploy.
 *
 * Safe to run on every build because the URL list is a small fixed set of
 * real pages, and because this script can never fail a deploy — every failure
 * path below exits 0. An SEO nicety must not be able to block a working
 * release.
 *
 * Can still be run by hand:
 *     node scripts/submit-indexnow.mjs
 */

/**
 * The key, which must match the filename in public/.
 *
 * Not a secret in any meaningful sense — it is published at a public URL by
 * design, because that IS the ownership proof. It is deliberately NOT in an
 * env var: if the constant here and the file in public/ ever disagree the
 * submission silently 403s, and keeping them in one repository where a grep
 * finds both is what prevents that.
 */
const KEY = 'b5187e6cbc36ff99eb5f2b97efcdfb6e';

const HOST = 'fbtswap.ir';
const ORIGIN = `https://${HOST}`;

/*
 * Only real, server-rendered URLs. In-app routes are hash-based (/#/swap) and
 * a crawler never sees anything after the '#', so submitting them would send
 * five URLs that all resolve to the same document — which is exactly the
 * pattern engines treat as low-quality.
 *
 * Kept in step with scripts/gen-landing.mjs by hand. A wiring check asserts
 * the two lists agree, because a landing page added there and forgotten here
 * is a page nobody is ever told about.
 */
const SLUGS = [
  '',
  'non-custodial-crypto-swap',
  'crypto-price-alerts-and-dca',
  'crypto-market-history-analysis',
  /* Persian. Percent-encoded: an unencoded non-ASCII path is rejected. */
  'صرافی-غیرمتمرکز'
];

const urlList = SLUGS.map((s) => (s ? `${ORIGIN}/${encodeURIComponent(s)}` : `${ORIGIN}/`));

const body = {
  host: HOST,
  key: KEY,
  /*
   * Served by the API rather than as a static file. Vercel's CDN kept
   * returning 404 for the newly added public/<key>.txt while older static
   * files served normally, and a keyLocation that 404s means every
   * submission is rejected with 403.
   *
   * Bing's docs allow this explicitly: "Host one to many UTF-8 encoded text
   * key files in other locations within the same host ... you must specify
   * the key file location as keyLocation". The static copy stays in public/
   * as a second proof for whenever the CDN catches up.
   */
  keyLocation: `${ORIGIN}/api/indexnow-key/${KEY}.txt`,
  urlList
};

/*
 * api.indexnow.org fans the submission out to every participating engine, so
 * one request reaches Bing, Yandex, Seznam and Naver. Submitting to each
 * engine separately is supported and pointless.
 */
const ENDPOINT = 'https://api.indexnow.org/IndexNow';

async function main() {
  console.log(`▸ submitting ${urlList.length} URLs for ${HOST}`);
  for (const u of urlList) console.log(`  ${u}`);

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    /*
     * Exit 0, not 1. This is an SEO nicety: a network failure here must never
     * fail a deploy pipeline that has already produced a working build.
     */
    console.error(`✗ could not reach IndexNow: ${err.message}`);
    console.error('  (not fatal — the sitemap is still served and crawlers still read it)');
    process.exit(0);
  }

  /* Their documented codes, spelled out — "403" alone is not actionable. */
  const meaning = {
    200: 'accepted',
    202: 'accepted, key validation pending',
    400: 'bad request — the JSON body is malformed',
    403: `key rejected — check ${ORIGIN}/${KEY}.txt is reachable and contains exactly the key`,
    422: 'a URL does not belong to this host, or the key does not match',
    429: 'rate limited — submitting too often'
  };

  console.log(`\n${res.status} — ${meaning[res.status] ?? 'unexpected'}`);
  if (res.status >= 400) {
    console.error('✗ not submitted. Fix the above and re-run.');
    process.exit(0);
  }
  console.log('✓ Bing, Yandex, Seznam and Naver have been told.');
  console.log('  Google reads the sitemap on its own; verify in Search Console.');
}

main();
