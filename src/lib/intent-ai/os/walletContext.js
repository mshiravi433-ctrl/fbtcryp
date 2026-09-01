/**
 * FBT INTENT OS — Universal Wallet Context
 * Spec §20: EVM, Solana, Balances, Tokens, NFT, Positions, LP, Farms, Lending, Borrowing, Orders, Futures
 * No private keys, only public data
 */

export const WALLET_CONTEXT_SCHEMA = 'fbt.wallet-context.v1';

export async function buildUniversalWalletContext({
  evmWallet = null,
  solanaWallet = null,
  services = {},
  address = null,
  solanaAddress = null
} = {}) {
  // Support both old and new signatures
  const evmAddr = address || evmWallet?.address || evmWallet?.evmAddress || null;
  const solAddr = solanaAddress || solanaWallet?.address || solanaWallet?.solanaAddress || null;

  // Parallel reads for performance (Spec §36)
  const [
    evmBalances,
    solBalances,
    nfts,
    positions,
    orders,
    futures
  ] = await Promise.all([
    fetchEVMBalances(evmWallet || { address: evmAddr }, services),
    fetchSolanaBalances(solanaWallet || { address: solAddr }, services),
    fetchNFTs(evmWallet || { address: evmAddr }, solanaWallet || { address: solAddr }, services),
    fetchPositions(evmWallet || { address: evmAddr }, services),
    fetchOrders(evmWallet || { address: evmAddr }, services),
    fetchFutures(evmWallet || { address: evmAddr }, services)
  ]);

  const allBalances = [...(evmBalances.balances || []), ...(solBalances.balances || [])];
  const totalValue = allBalances.reduce((s, b) => s + (Number(b.valueUsd || b.value) || 0), 0);

  return {
    schema: WALLET_CONTEXT_SCHEMA,
    connected: Boolean(evmWallet?.connected || solanaWallet?.connected || evmAddr || solAddr),
    canSign: Boolean(evmWallet?.canSign || solAddr || evmAddr),
    evmAddress: evmAddr,
    solanaAddress: solAddr,

    evm: {
      connected: Boolean(evmWallet?.connected || evmAddr),
      address: evmAddr,
      addresses: evmWallet?.evmAddresses || (evmAddr ? [evmAddr] : []),
      chainId: evmWallet?.chainId || 42161,
      chains: evmWallet?.chains || [1, 56, 42161, 8453],
      balances: evmBalances.balances || []
    },

    solana: {
      connected: Boolean(solanaWallet?.connected || solAddr),
      address: solAddr,
      addresses: solanaWallet?.solanaAddresses || (solAddr ? [solAddr] : []),
      balances: solBalances.balances || []
    },

    balances: allBalances,
    totalValueUsd: totalValue,

    tokens: allBalances.map(b => ({
      symbol: b.symbol,
      amount: b.amount,
      valueUsd: b.valueUsd || b.value,
      chainId: b.chainId,
      chain: b.chain
    })),

    nfts: nfts.nfts || [],

    positions: {
      lending: positions.lending || [],
      borrowing: positions.borrowing || [],
      farming: positions.farming || [],
      staking: positions.staking || [],
      lp: positions.lp || []
    },

    orders: orders.orders || [],
    futures: futures.positions || [],

    // For AI context compatibility
    evmAddresses: evmWallet?.evmAddresses || (evmAddr ? [evmAddr] : []),
    solanaAddresses: solanaWallet?.solanaAddresses || (solAddr ? [solAddr] : []),

    chains: [...new Set(allBalances.map(b => b.chainId).filter(Boolean))],
    dataStatus: allBalances.length ? 'live' : 'unavailable',
    builtAt: Date.now()
  };
}

async function fetchEVMBalances(wallet, services) {
  if (!wallet?.address) return { balances: [] };
  try {
    if (services.walletService?.getBalances) {
      const res = await services.walletService.getBalances({ address: wallet.address });
      if (res?.balances) return res;
      if (Array.isArray(res)) return { balances: res };
    }
    if (services.evm?.getBalances) {
      const res = await services.evm.getBalances({ address: wallet.address });
      if (res?.balances) return res;
      if (Array.isArray(res)) return { balances: res };
    }
  } catch {}
  if (wallet.balances) return { balances: wallet.balances };
  return { balances: [] };
}

async function fetchSolanaBalances(wallet, services) {
  const addr = wallet?.address || wallet?.solanaAddress;
  if (!addr) return { balances: [] };
  try {
    if (services.solanaService?.getBalances) {
      const res = await services.solanaService.getBalances({ address: addr });
      if (res?.balances) return res;
    }
    if (services.solana?.getBalances) {
      const res = await services.solana.getBalances({ address: addr });
      if (res?.balances) return res;
    }
  } catch {}
  if (wallet.balances) {
    const solBalances = wallet.balances.filter(b => b.chain === 'solana' || b.chainId === 501);
    return { balances: solBalances };
  }
  return { balances: [] };
}

async function fetchNFTs(evmWallet, solanaWallet, services) {
  try {
    if (services.nftService?.list) return await services.nftService.list({ address: evmWallet?.address });
    if (services.nft?.list) return await services.nft.list({ address: evmWallet?.address, solanaAddress: solanaWallet?.address });
  } catch {}
  return { nfts: [] };
}

async function fetchPositions(wallet, services) {
  const positions = { lending: [], borrowing: [], farming: [], staking: [], lp: [] };
  try {
    const results = await Promise.allSettled([
      services.lendingService?.getPositions?.({ address: wallet?.address }) || services.lending?.getPositions?.({ address: wallet?.address }),
      services.farmingService?.getPositions?.({ address: wallet?.address }) || services.farm?.list?.({ address: wallet?.address }),
      services.stakingService?.getPositions?.({ address: wallet?.address })
    ]);
    if (results[0].status === 'fulfilled' && results[0].value) {
      positions.lending = results[0].value.lending || results[0].value || [];
      positions.borrowing = results[0].value.borrowing || [];
    }
    if (results[1].status === 'fulfilled' && results[1].value) {
      positions.farming = results[1].value.positions || results[1].value || [];
      positions.lp = results[1].value.lp || [];
    }
    if (results[2].status === 'fulfilled' && results[2].value) {
      positions.staking = results[2].value.positions || results[2].value || [];
    }
  } catch {}
  return positions;
}

async function fetchOrders(wallet, services) {
  try {
    if (services.ordersService?.list) return await services.ordersService.list({ address: wallet?.address });
    if (services.orders?.list) return await services.orders.list({ address: wallet?.address });
  } catch {}
  return { orders: [] };
}

async function fetchFutures(wallet, services) {
  try {
    if (services.futuresService?.getPositions) return await services.futuresService.getPositions({ address: wallet?.address });
  } catch {}
  return { positions: [] };
}

export function sanitizeWalletContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return ctx;
  const forbidden = ['privateKey', 'seedPhrase', 'mnemonic', 'secret', 'private_key', 'seed'];
  const out = { ...ctx };
  for (const key of forbidden) delete out[key];
  return out;
}
