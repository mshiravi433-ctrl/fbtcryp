#!/usr/bin/env node
/**
 * REQUEST URL REFRESHES FROM PARTICIPATING ENGINES — no account required.
 * ---------------------------------------------------------------------------
 * Asked for: «سایت جدید را وارد موتور جستجو کن».
 *
 * ─── DISCOVERY, NOT AN INDEXING GUARANTEE ───────────────────────────────────
 * This script sends explicit URLs to engines that participate in IndexNow.
 * It cannot establish which URLs Google currently has indexed, and a 200
 * response does not guarantee that any engine will crawl, index or rank them.
 * Check Google Search Console after the production deployment for that proof.
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
 * IndexNow is additive to a sitemap, not a Google submission mechanism.
 * Google does not use IndexNow for URL submission; it discovers URLs through
 * crawling and the sitemap, and Search Console is where owners inspect status.
 * A sitemap or accepted IndexNow request still does not imply indexation.
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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEY = 'b5187e6cbc36ff99eb5f2b97efcdfb6e';

const HOST = 'fbtswap.ir';
const ORIGIN = `https://${HOST}`;

/*
 * ─── THE URL LIST IS DERIVED, NOT MAINTAINED ────────────────────────────────
 * This used to be a hand-written array of about thirty slugs kept "in step
 * with gen-landing.mjs by hand". That worked while there were thirty pages.
 * There are now over 250, and a hand-copied list is a list that is wrong —
 * silently, in the direction of never telling anyone about the new pages.
 *
 * So the URLs come from the sitemap the build just wrote. Same source as the
 * one submitted to Search Console, no second place to forget.
 *
 * ─── AND IT SUBMITS ONLY WHAT CHANGED ───────────────────────────────────────
 * IndexNow's own guidance: "you should publish only URLs changing (added,
 * updated, or deleted) since the time you start to use IndexNow." Blasting
 * all 250 URLs on every deploy would ignore that.
 *
 * The sitemap now carries a <lastmod> taken from each page's editorial date,
 * so that guidance is directly actionable: submit the URLs whose content
 * actually changed recently, and submit nothing at all when nothing did. A
 * deploy that only touches JavaScript notifies no one, which is correct.
 */
const WINDOW_DAYS = 30;

function readSitemapUrls() {
  const OUT = 'dist';
  const root = join(OUT, 'sitemap.xml');
  if (!existsSync(root)) return [];

  const locs = (xml) => [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: /<loc>([^<]+)<\/loc>/.exec(m[1])?.[1]?.trim(),
    lastmod: /<lastmod>([^<]+)<\/lastmod>/.exec(m[1])?.[1]?.trim() || null
  }));

  const rootXml = readFileSync(root, 'utf8');
  const children = [...rootXml.matchAll(/<sitemap>\s*<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  if (!children.length) return locs(rootXml);

  const out = [];
  for (const child of children) {
    const file = join(OUT, child.replace(`${ORIGIN}/`, ''));
    if (existsSync(file)) out.push(...locs(readFileSync(file, 'utf8')));
  }
  return out;
}

const all = readSitemapUrls().filter((u) => u.loc);
const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
const urlList = all
  .filter((u) => {
    if (!u.lastmod) return false; // no editorial date means nothing claimed to change
    const t = Date.parse(u.lastmod);
    return Number.isFinite(t) && t >= cutoff;
  })
  .map((u) => u.loc)
  .slice(0, 10000); // protocol maximum per request

if (!all.length) {
  console.log('▸ IndexNow: no sitemap in dist/ — nothing to submit (run after the build).');
  process.exit(0);
}
if (!urlList.length) {
  console.log(
    `▸ IndexNow: ${all.length} URLs published, none with a <lastmod> inside ${WINDOW_DAYS} days — nothing changed, submitting nothing.`
  );
  process.exit(0);
}
console.log(`▸ IndexNow: submitting ${urlList.length} of ${all.length} published URLs (changed within ${WINDOW_DAYS} days).`);

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
  console.log('✓ IndexNow accepted the URL notification for participating engines.');
  console.log('  This is not a crawl/index/rank guarantee and does not submit URLs to Google.');
  console.log('  Verify Google discovery and indexing in Search Console after deployment.');
}

main();
