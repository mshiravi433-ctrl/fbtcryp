/**
 * FBT INTENT OS — Universal Wallet Context
 * Spec §20: EVM, Solana, Balances, Tokens, NFT, Positions, LP, Farms, Lending, Borrowing, Orders, Futures
 */

export const WALLET_CONTEXT_SCHEMA = 'fbt.wallet-context.v1';

export async function buildUniversalWalletContext({
  evmWallet = null,
  solanaWallet = null,
  services = {}
} = {}) {
  // Parallel reads for performance (Spec §36)
  const [
    evmBalances,
    solanaBalances,
    nfts,
    positions,
    orders,
    futures
  ] = await Promise.all([
    fetchEVMBalances(evmWallet, services),
    fetchSolanaBalances(solanaWallet, services),
    fetchNFTs(evmWallet, solanaWallet, services),
    fetchPositions(evmWallet, services),
    fetchOrders(evmWallet, services),
    fetchFutures(evmWallet, services)
  ]);
  
  const allBalances = [...(evmBalances.balances || []), ...(solanaBalances.balances || [])];
  const totalValue = allBalances.reduce((s, b) => s + (Number(b.valueUsd) || 0), 0);
  
  return {
    schema: WALLET_CONTEXT_SCHEMA,
    connected: Boolean(evmWallet?.connected || solanaWallet?.connected),
    canSign: Boolean(evmWallet?.canSign || solanaWallet?.connected),
    
    evm: {
      connected: Boolean(evmWallet?.connected),
      address: evmWallet?.address || null,
      addresses: evmWallet?.evmAddresses || (evmWallet?.address ? [evmWallet.address] : []),
      chainId: evmWallet?.chainId || 42161,
      chains: evmWallet?.chains || [1, 56, 42161, 8453],
      balances: evmBalances.balances || []
    },
    
    solana: {
      connected: Boolean(solanaWallet?.connected || solanaWallet?.address),
      address: solanaWallet?.address || solanaWallet?.solanaAddress || null,
      addresses: solanaWallet?.solanaAddresses || [],
      balances: solanaBalances.balances || []
    },
    
    balances: allBalances,
    totalValueUsd: totalValue,
    
    tokens: allBalances.map(b => ({
      symbol: b.symbol,
      amount: b.amount,
      valueUsd: b.valueUsd,
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
    evmAddresses: evmWallet?.evmAddresses || (evmWallet?.address ? [evmWallet.address] : []),
    solanaAddresses: solanaWallet?.solanaAddresses || (solanaWallet?.address ? [solanaWallet.address] : []),
    
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
  } catch {}
  
  // Try multi-chain portfolio hook data if available via wallet
  if (wallet.balances) {
    return { balances: wallet.balances };
  }
  
  return { balances: [] };
}

async function fetchSolanaBalances(wallet, services) {
  if (!wallet?.address && !wallet?.solanaAddress) return { balances: [] };
  
  const addr = wallet.address || wallet.solanaAddress;
  try {
    if (services.solanaService?.getBalances) {
      const res = await services.solanaService.getBalances({ address: addr });
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
    if (services.nftService?.list) {
      return await services.nftService.list({ address: evmWallet?.address });
    }
  } catch {}
  return { nfts: [] };
}

async function fetchPositions(wallet, services) {
  const positions = { lending: [], borrowing: [], farming: [], staking: [], lp: [] };
  
  try {
    const results = await Promise.allSettled([
      services.lendingService?.getPositions?.({ address: wallet?.address }),
      services.farmingService?.getPositions?.({ address: wallet?.address }),
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
    if (services.ordersService?.list) {
      return await services.ordersService.list({ address: wallet?.address });
    }
  } catch {}
  return { orders: [] };
}

async function fetchFutures(wallet, services) {
  try {
    if (services.futuresService?.getPositions) {
      return await services.futuresService.getPositions({ address: wallet?.address });
    }
  } catch {}
  return { positions: [] };
}
