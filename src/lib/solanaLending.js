/**
 * Solana lending client — Kamino KLend on Solana mainnet.
 *
 * Solana is not an EVM chain. It has no ERC-20 allowance, uint256 calldata,
 * EVM gas or Aave pool, so it intentionally lives outside src/lib/lending.js.
 * This module keeps the same boundary as the EVM client: reads come from the
 * protocol, transactions are built locally and the user's Solana wallet is the
 * only signer/broadcaster.
 */

import { Connection, PublicKey } from '@solana/web3.js';

export const SOLANA_LENDING_CHAIN_ID = 900001;
export const KAMINO_MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
export const KAMINO_LENDING_PROGRAM = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
export const SOLANA_LENDING_RPC = 'https://api.mainnet-beta.solana.com';
export const SOLANA_LENDING_EXPLORER = 'https://solscan.io';

const KAMINO_VENDOR_URL = `${import.meta.env?.BASE_URL || '/'}vendor/kamino-klend-sdk.js`;
const KAMINO_VENDOR_REV = '1';
let sdkModulePromise = null;

async function sdkPromise() {
  if (!sdkModulePromise) {
    sdkModulePromise = import(/* @vite-ignore */ `${KAMINO_VENDOR_URL}?v=${KAMINO_VENDOR_REV}`)
      .catch((cause) => {
        sdkModulePromise = null;
        const error = new Error('KAMINO_SDK_UNAVAILABLE');
        error.code = 'KAMINO_SDK_UNAVAILABLE';
        error.cause = cause;
        throw error;
      });
  }
  return sdkModulePromise;
}

const asNumber = (value, fallback = null) => {
  try {
    const n = typeof value?.toNumber === 'function' ? value.toNumber() : Number(value);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
};

const decimalToNumber = (value, decimals = 0) => {
  const n = asNumber(value);
  if (n == null) return null;
  return n / (10 ** Number(decimals));
};

/** Exact decimal-string → base units conversion. Floats are never signed. */
export function toSolanaUnits(value, decimals) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) return null;
  try { return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`); } catch { return null; }
}

export function fromSolanaUnits(value, decimals) {
  try {
    const raw = BigInt(value ?? 0).toString().padStart(Number(decimals) + 1, '0');
    const split = raw.length - Number(decimals);
    const whole = raw.slice(0, split);
    const fraction = raw.slice(split).replace(/0+$/, '');
    return fraction ? `${whole}.${fraction}` : whole;
  } catch { return '0'; }
}

const reserveToView = (reserve, slot) => {
  const stats = reserve?.stats || {};
  const decimals = asNumber(stats.decimals, 0);
  const mint = reserve?.getLiquidityMint?.()?.toBase58?.() || stats.mintAddress?.toBase58?.() || null;
  const supplyApy = asNumber(reserve.totalSupplyAPY?.(slot));
  const borrowApy = asNumber(reserve.totalBorrowAPY?.(slot));
  return {
    id: reserve.address?.toBase58?.() || mint || reserve.symbol,
    symbol: reserve.symbol || stats.symbol || 'TOKEN',
    name: reserve.symbol || stats.symbol || 'Solana asset',
    address: mint,
    chain: SOLANA_LENDING_CHAIN_ID,
    decimals,
    listed: true,
    status: String(stats.status || 'Active').toLowerCase(),
    supplyApyPct: supplyApy,
    borrowApyPct: borrowApy,
    loanToValuePct: asNumber(stats.loanToValue) == null ? null : asNumber(stats.loanToValue) * 100,
    liquidationThresholdPct: asNumber(stats.liquidationThreshold) == null ? null : asNumber(stats.liquidationThreshold) * 100,
    availableLiquidity: decimalToNumber(reserve.getLiquidityAvailableAmount?.(), decimals),
    borrowed: decimalToNumber(reserve.getBorrowedAmount?.(), decimals),
    supplyCap: decimalToNumber(stats.reserveDepositLimit, decimals),
    borrowCap: decimalToNumber(stats.reserveBorrowLimit, decimals),
    reserve
  };
};


/**
 * Read Kamino reserves and the wallet's vanilla obligation. The SDK does the
 * protocol/account decoding; this function only serializes values for React.
 */
export async function readSolanaLendingMarket({ wallet = null, rpcUrl = SOLANA_LENDING_RPC } = {}) {
  const { KaminoMarket, DEFAULT_RECENT_SLOT_DURATION_MS } = await sdkPromise();
  const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
  const market = await KaminoMarket.load(
    connection,
    new PublicKey(KAMINO_MAIN_MARKET),
    DEFAULT_RECENT_SLOT_DURATION_MS || 450,
    new PublicKey(KAMINO_LENDING_PROGRAM)
  );
  if (!market) return { ok: false, code: 'KAMINO_MARKET_UNAVAILABLE', dataStatus: 'unavailable' };

  const slot = await connection.getSlot('processed');
  const reserves = market.getReserves()
    .map((reserve) => reserveToView(reserve, slot))
    .filter((reserve) => reserve.status !== 'hidden' && reserve.status !== 'obsolete');

  let obligation = null;
  if (wallet) {
    try { obligation = await market.getUserVanillaObligation(new PublicKey(wallet)); } catch { obligation = null; }
  }

  const positions = {};
  for (const asset of reserves) {
    const reserve = asset.reserve;
    const deposit = obligation?.getDepositByReserve?.(reserve.address);
    const borrow = obligation?.getBorrowByReserve?.(reserve.address);
    const decimals = asset.decimals;
    positions[asset.id] = {
      supplied: deposit ? String(decimalToNumber(deposit.amount, decimals)) : '0',
      borrowed: borrow ? String(decimalToNumber(borrow.amount, decimals)) : '0',
      suppliedUsd: deposit ? asNumber(deposit.marketValueRefreshed) : 0,
      borrowedUsd: borrow ? asNumber(borrow.marketValueRefreshed) : 0,
      walletBalance: null
    };
  }

  const stats = obligation?.refreshedStats;
  const totalCollateralUsd = asNumber(stats?.userTotalDeposit, 0);
  const totalDebtUsd = asNumber(stats?.userTotalBorrow, 0);
  const borrowLimitUsd = asNumber(stats?.borrowLimit, 0);
  return {
    ok: true,
    chainId: SOLANA_LENDING_CHAIN_ID,
    protocol: 'kamino-klend',
    marketAddress: KAMINO_MAIN_MARKET,
    slot,
    readAt: new Date().toISOString(),
    dataStatus: 'live',
    assets: reserves.map(({ reserve: _reserve, ...view }) => view),
    reserves,
    positions,
    account: {
      ok: Boolean(obligation),
      totalCollateralUsd,
      totalDebtUsd,
      availableBorrowsUsd: Math.max(0, borrowLimitUsd - totalDebtUsd),
      healthFactor: totalDebtUsd > 0 && asNumber(stats?.borrowLiquidationLimit) != null
        ? asNumber(stats.borrowLiquidationLimit) / totalDebtUsd
        : null,
      ltvPct: totalCollateralUsd > 0 ? (totalDebtUsd / totalCollateralUsd) * 100 : 0,
      liquidationThresholdPct: totalCollateralUsd > 0 && asNumber(stats?.borrowLiquidationLimit) != null
        ? (asNumber(stats.borrowLiquidationLimit) / totalCollateralUsd) * 100
        : null
    },
    failures: []
  };
}

/** Build one or more unsigned Kamino transactions for the connected wallet. */
export async function buildSolanaLendingTransactions({ action, asset, amount, wallet, rpcUrl = SOLANA_LENDING_RPC } = {}) {
  if (!wallet) return { ok: false, code: 'SOLANA_WALLET_REQUIRED' };
  if (!asset?.address) return { ok: false, code: 'SOLANA_ASSET_REQUIRED' };
  const amountWei = toSolanaUnits(amount, Number(asset.decimals));
  if (amountWei == null || amountWei <= 0n) return { ok: false, code: 'AMOUNT_REQUIRED' };

  const [{ KaminoAction, KaminoMarket, VanillaObligation, PROGRAM_ID, DEFAULT_RECENT_SLOT_DURATION_MS }, { default: BN }] = await Promise.all([
    sdkPromise(),
    import('bn.js')
  ]);
  const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
  const market = await KaminoMarket.load(
    connection,
    new PublicKey(KAMINO_MAIN_MARKET),
    DEFAULT_RECENT_SLOT_DURATION_MS || 450,
    PROGRAM_ID
  );
  if (!market) return { ok: false, code: 'KAMINO_MARKET_UNAVAILABLE' };

  const owner = new PublicKey(wallet);
  const mint = new PublicKey(asset.address);
  let obligation = null;
  try { obligation = await market.getUserVanillaObligation(owner); } catch { obligation = null; }
  const obligationOrPda = obligation || new VanillaObligation(PROGRAM_ID);
  const slot = action === 'repay' ? await connection.getSlot('processed') : undefined;
  let built;
  if (action === 'supply') {
    built = await KaminoAction.buildDepositTxns(market, new BN(amountWei.toString()), mint, owner, obligationOrPda, 0, true, false, false);
  } else if (action === 'borrow') {
    if (!obligation) return { ok: false, code: 'SOLANA_COLLATERAL_REQUIRED' };
    built = await KaminoAction.buildBorrowTxns(market, new BN(amountWei.toString()), mint, owner, obligation, 0, true, false, false);
  } else if (action === 'withdraw') {
    if (!obligation) return { ok: false, code: 'SOLANA_POSITION_REQUIRED' };
    built = await KaminoAction.buildWithdrawTxns(market, new BN(amountWei.toString()), mint, owner, obligation, 0, true, false, false);
  } else if (action === 'repay') {
    if (!obligation) return { ok: false, code: 'SOLANA_POSITION_REQUIRED' };
    built = await KaminoAction.buildRepayTxns(market, new BN(amountWei.toString()), mint, owner, obligation, slot, undefined, 0, true, false, false);
  } else {
    return { ok: false, code: 'UNKNOWN_ACTION' };
  }

  const txs = await built.getTransactions();
  const encode = (tx) => tx ? Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64') : null;
  return {
    ok: true,
    action,
    amount: String(amount),
    amountWei: amountWei.toString(),
    transactions: [
      { id: 'preparing', transaction: encode(txs.preLendingTxn) },
      { id: action, transaction: encode(txs.lendingTxn) },
      { id: 'cleanup', transaction: encode(txs.postLendingTxn) }
    ].filter((entry) => entry.transaction),
    protocol: 'kamino-klend',
    chainId: SOLANA_LENDING_CHAIN_ID
  };
}

export async function getSolanaLendingTransactionStatus(signature, { rpcUrl = SOLANA_LENDING_RPC } = {}) {
  const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
  const result = await connection.getSignatureStatuses([signature]);
  const status = result?.value?.[0];
  if (!status) return { ok: false, code: 'TRANSACTION_NOT_FOUND' };
  if (status.err) return { ok: false, code: 'TRANSACTION_FAILED', error: status.err };
  return { ok: true, confirmed: Boolean(status.confirmationStatus), slot: status.slot };
}

/** Do not show a successful loan until the Solana cluster has acknowledged it. */
export async function waitForSolanaLendingTransaction(signature, { rpcUrl = SOLANA_LENDING_RPC, timeoutMs = 20_000 } = {}) {
  const connection = new Connection(rpcUrl, { commitment: 'confirmed' });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await connection.getSignatureStatuses([signature]);
    const status = result?.value?.[0];
    if (status?.err) return { ok: false, code: 'TRANSACTION_FAILED', error: status.err };
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return { ok: true, confirmed: true, slot: status.slot };
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return { ok: false, code: 'SOLANA_CONFIRMATION_TIMEOUT' };
}
