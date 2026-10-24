/**
 * SOLANA SWAP — WHICH ROUTE RUNS, AND IN WHAT ORDER
 * ---------------------------------------------------------------------------
 * Extracted from pages/SolanaSwap.jsx so the money decision can be asserted
 * without a browser, a wallet or an upstream.
 *
 * ─── THE RULE THIS MODULE ENCODES ──────────────────────────────────────────
 * There are four ways to move tokens on Solana from this screen, and they are
 * NOT interchangeable:
 *
 *   openocean  De¹/OpenOcean v4   — pays us 70 bps (80% net). Keyless on the
 *                                   public root, keyed on the enterprise one.
 *                                   Since 2026-10-24 its Solana chain answers
 *                                   «This chain is no longer supported», so it
 *                                   is asked, reported and skipped — never
 *                                   silently trusted. Signs + WE broadcast.
 *   lifi       LI.FI (SVM)        — pays our wallet per request through
 *                                   `distributionFees`, no key, and (since
 *                                   2026-10-24) prices even without a wallet:
 *                                   the server quotes against our own fee
 *                                   wallet and drops the transaction. Signs +
 *                                   WE broadcast.
 *   jupfee     Jupiter Swap API   — pays us `platformFeeBps` into a fee token
 *              (Metis, /swap/v1)    account we own. No key, no referral
 *                                   program. Signs + WE broadcast.
 *   jupiter    Jupiter Swap API   — earns NOTHING. Its V2 `/order` fee is the
 *              V2 (/order)          Referral Program, which needs on-chain
 *                                   accounts the payout wallet has no SOL to
 *                                   create, and Jupiter documents that failure
 *                                   as silent. Signs ONLY; Jupiter's own
 *                                   /execute lands it.
 *
 * Two of those four differ only in whether we are paid, and one pair differs in
 * how the transaction is signed and sent. Getting the order or the signing
 * wrong is not a cosmetic bug: the first silently converts paid volume into
 * free volume, the second leaves a signed transaction that nobody submits
 * while the UI reports success.
 *
 * ─── WHY THE PRICED PROVIDER BUILDS FIRST ──────────────────────────────────
 * The number the user consented to is the pricing provider's number. Building
 * with a DIFFERENT provider hands them a different price — and if the priced
 * route was a paid one, "different" means "cheaper for us", which the user
 * never agreed to. So the priced provider is always tried first, and a
 * fallback is only ever a fallback.
 *
 * ─── AND WHY THE FREE ROUTE IS LAST ────────────────────────────────────────
 * When the priced provider cannot build (its upstream degraded between the
 * quote and the tap), the remaining order is paid-first. A paid route that is
 * still alive must win over a free one; the free route is the last resort that
 * keeps the user's swap possible, never a preference.
 */

/** Every route this screen knows, in the order a fallback ladder walks them. */
export const SOLANA_ROUTE_PROVIDERS = ['openocean', 'lifi', 'jupfee', 'jupiter'];

/** The routes that pay us. Everything else is the free fallback. */
export const PAID_SOLANA_PROVIDERS = ['openocean', 'lifi', 'jupfee'];

/** The one route that earns nothing, kept last on purpose. */
export const FREE_SOLANA_PROVIDER = 'jupiter';

/** True when this provider collects a platform fee for us. */
export const isPaidSolanaProvider = (provider) =>
  PAID_SOLANA_PROVIDERS.includes(String(provider));

/**
 * The name of the route the user is about to take.
 *
 * A map rather than a ternary so a new provider cannot ship wearing the
 * previous one's name — the exact bug class that put "OpenOcean" on Jupiter
 * quotes before this screen grew a third source.
 *
 * Both Jupiter routes are labelled "Jupiter" because both ARE Jupiter; the fee
 * line beside the label is what tells them apart, and it is read from the
 * quote itself rather than from the provider id.
 */
export const ROUTER_LABEL = {
  openocean: 'OpenOcean',
  lifi: 'LI.FI',
  jupfee: 'Jupiter',
  jupiter: 'Jupiter'
};

/** Display name, with a safe default for an id this map has never seen. */
export const solanaRouteLabel = (provider) => ROUTER_LABEL[provider] || ROUTER_LABEL.openocean;

/**
 * The build order for a swap whose price came from `pricedProvider`.
 *
 * Priced provider first (consent), then the other PAID routes, then the free
 * one. An unknown id is treated as "no preference" and the canonical ladder is
 * returned unchanged, so a typo in a provider string degrades to the safe order
 * instead of dropping the free fallback off the end.
 */
export function solanaBuildOrder(pricedProvider) {
  const priced = String(pricedProvider || '');
  if (!SOLANA_ROUTE_PROVIDERS.includes(priced)) return [...SOLANA_ROUTE_PROVIDERS];
  const rest = SOLANA_ROUTE_PROVIDERS.filter((p) => p !== priced);
  /* Paid before free among the rest — see the module header. */
  const paid = rest.filter(isPaidSolanaProvider);
  const free = rest.filter((p) => !isPaidSolanaProvider(p));
  return [priced, ...paid, ...free];
}

/**
 * Which providers the QUOTE should ask, in the order they are worth waiting
 * for.
 *
 * Two filters, both about not wasting the user's patience:
 *
 *  • A paid route the server says it cannot pay with is not asked at all.
 *    `routes` is the answer of GET /api/solana/routes; a missing entry (an old
 *    backend, a blocked call) means "unknown", and unknown is asked — refusing
 *    to try because we could not confirm is how a working route gets skipped.
 *  • LI.FI cannot price without a wallet address (its quote carries the
 *    transaction), so it joins only once an account is connected. Before that
 *    the price comes from the two routes that do not need one.
 *
 * The free Jupiter route is NOT in this list: it is the fallback the caller
 * runs when nothing here produced a price, and asking it in parallel would make
 * the cheapest-to-answer route win the race on latency alone — which is exactly
 * how a screen ends up showing zero fees while paid routes were still alive.
 */
export function solanaQuoteProviders({ address = null, routes = null } = {}) {
  const de1 = routes?.de1 ?? routes?.openocean ?? null;
  const lifi = routes?.lifi ?? null;
  const jupfee = routes?.jupfee ?? null;

  const out = [];
  /*
   * ─── De¹/OpenOcean IS ALWAYS ASKED — THE MISSING KEY IS NOT A NO ────────
   * This used to skip De¹ whenever `/api/solana/routes` reported
   * `keyConfigured: false`, on the theory that its enterprise gateway rejects
   * keyless traffic. That theory is true of ONE root and false of the whole
   * route: server/solanaOcean.js walks a ROOT LADDER (operator override →
   * enterprise (keyed) → public (keyed, then keyless)), and the public root
   * has historically answered keylessly AND paid the referrer fee on-chain.
   * Skipping on the missing key therefore deleted the fee-paying route from
   * every single quote — which is precisely the report: «سواپ سولانا فقط با
   * ژوپیتر می‌رود و هیچ‌وقت سراغ مسیرهای کارمزددار مثل اوپن‌اوشن نمی‌رود».
   *
   * A route the SERVER says cannot pay (`feeReady === false`, i.e. no valid
   * receiver or a zero rate) is still skipped: that is our own configuration,
   * and asking would only spend a round trip on a guaranteed refusal.
   * Reachability is NOT checked here — a 503 guess per keystroke was the
   * original sin; a fast failure inside the race costs nothing.
   */
  /*
   * ─── AND WHY IT IS ALSO SKIPPED WHEN THE CHAIN IS SWITCHED OFF ───────────
   * `supported === false` is not a guess about a key or a host: it is what the
   * route's own last request answered —
   *
   *   {"code":200,"data":{"message":"This chain is no longer supported"}}
   *
   * (measured 2026-10-24 on De¹'s public root, for every Solana pair, with the
   * fee parameters attached). The server now classifies that answer and
   * reports it in GET /api/solana/routes as `supported: false`; asking anyway
   * would spend one round trip per keystroke on a route that cannot answer.
   *
   * `null` (never asked, or a stale verdict) is still ASKED — a chain that was
   * switched off can be switched back on, and a cached "off" that outlives the
   * fact is the mirror image of the bug this file exists to prevent.
   */
  if (de1?.feeReady !== false && de1?.supported !== false) out.push('openocean');
  /*
   * LI.FI: asked ALWAYS, with or without a wallet.
   *
   * It used to require `address` because LI.FI will not quote without a
   * `fromAddress`. The server now prices against our own fee wallet when the
   * caller has no account and DROPS the transaction it built for it
   * (server/solanaLifi.js), so the first price on the screen can come from a
   * fee-paying route instead of waiting for a connection — and, with De¹'s
   * Solana chain off, LI.FI is the only paid route that can price at all.
   */
  if (lifi?.feeReady !== false) out.push('lifi');
  /* Jupiter with our fee: only exists once a fee token account is configured,
     and only for pairs that account's mint is part of. */
  if (jupfee?.configured !== false) out.push('jupfee');
  return out;
}

/**
 * Why each paid route was NOT asked, as stable codes.
 *
 * The screen prints these when the free route ends up running, because "the
 * swap was free" without a reason is how an unconfigured upstream key stays
 * invisible for weeks — the exact failure this file exists to end. Codes, not
 * sentences: they are read by whoever has to fix the configuration, and they
 * need no translation.
 *
 * `NO_API_KEY` is deliberately GONE: the key is not required to ask De¹ any
 * more (see `solanaQuoteProviders`), so a missing key is not a reason we can
 * print — De¹ either answers or it does not, and the answer is reported by the
 * race itself (`UPSTREAM_FAILED`, `BAD_AMOUNT`, …).
 */
export function solanaSkippedReasons({ address = null, routes = null } = {}) {
  const de1 = routes?.de1 ?? routes?.openocean ?? null;
  const lifi = routes?.lifi ?? null;
  const jupfee = routes?.jupfee ?? null;

  const out = {};
  if (de1?.feeReady === false) out.openocean = 'FEE_NOT_CONFIGURED';
  else if (de1?.supported === false) out.openocean = 'CHAIN_UNSUPPORTED';
  /* LI.FI no longer needs a wallet to PRICE (`NEEDS_WALLET` is gone for the
     quote phase — it still needs one to BUILD, which the build ladder enforces
     by passing the account). The only remaining reason to skip it is a fee
     receiver/rate we do not have. */
  if (lifi?.feeReady === false) out.lifi = 'FEE_NOT_CONFIGURED';
  if (jupfee?.configured === false) out.jupfee = 'FEE_ACCOUNT_NOT_CONFIGURED';
  return out;
}
