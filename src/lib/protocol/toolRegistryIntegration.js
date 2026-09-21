/**
 * FBT INTENT PROTOCOL — TOOL REGISTRY INTEGRATION
 * ---------------------------------------------------------------------------
 * Spec §22: Integrate Intent OS with the existing FBT Tool Registry.
 * Exposes dynamic discovery of protocol capabilities for the AI layer.
 */

export const PROTOCOL_TOOLS = Object.freeze([
  {
    name: 'intent.swap',
    description: 'Execute guaranteed same-chain swap via solver competition with strict minAmountOut enforcement',
    riskLevel: 'LOW',
    requiredPermissions: ['WALLET_SIGNATURE'],
    supportedChains: [1, 10, 56, 137, 146, 8453, 42161, 43114, 59144, 501],
    simulationSupport: true,
    executionSupport: true,
    verificationSupport: true,
    inputSchema: {
      type: 'object',
      required: ['sourceAsset', 'destinationAsset', 'amount', 'minAmountOut'],
      properties: {
        sourceAsset: { type: 'string' },
        destinationAsset: { type: 'string' },
        amount: { type: 'string' },
        minAmountOut: { type: 'string' },
        maxSlippageBps: { type: 'number', default: 50 }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        intentId: { type: 'string' },
        receiptId: { type: 'string' },
        amountOut: { type: 'string' },
        transactionHash: { type: 'string' }
      }
    }
  },
  {
    name: 'intent.bridge',
    description: 'Execute cross-chain outcome without manual step configuration',
    riskLevel: 'MEDIUM',
    requiredPermissions: ['WALLET_SIGNATURE'],
    supportedChains: [1, 10, 56, 137, 8453, 42161, 43114, 501],
    simulationSupport: true,
    executionSupport: true,
    verificationSupport: true,
    inputSchema: {
      type: 'object',
      required: ['sourceChain', 'destinationChain', 'sourceAsset', 'destinationAsset', 'amount', 'minAmountOut'],
      properties: {
        sourceChain: { type: 'string' },
        destinationChain: { type: 'string' },
        sourceAsset: { type: 'string' },
        destinationAsset: { type: 'string' },
        amount: { type: 'string' },
        minAmountOut: { type: 'string' }
      }
    }
  },
  {
    name: 'intent.lend',
    description: 'Supply capital to verified money markets (Aave, Compound, Morpho)',
    riskLevel: 'LOW',
    requiredPermissions: ['WALLET_SIGNATURE'],
    supportedChains: [1, 8453, 42161],
    simulationSupport: true,
    executionSupport: true,
    verificationSupport: true
  },
  {
    name: 'intent.borrow',
    description: 'Borrow assets against collateral within conservative health factor constraints',
    riskLevel: 'MEDIUM',
    requiredPermissions: ['WALLET_SIGNATURE'],
    supportedChains: [1, 8453, 42161],
    simulationSupport: true,
    executionSupport: true,
    verificationSupport: true
  },
  {
    name: 'intent.farm',
    description: 'Yield farm and liquidity provision with automated risk scoring',
    riskLevel: 'MEDIUM',
    requiredPermissions: ['WALLET_SIGNATURE'],
    supportedChains: [1, 56, 137, 8453, 42161],
    simulationSupport: true,
    executionSupport: true,
    verificationSupport: true
  },
  {
    name: 'intent.dca',
    description: 'Schedule non-custodial recurring dollar-cost-averaging orders',
    riskLevel: 'LOW',
    requiredPermissions: ['WALLET_SIGNATURE'],
    supportedChains: [1, 8453, 42161, 501],
    simulationSupport: true,
    executionSupport: true,
    verificationSupport: true
  },
  {
    name: 'intent.limit_order',
    description: 'Create zero-gas limit orders filled by solvers when target price is met',
    riskLevel: 'LOW',
    requiredPermissions: ['WALLET_SIGNATURE'],
    supportedChains: [1, 10, 56, 137, 8453, 42161, 43114, 501],
    simulationSupport: true,
    executionSupport: true,
    verificationSupport: true
  },
  {
    name: 'intent.rwa',
    description: 'Access tokenized real-world assets (Treasury bills, private credit)',
    riskLevel: 'LOW',
    requiredPermissions: ['WALLET_SIGNATURE', 'KYC_ATTESTATION'],
    supportedChains: [1, 8453, 42161],
    simulationSupport: true,
    executionSupport: true,
    verificationSupport: true
  },
  {
    name: 'intent.rebalance',
    description: 'Multi-asset portfolio rebalancing back to target allocations',
    riskLevel: 'MEDIUM',
    requiredPermissions: ['WALLET_SIGNATURE'],
    supportedChains: [1, 8453, 42161, 501],
    simulationSupport: true,
    executionSupport: true,
    verificationSupport: true
  }
]);

export function discoverProtocolTools(query = {}) {
  return PROTOCOL_TOOLS.filter((t) => {
    if (query.chain && !t.supportedChains.includes(Number(query.chain))) return false;
    if (query.riskLevel && t.riskLevel !== query.riskLevel) return false;
    if (query.name && !t.name.includes(query.name)) return false;
    return true;
  });
}
