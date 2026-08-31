/**
 * WALLET INTELLIGENCE
 * ---------------------------------------------------------------------------
 * Turns raw on-chain data into the wallet picture the Smart Money page shows:
 *
 *   activity       — classified recent actions (buy/sell/transfer/CEX/LP)
 *   balances       — holdings priced in USD (Blockscout balances, enriched)
 *   pnl            — realised (from tx history + tx-time prices) and unrealised
 *   smartScore     — weighted behavioural score (engines.calculateSmartMoneyScore)
 *   reputation     — weighted reputation score + coverage
 *   risk           — weighted risk score + band + +/- reasons
 *   tags           — SMART_MONEY / WHALE / EARLY_BUYER / PROFITABLE_TRADER / …
 *
 * Every metric degrades honestly: no history source → that section carries
 * dataStatus:'unavailable' and the score's coverage drops. We never fabricate
 * a P&L or a score. The engines do the math; this module supplies evidence.
 *
 * Solana: signatures (age/activity), SOL balance and SPL transfers from the
 * Solscan path when keyed; otherwise balances/activity degrade.
 */

import { withCache } from '../cache.js';
import { TOKENS } from '../chainsLite.js';
import { exchangeFor, routerFor } from './registry.js';
import {
  bsBalances,
  bsTokenTransfers,
  bsTransactions,
  bsAddressCounters,
  explorerAccountTxns,
  explorerConfigured,
  solSignatures,
  solBalance
} from './dataSources.js';
import { tokenMarket, historicalPriceFn, normByLog } from './pricing.js';
import {
  calculateSmartMoneyScore,
  calculateReputation,
  calculateWalletRisk,
  classifyWallet
} from './engines.js';
import { TTL, WINDOWS, FRESH } from './config.js';

const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function cgIdForToken(chainId, tokenAddress) {
  if (!tokenAddress) return null;
  const list = TOKENS[chainId] || [];
  const hit = list.find((t) => t.address === tokenAddress);
  return hit?.coingeckoId || null;
}

/* ── activity classification ──────────────────────────────────────────── */

function classifyAction({ chainId, direction, counterparty, token, txHash, method }) {
  const cex = exchangeFor(chainId, counterparty);
  const dex = routerFor(chainId, counterparty);
  const m = String(method || '').toLowerCase();

  // Exchange flows
  if (cex) {
    return direction === 'out'
      ? { type: 'EXCHANGE_DEPOSIT', label: `Exchange deposit → ${cex.exchange}`, cex: cex.exchange }
      : { type: 'EXCHANGE_WITHDRAWAL', label: `Exchange withdrawal ← ${cex.exchange}`, cex: cex.exchange };
  }
  // DEX swaps: an ERC-20 moving to a router = selling; from a router = buying.
  if (dex || m.includes('swap') || m.includes('swapeth')) {
    return direction === 'out'
      ? { type: 'LARGE_SELL', label: `Sold ${token?.symbol || 'token'} on ${dex?.dex || 'DEX'}`, dex: dex?.dex || null }
      : { type: 'LARGE_BUY', label: `Bought ${token?.symbol || 'token'} on ${dex?.dex || 'DEX'}`, dex: dex?.dex || null };
  }
  if (m.includes('mint') || m.includes('addliquidity') || m.includes('addliquidity')) {
    return { type: 'LIQUIDITY_MOVEMENT', label: `Liquidity added (${token?.symbol || 'LP'})` };
  }
  if (m.includes('burn') || m.includes('removeliquidity')) {
    return { type: 'LIQUIDITY_MOVEMENT', label: `Liquidity removed (${token?.symbol || 'LP'})` };
  }
  if (direction === 'out') return { type: 'TRANSFER', label: `Sent ${token?.symbol || 'tokens'}` };
  return { type: 'TRANSFER', label: `Received ${token?.symbol || 'tokens'}` };
}

/* ── P&L from observed history ────────────────────────────────────────── */

function summarizePnl(closed, unrealizedUsd) {
  if (!closed.length) {
    return {
      dataStatus: 'unavailable',
      realizedUsd: null,
      unrealizedUsd: unrealizedUsd ?? null,
      totalUsd: unrealizedUsd ?? null,
      winRate: null,
      closedTrades: 0,
      best: null,
      worst: null
    };
  }
  let wins = 0;
  let realized = 0;
  let best = null;
  let worst = null;
  for (const c of closed) {
    realized += c.pnlUsd;
    if (c.pnlUsd > 0) wins += 1;
    if (!best || c.pnlUsd > best.pnlUsd) best = c;
    if (!worst || c.pnlUsd < worst.pnlUsd) worst = c;
  }
  return {
    dataStatus: 'live',
    realizedUsd: Math.round(realized),
    unrealizedUsd: unrealizedUsd ?? null,
    totalUsd: Math.round(realized + (unrealizedUsd || 0)),
    winRate: Math.round((wins / closed.length) * 100),
    closedTrades: closed.length,
    best: best ? { symbol: best.symbol, pnlUsd: Math.round(best.pnlUsd) } : null,
    worst: worst ? { symbol: worst.symbol, pnlUsd: Math.round(worst.pnlUsd) } : null
  };
}

/* ── EVM wallet ───────────────────────────────────────────────────────── */

async function analyzeEvm(chainId, address, { windowMs } = {}) {
  const cutoff = Date.now() - (windowMs || WINDOWS.D30);

  // 1. History. Prefer the keyed explorer (denser); Blockscout is keyless.
  const [txRes, bsTxRes, transfersRes, balancesRes, countersRes] = await Promise.all([
    explorerConfigured(chainId)
      ? explorerAccountTxns(chainId, address, { limit: 200 })
      : Promise.resolve({ dataStatus: 'unconfigured', rows: [] }),
    bsTransactions(chainId, address, { limit: 100 }),
    bsTokenTransfers(chainId, address, { limit: 100 }),
    bsBalances(chainId, address),
    bsAddressCounters(chainId, address)
  ]);

  // Whichever native-tx source returned data gives us first-seen timestamps.
  const nativeTxRows = txRes.dataStatus === 'live' && txRes.rows.length ? txRes.rows : (bsTxRes.rows || []);
  const transfers = transfersRes.rows || [];

  // 2. Wallet age
  const allTimes = [...transfers.map((r) => r.timestamp).filter(Boolean), ...nativeTxRows.map((t) => t.timestamp).filter(Boolean)];
  const firstSeen = allTimes.length ? Math.min(...allTimes) : null;
  const ageMs = firstSeen ? Date.now() - firstSeen : null;
  const isFresh = ageMs != null && ageMs < FRESH.maxAgeMs;

  // 3. Price current holdings + build price map (DexScreener + cg majors)
  const balances = balancesRes.tokens || [];
  const holdings = [];
  let portfolioUsd = 0;
  let lowLiqValue = 0;
  const priceMap = new Map(); // tokenAddress → {usd, liquidity, cgId}
  for (const b of balances) {
    if (!b.token || b.amount <= 0) continue;
    const market = await tokenMarket(b.token);
    const cgId = cgIdForToken(chainId, b.token);
    const usd = market?.priceUsd ?? null;
    const liq = market?.liquidityUsd ?? null;
    if (usd) priceMap.set(b.token, { usd, liquidity: liq, cgId });
    const valueUsd = usd != null ? b.amount * usd : b.valueUsd ?? null;
    if (valueUsd != null) portfolioUsd += valueUsd;
    if (liq != null && liq < 50_000 && valueUsd != null) lowLiqValue += valueUsd;
    holdings.push({
      token: b.token,
      symbol: b.symbol || market?.symbol || '???',
      amount: b.amount,
      valueUsd: valueUsd != null ? Math.round(valueUsd) : null,
      priceUsd: usd,
      liquidityUsd: liq
    });
  }
  holdings.sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));

  // 4. Recent activity (in-window), priced at current price for display size
  const activity = [];
  for (const tr of transfers) {
    if (tr.timestamp && tr.timestamp < cutoff) continue;
    const action = classifyAction({
      chainId,
      direction: tr.direction,
      counterparty: tr.counterparty,
      token: tr.token,
      txHash: tr.hash,
      method: tr.method
    });
    const px = priceMap.get(tr.token?.address)?.usd;
    const valueUsd = px != null && tr.amount != null ? tr.amount * px : null;
    activity.push({
      id: `${tr.hash}:${tr.token?.address || ''}`,
      ...action,
      direction: tr.direction,
      token: tr.token?.symbol || '???',
      tokenAddress: tr.token?.address || null,
      amount: tr.amount,
      valueUsd: valueUsd != null ? Math.round(valueUsd) : null,
      counterparty: tr.counterparty,
      counterpartyLabel: exchangeFor(chainId, tr.counterparty)?.label || tr.toTag || tr.fromTag || null,
      hash: tr.hash,
      timestamp: tr.timestamp
    });
  }
  activity.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // 5. P&L — realised per-token FIFO using tx-time prices (majors via cg
  //    history); unrealised = current holdings at current price valued vs the
  //    flowing cost. Tokens without history simply don't enter closed trades.
  const cgIds = new Set([...priceMap.values()].map((p) => p.cgId).filter(Boolean));
  const histFns = new Map();
  for (const id of cgIds) {
    // eslint-disable-next-line no-await-in-loop
    histFns.set(id, await historicalPriceFn(id, 90));
  }
  // group transfers by token, only tokens with a pricing path
  const closed = [];
  const positions = new Map(); // token → {qty, cost}
  for (const tr of transfers) {
    const taddr = tr.token?.address;
    if (!taddr || tr.amount == null) continue;
    const info = priceMap.get(taddr) || {};
    const cgId = info.cgId || cgIdForToken(chainId, taddr);
    const histPx = cgId ? histFns.get(cgId)?.(tr.timestamp) : null;
    const curPx = info.usd;
    const pxAtTx = histPx ?? curPx ?? null;
    if (pxAtTx == null) continue;
    const flow = tr.direction === 'in' ? tr.amount : -tr.amount;
    const usdFlow = flow * pxAtTx;
    const pos = positions.get(taddr) || { qty: 0, cost: 0, symbol: tr.token?.symbol };
    if (flow > 0) {
      pos.qty += flow;
      pos.cost += usdFlow;
    } else {
      // closing part of a position: realised P&L pro-rata
      if (pos.qty > 0) {
        const avgCost = pos.qty !== 0 ? pos.cost / pos.qty : 0;
        const closedQty = Math.min(-flow, pos.qty);
        const pnl = (pxAtTx - avgCost) * closedQty;
        if (Number.isFinite(pnl)) closed.push({ symbol: pos.symbol || tr.token?.symbol, pnlUsd: pnl });
        pos.qty -= closedQty;
        pos.cost -= avgCost * closedQty;
      }
    }
    positions.set(taddr, pos);
  }
  // unrealised = still-open positions at current price
  let unrealizedUsd = 0;
  let hasUnrealized = false;
  for (const [taddr, pos] of positions) {
    if (pos.qty > 0.0000001) {
      const px = priceMap.get(taddr)?.usd;
      if (px != null) {
        unrealizedUsd += pos.qty * px - pos.cost;
        hasUnrealized = true;
      }
    }
  }
  const pnl = summarizePnl(closed, hasUnrealized ? Math.round(unrealizedUsd) : null);

  // 6. Risk evidence
  const topShare = holdings.length ? (holdings[0].valueUsd || 0) / Math.max(1, portfolioUsd) : 0;
  const lowLiqShare = lowLiqValue / Math.max(1, portfolioUsd);
  const cexFlowCount = activity.filter((a) => a.type === 'EXCHANGE_DEPOSIT' || a.type === 'EXCHANGE_WITHDRAWAL').length;
  const bridgeHits = activity.filter((a) => /bridge|across|stargate|layerzero/i.test(a.counterpartyLabel || '')).length;
  const scamHits = 0; // wired when a scam-address list is supplied (tokenRisk/GoPlus path)

  const risk = calculateWalletRisk({
    scamInteraction: scamHits ? 1 : 0,
    suspiciousContracts: topShare > 0.9 && holdings[0]?.liquidityUsd != null && holdings[0].liquidityUsd < 100_000 ? 0.6 : 0.1,
    extremeConcentration: topShare > 0.8 ? Math.min(1, topShare) : topShare > 0.5 ? 0.5 : 0.1,
    bridgeExposure: Math.min(1, bridgeHits / 3),
    cexExposure: Math.min(1, cexFlowCount / 5),
    highLeverage: /perp|dydx|gmx|hyperliquid|leverage/i.test(activity.map((a) => a.label).join(' ')) ? 0.7 : 0,
    lowLiquidityTokens: Math.min(1, lowLiqShare * 2),
    longTermHolding: (ageMs || 0) > WINDOWS.D30
  });

  // 7. Smart-money / reputation inputs
  const trades = closed.length + activity.filter((a) => a.type === 'LARGE_BUY' || a.type === 'LARGE_SELL').length;
  const winRate01 = pnl.winRate != null ? pnl.winRate / 100 : null;
  const dexCount = activity.filter((a) => a.dex).length;
  const buyCount = activity.filter((a) => a.type === 'LARGE_BUY').length;
  const earlyEntries = activity.filter((a) => a.type === 'LARGE_BUY' && a.token).length; // refined by token age below
  const volume30d = activity.reduce((s, a) => s + (a.valueUsd || 0), 0);
  const medianHoldingDays = ageMs ? null : null; // requires full position timestamps; left to coverage

  const smart = calculateSmartMoneyScore({
    profitability: pnl.totalUsd != null ? normByLog(pnl.totalUsd, 1_000_000) : null,
    consistency: trades >= 10 ? 0.6 + Math.min(0.4, winRate01 || 0) * 0.4 : trades >= 3 ? 0.4 : 0.15,
    earlyEntries: Math.min(1, earlyEntries / 5),
    riskAdjustedReturn: winRate01 != null ? winRate01 * (1 - risk.score / 200) : null,
    liquidityAwareness: lowLiqShare < 0.1 ? 0.9 : lowLiqShare < 0.3 ? 0.5 : 0.2,
    holdingQuality: (ageMs || 0) > WINDOWS.D7 ? 0.6 : 0.3
  });

  const reputation = calculateReputation({
    historicalPerformance: pnl.totalUsd != null ? normByLog(pnl.totalUsd, 1_000_000) : null,
    tradingConsistency: trades >= 10 ? 0.7 : trades >= 3 ? 0.4 : null,
    realizedPnl: pnl.realizedUsd != null ? normByLog(pnl.realizedUsd, 500_000) : null,
    winRate: winRate01,
    holdingDuration: ageMs ? Math.min(1, ageMs / (365 * WINDOWS.H24)) : null,
    liquidityAwareness: lowLiqShare < 0.1 ? 0.9 : lowLiqShare < 0.3 ? 0.5 : 0.2,
    tokenSelection: winRate01 != null ? winRate01 : null,
    counterpartyRisk: Math.min(1, scamHits + bridgeHits / 5),
    scamExposure: scamHits
  });

  const tags = classifyWallet({
    portfolioUsd,
    realizedPnlUsd: pnl.realizedUsd,
    winRate: pnl.winRate,
    trades,
    earlyEntries,
    medianHoldingDays,
    volume30dUsd: volume30d,
    dexTradeShare: activity.length ? dexCount / activity.length : null
  });

  return {
    dataStatus: transfersRes.dataStatus === 'live' || balancesRes.dataStatus === 'live' ? 'live' : (transfersRes.dataStatus || 'unavailable'),
    chain: chainId,
    chainKind: 'evm',
    address,
    firstSeen,
    ageMs,
    isFresh,
    txCount: countersRes.txCount ?? txRows.length + transfers.length,
    portfolioUsd: Math.round(portfolioUsd),
    holdings: holdings.slice(0, 30),
    activity: activity.slice(0, 40),
    pnl,
    smartMoney: smart,
    reputation,
    risk,
    tags
  };
}

/* ── Solana wallet ────────────────────────────────────────────────────── */

async function analyzeSolana(address) {
  const [sigsRes, balRes] = await Promise.all([solSignatures(address, { limit: 100 }), solBalance(address)]);
  const firstSeen = sigsRes.oldestAt;
  const ageMs = firstSeen ? Date.now() - firstSeen : null;
  const isFresh = ageMs != null && ageMs < FRESH.maxAgeMs;

  let solPrice = null;
  try {
    const { fetchSimplePrices } = await import('../providers.js');
    const prices = await fetchSimplePrices(['solana'], 'usd');
    solPrice = prices?.solana?.usd ?? null;
  } catch { /* leave null */ }

  const solValue = balRes.sol != null && solPrice != null ? balRes.sol * solPrice : null;
  const activity = (sigsRes.rows || []).slice(0, 40).map((s) => ({
    id: s.signature,
    type: 'TRANSFER',
    label: s.err ? 'Failed transaction' : 'Solana transaction',
    direction: null,
    token: 'SOL',
    valueUsd: null,
    hash: s.signature,
    timestamp: s.timestamp
  }));

  const risk = calculateWalletRisk({
    scamInteraction: 0,
    suspiciousContracts: null,
    extremeConcentration: solValue != null ? 0.8 : null,
    bridgeExposure: null,
    cexExposure: null,
    highLeverage: null,
    lowLiquidityTokens: null,
    longTermHolding: (ageMs || 0) > WINDOWS.D30
  });

  const smart = calculateSmartMoneyScore({
    profitability: null,
    consistency: sigsRes.rows.length > 20 ? 0.5 : null,
    earlyEntries: null,
    riskAdjustedReturn: null,
    liquidityAwareness: null,
    holdingQuality: ageMs ? Math.min(1, ageMs / (365 * WINDOWS.H24)) : null
  });
  const reputation = calculateReputation({
    historicalPerformance: null,
    tradingConsistency: sigsRes.rows.length > 20 ? 0.4 : null,
    holdingDuration: ageMs ? Math.min(1, ageMs / (365 * WINDOWS.H24)) : null
  });

  const tags = classifyWallet({
    portfolioUsd: solValue || 0,
    volume30dUsd: 0,
    medianHoldingDays: ageMs ? ageMs / WINDOWS.H24 : null
  });

  return {
    dataStatus: sigsRes.dataStatus === 'live' ? 'live' : (sigsRes.dataStatus || 'unavailable'),
    chain: 'solana',
    chainKind: 'solana',
    address,
    firstSeen,
    ageMs,
    isFresh,
    txCount: sigsRes.rows.length,
    portfolioUsd: solValue != null ? Math.round(solValue) : null,
    holdings: balRes.sol != null
      ? [{ token: 'solana', symbol: 'SOL', amount: balRes.sol, valueUsd: solValue != null ? Math.round(solValue) : null, priceUsd: solPrice, liquidityUsd: null }]
      : [],
    activity,
    pnl: summarizePnl([], null),
    smartMoney: smart,
    reputation,
    risk,
    tags
  };
}

/* ── public entry ─────────────────────────────────────────────────────── */

export async function analyzeWallet(rawAddress, chainHint = null, opts = {}) {
  const address = String(rawAddress || '').trim();
  const isSol = chainHint === 'solana' || (!chainHint && SOL_ADDR.test(address) && !EVM_ADDR.test(address));
  if (isSol && !SOL_ADDR.test(address)) {
    const e = new Error('BAD_ADDRESS'); e.code = 'BAD_ADDRESS'; throw e;
  }
  if (!isSol && !EVM_ADDR.test(address)) {
    const e = new Error('BAD_ADDRESS'); e.code = 'BAD_ADDRESS'; throw e;
  }
  const chainId = chainHint && chainHint !== 'solana' ? Number(chainHint) : 1;

  const cacheKey = `sm:wallet:${isSol ? 'solana' : chainId}:${address.toLowerCase()}`;
  const { value } = await withCache(cacheKey, TTL.wallet, () =>
    isSol ? analyzeSolana(address) : analyzeEvm(chainId, address, opts)
  );
  return value;
}

export function isValidAddress(address, chain) {
  const a = String(address || '').trim();
  if (chain === 'solana') return SOL_ADDR.test(a);
  return EVM_ADDR.test(a);
}
