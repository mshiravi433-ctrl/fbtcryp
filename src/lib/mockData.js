// Placeholder data so the UI is demoable immediately.
// Replace with real calls to your sentiment/price-prediction service and
// BscScan / on-chain balance reads for the portfolio screen.

export const marketPulse = {
  sentimentScore: 0.62, // -1..1
  label: 'bullish',
  topMovers: [
    { symbol: 'BNB', changePct: 4.8 },
    { symbol: 'CAKE', changePct: -2.1 },
    { symbol: 'ETH', changePct: 1.3 }
  ]
};

export const aiAnalysis = {
  BNB: {
    sentiment: { label: 'bullish', score: 0.71, sources: 128 },
    prediction: { horizon: '24h', changePct: 3.2, confidence: 0.64 }
  }
};

export const mockPortfolio = {
  totalUsd: 1842.37,
  assets: [
    { symbol: 'BNB', amount: 2.14, usd: 1310.2 },
    { symbol: 'CAKE', amount: 340, usd: 312.1 },
    { symbol: 'USDT', amount: 220, usd: 220.07 }
  ]
};
