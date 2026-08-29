/**
 * PHASES 131–140 — WALLET & MULTICHAIN VERIFICATION
 * "Wallet connected" is a claim; a verified chain is a fact. Addresses are
 * checked per chain family, RPC and balance probes must answer, and raw
 * credential material is refused outright.
 */
import {
  WALLET_VERIFY_SCHEMA, PROVIDER_KINDS,
  verifyWalletChain, multichainCoverage, walletSecurityPosture
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
/* A valid EIP-55 checksummed address (known-good test vector). */
const EVM_OK = '0x52908400098527886E0F7030069857D2E4169EE7';
const EVM_BAD_CHECKSUM = '0x52908400098527886e0f7030069857d2e4169ee7'; // all-lower: same hex, bad checksum form
const EVM_SHORT = '0x1234';
const SOL_OK = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH';

const checksumVerify = (a) => a === EVM_OK;

const full = {
  rpcProbe: () => true,
  balanceProbe: () => 100.5
};

try {
  /* ---------- EVM ---------- */
  const evm = verifyWalletChain({ address: EVM_OK, chainId: 42161, chainName: 'Arbitrum One', providerKind: 'injected', supportedChains: [42161, 1, 8453], checksumVerify, ...full, now: NOW });
  check('a checksummed EVM address on a supported chain verifies', evm.verified === true && evm.schema === WALLET_VERIFY_SCHEMA);
  check('every check passed', evm.failed.length === 0 && evm.checks.length === 7);
  check('fail-closed flag mirrors the verdict', evm.failClosed === false);
  check('an all-lower address fails the checksum check', verifyWalletChain({ address: EVM_BAD_CHECKSUM, chainId: 42161, supportedChains: [42161], checksumVerify, ...full, now: NOW }).verified === false);
  check('a malformed address fails', verifyWalletChain({ address: EVM_SHORT, chainId: 42161, supportedChains: [42161], checksumVerify, ...full, now: NOW }).verified === false);
  check('an unsupported chain fails', verifyWalletChain({ address: EVM_OK, chainId: 137, supportedChains: [42161, 1], checksumVerify, ...full, now: NOW }).failed.includes('chain-supported'));
  check('a dead RPC fails', verifyWalletChain({ address: EVM_OK, chainId: 42161, supportedChains: [42161], checksumVerify, rpcProbe: () => false, balanceProbe: () => 1, now: NOW }).failed.includes('rpc-reachable'));
  check('a missing balance fails', verifyWalletChain({ address: EVM_OK, chainId: 42161, supportedChains: [42161], checksumVerify, rpcProbe: () => true, balanceProbe: () => null, now: NOW }).failed.includes('balance-fetched'));
  check('provider none fails', verifyWalletChain({ address: EVM_OK, chainId: 42161, supportedChains: [42161], providerKind: 'none', checksumVerify, ...full, now: NOW }).failed.includes('provider-present'));

  /* ---------- Solana ---------- */
  const sol = verifyWalletChain({ address: SOL_OK, chainId: 101, chainName: 'Solana', providerKind: 'walletconnect', supportedChains: [42161, 101], ...full, now: NOW });
  check('a solana address on solana verifies with the right shape', sol.verified === true && sol.addressShape === 'solana');
  check('an EVM address is not accepted as solana', verifyWalletChain({ address: EVM_OK, chainId: 101, supportedChains: [101], checksumVerify, ...full, now: NOW }).verified === false);

  /* ---------- raw credential boundary ---------- */
  const leaky = verifyWalletChain({ address: `0x${'a'.repeat(64)}`, chainId: 42161, supportedChains: [42161], checksumVerify: () => true, ...full, now: NOW });
  check('raw key material is refused and reported', leaky.verified === false && leaky.failed.includes('no-raw-credentials'));
  check('the signer boundary held', leaky.signerBoundaryHeld === true && leaky.rawCredentialsSeen === false);

  /* ---------- multichain coverage ---------- */
  const coverage = multichainCoverage({ entries: [{ chainId: 42161, verified: true }, { chainId: 1, verified: true }], supportedChains: [42161, 1, 8453], now: NOW });
  check('coverage counts verified chains honestly', coverage.coverage === 66.7 && coverage.unverifiedChains.includes(8453));
  check('partial coverage fails closed', coverage.allVerified === false && coverage.failClosed === true);
  check('full coverage passes', multichainCoverage({ entries: [{ chainId: 42161, verified: true }], supportedChains: [42161], now: NOW }).allVerified === true);

  /* ---------- security posture ---------- */
  check('default posture is safe', walletSecurityPosture().ok === true);
  check('raw credentials to agents breaks the posture', walletSecurityPosture({ rawCredentialsToAgents: true }).code === 'RAW_CREDENTIALS_EXPOSED');
  check('a bypassed confirmation breaks the posture', walletSecurityPosture({ executionRequiresWalletConfirmation: false }).code === 'CONFIRMATION_BYPASSED');

  /* ---------- constants ---------- */
  check('provider kinds are exactly four', PROVIDER_KINDS.join(',') === 'injected,walletconnect,embedded,none');
} catch (e) {
  check(`unexpected error: ${e.message}`, false);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error(`FAILED: ${failed.map((r) => r.name).join(' | ')}`);
  process.exitCode = 1;
}
export default results;
