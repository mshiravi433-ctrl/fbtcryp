/**
 * THORCHAIN — native cross-chain swaps, and our affiliate fee.
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS ADDS THAT WE DO NOT HAVE ─────────────────────────────────────
 * Real Bitcoin for real Ethereum. Not WBTC, not a wrapped token, not a bridge
 * holding your coins — THORChain settles on each chain natively. Our EVM
 * aggregator cannot do this at all, and neither can LI.FI in the same way, so
 * this adds a trade rather than re-routing one we already earn on.
 *
 * ─── AND WHY THE REVENUE IS UNUSUALLY SAFE ──────────────────────────────────
 * There is no account, no company, no form and no counterparty. The affiliate
 * is an address inside the swap memo, validated by consensus. Nobody can
 * revoke it because nobody is involved. Every other programme reviewed for
 * this app can be switched off by a compliance team; this one cannot.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── THE 80-BYTE WALL, WHICH IS THE WHOLE DESIGN ────────────────────────────
 * ═══════════════════════════════════════════════════════════════════════════
 * On Bitcoin the memo travels in an OP_RETURN output, which is capped at 80
 * bytes. THORChain refuses to quote when the generated memo exceeds it:
 *
 *   BTC.BTC -> ETH.ETH, no affiliate      -> quote OK
 *   BTC.BTC -> ETH.ETH, + our thor1 addr  -> {"code":2,"message":
 *                                             "generated memo too long
 *                                              for source chain"}
 *
 * Measured, not guessed:
 *
 *   =:e:0x…40-char-dest::thor12cqv…43-char-affiliate:70   94 bytes  FAIL
 *   =:e:0x…40-char-dest::fbtswap:70                       58 bytes  OK
 *
 * A raw `thor1…` address is 43 characters. That single field is what breaks
 * it. The fix is a THORName — a short alias — but that costs RUNE, and the
 * owner cannot spend money yet.
 *
 * ─── SO THE FEE IS APPLIED PER CHAIN, NOT GLOBALLY ──────────────────────────
 * The limit is a property of the SOURCE chain, not of THORChain. Ethereum
 * carries the memo in transaction calldata with no meaningful cap, so an
 * ETH -> BTC swap with our full address quotes fine and pays us:
 *
 *   ETH.ETH -> BTC.BTC, + our thor1 addr  -> "affiliate": "20608"  ✅
 *
 * So `affiliateFor()` returns our address on chains where the memo fits and
 * nothing on the UTXO chains where it does not. We earn today on everything
 * except Bitcoin-family sources, and the moment a THORName exists ONE
 * environment variable turns the rest on.
 *
 * ─── WHY NOT JUST OMIT THE FEE EVERYWHERE UNTIL WE CAN AFFORD A NAME ────────
 * Because that is months of ETH, AVAX, BSC and Cosmos swaps earning nothing
 * for a limitation that does not apply to them. And because a request that
 * fails outright is worse than one that succeeds without a fee: the user
 * would see "memo too long", a message about our configuration that they can
 * do nothing about.
 */

/**
 * ─── SEVERAL NODES, TRIED IN ORDER ──────────────────────────────────────────
 * Shipped with a single host and it failed in production the moment it
 * deployed: `/api/thor/status` (no upstream call) answered fine while
 * `/api/thor/pools` and `/api/thor/quote` both returned
 * `{"error":"UPSTREAM_FAILED","detail":"fetch failed"}`.
 *
 * "fetch failed" with no HTTP status is a CONNECTION failure, not a rejected
 * request — the Vercel function could not reach that host at all, even though
 * the same URL answers fine from elsewhere. Whether that is regional routing,
 * an IP block, or the node being picky about datacentre traffic does not
 * matter: relying on one third-party node was the mistake.
 *
 * `gateway.liquify.com` is the endpoint THORChain's own developer docs list
 * first, and it answered. It leads.
 *
 * The list is tried in order and the first that responds wins, so a node
 * having a bad afternoon degrades to a slightly slower request instead of a
 * dead feature. This is the same `allSettled`-style resilience the radio and
 * calm-music modules already use, applied to a service where the failure was
 * observed rather than anticipated.
 */
export const THOR_NODES = (process.env.THORNODE_BASE
  ? [process.env.THORNODE_BASE]
  : [
      'https://gateway.liquify.com/chain/thorchain_api',
      'https://thornode.ninerealms.com',
      'https://thornode.thorchain.liquify.com'
    ]);

/*
 * Per-attempt, not total. Three nodes at 15s each could otherwise keep a
 * serverless function alive for 45 seconds on a request the user abandoned
 * ten seconds ago.
 */
const TIMEOUT_MS = Number(process.env.THOR_TIMEOUT_MS || 8000);

/**
 * Our affiliate, verified live before being written here.
 *
 * A typo would send every fee to an address nobody controls, and it would
 * fail SILENTLY — THORChain skips an unparseable affiliate and executes the
 * swap anyway. So it was checked twice: it decodes on their node, and a live
 * quote computed a real fee for it.
 */
export const AFFILIATE =
  process.env.THOR_AFFILIATE || 'thor12cqv53jqz6tnzmlsg9y207xe83raeem8nywqxt';

/**
 * A registered THORName, once one exists. Empty until then.
 *
 * Setting this is the ONLY step needed to start earning on Bitcoin, Litecoin,
 * Bitcoin Cash and Dogecoin. `fbtswap` and `fbt` were both still unregistered
 * when this was written (their node returns "fail to fetch THORName" for
 * each), and at the live `tns_register_fee_rune` a ten-year registration is
 * about $9.
 */
export const THORNAME = (process.env.THOR_NAME || '').trim().toLowerCase();

/** Our cut, matching the EVM swap fee so a user never meets two house rates. */
export const AFFILIATE_BPS = Number(process.env.THOR_AFFILIATE_BPS || 70);

/**
 * Chains whose memo lives in a size-limited field.
 *
 * UTXO chains put the memo in OP_RETURN (80 bytes). Everything else — EVM
 * calldata, Cosmos memo fields, XRP memos — has room to spare.
 *
 * Doge is included even though its limit is more generous, because it is the
 * same OP_RETURN mechanism and the margin is not worth a surprise in
 * production. Being conservative here costs a fee on one chain; being wrong
 * costs the user an unquotable swap.
 */
export const TIGHT_MEMO_CHAINS = new Set(['BTC', 'BCH', 'LTC', 'DOGE']);

/** `BTC.BTC` -> `BTC`, `ETH.USDC-0X…` -> `ETH`. */
export const chainOf = (asset) => String(asset ?? '').split('.')[0].toUpperCase();

/**
 * The affiliate identifier to use for a swap FROM this asset, or null.
 *
 * @returns {string|null} a THORName when configured (short, always fits), our
 *          raw address on roomy chains, or null where it would overflow.
 */
export function affiliateFor(fromAsset) {
  /* A THORName is short enough for every chain, so it removes the whole
     problem rather than working around it. */
  if (THORNAME) return THORNAME;
  return TIGHT_MEMO_CHAINS.has(chainOf(fromAsset)) ? null : AFFILIATE;
}

/**
 * Why a given source chain is not paying us. For the diagnostics route, so
 * this is debuggable from a phone without reading the code.
 */
export function affiliateStatus(fromAsset) {
  const chain = chainOf(fromAsset);
  if (THORNAME) return { earning: true, reason: 'thorname' };
  if (TIGHT_MEMO_CHAINS.has(chain)) return { earning: false, reason: 'MEMO_TOO_LONG' };
  return { earning: true, reason: 'raw-address' };
}

async function fetchOne(base, path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        /*
         * Liquify's docs ask integrators to identify themselves with this
         * header and say they will raise limits for apps that send it. It
         * costs nothing and the default anonymous cap is shared with every
         * other anonymous caller.
         */
        'x-client-id': 'fbt-swap',
        'user-agent': 'fbt-swap-app/1.0'
      }
    });
    const body = await res.json().catch(() => null);
    /*
     * THORChain returns 200 with `{code, message}` for business errors, so
     * `res.ok` alone is not enough — the "memo too long" response is a 200.
     */
    if (!res.ok && !body) throw new Error(`HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try each node until one answers.
 *
 * A node that returns a BUSINESS error (`{code, message}` — "memo too long",
 * "pool not found") has answered correctly and must NOT trigger a failover:
 * the next node would give the identical answer, and retrying would triple
 * the latency of every legitimate rejection. Only a transport failure moves
 * on to the next host.
 */
async function getJson(path) {
  let lastErr = null;
  for (const base of THOR_NODES) {
    try {
      return await fetchOne(base, path);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('ALL_NODES_FAILED');
}

/**
 * Asset identifiers we accept.
 *
 * Validated rather than passed through: these become part of a URL we sign
 * our affiliate address onto, and an unvalidated string is an injection point
 * into that query.
 */
const ASSET_RE = /^[A-Z]{2,10}[.~/][A-Z0-9\-.]{1,90}$/i;

/**
 * Which pools are actually tradeable right now.
 *
 * ─── WHY THE UI MUST NOT SKIP THIS ──────────────────────────────────────────
 * THORChain halts individual chains regularly — as this was written,
 * BSC, Solana and Base were all halted while BTC and ETH were open. Offering
 * a halted pair produces a button that takes the user's tap and then fails,
 * which is the dead-button failure this project keeps removing.
 */
export async function fetchThorPools() {
  const pools = await getJson('/thorchain/pools');
  if (!Array.isArray(pools)) throw new Error('BAD_SHAPE');

  const items = pools
    .filter((p) => p?.asset && p.status === 'Available' && p.trading_halted === false)
    .map((p) => ({
      asset: p.asset,
      chain: chainOf(p.asset),
      /* Depth in RUNE, so the UI can sort by real liquidity instead of
         alphabetically — a thin pool at the top of a list is a bad default. */
      depthRune: Number(p.balance_rune) || 0,
      /* 1e8-scaled USD price, straight from the network's own oracle. */
      priceUsd: Number(p.asset_tor_price) / 1e8 || 0
    }))
    .sort((a, b) => b.depthRune - a.depthRune);

  return { at: Date.now(), items, total: items.length };
}

/**
 * A quote, with our affiliate fee attached where the chain allows it.
 *
 * ─── THE FEE PARAMETERS ARE NEVER TAKEN FROM THE CALLER ─────────────────────
 * Same rule as server/bridge.js. If `affiliate` came from the query string,
 * anyone could point our commission at their own address by editing a URL.
 */
export async function thorQuote({ from, to, amount, destination, streaming }) {
  if (!ASSET_RE.test(String(from ?? ''))) return { error: 'BAD_FROM_ASSET' };
  if (!ASSET_RE.test(String(to ?? ''))) return { error: 'BAD_TO_ASSET' };

  const amt = String(amount ?? '').trim();
  /*
   * Integer base units only, and length-capped. `Number()` would silently
   * accept `1e30` and scientific notation, and would lose precision above
   * 2^53 — on an 8-decimal chain that is only 90 million units.
   */
  if (!/^\d{1,20}$/.test(amt) || amt === '0') return { error: 'BAD_AMOUNT' };

  const qs = new URLSearchParams({
    from_asset: from,
    to_asset: to,
    amount: amt
  });

  /*
   * `destination` is optional in the API but the returned MEMO depends on it,
   * and the memo length is exactly what we are managing. Quoting without it
   * and then adding an address later can push a borderline memo over 80
   * bytes at the worst possible moment — after the user has committed.
   */
  if (destination) qs.set('destination', String(destination).slice(0, 128));

  /*
   * Streaming splits a large swap into sub-swaps to cut slippage. Off by
   * default: it multiplies the total time, and for the small trades this app
   * sees the slippage saving does not pay for the wait.
   */
  if (streaming) qs.set('streaming_interval', '1');

  const affiliate = affiliateFor(from);
  if (affiliate) {
    qs.set('affiliate', affiliate);
    qs.set('affiliate_bps', String(Math.min(Math.max(AFFILIATE_BPS, 0), 1000)));
  }

  const data = await getJson(`/thorchain/quote/swap?${qs.toString()}`);

  /*
   * ─── THE FALLBACK THAT KEEPS THE FEATURE USABLE ─────────────────────────
   * If the memo still overflows on a chain we thought was roomy — a very long
   * destination address, or a future THORName that is not as short as
   * expected — retry WITHOUT the fee rather than showing the user an error
   * about our configuration. Same reasoning as the LI.FI 1011 fallback: a
   * working swap that earns nothing beats a broken one that earns nothing.
   */
  if (data?.code === 2 && /memo too long/i.test(String(data.message)) && affiliate) {
    qs.delete('affiliate');
    qs.delete('affiliate_bps');
    const retry = await getJson(`/thorchain/quote/swap?${qs.toString()}`);
    if (retry && !retry.code) {
      return { ...retry, feeApplied: false, feeSkipped: 'MEMO_TOO_LONG' };
    }
    return { error: 'MEMO_TOO_LONG' };
  }

  if (!data || data.code) {
    return { error: 'QUOTE_FAILED', detail: String(data?.message ?? '').slice(0, 200) };
  }

  return { ...data, feeApplied: Boolean(affiliate), affiliateBps: affiliate ? AFFILIATE_BPS : 0 };
}

/** Config sanity, for the Developers page and for debugging from a phone. */
export function thorStatus() {
  return {
    nodes: THOR_NODES,
    affiliate: AFFILIATE,
    thorname: THORNAME || null,
    bps: AFFILIATE_BPS,
    /* Named explicitly so nobody has to infer it from the set above. */
    earnsOn: 'all chains except BTC/BCH/LTC/DOGE until a THORName is set',
    tightMemoChains: [...TIGHT_MEMO_CHAINS]
  };
}
