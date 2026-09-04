/**
 * FBT INTENT OS — Route Adapter
 * ---------------------------------------------------------------------------
 * Sits BETWEEN the protected SSOTs and the app. The SSOTs are read-only here:
 *   · os/intentUnderstanding.js  — decides WHAT the user wants (intent + entities)
 *   · os/moduleRouter.js         — maps a classified intent to a page + query
 *   · os/centralWalletState.js   — wallet truth
 *
 * This module exists because real Persian sentences that the parser cannot
 * fully classify still carry everything a route needs in their ENTITIES:
 *
 *   «۱۰۰ تتر به ETH»            → GENERAL, entities { fromToken: USDT, toToken: ETH }
 *   «از اتریوم به آربیتروم تتر ببر» → GENERAL, entities { fromChain: 1, toChain: 42161, token: USDT }
 *
 * Rewriting the parser to catch every sentence is the wrong move — the SSOT
 * stays untouched. Instead this adapter:
 *
 *   1. fills a bare follow-up («ادامه بده», «بخرش») from the operational slots
 *      kept in sharedState.js, so the same surface never loses the thread;
 *   2. sends SEND to the wallet's send tab, never the dead `/swap?toAddress=` path;
 *   3. gates speculation pages (/invest, /perp, /dydx) on SPECULATION_ENABLED
 *      and returns an honest "not in this build" marker when they are absent;
 *   4. turns the swap/bridge-like GENERAL sentences above into the same
 *      prefilled URLs moduleRouter would have produced.
 */

import { routeForIntent, aliasChainId, aliasToken, isSolanaIntent } from './moduleRouter.js';
import { SPECULATION_ENABLED } from '../../features.js';

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Persian digits arrive in the chat all the time; the parser's \d does not. */
export function toAsciiDigits(value) {
  return String(value ?? '').replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

function q(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/** Amount from entities first (already parsed), else from the raw sentence. */
function extractAmount(intent) {
  const e = intent?.entities || {};
  let m = e.amount != null ? toAsciiDigits(e.amount) : null;
  if (!m && e.amountUsd != null) m = toAsciiDigits(e.amountUsd);
  if (!m) {
    const raw = toAsciiDigits(String(intent?.raw || ''));
    const match = raw.match(/(\d+(?:[.,]\d+)?)/);
    if (match) m = match[1];
  }
  return m ? String(m).replace(/,/g, '') : null;
}

const BARE_FOLLOWUPS = /^(ادامه بده|ادامه‌اش را بده|بخرش|بفروشش|بخر|بفروش|انجامش بده|همین کار|ارسالش کن|بفرستش|بریجش کن|سواپش کن)\s*[!.؟?]*$/i;

const SPECULATION_TYPES = ['HORIZON', 'FOREX', 'DYDX', 'FUTURES'];

/**
 * Resolve a parsed intent into a page route, applying the SSOT first and
 * falling back to entity-driven routing for what the SSOT cannot classify.
 *
 * @returns {{ route: string|null, operation: string, openPage: boolean, unavailable: string|null }}
 */
export function resolveIntent(intent, message = '', { openPage = false, slots = null } = {}) {
  const type = String(intent?.type || '').toUpperCase();
  const e = { ...(intent?.entities || {}) };
  const operational = slots && typeof slots === 'object' ? slots : {};
  let resolvedType = type;

  /*
   * ─── PHASE C — bare follow-ups consume the operational slot ──────────────
   * «ادامه بده» / «بخرش» must keep working on the same surface. The parser
   * classifies «بخرش» as BUY with NO entities, so without this the router
   * would default the pair to USDT→ETH instead of the asset the user was just
   * talking about.
   *
   * ─── AND THE CONDITION THAT USED TO BE HERE WAS A SERIOUS BUG ────────────
   * The carry-over fired on `(bare || hasNoAsset)`. `hasNoAsset` is true of
   * almost every sentence that is not a trade — «کیف پولم چقدره؟»,
   * «پرتفوی من چطوره؟», «۴ ماه», «سلام». So one «۱۰۰ دلار بیت کوین بخر»
   * wrote USD/BTC/100 into the session slots, and from then on EVERY
   * unrelated question inherited that pair. The SSOT cannot classify
   * GENERAL, the entity fallback below saw from=USD to=BTC, and the app
   * opened a prefilled swap. Ask about your wallet, get a buy order.
   *
   * Carrying a slot forward is only correct when the new message is actually
   * a CONTINUATION of the stored operation. Two signals qualify, and nothing
   * else does:
   *
   *   · `bare`  — the message is nothing but a follow-up verb («بخرش»). There
   *               is no content of its own, so the previous operation is the
   *               only thing it can mean.
   *   · same operation family — the parser independently classified this
   *               message as a trade of the kind already in flight, and it is
   *               missing a detail the previous turn supplied.
   *
   * A question that merely omits a coin is neither.
   */
  const TRADE_TYPES = ['BUY', 'SELL', 'SWAP', 'BRIDGE', 'SEND'];
  const bare = BARE_FOLLOWUPS.test(String(message || '').trim());
  const storedOp = String(operational.operation || '').toUpperCase() || null;
  const sameOperationFamily = Boolean(
    storedOp
    && TRADE_TYPES.includes(resolvedType)
    && (resolvedType === storedOp || resolvedType === 'GENERAL')
  );
  const continuesStoredOperation = bare || sameOperationFamily;
  const hasStoredSlots = Boolean(operational.asset || operational.fromToken || operational.toToken || storedOp);

  if (continuesStoredOperation && hasStoredSlots) {
    if (!e.amount) e.amount = operational.amount;
    if (!e.token) e.token = operational.asset || operational.toToken || operational.fromToken || null;
    if (!e.fromToken) e.fromToken = operational.fromToken || null;
    if (!e.toToken) e.toToken = operational.toToken || null;
    if (bare && (type === 'GENERAL' || type === 'BUY' || type === 'SELL' || type === 'SWAP') && storedOp) {
      // A bare verb continues whatever operation was in flight, not the verb's default pair.
      resolvedType = storedOp;
    }
  }

  /*
   * ─── PHASE B — speculation honesty ───────────────────────────────────────
   * /invest, /perp and /dydx exist only when SPECULATION_ENABLED is set and
   * the routes are compiled into App.jsx. Otherwise the chat says so instead
   * of navigating to a dead URL.
   */
  if (!SPECULATION_ENABLED && SPECULATION_TYPES.includes(resolvedType)) {
    return { route: null, operation: resolvedType, openPage: false, unavailable: 'SPECULATION_DISABLED' };
  }

  /*
   * ─── SEND override ───────────────────────────────────────────────────────
   * The SSOT still maps SEND to `/swap?toAddress=…`. The product's real send
   * path is the wallet send tab, so that is where a send lands.
   */
  if (resolvedType === 'SEND') {
    const token = e.token || e.fromToken || 'USDT';
    /* The wallet send sheet prefills the token only — the recipient is typed
       or scanned on the page by design (a URL-supplied address is a phishing
       vector), so it is deliberately not carried here. */
    return {
      route: `/wallet${q({ tab: 'send', token })}`,
      operation: 'SEND',
      openPage: true,
      unavailable: null
    };
  }

  /*
   * ─── «والت را ببند» — real disconnect ────────────────────────────────────
   * The wallet page owns disconnect; the chat only routes there with an
   * explicit action the page performs once.
   */
  if (resolvedType === 'WALLET_DISCONNECT') {
    return { route: '/wallet?action=disconnect', operation: 'WALLET_DISCONNECT', openPage: true, unavailable: null };
  }

  /* ─── SSOT first — it owns every intent it can classify ───────────────── */
  const enriched = { ...intent, entities: e };
  const primary = routeForIntent(enriched, { openPage });
  if (primary) {
    let route = primary;
    /*
     * SolanaSwap reads ?to= as a MINT address, never a symbol (its ?toMint=
     * path is the raw-mint import). The SSOT emits a symbol here for a plain
     * «سواپ سولانا», which the page cannot resolve — so the URL is normalised
     * to drop the unusable param instead of shipping a link that looks
     * prefilled but is not.
     */
    if (route.startsWith('/solana?')) {
      const usp = new URLSearchParams(route.slice(route.indexOf('?') + 1));
      const to = usp.get('to');
      if (to && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(to)) usp.delete('to');
      const qs = usp.toString();
      route = qs ? `/solana?${qs}` : '/solana';
    }
    return { route, operation: resolvedType, openPage: Boolean(openPage), unavailable: null };
  }

  /*
   * ─── fallback: the entities already name a swap or a bridge ──────────────
   * These are the GENERAL sentences the parser could not classify but which
   * carry unambiguous from/to tokens or from/to chains.
   */
  const amount = extractAmount(enriched);
  const fromChain = aliasChainId(e.fromChain ?? e.network ?? e.chains?.[0]);
  const toChain = aliasChainId(e.toChain ?? e.destinationNetwork ?? e.chains?.[1]);
  const from = (aliasToken(e.fromToken) || e.fromToken || '').toString().toUpperCase() || null;
  const to = (aliasToken(e.toToken) || e.toToken || '').toString().toUpperCase() || null;
  const token = (aliasToken(e.token) || e.token || '').toString().toUpperCase() || null;

  if (fromChain && toChain && Number(fromChain) !== Number(toChain)) {
    return {
      route: `/bridge${q({ token: token || 'USDT', amount, fromChain, toChain })}`,
      operation: 'BRIDGE',
      openPage: true,
      unavailable: null
    };
  }

  if (from && to && from !== to) {
    if (isSolanaIntent(enriched)) {
      return { route: `/solana${q({ to, amount })}`, operation: 'SWAP', openPage: true, unavailable: null };
    }
    return {
      route: `/swap${q({ from, to, amount, chain: fromChain })}`,
      operation: 'SWAP',
      openPage: true,
      unavailable: null
    };
  }

  /* Single-token buy/sell that the SSOT could not prefill (no pair). */
  if (['BUY', 'SELL', 'SWAP'].includes(resolvedType) && token) {
    const fromToken = resolvedType === 'SELL' ? token : 'USDT';
    const toToken = resolvedType === 'SELL' ? 'USDT' : token;
    if (isSolanaIntent(enriched)) {
      return { route: `/solana${q({ to: toToken, amount })}`, operation: resolvedType, openPage: true, unavailable: null };
    }
    return {
      route: `/swap${q({ from: fromToken, to: toToken, amount, chain: fromChain })}`,
      operation: resolvedType,
      openPage: true,
      unavailable: null
    };
  }

  return { route: null, operation: resolvedType, openPage: false, unavailable: null };
}
