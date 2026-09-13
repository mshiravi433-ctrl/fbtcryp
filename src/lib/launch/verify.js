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
import { LAUNCH_DEX } from './networks.js';

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
  const dex = LAUNCH_DEX[chainId];
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

  const quoteAddress = (quote.native ? dex.wrapped : quote.address) || '';
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
