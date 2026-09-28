/* Deterministic explorer-shaped receipts — used by FIOS, Signals, Intent and
 * consensus probes. No whale transfer is mistaken for a paired swap. */
import { analyzePerformance, USD_QUOTES } from '../../server/smartMoney/performance.js';
import { buildConsensus } from '../../server/smartMoney/consensus.js';

export const TOKEN = '0x1111111111111111111111111111111111111111';
const DAY = 86_400_000;

export function walletReceipts(wallet, { now = Date.now(), buyRecently = false } = {}) {
  const stable = USD_QUOTES[1][0];
  const transfers = [], transactions = [];
  const trade = (i, time, side, usd) => {
    const hash = `0x${String(wallet).slice(2, 4).repeat(2)}${i.toString(16).padStart(60, '0')}`;
    const isBuy = side === 'BUY';
    transactions.push({ hash, success: true, method: 'swapExactTokensForTokens' });
    transfers.push({ hash, timestamp: time, direction: isBuy ? 'out' : 'in',
      from: isBuy ? wallet : undefined, to: isBuy ? undefined : wallet,
      token: { address: stable, symbol: 'USDC' }, amount: usd });
    transfers.push({ hash, timestamp: time, direction: isBuy ? 'in' : 'out',
      from: isBuy ? undefined : wallet, to: isBuy ? wallet : undefined,
      token: { address: TOKEN, symbol: 'TEST' }, amount: 1000 });
  };
  for (let i = 0; i < 5; i++) {
    const start = now - (30 - i * 3) * DAY;
    trade(i * 2, start, 'BUY', 100_000);
    trade(i * 2 + 1, start + 3_600_000, 'SELL', 120_000);
  }
  if (buyRecently) trade(12, now - 600_000, 'BUY', 1_000_000);
  else {
    trade(12, now - 2 * DAY, 'BUY', 1_000_000);
    trade(13, now - 600_000, 'SELL', 1_200_000);
  }
  return { chain: 1, address: wallet, transfers, transactions, now,
    prices: new Map([[TOKEN, { pairCreatedAt: now - 33 * DAY }]]), historyLive: true };
}

export function verifiedFixture({ now = Date.now(), window = '24h', buyRecently = false } = {}) {
  const profiles = [], swaps = [];
  for (let i = 1; i <= 3; i++) {
    const wallet = `0x${String(i).repeat(40)}`;
    const performance = analyzePerformance(walletReceipts(wallet, { now, buyRecently }));
    profiles.push({ chain: 1, address: wallet, score: performance.smartMoney.score,
      coverage: performance.smartMoney.coverage,
      closedTrades: performance.performance.closedTrades,
      realizedUsd: performance.pnl.realizedUsd,
      winRate: performance.pnl.winRate,
      qualified: performance.smartMoney.qualified, updatedAt: now - 1_000 });
    swaps.push(...performance.swaps);
  }
  const snapshot = buildConsensus({ profiles, swaps, now, indexedAt: now - 1_000,
    window, durable: true });
  return { snapshot, profiles, swaps };
}
