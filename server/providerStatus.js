/**
 * STANDARD PROVIDER STATUS — one shape for "is this integration actually
 * working?", across every provider the app depends on.
 * ---------------------------------------------------------------------------
 * `/api/revenue/readiness` answers a commercial question ("what is earning?").
 * This answers the operational one the spec raises separately: per integration,
 * is it configured, reachable, authenticated, collecting its fee, and when did
 * it last succeed or fail? Operators and the developer dashboard need a single
 * shape to consume, not a different ad-hoc object per module.
 *
 * The standard shape, exactly as specified:
 *
 *   configured             — the env/credentials it needs are present
 *   reachable              — we have evidence the host answers (liveness ping
 *                            or a recent successful call); NEVER assumed
 *   authenticated          — a recent call did not 401/403
 *   feeReady               — the fee path is wired and the fee came back
 *   supportedChains        — the chains this provider actually serves
 *   lastSuccessAt          — ISO timestamp of the most recent success we logged
 *   lastFailureAt          — ISO timestamp of the most recent failure we logged
 *   retryable              — is a transient retry likely to help?
 *   missingConfiguration   — the specific env vars blocking `configured`
 *   externalApprovalRequired — does going live need a third party (partner,
 *                            contract deployment, resolver)?
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 *   · `reachable`/`authenticated` start FALSE and flip TRUE only on evidence.
 *     A configured key is not reachability.
 *   · NOTHING reveals a secret value, a private key, or a credential. Only
 *     booleans and the NAMES of missing env vars are returned. A present key
 *     reports `configured: true`; its value is never echoed.
 *   · `available` (the old word) is deliberately avoided: it implied the
 *     provider could serve a user right now, which conflates configuration
 *     with balance/signer/withdrawal authority. Each field is narrow and true.
 */

import { feeReceiver as solanaFeeReceiver, feeBps as solanaFeeBps } from './solanaOcean.js';
import { feeRecipient as gaslessFeeRecipient, feeBps as gaslessFeeBps } from './gasless.js';
import { bridgeFee, bridgeFeeReady, integratorId } from './lifi.js';
import { dlnFeePercent, dlnFeeRecipient } from './dln.js';
import { feeBps as xchainFeeBps, feeRecipientFor as xchainFeeRecipientFor, crossChainConfigured } from './xchain.js';

const env = (k) => String(process.env[k] ?? '').trim();

/* -------------------------------------------------------------------------- */
/* Health tracker (in-process, best-effort)                                    */
/* -------------------------------------------------------------------------- */
/*
 * A lightweight ring of the most recent outcomes per provider. Not durable —
 * the point is "did the last call work", which a fresh process honestly does
 * not know until a call happens. We surface that as lastSuccessAt=null rather
 * than inventing a timestamp.
 */
const health = new Map(); // provider -> { lastSuccessAt, lastFailureAt, lastError, count }

function record(provider, outcome, detail = null) {
  const key = String(provider);
  const cur = health.get(key) || { lastSuccessAt: null, lastFailureAt: null, lastError: null, count: 0 };
  cur.count += 1;
  if (outcome === 'success') {
    cur.lastSuccessAt = new Date().toISOString();
    cur.lastError = null;
  } else {
    cur.lastFailureAt = new Date().toISOString();
    cur.lastError = String(detail ?? 'unknown').slice(0, 120);
  }
  health.set(key, cur);
  return cur;
}

/** Integration call sites call this when a provider request succeeds. */
export function recordSuccess(provider) {
  return record(provider, 'success');
}

/** Integration call sites call this when a provider request fails. */
export function recordFailure(provider, detail) {
  return record(provider, 'failure', detail);
}

function healthFor(provider) {
  return (
    health.get(String(provider)) || { lastSuccessAt: null, lastFailureAt: null, lastError: null, count: 0 }
  );
}

/* -------------------------------------------------------------------------- */
/* The standard shape                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Assemble a standard status row. `configured` and `supportedChains` are
 * derived from facts the caller supplies; `reachable`/`authenticated` come
 * from the health tracker; everything else is filled honestly.
 *
 * @param {object} opts
 * @param {string} opts.id           stable provider id
 * @param {boolean} opts.configured  credentials present?
 * @param {string[]} opts.supportedChains
 * @param {boolean} [opts.feeReady]  fee path wired? (default === configured)
 * @param {string[]} [opts.missingConfiguration]  env var names that are absent
 * @param {boolean} [opts.externalApprovalRequired]
 * @param {boolean} [opts.retryable] default true for transient network faults
 * @param {object} [opts.facts]      extra, non-sensitive facts to surface
 */
export function buildProviderStatus({
  id,
  configured,
  supportedChains,
  feeReady,
  missingConfiguration = [],
  externalApprovalRequired = false,
  retryable = true,
  facts = {}
} = {}) {
  const h = healthFor(id);
  // reachable = we have at least one logged success. We never ASSUME reachable
  // from configured alone: a key can be present while the host is down.
  const reachable = Boolean(h.lastSuccessAt);
  // authenticated = configured AND no recent auth-class failure. A 401 in the
  // last failure flips this false even if earlier calls succeeded.
  const lastWasAuth =
    h.lastError && /401|403|auth|unauthor/i.test(h.lastError);
  const authenticated = Boolean(configured && reachable && !lastWasAuth);

  return {
    id,
    configured: Boolean(configured),
    reachable,
    authenticated,
    feeReady: feeReady == null ? Boolean(configured) : Boolean(feeReady),
    supportedChains: Array.isArray(supportedChains) ? supportedChains : [],
    lastSuccessAt: h.lastSuccessAt,
    lastFailureAt: h.lastFailureAt,
    lastError: h.lastError,
    retryable: Boolean(retryable),
    missingConfiguration: Array.isArray(missingConfiguration) ? missingConfiguration : [],
    externalApprovalRequired: Boolean(externalApprovalRequired),
    // Non-sensitive, caller-supplied facts only. Never secrets.
    facts: facts && typeof facts === 'object' ? facts : {}
  };
}

/* -------------------------------------------------------------------------- */
/* Per-provider status definitions                                             */
/* -------------------------------------------------------------------------- */
/*
 * Each provider's status is derived from the SAME env vars its module reads,
 * so this endpoint cannot drift into reporting a provider as configured that
 * its module would reject (the exact "readiness quietly lies" failure this
 * codebase is careful about). Chains lists mirror the modules' SUPPORTED sets.
 */

const EVM_CHAINS_ALL = [1, 10, 56, 137, 8453, 42161, 43114, 59144, 146];

/* Public (never secret) fee metadata for the DEX & Liquidity section. */
const EVM_FEE_RECEIVER = env('ZEROX_FEE_RECIPIENT') || env('VITE_PAYOUT_EVM') || '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';
const SWAP_FEE_BPS = (() => {
  const raw = env('FEE_BPS');
  if (!raw) return 70;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 70;
})();
const evmFee = (cutPercent = 0) => ({
  bps: SWAP_FEE_BPS,
  receiver: EVM_FEE_RECEIVER,
  family: 'evm',
  providerCutPercent: cutPercent,
  netBps: Number((SWAP_FEE_BPS * (1 - cutPercent / 100)).toFixed(2))
});

export function providerStatuses() {
  return [
    buildProviderStatus({
      id: 'kyberswap',
      configured: true, // keyless aggregator
      supportedChains: [56, 1, 137, 42161, 10, 8453, 43114, 59144, 146],
      feeReady: true,
      missingConfiguration: env('KYBER_API_KEY') ? [] : ['KYBER_API_KEY (optional, raises rate limit)'],
      facts: { authMode: 'keyless', apiKeyOptional: true, fee: evmFee(0) }
    }),
    buildProviderStatus({
      id: 'openocean',
      configured: true,
      supportedChains: EVM_CHAINS_ALL,
      feeReady: true,
      missingConfiguration: env('OPENOCEAN_API_KEY') ? [] : ['OPENOCEAN_API_KEY (optional header)'],
      facts: { authMode: 'keyless', fee: evmFee(20) }
    }),
    buildProviderStatus({
      id: 'velora',
      configured: true,
      supportedChains: EVM_CHAINS_ALL,
      // Velora is quote-only today: it cannot sign, so feeReady is false in the
      // sense that no executable fee-charging path exists yet. Reported, not
      // hidden.
      feeReady: false,
      facts: { executable: false, role: 'price-source-only', fee: { ...evmFee(0), executable: false } }
    }),
    buildProviderStatus({
      id: '0x-gasless',
      configured: Boolean(env('ZEROX_API_KEY')),
      supportedChains: [1, 10, 56, 137, 8453, 42161, 43114],
      feeReady: Boolean(env('ZEROX_API_KEY')),
      missingConfiguration: env('ZEROX_API_KEY') ? [] : ['ZEROX_API_KEY'],
      externalApprovalRequired: !env('ZEROX_API_KEY'),
      facts: {
        authMode: 'api-key',
        fee: {
          bps: gaslessFeeBps(),
          receiver: gaslessFeeRecipient(),
          family: 'evm',
          providerCutPercent: 0,
          netBps: gaslessFeeBps()
        }
      }
    }),
    buildProviderStatus({
      id: '0x-cross-chain',
      configured: Boolean(env('ZEROX_API_KEY')),
      supportedChains: [1, 10, 56, 137, 8453, 42161, 43114],
      feeReady: Boolean(env('ZEROX_API_KEY')),
      missingConfiguration: env('ZEROX_API_KEY') ? [] : ['ZEROX_API_KEY'],
      facts: {
        tronOrigin: false,
        note: 'Tron works as a destination only',
        crossChainConfigured: crossChainConfigured(),
        fee: {
          bps: xchainFeeBps(),
          receiver: xchainFeeRecipientFor('1') || EVM_FEE_RECEIVER,
          family: 'evm',
          providerCutPercent: 0,
          netBps: xchainFeeBps()
        }
      }
    }),
    buildProviderStatus({
      id: 'lifi',
      configured: true, // integrator id is compiled in, keyless
      supportedChains: EVM_CHAINS_ALL,
      feeReady: bridgeFeeReady(),
      missingConfiguration: bridgeFeeReady() ? [] : ['LIFI_FEE_READY=true'],
      facts: {
        authMode: 'integrator-id',
        integrator: integratorId(),
        fee: {
          bps: Math.round(bridgeFee() * 10000),
          receiver: EVM_FEE_RECEIVER,
          family: 'evm',
          providerCutPercent: 0,
          netBps: Math.round(bridgeFee() * 10000)
        }
      }
    }),
    buildProviderStatus({
      id: 'debridge-dln',
      configured: true, // keyless, no account
      supportedChains: EVM_CHAINS_ALL,
      feeReady: true,
      facts: {
        authMode: 'keyless',
        fee: {
          bps: Math.round(dlnFeePercent() * 100),
          receiver: dlnFeeRecipient(1),
          family: 'evm',
          providerCutPercent: 0,
          netBps: Math.round(dlnFeePercent() * 100)
        }
      }
    }),
    buildProviderStatus({
      id: 'thorchain',
      configured: Boolean(env('THOR_NAME')),
      // THORName is what unlocks UTXO revenue; without it only RUNE pairs route.
      feeReady: Boolean(env('THOR_NAME')),
      supportedChains: [1, 56, 137, 43114],
      missingConfiguration: env('THOR_NAME') ? [] : ['THOR_NAME'],
      externalApprovalRequired: !env('THOR_NAME'),
      facts: {
        revenueChains: env('THOR_NAME') ? ['BTC', 'BCH', 'LTC', 'DOGE'] : ['RUNE-pairs-only'],
        fee: {
          bps: SWAP_FEE_BPS,
          receiver: EVM_FEE_RECEIVER,
          family: 'evm',
          providerCutPercent: 0,
          netBps: SWAP_FEE_BPS
        }
      }
    }),
    buildProviderStatus({
      id: 'solana-openocean',
      configured: true,
      supportedChains: ['solana'],
      feeReady: true,
      missingConfiguration: env('OPENOCEAN_API_KEY') ? [] : ['OPENOCEAN_API_KEY (optional)'],
      facts: {
        authMode: 'keyless',
        jupiterFallback: true,
        fee: {
          bps: solanaFeeBps(),
          receiver: solanaFeeReceiver(),
          family: 'solana',
          providerCutPercent: 20,
          netBps: Number((solanaFeeBps() * 0.8).toFixed(2))
        }
      }
    }),
    buildProviderStatus({
      id: 'goplus-token-risk',
      configured: true, // keyless
      supportedChains: [1, 56, 137, 42161, 10, 8453, 43114, 59144],
      feeReady: false, // not a revenue line
      facts: { authMode: 'keyless', role: 'security-only' }
    })
  ];
}

/** The aggregate report served by GET /api/providers/status. */
export function providerStatusReport() {
  const rows = providerStatuses();
  const configured = rows.filter((r) => r.configured).length;
  const reachable = rows.filter((r) => r.reachable).length;
  return {
    schema: 'fbt.provider-status.v1',
    generatedAt: new Date().toISOString(),
    summary: {
      total: rows.length,
      configured,
      reachable,
      // reachable/configured is the operational health ratio. It is NOT a
      // promise that a user trade will succeed — only that we have recent
      // evidence the provider answers.
      healthRatio: configured ? Number((reachable / configured).toFixed(2)) : 0
    },
    providers: rows
  };
}
