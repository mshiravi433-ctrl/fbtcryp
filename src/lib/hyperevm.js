/**
 * HyperEVM boundaries shared by the swap, token and send paths.
 *
 * HyperEVM is EVM-compatible, but it is not HyperCore.  In particular, the
 * `0x2222…2222` system address is a dedicated HYPE-only Core <-> EVM transfer
 * endpoint; it is not an ERC-20 contract and it is not an ordinary recipient.
 * FBT does not implement Core transfers, so all direct sends to that address
 * are rejected rather than trying to infer the user's intent.
 *
 * Keep the initial asset surface deliberately small.  A route provider proving
 * a HYPE/USDC route does not review every asset on the chain, and a remote
 * token list or arbitrary contract import would turn that narrow proof into an
 * open-ended asset promise.  Add an address below only after a separate asset
 * review and route/fee validation.
 */

export const HYPEREVM_CHAIN_ID = 999;
export const HYPEREVM_RPC = 'https://rpc.hyperliquid.xyz/evm';
export const HYPEREVM_EXPLORER = 'https://hyperevmscan.io';
export const HYPEREVM_KYBER_SLUG = 'hyperevm';

/** KyberSwap's documented native-asset sentinel; this is not an ERC-20. */
export const EVM_NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export const HYPEREVM_NATIVE = Object.freeze({
  symbol: 'HYPE',
  name: 'HYPE',
  decimals: 18,
  address: null
});

/** Canonical immutable wrapped HYPE, supplied by Hyperliquid's HyperEVM docs. */
export const HYPEREVM_WHYPE = '0x5555555555555555555555555555555555555555';

/** Native Circle USDC on HyperEVM, not a bridged lookalike. */
export const HYPEREVM_USDC = '0xb88339CB7199b77E23DB6E890353E22632Ba630f';

/**
 * Hyperliquid's HYPE-only system endpoint.  Do not use as a token, router,
 * approval spender, or general recipient.
 */
export const HYPEREVM_CORE_TRANSFER_ADDRESS = '0x2222222222222222222222222222222222222222';

const normalize = (value) => String(value || '').trim().toLowerCase();
const ALLOWED_ERC20 = new Set([normalize(HYPEREVM_WHYPE), normalize(HYPEREVM_USDC)]);

export const isHyperEvm = (chainId) => Number(chainId) === HYPEREVM_CHAIN_ID;

export const isHyperEvmCoreTransferAddress = (address) =>
  normalize(address) === normalize(HYPEREVM_CORE_TRANSFER_ADDRESS);

/**
 * True only for the three assets reviewed for the first HyperEVM release:
 * native HYPE, canonical WHYPE and native Circle USDC.
 */
export function isHyperEvmAllowedToken(token) {
  if (!token || typeof token !== 'object') return false;

  if (token.native) {
    return (
      normalize(token.symbol) === 'hype' &&
      !normalize(token.address) &&
      Number(token.decimals) === HYPEREVM_NATIVE.decimals
    );
  }

  return ALLOWED_ERC20.has(normalize(token.address));
}

/** Return whether a token is usable under the chain's current asset policy. */
export function isTokenAllowedOnChain(chainId, token) {
  return !isHyperEvm(chainId) || isHyperEvmAllowedToken(token);
}

/**
 * Fail closed before a quote, approval or transaction is prepared.  The error
 * code is intentionally stable so the UI can explain that the restriction is
 * an explicit launch policy, not a transient provider error.
 */
export function assertTokenAllowedOnChain(chainId, token) {
  if (!isTokenAllowedOnChain(chainId, token)) {
    throw new Error('HYPEREVM_TOKEN_NOT_ALLOWLISTED');
  }
}

/** The initial HyperEVM launch deliberately has no remote token-list sources. */
export const remoteTokenListsAllowed = (chainId) => !isHyperEvm(chainId);

/** The initial HyperEVM launch deliberately rejects arbitrary ERC-20 imports. */
export const tokenImportAllowed = (chainId) => !isHyperEvm(chainId);

/** Filter a persisted/remote list through the chain's asset policy. */
export function filterTokensForChain(chainId, tokens) {
  if (!Array.isArray(tokens)) return [];
  return isHyperEvm(chainId) ? tokens.filter(isHyperEvmAllowedToken) : tokens;
}

/**
 * FBT has no Core-transfer UI or Core-transfer semantics.  Block the special
 * endpoint completely rather than accidentally submitting an ERC-20 transfer
 * or presenting a normal-recipient confirmation for it.
 */
export function assertRecipientAllowedOnChain(chainId, recipient) {
  if (isHyperEvm(chainId) && isHyperEvmCoreTransferAddress(recipient)) {
    throw new Error('HYPEREVM_CORE_TRANSFER_ADDRESS_BLOCKED');
  }
}
