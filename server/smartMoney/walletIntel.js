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
  solBalance,
  solTokenBalances
} from './dataSources.js';
import { tokenMarkets, historicalPriceFn, normByLog } from './pricing.js';
import {
  calculateSmartMoneyScore,
  calculateReputation,
  calculateWalletRisk,
  classifyWallet
} from './engines.js';
import { TTL, WINDOWS, FRESH, DEX_SLUGS, CLASSIFY } from './config.js';

const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function cgIdForToken(chainId, tokenAddress) {
  if (!tokenAddress) return null;
  const list = TOKENS[chainId] || [];
  const hit = list.find((t) => t.address === tokenAddress);
  return hit?.coingeckoId || null;
}

/* ── activity classification ──────────────────────────────────────────── */

function classifyAction({ chainId, direction, counterparty, token, txHash, method, counterpartyKind, counterpartyExchange, counterpartyLabel }) {
  /* Curated registry first; the explorer's public name-tag («Kraken: Hot
     Wallet 4», «OKX Deposit», «Uniswap V3: Swap Router02») second. */
  const curatedCex = exchangeFor(chainId, counterparty);
  const cex = curatedCex ? { exchange: curatedCex.exchange } : counterpartyKind === 'exchange' && counterpartyExchange ? { exchange: counterpartyExchange } : null;
  const curatedDex = routerFor(chainId, counterparty);
  const dex = curatedDex ? { dex: curatedDex.dex } : counterpartyKind === 'dex' ? { dex: counterpartyLabel || 'DEX' } : null;
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
  if (counterpartyKind === 'bridge') {
    return { type: 'TRANSFER', label: `${direction === 'out' ? 'Bridged out' : 'Bridged in'} ${token?.symbol || 'tokens'}`, bridge: counterpartyLabel || 'bridge' };
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
    /*
     * Two different empties, and conflating them is what made the card read
     * as broken. With no loaded history there is nothing to say. With loaded
     * history and no CLOSED round-trip, the unrealised number is still real —
     * hiding it behind «P&L needs the indexer» was a lie of omission.
     */
    return {
      dataStatus: unrealizedUsd != null ? 'partial' : 'unavailable',
      reason: unrealizedUsd != null ? 'NO_CLOSED_TRADES' : 'NO_HISTORY',
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
    reason: null,
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
  //    allSettled, not all: one dead source must cost that section, never the
  //    whole page (a rejected Promise.all here used to 502 the endpoint even
  //    though balances and activity were perfectly readable).
  const [txSettled, bsTxSettled, transfersSettled, balancesSettled, countersSettled] = await Promise.allSettled([
    explorerConfigured(chainId)
      ? explorerAccountTxns(chainId, address, { limit: 200 })
      : Promise.resolve({ dataStatus: 'unconfigured', rows: [] }),
    bsTransactions(chainId, address, { limit: 100 }),
    bsTokenTransfers(chainId, address, { limit: 100 }),
    bsBalances(chainId, address),
    bsAddressCounters(chainId, address)
  ]);
  const settled = (r, fallback) => (r.status === 'fulfilled' && r.value ? r.value : fallback);
  const txRes = settled(txSettled, { dataStatus: 'unavailable', rows: [] });
  const bsTxRes = settled(bsTxSettled, { dataStatus: 'unavailable', rows: [] });
  const transfersRes = settled(transfersSettled, { dataStatus: 'unavailable', rows: [] });
  const balancesRes = settled(balancesSettled, { dataStatus: 'unavailable', tokens: [] });
  const countersRes = settled(countersSettled, { dataStatus: 'unavailable' });

  // Whichever native-tx source returned data gives us first-seen timestamps.
  const nativeTxRows = txRes.dataStatus === 'live' && txRes.rows.length ? txRes.rows : (bsTxRes.rows || []);
  const transfers = transfersRes.rows || [];

  // 2. Wallet age
  const allTimes = [...transfers.map((r) => r.timestamp).filter(Boolean), ...nativeTxRows.map((t) => t.timestamp).filter(Boolean)];
  const firstSeen = allTimes.length ? Math.min(...allTimes) : null;
  const ageMs = firstSeen ? Date.now() - firstSeen : null;
  const isFresh = ageMs != null && ageMs < FRESH.maxAgeMs;

  // 3. Price the wallet's tokens — HELD and TRADED — in one batched DexScreener
  //    call, then build the price map the activity feed and the P&L share.
  //
  //    Trading tokens are priced too, and that is the whole point: a wallet
  //    that bought and sold everything holds nothing, so a holdings-only price
  //    map could never see a closed round-trip — the P&L card answered «needs
  //    the indexer» at a wallet with a full trade history behind it.
  const balances = balancesRes.tokens || [];
  const heldTokens = balances.filter((b) => b.token && b.amount > 0).map((b) => b.token);
  const tradedTokens = transfers.map((tr) => tr.token?.address).filter(Boolean);
  const pricedTokens = [...new Set([...heldTokens, ...tradedTokens])].slice(0, 60);
  let markets = new Map();
  try {
    markets = await tokenMarkets(pricedTokens, { chain: DEX_SLUGS[chainId] || null });
  } catch {
    markets = new Map(); // no prices: every value below degrades, nothing lies
  }
  const holdings = [];
  let portfolioUsd = 0;
  let lowLiqValue = 0;
  const priceMap = new Map(); // tokenAddress → {usd, liquidity, cgId, pairCreatedAt}
  for (const [addr, market] of markets) {
    priceMap.set(addr, {
      usd: market.priceUsd ?? null,
      liquidity: market.liquidityUsd ?? null,
      cgId: cgIdForToken(chainId, addr),
      symbol: market.symbol || null,
      pairCreatedAt: market.pairCreatedAt ?? null
    });
  }
  for (const b of balances) {
    if (!b.token || b.amount <= 0) continue;
    const market = markets.get(b.token) || null;
    /* Deepest DEX pair first; the explorer's own exchange rate second (it
       prices majors and CEX-listed tokens that have thin on-chain pools). */
    const usd = market?.priceUsd ?? b.priceUsd ?? null;
    const liq = market?.liquidityUsd ?? null;
    const valueUsd = usd != null ? b.amount * usd : b.valueUsd ?? null;
    if (valueUsd != null) portfolioUsd += valueUsd;
    if (liq != null && liq < 50_000 && valueUsd != null) lowLiqValue += valueUsd;
    if (!priceMap.has(b.token) && usd != null) {
      priceMap.set(b.token, { usd, liquidity: liq, cgId: cgIdForToken(chainId, b.token), symbol: b.symbol || null, pairCreatedAt: null });
    }
    holdings.push({
      token: b.token,
      symbol: b.symbol || market?.symbol || '???',
      amount: b.amount,
      valueUsd: valueUsd != null ? Math.round(valueUsd) : null,
      priceUsd: usd,
      priceSource: market?.priceUsd != null ? 'dex' : b.priceUsd != null ? 'explorer' : null,
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
      method: tr.method,
      counterpartyKind: tr.counterpartyKind,
      counterpartyExchange: tr.counterpartyExchange,
      counterpartyLabel: tr.counterpartyLabel
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
      counterpartyLabel: exchangeFor(chainId, tr.counterparty)?.label || tr.counterpartyLabel || tr.toTag || tr.fromTag || null,
      counterpartyKind: tr.counterpartyKind || null,
      hash: tr.hash,
      timestamp: tr.timestamp
    });
  }
  activity.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  // 5. P&L — realised per-token FIFO using tx-time prices (majors via cg
  //    history); unrealised = current holdings at current price valued vs the
  //    flowing cost. Tokens without history simply don't enter closed trades.
  const cgIds = [...new Set([...priceMap.values()].map((p) => p.cgId).filter(Boolean))].slice(0, 12);
  const histFns = new Map();
  await Promise.all(cgIds.map(async (id) => {
    try {
      histFns.set(id, await historicalPriceFn(id, 90));
    } catch {
      histFns.set(id, () => null); // no history for this major: fall back to spot
    }
  }));
  // group transfers by token, only tokens with a pricing path
  const closed = [];
  const positions = new Map(); // token → {qty, cost, firstInAt}
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
    const pos = positions.get(taddr) || { qty: 0, cost: 0, symbol: tr.token?.symbol, firstInAt: null };
    if (flow > 0) {
      if (pos.qty <= 0 && tr.timestamp) pos.firstInAt = pos.firstInAt ?? tr.timestamp;
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

  // Holding quality: the median age of the positions the wallet still holds.
  // Real arithmetic on observed transfers, not a stand-in for wallet age.
  const heldDays = [...positions.values()]
    .filter((p) => p.qty > 0.0000001 && p.firstInAt)
    .map((p) => (Date.now() - p.firstInAt) / WINDOWS.H24)
    .sort((a, b) => a - b);
  const medianHoldingDays = heldDays.length ? Math.round(heldDays[Math.floor(heldDays.length / 2)]) : null;

  // 6. Risk evidence
  const topShare = holdings.length ? (holdings[0].valueUsd || 0) / Math.max(1, portfolioUsd) : 0;
  const lowLiqShare = lowLiqValue / Math.max(1, portfolioUsd);
  const cexFlowCount = activity.filter((a) => a.type === 'EXCHANGE_DEPOSIT' || a.type === 'EXCHANGE_WITHDRAWAL').length;
  const bridgeHits = activity.filter((a) => a.counterpartyKind === 'bridge' || /bridge|across|stargate|layerzero/i.test(a.counterpartyLabel || '')).length;
  const scamHits = 0; // wired when a scam-address list is supplied (tokenRisk/GoPlus path)
  /* Did any history source actually answer? If not, «no exposure» is not a
     finding — it is the absence of one. */
  const historyLive = transfersRes.dataStatus === 'live'
    || txRes.dataStatus === 'live' || bsTxRes.dataStatus === 'live';

  const risk = calculateWalletRisk({
    /*
     * A factor nobody measured is reported as MISSING (null), never as a
     * reassuring zero. Before this, a wallet whose history refused to load
     * still scored «risk 41 / LOW» and «reputation 94» out of pure fallback
     * constants — a confident verdict built on no evidence at all, on the one
     * screen whose contract is that it never invents one.
     */
    scamInteraction: scamHits ? 1 : null, // no scam-address feed wired yet
    suspiciousContracts: balancesRes.dataStatus === 'live' && holdings.length
      ? (topShare > 0.9 && holdings[0]?.liquidityUsd != null && holdings[0].liquidityUsd < 100_000 ? 0.6 : 0.1)
      : null,
    extremeConcentration: holdings.length ? (topShare > 0.8 ? Math.min(1, topShare) : topShare > 0.5 ? 0.5 : 0.1) : null,
    bridgeExposure: historyLive && (transfers.length || activity.length) ? Math.min(1, bridgeHits / 3) : null,
    cexExposure: historyLive && (transfers.length || activity.length) ? Math.min(1, cexFlowCount / 5) : null,
    highLeverage: activity.length ? (/perp|dydx|gmx|hyperliquid|leverage/i.test(activity.map((a) => a.label).join(' ')) ? 0.7 : 0) : null,
    lowLiquidityTokens: priceMap.size ? Math.min(1, lowLiqShare * 2) : null,
    longTermHolding: ageMs != null ? ageMs > WINDOWS.D30 : null
  });

  // 7. Smart-money / reputation inputs
  const trades = closed.length + activity.filter((a) => a.type === 'LARGE_BUY' || a.type === 'LARGE_SELL').length;
  const winRate01 = pnl.winRate != null ? pnl.winRate / 100 : null;
  const dexCount = activity.filter((a) => a.dex).length;
  const volume30d = activity.reduce((s, a) => s + (a.valueUsd || 0), 0);
  /*
   * An EARLY entry is arithmetic, not a vibe: the buy happened within
   * CLASSIFY.earlyBuyerMaxAgeDays of the token's deepest DEX pair being
   * created — the same rule the tag engine documents. Pair
   * creation is a chain fact (DexScreener); a buy with no pair age we can
   * read is simply not counted, never counted generously.
   */
  const earlyEntries = activity.filter((a) => {
    if (a.type !== 'LARGE_BUY') return false;
    const createdAt = priceMap.get(a.tokenAddress)?.pairCreatedAt;
    if (!createdAt || !a.timestamp) return false;
    return a.timestamp - createdAt >= 0 && a.timestamp - createdAt <= CLASSIFY.earlyBuyerMaxAgeDays * WINDOWS.H24;
  }).length;
  const hasPairAges = activity.some((a) => a.type === 'LARGE_BUY' && priceMap.get(a.tokenAddress)?.pairCreatedAt);

  const smart = calculateSmartMoneyScore({
    profitability: pnl.totalUsd != null ? normByLog(pnl.totalUsd, 1_000_000) : null,
    consistency: trades >= 10 ? 0.6 + Math.min(0.4, winRate01 || 0) * 0.4 : trades >= 3 ? 0.4 : trades > 0 ? 0.15 : null,
    earlyEntries: hasPairAges ? Math.min(1, earlyEntries / 5) : null,
    riskAdjustedReturn: winRate01 != null ? winRate01 * (1 - risk.score / 200) : null,
    liquidityAwareness: priceMap.size ? (lowLiqShare < 0.1 ? 0.9 : lowLiqShare < 0.3 ? 0.5 : 0.2) : null,
    holdingQuality: medianHoldingDays != null ? Math.max(0.2, Math.min(0.9, medianHoldingDays / 90)) : null
  });

  const reputation = calculateReputation({
    historicalPerformance: pnl.totalUsd != null ? normByLog(pnl.totalUsd, 1_000_000) : null,
    tradingConsistency: trades >= 10 ? 0.7 : trades >= 3 ? 0.4 : null,
    realizedPnl: pnl.realizedUsd != null ? normByLog(pnl.realizedUsd, 500_000) : null,
    winRate: winRate01,
    holdingDuration: ageMs ? Math.min(1, ageMs / (365 * WINDOWS.H24)) : null,
    liquidityAwareness: priceMap.size ? (lowLiqShare < 0.1 ? 0.9 : lowLiqShare < 0.3 ? 0.5 : 0.2) : null,
    tokenSelection: winRate01 != null ? winRate01 : null,
    counterpartyRisk: historyLive ? Math.min(1, scamHits + bridgeHits / 5) : null,
    scamExposure: historyLive ? scamHits : null
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

  /* Transaction count: the indexer's own number when it answered, otherwise
     the distinct transactions we actually loaded — and NEVER a 0 that reads
     like "this wallet has never transacted" when the source was simply down. */
  const observedTxIds = new Set([...nativeTxRows, ...transfers].map((r) => r.hash).filter(Boolean));
  const txCount = countersRes.dataStatus === 'live' && Number.isFinite(countersRes.txCount)
    ? countersRes.txCount
    : (observedTxIds.size || null);

  return {
    dataStatus: transfersRes.dataStatus === 'live' || balancesRes.dataStatus === 'live' ? 'live' : (transfersRes.dataStatus || 'unavailable'),
    chain: chainId,
    chainKind: 'evm',
    address,
    firstSeen,
    ageMs,
    isFresh,
    txCount,
    txCountSource: countersRes.dataStatus === 'live' && Number.isFinite(countersRes.txCount) ? 'indexer' : (observedTxIds.size ? 'loaded-history' : null),
    portfolioUsd: Math.round(portfolioUsd),
    holdings: holdings.slice(0, 30),
    activity: activity.slice(0, 40),
    pnl,
    smartMoney: smart,
    reputation,
    risk,
    tags,
    /* Which source fed which section — the page says "indexer offline" rather
       than showing an empty card when a section has nothing behind it. */
    sources: {
      history: transfersRes.dataStatus || 'unavailable',
      nativeTxs: txRes.dataStatus === 'unconfigured' ? (bsTxRes.dataStatus || 'unavailable') : (txRes.dataStatus || 'unavailable'),
      balances: balancesRes.dataStatus || 'unavailable',
      pricing: priceMap.size ? 'live' : 'unavailable',
      counters: countersRes.dataStatus || 'unavailable'
    }
  };
}

/* ── Solana wallet ────────────────────────────────────────────────────── */

async function analyzeSolana(address) {
  const [sigsSettled, balSettled, splSettled] = await Promise.allSettled([
    solSignatures(address, { limit: 100 }),
    solBalance(address),
    solTokenBalances(address)
  ]);
  const sigsRes = sigsSettled.status === 'fulfilled' ? sigsSettled.value : { dataStatus: 'unavailable', rows: [] };
  const balRes = balSettled.status === 'fulfilled' ? balSettled.value : { dataStatus: 'unavailable' };
  const splRes = splSettled.status === 'fulfilled' ? splSettled.value : { dataStatus: 'unavailable', tokens: [] };
  const sigRows = sigsRes.rows || [];
  const splTokens = splRes.tokens || [];
  const firstSeen = sigsRes.oldestAt;
  const ageMs = firstSeen ? Date.now() - firstSeen : null;
  const isFresh = ageMs != null && ageMs < FRESH.maxAgeMs;

  let solPrice = null;
  try {
    const { fetchSimplePrices } = await import('../providers.js');
    const prices = await fetchSimplePrices(['solana'], 'usd');
    solPrice = prices?.solana?.usd ?? null;
  } catch { /* leave null */ }

  /* SPL positions priced from real Solana DEX pairs — one batched call.
     A mint with no pair simply has no USD value and says so; it is never
     dropped from the holdings list for that reason. */
  let splMarkets = new Map();
  try {
    splMarkets = await tokenMarkets(splTokens.map((t) => t.token), { chain: 'solana' });
  } catch {
    splMarkets = new Map();
  }

  const solValue = balRes.sol != null && solPrice != null ? balRes.sol * solPrice : null;
  const holdings = [];
  let portfolioUsd = 0;
  if (balRes.sol != null) {
    holdings.push({ token: 'solana', symbol: 'SOL', amount: balRes.sol, valueUsd: solValue != null ? Math.round(solValue) : null, priceUsd: solPrice, liquidityUsd: null });
    if (solValue != null) portfolioUsd += solValue;
  }
  for (const t of splTokens) {
    const market = splMarkets.get(t.token) || null;
    const usd = market?.priceUsd ?? null;
    const valueUsd = usd != null ? t.amount * usd : null;
    if (valueUsd != null) portfolioUsd += valueUsd;
    holdings.push({
      token: t.token,
      symbol: market?.symbol || t.symbol || t.token.slice(0, 4),
      amount: t.amount,
      valueUsd: valueUsd != null ? Math.round(valueUsd) : null,
      priceUsd: usd,
      liquidityUsd: market?.liquidityUsd ?? null
    });
  }
  holdings.sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));

  const activity = sigRows.slice(0, 40).map((s) => ({
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
    extremeConcentration: holdings.length > 1 ? Math.min(1, (holdings[0].valueUsd || 0) / Math.max(1, portfolioUsd)) : (solValue != null ? 0.8 : null),
    bridgeExposure: null,
    cexExposure: null,
    highLeverage: null,
    lowLiquidityTokens: null,
    longTermHolding: (ageMs || 0) > WINDOWS.D30
  });

  const smart = calculateSmartMoneyScore({
    profitability: null,
    consistency: sigRows.length > 20 ? 0.5 : null,
    earlyEntries: null,
    riskAdjustedReturn: null,
    liquidityAwareness: splMarkets.size ? 0.5 : null,
    holdingQuality: ageMs ? Math.min(1, ageMs / (365 * WINDOWS.H24)) : null
  });
  const reputation = calculateReputation({
    historicalPerformance: null,
    tradingConsistency: sigRows.length > 20 ? 0.4 : null,
    holdingDuration: ageMs ? Math.min(1, ageMs / (365 * WINDOWS.H24)) : null
  });

  const tags = classifyWallet({
    portfolioUsd,
    volume30dUsd: 0,
    medianHoldingDays: ageMs ? Math.round(ageMs / WINDOWS.H24) : null
  });

  return {
    dataStatus: sigsRes.dataStatus === 'live' || balRes.dataStatus === 'live' ? 'live' : (sigsRes.dataStatus || 'unavailable'),
    chain: 'solana',
    chainKind: 'solana',
    address,
    firstSeen,
    ageMs,
    isFresh,
    txCount: sigRows.length || null,
    txCountSource: sigRows.length ? 'loaded-history' : null,
    portfolioUsd: portfolioUsd ? Math.round(portfolioUsd) : null,
    holdings,
    activity,
    pnl: summarizePnl([], null),
    smartMoney: smart,
    reputation,
    risk,
    tags,
    sources: {
      history: sigsRes.dataStatus || 'unavailable',
      balances: balRes.dataStatus || 'unavailable',
      tokenBalances: splRes.dataStatus || 'unavailable',
      pricing: splMarkets.size || solPrice != null ? 'live' : 'unavailable'
    }
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
