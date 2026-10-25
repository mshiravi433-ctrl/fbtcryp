/**
 * CoW Protocol limit orders — the EVM half of "Phase 2: automatic execution".
 *
 * ─── WHAT THIS MODULE IS, AND WHAT IT IS NOT ───────────────────────────────
 * A CoW limit order is a SIGNED INTENT, not a transaction. The user signs an
 * EIP-712 `Order` in their own wallet; the CoW solver network then competes to
 * settle it on-chain at a price no worse than the limit. Nothing here holds a
 * key, a seed or a mnemonic, and nothing here can move funds: the only
 * on-chain write this module can ever make is an ERC-20 `approve` of the
 * VaultRelayer for the exact `sellAmount` (never MaxUint256).
 *
 * This file is PURE on purpose, so the parts that decide money — the BigInt
 * `buyAmount` math, the typed-data shape, the allowance rule — can be unit
 * tested without a wallet, a network or a bundler. The server re-checks the
 * same signature (server/cowOrders.js) so a hand-built request cannot relay an
 * order the user never signed.
 *
 * Ethers is imported lazily, only where a hash or an on-chain call is needed.
 */
import { PAYOUT_ADDRESSES } from './payout.js';

/* -------------------------------------------------------------------------- */
/* constants                                                                   */
/* -------------------------------------------------------------------------- */

/** The six EVM networks the CoW order book serves in production. */
export const COW_CHAINS = Object.freeze({
  1: Object.freeze({ id: 1, name: 'Ethereum', slug: 'mainnet', explorer: '' }),
  42161: Object.freeze({ id: 42161, name: 'Arbitrum One', slug: 'arbitrum_one', explorer: 'arb1' }),
  8453: Object.freeze({ id: 8453, name: 'Base', slug: 'base', explorer: 'base' }),
  137: Object.freeze({ id: 137, name: 'Polygon', slug: 'polygon', explorer: 'pol' }),
  56: Object.freeze({ id: 56, name: 'BNB Chain', slug: 'bnb', explorer: 'bnb' }),
  43114: Object.freeze({ id: 43114, name: 'Avalanche', slug: 'avalanche', explorer: 'avax' })
});

export const COW_CHAIN_IDS = Object.freeze(Object.keys(COW_CHAINS).map(Number));

/**
 * The contract a seller must approve before a CoW order can settle. Quotes
 * need no allowance; placement without one is rejected with
 * `InsufficientAllowance` by the order book.
 */
export const COW_VAULT_RELAYER = '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110';

/** GPv2Settlement — the verifying contract in the EIP-712 domain. */
export const COW_SETTLEMENT = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41';

export const COW_DOMAIN_NAME = 'Gnosis Protocol';
export const COW_DOMAIN_VERSION = 'v2';

/** Platform fee in basis points, carried in appData as a partner fee. */
export const PLATFORM_FEE_BPS = 70;

/** Identifies our app in appData. Stable: changing it changes every app hash. */
export const COW_APP_CODE = 'FBTCryp';

/** appData schema version that understands `partnerFee: {volumeBps, recipient}`. */
export const COW_APPDATA_VERSION = '1.1.0';

export const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Wrapped native tokens. A native sell (ETH, BNB, POL, AVAX) cannot be sold
 * by a CoW order directly, so it is wrapped first and the wrapped token is
 * sold. The user sees that step and confirms it.
 */
export const COW_WRAPPED_NATIVE = Object.freeze({
  1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
  8453: '0x4200000000000000000000000000000000000006', // WETH
  137: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WPOL (wrapped POL)
  56: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
  43114: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' // WAVAX
});

/** The GPv2Order typed-data shape. `kind` and the balance fields are strings, as in the protocol's own SDK. */
export const COW_ORDER_TYPES = Object.freeze({
  Order: Object.freeze([
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken', type: 'address' },
    { name: 'receiver', type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'buyAmount', type: 'uint256' },
    { name: 'validTo', type: 'uint32' },
    { name: 'appData', type: 'bytes32' },
    { name: 'feeAmount', type: 'uint256' },
    { name: 'kind', type: 'string' },
    { name: 'partiallyFillable', type: 'bool' },
    { name: 'sellTokenBalance', type: 'string' },
    { name: 'buyTokenBalance', type: 'string' }
  ])
});

/** Cancellation is a signed list of order UIDs, not a transaction. */
export const COW_CANCEL_TYPES = Object.freeze({
  OrderCancellations: Object.freeze([{ name: 'orderUids', type: 'bytes[]' }])
});

/* -------------------------------------------------------------------------- */
/* identifiers and links                                                       */
/* -------------------------------------------------------------------------- */

export function cowSupports(chainId) {
  return Object.prototype.hasOwnProperty.call(COW_CHAINS, Number(chainId));
}

/** Order UID = 0x + 56 bytes (orderDigest ‖ owner ‖ validTo) = 112 hex characters. */
export function isCowUid(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{112}$/.test(value);
}

export function isEvmAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

export function cowOrderApiBase(chainId) {
  const meta = COW_CHAINS[Number(chainId)];
  if (!meta) return null;
  return `https://api.cow.fi/${meta.slug}/api/v1`;
}

/**
 * Link to the order on CoW Explorer. The per-network path segment is taken
 * from the table above and is NOT verified against the live explorer — the
 * UI shows the raw UID next to the link so the user can search by it.
 */
export function cowExplorerUrl(chainId, uid) {
  const meta = COW_CHAINS[Number(chainId)];
  if (!meta || !isCowUid(uid)) return null;
  const seg = meta.explorer ? `${meta.explorer}/` : '';
  return `https://explorer.cow.fi/${seg}orders/${uid}`;
}

/* -------------------------------------------------------------------------- */
/* exact decimal arithmetic (BigInt, never floats)                             */
/* -------------------------------------------------------------------------- */

/**
 * Parse a plain decimal string ("12", "0.5", "1234.000001") into an exact
 * fraction { num, den }. Rejects signs, exponents, separators and anything
 * that is not a plain positive decimal, because a silently mis-parsed price
 * is a wrong order.
 */
export function parseDecimalFraction(value) {
  const s = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const num = BigInt(whole + frac);
  const den = 10n ** BigInt(frac.length);
  if (num === 0n) return null;
  return { num, den };
}

/**
 * Convert a human amount into base units of a token with `decimals`.
 * Returns null when the amount has MORE fractional digits than the token can
 * represent — rounding a sell amount down would sell less than the user
 * typed, so it is refused rather than fixed silently.
 */
export function toBaseUnits(value, decimals) {
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 36) return null;
  const f = parseDecimalFraction(value);
  if (!f) return null;
  const scale = 10n ** BigInt(d);
  if (scale % f.den !== 0n) return null;
  return (f.num * (scale / f.den));
}

/**
 * `buyAmount` for a CoW sell order, from the user's minimum rate.
 *
 * `targetRate` is "how many TO you receive for 1 FROM" (a human decimal).
 * Exact math:  buyRaw = sellRaw × rate × 10^buyDec / 10^sellDec.
 *
 * Rounded UP. The buyAmount is the floor the solver must meet, so rounding it
 * up means the fill is never worse than the target — the only error we are
 * allowed to make is in the user's favour. Returns null for a non-positive or
 * unparseable rate, or a sell amount that does not fit its token's decimals.
 */
export function computeBuyAmountRaw({ sellAmountRaw, sellDecimals, buyDecimals, targetRate }) {
  const sell = typeof sellAmountRaw === 'bigint' ? sellAmountRaw : (typeof sellAmountRaw === 'string' && /^\d+$/.test(sellAmountRaw) ? BigInt(sellAmountRaw) : null);
  const sd = Number(sellDecimals);
  const bd = Number(buyDecimals);
  if (sell === null || sell <= 0n) return null;
  if (!Number.isInteger(sd) || sd < 0 || sd > 36) return null;
  if (!Number.isInteger(bd) || bd < 0 || bd > 36) return null;
  const rate = parseDecimalFraction(targetRate);
  if (!rate) return null;
  const numerator = sell * rate.num * 10n ** BigInt(bd);
  const denominator = rate.den * 10n ** BigInt(sd);
  return (numerator + denominator - 1n) / denominator; // ceiling division
}

/** Human-readable rate from exact raw amounts — for the confirmation summary only. */
export function formatRawAmount(raw, decimals, maxFraction = 6) {
  const s = (typeof raw === 'bigint' ? raw : BigInt(String(raw ?? '0'))).toString();
  const d = Number(decimals);
  if (d === 0) return s;
  const padded = s.padStart(d + 1, '0');
  const whole = padded.slice(0, padded.length - d);
  const frac = padded.slice(padded.length - d).slice(0, maxFraction).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/* -------------------------------------------------------------------------- */
/* allowance — exact, never infinite                                           */
/* -------------------------------------------------------------------------- */

/** True when the VaultRelayer's allowance cannot cover the sell amount. */
export function needsApproval(currentAllowanceRaw, sellAmountRaw) {
  const have = BigInt(String(currentAllowanceRaw ?? '0'));
  const want = BigInt(String(sellAmountRaw));
  return have < want;
}

/**
 * The amount to approve. Exactly the sell amount — never MaxUint256, never a
 * rounded-up buffer. An unlimited approval would leave the VaultRelayer able
 * to pull the whole balance after this one order is gone.
 */
export function approvalAmountFor(sellAmountRaw) {
  const amount = BigInt(String(sellAmountRaw));
  if (amount <= 0n) throw new Error('ZERO_APPROVAL');
  if (amount >= MAX_UINT256) throw new Error('UNLIMITED_APPROVAL_REFUSED');
  return amount;
}

/* -------------------------------------------------------------------------- */
/* appData — carries the platform fee and the order class                      */
/* -------------------------------------------------------------------------- */

/**
 * The appData document and its keccak256 hash. The HASH is what the order
 * signs (bytes32), and the server must store the exact JSON string the hash
 * was computed from, so this returns both and the caller never re-serialises.
 *
 * Partner-fee recipient defaults to our EVM payout address. The CoW docs say
 * partner fees currently accrue on MARKET orders only; this document does not
 * promise the fee on a limit order, and the UI must not either.
 */
export async function buildCowAppData({ recipient = PAYOUT_ADDRESSES.evm, feeBps = PLATFORM_FEE_BPS } = {}) {
  const { keccak256, toUtf8Bytes } = await import('ethers');
  const doc = {
    appCode: COW_APP_CODE,
    metadata: {
      orderClass: { orderClass: 'limit' },
      partnerFee: { volumeBps: feeBps, recipient }
    },
    version: COW_APPDATA_VERSION
  };
  const json = JSON.stringify(doc);
  return { json, hash: keccak256(toUtf8Bytes(json)), doc };
}

/* -------------------------------------------------------------------------- */
/* order + EIP-712                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The unsigned order exactly as the signature and the API both see it.
 * Every amount is a decimal string so JSON never loses precision.
 */
export function buildCowOrder({
  owner,
  sellToken,
  buyToken,
  sellAmountRaw,
  buyAmountRaw,
  validTo,
  appDataHash,
  receiver = owner
}) {
  if (!isEvmAddress(owner) || !isEvmAddress(sellToken) || !isEvmAddress(buyToken)) {
    throw new Error('BAD_ADDRESS');
  }
  if (sellToken.toLowerCase() === buyToken.toLowerCase()) throw new Error('SAME_TOKEN');
  const sell = BigInt(String(sellAmountRaw));
  const buy = BigInt(String(buyAmountRaw));
  if (sell <= 0n || buy <= 0n) throw new Error('ZERO_AMOUNT');
  const until = Number(validTo);
  if (!Number.isInteger(until) || until <= 0 || until > 0xffffffff) throw new Error('BAD_VALID_TO');
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(appDataHash))) throw new Error('BAD_APP_DATA_HASH');
  return {
    sellToken,
    buyToken,
    receiver,
    sellAmount: sell.toString(),
    buyAmount: buy.toString(),
    validTo: until,
    appData: appDataHash,
    feeAmount: '0',
    kind: 'sell',
    partiallyFillable: false,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20'
  };
}

/** The complete EIP-712 request for `eth_signTypedData_v4` / `signTypedData`. */
export function cowOrderTypedData(chainId, order) {
  const id = Number(chainId);
  if (!cowSupports(id)) throw new Error('UNSUPPORTED_CHAIN');
  return {
    domain: {
      name: COW_DOMAIN_NAME,
      version: COW_DOMAIN_VERSION,
      chainId: id,
      verifyingContract: COW_SETTLEMENT
    },
    types: COW_ORDER_TYPES,
    primaryType: 'Order',
    message: { ...order }
  };
}

/** EIP-712 request that cancels one or more orders. */
export function cowCancelTypedData(chainId, orderUids) {
  const id = Number(chainId);
  if (!cowSupports(id)) throw new Error('UNSUPPORTED_CHAIN');
  const uids = Array.isArray(orderUids) ? orderUids : [];
  if (!uids.length || !uids.every(isCowUid)) throw new Error('BAD_ORDER_UID');
  return {
    domain: {
      name: COW_DOMAIN_NAME,
      version: COW_DOMAIN_VERSION,
      chainId: id,
      verifyingContract: COW_SETTLEMENT
    },
    types: COW_CANCEL_TYPES,
    primaryType: 'OrderCancellations',
    message: { orderUids: uids }
  };
}

/** `validTo` in unix seconds from a keyed expiry length in ms. */
export function cowValidTo(expiryMs, now = Date.now()) {
  const ms = Number(expiryMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor((now + ms) / 1000);
}

/* -------------------------------------------------------------------------- */
/* wallet-side helpers (take an ethers signer; never hold a key)               */
/* -------------------------------------------------------------------------- */

const ERC20_MIN_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
];
const WRAP_ABI = ['function deposit() payable'];

/**
 * Make sure the VaultRelayer may pull EXACTLY `sellAmountRaw`. If the current
 * allowance already covers it, nothing is sent. Otherwise one approve for the
 * exact amount is sent and awaited. No infinite approvals, ever.
 *
 * @returns {Promise<{approved:boolean, hash?:string, amount:string}>}
 */
export async function ensureCowAllowance({ signer, owner, sellToken, sellAmountRaw }) {
  const { Contract } = await import('ethers');
  const token = new Contract(sellToken, ERC20_MIN_ABI, signer);
  const current = await token.allowance(owner, COW_VAULT_RELAYER);
  if (!needsApproval(current, sellAmountRaw)) {
    return { approved: false, amount: String(sellAmountRaw) };
  }
  const amount = approvalAmountFor(sellAmountRaw);
  const tx = await token.approve(COW_VAULT_RELAYER, amount);
  await tx.wait();
  return { approved: true, hash: tx.hash, amount: amount.toString() };
}

/** Wrap a native sell token into its wrapped form, for exactly `amountRaw`. */
export async function wrapNativeForCow({ signer, chainId, amountRaw }) {
  const wrapped = COW_WRAPPED_NATIVE[Number(chainId)];
  if (!wrapped) throw new Error('NO_WRAPPED_NATIVE');
  const { Contract } = await import('ethers');
  const contract = new Contract(wrapped, WRAP_ABI, signer);
  const tx = await contract.deposit({ value: BigInt(String(amountRaw)) });
  await tx.wait();
  return { hash: tx.hash, wrapped };
}

/** Sign an order. Returns the 65-byte signature the API expects. */
export async function signCowOrder({ signer, chainId, order }) {
  const td = cowOrderTypedData(chainId, order);
  return signer.signTypedData(td.domain, td.types, td.message);
}

/** Sign a cancellation for a set of order UIDs. */
export async function signCowCancel({ signer, chainId, orderUids }) {
  const td = cowCancelTypedData(chainId, orderUids);
  return signer.signTypedData(td.domain, td.types, td.message);
}

/* -------------------------------------------------------------------------- */
/* the flows the Orders sheet calls                                            */
/* -------------------------------------------------------------------------- */

const isNativeToken = (tk) => Boolean(tk?.native) || !tk?.address;

/**
 * Place a keeper order on CoW. The order of operations is the safety story:
 *
 *   1. amounts are computed and validated BEFORE any transaction;
 *   2. a native sell is wrapped only when the user confirmed the wrap;
 *   3. the allowance is raised to EXACTLY the sell amount, if needed;
 *   4. the order is signed in the wallet;
 *   5. the server verifies the signature and relays it.
 *
 * Nothing is sent to the chain by step 4 — a signature is not a transaction.
 * If step 5 fails the user has an allowance and a signature they can discard;
 * no funds have moved.
 *
 * @returns {Promise<{ok:true, uid:string, explorerUrl:string|null, sellToken:string, buyToken:string, feeBps:number} | {ok:false, error:string}>}
 */
export async function placeCowKeeperOrder({
  signer,
  owner,
  chainId,
  fromToken,
  toToken,
  amountIn,
  minOut,
  expiryMs,
  wrapNative = false,
  now = Date.now()
}) {
  const id = Number(chainId);
  if (!cowSupports(id)) return { ok: false, error: 'UNSUPPORTED_CHAIN' };
  if (!isEvmAddress(owner)) return { ok: false, error: 'NO_WALLET' };

  const native = isNativeToken(fromToken);
  const sellToken = native ? COW_WRAPPED_NATIVE[id] : fromToken.address;
  const buyNative = isNativeToken(toToken);
  const buyToken = buyNative ? COW_WRAPPED_NATIVE[id] : toToken.address;
  if (!sellToken || !buyToken) return { ok: false, error: 'NO_TOKEN_ADDRESS' };
  if (native && !wrapNative) return { ok: false, error: 'NATIVE_NOT_WRAPPED' };

  const sellDec = Number(fromToken.decimals ?? (native ? 18 : NaN));
  const buyDec = Number(toToken.decimals ?? (buyNative ? 18 : NaN));
  const sellRaw = toBaseUnits(amountIn, sellDec);
  if (sellRaw === null || sellRaw <= 0n) return { ok: false, error: 'BAD_AMOUNT' };
  const buyRaw = computeBuyAmountRaw({
    sellAmountRaw: sellRaw.toString(),
    sellDecimals: sellDec,
    buyDecimals: buyDec,
    targetRate: String(minOut)
  });
  if (buyRaw === null || buyRaw <= 0n) return { ok: false, error: 'BAD_RATE' };

  const validTo = cowValidTo(expiryMs, now);
  if (!validTo) return { ok: false, error: 'BAD_EXPIRY' };

  const net = await signer.provider?.getNetwork?.();
  if (net && Number(net.chainId) !== id) return { ok: false, error: 'WRONG_NETWORK' };

  try {
    if (native) await wrapNativeForCow({ signer, chainId: id, amountRaw: sellRaw });
    await ensureCowAllowance({ signer, owner, sellToken, sellAmountRaw: sellRaw });

    const app = await buildCowAppData();
    const order = buildCowOrder({
      owner,
      sellToken,
      buyToken,
      sellAmountRaw: sellRaw,
      buyAmountRaw: buyRaw,
      validTo,
      appDataHash: app.hash
    });
    const signature = await signCowOrder({ signer, chainId: id, order });

    const { apiBase } = await import('./apiBase.js');
    const res = await fetch(`${apiBase()}/orders/cow/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ chainId: id, from: owner, signature, signingScheme: 'eip712', order, appData: app.json })
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !isCowUid(body?.uid)) return { ok: false, error: body?.error || 'RELAY_FAILED' };
    return {
      ok: true,
      uid: body.uid,
      explorerUrl: cowExplorerUrl(id, body.uid),
      sellToken,
      buyToken,
      feeBps: body.feeBps ?? PLATFORM_FEE_BPS
    };
  } catch (err) {
    const msg = String(err?.code || err?.message || '');
    if (/ACTION_REJECTED|user rejected|denied/i.test(msg)) return { ok: false, error: 'REJECTED' };
    return { ok: false, error: 'SIGN_OR_APPROVE_FAILED' };
  }
}

/** Cancel an open CoW order with the owner's signature. */
export async function cancelCowKeeperOrder({ signer, owner, chainId, uid }) {
  const id = Number(chainId);
  if (!cowSupports(id) || !isCowUid(uid) || !isEvmAddress(owner)) return { ok: false, error: 'BAD_REQUEST' };
  try {
    const signature = await signCowCancel({ signer, chainId: id, orderUids: [uid] });
    const { apiBase } = await import('./apiBase.js');
    const res = await fetch(`${apiBase()}/orders/cow/cancel`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ chainId: id, from: owner, orderUids: [uid], signature, signingScheme: 'eip712' })
    });
    const body = await res.json().catch(() => null);
    return res.ok ? { ok: true } : { ok: false, error: body?.error || 'CANCEL_FAILED' };
  } catch (err) {
    const msg = String(err?.code || err?.message || '');
    return { ok: false, error: /ACTION_REJECTED|user rejected|denied/i.test(msg) ? 'REJECTED' : 'SIGN_FAILED' };
  }
}

/** The order's state as the order book reports it — open, fulfilled, cancelled or expired. */
export async function fetchCowKeeperState(chainId, uid) {
  if (!cowSupports(chainId) || !isCowUid(uid)) return { ok: false, state: 'unknown' };
  try {
    const { apiBase } = await import('./apiBase.js');
    const res = await fetch(`${apiBase()}/orders/cow/${Number(chainId)}/${uid}`, { headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) return { ok: false, state: 'unknown' };
    return { ok: true, state: body.state ?? 'unknown', executedBuyAmount: body.executedBuyAmount ?? null };
  } catch {
    return { ok: false, state: 'unknown' };
  }
}
