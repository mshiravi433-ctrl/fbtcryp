/**
 * EXACT TRANSACTION BUILDER — fbt.intent-transaction.v1
 * ---------------------------------------------------------------------------
 * BUILDING a transaction and SENDING it are now two different things.
 *
 * Before this module, "execute" meant: fetch calldata, verify the fee, and
 * immediately push it at the wallet. There was no object in between, so there
 * was nothing to simulate, nothing to fingerprint, and nothing that could be
 * compared against what the user actually reviewed.
 *
 *   buildIntentTransactionRequest()  → an exact, inert IntentTransactionRequest
 *   simulateIntentTransaction()      → eth_call / estimateGas on THAT object
 *   sendIntentTransaction()          → the only function that touches a signer
 *
 * ─── WHAT THE FINGERPRINTS ARE FOR ──────────────────────────────────────────
 * `quoteFingerprint` covers the economics (chain, pair, amounts, min output,
 * fee, slippage). `routeFingerprint` covers the exact bytes (router address,
 * calldata, value, sender). Any material change moves at least one of them, so
 * a simulation, a review and a signature can all be BOUND to the same bytes.
 * A stale build cannot be silently substituted for the one that passed.
 *
 * ─── PRIVACY ────────────────────────────────────────────────────────────────
 * A request holds calldata and the sender address, so it is EPHEMERAL, in
 * client memory only: never persisted, never logged, never sent to the server
 * or to telemetry. `redactTransactionRequest()` is the only shape allowed to
 * leave this module for display or diagnostics.
 */

import { canonicalJson, sha256Hex } from './executionProof.js';

export const INTENT_TRANSACTION_SCHEMA = 'fbt.intent-transaction.v1';

/** A built route is only reusable for this long before it must be rebuilt. */
export const TRANSACTION_MAX_AGE_MS = 45_000;

const HEX_DATA = /^0x[0-9a-fA-F]*$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const asString = (value) => (value == null ? null : String(value));

const bigOrNull = (value) => {
  try {
    if (value == null || value === '') return null;
    return BigInt(typeof value === 'number' ? Math.trunc(value) : String(value));
  } catch {
    return null;
  }
};

/**
 * The economics the user consents to. Deliberately excludes calldata: two
 * builds of the same route at different seconds must share a quote
 * fingerprint, or every rebuild would look like a term change.
 */
export async function quoteFingerprintOf({
  chainId,
  fromSymbol,
  toSymbol,
  fromAddress = null,
  toAddress = null,
  amountInWei,
  amountOutWei,
  minOutWei,
  feeBps,
  feeReceiver = null,
  slippagePct,
  source
}) {
  return (await sha256Hex(canonicalJson({
    v: 1,
    chainId: Number(chainId),
    fromSymbol: String(fromSymbol ?? '').toUpperCase(),
    toSymbol: String(toSymbol ?? '').toUpperCase(),
    fromAddress: fromAddress ? String(fromAddress).toLowerCase() : null,
    toAddress: toAddress ? String(toAddress).toLowerCase() : null,
    amountInWei: asString(amountInWei),
    amountOutWei: asString(amountOutWei),
    minOutWei: asString(minOutWei),
    feeBps: Number(feeBps ?? 0),
    feeReceiver: feeReceiver ? String(feeReceiver).toLowerCase() : null,
    slippagePct: Number(slippagePct ?? 0),
    source: String(source ?? 'unknown')
  }))).slice(0, 40);
}

/** The exact bytes. Any change of router, calldata, value or sender moves it. */
export async function routeFingerprintOf({ chainId, from, to, data, value }) {
  return (await sha256Hex(canonicalJson({
    v: 1,
    chainId: Number(chainId),
    from: String(from ?? '').toLowerCase(),
    to: String(to ?? '').toLowerCase(),
    data: String(data ?? ''),
    value: asString(value ?? '0')
  }))).slice(0, 40);
}

/**
 * Does the calldata visibly carry the minimum-output word we expect?
 *
 * This is EVIDENCE, not proof: finding the 32-byte value inside the payload
 * shows the number reached the router argument list, it does not prove the
 * contract enforces it. Callers must never upgrade this into an
 * "output guaranteed" claim — see `claims.outputGuaranteeProven`, which stays
 * false in this phase.
 */
export function minOutAppearsInCalldata(data, minOutWei) {
  const min = bigOrNull(minOutWei);
  if (min == null || min <= 0n || !HEX_DATA.test(String(data ?? ''))) return false;
  const word = min.toString(16).padStart(64, '0').toLowerCase();
  return String(data).toLowerCase().includes(word);
}

async function lazyBuilders(overrides) {
  if (overrides) return overrides;
  const [aggregator, openocean] = await Promise.all([
    import('./aggregator'),
    import('./openocean')
  ]);
  return {
    buildAggregatorTx: aggregator.buildAggregatorTx,
    buildOpenOceanSwap: openocean.buildOpenOceanSwap,
    verifyOpenOceanFee: openocean.verifyOpenOceanFee
  };
}

/**
 * Build — and only build — the exact transaction for an executable quote.
 *
 * @returns {Promise<{ok:true, request:object}|{ok:false, code:string}>}
 *   Failure codes: CHAIN_UNSUPPORTED · BAD_ACCOUNT · UNSUPPORTED_SOURCE ·
 *   FEE_NOT_APPLIED · FEE_RECIPIENT_MISMATCH · BUILD_FAILED ·
 *   ROUTER_MISMATCH · MIN_OUTPUT_REGRESSED · QUOTE_EXPIRED
 */
export async function buildIntentTransactionRequest({
  chainId,
  account,
  quote,
  fromToken,
  toToken,
  slippage = null,
  deadlineMinutes = 20,
  expectFeeBps = 0,
  expectFeeReceiver = null,
  now = Date.now(),
  maxAgeMs = TRANSACTION_MAX_AGE_MS,
  builders = null
}) {
  if (!ADDRESS.test(String(account ?? ''))) return { ok: false, code: 'BAD_ACCOUNT' };
  if (!quote || quote.error) return { ok: false, code: 'BAD_QUOTE' };
  if (quote.expiresAt != null && now > Number(quote.expiresAt)) return { ok: false, code: 'QUOTE_EXPIRED' };

  const slippagePct = Number(slippage ?? quote.slippage ?? 0);
  const impl = await lazyBuilders(builders);
  const source = String(quote.source || '');

  let built = null;
  let routerAddress = null;

  if (source === 'aggregator') {
    /*
     * The fee lives in routeSummary, and routeSummary is what gets encoded, so
     * this is the last moment the fee can be checked against what we intended.
     * Same check as the legacy execute path — kept, not weakened.
     */
    if (expectFeeBps > 0 && expectFeeReceiver) {
      const fee = quote?.routeSummary?.extraFee;
      if (!fee || String(fee.feeAmount) !== String(expectFeeBps)) return { ok: false, code: 'FEE_NOT_APPLIED' };
      if (String(fee.feeReceiver).toLowerCase() !== String(expectFeeReceiver).toLowerCase()) {
        return { ok: false, code: 'FEE_RECIPIENT_MISMATCH' };
      }
    }
    try {
      built = await impl.buildAggregatorTx({
        chainId,
        routeSummary: quote.routeSummary,
        sender: account,
        recipient: account,
        slippageBps: Math.round(slippagePct * 100),
        deadlineMinutes
      });
    } catch (err) {
      return { ok: false, code: err?.message === 'CHAIN_UNSUPPORTED' ? 'CHAIN_UNSUPPORTED' : 'BUILD_FAILED' };
    }
    routerAddress = built?.routerAddress ?? null;
    if (!routerAddress || !HEX_DATA.test(String(built?.calldata ?? ''))) return { ok: false, code: 'BUILD_FAILED' };
    /* A build that returns a different router than the quote priced is a
       different route, not a detail. Refuse rather than sign it. */
    if (quote.routerAddress && String(quote.routerAddress).toLowerCase() !== String(routerAddress).toLowerCase()) {
      return { ok: false, code: 'ROUTER_MISMATCH' };
    }
    built = {
      to: routerAddress,
      data: built.calldata,
      value: built.value ?? 0n,
      gasLimit: built.gasLimit ?? null,
      minOutWei: built.minAmountOutWei ?? quote.minOutWei ?? null,
      amountOutWei: built.amountOutWei ?? quote.amountOutWei ?? null,
      spender: routerAddress
    };
  } else if (source === 'openocean') {
    let raw;
    try {
      raw = await impl.buildOpenOceanSwap({
        chainId,
        fromToken,
        toToken,
        amountInWei: quote.amountInWei,
        slippage: slippagePct,
        account,
        feeBps: expectFeeBps,
        feeReceiver: expectFeeReceiver,
        minOutWei: quote.minOutWei
      });
    } catch (err) {
      return { ok: false, code: err?.message === 'CHAIN_UNSUPPORTED' ? 'CHAIN_UNSUPPORTED' : 'BUILD_FAILED' };
    }
    if (!raw?.to || !HEX_DATA.test(String(raw?.data ?? ''))) return { ok: false, code: 'BUILD_FAILED' };
    /* Decode the calldata we just built and confirm OUR referrer is inside it,
       exactly as the legacy signing path did — before, not after, signing. */
    const feeOk = await impl.verifyOpenOceanFee({
      chainId,
      calldata: raw.data,
      feeBps: expectFeeBps,
      feeReceiver: expectFeeReceiver
    });
    if (!feeOk) return { ok: false, code: 'FEE_NOT_APPLIED' };
    routerAddress = raw.to;
    built = {
      to: raw.to,
      data: raw.data,
      value: raw.value ?? 0n,
      gasLimit: raw.gasLimit ?? null,
      minOutWei: raw.minOutWei ?? quote.minOutWei ?? null,
      amountOutWei: raw.amountOutWei ?? quote.amountOutWei ?? null,
      spender: raw.spender ?? raw.to
    };
  } else {
    /* Direct-router and gasless paths keep their existing flow; this builder
       only claims the two aggregator adapters it can verify end to end. */
    return { ok: false, code: 'UNSUPPORTED_SOURCE' };
  }

  /* The rebuilt minimum output may never be WORSE than the quoted one. */
  const quotedMin = bigOrNull(quote.minOutWei);
  const builtMin = bigOrNull(built.minOutWei);
  if (quotedMin != null && builtMin != null && builtMin < quotedMin) {
    return { ok: false, code: 'MIN_OUTPUT_REGRESSED' };
  }

  const quoteFingerprint = await quoteFingerprintOf({
    chainId,
    fromSymbol: fromToken?.symbol,
    toSymbol: toToken?.symbol,
    fromAddress: fromToken?.native ? 'native' : fromToken?.address,
    toAddress: toToken?.native ? 'native' : toToken?.address,
    amountInWei: quote.amountInWei,
    amountOutWei: built.amountOutWei ?? quote.amountOutWei,
    minOutWei: built.minOutWei,
    feeBps: expectFeeBps || quote.feeBps || 0,
    feeReceiver: expectFeeReceiver,
    slippagePct,
    source
  });
  const routeFingerprint = await routeFingerprintOf({
    chainId,
    from: account,
    to: built.to,
    data: built.data,
    value: built.value
  });

  return {
    ok: true,
    request: {
      schema: INTENT_TRANSACTION_SCHEMA,
      chainId: Number(chainId),
      from: String(account),
      to: String(built.to),
      data: String(built.data),
      value: (built.value ?? 0n).toString(),
      nonce: undefined,
      deadline: Math.floor(now / 1000) + Number(deadlineMinutes || 20) * 60,
      routeFingerprint,
      quoteFingerprint,
      /* everything below is metadata for simulation and review, not calldata */
      source,
      spender: String(built.spender ?? built.to),
      amountInWei: asString(quote.amountInWei),
      amountOutWei: asString(built.amountOutWei ?? quote.amountOutWei),
      minOutWei: asString(built.minOutWei),
      feeBps: Number(expectFeeBps || quote.feeBps || 0),
      slippagePct,
      gasLimit: built.gasLimit != null ? built.gasLimit.toString() : null,
      minOutEncodedInCalldata: minOutAppearsInCalldata(built.data, built.minOutWei),
      builtAt: now,
      expiresAt: now + Math.max(5_000, Number(maxAgeMs) || TRANSACTION_MAX_AGE_MS)
    }
  };
}

export function isTransactionRequestExpired(request, now = Date.now()) {
  if (!request) return true;
  if (request.expiresAt != null && now > Number(request.expiresAt)) return true;
  if (request.deadline != null && Math.floor(now / 1000) > Number(request.deadline)) return true;
  return false;
}

/** Same exact bytes and same economics? Used to bind simulation → signature. */
export function sameTransaction(a, b) {
  if (!a || !b) return false;
  return a.routeFingerprint === b.routeFingerprint && a.quoteFingerprint === b.quoteFingerprint;
}

/**
 * The ONLY path from a built request to a wallet prompt.
 *
 * It refuses unless a passing simulation for the very same fingerprints is
 * supplied, the request has not expired, and the connected account and chain
 * still match. There is deliberately no `force` flag.
 */
export async function sendIntentTransaction({
  signer,
  request,
  simulation,
  account = null,
  chainId = null,
  now = Date.now()
}) {
  if (!signer) return { ok: false, code: 'NO_SIGNER' };
  if (!request || request.schema !== INTENT_TRANSACTION_SCHEMA) return { ok: false, code: 'BAD_REQUEST' };
  if (isTransactionRequestExpired(request, now)) return { ok: false, code: 'QUOTE_EXPIRED' };
  if (!simulation || simulation.status !== 'passed') return { ok: false, code: 'SIMULATION_REQUIRED' };
  if (simulation.routeFingerprint !== request.routeFingerprint
    || simulation.quoteFingerprint !== request.quoteFingerprint) {
    return { ok: false, code: 'SIMULATION_STALE' };
  }
  if (account && String(account).toLowerCase() !== String(request.from).toLowerCase()) {
    return { ok: false, code: 'ACCOUNT_CHANGED' };
  }
  if (chainId != null && Number(chainId) !== Number(request.chainId)) {
    return { ok: false, code: 'CHAIN_CHANGED' };
  }

  const gasLimit = request.gasLimit ? (BigInt(request.gasLimit) * 12n) / 10n : undefined;
  const tx = await signer.sendTransaction({
    to: request.to,
    data: request.data,
    value: BigInt(request.value || '0'),
    ...(gasLimit ? { gasLimit } : {})
  });
  return { ok: true, code: 'SUBMITTED', hash: tx.hash, wait: () => tx.wait() };
}

/**
 * Log/display-safe view. No calldata, no sender, no recipient — only the
 * fingerprints and the bounded economics.
 */
export function redactTransactionRequest(request) {
  if (!request) return null;
  return {
    schema: request.schema,
    chainId: request.chainId,
    source: request.source,
    routeFingerprint: request.routeFingerprint,
    quoteFingerprint: request.quoteFingerprint,
    minOutWei: request.minOutWei,
    amountOutWei: request.amountOutWei,
    feeBps: request.feeBps,
    slippagePct: request.slippagePct,
    gasLimit: request.gasLimit,
    minOutEncodedInCalldata: Boolean(request.minOutEncodedInCalldata),
    builtAt: request.builtAt,
    expiresAt: request.expiresAt
  };
}
