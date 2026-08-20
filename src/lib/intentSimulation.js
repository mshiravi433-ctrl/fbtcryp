/**
 * EXACT RPC PREFLIGHT SIMULATION — fbt.intent-simulation.v1
 * ---------------------------------------------------------------------------
 * A real `eth_call` + `estimateGas` against the EXACT transaction the user is
 * about to sign — not a re-reading of the quote we already have.
 *
 *   Build exact TX → verify chain → verify account → balance → allowance →
 *   provider.call → provider.estimateGas → decode revert → result
 *
 * ─── THE HONESTY RULES (the whole point of this file) ───────────────────────
 * · A successful `eth_call` is NOT a guarantee. It says the transaction would
 *   not revert against the state of one block on one node. Nothing more.
 * · No state diff is produced, so `claims.stateDiffAvailable` is false.
 * · The router does not hand back a decodable output here, so
 *   `claims.outputGuaranteeProven` is false — even when the min-output word is
 *   visibly present in the calldata (that is evidence, not enforcement proof).
 * · There is no attested private relay, so `privateRelayAttested` is false.
 * · An RPC failure is `rpc-unavailable`. It can never become `passed`.
 * · A simulation is bound to the route+quote fingerprints it ran on; after any
 *   change it is stale by construction (see `simulationMatches`).
 * · State overrides that fake an allowance are NOT used in production. The
 *   helper exists behind an explicit `experimentalStateOverride` flag and the
 *   result is labelled `unsupported-experimental` if it is ever used.
 *
 * The provider is injected, so this module is testable with a mock and has no
 * dependency on ethers, React, or any wallet.
 */

export const INTENT_SIMULATION_SCHEMA = 'fbt.intent-simulation.v1';
export const SIMULATION_MODE = 'exact-rpc-preflight';

export const SIMULATION_STATUSES = Object.freeze([
  'passed',
  'approval-required',
  'insufficient-balance',
  'reverted',
  'rpc-unavailable',
  'rpc-disagreement',
  'quote-expired',
  'chain-mismatch',
  'account-mismatch'
]);

const ERROR_STRING_SELECTOR = '0x08c379a0';
const PANIC_SELECTOR = '0x4e487b71';

const toBig = (value) => {
  try {
    if (value == null || value === '') return null;
    if (typeof value === 'bigint') return value;
    return BigInt(typeof value === 'number' ? Math.trunc(value) : String(value));
  } catch {
    return null;
  }
};

/** Extract revert data from the many shapes providers use. */
export function revertDataOf(error) {
  const candidates = [
    error?.data,
    error?.error?.data,
    error?.info?.error?.data,
    error?.data?.data,
    error?.value
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^0x[0-9a-fA-F]*$/.test(candidate) && candidate.length >= 10) {
      return candidate.toLowerCase();
    }
    if (candidate && typeof candidate === 'object' && typeof candidate.data === 'string') {
      return candidate.data.toLowerCase();
    }
  }
  return null;
}

/**
 * Decode a revert payload into a short, translatable code.
 *   Error(string)  → REVERT:<REASON>
 *   Panic(uint256) → PANIC:0x..
 *   custom error   → CUSTOM:<4-byte selector>
 */
export function decodeRevert(data) {
  if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  const body = data.slice(10);

  if (selector === ERROR_STRING_SELECTOR) {
    try {
      const length = Number(BigInt('0x' + body.slice(64, 128)));
      const hex = body.slice(128, 128 + length * 2);
      let text = '';
      for (let i = 0; i < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      const reason = text.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 48).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      return reason ? `REVERT:${reason}` : 'REVERT:UNKNOWN';
    } catch {
      return 'REVERT:UNDECODABLE';
    }
  }
  if (selector === PANIC_SELECTOR) {
    try {
      return `PANIC:0x${BigInt('0x' + body.slice(0, 64)).toString(16)}`;
    } catch {
      return 'PANIC:UNKNOWN';
    }
  }
  return `CUSTOM:${selector}`;
}

/** Does this error mean "the node refused/could not answer" rather than "revert"? */
export function isRpcFailure(error) {
  const code = String(error?.code ?? '');
  const message = String(error?.shortMessage || error?.message || error || '');
  if (['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR', 'UNSUPPORTED_OPERATION'].includes(code)) return true;
  if (revertDataOf(error)) return false;
  return /timeout|timed out|fetch failed|network|rate limit|too many requests|econn|502|503|504|not supported|method .* not/i
    .test(message);
}

function result({
  intentId,
  request,
  status,
  gasEstimate = null,
  revertCode = null,
  blockNumber = null,
  now,
  exactTransactionSimulated = false,
  detail = null,
  mode = SIMULATION_MODE
}) {
  return {
    schema: INTENT_SIMULATION_SCHEMA,
    intentId: intentId ? String(intentId).slice(0, 64) : null,
    routeFingerprint: request?.routeFingerprint ?? null,
    quoteFingerprint: request?.quoteFingerprint ?? null,
    chainId: Number(request?.chainId ?? 0),
    mode,
    status,
    gasEstimate: gasEstimate == null ? null : String(gasEstimate),
    revertCode: revertCode ? String(revertCode).slice(0, 80) : null,
    simulatedAt: now,
    blockNumber: blockNumber == null ? null : Number(blockNumber),
    claims: {
      /* True only when eth_call actually ran on these exact bytes. */
      exactTransactionSimulated: Boolean(exactTransactionSimulated),
      /* No trace/state-diff API is used, so this is always false today. */
      stateDiffAvailable: false,
      /* The router does not return a decodable output through eth_call here,
         and calldata inspection is evidence, not enforcement proof. */
      outputGuaranteeProven: false,
      /* No relay attestation exists. */
      privateRelayAttested: false
    },
    evidence: {
      minOutEncodedInCalldata: Boolean(request?.minOutEncodedInCalldata),
      minOutWei: request?.minOutWei ?? null,
      spender: request?.spender ? String(request.spender).toLowerCase() : null,
      ...(detail && typeof detail === 'object' ? detail : {})
    }
  };
}

/**
 * Run the preflight.
 *
 * @param {object} opts
 * @param {object} opts.provider  read-only provider: getNetwork/getBlockNumber/
 *                                getBalance/call/estimateGas
 * @param {object} opts.request   IntentTransactionRequest (exact bytes)
 * @param {object} [opts.erc20]   { balanceOf(owner), allowance(owner,spender) }
 *                                required when the input token is an ERC-20
 * @param {string} [opts.account] the currently connected account
 * @param {number} [opts.chainId] the currently connected chain
 * @param {boolean} [opts.experimentalStateOverride] never true in production
 */
export async function simulateIntentTransaction({
  provider,
  request,
  erc20 = null,
  account = null,
  chainId = null,
  intentId = null,
  amountInWei = null,
  now = Date.now(),
  experimentalStateOverride = false
}) {
  const mode = experimentalStateOverride ? 'unsupported-experimental-state-override' : SIMULATION_MODE;
  const base = (status, extra = {}) => result({ intentId, request, status, now, mode, ...extra });

  if (!request || request.schema !== 'fbt.intent-transaction.v1') {
    return base('rpc-unavailable', { revertCode: 'BAD_REQUEST' });
  }
  if (!provider) return base('rpc-unavailable', { revertCode: 'NO_PROVIDER' });

  /* 0. expiry — an expired build must never be simulated into a green light. */
  if (request.expiresAt != null && now > Number(request.expiresAt)) return base('quote-expired');
  if (request.deadline != null && Math.floor(now / 1000) > Number(request.deadline)) return base('quote-expired');

  /* 1. chain */
  let network = null;
  try {
    network = await provider.getNetwork?.();
  } catch (err) {
    return base('rpc-unavailable', { revertCode: 'NETWORK_READ_FAILED' });
  }
  const liveChainId = Number(network?.chainId ?? chainId ?? request.chainId);
  if (Number.isFinite(liveChainId) && liveChainId !== Number(request.chainId)) return base('chain-mismatch');
  if (chainId != null && Number(chainId) !== Number(request.chainId)) return base('chain-mismatch');

  /* 2. account */
  if (account && String(account).toLowerCase() !== String(request.from).toLowerCase()) {
    return base('account-mismatch');
  }

  /* 3. balance — native value plus, for an ERC-20 input, the token balance. */
  const value = toBig(request.value) ?? 0n;
  let nativeBalance = null;
  try {
    nativeBalance = toBig(await provider.getBalance(request.from));
  } catch (err) {
    if (isRpcFailure(err)) return base('rpc-unavailable', { revertCode: 'BALANCE_READ_FAILED' });
    nativeBalance = null;
  }
  if (nativeBalance != null && value > 0n && nativeBalance < value) return base('insufficient-balance');

  const spendWei = toBig(amountInWei ?? request.amountInWei);
  if (erc20 && spendWei != null && spendWei > 0n) {
    let tokenBalance = null;
    try {
      tokenBalance = toBig(await erc20.balanceOf(request.from));
    } catch (err) {
      if (isRpcFailure(err)) return base('rpc-unavailable', { revertCode: 'TOKEN_BALANCE_READ_FAILED' });
    }
    if (tokenBalance != null && tokenBalance < spendWei) return base('insufficient-balance');

    /* 4. allowance — a missing allowance is NOT a failure, it is the
       AWAITING_APPROVAL branch of the lifecycle. No state override is used to
       pretend the approval already happened. */
    let allowance = null;
    try {
      allowance = toBig(await erc20.allowance(request.from, request.spender ?? request.to));
    } catch (err) {
      if (isRpcFailure(err)) return base('rpc-unavailable', { revertCode: 'ALLOWANCE_READ_FAILED' });
    }
    if (allowance != null && allowance < spendWei) {
      return base('approval-required', {
        detail: { allowanceWei: allowance.toString(), requiredWei: spendWei.toString() }
      });
    }
  }

  const tx = {
    from: request.from,
    to: request.to,
    data: request.data,
    value
  };

  /* 5. eth_call on the exact bytes. */
  try {
    await provider.call(tx);
  } catch (err) {
    if (isRpcFailure(err)) return base('rpc-unavailable', { revertCode: 'CALL_UNAVAILABLE' });
    const decoded = decodeRevert(revertDataOf(err)) || 'REVERT:UNDECODABLE';
    return base('reverted', { revertCode: decoded, exactTransactionSimulated: true });
  }

  /* 6. estimateGas on the same bytes. A node that answers `call` but refuses
        `estimateGas` is reported as rpc-unavailable, never as passed-with-null. */
  let gasEstimate = null;
  try {
    gasEstimate = toBig(await provider.estimateGas(tx));
  } catch (err) {
    if (isRpcFailure(err)) return base('rpc-unavailable', { revertCode: 'ESTIMATE_UNAVAILABLE' });
    const decoded = decodeRevert(revertDataOf(err)) || 'REVERT:UNDECODABLE';
    return base('reverted', { revertCode: decoded, exactTransactionSimulated: true });
  }
  if (gasEstimate == null) return base('rpc-unavailable', { revertCode: 'ESTIMATE_UNAVAILABLE' });

  let blockNumber = null;
  try {
    blockNumber = await provider.getBlockNumber?.();
  } catch {
    blockNumber = null;
  }

  return base('passed', {
    gasEstimate,
    blockNumber,
    exactTransactionSimulated: true
  });
}

/**
 * MULTI-RPC PREFLIGHT QUORUM — fbt.intent-simulation.v1 (multi-node)
 * ---------------------------------------------------------------------------
 * Run the SAME exact bytes against several independent read-only RPC nodes and
 * only report `rpc-disagreement` when they genuinely contradict each other
 * (one passes, another reverts). A node that simply fails to answer is NOT a
 * vote — it is never counted as a disagreement.
 *
 * The full preflight (chain · account · balance · allowance · eth_call ·
 * estimateGas) runs on the primary node and keeps its authoritative verdict.
 * The quorum then independently re-runs the on-chain `eth_call` of the exact
 * bytes on every other node. When they all agree, the primary result is
 * returned unchanged (with a `quorum` block attached so the proof can state
 * how many nodes agreed). When a real passed-vs-reverted split appears, the
 * status becomes `rpc-disagreement` and recovery maps it to RPC_DISAGREEMENT.
 *
 * Honesty is unchanged: even an all-agree quorum is a set of eth_call
 * observations, not an execution, output, ordering or MEV guarantee.
 *
 * @param {object} opts
 * @param {object[]} opts.providers  independent read-only providers (>=1)
 * @param {object} opts.request      IntentTransactionRequest (exact bytes)
 * @param {object} [opts.erc20]
 * @param {string} [opts.account]
 * @param {number} [opts.chainId]
 * @param {number} [opts.primaryIndex=0]
 */
export async function simulateIntentTransactionQuorum({
  providers,
  request,
  erc20 = null,
  account = null,
  chainId = null,
  intentId = null,
  amountInWei = null,
  now = Date.now(),
  experimentalStateOverride = false,
  primaryIndex = 0
}) {
  const list = Array.isArray(providers) ? providers.filter(Boolean) : [];
  const mode = experimentalStateOverride ? 'unsupported-experimental-state-override' : SIMULATION_MODE;
  if (!request || request.schema !== 'fbt.intent-transaction.v1') {
    return result({ intentId, request, status: 'rpc-unavailable', now, mode, revertCode: 'BAD_REQUEST' });
  }
  if (!list.length) {
    return result({ intentId, request, status: 'rpc-unavailable', now, mode, revertCode: 'NO_PROVIDER' });
  }

  const primary = list[primaryIndex] ?? list[0];

  /* The full, authority-rich preflight on the primary node. */
  const verdict = await simulateIntentTransaction({
    provider: primary,
    request,
    erc20,
    account,
    chainId,
    intentId,
    amountInWei,
    now,
    experimentalStateOverride
  });

  /*
   * Quorum only refines the on-chain bytes verdict. If the primary never got
   * to the node, or was gated earlier (approval / balance / chain / account /
   * quote-expired), there is nothing to compare byte-for-byte yet.
   */
  if (verdict.status !== 'passed' && verdict.status !== 'reverted') return verdict;

  const tx = {
    from: request.from,
    to: request.to,
    data: request.data,
    value: toBig(request.value) ?? 0n
  };

  const outcomes = [{ providerIndex: primaryIndex, status: verdict.status, revertCode: verdict.revertCode }];

  for (let i = 0; i < list.length; i += 1) {
    if (i === primaryIndex) continue;
    const provider = list[i];
    let outcome = { providerIndex: i, status: null, revertCode: null };
    try {
      await provider.call(tx);
      outcome.status = 'passed';
    } catch (err) {
      if (isRpcFailure(err)) outcome.status = 'rpc-unavailable';
      else {
        outcome.status = 'reverted';
        outcome.revertCode = decodeRevert(revertDataOf(err)) || 'REVERT:UNDECODABLE';
      }
    }
    outcomes.push(outcome);
  }

  const votes = outcomes.filter((o) => o.status === 'passed' || o.status === 'reverted');
  const passed = votes.filter((o) => o.status === 'passed').length;
  const reverted = votes.filter((o) => o.status === 'reverted').length;
  const unavailable = outcomes.filter((o) => o.status === 'rpc-unavailable').length;

  /* Only a genuine passed-vs-reverted split is disagreement. */
  const realDisagreement = passed > 0 && reverted > 0;

  const quorum = {
    providersChecked: list.length,
    passed,
    reverted,
    unavailable,
    agreed: realDisagreement ? false : true,
    outcomes: outcomes.map(({ providerIndex, status, revertCode }) => ({
      providerIndex,
      status,
      revertCode: revertCode ?? null
    }))
  };

  if (realDisagreement) {
    return {
      ...verdict,
      status: 'rpc-disagreement',
      revertCode: 'RPC_DISAGREEMENT',
      evidence: {
        ...(verdict.evidence ?? {}),
        quorum
      }
    };
  }

  /* All answering nodes agree → keep the primary verdict, attach the quorum. */
  return {
    ...verdict,
    evidence: {
      ...(verdict.evidence ?? {}),
      quorum
    }
  };
}

/** A simulation is only valid for the exact request it was produced from. */
export function simulationMatches(simulation, request) {
  if (!simulation || !request) return false;
  return simulation.routeFingerprint === request.routeFingerprint
    && simulation.quoteFingerprint === request.quoteFingerprint
    && Number(simulation.chainId) === Number(request.chainId);
}

/** Stale after `maxAgeMs`, after any fingerprint change, or after expiry. */
export function simulationIsFresh(simulation, request, { now = Date.now(), maxAgeMs = 45_000 } = {}) {
  if (!simulationMatches(simulation, request)) return false;
  if (request.expiresAt != null && now > Number(request.expiresAt)) return false;
  return now - Number(simulation.simulatedAt || 0) <= maxAgeMs;
}

/**
 * Build the ERC-20 reader the preflight needs, using ethers only when it is
 * actually required (native-in swaps never load it).
 */
export async function erc20Reader({ provider, tokenAddress }) {
  if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(String(tokenAddress))) return null;
  const { Contract } = await import('ethers');
  const abi = [
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address,address) view returns (uint256)'
  ];
  const contract = new Contract(tokenAddress, abi, provider);
  return {
    balanceOf: (owner) => contract.balanceOf(owner),
    allowance: (owner, spender) => contract.allowance(owner, spender)
  };
}

/** Compact, privacy-safe summary for proofs and UI (no calldata, no address). */
export function simulationSummary(simulation) {
  if (!simulation) return null;
  return {
    schema: simulation.schema,
    mode: simulation.mode,
    status: simulation.status,
    gasEstimate: simulation.gasEstimate,
    revertCode: simulation.revertCode,
    blockNumber: simulation.blockNumber,
    simulatedAt: simulation.simulatedAt,
    routeFingerprint: simulation.routeFingerprint,
    quoteFingerprint: simulation.quoteFingerprint,
    claims: simulation.claims,
    quorum: simulation.evidence?.quorum ?? null
  };
}
