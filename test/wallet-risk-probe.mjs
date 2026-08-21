/**
 * WALLET RISK / VERIFICATION PROBE — pure helpers, no DOM, no network.
 * ---------------------------------------------------------------------------
 * The wallet command center's honesty rules live in src/lib/walletRisk.js:
 * nothing there may invent data. These probes pin the behaviors that cost
 * real money if they regress — recipient classification, gas estimates that
 * return null (never zero) when the fee feed is missing, the WC chain gate,
 * cross-chain grouping that stays partial, and a security score that stays
 * null until a real signal exists.
 */
import {
  looksLikeEnsName,
  looksLikeDomain,
  structurallyValidAddress,
  checksumState,
  recipientRisk,
  sendGasLimit,
  estimateSendFeeNative,
  hasEnoughGas,
  verifySendContext,
  labelRequestType,
  groupHoldings,
  securityScore,
  approvalCheckerUrl,
  setWalletRiskFormatters
} from '../src/lib/walletRisk.js';

export default function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  /* ---- domain / address shape ------------------------------------------ */
  t('x.eth is detected as an ENS name', looksLikeEnsName('vitalik.eth') === true);
  t('a hex address is not an ENS name', looksLikeEnsName('0xabc') === false);
  t('a bare domain is detected as a domain', looksLikeDomain('vitalik.eth') === true);
  t('an address is not treated as a domain', looksLikeDomain('0x1234567890123456789012345678901234567890') === false);
  t('a 40-hex address is structurally valid', structurallyValidAddress('0x1234567890123456789012345678901234567890') === true);
  t('a short string is structurally invalid', structurallyValidAddress('0x1234') === false);

  /* ---- checksum --------------------------------------------------------- */
  // Stand-in for ethers.getAddress: a checksummed spelling differs from the
  // raw lowercase input (EIP-55 mixed case). The canonical spelling below is
  // what a real ethers.getAddress would return for that address.
  const CANON = '0xAbCdef1234567890AbCdef1234567890AbCdef12';
  const getAddress = (a) => (a.toLowerCase() === CANON.toLowerCase() ? CANON : a);
  t('missing getAddress yields an honest unknown', checksumState('0x1234567890123456789012345678901234567890', null) === 'unknown');
  t('malformed input is invalid', checksumState('nope', getAddress) === 'invalid');
  t('an all-lowercase address is unchecksummed', checksumState(CANON.toLowerCase(), getAddress) === 'unchecksummed');
  t('an exact-case address is checksummed', checksumState(CANON, getAddress) === 'checksummed');

  /* ---- recipient risk --------------------------------------------------- */
  const f1 = recipientRisk({ txCount: 0, code: '0x', checksummed: true });
  t('a zero-nonce address is flagged fresh', f1.includes('fresh'));
  t('an EOA code does not flag contract', !f1.includes('contract'));
  const f2 = recipientRisk({ txCount: 4, code: '0x6080', checksummed: true });
  t('a non-empty code flags contract', f2.includes('contract'));
  t('an active EOA is not fresh', !f2.includes('fresh'));
  t('an unchecksummed address is flagged', recipientRisk({ checksummed: false }).includes('unchecksummed'));

  /* ---- gas --------------------------------------------------------------- */
  setWalletRiskFormatters({
    formatEther: (wei) => {
      const n = Number(wei) / 1e18;
      return String(n);
    }
  });
  t('native transfers reserve a smaller gas limit than ERC-20',
    sendGasLimit({ native: true }) === 21000n && sendGasLimit({ native: false }) === 65000n);
  const fee = { gasPrice: 10n ** 9n }; // 1 gwei
  const nativeFee = estimateSendFeeNative({ fee, token: { native: true } });
  const ercFee = estimateSendFeeNative({ fee, token: { native: false } });
  t('the native fee estimate is 21000 gwei', nativeFee != null && Math.abs(nativeFee - 0.000021) < 1e-12);
  t('the ERC-20 fee estimate is 65000 gwei', ercFee != null && Math.abs(ercFee - 0.000065) < 1e-12);
  t('missing fee data yields null, not zero', estimateSendFeeNative({ fee: null, token: {} }) === null);
  t('missing gas price yields null, not zero', estimateSendFeeNative({ fee: {}, token: {} }) === null);
  t('sufficient balance passes the gas check', hasEnoughGas({ nativeBalance: 1, feeNative: 0.01 }) === true);
  t('insufficient balance fails the gas check', hasEnoughGas({ nativeBalance: 0.005, feeNative: 0.01 }) === false);
  t('unknown balance yields null (never a confident yes)', hasEnoughGas({ nativeBalance: null, feeNative: 0.01 }) === null);

  /* ---- WC-style context gate --------------------------------------------- */
  const okCtx = verifySendContext({ tokenChainId: 56, walletChainId: 56, supported: true });
  t('matching chains verify', okCtx.chainOk === true && okCtx.supported === true);
  const badCtx = verifySendContext({ tokenChainId: 1, walletChainId: 56, supported: true });
  t('a chain mismatch is detected', badCtx.chainOk === false);
  const unsupported = verifySendContext({ tokenChainId: 999, walletChainId: 999, supported: false });
  t('an unsupported chain is not verified', unsupported.supported === false);
  t('request labels distinguish native from ERC-20',
    labelRequestType({ native: true }) === 'native' && labelRequestType({ native: false }) === 'erc20');

  /* ---- cross-chain grouping ---------------------------------------------- */
  const rowsIn = [
    { symbol: 'ETH', amount: 1, value: 3000, chainId: 1, price: 3000 },
    { symbol: 'ETH', amount: 2, value: 6000, chainId: 42161, price: 3000 },
    { symbol: 'USDT', amount: 100, value: 100, chainId: 56, price: 1 },
    { symbol: 'SHIB', amount: 1e9, value: null, chainId: 56, price: null }
  ];
  const groups = groupHoldings(rowsIn);
  const eth = groups.find((g) => g.symbol === 'ETH');
  t('same-symbol rows merge across chains', eth && eth.chains === 2 && eth.items.length === 2);
  t('the merged amount is the sum', eth && Math.abs(eth.totalAmount - 3) < 1e-9);
  t('the merged value is the sum', eth && Math.abs(eth.value - 9000) < 1e-9);
  const shib = groups.find((g) => g.symbol === 'SHIB');
  t('a partially-priced group stays null, never a fake zero', shib && shib.value === null && shib.priced === 0);
  t('groups sort by value with unpriced last', groups[0].symbol === 'ETH' && groups[groups.length - 1].symbol === 'SHIB');

  /* ---- security score (real signals only) -------------------------------- */
  const none = securityScore({ biometricEnabled: false, twoFactorEnabled: false, autoLockMinutes: 0 });
  t('no signals → score null, not a confident low number', none.score === null && none.band === null);
  const good = securityScore({ biometricEnabled: true, twoFactorEnabled: true, autoLockMinutes: 5 });
  t('2FA + biometric + auto-lock score from real signals', good.score != null && good.score >= 70 && good.band === 'high');
  const partial = securityScore({ biometricEnabled: true, twoFactorEnabled: false, autoLockMinutes: 60 });
  t('a single signal still yields an honest score', partial.score != null && partial.score < 70);

  /* ---- approval revoke links --------------------------------------------- */
  t('BSC exposes the explorer approval checker',
    (approvalCheckerUrl(56, { 56: { explorer: 'https://bscscan.com' } }) || '').includes('tokenapprovalchecker'));
  t('a chain without the tool yields null',
    approvalCheckerUrl(146, { 146: { explorer: 'https://sonicscan.org' } }) === null);
  t('unknown chains yield null', approvalCheckerUrl(999, null) === null);

  return rows;
}
