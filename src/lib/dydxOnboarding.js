/**
 * dYdX onboarding is an EIP-712 signature over Ethereum mainnet (chain id 1),
 * regardless of the chain dYdX Chain itself runs on. Some mobile wallets refuse
 * to show the typed-data prompt when their active EVM chain does not match the
 * EIP-712 domain. Switch explicitly, then verify the wallet actually switched
 * before requesting the signature.
 */
export const DYDX_ONBOARDING_CHAIN_ID = 1;

export function parseWalletChainId(value) {
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (text.startsWith('eip155:')) return parseWalletChainId(text.slice(7));
    if (/^0x[0-9a-f]+$/.test(text)) return Number.parseInt(text.slice(2), 16);
  }
  const chainId = Number(value);
  return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ensure the connected wallet is on Ethereum mainnet before dYdX's typed-data
 * onboarding request. A chain-switch approval is not a transaction. We verify
 * `eth_chainId` after it resolves because some mobile wallets resolve the
 * switch request before the chainChanged event reaches the WebView.
 *
 * Throws DYDX_NETWORK_REQUIRED on refusal, unsupported transport, or timeout;
 * callers must not ask the wallet to sign on a chain that disagrees with the
 * EIP-712 domain.
 */
export async function prepareDydxOnboardingNetwork(
  wallet,
  { timeoutMs = 3_000, pollMs = 100 } = {}
) {
  if (!wallet) throw new Error('DYDX_NETWORK_REQUIRED');

  const readChainId = async () => {
    const provider = wallet.getEip1193Provider?.();
    if (provider?.request) {
      const raw = await provider.request({ method: 'eth_chainId' });
      return parseWalletChainId(raw);
    }
    return parseWalletChainId(wallet.chainId);
  };

  let current;
  try {
    current = await readChainId();
  } catch {
    current = null;
  }
  if (current === DYDX_ONBOARDING_CHAIN_ID) return current;

  let switched = false;
  try {
    switched = await wallet.switchChain?.(DYDX_ONBOARDING_CHAIN_ID) === true;
  } catch {
    switched = false;
  }
  if (!switched) throw new Error('DYDX_NETWORK_REQUIRED');

  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  do {
    try {
      current = await readChainId();
      if (current === DYDX_ONBOARDING_CHAIN_ID) return current;
    } catch {
      // A WalletConnect provider can briefly be unavailable during chainChanged.
    }
    if (Date.now() >= deadline) break;
    await delay(Math.min(Math.max(1, Number(pollMs) || 1), deadline - Date.now()));
  } while (Date.now() <= deadline);

  throw new Error('DYDX_NETWORK_REQUIRED');
}
