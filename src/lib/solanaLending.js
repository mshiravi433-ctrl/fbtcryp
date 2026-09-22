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

/**
 * Every node a lending read may try, in order: the caller's pinned URL wins,
 * otherwise the user's own RPC first and then the public list — the SAME
 * order the swap screen probes, so the two can never disagree about which
 * node is usable.
 *
 * 2026-09-22: reads used to take ONE URL (`getSolanaRpcUrl()`, which returns
 * the Foundation endpoint even when its own probe just proved every candidate
 * dead) and a single 429 / blocked host turned the whole Solana panel into
 * «market unavailable» + BALANCE_UNKNOWN. Every read below now walks this
 * list until one node answers.
 */
async function lendingRpcCandidates(rpcUrl) {
  if (rpcUrl) return [rpcUrl];
  try {
    const { solanaRpcCandidates, readSolanaNetworkSettings } = await import('./solanaRpc.js');
    const settings = await readSolanaNetworkSettings();
    const list = solanaRpcCandidates(settings).filter(Boolean);
    return list.length ? [...new Set(list)] : [SOLANA_LENDING_RPC];
  } catch {
    return [SOLANA_LENDING_RPC];
  }
}

const shortHost = (url) => {
  try { return new URL(url).hostname; } catch { return String(url || '?').slice(0, 40); }
};

/**
 * Name a total failover failure. A 429 anywhere means throttling (retryable);
 * all-unreachable means the network path is down (retryable); anything else —
 * e.g. every node answered but the market account would not decode — stays
 * KAMINO_MARKET_UNAVAILABLE. The per-host summary is kept as detail (§28).
 */
function lendingRpcFailure(attempts) {
  const summary = (attempts || [])
    .map((a) => `${shortHost(a.url)}:${a.code || a.error || 'failed'}`)
    .join(' | ')
    .slice(0, 180);
  const haystack = (attempts || []).map((a) => `${a.code || ''} ${a.error || ''}`).join(' ');
  const anyRateLimited = /429|rate.?limit/i.test(haystack);
  const allUnreachable = (attempts || []).length > 0
    && (attempts || []).every((a) => /fetch|network|failed to fetch|econn|timeout|timed out|unreachable|abort/i.test(`${a.code || ''} ${a.error || ''}`));
  const code = anyRateLimited ? 'RPC_RATE_LIMITED' : allUnreachable ? 'RPC_ERROR' : 'KAMINO_MARKET_UNAVAILABLE';
  const error = new Error(code);
  error.code = code;
  error.detail = summary || 'all Solana RPC candidates failed';
  error.attempts = attempts || [];
  return error;
}

async function resetRememberedSolanaRpc() {
  try {
    const { resetSolanaRpcChoice } = await import('./solanaRpc.js');
    resetSolanaRpcChoice();
  } catch { /* the reset is hygiene, never load-bearing */ }
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

const KAMINO_VENDOR_PATH = 'vendor/kamino-klend-sdk.js';
/* Bumped 2026-09-22: the query is the only cache-buster on this file, and a
   stuck (stale 404 or half-cached) copy is indistinguishable from a broken
   build at runtime. Any vendor-bundle change bumps this again. */
const KAMINO_VENDOR_REV = '2';

/**
 * Where the vendored Kamino bundle may live, in order. The build always emits
 * it to `<BASE_URL>/vendor/…`, but the page can be served under a different
 * base than the build assumed (CDN rewrites, the native shell, a cached
 * index.html from a previous deploy) — a single hardcoded URL turns any of
 * those into KAMINO_SDK_UNAVAILABLE. Each candidate is tried in turn.
 */
function kaminoVendorCandidates() {
  const rawBase = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
  const base = String(rawBase || '/');
  const withSlash = base.endsWith('/') ? base : `${base}/`;
  const urls = [`${withSlash}${KAMINO_VENDOR_PATH}?v=${KAMINO_VENDOR_REV}`];
  if (withSlash !== '/') urls.push(`/${KAMINO_VENDOR_PATH}?v=${KAMINO_VENDOR_REV}`);
  return [...new Set(urls)];
}

/**
 * Is the bundle file itself reachable? A dynamic `import()` failure does not
 * say whether the file 404ed (the build never vendored it) or downloaded and
 * crashed during init (a broken bundle) — and the two have different fixes.
 * A plain fetch answers that: 404/empty → MISSING, reachable-but-unimportable
 * → FAILED with the original message kept as detail.
 */
async function probeKaminoVendor(url) {
  try {
    if (typeof fetch !== 'function') return null;
    const res = await fetch(url.split('?')[0], { method: 'GET', headers: { accept: '*/*' } });
    if (!res?.ok) return { reachable: false, status: Number(res?.status ?? 0) };
    const text = await res.text();
    return { reachable: (text?.length || 0) > 1024, status: 200, bytes: text?.length || 0 };
  } catch {
    return null;
  }
}

function kaminoLoadError(code, cause, detail) {
  const error = new Error(code);
  error.code = code;
  error.cause = cause || null;
  if (detail) error.detail = String(detail).slice(0, 200);
  else if (cause) error.detail = String(cause?.message || cause).slice(0, 200);
  return error;
}

let sdkModulePromise = null;

async function sdkPromise() {
  if (!sdkModulePromise) {
    sdkModulePromise = (async () => {
      const candidates = kaminoVendorCandidates();
      let lastCause = null;
      for (const url of candidates) {
        try {
          const mod = await import(/* @vite-ignore */ url);
          /* A stale or truncated bundle can import "successfully" with the
             panel's exports missing — that must fail here with a name, not
             pages later as `KaminoMarket.load is not a function`. */
          const missing = ['KaminoMarket', 'KaminoAction', 'VanillaObligation']
            .filter((name) => typeof mod?.[name] !== 'function');
          if (missing.length || String(mod?.PROGRAM_ID || '').length < 32) {
            throw new Error(`incomplete bundle (missing: ${[...missing, ...(String(mod?.PROGRAM_ID || '').length < 32 ? ['PROGRAM_ID'] : [])].join(', ')})`);
          }
          return mod;
        } catch (cause) {
          lastCause = cause;
        }
      }
      /* Every candidate failed. Probe the primary URL once so the panel can
         tell "the file is not in this build" from "the file is broken". */
      const primary = candidates[0];
      const probe = await probeKaminoVendor(primary);
      if (probe && probe.reachable === false) {
        throw kaminoLoadError(
          'KAMINO_SDK_MISSING', lastCause,
          `HTTP ${probe.status || 'fetch-failed'} for ${primary.split('?')[0]} — the vendor bundle is not in this build`
        );
      }
      if (probe && probe.reachable === true) {
        throw kaminoLoadError('KAMINO_SDK_FAILED', lastCause);
      }
      throw kaminoLoadError('KAMINO_SDK_UNAVAILABLE', lastCause);
    })().catch((error) => {
      /* A failed load must never poison later retries: the panel's retry
         button (and the next mount) re-runs the whole candidate list. */
      sdkModulePromise = null;
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
 *
 * 2026-09-22: the two reads (native balance, parsed token accounts) each walk
 * the RPC candidate list until one node answers. A success — even an EMPTY
 * token-account list, which is a real answer for a fresh wallet — stops its
 * own walk; only a THROWN call moves to the next node.
 */
export async function readSolanaLendingBalances({ wallet, assets = [], rpcUrl = null } = {}) {
  if (!wallet) return {};
  const candidates = await lendingRpcCandidates(rpcUrl);
  const balances = {};
  const byMint = new Map(assets.filter((a) => a?.address).map((a) => [String(a.address), a]));
  const wantNative = byMint.has(WSOL_MINT);
  let nativeLamports = null;
  let nativeDone = !wantNative;
  let tokenDone = false;

  const fillTokenAccounts = (response) => {
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
  };

  for (const url of candidates) {
    if (nativeDone && tokenDone) break;
    const connection = new Connection(url, { commitment: 'confirmed' });
    if (!nativeDone) {
      try {
        nativeLamports = BigInt(await connection.getBalance(new PublicKey(wallet)));
        nativeDone = true;
      } catch { nativeLamports = null; }
    }
    if (!tokenDone) {
      try {
        const response = await connection.getParsedTokenAccountsByOwner(
          new PublicKey(wallet),
          { programId: new PublicKey(SPL_TOKEN_PROGRAM_ID) }
        );
        fillTokenAccounts(response);
        tokenDone = true;
      } catch {
        /* Next candidate; the fall-through state stays `{}` — failure is
           reported downstream as BALANCE_UNKNOWN, never faked as zero. */
      }
    }
  }
  if (!nativeDone || !tokenDone) await resetRememberedSolanaRpc();
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

/**
 * Call one SDK/reserve accessor and swallow its throw: a single method that
 * reverts or throws reads as `null` — the same shape an absent field already
 * produces — instead of taking the whole market read down with it. (§28: a
 * partial read is labelled, it never becomes a fatal one.)
 */
const safeCall = (fn) => {
  try { return typeof fn === 'function' ? fn() : null; } catch { return null; }
};

const reserveToView = (reserve, slot) => {
  const stats = reserve?.stats || {};
  const decimals = asNumber(stats.decimals, 0);
  const address58 = safeCall(() => reserve.address?.toBase58?.());
  const mint = safeCall(() => reserve?.getLiquidityMint?.())?.toBase58?.() || stats.mintAddress?.toBase58?.() || null;
  const supplyApy = asNumber(safeCall(() => reserve.totalSupplyAPY?.(slot)));
  const borrowApy = asNumber(safeCall(() => reserve.totalBorrowAPY?.(slot)));
  return {
    id: address58 || mint || reserve.symbol,
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
    availableLiquidity: decimalToNumber(safeCall(() => reserve.getLiquidityAvailableAmount?.()), decimals),
    borrowed: decimalToNumber(safeCall(() => reserve.getBorrowedAmount?.()), decimals),
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
  const candidates = await lendingRpcCandidates(rpcUrl);
  const { KaminoMarket, DEFAULT_RECENT_SLOT_DURATION_MS } = await sdkPromise();
  const attempts = [];
  let market = null;
  let url = candidates[0];
  let slot = null;
  /* The market load is the expensive call (dozens of accounts), so the walk
     stops at the first node that answers it — later reads reuse the winner. */
  for (const candidate of candidates) {
    const connection = new Connection(candidate, { commitment: 'confirmed' });
    try {
      market = await KaminoMarket.load(
        connection,
        new PublicKey(KAMINO_MAIN_MARKET),
        DEFAULT_RECENT_SLOT_DURATION_MS || 450,
        new PublicKey(KAMINO_LENDING_PROGRAM)
      );
    } catch (cause) {
      attempts.push({ url: candidate, code: cause?.code || null, error: String(cause?.message || cause || '').slice(0, 120) });
      market = null;
      continue;
    }
    if (!market) {
      attempts.push({ url: candidate, error: 'empty market' });
      continue;
    }
    url = candidate;
    try { slot = await connection.getSlot('processed'); } catch { slot = null; }
    break;
  }
  if (!market) {
    await resetRememberedSolanaRpc();
    throw lendingRpcFailure(attempts);
  }

  /* The reserve LIST itself failing is a market failure — the SDK decoded
     the market but its reserve accessor threw — so it is thrown as a coded
     error, never as an empty market pretending to be healthy. */
  let rawReserves = [];
  try {
    rawReserves = market.getReserves();
  } catch (cause) {
    throw solanaReadError(cause, 'KAMINO_MARKET_UNAVAILABLE');
  }

  /* ONE corrupted/throwing reserve must not kill the whole market (the
     EVM engine already works this way): each reserve is converted inside its
     own try/catch — a failure is SKIPPED and named in `failures` so the panel
     can say a market is PARTIALLY read rather than down. */
  const reserves = [];
  const reserveFailures = [];
  for (const reserve of Array.isArray(rawReserves) ? rawReserves : []) {
    try {
      const view = reserveToView(reserve, slot);
      if (view.status !== 'hidden' && view.status !== 'obsolete') reserves.push(view);
    } catch (cause) {
      reserveFailures.push({
        reserve: safeCall(() => reserve?.address?.toBase58?.()) || reserve?.symbol || 'unknown',
        error: String(cause?.message || cause || '').slice(0, 120)
      });
    }
  }

  /* A failed obligation read is NOT "no position": it is unknown, and the
     panel must say so instead of showing an empty position with $0s. */
  let obligation = null;
  let obligationUnknown = false;
  if (wallet) {
    try {
      obligation = await market.getUserVanillaObligation(new PublicKey(wallet));
    } catch {
      obligation = null;
      obligationUnknown = true;
    }
  }

  /* The wallet's spendable balance per reserve (§7 preflight input), with its
     own failover across every candidate — NOT pinned to the market winner, so
     a node that serves the market but throttles parsed-account reads cannot
     single-handedly force BALANCE_UNKNOWN. A failed read stays empty — the
     panel reports BALANCE_UNKNOWN and refuses to open the wallet for a
     transaction it cannot pre-check. */
  let balances = {};
  let balancesUnknown = false;
  if (wallet) {
    try {
      balances = await readSolanaLendingBalances({ wallet, assets: reserves });
      balancesUnknown = Object.keys(balances || {}).length === 0;
    } catch { balances = {}; balancesUnknown = true; }
  }

  const positions = {};
  for (const asset of reserves) {
    const reserve = asset.reserve;
    /* A throwing obligation accessor reads as "no position here", not as a
       failed market read — the obligation read itself already reports
       `unknown` separately when it fails wholesale. */
    const deposit = safeCall(() => obligation?.getDepositByReserve?.(reserve.address));
    const borrow = safeCall(() => obligation?.getBorrowByReserve?.(reserve.address));
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
      /* When the obligation could not be read, every figure below is a
         placeholder zero — the panel renders '—' and a retry, not $0.00. */
      unknown: obligationUnknown,
      balancesUnknown,
      totalCollateralUsd,
      totalDebtUsd,
      availableBorrowsUsd: obligationUnknown ? null : Math.max(0, borrowLimitUsd - totalDebtUsd),
      healthFactor: totalDebtUsd > 0 && asNumber(stats?.borrowLiquidationLimit) != null
        ? asNumber(stats.borrowLiquidationLimit) / totalDebtUsd
        : null,
      ltvPct: totalCollateralUsd > 0 ? (totalDebtUsd / totalCollateralUsd) * 100 : 0,
      liquidationThresholdPct: totalCollateralUsd > 0 && asNumber(stats?.borrowLiquidationLimit) != null
        ? (asNumber(stats.borrowLiquidationLimit) / totalCollateralUsd) * 100
        : null
    },
    /* Reserves that could not be read at all — named, so a PARTIAL market
       read is visible as one (§28) instead of silently shrinking the list. */
    failures: reserveFailures
  };
}

/** Build one or more unsigned Kamino transactions for the connected wallet. */
export async function buildSolanaLendingTransactions({ action, asset, amount, wallet, rpcUrl = null } = {}) {
  if (!wallet) return { ok: false, code: 'SOLANA_WALLET_REQUIRED' };
  if (!asset?.address) return { ok: false, code: 'SOLANA_ASSET_REQUIRED' };
  const amountWei = toSolanaUnits(amount, Number(asset.decimals));
  if (amountWei == null || amountWei <= 0n) return { ok: false, code: 'AMOUNT_REQUIRED' };

  const candidates = await lendingRpcCandidates(rpcUrl);
  const [{ KaminoAction, KaminoMarket, VanillaObligation, PROGRAM_ID, DEFAULT_RECENT_SLOT_DURATION_MS }, { default: BN }] = await Promise.all([
    sdkPromise(),
    import('bn.js')
  ]);
  const owner = new PublicKey(wallet);
  const mint = new PublicKey(asset.address);

  /* The whole build is unsigned, so retrying it on the next node is safe: no
     signature exists yet to duplicate. A node that 429s mid-build must not be
     the reason a valid action dies. */
  const attempts = [];
  let txs = null;
  let builtUrl = null;
  for (const url of candidates) {
    const connection = new Connection(url, { commitment: 'confirmed' });
    try {
      const market = await KaminoMarket.load(
        connection,
        new PublicKey(KAMINO_MAIN_MARKET),
        DEFAULT_RECENT_SLOT_DURATION_MS || 450,
        PROGRAM_ID
      );
      if (!market) throw new Error('KAMINO_MARKET_UNAVAILABLE');

      let obligation = null;
      let obligationFailed = false;
      try {
        obligation = await market.getUserVanillaObligation(owner);
      } catch {
        obligation = null;
        obligationFailed = true;
      }
      /* An obligation READ failure is a network failure, not "no position":
         answering borrow with SOLANA_COLLATERAL_REQUIRED here would send a
         user with real collateral to deposit more of it. */
      if (!obligation && obligationFailed && action !== 'supply') {
        throw new Error('RPC_ERROR');
      }
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

      txs = await built.getTransactions();
      builtUrl = url;
      break;
    } catch (cause) {
      attempts.push({ url, code: cause?.code || null, error: String(cause?.message || cause || '').slice(0, 120) });
    }
  }
  if (!txs) {
    await resetRememberedSolanaRpc();
    const failure = lendingRpcFailure(attempts);
    return { ok: false, code: failure.code === 'KAMINO_MARKET_UNAVAILABLE' ? 'KAMINO_MARKET_UNAVAILABLE' : failure.code, detail: failure.detail };
  }
  void builtUrl;
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
  const candidates = await lendingRpcCandidates(rpcUrl);
  const attempts = [];
  for (const url of candidates) {
    try {
      const connection = new Connection(url, { commitment: 'confirmed' });
      const result = await connection.getSignatureStatuses([signature]);
      const status = result?.value?.[0];
      if (!status) return { ok: false, code: 'TRANSACTION_NOT_FOUND' };
      if (status.err) return { ok: false, code: 'TRANSACTION_FAILED', error: status.err };
      return { ok: true, confirmed: Boolean(status.confirmationStatus), slot: status.slot };
    } catch (cause) {
      attempts.push({ url, code: cause?.code || null, error: String(cause?.message || cause || '').slice(0, 120) });
    }
  }
  /* Every node refused the question — that is a network failure, NOT "this
     transaction does not exist". */
  const failure = lendingRpcFailure(attempts);
  return { ok: false, code: failure.code === 'KAMINO_MARKET_UNAVAILABLE' ? 'RPC_ERROR' : failure.code, detail: failure.detail };
}

/**
 * Do not show a successful loan until the Solana cluster has acknowledged it.
 *
 * 2026-09-22: a poll that THROWS (a node going down mid-confirmation) used to
 * reject the whole wait — the user's transaction was fine, but the panel
 * reported a failure. Poll errors now rotate to the next candidate and keep
 * waiting until the deadline; only the deadline itself is a timeout.
 */
export async function waitForSolanaLendingTransaction(signature, { rpcUrl = null, timeoutMs = 20_000 } = {}) {
  const candidates = await lendingRpcCandidates(rpcUrl);
  let index = 0;
  let connection = new Connection(candidates[index], { commitment: 'confirmed' });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let result = null;
    try {
      result = await connection.getSignatureStatuses([signature]);
    } catch {
      /* Rotate to the next node and keep waiting — the transaction may be
         confirming fine while this one node is down. */
      index = (index + 1) % candidates.length;
      connection = new Connection(candidates[index], { commitment: 'confirmed' });
      await new Promise((resolve) => setTimeout(resolve, 700));
      continue;
    }
    const status = result?.value?.[0];
    if (status?.err) return { ok: false, code: 'TRANSACTION_FAILED', error: status.err };
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
      return { ok: true, confirmed: true, slot: status.slot };
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return { ok: false, code: 'SOLANA_CONFIRMATION_TIMEOUT' };
}
