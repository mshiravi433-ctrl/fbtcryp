/**
 * WALLET RISK / VERIFICATION HELPERS
 * ---------------------------------------------------------------------------
 * Pure, testable helpers for the Wallet command center:
 *
 *   • recipient risk (fresh address / contract / checksum)
 *   • send-gas estimates and the "no gas for this token" case
 *   • WalletConnect-style context verification (chainId, request label)
 *   • cross-chain asset grouping for the unified asset list
 *   • security score from REAL local signals only (2FA / biometrics / lock)
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * Nothing here invents data. Every function returns `null` / a missing flag
 * when the underlying source is absent, and the UI is expected to render
 * `—` + `not indexed` / `not scanned` rather than a confident zero.
 */

/** True when the input is a plausible ENS-style name (x.eth). */
export function looksLikeEnsName(v) {
  return /^[a-z0-9-]{1,64}\.eth$/i.test(String(v ?? '').trim());
}

/** True when the input is a bare domain (x.eth, x.xyz, …) — not an address. */
export function looksLikeDomain(v) {
  const s = String(v ?? '').trim();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s) && !/^0x/i.test(s);
}

/** Structural check: a 0x-prefixed 40-hex-char address. */
export function structurallyValidAddress(v) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(v ?? '').trim());
}

/**
 * EIP-55 checksum state for a structurally valid address.
 *
 * `getAddress` must be ethers' getAddress (case-sensitive checksum). When it
 * is not supplied the state is 'unknown' — a caller that forgets to pass it
 * gets an honest unknown, never a silent pass.
 *
 * Returns one of: 'checksummed' | 'unchecksummed' | 'invalid' | 'unknown'.
 */
export function checksumState(address, getAddress) {
  const a = String(address ?? '').trim();
  if (!structurallyValidAddress(a)) return 'invalid';
  if (typeof getAddress !== 'function') return 'unknown';
  try {
    return getAddress(a) === a ? 'checksummed' : 'unchecksummed';
  } catch {
    return 'invalid';
  }
}

/**
 * Classify a recipient from real on-chain facts. Every input is optional and
 * only the facts actually supplied produce flags:
 *
 *   txCount === 0  → 'fresh'          ("no previous activity")
 *   code non-empty → 'contract'       ("contract address detected")
 *   unchecksummed  → 'unchecksummed'  (valid, but not EIP-55)
 *   known === true → 'known'          (matches a local/known address)
 */
export function recipientRisk({ txCount, code, checksummed, known } = {}) {
  const flags = [];
  if (txCount === 0) flags.push('fresh');
  if (code && code !== '0x') flags.push('contract');
  if (checksummed === false) flags.push('unchecksummed');
  if (known === true) flags.push('known');
  return flags;
}

/** A conservative gas limit for a plain transfer (not a swap). */
export function sendGasLimit(token) {
  return token?.native ? 21000n : 65000n;
}

/**
 * Estimated transfer fee in native coin.
 *
 * `fee` is ethers' getFeeData() result. When gasPrice/maxFeePerGas are
 * missing the estimate is null — an honest "unknown", never a zero.
 */
export function estimateSendFeeNative({ fee, token }) {
  if (!fee) return null;
  const gp = fee.gasPrice ?? fee.maxFeePerGas ?? null;
  if (gp == null) return null;
  const { formatEther } = globalThis.__walletRiskFormatters ?? {};
  if (typeof formatEther !== 'function') return null;
  const wei = gp * sendGasLimit(token);
  try {
    return Number(formatEther(wei));
  } catch {
    return null;
  }
}

/**
 * Attach the ethers formatter once (avoids an async import inside a pure
 * module — the caller loads ethers anyway for the provider).
 */
export function setWalletRiskFormatters(formatters) {
  globalThis.__walletRiskFormatters = formatters;
}

/** True when the native balance can cover the estimated fee (small buffer). */
export function hasEnoughGas({ nativeBalance, feeNative, buffer = 1.25 }) {
  if (!Number.isFinite(nativeBalance) || !Number.isFinite(feeNative)) return null;
  return nativeBalance >= feeNative * buffer;
}

/**
 * Verify the context a signed request will be sent in. For WalletConnect
 * this is the "verify before sign" gate: the request chain must equal the
 * app's selected chain, and the chain must be one the app supports.
 */
export function verifySendContext({ tokenChainId, walletChainId, supported }) {
  const a = Number(tokenChainId);
  const b = Number(walletChainId);
  return {
    chainOk: a === b,
    supported: supported !== false && Number.isFinite(a) && Number.isFinite(b)
  };
}

/** Honest label for the request type the wallet app will be asked to sign. */
export function labelRequestType(token) {
  if (token?.native) return 'native';
  return 'erc20';
}

/**
 * Group flat per-chain holdings into unified per-symbol rows.
 *
 * The merged value is `null` unless EVERY chain row is priced — a partial
 * price feed must surface as partial, not as a silently-lower total.
 * Returns a sorted array:
 *   { symbol, name, items, chains, totalAmount, value, priced, total }
 */
export function groupHoldings(rows = []) {
  const map = new Map();
  for (const r of rows) {
    const key = r?.symbol ? String(r.symbol) : '?';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  const out = [];
  for (const [symbol, items] of map.entries()) {
    const priced = items.filter((r) => r.value != null);
    const value = priced.length === items.length
      ? priced.reduce((s, r) => s + (Number(r.value) || 0), 0)
      : null;
    out.push({
      symbol,
      name: items[0]?.name ?? symbol,
      items,
      chains: items.length,
      totalAmount: items.reduce((s, r) => s + (Number(r.amount) || 0), 0),
      value,
      priced: priced.length,
      total: items.length
    });
  }
  out.sort((a, b) => {
    if (a.value == null && b.value == null) return b.totalAmount - a.totalAmount;
    if (a.value == null) return 1;
    if (b.value == null) return -1;
    return b.value - a.value;
  });
  return out;
}

/**
 * Security score from real local signals only.
 *
 * score is null until at least one signal exists — a wallet with nothing
 * configured shows `—`, not a confident low number. `lockedNow` is the
 * transient lock state and only nudges the band, never the base.
 */
export function securityScore({ biometricEnabled, twoFactorEnabled, autoLockMinutes, lockedNow = false }) {
  const signals = [];
  if (biometricEnabled) signals.push('biometric');
  if (twoFactorEnabled) signals.push('twofactor');
  if (Number.isFinite(Number(autoLockMinutes)) && Number(autoLockMinutes) > 0 && Number(autoLockMinutes) <= 5) {
    signals.push('autolock');
  }
  if (!signals.length) {
    return { score: null, band: null, signals: [] };
  }
  let score = 20;
  if (biometricEnabled) score += 30;
  if (twoFactorEnabled) score += 25;
  if (signals.includes('autolock')) score += 15;
  if (lockedNow) score += 5;
  score = Math.min(95, score);
  return {
    score,
    band: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low',
    signals
  };
}

/**
 * Link to the chain explorer's approval-revocation tool (user-initiated tx).
 * Returns null when the chain has no such tool — an honest missing link
 * rather than a dead one.
 */
const APPROVAL_CHECKER_HOSTS = new Set([
  'bscscan.com',
  'etherscan.io',
  'polygonscan.com',
  'arbiscan.io',
  'basescan.org',
  'optimistic.etherscan.io',
  'snowtrace.io',
  'lineascan.build'
]);

export function approvalCheckerUrl(chainId, chains = null) {
  const cfg = chains?.[Number(chainId)];
  if (!cfg?.explorer) return null;
  const host = String(cfg.explorer).replace(/^https?:\/\//, '').split('/')[0];
  return APPROVAL_CHECKER_HOSTS.has(host) ? `${cfg.explorer}/tokenapprovalchecker` : null;
}
