/**
 * FBT AI Collective - Strategy Proposal & Opportunity Scanner Service (ESM)
 */

const APPROVED_TOKENS = {
  USDG: { address: '0x2514d344B6F77B0aC18903e144aC6f5F31Bfa924', symbol: 'USDG', type: 'stable' },
  USDT: { address: '0xFb8E17F20BfeF16B27885b5F403d6f1D691eD0C5', symbol: 'USDT', type: 'stable' },
  NVDA: { address: '0x534606E508e6c46646b9aeb6e06cb3e0a11226c1', symbol: 'NVDA', type: 'stock' },
  TSLA: { address: '0xd7a5e999908F87353909F84742f9b8c049016158', symbol: 'TSLA', type: 'stock' },
  AAPL: { address: '0x1b1c6d3df3981F4B04Ccc3bCca77b0C2401f7c52', symbol: 'AAPL', type: 'stock' }
};

const APPROVED_ROUTERS = {
  KYBER: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
  OPEN_OCEAN: '0x6352a56caadC4F1E25CD6c75970Fa768A3304e64'
};

export class AIStrategyService {
  constructor() {
    this.history = [];
    this.riskLimits = {
      maxSlippageBps: 100, // 1%
      maxDrawdownBps: 400, // 4% stop-loss trigger
      maxSingleTradeUsd: 50000
    };
  }

  async scanOpportunities() {
    return [
      {
        id: 'stable-aave-usdg',
        vaultType: 'stable',
        name: 'Aave V3 USDG Optimizer',
        asset: 'USDG',
        projectedApy: 8.42,
        riskScore: 'Low',
        confidence: 0.94,
        status: 'active'
      },
      {
        id: 'farm-hood-usdg',
        vaultType: 'farming',
        name: 'Robinhood DEX HOOD/USDG LP',
        asset: 'HOOD-USDG',
        projectedApy: 22.8,
        riskScore: 'Medium',
        confidence: 0.88,
        status: 'active'
      },
      {
        id: 'stock-nvda-momentum',
        vaultType: 'stock_trading',
        name: 'AI Momentum NVDA Equities',
        asset: 'NVDA',
        projectedApy: 18.5,
        riskScore: 'Medium',
        confidence: 0.86,
        status: 'active'
      }
    ];
  }

  evaluateStopLoss(position) {
    const { symbol, entryPrice, currentPrice, amount } = position;
    const priceRatio = currentPrice / entryPrice;
    const lossBps = Math.round((1 - priceRatio) * 10000);

    if (lossBps >= this.riskLimits.maxDrawdownBps) {
      return {
        action: 'ROTATE_TO_SAFETY',
        reason: `Stop-loss triggered: Drawdown ${lossBps / 100}% exceeded limit ${this.riskLimits.maxDrawdownBps / 100}%`,
        tokenIn: APPROVED_TOKENS[symbol]?.address,
        tokenOut: APPROVED_TOKENS.USDT.address,
        amountIn: amount,
        urgent: true
      };
    }

    return {
      action: 'HOLD',
      currentProfitBps: -lossBps
    };
  }

  generateTradeProposal({ vault, tokenIn, tokenOut, amountIn, expectedPrice }) {
    const slippageFactor = 1 - (this.riskLimits.maxSlippageBps / 10000);
    const minAmountOut = (amountIn * expectedPrice * slippageFactor).toFixed(6);

    const proposal = {
      proposalId: `prop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      vault,
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
      targetRouter: APPROVED_ROUTERS.KYBER,
      createdAt: Math.floor(Date.now() / 1000),
      deadline: Math.floor(Date.now() / 1000) + 1800,
      aiSignature: `0x_ai_sig_${Date.now()}`
    };

    this.history.unshift(proposal);
    if (this.history.length > 50) this.history.pop();
    return proposal;
  }

  getProposals() {
    return this.history;
  }
}

const aiStrategyService = new AIStrategyService();
export default aiStrategyService;
