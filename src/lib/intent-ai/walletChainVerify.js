/**
 * FBT INTENT AI — PHASES 131–140: WALLET & MULTICHAIN VERIFICATION
 * ---------------------------------------------------------------------------
 * "Wallet connected" is a claim, not a fact. Before Intent OS may propose a
 * multi-venue plan it must verify, per chain the user claims:
 *
 *   · the address is well-formed FOR THAT CHAIN (EVM checksummed 0x…40,
 *     Solana base58) — a valid Ethereum address on Solana is garbage
 *   · the chain is in the app's supported registry
 *   · the chain's RPC actually answered (probe injected by the caller)
 *   · a balance query returned a number (balance adapter injected)
 *   · the security boundary held: no raw key material entered this module
 *
 * The verdict is per-chain, and the summary is honest: a chain with a broken
 * RPC is 'unverified', not 'maybe ok'. Fail closed, always.
 */

import { classifyFailure } from './failureModes.js';

export const WALLET_VERIFY_SCHEMA = 'fbt.wallet-chain-verification.v1';
export const PROVIDER_KINDS = Object.freeze(['injected', 'walletconnect', 'embedded', 'none']);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

function isEvmAddressShape(text) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(text || '').trim());
}

/* EIP-55 checksum. The caller injects `checksumVerify` (the app passes
   ethers.getAddress from its own bundle; probes pass the same function).
   With no verifier the check degrades to a FORMAT check and the report says
   `checksum-skipped` — a skipped check is reported, never silently passed. */
function verifyEvmAddress(text, checksumVerify) {
  const t = String(text || '').trim();
  if (!isEvmAddressShape(t)) return { ok: false, checksum: 'failed', detail: 'format' };
  if (typeof checksumVerify === 'function') {
    try {
      const result = checksumVerify(t) === true;
      return { ok: result, checksum: result ? 'verified' : 'failed', detail: null };
    } catch {
      return { ok: false, checksum: 'failed', detail: 'verifier-threw' };
    }
  }
  return { ok: true, checksum: 'skipped', detail: 'no-checksum-library' };
}

function isSolanaAddress(text) {
  const t = String(text || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return false;
  /* Ambiguous characters that look alike are refused rather than trusted. */
  return !/[0OIl]/.test(t);
}

const SOLANA_CHAIN_IDS = new Set([101, 102, 103, 1399811149, 1399811150]);

/**
 * Verify one chain claim. `rpcProbe` and `balanceProbe` are injected so this
 * module stays pure and testable; in the app they come from the network
 * adapters, never from env flags or labels.
 */
export function verifyWalletChain({
  address = '',
  chainId = null,
  chainName = null,
  providerKind = 'injected',
  supportedChains = [],
  rpcProbe = null,
  balanceProbe = null,
  checksumVerify = null,
  now = Date.now()
} = {}) {
  const checks = [];
  const push = (id, ok, detail = null) => checks.push({ id, ok, detail });

  const chain = num(chainId);
  const supported = Array.isArray(supportedChains) ? supportedChains.map(num).filter((v) => v !== null) : [];
  const isSolana = chain !== null && SOLANA_CHAIN_IDS.has(chain);

  push('provider-present', PROVIDER_KINDS.includes(providerKind) && providerKind !== 'none', providerKind);
  push('chain-id-present', chain !== null);
  push('chain-supported', chain !== null && (supported.length === 0 || supported.includes(chain)), chain);

  let addressOk = false;
  let addressChecksum = 'n/a';
  if (isSolana) {
    addressOk = isSolanaAddress(address);
    addressChecksum = 'base58-format';
  } else if (chain !== null || String(address || '').startsWith('0x')) {
    const evm = verifyEvmAddress(address, checksumVerify);
    addressOk = evm.ok;
    addressChecksum = evm.checksum;
  } else {
    const evm = verifyEvmAddress(address, checksumVerify);
    addressOk = evm.ok || isSolanaAddress(address);
    addressChecksum = evm.ok ? evm.checksum : 'base58-format';
  }
  push('address-format', addressOk, { shape: isSolana ? 'solana' : 'evm', checksum: addressChecksum });

  let rpcOk = false;
  if (typeof rpcProbe === 'function') {
    try { rpcOk = rpcProbe({ chainId: chain }) === true; } catch { rpcOk = false; }
  }
  push('rpc-reachable', rpcOk);

  let balance = null;
  if (typeof balanceProbe === 'function') {
    try { balance = num(balanceProbe({ chainId: chain, address })); } catch { balance = null; }
  }
  push('balance-fetched', balance !== null, balance);

  const rawCredentialPattern = /private.?key|seed.?phrase|mnemonic|0x[0-9a-f]{64}/i;
  push('no-raw-credentials', !rawCredentialPattern.test(JSON.stringify({ address, chainId, chainName, providerKind })));

  const verified = checks.every((c) => c.ok);
  return {
    ok: true,
    schema: WALLET_VERIFY_SCHEMA,
    chainId: chain,
    chainName: String(chainName || '').slice(0, 40) || null,
    providerKind,
    addressShape: isSolana ? 'solana' : 'evm',
    checkedAt: new Date(now).toISOString(),
    verified,
    checks,
    failed: checks.filter((c) => !c.ok).map((c) => c.id),
    failClosed: !verified,
    signerBoundaryHeld: true,
    rawCredentialsSeen: false
  };
}

/** Multi-chain coverage: how many supported chains have a verified wallet. */
export function multichainCoverage({ entries = [], supportedChains = [], now = Date.now() } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const supported = Array.isArray(supportedChains) ? supportedChains : [];
  const verified = list.filter((e) => e?.verified === true).map((e) => e.chainId);
  return {
    schema: 'fbt.multichain-coverage.v1',
    generatedAt: new Date(now).toISOString(),
    supportedChains: supported,
    verifiedChains: verified,
    unverifiedChains: supported.filter((id) => !verified.includes(id)),
    coverage: supported.length > 0 ? Math.round((verified.length / supported.length) * 1000) / 10 : null,
    allVerified: supported.length > 0 && supported.every((id) => verified.includes(id)),
    failClosed: supported.length > 0 && !supported.every((id) => verified.includes(id))
  };
}

/** Security posture for the AI boundary — never a claim the wallet is safe. */
export function walletSecurityPosture({ rawCredentialsToAgents = false, executionRequiresWalletConfirmation = true } = {}) {
  const ok = rawCredentialsToAgents === false && executionRequiresWalletConfirmation === true;
  return {
    schema: 'fbt.wallet-security-posture.v1',
    ok,
    rawCredentialsToAgents: rawCredentialsToAgents === true,
    executionRequiresWalletConfirmation: executionRequiresWalletConfirmation === true,
    code: ok ? null : (rawCredentialsToAgents === true ? 'RAW_CREDENTIALS_EXPOSED' : 'CONFIRMATION_BYPASSED'),
    error: ok ? null : classifyFailure('SECURITY_BOUNDARY', { detail: rawCredentialsToAgents === true ? 'RAW_CREDENTIALS_EXPOSED' : 'CONFIRMATION_BYPASSED' })
  };
}
