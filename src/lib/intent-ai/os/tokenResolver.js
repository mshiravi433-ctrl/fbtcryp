/**
 * Token identity is (chain + contract), never symbol alone.
 * USDC on Ethereum ≠ USDC on Arbitrum ≠ USDC on Solana.
 */

export const TOKEN_RESOLVER_SCHEMA = 'fbt.token-resolver.v1';

export function tokenKey({ chainId = null, address = null, symbol = null, mint = null } = {}) {
  const chain = chainId == null ? 'unknown' : String(chainId);
  const id = String(address || mint || '').toLowerCase();
  if (id) return `${chain}:${id}`;
  return `${chain}:${String(symbol || '').toUpperCase() || 'UNKNOWN'}`;
}

export function resolveToken(input = {}) {
  const symbol = input.symbol ? String(input.symbol).toUpperCase() : null;
  const chainId = input.chainId ?? input.chain ?? null;
  const address = input.address || input.contractAddress || input.mint || null;
  const decimals = Number.isFinite(Number(input.decimals)) ? Number(input.decimals) : null;
  if (!symbol && !address) {
    return { ok: false, code: 'UNRESOLVED_TOKEN', token: null };
  }
  return {
    ok: true,
    schema: TOKEN_RESOLVER_SCHEMA,
    key: tokenKey({ chainId, address, symbol }),
    symbol,
    chainId,
    address,
    decimals,
    native: input.native === true,
    coingeckoId: input.coingeckoId || null
  };
}

export function sameToken(a, b) {
  if (!a || !b) return false;
  const ka = tokenKey(a);
  const kb = tokenKey(b);
  return ka === kb;
}
