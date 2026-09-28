/**
 * Verified wallet performance, independent of the whale-transfer feed.
 *
 * A transfer TO a router is not a sale; a transfer FROM one is not a buy.
 * Only an explorer-confirmed transaction with BOTH sides of an ERC-20 ↔
 * allowlisted USD-stablecoin swap is admitted. USD here is the observed quote
 * amount (approximate $1 peg; gas, fees, depegs and taxes are not measured).
 * Native-asset swaps, Solana signatures, unknown quotes and incomplete pages
 * are NOT converted into fictional P&L. Never infer institution from volume.
 */
import { SMART_MONEY_SCORE, WINDOWS } from './config.js';
import { routerFor } from './registry.js';

const EVM = /^0x[a-f0-9]{40}$/;
const HASH = /^0x[a-f0-9]{64}$/;
const DAY = WINDOWS.H24;
const round = (n, d = 2) => Number(n.toFixed(d));
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const finitePositive = (n) => Number.isFinite(Number(n)) && Number(n) > 0;

// Addresses, not symbols: anyone can mint a token called "USDC". A stablecoin
// depegging is a remaining limitation, disclosed in every response.
export const USD_QUOTES = Object.freeze({
  1: ['0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '0xdac17f958d2ee523a2206206994597c13d831ec7', '0x6b175474e89094c44da98b954eedeac495271d0f'],
  56: ['0x55d398326f99059ff775485246999027b3197955', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'],
  137: ['0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', '0xc2132d05d31c914a87c6611c10748aeb04b58e8f'],
  42161: ['0xaf88d065e77c8cc2239327c5edb3a432268e5831', '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'],
  8453: ['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca'],
  10: ['0x0b2c639c533813f4aa9d7837caf62653d097ff85', '0x7f5c764cbc14f9669b88837ca1490cca17c31607', '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58'],
  43114: ['0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7']
});

/** Reconstruct matched token/quote swaps from a *single wallet's* transfers.
 * A failed tx, unknown method, ambiguous multi-asset bundle, missing quote or
 * invalid timestamp is excluded rather than interpreted as a trade. */
export function reconstructSwaps({ chain, address, transfers = [], transactions = [], now = Date.now() } = {}) {
  const me = String(address || '').toLowerCase();
  const quotes = new Set(USD_QUOTES[Number(chain)] || []);
  if (!EVM.test(me) || !quotes.size) return [];
  const txByHash = new Map((Array.isArray(transactions) ? transactions : [])
    .filter((tx) => HASH.test(String(tx.hash || '').toLowerCase()))
    .map((tx) => [String(tx.hash).toLowerCase(), tx]));
  const grouped = new Map();
  for (const tr of (Array.isArray(transfers) ? transfers : []).slice(0, 250)) {
    const hash = String(tr.hash || '').toLowerCase();
    const token = String(tr.token?.address || '').toLowerCase();
    if (!HASH.test(hash) || !EVM.test(token) || !finitePositive(tr.amount)
      || !Number.isFinite(tr.timestamp) || tr.timestamp <= 0 || tr.timestamp > now + 60_000
      || !['in', 'out'].includes(tr.direction)) continue;
    // The indexer reports from/to too; check when supplied. Do not let a
    // counterparty's transfer accidentally count as this wallet's fill.
    if ((tr.direction === 'in' && tr.to && tr.to.toLowerCase() !== me)
      || (tr.direction === 'out' && tr.from && tr.from.toLowerCase() !== me)) continue;
    if (!grouped.has(hash)) grouped.set(hash, []);
    grouped.get(hash).push({ ...tr, token: { ...tr.token, address: token } });
  }

  const swaps = [];
  for (const [hash, legs] of grouped) {
    const tx = txByHash.get(hash);
    if (tx?.success === false) continue;
    const provenDex = (tx?.to && routerFor(chain, tx.to))
      || legs.some((leg) => routerFor(chain, leg.counterparty) || leg.counterpartyKind === 'dex');
    const method = [tx?.method, ...legs.map((leg) => leg.method)].join(' ').toLowerCase();
    if (!provenDex && !/swap|unoswap|exactinput|exactoutput/i.test(method)) continue;
    const inLegs = legs.filter((l) => l.direction === 'in');
    const outLegs = legs.filter((l) => l.direction === 'out');
    const quoteIn = inLegs.filter((l) => quotes.has(l.token.address));
    const quoteOut = outLegs.filter((l) => quotes.has(l.token.address));
    const targetIn = inLegs.filter((l) => !quotes.has(l.token.address));
    const targetOut = outLegs.filter((l) => !quotes.has(l.token.address));
    // Exactly two flows, one target + one verified quote. In particular, a
    // stable-to-stable transfer and a multi-hop bundle do not imply P&L.
    if (legs.length !== 2) continue;
    const buy = quoteOut.length === 1 && targetIn.length === 1 && !quoteIn.length && !targetOut.length;
    const sell = quoteIn.length === 1 && targetOut.length === 1 && !quoteOut.length && !targetIn.length;
    if (!buy && !sell) continue;
    const target = (buy ? targetIn : targetOut)[0];
    const quote = (buy ? quoteOut : quoteIn)[0];
    if (Math.abs(target.timestamp - quote.timestamp) > 120_000) continue;
    swaps.push({
      id: `${chain}:${me}:${hash}:${target.token.address}`,
      chain: Number(chain), wallet: me, hash, timestamp: target.timestamp,
      token: target.token.address, symbol: String(target.token.symbol || '').slice(0, 24) || '???',
      side: buy ? 'BUY' : 'SELL', amount: Number(target.amount),
      valueUsd: Number(quote.amount), executionPriceUsd: Number(quote.amount) / Number(target.amount),
      quoteToken: quote.token.address, evidence: 'paired-explorer-transfers',
      // Label is evidence provenance, not a claim that the address belongs to a DEX.
      method: method.slice(0, 80)
    });
  }
  return swaps.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

/** FIFO over ONLY observed buys; incoming deposits and pre-window cost basis
 * never become zero-cost positions. Closed results are a *sample*, not a
 * wallet's lifetime P&L. `prices` and `balances` are current on-chain reads. */
export function analyzePerformance({ chain, address, transfers = [], transactions = [], prices = new Map(), balances = [],
  historyLive = false, historyTruncated = false, postExitPriceAt = null, now = Date.now() } = {}) {
  const swaps = reconstructSwaps({ chain, address, transfers, transactions, now });
  const lots = new Map();
  const closed = [];
  let unmatchedExits = 0;
  const priceOf = (token) => prices instanceof Map ? prices.get(token) : prices?.[token];
  const balanceOf = new Map((Array.isArray(balances) ? balances : []).map((b) => [String(b.token || '').toLowerCase(), Number(b.amount)]));
  for (const swap of swaps) {
    const queue = lots.get(swap.token) || [];
    if (swap.side === 'BUY') {
      const createdAt = priceOf(swap.token)?.pairCreatedAt;
      queue.push({ qty: swap.amount, cost: swap.valueUsd, at: swap.timestamp, symbol: swap.symbol,
        early: Number.isFinite(createdAt) && createdAt > 0 && swap.timestamp >= createdAt
          && swap.timestamp - createdAt <= 7 * DAY });
    } else {
      let remain = swap.amount;
      let matched = 0;
      let costUsd = 0;
      let holdingDays = 0;
      let earlyCost = 0;
      while (remain > 1e-9 && queue.length) {
        const lot = queue[0];
        const take = Math.min(remain, lot.qty);
        const cost = lot.cost * (take / lot.qty);
        costUsd += cost;
        if (lot.early) earlyCost += cost;
        holdingDays += take * (swap.timestamp - lot.at) / DAY;
        matched += take;
        remain -= take;
        lot.qty -= take;
        lot.cost -= cost;
        if (lot.qty <= 1e-9) queue.shift();
      }
      if (remain > 1e-9) unmatchedExits++;
      if (matched > 1e-9 && costUsd > 0) {
        const proceedsUsd = swap.valueUsd * (matched / swap.amount);
        const pnlUsd = proceedsUsd - costUsd;
        let exitTiming = null;
        if (typeof postExitPriceAt === 'function' && now - swap.timestamp >= 7 * DAY) {
          const after = postExitPriceAt(swap.token, swap.timestamp + 7 * DAY);
          if (finitePositive(after)) exitTiming = clamp(0.5 + (swap.executionPriceUsd - after) / swap.executionPriceUsd);
        }
        closed.push({ token: swap.token, symbol: swap.symbol, at: swap.timestamp, hash: swap.hash,
          qty: matched, costUsd, proceedsUsd, pnlUsd, roiPct: (pnlUsd / costUsd) * 100,
          holdingDays: holdingDays / matched, early: earlyCost > 0, exitTiming });
      }
    }
    lots.set(swap.token, queue);
  }

  const realized = closed.reduce((sum, c) => sum + c.pnlUsd, 0);
  const invested = closed.reduce((sum, c) => sum + c.costUsd, 0);
  const wins = closed.filter((c) => c.pnlUsd > 0).length;
  const roi = invested > 0 ? 100 * realized / invested : null;
  const winRate = closed.length ? 100 * wins / closed.length : null;
  const positions = [];
  let unrealized = 0;
  let valued = 0;
  for (const [token, queue] of lots) {
    const qty = queue.reduce((s, l) => s + l.qty, 0);
    const costUsd = queue.reduce((s, l) => s + l.cost, 0);
    if (!(qty > 1e-9)) continue;
    const px = priceOf(token)?.usd;
    // Without a current balance, the observed cost basis might have left the
    // wallet in a later transfer omitted by the limited explorer page.
    const balance = balanceOf.get(token);
    const verifiable = finitePositive(px) && Number.isFinite(balance) && balance + Math.max(qty * 1e-6, 1e-8) >= qty;
    const gain = verifiable ? qty * px - costUsd : null;
    if (gain != null) { unrealized += gain; valued++; }
    positions.push({ token, symbol: queue[0].symbol, amount: qty, costUsd: round(costUsd),
      averageEntryUsd: round(costUsd / qty, 8), unrealizedUsd: gain == null ? null : round(gain) });
  }
  const pnl = {
    dataStatus: closed.length ? 'partial' : swaps.length ? 'partial' : 'unavailable',
    reason: !historyLive ? 'NO_HISTORY' : !swaps.length ? 'NO_CONFIRMED_SWAPS' : !closed.length ? 'NO_CLOSED_TRADES' : 'SAMPLED_HISTORY',
    realizedUsd: closed.length ? round(realized) : null,
    unrealizedUsd: valued ? round(unrealized) : null,
    totalUsd: closed.length ? round(realized + (valued ? unrealized : 0)) : (valued ? round(unrealized) : null),
    winRate: winRate == null ? null : round(winRate, 1), closedTrades: closed.length,
    best: closed.length ? closed.reduce((a, c) => a.pnlUsd >= c.pnlUsd ? a : c) : null,
    worst: closed.length ? closed.reduce((a, c) => a.pnlUsd <= c.pnlUsd ? a : c) : null,
    roiPct: roi == null ? null : round(roi, 1),
    note: 'Sample of paired ERC-20/stablecoin swaps in the loaded explorer page. Gas, tax and stablecoin depegs excluded; incomplete history is not lifetime P&L.'
  };

  const ret = closed.map((c) => c.roiPct / 100);
  const mean = ret.reduce((s, v) => s + v, 0) / (ret.length || 1);
  const stdev = Math.sqrt(ret.reduce((s, v) => s + (v - mean) ** 2, 0) / (ret.length || 1));
  let running = 0; let peak = 0; let maxDrawdown = 0;
  for (const c of closed) {
    running += c.pnlUsd;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }
  const earlyClosed = closed.filter((c) => c.early);
  const timed = closed.map((c) => c.exitTiming).filter((v) => v != null);
  const factors = {
    profitability: closed.length ? clamp(0.5 + Math.tanh((roi / 100) * 2) / 2) : null,
    winRate: closed.length ? wins / closed.length : null,
    earlyEntryAccuracy: earlyClosed.length >= 2 ? earlyClosed.filter((c) => c.pnlUsd > 0).length / earlyClosed.length : null,
    exitTiming: timed.length >= 2 ? timed.reduce((s, v) => s + v, 0) / timed.length : null,
    consistency: ret.length >= 5 ? clamp(1 - stdev) : null,
    capitalEfficiency: closed.length ? clamp(0.5 + Math.tanh(realized / Math.max(invested, 1)) / 2) : null,
    riskAdjustedPerformance: ret.length >= 5 ? clamp(0.5 + Math.tanh(mean / Math.max(stdev, 0.05)) / 2) : null
  };
  const weights = SMART_MONEY_SCORE.verifiedWeights;
  const covered = Object.entries(weights).filter(([key]) => factors[key] != null);
  const measuredCoverage = covered.reduce((sum, [key]) => sum + weights[key], 0);
  // A full-wallet history is not promised: if Blockscout paginates, each
  // matched *recent* closed trade remains real, but our sample confidence
  // falls. We never cost a sell whose entry is outside the loaded page.
  const coverage = measuredCoverage * (historyTruncated ? 0.9 : 1);
  const sampleDays = closed.length > 1 ? (closed.at(-1).at - closed[0].at) / DAY : 0;
  /*
   * QUALIFICATION WAS MATHEMATICALLY UNREACHABLE — the root of
   * «هوش تأییدشده اصلاً به داده‌های واقعی وصل نیست».
   *
   * With ≥5 closes the five core factors (profitability, win rate,
   * consistency, capital efficiency, risk-adjusted) always measure, which is
   * 0.70 of the weight. Early-entry accuracy and exit timing are OPTIONAL
   * extras (they need a young pool or a curated CoinGecko id). The gate used
   * to compare the *truncation-penalised* figure against 0.70 — and every
   * active trader's explorer page is paginated, so 0.70 × 0.9 = 0.63 failed
   * the gate for every real wallet, and `qualified` then demanded ≥0.75,
   * i.e. an optional factor. Only the synthetic test fixture (which happens
   * to carry an early-entry pool) could ever qualify.
   *
   * Sufficiency is now judged on MEASURED breadth — all core factors present
   * over ≥5 real closes spanning ≥2 days — while the reported `coverage`
   * still carries the pagination penalty so the UI keeps telling the truth
   * about how complete the sample is.
   */
  const coreMeasured = measuredCoverage >= 0.7 - 1e-9;
  const sufficient = closed.length >= 5 && sampleDays >= 2 && coreMeasured;
  const score = historyLive && sufficient
    ? Math.round(100 * covered.reduce((sum, [key]) => sum + factors[key] * weights[key], 0) / measuredCoverage) : null;
  const smartMoney = {
    score, coverage: round(coverage), factors,
    status: !historyLive ? 'UNAVAILABLE' : sufficient ? 'SCORED' : 'INSUFFICIENT_EVIDENCE',
    qualified: score != null && score >= 70 && realized > 0 && winRate >= 55 && coreMeasured,
    measuredCoverage: round(measuredCoverage),
    weights, sample: { swaps: swaps.length, closedTrades: closed.length, matchedExits: closed.length,
      unmatchedExits, observedDays: round(sampleDays, 1), historyTruncated, quote: 'allowlisted USD stablecoin ≈ $1' },
    note: 'Behavioural evidence score, not a probability of profit. No score without ≥5 paired closed swaps over ≥2 days; paginated history lowers coverage and unmatched cost basis is excluded.'
  };
  return {
    swaps, positions, closed: closed.slice(-40).map((c) => ({ ...c, pnlUsd: round(c.pnlUsd),
      roiPct: round(c.roiPct, 1), holdingDays: round(c.holdingDays, 1) })),
    pnl, smartMoney,
    performance: {
      realizedPnlUsd: pnl.realizedUsd, unrealizedPnlUsd: pnl.unrealizedUsd,
      roiPct: pnl.roiPct, winRate: pnl.winRate,
      averageHoldingDays: closed.length ? round(closed.reduce((s, c) => s + c.holdingDays, 0) / closed.length, 1) : null,
      trades: swaps.length, closedTrades: closed.length,
      tradeFrequencyPerDay: swaps.length > 1 ? round(swaps.length / Math.max(1, (swaps.at(-1).timestamp - swaps[0].timestamp) / DAY)) : null,
      sharpeLike: ret.length >= 5 ? round(mean / Math.max(stdev, 0.05)) : null,
      maxDrawdownPct: invested > 0 ? round(maxDrawdown / invested * 100, 1) : null,
      earlyEntryRate: swaps.filter((s) => s.side === 'BUY').length
        ? round(100 * swaps.filter((s) => s.side === 'BUY' && Number.isFinite(priceOf(s.token)?.pairCreatedAt)
          && s.timestamp >= priceOf(s.token).pairCreatedAt && s.timestamp - priceOf(s.token).pairCreatedAt <= 7 * DAY).length
          / swaps.filter((s) => s.side === 'BUY').length, 1) : null,
      exitTiming: timed.length >= 2 ? round(100 * factors.exitTiming) : null,
      averageEntry: positions.map((p) => ({ token: p.token, priceUsd: p.averageEntryUsd })),
      evidence: smartMoney.sample
    }
  };
}
