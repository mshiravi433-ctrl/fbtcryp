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
 * Safe by construction:
 *   · the upstream host and paths are fixed constants (no SSRF);
 *   · amounts are tiny (quote-only, nothing is ever signed or broadcast);
 *   · fee fields for OpenOcean/Gasless are attached by their own server
 *     modules, never supplied by a caller.
 */

import { proxyKyberRoutes, proxyOoQuote, proxyVeloraPrices } from './swapProxy.js';
import { gaslessPrice, gaslessConfigured } from './gasless.js';
import { oceanQuote } from './solanaOcean.js';
import { integratorStatus } from './lifi.js';
import { dlnQuote } from './dln.js';
import { crossChainProbe } from './xchain.js';
import { recordSuccess, recordFailure } from './providerStatus.js';

/* Well-known public token addresses used only for the probe. */
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH_BASE = '0x4200000000000000000000000000000000000006';
const USDT_BSC = '0x55d398326f99059fF775485246999027B3197955';
const USDC_BSC = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** A valid EVM address to satisfy taker validation in the quote-only probe. */
const PROBE_TAKER = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';

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

  return {
    schema: 'fbt.provider-probe.v1',
    generatedAt: new Date().toISOString(),
    results: results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: 'PROBE_INTERNAL' }))
  };
}
