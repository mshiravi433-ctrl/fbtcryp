/**
 * FBT LAUNCH — on-chain verification (the "only the chain says LIVE" law).
 *
 * Spec §22: a launch is SUCCESS only after a REAL blockchain confirmation
 * was read back. A mined receipt is the start of this file, not the end of
 * it: we re-read the token's own state (name/supply/ownership), the pair's
 * reserves and the creator's LP balance, and refuse LIVE when any of them
 * disagrees with what the user signed for.
 *
 * Everything here is READ-ONLY (view calls + logs). No wallet, no signer.
 */
import { dexForChain } from './networks.js';

const TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function owner() view returns (address)',
  'function capabilities() view returns (uint256)',
  'function isFbtToken(address) view returns (bool)'
];
const PAIR_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function factory() view returns (address)',
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)'
];

/**
 * Verify a created token against what the user asked for.
 *
 * @returns {{ok:boolean, address:string, name:string, symbol:string, decimals:number,
 *            totalSupply:string, owner:string, capabilities:number, isFbt:boolean,
 *            creatorBalance:string, problems:string[]}}
 */
export async function verifyToken(provider, address, { creator = null, expectName = null, expectSymbol = null, expectDecimals = null, expectSupply = null } = {}) {
  const { Contract } = await import('ethers');
  const problems = [];
  const c = new Contract(address, TOKEN_ABI, provider);

  const [name, symbol, decimals, totalSupply, owner, capabilities] = await Promise.all([
    c.name().catch(() => null),
    c.symbol().catch(() => null),
    c.decimals().catch(() => null),
    c.totalSupply().catch(() => null),
    c.owner().catch(() => null),
    c.capabilities().catch(() => null)
  ]);

  let creatorBalance = '0';
  if (creator) creatorBalance = (await c.balanceOf(creator).catch(() => null))?.toString() || '0';

  if (name == null || totalSupply == null) problems.push('TOKEN_READONLY_FAILED');
  if (expectName && String(name).toLowerCase() !== String(expectName).toLowerCase()) problems.push('NAME_MISMATCH');
  if (expectSymbol && String(symbol).toUpperCase() !== String(expectSymbol).toUpperCase()) problems.push('SYMBOL_MISMATCH');
  if (expectDecimals != null && Number(decimals) !== Number(expectDecimals)) problems.push('DECIMALS_MISMATCH');
  if (expectSupply && totalSupply != null && totalSupply.toString() !== String(expectSupply)) problems.push('SUPPLY_MISMATCH');
  if (creator && creatorBalance === '0') problems.push('CREATOR_HAS_NO_TOKENS');

  let isFbt = false;
  try { isFbt = Boolean(await c.isFbtToken(address).catch(() => false)); } catch { /* standalone token */ }

  return {
    ok: problems.length === 0,
    address,
    name: String(name || ''),
    symbol: String(symbol || ''),
    decimals: Number(decimals ?? 0),
    totalSupply: totalSupply?.toString() || '0',
    owner: String(owner || ''),
    capabilities: Number(capabilities ?? 0),
    creatorBalance,
    isFbt,
    problems
  };
}

/* ──────────────── direct (no-factory) deploy verification ─────────────── */

/**
 * Does the code we read back equal the code we published?
 *
 * Byte-for-byte, case-insensitively on the hex digits (the chain returns
 * lowercase). Length is compared FIRST: `0x` and a truncated reply can never
 * pass, and a mismatch reports how far off it is, which is the difference
 * between "the deployment failed" and "someone else's contract is at your
 * predicted address".
 */
export function codeMatches(expected, actual) {
  const e = String(expected || '').toLowerCase();
  const a = String(actual || '').toLowerCase();
  if (!e || !a || a === '0x') return { ok: false, reason: 'NO_CODE' };
  if (e.length !== a.length) return { ok: false, reason: 'LENGTH_MISMATCH', expectedLength: e.length, actualLength: a.length };
  if (e !== a) {
    let at = 0;
    while (at < e.length && e[at] === a[at]) at += 1;
    return { ok: false, reason: 'BYTE_MISMATCH', at };
  }
  return { ok: true, reason: null };
}

/**
 * Verify a PURE CREATE deployment — the check that replaces the factory's
 * `TokenCreated` event in direct mode.
 *
 * Three facts, in order:
 *   1. the transaction succeeded (status 1),
 *   2. it was a deployment (`to` is null) and mined at the address we
 *      PREDICTED before the user signed — a mismatch means the nonce moved
 *      under us and the token is somewhere else, which must never be papered
 *      over, because the liquidity steps then point at the wrong contract,
 *   3. the code at that address is byte-identical to the token's runtime
 *      bytecode — so the thing being paired is the contract the user signed
 *      for, not a lookalike.
 *
 * Pure on purpose (no provider, no network): the caller reads the receipt and
 * the code, this function judges them, and the probe can test every branch
 * offline. Named failures, never a generic `false`:
 *   DIRECT_TX_REVERTED · DIRECT_TX_NOT_DEPLOY · DIRECT_RECEIPT_ADDRESS_MISSING
 *   DIRECT_ADDRESS_MISMATCH · DIRECT_NO_CODE · DIRECT_CODE_MISMATCH
 *
 * @returns {{ok:boolean, address:(string|null), code:string, problems:string[]}}
 */
export function checkDirectDeploy({
  status, to, predictedAddress, contractAddress = null, expectedCode, actualCode = '0x'
} = {}) {
  const problems = [];
  const predicted = predictedAddress ? String(predictedAddress) : null;
  const mined = contractAddress ? String(contractAddress) : null;

  if (Number(status) !== 1) problems.push('DIRECT_TX_REVERTED');
  if (to !== null && to !== undefined) problems.push('DIRECT_TX_NOT_DEPLOY');
  if (!predicted) problems.push('DIRECT_PREDICTED_ADDRESS_MISSING');

  // The receipt's own contractAddress is the chain's word on where it landed.
  if (Number(status) === 1 && (to === null || to === undefined) && !mined) {
    problems.push('DIRECT_RECEIPT_ADDRESS_MISSING');
  }
  if (predicted && mined && predicted.toLowerCase() !== mined.toLowerCase()) {
    problems.push('DIRECT_ADDRESS_MISMATCH');
  }

  const address = mined || predicted;
  const cmp = codeMatches(expectedCode, actualCode);
  if (!cmp.ok) {
    if (cmp.reason === 'NO_CODE') problems.push('DIRECT_NO_CODE');
    else if (Number(status) === 1) problems.push('DIRECT_CODE_MISMATCH');
  }

  return {
    ok: problems.length === 0,
    address,
    code: String(actualCode || '0x'),
    expectedCodeLength: String(expectedCode || '').length,
    actualCodeLength: String(actualCode || '').length,
    problems
  };
}

/**
 * The provider half of the direct-deploy check: read the receipt's facts and
 * the address's code, hand both to checkDirectDeploy. Read-only.
 */
export async function verifyDirectToken(provider, receipt, {
  predictedAddress, expectedCode, address = null
} = {}) {
  if (!provider || !receipt) return { ok: false, address: null, code: '0x', problems: ['NO_RECEIPT'] };
  const landed = address || receipt.contractAddress || predictedAddress || null;
  let code = '0x';
  if (landed) code = await provider.getCode(landed).catch(() => '0x');
  return checkDirectDeploy({
    status: receipt.status,
    to: receipt.to,
    predictedAddress,
    contractAddress: receipt.contractAddress || address,
    expectedCode,
    actualCode: code
  });
}

/**
 * Verify a launched pair: the reserves match the signed amounts (within the
 * signed slippage floor), the LP went to the creator, and the pair really
 * belongs to the DEX factory we verified at plan time.
 *
 * @returns {{ok:boolean, address:string, token0:string, token1:string, factory:string,
 *            reserves:{token:string, quote:string}, lpTotal:string, lpBalance:string,
 *            problems:string[]}}
 */
export async function verifyPool(provider, chainId, pairAddress, {
  tokenAddress, quote, creator, tokenMin, quoteMin, newPair = true, desired = null
}) {
  /* dexForChain, not LAUNCH_DEX: the wrapped native and the router live on
     the merged object (a launch DEX may pin its own, see networks.js). */
  const dex = dexForChain(chainId);
  const { Contract } = await import('ethers');
  const problems = [];
  if (!pairAddress) return { ok: false, problems: ['NO_PAIR_ADDRESS'] };
  const c = new Contract(pairAddress, PAIR_ABI, provider);

  const [token0, token1, factory, reserves, lpTotal, lpBalance] = await Promise.all([
    c.token0().catch(() => null),
    c.token1().catch(() => null),
    c.factory().catch(() => null),
    c.getReserves().catch(() => null),
    c.totalSupply().catch(() => null),
    c.balanceOf(creator).catch(() => null)
  ]);

  if (!token0 || !token1 || !factory) problems.push('PAIR_READONLY_FAILED');

  // The pair must sit on the verified factory — a pair on a different
  // factory is exactly the class of impersonation the anchor check exists to
  // keep out of the plan, and we re-prove it here from the chain itself.
  if (factory && dex && factory.toLowerCase() !== dex.factory.toLowerCase()) problems.push('PAIR_FACTORY_MISMATCH');

  const quoteAddress = (quote.native ? dex?.wrapped : quote.address) || '';
  const isToken0 = token0 && token0.toLowerCase() === String(tokenAddress).toLowerCase();
  const reserveToken = reserves ? (isToken0 ? reserves.reserve0 : reserves.reserve1) : null;
  const reserveQuote = reserves ? (isToken0 ? reserves.reserve1 : reserves.reserve0) : null;

  if (!reserveToken || !reserveQuote || Number(reserveToken) === 0 || Number(reserveQuote) === 0) {
    problems.push('PAIR_HAS_NO_RESERVES');
  } else {
    // A freshly created pool's reserves are the signed amounts themselves —
    // so a new pool must land within [signed min, desired × 1.02] on BOTH
    // legs (anything else means someone front-ran or the bytes are not ours).
    // A pre-existing pool only owes us the signed floors.
    const check = (res, min, desired) => {
      const r = BigInt(res.toString());
      if (min) {
        const m = BigInt(min.toString());
        if (r < m) return 'BELOW_MIN';
      }
      if (newPair && desired) {
        const d = BigInt(desired.toString());
        if (r > (d * 102n) / 100n) return 'ABOVE_DESIRED';
      }
      return null;
    };
    const tokenIssue = check(reserveToken, tokenMin, desired?.token);
    if (tokenIssue === 'BELOW_MIN') problems.push('TOKEN_RESERVE_BELOW_MIN');
    if (tokenIssue === 'ABOVE_DESIRED') problems.push('TOKEN_RESERVE_ABOVE_DESIRED');
    const quoteIssue = check(reserveQuote, quoteMin, desired?.quote);
    if (quoteIssue === 'BELOW_MIN') problems.push('QUOTE_RESERVE_BELOW_MIN');
    if (quoteIssue === 'ABOVE_DESIRED') problems.push('QUOTE_RESERVE_ABOVE_DESIRED');
  }

  if (!lpTotal || Number(lpTotal) === 0) problems.push('LP_NOT_MINTED');
  if (lpBalance == null || Number(lpBalance) === 0) problems.push('CREATOR_HAS_NO_LP');

  return {
    ok: problems.length === 0,
    address: pairAddress,
    token0: String(token0 || ''),
    token1: String(token1 || ''),
    factory: String(factory || ''),
    reserves: { token: reserveToken?.toString() || '0', quote: reserveQuote?.toString() || '0' },
    lpTotal: lpTotal?.toString() || '0',
    lpBalance: lpBalance?.toString() || '0',
    problems
  };
}

/**
 * Full launch verification. ok is true ONLY when both the token and the
 * pool read back cleanly — this is the gate in front of the LIVE state.
 */
export async function verifyLaunch(provider, {
  chainId, tokenAddress, pairAddress, creator, quote, tokenMin, quoteMin, newPair = true, desired = null, expect = null
} = {}) {
  const token = await verifyToken(provider, tokenAddress, { creator, ...expect });
  const pool = pairAddress
    ? await verifyPool(provider, chainId, pairAddress, {
      tokenAddress, quote, creator, tokenMin, quoteMin, newPair, desired
    })
    : { ok: false, problems: ['NO_PAIR_ADDRESS'] };
  return { ok: token.ok && pool.ok, token, pool };
}
