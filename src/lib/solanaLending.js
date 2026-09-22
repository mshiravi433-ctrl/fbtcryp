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

/**
 * Which node the lending reads go through.
 *
 * This used to be the hardcoded Foundation endpoint — `api.mainnet-beta.solana.com`
 * answers a busy browser with HTTP 429 and is frequently unreachable on
 * Iranian mobile networks, which is why the loan page's Solana panel sat on
 * «RPC سولانا یا بازار Kamino خوانده نشد» while the Solana swap screen on the
 * same phone worked. The app already owns a probed, multi-endpoint RPC layer
 * (src/lib/solanaRpc.js): the user's own RPC first, then the community nodes,
 * with the winner cached for the session. The lending path now uses it too.
 * An explicit `rpcUrl` still wins — tests and the panel may pin one.
 */
async function resolveLendingRpc(rpcUrl) {
  if (rpcUrl) return rpcUrl;
  try {
    const { getSolanaRpcUrl } = await import('./solanaRpc.js');
    return await getSolanaRpcUrl();
  } catch {
    return SOLANA_LENDING_RPC;
  }
}

/** Wrap a raw connection failure in the engine's named codes (§28). */
function solanaReadError(cause, code = 'RPC_ERROR') {
  const raw = String(cause?.message || cause || '');
  const finalCode = cause?.code || (/429|rate.?limit/i.test(raw) ? 'RPC_RATE_LIMITED'
    : (/fetch|network|failed to fetch|econn|timeout|timed out/i.test(raw) ? 'RPC_ERROR' : code));
  const error = new Error(finalCode);
  error.code = finalCode;
  error.detail = raw.slice(0, 160);
  return error;
}

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

/** Uint8Array → base64, in chunks so a long transaction never blows the stack. */
export function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK) {
    binary += String.fromCharCode(...arr.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The SPL Token program — the owner of every non-native Kamino reserve account. */
const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
/** Wrapped-SOL mint: the one reserve whose spendable balance is the native account. */
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

/**
 * The wallet's SPENDABLE balance per Kamino reserve, in base units.
 *
 * One getParsedTokenAccountsByOwner call answers every SPL mint at once
 * (grouped by mint here); wSOL takes its real balance from the native account
 * — that is the account a SOL deposit actually spends, so reading the ATA
 * alone would report «BALANCE_UNKNOWN» for users who hold plain SOL.
 *
 * A failed read returns `{}` — handled downstream as BALANCE_UNKNOWN, never
 * as zero (§37).
 */
export async function readSolanaLendingBalances({ wallet, assets = [], rpcUrl = null } = {}) {
  if (!wallet) return {};
  const url = await resolveLendingRpc(rpcUrl);
  const connection = new Connection(url, { commitment: 'confirmed' });
  const balances = {};
  const byMint = new Map(assets.filter((a) => a?.address).map((a) => [String(a.address), a]));
  let nativeLamports = null;
  if (byMint.has(WSOL_MINT)) {
    try { nativeLamports = BigInt(await connection.getBalance(new PublicKey(wallet))); } catch { nativeLamports = null; }
  }
  try {
    const response = await connection.getParsedTokenAccountsByOwner(
      new PublicKey(wallet),
      { programId: new PublicKey(SPL_TOKEN_PROGRAM_ID) }
    );
    for (const entry of response?.value ?? []) {
      const info = entry?.account?.data?.parsed?.info;
      const mint = String(info?.mint || '');
      const asset = byMint.get(mint);
      if (!asset) continue;
      const raw = info?.tokenAmount?.amount;
      if (raw == null) continue;
      const current = balances[asset.id] ? BigInt(balances[asset.id]) : 0n;
      balances[asset.id] = (current + BigInt(raw)).toString();
    }
  } catch {
    /* The fall-through state is `{}` — read failure, reported not faked. */
  }
  if (nativeLamports != null && byMint.has(WSOL_MINT)) {
    const asset = byMint.get(WSOL_MINT);
    const wrapped = balances[asset.id] ? BigInt(balances[asset.id]) : 0n;
    /* Native + wrapped: both are spendable for a SOL deposit. Native wins the
       MAX amount display either way because Kamino unwraps. */
    balances[asset.id] = (wrapped + nativeLamports).toString();
  }
  return balances;
}

/**
 * §7/§9 — PREFLIGHT before the wallet is ever shown a transaction.
 *
 * Pure over an already-read market snapshot: the answer decides whether the
 * panel blocks the tap with a named reason instead of letting the wallet
 * pop up for a transaction the chain would refuse anyway.
 *
 * @returns {{ok:boolean, code:string|null, reason:string|null, amountWei:string|null}}
 */
export function preflightSolanaAction({ action, asset, amount, snapshot } = {}) {
  const finish = (ok, code = null, amountWei = null) => ({ ok, code, reason: code, amountWei });
  if (!asset) return finish(false, 'SOLANA_ASSET_REQUIRED');
  const decimals = Number(asset.decimals ?? 0);
  const amountWei = toSolanaUnits(amount, decimals);
  if (amountWei == null || amountWei <= 0n) return finish(false, 'AMOUNT_REQUIRED');
  const amountWeiString = amountWei.toString();

  const balances = snapshot?.balances || {};
  const walletWei = balances[asset.id] != null ? BigInt(balances[asset.id]) : null;
  const position = snapshot?.positions?.[asset.id] || null;
  /** Display-unit strings of the CDC position, converted to base units. */
  const suppliedWei = position?.supplied != null ? toSolanaUnits(position.supplied, decimals) : null;
  const borrowedWei = position?.borrowed != null ? toSolanaUnits(position.borrowed, decimals) : null;

  if (action === 'supply') {
    if (walletWei == null) {
      /* Unknown is not zero: block the popup rather than burn the user's
         network fee on a transaction the chain will refuse. The retry button
         re-reads the balance. */
      return finish(false, 'BALANCE_UNKNOWN', amountWeiString);
    }
    if (amountWei > walletWei) return finish(false, 'INSUFFICIENT_BALANCE', amountWeiString);
    return finish(true, null, amountWeiString);
  }
  if (action === 'withdraw') {
    if (suppliedWei == null || suppliedWei <= 0n) return finish(false, 'SOLANA_POSITION_REQUIRED', amountWeiString);
    if (amountWei > suppliedWei) return finish(false, 'INSUFFICIENT_BALANCE', amountWeiString);
    return finish(true, null, amountWeiString);
  }
  if (action === 'repay') {
    if (borrowedWei == null || borrowedWei <= 0n) return finish(false, 'SOLANA_POSITION_REQUIRED', amountWeiString);
    if (amountWei > borrowedWei) return finish(false, 'EXCEEDS_DEBT', amountWeiString);
    if (walletWei == null) return finish(false, 'BALANCE_UNKNOWN', amountWeiString);
    if (amountWei > walletWei) return finish(false, 'INSUFFICIENT_BALANCE', amountWeiString);
    return finish(true, null, amountWeiString);
  }
  if (action === 'borrow') {
    /* Borrowing power is tracked server-side by Kamino's own obligation
       refresh — when available, check the human-typed amount against it
       before the popup; the SDK build remains the final arbiter. */
    const availableUsd = Number(snapshot?.account?.availableBorrowsUsd);
    const priceUsd = Number(asset.priceUsd);
    if (Number.isFinite(availableUsd) && Number.isFinite(priceUsd) && priceUsd > 0) {
      const amountUsd = Number(amount) * priceUsd;
      if (Number.isFinite(amountUsd) && amountUsd > availableUsd && availableUsd >= 0) {
        return finish(false, 'BORROW_LIMIT_EXCEEDED', amountWeiString);
      }
      if (availableUsd <= 0 && amountUsd > 0) return finish(false, 'BORROW_LIMIT_EXCEEDED', amountWeiString);
    }
    return finish(true, null, amountWeiString);
  }
  return finish(false, 'UNKNOWN_ACTION');
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
    /* Kamino's own oracle-derived price (USD), when the reserve summary
       carries it. Used ONLY to compare a typed borrow amount against the
       wallet's USD borrow limit before a wallet popup — never displayed as a
       market price, never a risk input elsewhere. */
    priceUsd: asNumber(stats.priceUSD),
    reserve
  };
};


/**
 * Read Kamino reserves and the wallet's vanilla obligation. The SDK does the
 * protocol/account decoding; this function only serializes values for React.
 * The node it reads from is the app's probed RPC layer by default — not the
 * Foundation's most-throttled endpoint (see `resolveLendingRpc`).
 *
 * @returns the market snapshot. A failure is THROWN as a coded error
 *   (KAMINO_SDK_UNAVAILABLE / KAMINO_MARKET_UNAVAILABLE / RPC_ERROR /
 *   RPC_RATE_LIMITED) so the panel can explain WHICH thing is down instead of
 *   collapsing every cause into one sentence (§28).
 */
export async function readSolanaLendingMarket({ wallet = null, rpcUrl = null } = {}) {
  const url = await resolveLendingRpc(rpcUrl);
  const { KaminoMarket, DEFAULT_RECENT_SLOT_DURATION_MS } = await sdkPromise();
  const connection = new Connection(url, { commitment: 'confirmed' });
  let market = null;
  try {
    market = await KaminoMarket.load(
      connection,
      new PublicKey(KAMINO_MAIN_MARKET),
      DEFAULT_RECENT_SLOT_DURATION_MS || 450,
      new PublicKey(KAMINO_LENDING_PROGRAM)
    );
  } catch (cause) {
    throw solanaReadError(cause, 'KAMINO_MARKET_UNAVAILABLE');
  }
  if (!market) {
    const error = new Error('KAMINO_MARKET_UNAVAILABLE');
    error.code = 'KAMINO_MARKET_UNAVAILABLE';
    error.rpcUrl = url;
    throw error;
  }

  let slot = null;
  try { slot = await connection.getSlot('processed'); } catch { slot = null; }
  const reserves = market.getReserves()
    .map((reserve) => reserveToView(reserve, slot))
    .filter((reserve) => reserve.status !== 'hidden' && reserve.status !== 'obsolete');

  let obligation = null;
  if (wallet) {
    try { obligation = await market.getUserVanillaObligation(new PublicKey(wallet)); } catch { obligation = null; }
  }

  /* The wallet's spendable balance per reserve (§7 preflight input). A failed
     read stays empty — the panel reports BALANCE_UNKNOWN and refuses to open
     the wallet for a transaction it cannot pre-check. */
  let balances = {};
  if (wallet) {
    try {
      balances = await readSolanaLendingBalances({ wallet, assets: reserves, rpcUrl: url });
    } catch { balances = {}; }
  }

  const positions = {};
  for (const asset of reserves) {
    const reserve = asset.reserve;
    const deposit = obligation?.getDepositByReserve?.(reserve.address);
    const borrow = obligation?.getBorrowByReserve?.(reserve.address);
    const decimals = asset.decimals;
    const walletWei = balances[asset.id];
    positions[asset.id] = {
      supplied: deposit ? String(decimalToNumber(deposit.amount, decimals)) : '0',
      borrowed: borrow ? String(decimalToNumber(borrow.amount, decimals)) : '0',
      suppliedUsd: deposit ? asNumber(deposit.marketValueRefreshed) : 0,
      borrowedUsd: borrow ? asNumber(borrow.marketValueRefreshed) : 0,
      walletBalance: walletWei != null ? fromSolanaUnits(walletWei, decimals) : null
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
    rpcUrl: url,
    slot,
    readAt: new Date().toISOString(),
    dataStatus: 'live',
    assets: reserves.map(({ reserve: _reserve, ...view }) => view),
    reserves,
    positions,
    balances,
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
export async function buildSolanaLendingTransactions({ action, asset, amount, wallet, rpcUrl = null } = {}) {
  if (!wallet) return { ok: false, code: 'SOLANA_WALLET_REQUIRED' };
  if (!asset?.address) return { ok: false, code: 'SOLANA_ASSET_REQUIRED' };
  const amountWei = toSolanaUnits(amount, Number(asset.decimals));
  if (amountWei == null || amountWei <= 0n) return { ok: false, code: 'AMOUNT_REQUIRED' };

  const url = await resolveLendingRpc(rpcUrl);
  const [{ KaminoAction, KaminoMarket, VanillaObligation, PROGRAM_ID, DEFAULT_RECENT_SLOT_DURATION_MS }, { default: BN }] = await Promise.all([
    sdkPromise(),
    import('bn.js')
  ]);
  const connection = new Connection(url, { commitment: 'confirmed' });
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
  /* `Buffer.from(...)` was a Node-ism: the browser has no Buffer global (it is
     only polyfilled lazily by the dYdX path, which a lending-only user never
     opens), so every transaction build threw ReferenceError before a wallet
     was ever asked — «Solana deposit does not work» in production. */
  const encode = (tx) => tx ? bytesToBase64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })) : null;
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

export async function getSolanaLendingTransactionStatus(signature, { rpcUrl = null } = {}) {
  const url = await resolveLendingRpc(rpcUrl);
  const connection = new Connection(url, { commitment: 'confirmed' });
  const result = await connection.getSignatureStatuses([signature]);
  const status = result?.value?.[0];
  if (!status) return { ok: false, code: 'TRANSACTION_NOT_FOUND' };
  if (status.err) return { ok: false, code: 'TRANSACTION_FAILED', error: status.err };
  return { ok: true, confirmed: Boolean(status.confirmationStatus), slot: status.slot };
}

/** Do not show a successful loan until the Solana cluster has acknowledged it. */
export async function waitForSolanaLendingTransaction(signature, { rpcUrl = null, timeoutMs = 20_000 } = {}) {
  const url = await resolveLendingRpc(rpcUrl);
  const connection = new Connection(url, { commitment: 'confirmed' });
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
