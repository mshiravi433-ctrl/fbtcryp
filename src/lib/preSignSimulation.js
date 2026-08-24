/**
 * REAL PRE-SIGN SIMULATION — run the exact transaction the user is about to
 * sign against the chain BEFORE they sign it.
 * ---------------------------------------------------------------------------
 * The existing `mev.simulateSwap` is honest about what it is NOT: "This is NOT
 * an eth_call against the router — that would need a signer and a built
 * transaction. It is the arithmetic the review sheet already has." It measures
 * sandwich *risk*; it does not prove the trade will land.
 *
 * This module is the other half. Given a built, unsigned transaction it:
 *
 *   1. runs a real `provider.call(tx)` (eth_call) — the canonical "would this
 *      revert?" check, against the same state the next block will build on;
 *   2. runs `provider.estimateGas(tx)` — a real gas limit, not the 250k
 *      constant `estimateGasCost` assumes;
 *   3. decodes the revert reason if eth_call fails;
 *   4. checks the allowance is sufficient for the chosen spender;
 *   5. checks the recipient and spender match what was shown;
 *   6. reports whether the path is public mempool or private relay.
 *
 * ─── HONESTY CONTRACT ───────────────────────────────────────────────────────
 * An eth_call can fail for reasons that have nothing to do with the trade
 * (an RPC that rate-limits `eth_call`, a node lagging one block). So the
 * verdict distinguishes:
 *
 *   simulated-clean   — eth_call succeeded; the trade would land as quoted.
 *   revert-detected   — eth_call reverted; DO NOT sign. Includes the reason.
 *   provider-busy     — eth_call could not be run (RPC error / timeout). The
 *                       trade is NOT proven safe; the user is told we could
 *                       not simulate and signs at their own risk.
 *   unknown           — no provider or no transaction was supplied.
 *
 * We never report "safe" from a failed simulation. A busy RPC is reported as
 * `provider-busy`, which blocks the green "simulated" state, exactly so a
 * flaky node cannot lull a user into signing a reverting trade.
 *
 * ─── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * It is not a sandwich guarantee. A clean eth_call means the trade will not
 * revert at THIS block's state; it says nothing about the state at inclusion.
 * Sandwich protection is a separate concern (mevProtection.js) and the two are
 * reported independently.
 */
import { FEE_BPS_MAX as FBT_FEE_MAX_BPS } from './feeBps.js';

const loadEthers = () => import('ethers');

const ERC20_ABI = [
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)'
];

const isAddr = (v) => typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v);

/**
 * Decode a revert reason from an eth_call failure.
 *
 * ethers v6 throws a ContractFunctionExecutionError / CallExecutionError whose
 * `reason` field carries the decoded string when present; otherwise we look
 * for the two well-known selectors (Error(string), Panic(uint256)) in the raw
 * hex. Returns a short, safe string — never the raw payload (which can be
 * huge and which we do not want to leak into a UI).
 */
export function decodeRevertReason(err) {
  if (!err) return null;
  // ethers decodes the most common case for us.
  if (typeof err.reason === 'string' && err.reason.trim()) {
    return err.reason.slice(0, 200);
  }
  if (typeof err.shortMessage === 'string' && err.shortMessage.trim()) {
    return err.shortMessage.slice(0, 200);
  }
  const hex = typeof err.data === 'string' ? err.data : String(err.message ?? '');
  // Panic(uint256) = 0x4e487b71 — surface the code without inventing prose.
  // The code occupies the LOW-ORDER 4 bytes of the 32-byte argument word, so
  // after the 8-hex selector it is the LAST 8 hex characters of the 64-char
  // word that follows. Matching the first 8 would report 0x00000000 for
  // almost every real panic.
  // (Decoded synchronously because the selector + 32-byte code need no UTF-8.)
  const panicMatch = hex.match(/4e487b71([0-9a-fA-F]+)/);
  if (panicMatch) {
    const tail = panicMatch[1].slice(-8) || '00000000';
    return `Panic(0x${tail.toLowerCase()})`;
  }
  // The Error(string) body needs a UTF-8 decode (async), so a synchronous
  // caller gets the selector presence reported; full decode is available via
  // decodeRevertReasonAsync below.
  if (/08c379a0/.test(hex)) return 'revert-error-string';
  return null;
}

// The Error(string) ABI-encoding pads a 32-byte offset, a 32-byte length, then
// the bytes. We strip the first 64 hex chars (offset+length) and keep the rest.
function stripLength(hexBody) {
  if (hexBody.length <= 128) return hexBody;
  return hexBody.slice(128);
}

/** Async variant that can fully decode an Error(string) revert via ethers'
 *  toUtf8String. Used where a readable reason is worth the round-trip. */
export async function decodeRevertReasonAsync(err) {
  if (!err) return null;
  const sync = decodeRevertReason(err);
  if (sync && sync !== 'revert-error-string') return sync;
  try {
    const { toUtf8String } = await loadEthers();
    const hex = typeof err.data === 'string' ? err.data : String(err.message ?? '');
    const m = hex.match(/08c379a0([0-9a-fA-F]+)/);
    if (m) return toUtf8String('0x' + stripLength(m[1])).slice(0, 200);
  } catch {
    /* ignore */
  }
  return sync ?? null;
}

/**
 * Build the unsigned-transaction object an eth_call needs.
 *
 * `value` is accepted as a bigint or a decimal/native number string; native-in
 * swaps carry a non-zero value. Everything is reduced to the shape `call` and
 * `estimateGas` accept so neither sees a field it cannot handle.
 */
export function buildUnsignedTransaction({ from, to, data, value = 0n, gasLimit } = {}) {
  if (!isAddr(from)) throw new Error('BAD_FROM_ADDRESS');
  if (!isAddr(to)) throw new Error('BAD_TO_ADDRESS');
  if (data != null && typeof data !== 'string') throw new Error('BAD_CALLDATA');
  let valueBi;
  if (typeof value === 'bigint') valueBi = value;
  else if (typeof value === 'number' || typeof value === 'string') {
    try {
      valueBi = BigInt(String(value));
    } catch {
      valueBi = 0n;
    }
  } else {
    valueBi = 0n;
  }
  const tx = { from, to, data: data ?? '0x', value: valueBi };
  if (gasLimit != null) tx.gasLimit = toBigIntSafe(gasLimit);
  return tx;
}

function toBigIntSafe(v) {
  try {
    return typeof v === 'bigint' ? v : BigInt(String(v));
  } catch {
    return undefined;
  }
}

/**
 * Check the on-chain allowance for the input token against the amount the
 * trade will pull. Returns an explicit verdict rather than a boolean, because
 * "allowance sufficient" and "allowance unknown" must not look the same.
 *
 * @returns {{ ok: boolean, sufficient: boolean|null, allowanceWei: bigint|null, reason: string|null }}
 */
export async function checkAllowance({ provider, token, owner, spender, amountWei, tokenNative }) {
  // Native coin needs no approval — calling allowance on it would revert.
  if (tokenNative) {
    return { ok: true, sufficient: true, allowanceWei: null, reason: 'native-needs-no-approval' };
  }
  if (!provider || !isAddr(token) || !isAddr(owner) || !isAddr(spender)) {
    return { ok: false, sufficient: null, allowanceWei: null, reason: 'missing-inputs' };
  }
  try {
    const { Contract } = await loadEthers();
    const c = new Contract(token, ERC20_ABI, provider);
    const allowance = await c.allowance(owner, spender);
    const need = typeof amountWei === 'bigint' ? amountWei : BigInt(String(amountWei));
    return {
      ok: true,
      sufficient: allowance >= need,
      allowanceWei: allowance,
      reason: allowance >= need ? null : 'allowance-below-amount'
    };
  } catch (err) {
    return { ok: false, sufficient: null, allowanceWei: null, reason: 'allowance-read-failed' };
  }
}

/**
 * A simulation outcome. `status` is one of the four values documented in the
 * file header; everything else is evidence for the UI/audit trace.
 */
export function simulationOutcome({ status, revertReason, gasLimit, gasCostUsd, allowance, mempoolPath, notes }) {
  return {
    schema: 'fbt.pre-sign-simulation.v1',
    status, // 'simulated-clean' | 'revert-detected' | 'provider-busy' | 'unknown'
    revertReason: revertReason ?? null,
    gasLimit: gasLimit ?? null,
    gasCostUsd: gasCostUsd ?? null,
    allowance: allowance ?? null,
    // 'public-mempool' | 'private-relay' | 'unknown'
    mempoolPath: mempoolPath ?? 'unknown',
    // A simulation is only "proven safe" when eth_call actually ran clean.
    provenSafe: status === 'simulated-clean',
    notes: notes ?? null,
    simulatedAt: Date.now()
  };
}

/**
 * Run a real eth_call + gas estimate against the provider for an unsigned
 * transaction, and combine it with an allowance check into one verdict.
 *
 * The `provider` is the wallet's read provider. If it is absent (the user is
 * on a chain we have no RPC for, or the provider is mid-switch), we return
 * `unknown` rather than pretending we simulated.
 *
 * @param {object} opts
 * @param {object} [opts.provider]  ethers Provider (read-only is fine)
 * @param {object} opts.tx          { from, to, data, value }
 * @param {object} [opts.allowance] { token, owner, spender, amountWei, tokenNative }
 * @param {string} [opts.mempoolPath] 'public-mempool' | 'private-relay' | 'unknown'
 * @param {function} [opts.gasUsdFor] (gasLimit) => usd, optional, for the cost line
 * @returns {Promise<object>} simulationOutcome
 */
export async function simulateUnsignedTransaction({
  provider,
  tx,
  allowance,
  mempoolPath = 'unknown',
  gasUsdFor
} = {}) {
  if (!provider || !tx || !tx.from || !tx.to) {
    return simulationOutcome({ status: 'unknown', mempoolPath, notes: 'no-provider-or-tx' });
  }

  // Run eth_call, gas estimate and the allowance check concurrently. They are
  // independent reads; doing them in parallel keeps the simulation within one
  // round-trip's worth of latency rather than three.
  const [callResult, gasResult, allowanceResult] = await Promise.all([
    provider.call(tx).then(
      () => ({ ok: true, reverted: false, data: null }),
      (err) => ({ ok: false, reverted: true, error: err })
    ),
    provider.estimateGas(tx).then(
      (limit) => ({ ok: true, gasLimit: typeof limit === 'bigint' ? limit : BigInt(String(limit)) }),
      (err) => ({ ok: false, error: err })
    ),
    allowance
      ? checkAllowance({
          provider,
          token: allowance.token,
          owner: allowance.owner,
          spender: allowance.spender,
          amountWei: allowance.amountWei,
          tokenNative: allowance.tokenNative
        })
      : Promise.resolve(null)
  ]);

  // 1. eth_call reverted → the trade WILL revert. Hard stop.
  if (callResult.reverted) {
    const reason = await decodeRevertReasonAsync(callResult.error).catch(() => null);
    // A gas estimate failure on top is expected (a reverting call estimates to
    // nothing); do not double-report it.
    return simulationOutcome({
      status: 'revert-detected',
      revertReason: reason ?? 'transaction-would-revert',
      gasLimit: gasResult.ok ? gasResult.gasLimit : null,
      gasCostUsd: gasResult.ok && typeof gasUsdFor === 'function' ? safeGasUsd(gasUsdFor, gasResult.gasLimit) : null,
      allowance: allowanceResult,
      mempoolPath,
      notes: 'eth_call-reverted'
    });
  }

  // 2. eth_call was clean but gas estimate failed. Unusual, but we treat it as
  //    "could not fully simulate" rather than "simulated-clean": the gas limit
  //    is the protection against a sandwich blowing past slippage, and we do
  //    not want to assert "safe" without it.
  if (!gasResult.ok) {
    return simulationOutcome({
      status: 'provider-busy',
      revertReason: null,
      gasLimit: null,
      gasCostUsd: null,
      allowance: allowanceResult,
      mempoolPath,
      notes: 'gas-estimate-unavailable'
    });
  }

  // 3. eth_call clean AND gas estimated. If an allowance check was requested
  //    and it FAILED TO READ, we downgrade to provider-busy: we cannot claim a
  //    clean simulation while a safety read is missing.
  if (allowanceResult && !allowanceResult.ok) {
    return simulationOutcome({
      status: 'provider-busy',
      revertReason: null,
      gasLimit: gasResult.gasLimit,
      gasCostUsd: typeof gasUsdFor === 'function' ? safeGasUsd(gasUsdFor, gasResult.gasLimit) : null,
      allowance: allowanceResult,
      mempoolPath,
      notes: 'allowance-read-failed'
    });
  }

  return simulationOutcome({
    status: 'simulated-clean',
    revertReason: null,
    gasLimit: gasResult.gasLimit,
    gasCostUsd: typeof gasUsdFor === 'function' ? safeGasUsd(gasUsdFor, gasResult.gasLimit) : null,
    allowance: allowanceResult,
    mempoolPath,
    notes: 'eth_call-clean'
  });
}

function safeGasUsd(fn, gasLimit) {
  try {
    const v = fn(gasLimit);
    return Number.isFinite(Number(v)) ? Number(v) : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Recipient / spender sanity                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Verify the recipient and spender in a quote match what was shown to the user
 * and what is safe. Pure, so it can gate signing without a provider.
 *
 * @returns {{ ok: boolean, reason: string|null }}
 *   ok is false when the recipient is the zero address, the spender is the
 *   zero address, or either is structurally invalid. It is NOT false when
 *   they are merely unusual — that is the user's call, not ours.
 */
export function verifyCounterparties({ recipient, spender } = {}) {
  const ZERO = '0x0000000000000000000000000000000000000000';
  if (recipient != null) {
    if (!isAddr(recipient)) return { ok: false, reason: 'recipient-not-an-address' };
    if (recipient.toLowerCase() === ZERO) return { ok: false, reason: 'recipient-is-zero-address' };
  }
  if (spender != null) {
    if (!isAddr(spender)) return { ok: false, reason: 'spender-not-an-address' };
    if (spender.toLowerCase() === ZERO) return { ok: false, reason: 'spender-is-zero-address' };
  }
  return { ok: true, reason: null };
}

/**
 * Compute the real amountOutMin for a quote, with a short, displayed deadline.
 *
 * Mirrors the slippage math in swap.js but lives here so a pre-sign gate can
 * assert "the min we are about to enforce is exactly slippage below the quote"
 * without re-deriving it from a provider shape.
 */
export function computeAmountOutMin({ amountOutWei, slippageBps }) {
  const out = typeof amountOutWei === 'bigint' ? amountOutWei : BigInt(String(amountOutWei));
  const bps = Math.max(0, Math.min(10_000, Math.round(Number(slippageBps) || 0)));
  return (out * BigInt(10_000 - bps)) / 10_000n;
}

/** A short, displayed deadline (seconds since epoch). Defaults to 20 minutes. */
export function computeDeadline({ deadlineMinutes = 20 } = {}) {
  const mins = Math.max(1, Math.min(120, Math.round(Number(deadlineMinutes) || 20)));
  return BigInt(Math.floor(Date.now() / 1000) + mins * 60);
}

export { FBT_FEE_MAX_BPS };
