/* eslint-env serviceworker */
/**
 * Service worker: push delivery + a minimal offline shell.
 *
 * Kept deliberately small. An over-eager cache in a market app is a bug
 * factory — showing yesterday's price as if it were live is worse than showing
 * nothing — so API responses are never cached here. Only the static shell is,
 * and even that is network-first so a deploy takes effect immediately.
 */

/*
 * ─── THE VERSION SUFFIX IS LOAD-BEARING ─────────────────────────────────────
 * Bumped v3 -> v4 alongside the theme/header fixes. A v3 cache on an existing
 * install can be holding the previous deploy's index.html — and with it the
 * CSS that broke the black theme and oversized the header logo. Renaming the
 * cache is what evicts that stale HTML from every device already carrying it,
 * without waiting for each asset's own cache entry to expire. (This is the
 * same v2 -> v3 pattern: stale shell HTML names chunk files the server no
 * longer has, which lands the user on the crash screen.)
 *
 * Bump this whenever the shell caching strategy changes OR the shell itself
 * needs to be force-refreshed on every existing install. v4 -> v5: the
 * On-Chain futures chart fix shipped but installs that had cached a pre-fix
 * shell still drew the old "unavailable" chart — renaming the cache evicts
 * that shell on every existing device.
 *
 * v5 -> v6: the notification surface was rebuilt (monochrome brand badge,
 * colour icon, RTL-aware lang/dir, hash-route-aware click targets). The push
 * handler lives in THIS script, so every installed device keeps running the
 * OLD handler — old icon paths, old click routing — until the sw file itself
 * is refetched; renaming the shell cache is what forces that refresh on
 * next navigation, exactly like the stale-HTML evictions above.
 *
 * v6 -> v7: the WalletConnect deep-link fix (lib/wcDeepLink.js +
 * lib/wcAppKitPatch.js). Navigations are network-first here, but the cache
 * fallback above still serves a previously stored index.html — and that
 * document names the OLD hashed chunk, i.e. the code without the fix. A
 * device installed before this deploy can therefore keep reproducing «ارور
 * دیپ‌لینک» on a flaky connection until the cached shell is evicted; renaming
 * the cache is what evicts it, on the PWA and on an in-place APK update alike.
 *
 * v7 -> v8: the WalletConnect pairing surface moved INTO the app
 * (`showQrModal: false` + our own QR/deep-link sheet). Navigations are
 * network-first here, but the cache fallback still serves a previously stored
 * index.html — and that document names the OLD hashed chunk, i.e. the code
 * that still handed the last metre to the SDK's modal. An install from before
 * this deploy would keep reproducing «invalid deep link» / «the QR does
 * nothing» until its cached shell is evicted; renaming the cache evicts it on
 * the PWA and on an in-place APK update alike.
 *
 * v8 -> v9: the wallet hand-off stopped navigating this page away
 * (`window.open(url, '_self')` → a real `<a target="_blank">`, and
 * `openWalletLink()` refusing `_self`/`_top` outright), the SDK modal is the
 * pairing surface again, and the QR gained the spec's 4-module quiet zone.
 * `_self` is the exact mechanism behind «ارور دیپ‌لینک / وصل نمی‌شود»: it
 * replaced the dApp document mid-pairing, so the wallet's approval reached a
 * relay nobody was listening to. An install still holding the v8 shell keeps
 * that behaviour byte for byte until its cached shell is evicted — renaming
 * the cache is what evicts it, on the PWA and on an in-place APK update alike.
 *
 * v9 -> v10: wallet hand-off is now native-first. Trust/Uniswap universal
 * redirectors could open the app after dropping `uri=wc:…`, so users saw the
 * wallet home screen with no proposal. The web now uses native schemes and the
 * APK uses a package-scoped ACTION_VIEW bridge with the raw pairing URI.
 *
 * v10 -> v11: link.trustwallet.com stopped auto-redirecting into the app
 * (it is now a manual download page), so inside Telegram the wallet's own
 * scheme is delivered through a user-gesture window.open() — the delivery
 * Telegram clients actually hand to the OS — with the pairing URI
 * double-encoded on Android, and HTTPS openLink kept only as the last
 * fallback. (Shipped together with the email/social login bundle change.)
 *
 * v10 -> v11 (parallel branch): the zkSync Era + Scroll swap-fix deploy
 * («هیچ توکنی از این دو شبکه کار نمیده» — LI.FI quoting hardened: fee-gate
 * rejects now classify honestly instead of «مسیری بین این دو توکن وجود
 * ندارد», and mis-cased token addresses are normalised before li.quest ever
 * sees them). An install still holding the v10 shell names the OLD hashed
 * chunk, i.e. the code that kept answering «no route» on both chains; the
 * cache rename evicts it on the site and on an in-place APK update alike.
 *
 * v11 -> v12 -> v13: the two deploys above moved the shell name forward in
 * PARALLEL (v11 LI.FI on main, v12 wallet/email on the other branch). The
 * merged tree carries both fixes at once, so it takes a fresh name — v13 —
 * evicting installs pinned to v10, v11 or v12 alike.
 *
 * v13 -> v14: the email/social REDIRECT RETURN fix. The boot marker
 * (`fbt_email_social_connected`) used to be written only after an in-page
 * attach, so a mobile login that left the site for the OTP/OAuth step came
 * back to a fresh document with no reason to look for AppKit's warm session:
 * the wallet never attached until the user tapped a second time. It is now
 * claimed before the modal opens, and handed back by rollbackEmailSocialMarker
 * when the attempt ends with nothing to restore. That behaviour lives in the
 * shell bundle — and for this feature the shell is what decides whether a
 * returning page restores — so an install pinned to v13 keeps reproducing the
 * bug byte for byte. Renaming the cache evicts it on the site and on an
 * in-place APK update alike.
 *
 * v14 -> v15: the email/social session RESTORE was honest-ified (SDK login
 * marker re-armed before createAppKit, 30s window instead of 8s, timeout no
 * longer deletes the boot marker) and a returning page is now re-consulted on
 * pageshow/bfcache as well as on foreground. All of that lives in the shell
 * bundle, and a device pinned to the v14 shell keeps the exact restore path
 * that turned one slow boot into a permanent «کیف پول ساخته نشد» — the shell
 * cache is what decides which of the two a returning user runs. Renaming the
 * cache evicts it on the site and on an in-place APK update alike. (The
 * «بررسی سلامت اتصال» panel ships in the same bundle, so a stale shell would
 * also hide the report that measures the remaining last mile.)
 */
/* v15 held the pre-LI.FI fallback shell on returning web/PWA users. Keep the
 * deployment fix visible to both the website and the installed Android shell.
 *
 * v16 -> v17: the five-network swap fix «سواپ Mon/Mnt/Scr/Zk/Hood خراب شده».
 * The quote engine runs inside the shell bundle, so an install (or returning
 * PWA) pinned to the v16 shell keeps running the old quote code — the exact
 * mechanism behind "کار میکرد، دوباره خراب شد" on devices whose cache
 * outlived earlier deploys: the new bundle was never named for them. Renaming
 * evicts it on the site and on an in-place APK update alike.
 *
 * v17 -> v18: the loan-page repair («صفحه وام را کامل درست کن»: Kamino SDK
 * load states, Solana RPC failover, the BFF markets 503, parallel positions
 * balances, the cross-chain TOKEN_NOT_ALLOWED guard). Every one of those
 * fixes lives in the shell bundle, and the fetch catch above still serves a
 * cached index.html on a flaky connection — so an install pinned to v17 keeps
 * reproducing «ماژول Kamino در دسترس نیست» and «✕ TOKEN_NOT_ALLOWED» byte
 * for byte until its cached shell is evicted. Renaming the cache evicts it on
 * the site and on an in-place APK update alike.
 *
 * v18 -> v19: the lending oracle + Kamino hardening deploy. The oracle is now
 * resolved in two steps (Pool.getAddressesProvider → provider.getPriceOracle):
 * the 2026-09-22 outage had it read off the Pool, which has no such function,
 * so every real RPC reverted and the page kept saying «قیمت‌های اوراکل خوانده
 * نشد»; and a Kamino market read no longer dies because ONE reserve threw.
 * Both fixes live in the shell bundle, and an install pinned to v18 keeps
 * running the old code byte for byte until its cached shell is evicted.
 * Renaming the cache evicts it on the site and on an in-place APK update
 * alike.
 *
 * v19 -> v20: the 2026-09-22/2 double-outage repair + build stamp.
 *   1. The v19 oracle resolution called the WRONG name a second time —
 *      `Pool.getAddressesProvider()` does not exist either (the real getter
 *      is the upper-case `ADDRESSES_PROVIDER()`, IPool.sol §576), so every
 *      live chain answered oracleCode=RPC_ERROR even after v19 shipped.
 *      Canonical → fork-name → static-registry, with `providerVia` naming the
 *      answer. Measured live on 42161 and 8453 before and after.
 *   2. The WalletConnect verify enclave probes stop lying: the reachability
 *      check no longer confuses a CORS block with a dead host, and a real
 *      iframe-load measurement + a gated extended attestation budget back
 *      the «Cannot verify» label with evidence instead of guesswork.
 *   3. window.__FBT_BUILD__ names the exact commit building this shell, so
 *      «تغییرات لایو نمی‌شوند» becomes answerable in one tap instead of a
 *      guess about whether a merge made it to production.
 * Every one of those lives in the shell bundle, so an install pinned to v19
 * keeps the old code byte for byte until its cached shell is evicted.
 *
 * v20 -> v21: the Solana loan actually works now («هنوز مشکل وام سولنا حل نشده
 * … KAMINO_SDK_FAILED»). THREE things were wrong at once, and all three live in
 * this shell:
 *   1. the vendored Kamino bundle threw `ReferenceError: Buffer is not
 *      defined` at module init in every real browser — the Node check script
 *      could not see it because Node has a global Buffer;
 *   2. every `KaminoAction.build*Txns` call used an older signature than the
 *      installed klend-sdk v5 (and `getTransactions()` was read as an object
 *      it no longer returns), so a built action produced an EMPTY list and the
 *      panel reported success without ever opening the wallet;
 *   3. the panel told the wallet every transaction was `versioned: true` while
 *      v5 builds legacy ones — a deserialisation failure before any approval.
 * An install still holding the v20 shell therefore keeps reproducing the old
 * error byte for byte, whatever the server says. The vendor file carries its
 * own cache-buster (?v=3), but the CODE that calls it, and the wallet
 * hand-off, only change when this shell is renamed.
 *
 * v21 -> v22: the 2026-09-23 loan-page round («اتصال با سرور مشکل داره»,
 * «سه‌جا با استرینگ هست», «گاهی اصلا امضا نمی‌کند», «در شبکه سونیک اصلا فریز و
 * قابل وام نیست توکن‌ها»). Every one of the four fixes lives in this shell:
 *   1. the market read named the wrong cause — a 403 from one node plus a 429
 *      from another was reported as «rate limited»; the class is now
 *      status-first, per host, and a node that refused us goes to the BACK of
 *      the candidate list for a while instead of being asked first again;
 *   2. a Solana transaction is now converted to the FORMAT the wallet accepts
 *      (legacy ⇄ v0) instead of being refused before the wallet app opens —
 *      the Android Mobile Wallet Adapter advertises v0 only while the vendored
 *      Kamino SDK v5 builds legacy, and the refusal reached the screen as
 *      «nothing happened»;
 *   3. a frozen reserve is no longer treated as paused: repay and withdraw
 *      stay open (that is how a wound-down Sonic position is closed), the card
 *      stays selectable, and the state is stated in the user's language;
 *   4. every error and toast on the loan surface resolves through one door
 *      (src/lib/loanErrors.js) to a translated sentence — an unknown code now
 *      arrives inside a translated generic that keeps the code for support,
 *      instead of putting the machine string on the screen.
 * An install pinned to v21 keeps running the old code byte for byte until its
 * shell is evicted, so the rename is not cosmetic — without it the fixes never
 * appear on a device that already opened the app.
 *
 * v23 -> v24: the loan tab's Solana panel could not read the Kamino market
 * («رلهٔ خود برنامه — آن گره پاسخ داد، ولی پاسخی که نتوانستیم استفاده کنیم»). The
 * cause was ours, not a node's: the app's own READ-ONLY RPC relay allowed the
 * web3.js name `getMultipleAccountsInfo` while web3.js puts
 * `getMultipleAccounts` on the wire (server/solanaRpcRelay.js), so the second
 * call of every market load — the reserve batch — was refused with `-32601`
 * and the page reported a node-shaped failure. Three things changed and all
 * three live in this shell:
 *   1. the relay forwards the wire method (`getMultipleAccounts`), keeps the
 *      JS-level names working through an alias table, and marks its own
 *      refusals machine-readably (`error.data.relay = true`);
 *   2. a node that ANSWERS with something unusable (a 200 that is not
 *      JSON-RPC) is now remembered for a while instead of being asked first on
 *      every refresh, and a public list that is entirely refusals-or-unusable
 *      moves the relay ahead of it — the reported network path produced a MIX
 *      (403s, a 429, one connection error, two unusable bodies) and the old
 *      rule («every host blocked») learned nothing from it;
 *   3. the loan surface has a sentence for «our own relay does not forward this
 *      request» (`loan.error.RELAY_METHOD_UNAVAILABLE`, all locales) so an
 *      app-side gap can never again be shown as «the node answered, but…» with
 *      advice to configure another RPC.
 *
 * v24 -> v25: the SOLANA SWAP tab told users «موجودی کیف پول کم یا RPC را چک
 * کنید» while their wallet was connected and funded. The connection was never
 * the problem — the read that GATES signing was: one balance lookup from the
 * phone to one public node, whose answer was trusted even when the token's
 * scale was a guess (`decimals ?? 9`, which is 1000x wrong for a 6-decimal
 * mint) or when the mint was Token-2022 (read through the classic spl-token
 * filter, so a real balance came back as exactly 0). Four things changed and
 * all four live in this shell:
 *   1. the swap's balance/mint reads walk every candidate with a named reason
 *      per host (src/lib/solana/chainReads.js) instead of one shot at one node,
 *      and read SOL as an exact string rather than a JSON number;
 *   2. our own backend is the second door for that read
 *      (GET /api/solana/{balances,token-info}), one request for the whole read,
 *      opened ~1.2s after the device and aborted the moment either door answers
 *      — the same «the app's own origin is reachable whenever the app is»
 *      reasoning the loan relay uses, applied to the read that gates a swap;
 *   3. a balance nobody could read is now a NOTICE, not a dead button, and a
 *      scale nobody verified can never decide that a wallet is short
 *      (src/lib/solana/swapPreflight.js); gas includes the 2,100,000 lamport
 *      rent of an output token account that does not exist yet;
 *   4. the wallet health panel grew a «Chain read» row that says which door
 *      answered, from which host, in how many ms — so the next report names the
 *      failing path instead of guessing at it.
 *
 * v25 -> v26 (2026-10-22): the LI.FI fee gate lived in the CLIENT bundle too,
 * and it was reading two fields the API does not return (`fee`,
 * `includedSteps[].action.integratorFees`). A device holding the v25 shell
 * keeps the old JS — and the old gate — no matter what the server does, so the
 * zkSync/Scroll «مشکلی پیش آمده» would survive the deploy on every installed
 * PWA and APK. Renaming the cache evicts that shell.
 *
 * v26 -> v27 (2026-10-24): the Solana quote ladder changed shape — LI.FI is now
 * asked BEFORE a wallet is connected and De¹ is skipped once the server says its
 * Solana chain is off. A device holding the v26 shell keeps the old ladder and
 * would keep pricing through the free Jupiter route, which is the very report
 * this deploy answers.
 *
 * v28 -> v29 (2026-10-25): automatic limit orders. The Orders sheet now has two
 * execution modes, signs CoW EIP-712 orders and Jupiter Trigger transactions in
 * the browser, and the order cards link to explorers. A device holding the v28
 * shell keeps the old sheet, which would create watch-only orders for a user
 * who chose on-chain execution. Renaming the cache evicts that shell. */
/*
 * v29 -> v30 (2026-10-29): the notification design system. The SHADE is drawn
 * by this file, so every installed device keeps running the OLD push handler —
 * no artwork, the old per-stage tags, the old click routing — until sw.js itself
 * is refetched. Renaming the shell cache is what forces that refresh on the PWA
 * and on an in-place APK update alike.
 */
/* v31: version the new rich artwork URL so immutable CDN caches do not keep
   serving the old design to installed PWAs. */
const SHELL = 'fbt-shell-v31';

/*
 * ─── PHASE 94: cachePolicyFor, PUBLIC PAGES ONLY ────────────────────────────
 * This mirrors `cachePolicyFor` in src/lib/intent-ai/offlineQueue.js. A service
 * worker is not part of the bundle graph — it cannot import an ES module that
 * pulls in failureModes.js and termsDiff.js — so the route list is repeated
 * here and the phase-94 probe asserts the two lists are identical. If somebody
 * adds a route to CACHEABLE_ROUTES and forgets this file, the suite fails.
 *
 * The rule the duplication protects: only public, non-personal, non-live pages
 * may be served from cache. A page that reflects a balance, a price, a session
 * or a receipt must hit the network or show nothing — a saved copy of somebody's
 * portfolio is a lie with a timestamp.
 */
const CACHEABLE_ROUTES = ['/', '/about', '/faq', '/terms', '/privacy', '/landing'];

function cachePolicyFor(route) {
  const path = String(route || '');
  const cacheable = CACHEABLE_ROUTES.includes(path) || path.startsWith('/landing');
  return {
    route: path,
    cacheable,
    reason: cacheable ? 'PUBLIC_STATIC' : 'PERSONAL_OR_LIVE',
    servesStalePrices: false
  };
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(['/', '/index.html']).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never serve market data or AI answers from cache.
  if (url.pathname.startsWith('/api/')) return;
  if (request.mode !== 'navigate') return;

  /*
   * ─── ONLY A SUCCESSFUL RESPONSE MAY BE CACHED ───────────────────────────
   * This used to cache `res` unconditionally. A 404, a 502 or a captive
   * portal's login page would therefore be stored as the app shell and served
   * on every subsequent offline load -- turning one bad moment into a
   * permanently broken install.
   *
   * `res.ok` alone is not enough either: a redirect to a Wi-Fi login page is
   * a 200 with `type: 'opaqueredirect'` or a different URL, and caching that
   * as index.html is exactly how a captive portal bricks a PWA.
   */
  /*
   * Phase 94 — the public/personal split. Only a route `cachePolicyFor`
   * approves is ever WRITTEN to the cache. Everything else stays network-only
   * on the way in; on the way out it may still fall back to the app shell, so
   * a private route offline renders the empty shell (which then says it needs
   * a connection) rather than one person's stale account page.
   */
  const policy = cachePolicyFor(url.pathname);

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (policy.cacheable && res && res.ok && res.type === 'basic' && !res.redirected) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => (policy.cacheable
        ? caches.match(request).then((r) => r ?? caches.match('/index.html'))
        : caches.match('/index.html')))
  );
});

/* ------------------------------ push ------------------------------------- */

/*
 * ─── PRESENTATION: THE SHADE IS A BRAND SURFACE ─────────────────────────────
 * «نوار نوتیفیکیشن موبایل باید مدرن باشد: لوگو، رنگ‌ها و تم درست» — and, since
 * then, «دیزاین باید مثل نوار نوتیفیکیشن اندروید/آیفون باشد، پس‌زمینه‌اش
 * هم‌گام با سود و ضرر رنگ عوض کند».
 *
 * This handler runs when the SITE IS CLOSED too — the service worker is woken by
 * the push service itself — so everything the notification needs must be
 * resolvable here, with no page alive:
 *
 *   image   THE DESIGN. The wide artwork (the gradient card with our mark, the
 *           big number and the progress rail), rendered by the server at
 *           /api/notif/banner.png. Chrome, Edge and Firefox on Android draw it
 *           as a BigPicture card — the same shape as the reference designs. iOS
 *           ignores `image`, which is why the title, the body and the colour
 *           are also made to carry the message on their own.
 *   tone    the six-tone palette in src/lib/notificationDesign.js. The server
 *           resolves it (profit/loss/pending/ready/alert/info) and sends it as
 *           `tone` + `color`; this file only needs the DEFAULT, so a payload
 *           from an older server still renders on-brand.
 *   icon    the colour brand mark on FBT black.
 *   badge   the MONOCHROME mark — Chrome/Android silhouette the badge slot, so
 *           feeding it the colour artwork produces a white blob.
 *   lang    Persian first: the shade renders the OS's font/shaping.
 *   dir     resolved from lang, not 'auto' — 'auto' guesses per string and
 *           mixed bidi («BTC به ۶۵٬۰۰۰ رسید») renders ragged.
 *   tag     ONE CARD PER ORDER, NOT PER STAGE. The server now sends the same tag
 *           for pending → ready → closed, and `renotify` is what makes Android
 *           buzz again for the update instead of silently swapping the text.
 */

/* Kept in sync with TONES in src/lib/notificationDesign.js by the design probe
   in test/notification-design-probe.mjs (it parses both files). Only the
   fallbacks live here: the server always sends the real tone. */
const TONE_COLOR = {
  profit: '#00E58A',
  loss: '#FF1744',
  pending: '#FFB300',
  ready: '#00C853',
  alert: '#FF6BD6',
  info: '#5B8CFF'
};
const TONE_VIBRATE = {
  profit: [70, 50, 40, 50, 140],
  loss: [160, 80, 160, 80, 220],
  pending: [30, 40, 30],
  ready: [80, 50, 80, 50, 160],
  alert: [120, 60, 120],
  info: [40, 60, 40]
};
/** Money news pins itself to the shade; a digest is allowed to fade. */
const URGENT_TONES = ['profit', 'loss', 'ready', 'alert'];

const RTL_LANGS = ['fa', 'ar', 'ur', 'he', 'ckb', 'sd', 'ps'];
const dirFor = (lang) => (RTL_LANGS.includes(String(lang).split('-')[0]) ? 'rtl' : 'ltr');

/**
 * Turn one push payload into `showNotification()` options.
 *
 * Exported as a plain function (not a closure) so the SAME shape is used by the
 * push handler and by the in-app preview message the Settings screen sends —
 * a preview that renders differently from the real thing is worse than none.
 */
function buildNotification(payload = {}) {
  const tone = TONE_COLOR[payload.tone] ? payload.tone : 'info';
  const lang = payload.lang || 'fa';
  const stage = payload.stage || '';
  const progress = Number.isFinite(Number(payload.progress)) && payload.progress !== null && payload.progress !== ''
    ? Math.max(0, Math.min(100, Math.round(Number(payload.progress))))
    : null;

  /*
   * The artwork URL. Built from the payload when the server did not send one —
   * `image` must be ABSOLUTE because the notification renderer, not this page,
   * fetches it.
   */
  const image = payload.image
    || `/api/notif/banner.png?t=${encodeURIComponent(tone)}&d=2${
      payload.value ? `&v=${encodeURIComponent(payload.value)}` : ''
    }${payload.label ? `&l=${encodeURIComponent(payload.label)}` : ''}${
      payload.kicker ? `&k=${encodeURIComponent(payload.kicker)}` : ''
    }${progress != null ? `&p=${progress}` : ''}`;

  const actions = Array.isArray(payload.actions) && payload.actions.length
    ? payload.actions.slice(0, 2)
    : [{ action: 'open', title: lang.startsWith('fa') ? 'باز کردن' : 'Open' }];

  return {
    body: payload.body || '',
    icon: payload.icon || '/notification/icon-color-192.png',
    badge: payload.badge || '/notification/badge-96.png',
    /* THE DESIGN — the wide card. */
    image,
    /* Brand tint for the row's app name / LED on platforms that use it. */
    color: payload.color || TONE_COLOR[tone],
    tag: payload.tag || (stage ? `fbt-${stage}` : 'fbt'),
    /*
     * `renotify` + a `tag` is the difference between "a new card" and "a card
     * that changed": an order moving pending → ready keeps ONE row and buzzes
     * again, instead of leaving three rows that no longer agree with each other.
     * It requires a tag, which is always set above.
     */
    renotify: payload.renotify !== false,
    lang,
    dir: payload.dir || dirFor(lang),
    /*
     * requireInteraction keeps a money card on screen until it is dealt with.
     * A target hit that slides away in four seconds while the phone is face-down
     * is a missed trade; a daily digest that pins itself is an imposition.
     */
    requireInteraction: payload.requireInteraction != null
      ? Boolean(payload.requireInteraction)
      : URGENT_TONES.includes(tone),
    vibrate: Array.isArray(payload.vibrate) && payload.vibrate.length
      ? payload.vibrate
      : TONE_VIBRATE[tone],
    silent: payload.silent === true,
    timestamp: Number(payload.timestamp) || Date.now(),
    actions,
    data: {
      url: payload.url || '/',
      stage,
      tone,
      progress,
      value: payload.value || '',
      color: payload.color || TONE_COLOR[tone]
    }
  };
}

/**
 * OUR SOUND, WHENEVER A PAGE IS ALIVE TO PLAY IT.
 *
 * The web has no way to put a custom tone on a notification: Chrome removed
 * `sound` from the spec's implementations years ago and no other engine added
 * it. So the tone is played by an OPEN client (src/lib/notify.js listens for
 * this message and runs the same synthesised chime the app uses in-app), while
 * the CLOSED case falls back to the platform chime. That is the honest ceiling
 * on the web — the APK gets the real custom tone through its notification
 * channel — and pretending otherwise is how this feature gets reported as
 * broken for the third time.
 */
async function ringOpenClients(tone) {
  try {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of list) {
      client.postMessage({ type: 'fbt-push-tone', tone });
    }
  } catch {
    /* no clients, or none listening: the OS chime still happened */
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'FBT Swap', body: event.data ? event.data.text() : '' };
  }

  const options = buildNotification(payload);
  const title = payload.title || 'FBT Swap';

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      ringOpenClients(options.data.tone)
    ])
  );
});

/*
 * ─── THE SETTINGS PREVIEW ───────────────────────────────────────────────────
 * «نوتیفیکیشن‌هایی که در صفحهٔ تنظیمات می‌آید باید روی گوشی هم بیاید با صدا.»
 * The Settings screen renders a live preview of each tone; tapping it posts this
 * message so the user can see AND hear the real thing on their own phone before
 * they trust it with an order. It goes through buildNotification(), so what they
 * preview is byte-for-byte what a real alert looks like.
 */
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type !== 'fbt-preview-notification') return;
  const options = buildNotification({ ...(msg.payload || {}), tag: 'fbt-preview' });
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(msg.payload?.title || 'FBT Swap', options),
      ringOpenClients(options.data.tone)
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data?.url || '/';
  /*
   * The app is a HashRouter SPA: its routes live AFTER '#', so navigating a
   * client to '/predict' lands on the home screen and silently drops the
   * deep link the notification promised. Absolute http(s) URLs (the native
   * app's public origin) pass through untouched; app paths get the hash.
   */
  const target = /^https?:\/\//.test(raw)
    ? raw
    : raw.startsWith('/#')
      ? `${self.location.origin}${raw}`
      : raw.startsWith('#')
        ? `${self.location.origin}/${raw}`
        : `${self.location.origin}/#${raw.startsWith('/') ? raw : `/${raw}`}`;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate?.(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

/*
 * Closing a card is information too.
 *
 * A user who swipes a «در انتظار» card away is telling us they saw it, so the
 * open app marks that notification read in its inbox and the bell stops nagging
 * about something already dealt with.
 */
self.addEventListener('notificationclose', (event) => {
  const data = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) client.postMessage({ type: 'fbt-push-dismissed', tag: event.notification.tag, data });
    })
  );
});
