/**
 * FBT INTENT OS — Wallet Agent
 * Spec §20 Universal Wallet Context
 */

export const WALLET_AGENT_SCHEMA = 'fbt.wallet-agent.v1';

export function createWalletAgent({ walletService = null, solanaService = null, eventBus = null } = {}) {
  return {
    id: 'wallet-agent',
    schema: WALLET_AGENT_SCHEMA,
    
    async getContext(walletState = null) {
      if (walletState) return walletState;
      
      try {
        if (walletService?.getContext) {
          return await walletService.getContext();
        }
      } catch {}
      
      return {
        connected: false,
        canSign: false,
        evmAddresses: [],
        solanaAddresses: [],
        balances: [],
        tokens: [],
        nfts: [],
        positions: {}
      };
    },
    
    async getBalances({ address = null, chainId = null } = {}) {
      try {
        if (walletService?.getBalances) {
          return await walletService.getBalances({ address, chainId });
        }
        // Fallback to mock from context
        return { ok: true, balances: [], dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message, dataStatus: 'unavailable' };
      }
    },
    
    async getPortfolio({ address = null } = {}) {
      try {
        if (walletService?.getPortfolio) {
          return await walletService.getPortfolio({ address });
        }
        return { ok: true, holdings: [], totalValueUsd: null, dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message, dataStatus: 'unavailable' };
      }
    },
    
    async getNFTs({ address = null } = {}) {
      try {
        if (walletService?.getNFTs) return await walletService.getNFTs({ address });
        return { ok: true, nfts: [], dataStatus: 'unavailable' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async getPositions({ address = null } = {}) {
      // LP, Farms, Lending, Borrowing, Orders, Futures
      try {
        const results = await Promise.allSettled([
          walletService?.getLendingPositions?.({ address }),
          walletService?.getBorrowingPositions?.({ address }),
          walletService?.getFarmingPositions?.({ address }),
          walletService?.getStakingPositions?.({ address }),
          walletService?.getOrders?.({ address }),
          walletService?.getFuturesPositions?.({ address })
        ]);
        
        return {
          ok: true,
          lending: results[0].status === 'fulfilled' ? results[0].value : [],
          borrowing: results[1].status === 'fulfilled' ? results[1].value : [],
          farming: results[2].status === 'fulfilled' ? results[2].value : [],
          staking: results[3].status === 'fulfilled' ? results[3].value : [],
          orders: results[4].status === 'fulfilled' ? results[4].value : [],
          futures: results[5].status === 'fulfilled' ? results[5].value : []
        };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    
    async handleIntent(intent, context = {}) {
      const wallet = context.wallet || await this.getContext(context.walletState);
      
      if (!wallet.connected) {
        return {
          ok: false,
          requiresWallet: true,
          message: 'کیف پول متصل نیست',
          ui: { type: 'CONNECT_WALLET' }
        };
      }
      
      if (intent.type === 'WALLET_BALANCE') {
        const balances = await this.getBalances();
        return { ok: true, balances, wallet };
      }
      
      return { ok: true, wallet };
    }
  };
}

export const walletAgent = createWalletAgent();
