/**
 * ─── THE CRAWLABLE REFERENCE BLOCK IS NEVER SHOWN BY THE APP ───────────────
 *
 * `index.html` ships a static, bilingual reference document below `#root`
 * (`#home-hub`): the facts an answer engine must not garble, and the complete
 * map of every published page. It is delivered IN the HTML on purpose — the
 * crawlers named in robots.txt that do not execute JavaScript read it without
 * asking React for anything — and the build injects it from
 * scripts/content/home-hub.mjs.
 *
 * ─── WHAT WAS WRONG ────────────────────────────────────────────────────────
 * Reported: «پایین صفحه FBT Swap · اف‌بی‌تی سواپ اومده با توضیحات و لینک راهنمایی
 * … گفتیم فقط برای صفحات سئو باشد نه صفحات اصلی، صفحات اصلی اپ زشت شده». The
 * first version of this module hid the block on a hand-written list of routes
 * (`#/swap`, `#/intent`, `#/pay/…`, `#/wallet`, `#/buy`) and deliberately kept
 * it on the web homepage — so `#/bridge`, `#/stocks`, `#/orders` and every
 * other screen ended with two thousand words of marketing copy under the app,
 * which is precisely the report.
 *
 * The rule is now one line instead of a list: as soon as the client app takes
 * over — ANY route, browser or packaged, homepage included — the block is
 * hidden. There is no route where it is shown, and that is what makes the
 * list-shaped bug impossible to reintroduce: the next route added cannot be
 * forgotten, because nothing consults a route.
 *
 * ─── WHY IT IS HIDDEN AND NOT REMOVED ──────────────────────────────────────
 * The node stays, and the distinction is the whole point:
 *
 *   • a crawler that does not run JavaScript (the answer engines among them)
 *     reads the delivered HTML and never reaches this file at all;
 *   • a crawler that DOES render the page still finds the content in the DOM —
 *     a `hidden` section is indexed and its links are still followed — rather
 *     than a homepage that renders back to an empty application shell;
 *   • a build that has not injected the generated hub yet (source-only
 *     `vite dev`) has the much shorter `#no-js-content` placeholder in that
 *     slot, and the same call retires it, so dev and production look alike.
 *
 * No user-agent sniffing and no per-visitor document: one file is served to
 * everyone, and the JavaScript the app cannot run without retires the block for
 * the human using it. That is a no-JS fallback, not cloaking.
 */

/**
 * The generated block, and the source-only placeholder that stands in for it
 * until `npm run build` has injected the real thing. Both are retired.
 */
const REFERENCE_BLOCK_IDS = ['home-hub', 'no-js-content'];

/**
 * Retire the reference block in the document the app is rendering into.
 *
 * Called once, before the first React render, from `src/main.jsx`. Hiding is
 * idempotent and one-way: there is no code path in the app that reveals the
 * block again, because returning to the homepage is still the app.
 *
 * @param {object} [options]
 * @param {Document} [options.document] the document to act on (injectable for tests)
 * @returns {number} how many blocks were retired — `0` in a harness with none
 */
export function hideReferenceBlock({ document: doc } = {}) {
  const blocks = REFERENCE_BLOCK_IDS.map((id) => doc?.getElementById?.(id)).filter(Boolean);
  for (const block of blocks) block.hidden = true;
  return blocks.length;
}
