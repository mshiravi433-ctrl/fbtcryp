/**
 * FBT INTENT AI OS — unified tool registry.
 * ---------------------------------------------------------------------------
 * One explicit list of every capability the AI gateway can route to. The AI
 * engine picks from this registry instead of owning a separate set of "agents"
 * for wallets, swaps, bridges, farms, lending, futures, stocks and goals.
 *
 * `kind` says what the tool does; `route` is the real FBT API/surface that
 * owns the data. A tool is never a fake function and never a hard-coded
 * balance/price/hash — if the underlying service is unavailable it reports
 * `unavailable` and the chat says so.
 */

export const AI_TOOL_SCHEMA = 'fbt.ai-tool-registry.v1';

export const AI_TOOLS = Object.freeze([
  Object.freeze({ id: 'getPortfolio', kind: 'read', scope: 'portfolio', route: '/v1/ai/context', live: true }),
  Object.freeze({ id: 'getWalletBalances', kind: 'read', scope: 'wallet', route: '/v1/ai/context', live: true }),
  Object.freeze({ id: 'getTokenPrice', kind: 'read', scope: 'market', route: '/v1/market', live: true }),
  Object.freeze({ id: 'getSwapQuote', kind: 'quote', scope: 'swap', route: '/swap', live: true }),
  Object.freeze({ id: 'executeSwap', kind: 'execute', scope: 'swap', route: '/swap', live: true, requiresSignature: true }),
  Object.freeze({ id: 'getBridgeQuote', kind: 'quote', scope: 'bridge', route: '/bridge', live: true }),
  Object.freeze({ id: 'executeBridge', kind: 'execute', scope: 'bridge', route: '/bridge', live: true, requiresSignature: true }),
  Object.freeze({ id: 'sendTransaction', kind: 'execute', scope: 'send', route: '/wallet', live: true, requiresSignature: true }),
  Object.freeze({ id: 'getFarmOpportunities', kind: 'read', scope: 'farm', route: '/api/yields', live: true }),
  Object.freeze({ id: 'farm', kind: 'read', scope: 'farm', route: '/farm', live: true }),
  Object.freeze({ id: 'farm_analysis', kind: 'read', scope: 'farm', route: '/api/yields', live: true }),
  Object.freeze({ id: 'farm_scan', kind: 'read', scope: 'farm', route: '/api/yields', live: true }),
  Object.freeze({ id: 'farm_recommend', kind: 'read', scope: 'farm', route: '/api/yields', live: true }),
  Object.freeze({ id: 'pool', kind: 'read', scope: 'pool', route: '/farm?tab=pools', live: true }),
  Object.freeze({ id: 'pool_analysis', kind: 'read', scope: 'pool', route: '/api/yields', live: true }),
  Object.freeze({ id: 'yield', kind: 'read', scope: 'yield', route: '/farm', live: true }),
  Object.freeze({ id: 'yield_compare', kind: 'read', scope: 'yield', route: '/api/yields', live: true }),
  Object.freeze({ id: 'yield_optimize', kind: 'read', scope: 'yield', route: '/api/yields', live: true }),
  Object.freeze({ id: 'yield_strategy', kind: 'read', scope: 'yield', route: '/farm?tab=strategies', live: true }),
  // Registered execution intents remain explicitly unavailable until a
  // protocol adapter can prepare, simulate and verify real calldata.
  ...['farm_deposit', 'farm_withdraw', 'farm_claim', 'farm_compound', 'pool_add_liquidity',
    'pool_remove_liquidity', 'pool_stake', 'pool_unstake'].map((id) => Object.freeze({
      id, kind: 'execute', scope: id.startsWith('pool_') ? 'pool' : 'farm', route: '/farm?tab=pools',
      live: false, status: 'UNAVAILABLE', requiresSignature: true, requiresVerifiedAdapter: true
    })),
  Object.freeze({ id: 'getLendingOpportunities', kind: 'read', scope: 'lending', route: '/loan', live: true }),
  Object.freeze({ id: 'getFuturesMarkets', kind: 'read', scope: 'futures', route: '/perp?tab=onchain', live: true }),
  Object.freeze({ id: 'getStockMarkets', kind: 'read', scope: 'stocks', route: '/stocks', live: true }),
  Object.freeze({ id: 'createIntent', kind: 'write', scope: 'intent', route: '/intent', live: true }),
  /*
   * FBT Launch — the AI plans a token launch and hands the user a prefilled
   * /launch deep link. It is `quote`-kind on purpose: the tool produces a
   * PLAN, and the only execution path is the launch module where the user
   * reviews the deterministic risk score and signs every step in their own
   * wallet. The AI never signs, and the launch module never skips the user.
   */
  Object.freeze({ id: 'launch.plan', kind: 'quote', scope: 'launch', route: '/launch', live: true, requiresSignature: true }),
  Object.freeze({ id: 'launch.create_token', kind: 'execute', scope: 'launch', route: '/launch', live: false, status: 'MODULE_OWNED', requiresSignature: true, note: 'Execution happens inside the /launch module (state machine + user wallet), not through the AI' }),
  Object.freeze({ id: 'getIntent', kind: 'read', scope: 'intent', route: '/v1/ai/context', live: true }),
  Object.freeze({ id: 'createDCA', kind: 'write', scope: 'automation', route: '/v1/ai/automations', live: true }),
  Object.freeze({ id: 'createFinancialGoal', kind: 'write', scope: 'goal', route: '/v1/ai/goal', live: true }),
  Object.freeze({ id: 'rebalancePortfolio', kind: 'execute', scope: 'portfolio', route: '/portfolio', live: true, requiresSignature: true }),
  Object.freeze({ id: 'getSignals', kind: 'read', scope: 'signals', route: '/signals', live: true }),
  Object.freeze({ id: 'getMarketAnalysis', kind: 'read', scope: 'research', route: '/v1/ai/chat', live: true }),
  /*
   * FeeRouter status — the AI's answer to «کارمزد از FeeRouter رد میشه؟» /
   * "is the fee going through the contract?". Read-only: per-chain deployed
   * addresses, the live on-chain check (code + feeBps/feeRecipient/owner),
   * the committed bytecode hash and the honest audit disclosure. The route
   * is the server endpoint that owns the data, so the tool can never drift
   * from it.
   */
  Object.freeze({ id: 'feeRouter.status', kind: 'read', scope: 'fees', route: '/api/fees/router-status', live: true })
]);

export const listAiTools = () => AI_TOOLS.map((t) => ({ ...t }));

export const findAiTool = (id) => AI_TOOLS.find((t) => t.id === id) || null;
