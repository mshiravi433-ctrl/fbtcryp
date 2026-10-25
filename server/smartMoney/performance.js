/**
 * Verified wallet performance, independent of the whale-transfer feed.
 *
 * A transfer TO a router is not a sale; a transfer FROM one is not a buy.
 * Only an explorer-confirmed transaction with BOTH sides of an ERC-20 swap is
 * admitted. Stablecoin USD is the observed quote amount (approximate $1 peg;
 * gas, fees, depegs and taxes are not measured). Wrapped-native swaps join
 * the same ledger only under the phase-4 all-candidates-hourly-priced gate.
 * Solana signatures, unknown quotes and incomplete pages are NOT converted
 * into fictional P&L here. Never infer institution from volume.
 */
import { EVM_CHAINS } from '../chainsLite.js';
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

function transactionMap(transactions) {
  return new Map((Array.isArray(transactions) ? transactions : [])
    .filter((tx) => HASH.test(String(tx.hash || '').toLowerCase()))
    .map((tx) => [String(tx.hash).toLowerCase(), tx]));
}

function groupWalletLegs({ address, transfers = [], now = Date.now() } = {}) {
  const me = String(address || '').toLowerCase();
  const grouped = new Map();
  if (!EVM.test(me)) return grouped;
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
  return grouped;
}

function provenSwapMethod({ chain, hash, legs, txByHash }) {
  const tx = txByHash.get(hash);
  if (tx?.success === false) return null;
  const provenDex = (tx?.to && routerFor(chain, tx.to))
    || legs.some((leg) => routerFor(chain, leg.counterparty) || leg.counterpartyKind === 'dex');
  const method = [tx?.method, ...legs.map((leg) => leg.method)].join(' ').toLowerCase();
  if (!provenDex && !/swap|unoswap|exactinput|exactoutput/i.test(method)) return null;
  return method;
}

/** Reconstruct matched token/quote swaps from a *single wallet's* transfers.
 * A failed tx, unknown method, ambiguous multi-asset bundle, missing quote or
 * invalid timestamp is excluded rather than interpreted as a trade. */
export function reconstructSwaps({ chain, address, transfers = [], transactions = [], now = Date.now() } = {}) {
  const me = String(address || '').toLowerCase();
  const quotes = new Set(USD_QUOTES[Number(chain)] || []);
  if (!EVM.test(me) || !quotes.size) return [];
  const txByHash = transactionMap(transactions);
  const grouped = groupWalletLegs({ address: me, transfers, now });

  const swaps = [];
  for (const [hash, legs] of grouped) {
    const method = provenSwapMethod({ chain, hash, legs, txByHash });
    if (method == null) continue;
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
      quoteToken: quote.token.address, quoteKind: 'allowlisted-usd-stablecoin',
      quoteSymbol: String(quote.token.symbol || 'USD').slice(0, 24), quoteAmount: Number(quote.amount),
      evidence: 'paired-explorer-transfers', classification: 'verified',
      admission: 'verified-score-and-consensus',
      // Label is evidence provenance, not a claim that the address belongs to a DEX.
      method: method.slice(0, 80)
    });
  }
  return swaps.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

const MAX_NATIVE_PRICE_DISTANCE_MS = 3_600_000;
const ACCEPTED_NATIVE_PRICE_GRANULARITIES = new Set([
  '1h', 'hour', 'hourly', '5m', '5min', '5-minute', 'minute', 'minutely', 'intraday'
]);

function nativePricePoint(priceAt, timestamp) {
  if (typeof priceAt !== 'function') return null;
  let raw;
  try { raw = priceAt(timestamp); } catch { return null; }
  // A bare number carries no time provenance. In particular, the existing
  // daily historical lookup must never acquire hourly authority by accident.
  if (!raw || typeof raw !== 'object') return null;
  const usd = Number(raw.usd ?? raw.priceUsd ?? raw.price);
  const at = Number(raw.at ?? raw.ts ?? raw.timestamp);
  const granularity = String(raw.granularity || '').toLowerCase();
  if (!finitePositive(usd) || !Number.isFinite(at) || at <= 0) return null;
  if (Math.abs(at - timestamp) > MAX_NATIVE_PRICE_DISTANCE_MS) return null;
  if (!ACCEPTED_NATIVE_PRICE_GRANULARITIES.has(granularity)) return null;
  return {
    usd,
    at,
    granularity,
    source: String(raw.source || 'timestamped-intraday-price').slice(0, 80)
  };
}

export const NATIVE_PRICE_GRANULARITIES = Object.freeze([...ACCEPTED_NATIVE_PRICE_GRANULARITIES]);

/**
 * A native-quote row is only *priced* when its stored provenance can be
 * revalidated without trusting the row's own labels: accepted intraday
 * granularity, a point no more than one hour from the fill, and a USD value
 * that still reconciles with quoteAmount × quotePriceUsd (allowing only the
 * two-decimal rounding applied at reconstruction). Index rows are persisted
 * JSON, so consumers must be able to reject a stale or tampered replay.
 */
export function isPricedNativeQuoteSwap(swap) {
  if (!swap || swap.evidence !== 'paired-native-quote-explorer-transfers') return false;
  const timestamp = Number(swap.timestamp);
  const quoteAmount = Number(swap.quoteAmount);
  const quotePriceUsd = Number(swap.quotePriceUsd);
  const quotePriceAt = Number(swap.quotePriceAt);
  const valueUsd = Number(swap.valueUsd);
  const executionPriceUsd = Number(swap.executionPriceUsd);
  const amount = Number(swap.amount);
  if (!Number.isFinite(timestamp) || timestamp <= 0
    || !finitePositive(quoteAmount) || !finitePositive(quotePriceUsd) || !finitePositive(amount)
    || !Number.isFinite(quotePriceAt) || Math.abs(quotePriceAt - timestamp) > MAX_NATIVE_PRICE_DISTANCE_MS
    || !ACCEPTED_NATIVE_PRICE_GRANULARITIES.has(String(swap.quotePriceGranularity || '').toLowerCase())
    || !finitePositive(valueUsd) || !finitePositive(executionPriceUsd)) return false;
  const expectedUsd = quoteAmount * quotePriceUsd;
  const roundingTolerance = Math.max(0.011, expectedUsd * 1e-9);
  return Math.abs(valueUsd - expectedUsd) <= roundingTolerance
    && Math.abs(executionPriceUsd * amount - expectedUsd) <= roundingTolerance;
}

/**
 * The single admission predicate for persisted verified swap rows.
 *
 * Legacy stablecoin rows predate classification fields and remain admissible
 * on their original evidence string. Native rows require BOTH the phase-4
 * promotion labels and revalidatable hourly pricing; a priced phase-3
 * observation therefore still cannot vote. The Solana branch is intentionally
 * present but dormant in production: no producer sets those labels yet, so
 * merely decoding a Solana balance delta can never satisfy it.
 */
export function isVerifiedPairedSwap(swap) {
  if (!swap || !['BUY', 'SELL'].includes(swap.side)
    || !finitePositive(swap.amount) || !finitePositive(swap.valueUsd)
    || !Number.isFinite(Number(swap.timestamp)) || Number(swap.timestamp) <= 0) return false;
  if (swap.evidence === 'paired-explorer-transfers') {
    return swap.classification == null || swap.classification === 'verified';
  }
  if (swap.evidence === 'paired-native-quote-explorer-transfers') {
    return swap.classification === 'verified'
      && swap.admission === 'verified-score-and-consensus'
      && isPricedNativeQuoteSwap(swap);
  }
  if (swap.evidence === 'decoded-solana-token-balance-deltas') {
    return swap.classification === 'verified'
      && swap.admission === 'verified-score-and-consensus'
      && swap.decodeMethod === 'instruction-corroborated-token-balance-deltas'
      && swap.instructionCorroborated === true;
  }
  return false;
}

/**
 * Phase 3 — wrapped-native quote pairs as OBSERVED-ONLY evidence.
 *
 * The transfer pairing is deliberately as strict as the verified ledger:
 * one successful/proven DEX transaction, exactly two wallet legs, opposite
 * directions, one canonical wrapped-native contract from chainsLite and one
 * non-stable target. What remains weaker is valuation and sample meaning:
 * the wrapped-native amount needs an external price at transaction time, and
 * these rows are not yet a second verified P&L ledger. They therefore carry a
 * different evidence string and classification, and are never returned by
 * `reconstructSwaps`/`analyzePerformance`.
 *
 * `priceAt` must return `{usd, at, granularity, source}` from an hourly-or-
 * finer series, with the point within one hour of the swap. Without that
 * proof the real native amount is still observable, but USD fields stay null.
 */
export function reconstructNativeQuoteSwaps({ chain, address, transfers = [], transactions = [], priceAt = null, now = Date.now() } = {}) {
  const chainId = Number(chain);
  const me = String(address || '').toLowerCase();
  const chainMeta = EVM_CHAINS[chainId];
  const wrapped = String(chainMeta?.wrapped || '').toLowerCase();
  const stables = new Set(USD_QUOTES[chainId] || []);
  if (!EVM.test(me) || !EVM.test(wrapped) || !stables.size) return [];
  const txByHash = transactionMap(transactions);
  const grouped = groupWalletLegs({ address: me, transfers, now });
  const swaps = [];

  for (const [hash, legs] of grouped) {
    if (legs.length !== 2) continue;
    const method = provenSwapMethod({ chain: chainId, hash, legs, txByHash });
    if (method == null) continue;
    const nativeLegs = legs.filter((l) => l.token.address === wrapped);
    const targets = legs.filter((l) => l.token.address !== wrapped && !stables.has(l.token.address));
    if (nativeLegs.length !== 1 || targets.length !== 1) continue;
    const quote = nativeLegs[0];
    const target = targets[0];
    const buy = quote.direction === 'out' && target.direction === 'in';
    const sell = quote.direction === 'in' && target.direction === 'out';
    if (!buy && !sell) continue;
    if (Math.abs(target.timestamp - quote.timestamp) > 120_000) continue;

    const quoteAmount = Number(quote.amount);
    const targetAmount = Number(target.amount);
    const price = nativePricePoint(priceAt, target.timestamp);
    const valueUsd = price ? quoteAmount * price.usd : null;
    swaps.push({
      id: `${chainId}:${me}:${hash}:${target.token.address}:native-quote`,
      chain: chainId, wallet: me, hash, timestamp: target.timestamp,
      token: target.token.address, symbol: String(target.token.symbol || '').slice(0, 24) || '???',
      side: buy ? 'BUY' : 'SELL', amount: targetAmount,
      valueUsd: valueUsd == null ? null : round(valueUsd),
      executionPriceUsd: valueUsd == null ? null : valueUsd / targetAmount,
      quoteToken: wrapped,
      quoteKind: 'wrapped-native',
      quoteSymbol: String(quote.token.symbol || chainMeta?.native?.symbol || 'NATIVE').slice(0, 24),
      quoteAmount,
      quotePriceUsd: price?.usd ?? null,
      quotePriceAt: price?.at ?? null,
      quotePriceGranularity: price?.granularity ?? null,
      quotePriceSource: price?.source ?? null,
      evidence: 'paired-native-quote-explorer-transfers',
      classification: 'observed-only',
      admission: 'excluded-from-verified-score-and-consensus',
      method: method.slice(0, 80)
    });
  }
  return swaps.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

const tokenKey = (token) => {
  const value = String(token || '');
  // EVM addresses are case-insensitive; Solana mints are not. Lowercasing a
  // mint here would silently merge different assets in the shared FIFO core.
  return /^0x[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : value;
};
const priceEntries = (prices) => prices instanceof Map ? prices.entries()
  : prices && typeof prices === 'object' ? Object.entries(prices) : [];
const marketPriceUsd = (market) => Number(market?.usd ?? market?.priceUsd ?? market?.price);

/**
 * Shared FIFO/scoring core over swaps the caller has already admitted.
 *
 * This function deliberately does NOT decide evidentiary admission: EVM
 * stable/native promotion happens in `analyzePerformance`, while a future
 * Solana admission must happen before its rows reach here. It does fail
 * closed on malformed or duplicated rows — running FIFO over a convenient
 * subset would manufacture cost basis and exits that were never observed.
 * Closed results remain a sample, never lifetime wallet P&L.
 */
export function analyzeSwapLedger({ swaps: inputSwaps = [], prices = new Map(), balances = [],
  historyLive = false, historyTruncated = false, postExitPriceAt = null, now = Date.now(),
  quoteSummary = 'allowlisted USD stablecoin ≈ $1', sampleExtra = {},
  pnlNote = 'Sample of paired swaps in the loaded history page. Gas, tax and quote-asset depegs excluded; incomplete history is not lifetime P&L.' } = {}) {
  const seenSwapIds = new Set();
  let invalidSwaps = 0;
  const normalizedSwaps = [];
  for (const raw of (Array.isArray(inputSwaps) ? inputSwaps : [])) {
    const token = String(raw?.token || '');
    const amount = Number(raw?.amount);
    const valueUsd = Number(raw?.valueUsd);
    const timestamp = Number(raw?.timestamp);
    const executionPriceUsd = Number(raw?.executionPriceUsd ?? (finitePositive(amount) && finitePositive(valueUsd)
      ? valueUsd / amount : NaN));
    const identity = String(raw?.id || `${raw?.chain}:${raw?.wallet}:${raw?.hash}:${token}:${raw?.side}:${timestamp}`);
    if (!token || !['BUY', 'SELL'].includes(raw?.side) || !finitePositive(amount)
      || !finitePositive(valueUsd) || !finitePositive(executionPriceUsd)
      || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now + 60_000
      || seenSwapIds.has(identity)) {
      invalidSwaps++;
      continue;
    }
    seenSwapIds.add(identity);
    normalizedSwaps.push({ ...raw, token, amount, valueUsd, timestamp, executionPriceUsd });
  }
  const swaps = invalidSwaps ? [] : normalizedSwaps
    .sort((a, b) => a.timestamp - b.timestamp || String(a.id || '').localeCompare(String(b.id || '')));
  const lots = new Map();
  const closed = [];
  let unmatchedExits = 0;
  const priceByToken = new Map([...priceEntries(prices)].map(([token, market]) => [tokenKey(token), market]));
  const priceOf = (token) => priceByToken.get(tokenKey(token));
  const balanceOf = new Map();
  for (const balance of (Array.isArray(balances) ? balances : [])) {
    const key = tokenKey(balance?.token);
    const amount = Number(balance?.amount);
    if (!key || !Number.isFinite(amount)) continue;
    balanceOf.set(key, (balanceOf.get(key) || 0) + amount);
  }
  for (const swap of swaps) {
    const key = tokenKey(swap.token);
    const queue = lots.get(key) || [];
    if (swap.side === 'BUY') {
      const createdAt = Number(priceOf(swap.token)?.pairCreatedAt);
      queue.push({ token: swap.token, qty: swap.amount, cost: swap.valueUsd, at: swap.timestamp,
        symbol: swap.symbol, evidence: swap.evidence || null,
        early: Number.isFinite(createdAt) && createdAt > 0 && swap.timestamp >= createdAt
          && swap.timestamp - createdAt <= 7 * DAY });
    } else {
      let remain = swap.amount;
      let matched = 0;
      let costUsd = 0;
      let holdingDays = 0;
      let earlyCost = 0;
      const entryEvidence = new Set();
      while (remain > 1e-9 && queue.length) {
        const lot = queue[0];
        const take = Math.min(remain, lot.qty);
        const cost = lot.cost * (take / lot.qty);
        costUsd += cost;
        if (lot.early) earlyCost += cost;
        if (lot.evidence) entryEvidence.add(lot.evidence);
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
          try {
            const after = postExitPriceAt(swap.token, swap.timestamp + 7 * DAY);
            if (finitePositive(after)) exitTiming = clamp(0.5 + (swap.executionPriceUsd - after) / swap.executionPriceUsd);
          } catch { /* an optional timing lookup cannot invalidate the fill */ }
        }
        closed.push({ token: swap.token, symbol: swap.symbol, at: swap.timestamp, hash: swap.hash,
          qty: matched, costUsd, proceedsUsd, pnlUsd, roiPct: (pnlUsd / costUsd) * 100,
          holdingDays: holdingDays / matched, early: earlyCost > 0, exitTiming,
          entryEvidence: [...entryEvidence], exitEvidence: swap.evidence || null });
      }
    }
    lots.set(key, queue);
  }

  const realized = closed.reduce((sum, c) => sum + c.pnlUsd, 0);
  const invested = closed.reduce((sum, c) => sum + c.costUsd, 0);
  const wins = closed.filter((c) => c.pnlUsd > 0).length;
  const roi = invested > 0 ? 100 * realized / invested : null;
  const winRate = closed.length ? 100 * wins / closed.length : null;
  const positions = [];
  let unrealized = 0;
  let valued = 0;
  for (const [key, queue] of lots) {
    const qty = queue.reduce((s, l) => s + l.qty, 0);
    const costUsd = queue.reduce((s, l) => s + l.cost, 0);
    if (!(qty > 1e-9)) continue;
    const token = queue[0].token || key;
    const px = marketPriceUsd(priceOf(token));
    // Without a current balance, the observed cost basis might have left the
    // wallet in a later transfer omitted by the limited history page.
    const balance = balanceOf.get(key);
    const verifiable = finitePositive(px) && Number.isFinite(balance) && balance + Math.max(qty * 1e-6, 1e-8) >= qty;
    const gain = verifiable ? qty * px - costUsd : null;
    if (gain != null) { unrealized += gain; valued++; }
    positions.push({ token, symbol: queue[0].symbol, amount: qty, costUsd: round(costUsd),
      averageEntryUsd: round(costUsd / qty, 8), unrealizedUsd: gain == null ? null : round(gain) });
  }
  const pnl = {
    dataStatus: closed.length ? 'partial' : swaps.length ? 'partial' : 'unavailable',
    reason: invalidSwaps ? 'INVALID_LEDGER_ROWS' : !historyLive ? 'NO_HISTORY' : !swaps.length ? 'NO_CONFIRMED_SWAPS' : !closed.length ? 'NO_CLOSED_TRADES' : 'SAMPLED_HISTORY',
    realizedUsd: closed.length ? round(realized) : null,
    unrealizedUsd: valued ? round(unrealized) : null,
    totalUsd: closed.length ? round(realized + (valued ? unrealized : 0)) : (valued ? round(unrealized) : null),
    winRate: winRate == null ? null : round(winRate, 1), closedTrades: closed.length,
    best: closed.length ? closed.reduce((a, c) => a.pnlUsd >= c.pnlUsd ? a : c) : null,
    worst: closed.length ? closed.reduce((a, c) => a.pnlUsd <= c.pnlUsd ? a : c) : null,
    roiPct: roi == null ? null : round(roi, 1),
    note: pnlNote
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
  const avgHoldingDays = closed.length
    ? closed.reduce((s, c) => s + c.holdingDays, 0) / closed.length : null;
  const factors = {
    profitability: closed.length ? clamp(0.5 + Math.tanh((roi / 100) * 2) / 2) : null,
    winRate: closed.length ? wins / closed.length : null,
    earlyEntryAccuracy: earlyClosed.length >= 2 ? earlyClosed.filter((c) => c.pnlUsd > 0).length / earlyClosed.length : null,
    exitTiming: timed.length >= 2 ? timed.reduce((s, v) => s + v, 0) / timed.length : null,
    consistency: ret.length >= 5 ? clamp(1 - stdev) : null,
    /* CAPITAL EFFICIENCY, DE-DUPLICATED (phase 2, 2026-10-25).
     * The old factor was `tanh(realized/invested)` — tanh(ROI) — i.e. the
     * profitability factor `tanh(2·ROI)` wearing a second hat, so 0.35 of the
     * score's weight voted twice on one signal and a wallet that took 180
     * days to make +20% scored the same "efficiency" as one that made it in
     * a day. Efficiency is return PER UNIT TIME capital was deployed:
     * ROI scaled to a 30-day deployment. The 30-day hold is the anchor — at
     * exactly 30 days average holding the value is IDENTICAL to the old
     * factor, so existing scores drift only where holding time genuinely
     * differs. Sub-day holds are floored to 1 day: fees and slippage are
     * unmeasured here, and a per-minute rate would crown churn. */
    capitalEfficiency: closed.length && avgHoldingDays != null
      ? clamp(0.5 + Math.tanh((realized / Math.max(invested, 1)) * (30 / Math.max(avgHoldingDays, 1))) / 2)
      : null,
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
    status: !historyLive || invalidSwaps ? 'UNAVAILABLE' : sufficient ? 'SCORED' : 'INSUFFICIENT_EVIDENCE',
    qualified: score != null && score >= 70 && realized > 0 && winRate >= 55 && coreMeasured,
    measuredCoverage: round(measuredCoverage),
    weights, sample: { swaps: swaps.length, closedTrades: closed.length, matchedExits: closed.length,
      unmatchedExits, observedDays: round(sampleDays, 1), historyTruncated, quote: quoteSummary,
      invalidSwaps, ...(sampleExtra && typeof sampleExtra === 'object' ? sampleExtra : {}) },
    note: 'Behavioural evidence score, not a probability of profit. No score without ≥5 paired closed swaps over ≥2 days; paginated history lowers coverage and unmatched cost basis is excluded.'
  };
  return {
    swaps, invalidSwaps, positions, closed: closed.slice(-40).map((c) => ({ ...c, pnlUsd: round(c.pnlUsd),
      roiPct: round(c.roiPct, 1), holdingDays: round(c.holdingDays, 1) })),
    pnl, smartMoney,
    performance: {
      realizedPnlUsd: pnl.realizedUsd, unrealizedPnlUsd: pnl.unrealizedUsd,
      roiPct: pnl.roiPct, winRate: pnl.winRate,
      averageHoldingDays: avgHoldingDays == null ? null : round(avgHoldingDays, 1),
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

/**
 * EVM verified performance (phase 4 unified quote ledger).
 *
 * Stablecoin-quoted fills remain the original verified stream. Wrapped-
 * native candidates join that SAME FIFO queue only when every candidate in
 * the sampled transfer page has revalidatable hourly-or-finer USD pricing.
 * Promoting just the priced subset would be worse than excluding them all:
 * a priced native sell could close a stable buy while its unpriced native
 * buy vanished, or vice versa, silently reassigning cost basis. The gate is
 * therefore all-or-nothing per wallet sample. When it fails, the candidates
 * are returned separately as `nativeCandidates` for the observed layer and
 * the verified result is exactly the stable-only ledger.
 */
export function analyzePerformance({ chain, address, transfers = [], transactions = [], prices = new Map(), balances = [],
  historyLive = false, historyTruncated = false, postExitPriceAt = null, nativePriceAt = null,
  now = Date.now() } = {}) {
  const stableSwaps = reconstructSwaps({ chain, address, transfers, transactions, now });
  const nativeCandidatesRaw = reconstructNativeQuoteSwaps({
    chain, address, transfers, transactions, priceAt: nativePriceAt, now
  });
  const pricedNativeCandidates = nativeCandidatesRaw.filter(isPricedNativeQuoteSwap);
  const nativePromoted = nativeCandidatesRaw.length > 0
    && pricedNativeCandidates.length === nativeCandidatesRaw.length;
  const promotedNativeSwaps = nativePromoted
    ? pricedNativeCandidates.map((swap) => ({
      ...swap,
      classification: 'verified',
      admission: 'verified-score-and-consensus'
    }))
    : [];
  const nativePromotion = {
    status: !nativeCandidatesRaw.length ? 'no-native-candidates'
      : nativePromoted ? 'promoted-unified-ledger'
        : typeof nativePriceAt !== 'function' ? 'blocked-no-hourly-price-source'
          : 'blocked-unpriced-native-candidate',
    promoted: nativePromoted,
    candidates: nativeCandidatesRaw.length,
    pricedCandidates: pricedNativeCandidates.length,
    unpricedCandidates: nativeCandidatesRaw.length - pricedNativeCandidates.length,
    gate: 'all-sampled-native-candidates-hourly-priced'
  };
  const audit = analyzeSwapLedger({
    swaps: [...stableSwaps, ...promotedNativeSwaps],
    prices,
    balances,
    historyLive,
    historyTruncated,
    postExitPriceAt,
    now,
    quoteSummary: nativePromoted
      ? 'allowlisted USD stablecoin ≈ $1 + hourly-priced wrapped native'
      : 'allowlisted USD stablecoin ≈ $1',
    sampleExtra: {
      stableQuoteSwaps: stableSwaps.length,
      nativeQuoteSwaps: promotedNativeSwaps.length,
      nativeQuoteCandidates: nativeCandidatesRaw.length,
      nativeQuotePricedCandidates: pricedNativeCandidates.length,
      nativeQuoteUnpricedCandidates: nativeCandidatesRaw.length - pricedNativeCandidates.length,
      nativeQuotePromoted: nativePromoted
    },
    pnlNote: nativePromoted
      ? 'Sample of paired stablecoin- and hourly-priced wrapped-native-quoted swaps in the loaded explorer page. Stable USD uses the quote amount at an assumed $1 peg; native USD uses the nearest accepted hourly-or-finer price point within one hour. Gas, tax and depegs excluded; incomplete history is not lifetime P&L.'
      : 'Sample of paired ERC-20/stablecoin swaps in the loaded explorer page. Gas, tax and stablecoin depegs excluded; incomplete history is not lifetime P&L.'
  });
  return {
    ...audit,
    nativePromotion,
    // Only unpromoted candidates belong in the observed layer. Once promoted,
    // these exact rows are already in `audit.swaps`; returning them twice
    // would invite a UI or indexer to double-count the same fill.
    nativeCandidates: nativePromoted ? [] : nativeCandidatesRaw
  };
}
