/**
 * PROVIDER LIVENESS PROBE — real evidence for the Ecosystem status page
 * ---------------------------------------------------------------------------
 * The standard provider status (`server/providerStatus.js`) deliberately does
 * NOT turn `reachable` on from `configured` alone. That rule is what made the
 * DEX & Liquidity section of the Ecosystem page look "not connected" even
 * though the app routes through KyberSwap, OpenOcean (EVM + Solana), Velora
 * and 0x Gasless every day — a fresh server process simply has no proof yet.
 *
 * This module answers the same question the page actually needs: "is the
 * upstream reachable right now?" It performs one tiny, real call to each
 * fee-earning DEX/liquidity venue AND each bridge (LI.FI, deBridge DLN,
 * 0x Cross-Chain), records the outcome with the standard health tracker, and
 * returns the evidence. It never invents a status and never echoes a key.
 *
 * ─── 2026-10-08 · WHY THERE IS ALSO A PER-CHAIN MATRIX ──────────────────────
 * The provider probes below answer "does this integration answer?" — and only
 * ever on the ONE chain each probe happens to use (Base 8453 for KyberSwap /
 * OpenOcean / Velora, BSC for the gasless path, Arbitrum for DLN). The
 * Ecosystem page draws a light for EVERY network in the registry from that
 * same evidence, so fourteen of the seventeen networks could never be
 * anything but grey: no probe had ever been attempted there. Reported as
 * «هیچکدام شبکه‌ها چراغشون روشن نیست و همه را زده ناقص».
 *
 * So the probe now also walks the networks: for each EVM network the app can
 * route on, one real quote is requested — LI.FI's same-chain swap (the route
 * the app itself uses on the chains where it is the only source), falling
 * back to OpenOcean — and for Solana the De¹ route first, Jupiter second.
 * A network that answers has PROOF the screen will price a swap there; a
 * network whose probes all failed says DEGRADED; a network nobody asked is
 * still honestly UNKNOWN.
 *
 * The evidence is returned BOTH ways: `results[]` keeps the per-provider view
 * the DEX/bridge cards read, and `chains[]` carries the per-network view the
 * network lights read. A chain probe that fails does NOT record a provider
 * failure — one chain refusing a quote is not an integration outage, and
 * letting it record would flip a healthy card to DEGRADED while its neighbours
 * answered.
 *
 * Safe by construction:
 *   · the upstream host and paths are fixed constants (no SSRF);
 *   · amounts are tiny (quote-only, nothing is ever signed or broadcast);
 *   · fee fields for OpenOcean/Gasless are attached by their own server
 *     modules, never supplied by a caller.
 */

import { proxyKyberRoutes, proxyOoQuote, proxyVeloraPrices } from './swapProxy.js';
import { gaslessPrice, gaslessConfigured } from './gasless.js';
import { oceanQuote } from './solanaOcean.js';
import { integratorStatus, lifiFetch } from './lifi.js';
import { dlnQuote } from './dln.js';
import { crossChainProbe } from './xchain.js';
import { solanaOrder } from './solana.js';
import { lifiSolanaReachability } from './solanaLifi.js';
import { recordSuccess, recordFailure } from './providerStatus.js';
import { EVM_CHAINS, TOKENS } from '../src/lib/chains.js';

/* Well-known public token addresses used only for the probe. */
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH_BASE = '0x4200000000000000000000000000000000000006';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * The chains the per-network matrix walks: exactly `EVM_CHAIN_ORDER` from
 * src/lib/chains.js (kept in step with the wallet, the swap screen and the
 * bridge picker) plus Solana, which is not an EVM chain id.
 *
 * 8453 / 56 / 42161 / solana already get chain-specific evidence from the
 * provider probes above and are deliberately NOT repeated here — the matrix
 * exists to cover the networks nothing else touches.
 */
const MATRIX_EVM_CHAINS = [
  56, 1, 137, 42161, 8453, 10, 43114, 59144, 146,
  5000, 80094, 130, 143, 534352, 324, 4663
];

/**
 * OpenOcean spells the native coin differently on some chains (0x…1010 on
 * Polygon, the zero address on Robinhood Chain) — mirrored from
 * src/lib/openocean.js, which is a browser module and therefore not imported
 * here. A wrong sentinel makes the quote fail, which would read as "this
 * network is down" for a network that routes fine.
 */
const OO_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const OO_NATIVE_BY_CHAIN = {
  137: '0x0000000000000000000000000000000000001010',
  4663: '0x0000000000000000000000000000000000000000'
};
const ooNativeAddress = (chainId) => OO_NATIVE_BY_CHAIN[Number(chainId)] ?? OO_NATIVE;

/**
 * The stable the app itself trades on that chain (src/lib/chains.js), with the
 * fallbacks a network light must not depend on: Robinhood Chain (4663) holds
 * no USDC at all, and a missing entry there used to mean NO_PROBE_TOKENS — a
 * chain the app routes on, reported as "nothing was probed" forever.
 */
const PROBE_STABLES = ['USDC', 'USDT', 'USDG', 'HONEY'];
const usdForChain = (chainId) => {
  const list = TOKENS[Number(chainId)] || [];
  for (const symbol of PROBE_STABLES) {
    const token = list.find((t) => t.symbol === symbol && t.address);
    if (token) return token.address;
  }
  return null;
};

/** The chain's native coin, as LI.FI spells a native coin: by symbol. */
const nativeSymbolFor = (chainId) => EVM_CHAINS[Number(chainId)]?.native?.symbol || null;

// Chain ids are attached only to probes that request a quote on those chains.
// Registration/configuration checks (LI.FI and 0x Cross-Chain) prove no chain.
const PROBE_CHAIN_IDS = {
  kyberswap: [8453],
  openocean: [8453],
  velora: [8453],
  '0x-gasless': [56],
  'solana-openocean': ['solana'],
  lifi: [],
  'debridge-dln': [8453, 42161],
  '0x-cross-chain': []
};

/** A valid EVM address to satisfy taker validation in the quote-only probe. */
const PROBE_TAKER = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';

/** A valid Solana address for the Solana matrix probe. Receives nothing. */
const PROBE_SOL_TAKER = 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4';

function outcome(r) {
  const status = Number(r?.status || (r?.ok ? 200 : 0));
  const body = r?.body || {};
  const ok = Boolean(r?.ok ?? (status >= 200 && status < 400));
  return { ok, status, error: body?.error || body?.detail || body?.message || null };
}

async function ping(provider, call) {
  try {
    const r = await call();
    const o = outcome(r);
    if (o.ok) {
      recordSuccess(provider);
      return { provider, ok: true, status: o.status };
    }
    // A 4xx that is really a validator saying "invalid probe input" is not a
    // provider outage. Only record real unavailability/auth failures.
    if (o.status >= 500 || o.status === 401 || o.status === 403 || o.status === 503) {
      recordFailure(provider, o.error || `HTTP_${o.status}`);
    }
    return { provider, ok: false, status: o.status, error: o.error };
  } catch (err) {
    recordFailure(provider, String(err?.message || err).slice(0, 120));
    return { provider, ok: false, status: 0, error: String(err?.message || err) };
  }
}

/* ─── per-network probes ─────────────────────────────────────────────────────
 * Each one asks the same question the swap screen asks on that network: "can
 * one of our routing sources price 1 USDC into the chain's own native coin
 * right now?". Nothing is signed and no wallet is involved; the amounts are
 * chosen to be above every aggregator's dust floor while staying quote-sized.
 */
async function probeLifiChain(chainId) {
  const usd = usdForChain(chainId);
  const native = nativeSymbolFor(chainId);
  if (!usd || !native) return { ok: false, status: 0, error: 'NO_PROBE_TOKENS' };
  /*
   * A PLAIN quote — no `integrator`, no `fee`.
   *
   * The fee-gated `lifiSwapQuote` is the app's payment path, and its echo gate
   * REJECTS a quote that does not prove our cut lands in our wallet. Using it
   * as the reachability probe would turn "this integrator is not configured
   * for fee collection on chain X" into "this network is down" — a light
   * about our paperwork, not about the chain. The question this module asks
   * is the one the page draws: can a routing source price a swap here?
   */
  const q = new URLSearchParams({
    fromChain: String(chainId),
    toChain: String(chainId),
    fromToken: usd,
    toToken: native,
    fromAmount: '1000000',
    fromAddress: PROBE_TAKER,
    toAddress: PROBE_TAKER,
    slippage: '0.005'
  });
  const res = await lifiFetch(`/quote?${q.toString()}`);
  return {
    ok: Boolean(res?.ok),
    status: Number(res?.status || 0),
    error: res?.ok ? null : (res?.body?.message || res?.body?.error || null)
  };
}

async function probeOceanChain(chainId) {
  const usd = usdForChain(chainId);
  if (!usd) return { ok: false, status: 0, error: 'NO_PROBE_TOKENS' };
  return proxyOoQuote({
    chainId,
    inTokenAddress: usd,
    outTokenAddress: ooNativeAddress(chainId),
    amountDecimals: '1000000',
    gasPriceDecimals: '5000000000',
    slippage: '0.5'
  });
}

/** One network, one answer. LI.FI first (the app's source where others 404),
 *  OpenOcean second — and the walk stops at the first real quote, so a healthy
 *  network costs exactly one upstream call. */
async function probeNetwork(chain) {
  const attempts = [
    { provider: 'lifi', run: () => probeLifiChain(chain), accept: (r) => r?.ok === true },
    {
      provider: 'openocean',
      run: () => probeOceanChain(chain),
      accept: (r) => r?.ok && r.body?.code === 200 && Boolean(r.body?.data)
    }
  ];
  let last = { provider: attempts[0].provider, ok: false, status: 0 };
  for (const attempt of attempts) {
    let result;
    try {
      result = await attempt.run();
    } catch (err) {
      result = { ok: false, status: 0, error: String(err?.message || err) };
    }
    const ok = attempt.accept(result);
    last = { chain, provider: attempt.provider, ok, status: Number(result?.status || 0) };
    if (ok) {
      // Evidence, not a claim: a real quote came back for THIS chain.
      recordSuccess(attempt.provider);
      return last;
    }
  }
  return last;
}

/** Solana: the two fee-earning routes first (De¹, then LI.FI), Jupiter last.
 *  Neither fee path failing is a problem when another answers — the point is
 *  that the network routes, and WHICH route answered is recorded. */
async function probeSolanaNetwork() {
  const attempts = [
    {
      provider: 'solana-openocean',
      run: () => oceanQuote({ inputMint: SOL_MINT, outputMint: USDC_SOL, amount: '1000000000', slippageBps: 50 }),
      accept: (r) => r?.ok && Boolean(r.body?.outAmount)
    },
    {
      /* The LI.FI Solana quote is built for a signer address; ours is used as
         the probe taker and the returned transaction is discarded unread —
         the same quote-only discipline as every other probe here. The plain
         (fee-free) variant is used so "our fee wallet is not configured on
         Solana" can never be mistaken for "Solana does not route". */
      provider: 'lifi',
      run: () => lifiSolanaReachability({ account: PROBE_SOL_TAKER }),
      accept: (r) => r?.ok === true
    },
    {
      /* Named `jupiter`, not `solana-openocean`: the light is the network's,
         and crediting De¹ for an answer Jupiter gave would be a small lie in
         the one artefact this whole module exists to keep true. */
      provider: 'jupiter',
      run: () => solanaOrder({ inputMint: SOL_MINT, outputMint: USDC_SOL, amount: '1000000000', slippageBps: 50 }),
      accept: (r) => r?.ok && Boolean(r.body?.outAmount) && !r.body?.errorCode
    }
  ];
  for (const attempt of attempts) {
    let result;
    try {
      result = await attempt.run();
    } catch (err) {
      result = { ok: false, status: 0, error: String(err?.message || err) };
    }
    if (attempt.accept(result)) {
      recordSuccess(attempt.provider);
      return { chain: 'solana', provider: attempt.provider, ok: true, status: Number(result?.status || 200) };
    }
  }
  return { chain: 'solana', provider: 'solana-openocean', ok: false, status: 0 };
}

/** Bounded parallelism: the matrix is ~14 upstream calls and a serverless
 *  invocation has to stay inside its own budget. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Chain-level evidence cache.
 *
 * The page asks for a probe on every visit, and a seventeen-network walk is
 * not something to repeat every time someone opens /ecosystem. A chain that
 * answered is trusted for five minutes; a chain that did NOT is retried after
 * one, because a light that stays yellow for five minutes after the upstream
 * came back is its own kind of lie.
 */
const CHAIN_EVIDENCE_TTL_MS = 5 * 60_000;
const CHAIN_FAILURE_TTL_MS = 60_000;
const chainEvidenceCache = new Map();

async function probeNetworkCached(chain) {
  const hit = chainEvidenceCache.get(String(chain));
  if (hit && Date.now() < hit.until) return hit.entry;
  const entry = await probeNetwork(chain);
  chainEvidenceCache.set(String(chain), {
    entry,
    until: Date.now() + (entry.ok ? CHAIN_EVIDENCE_TTL_MS : CHAIN_FAILURE_TTL_MS)
  });
  return entry;
}

/**
 * Walk every network in the registry, inside a wall-clock budget.
 *
 * A serverless invocation has its own deadline, and half an answer is worth
 * more than a killed function: once the budget is spent the remaining chains
 * are simply not probed (they keep their previous evidence, or stay UNKNOWN),
 * and the ones already answered are still returned.
 */
export async function probeProviderNetworks({ budgetMs = 9000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const evm = await mapLimit(MATRIX_EVM_CHAINS, 5, (chain) =>
    (Date.now() > deadline ? null : probeNetworkCached(chain)));
  const solana = Date.now() < deadline ? await probeSolanaNetwork() : null;
  return [...evm, solana].filter(Boolean);
}

/**
 * Probe the DEX & Liquidity sources that pay FBT. Each call is tiny and
 * quote-only; nothing is signed, broadcast or stored.
 */
export async function probeProviderStatuses() {
  const results = await Promise.allSettled([
    ping('kyberswap', () =>
      proxyKyberRoutes({
        chainId: 8453,
        tokenIn: USDC_BASE,
        tokenOut: WETH_BASE,
        amountIn: '1000000',
        gasInclude: 'true'
      })
    ),
    ping('openocean', () =>
      proxyOoQuote({
        chainId: 8453,
        inTokenAddress: USDC_BASE,
        outTokenAddress: WETH_BASE,
        amountDecimals: '1000000',
        gasPriceDecimals: '5000000000',
        slippage: '0.5'
      })
    ),
    ping('velora', () =>
      proxyVeloraPrices({
        srcToken: USDC_BASE,
        destToken: WETH_BASE,
        amount: '1000000',
        srcDecimals: '6',
        destDecimals: '18',
        side: 'SELL',
        network: '8453',
        partner: 'fbtswap',
        partnerAddress: PROBE_TAKER,
        partnerFeeBps: '70',
        isDirectFeeTransfer: 'true',
        takeSurplus: 'true'
      })
    ),
    ping('0x-gasless', () => {
      if (!gaslessConfigured()) {
        return { ok: false, status: 503, body: { error: 'GASLESS_NOT_CONFIGURED' } };
      }
      return gaslessPrice({
        chainId: 56,
        sellToken: USDT_BSC,
        buyToken: USDC_BSC,
        sellAmount: '1000000000000000000',
        taker: PROBE_TAKER
      });
    }),
    ping('solana-openocean', () =>
      oceanQuote({
        inputMint: SOL_MINT,
        outputMint: USDC_SOL,
        amount: '1000000',
        slippageBps: 50
      })
    ),
    ping('lifi', async () => {
      const s = await integratorStatus();
      return { ok: s.registered, status: s.registered ? 200 : 502, body: s };
    }),
    ping('debridge-dln', () =>
      dlnQuote({
        srcChainId: 8453,
        dstChainId: 42161,
        srcChainTokenIn: USDC_BASE,
        dstChainTokenOut: USDC_ARB,
        srcChainTokenInAmount: '1000000'
      })
    ),
    ping('0x-cross-chain', async () => {
      const r = await crossChainProbe();
      if (r.body?.configured === false) {
        return { ok: false, status: 503, body: { error: r.body?.reason || 'CROSS_CHAIN_NOT_CONFIGURED' } };
      }
      const status = Number(r.body?.httpStatus || r.status);
      return {
        ok: status >= 200 && status < 400,
        status,
        body: r.body
      };
    })
  ]);

  const providerResults = results.map((r) => {
    const result = r.status === 'fulfilled' ? r.value : { ok: false, error: 'PROBE_INTERNAL' };
    const chainIds = PROBE_CHAIN_IDS[result.provider] || [];
    return {
      ...result,
      chainIds,
      // Which of those chains the probe actually WON — the network lights need
      // "attempted" and "answered" to be different fields, or a network whose
      // single probe failed cannot be told from one nobody asked.
      okChainIds: result.ok ? chainIds : []
    };
  });

  /*
   * The per-network walk runs after the provider probes so the two evidence
   * sources are merged in one place: the provider probes contribute the chains
   * they were run on, the matrix contributes the rest. A failure in the matrix
   * says nothing about the provider cards above — it is one chain, answered by
   * whichever source reached the network first.
   */
  let chainMatrix = [];
  try {
    chainMatrix = await probeProviderNetworks();
  } catch {
    chainMatrix = [];
  }

  const chains = [
    ...providerResults.flatMap((r) => (r.chainIds || []).map((chain) => ({
      chain,
      provider: r.provider,
      ok: (r.okChainIds || []).includes(chain),
      status: r.ok ? 200 : Number(r.status || 0)
    }))),
    ...chainMatrix
  ];

  return {
    schema: 'fbt.provider-probe.v2',
    generatedAt: new Date().toISOString(),
    results: providerResults,
    chains
  };
}
