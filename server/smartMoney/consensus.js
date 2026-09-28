/**
 * Pure wallet → token relationship graph and evidence-weighted consensus.
 * Inputs are PROVEN paired swap fills + independently scored wallet profiles.
 * Large transfers and CEX withdrawals are deliberately excluded from votes.
 * No HOLD vote: silence in a sampled window is not proof of holding a token.
 */
import { EVM_CHAINS } from '../chainsLite.js';
import { isNonWallet } from './moneyFlow.js';
import { WINDOWS, WINDOW_KEYS } from './config.js';

/* A measured track record (≥5 paired closes over ≥2 days) does not expire
 * in 36 hours. The old 36h cap, combined with a twice-daily cron that could
 * re-analyse only four wallets per run, meant no more than a dozen profiles
 * could ever be "fresh" at once — too few for three independent votes on any
 * token. Profiles now count for the same seven days the index retains them;
 * `updatedAt` is still shown so every reader sees how old the measurement is. */
const MAX_PROFILE_AGE = 7 * WINDOWS.H24;
const RECENT_SWAPS = 30;
const LIMIT = 24;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const ident = (chain, address) => `${chain}:${String(address || '').toLowerCase()}`;
const validToken = (a) => /^0x[a-f0-9]{40}$/.test(String(a || '').toLowerCase());
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const money = (v) => Math.round(v * 100) / 100;

/** Shared observed funder is a correlation, NEVER proof of common ownership.
 * Collapse correlated wallets to one vote (conservative against sybil). */
export function fundingClusters(profiles = [], events = []) {
  const keys = new Set(profiles.map((p) => ident(p.chain, p.address)));
  const parent = new Map([...keys].map((key) => [key, key]));
  const root = (a) => {
    let x = a;
    while (x !== parent.get(x)) x = parent.get(x);
    return x;
  };
  const funding = new Map();
  for (const e of (Array.isArray(events) ? events : []).slice(0, 1500)) {
    if (e.flow !== 'transfer' || !Number.isFinite(e.valueUsd) || e.valueUsd < 25_000) continue;
    const to = ident(e.chainId, e.to?.address);
    if (!keys.has(to) || isNonWallet(e.chainId, e.from)) continue;
    const from = ident(e.chainId, e.from.address);
    if (keys.has(from)) continue;
    if (!funding.has(from)) funding.set(from, new Set());
    funding.get(from).add(to);
  }
  const links = [];
  for (const [funder, children] of funding) {
    if (children.size < 2) continue;
    const members = [...children].sort();
    // A funder could itself be an unlabelled CEX/bridge: merging is a
    // conservative confidence penalty, NOT a positive identity label.
    for (const key of members.slice(1)) parent.set(root(key), root(members[0]));
    links.push({ funder, members, basis: 'shared-observed-funder', ownership: 'unknown' });
  }
  return { component: (key) => parent.has(key) ? root(key) : key, links };
}

export const TOKEN_LOGOS = Object.freeze({
  '0x6982508145454ce325ddbe47a25d4ec3d2311933': 'https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0x6982508145454Ce325dDbE47a25d4ec3d2311933/logo.png',
  '0x514910771af9ca656af840dff83e8264ecf986ca': 'https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0x514910771AF9Ca656af840dff83E8264EcF986CA/logo.png',
  '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984': 'https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0x1f9840a85d5af5bf1d1762f925bdaddc4201f984/logo.png',
  '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9': 'https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9/logo.png',
  '0x808507121b80c02388fad14726482e061b8da827': 'https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0x808507121B80c02388fAd14726482e061B8da827/logo.png',
  '0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3': 'https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0xfAbA6f8e4a5E8Ab82F62fe7C39859FA577269BE3/logo.png',
  '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b': 'https://assets-cdn.trustwallet.com/blockchains/base/assets/0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b/logo.png',
  '0x940181a94a35a4569e4529a3cdfb74e38fd98631': 'https://assets-cdn.trustwallet.com/blockchains/base/assets/0x940181a94a35a4569e4529a3cdfb74e38fd98631/logo.png',
  '0x912ce59144191c1204e64559fe8253a0e49e6548': 'https://assets-cdn.trustwallet.com/blockchains/arbitrum/info/logo.png',
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': 'https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'https://assets-cdn.trustwallet.com/blockchains/ethereum/info/logo.png',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'https://assets-cdn.trustwallet.com/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png'
});

export function explainConsensus(row, lang = 'en') {
  if (!row || !['ACCUMULATION', 'DISTRIBUTION'].includes(row.signal)) {
    return lang === 'fa'
      ? 'برای اجماع پول هوشمند، دست‌کم ۳ کیف‌پول با عملکرد قابل‌سنجش و خرید/فروش تأییدشدهٔ مستقل لازم است.'
      : 'Consensus needs at least 3 independent, performance-qualified wallets with paired on-chain swaps.';
  }
  const buy = row.signal === 'ACCUMULATION';
  if (lang === 'fa') return `در ${row.window} گذشته، ${buy ? row.buyers : row.sellers} کیف‌پول با سابقهٔ معاملاتی قابل‌سنجش ${buy ? 'خرید' : 'فروش'} تأییدشدهٔ ${row.symbol || row.token.slice(0, 8)} داشته‌اند؛ ${row.independentVotes} گروه مستقل مشاهده شد. قدرت شواهد ${row.confidence} از ۱۰۰ است، نه احتمال رشد قیمت.`;
  return `Over ${row.window}, ${buy ? row.buyers : row.sellers} performance-qualified wallets had paired on-chain ${buy ? 'buys' : 'sells'} of ${row.symbol || row.token.slice(0, 8)} across ${row.independentVotes} independently observed groups. Evidence strength ${row.confidence}/100 is not a price forecast.`;
}

export function buildConsensus({ profiles = [], swaps = [], events = [], window = '24h', chain = null, token = null,
  now = Date.now(), indexedAt = null, durable = false } = {}) {
  const win = WINDOW_KEYS[window] ? window : '24h';
  const cutoff = now - WINDOW_KEYS[win];
  const selectedChain = chain == null || chain === '' ? null : Number(chain);
  const selectedToken = validToken(token) ? String(token).toLowerCase() : null;
  const validProfiles = (Array.isArray(profiles) ? profiles : [])
    .filter((p) => p?.qualified === true && Number.isFinite(p.score) && p.score >= 70
      // 0.6 = the five core factors measured (0.70) on a paginated explorer
      // page (×0.9). The old 0.75 demanded an optional factor, so no real
      // wallet could ever vote. See performance.js «UNREACHABLE».
      && p.coverage >= 0.6 && p.closedTrades >= 5 && p.realizedUsd > 0 && p.winRate >= 55
      && p.updatedAt <= now && now - p.updatedAt <= MAX_PROFILE_AGE);
  const byWallet = new Map(validProfiles.map((p) => [ident(p.chain, p.address), p]));
  const clusters = fundingClusters(validProfiles, events);
  const eligible = (Array.isArray(swaps) ? swaps : []).filter((s) =>
    s?.evidence === 'paired-explorer-transfers' && validToken(s.token)
    && byWallet.has(ident(s.chain, s.wallet)) && ['BUY', 'SELL'].includes(s.side)
    && Number.isFinite(s.timestamp) && s.timestamp > 0 && s.timestamp <= now
    && Number.isFinite(s.valueUsd) && s.valueUsd > 0
    && Number.isFinite(s.amount) && s.amount > 0
    && (selectedChain == null || s.chain === selectedChain)
    && (!selectedToken || s.token === selectedToken));
  const windowRows = eligible.filter((s) => s.timestamp >= cutoff);
  const tokens = new Map();
  const graphWallets = new Map();
  const graphEdges = [];
  const edgesByPair = new Map();
  const behaviours = [];
  const early = new Map();

  const priorByPair = new Map();
  for (const s of eligible.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))) {
    const pair = `${ident(s.chain, s.wallet)}:${s.token}`;
    const prev = priorByPair.get(pair);
    if (windowRows.includes(s)) {
      if (s.side === 'BUY' && !prev) behaviours.push({ kind: 'FIRST_OBSERVED_ENTRY', chain: s.chain, wallet: s.wallet, token: s.token, at: s.timestamp, txHash: s.hash });
      if (s.side === 'BUY' && prev?.side === 'SELL') behaviours.push({ kind: 'RE_ENTRY', chain: s.chain, wallet: s.wallet, token: s.token, at: s.timestamp, txHash: s.hash });
      if (s.side === 'SELL' && Number.isFinite(s.realizedRoiPct)) behaviours.push({ kind: s.realizedRoiPct > 0 ? 'PROFIT_TAKING' : 'LOSS_EXIT', chain: s.chain, wallet: s.wallet, token: s.token, at: s.timestamp, txHash: s.hash, realizedRoiPct: s.realizedRoiPct });
    }
    priorByPair.set(pair, s);
  }

  for (const s of windowRows) {
    const walletId = ident(s.chain, s.wallet);
    const tokenId = ident(s.chain, s.token);
    const p = byWallet.get(walletId);
    graphWallets.set(walletId, { id: walletId, type: 'wallet', chain: s.chain, address: s.wallet, label: p.label || null,
      identityKind: p.kind || null, score: p.score, coverage: p.coverage, cluster: clusters.component(walletId) });
    const key = `${walletId}:${tokenId}`;
    const edge = edgesByPair.get(key) || { from: walletId, to: tokenId, buyUsd: 0, sellUsd: 0, swaps: 0, hashes: [], evidence: 'paired-explorer-transfers' };
    edge[s.side === 'BUY' ? 'buyUsd' : 'sellUsd'] += s.valueUsd;
    edge.swaps++;
    if (edge.hashes.length < 3 && !edge.hashes.includes(s.hash)) edge.hashes.push(s.hash);
    edgesByPair.set(key, edge);
    const r = tokens.get(tokenId) || { chain: s.chain, token: s.token, symbol: s.symbol || '???',
      buyUsd: 0, sellUsd: 0, swaps: 0, wallets: new Map(), lastAt: 0 };
    r.lastAt = Math.max(r.lastAt, s.timestamp);
    r.swaps++;
    r[s.side === 'BUY' ? 'buyUsd' : 'sellUsd'] += s.valueUsd;
    const w = r.wallets.get(walletId) || { buyUsd: 0, sellUsd: 0, firstAt: s.timestamp, score: p.score, coverage: p.coverage };
    w[s.side === 'BUY' ? 'buyUsd' : 'sellUsd'] += s.valueUsd;
    w.firstAt = Math.min(w.firstAt, s.timestamp);
    r.wallets.set(walletId, w);
    tokens.set(tokenId, r);
    if (s.side === 'BUY' && Number.isFinite(s.pairCreatedAt) && s.pairCreatedAt > 0
      && s.timestamp >= s.pairCreatedAt && s.timestamp - s.pairCreatedAt <= 7 * WINDOWS.H24) {
      behaviours.push({ kind: 'EARLY_POOL_ENTRY', chain: s.chain, wallet: s.wallet, token: s.token, at: s.timestamp, txHash: s.hash,
        basis: 'observed-pool-created-at' });
      if (!early.has(tokenId)) early.set(tokenId, []);
      early.get(tokenId).push(s);
    }
  }
  for (const edge of edgesByPair.values()) graphEdges.push({ ...edge,
    buyUsd: money(edge.buyUsd), sellUsd: money(edge.sellUsd) });
  const consensus = [...tokens.values()].map((r) => {
    const directions = new Map();
    let buyers = 0; let sellers = 0; let mixed = 0;
    for (const [walletId, w] of r.wallets) {
      const diff = w.buyUsd - w.sellUsd;
      const side = Math.abs(diff) < 0.01 ? 'MIXED' : diff > 0 ? 'BUY' : 'SELL';
      if (side === 'BUY') buyers++;
      else if (side === 'SELL') sellers++;
      else mixed++;
      const group = clusters.component(walletId);
      if (!directions.has(group)) directions.set(group, new Set());
      directions.get(group).add(side);
    }
    let independentBuys = 0; let independentSells = 0;
    for (const sides of directions.values()) {
      if (sides.size === 1 && sides.has('BUY')) independentBuys++;
      if (sides.size === 1 && sides.has('SELL')) independentSells++;
    }
    const net = r.buyUsd - r.sellUsd;
    const signal = independentBuys >= 3 && independentBuys > independentSells && net > 0 ? 'ACCUMULATION'
      : independentSells >= 3 && independentSells > independentBuys && net < 0 ? 'DISTRIBUTION'
        : 'INSUFFICIENT_EVIDENCE';
    const sideVotes = signal === 'ACCUMULATION' ? independentBuys : independentSells;
    const agreement = sideVotes / Math.max(1, directions.size);
    const avgCoverage = [...r.wallets.values()].reduce((sum, w) => sum + w.coverage, 0) / r.wallets.size;
    const confidence = signal === 'INSUFFICIENT_EVIDENCE' ? null
      : clamp(Math.round(30 + 8 * Math.min(5, sideVotes) + 16 * agreement + 12 * avgCoverage
        - (now - r.lastAt > WINDOWS.H24 ? 10 : 0)), 0, 90);
    const row = {
      chain: r.chain, token: r.token, symbol: r.symbol, window: win, signal, confidence,
      tokenLogo: TOKEN_LOGOS[r.token] || null, icon: TOKEN_LOGOS[r.token] || null,
      buyers, sellers, mixed, independentBuyers: independentBuys, independentSellers: independentSells,
      independentVotes: directions.size, wallets: r.wallets.size, swaps: r.swaps,
      capitalEnteringUsd: money(r.buyUsd), capitalExitingUsd: money(r.sellUsd), netFlowUsd: money(net),
      lastAt: r.lastAt,
      confidenceBasis: 'Convergence of sampled paired swaps, independent funding groups, score coverage and recency; NOT probability of profit.'
    };
    row.explanation = explainConsensus(row, 'en');
    return row;
  }).sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1) || Math.abs(b.netFlowUsd) - Math.abs(a.netFlowUsd)).slice(0, LIMIT);

  const earlyEntries = [...early.entries()].map(([id, entries]) => {
    const [chainId, tokenAddr] = id.split(':');
    const wallets = new Set(entries.map((s) => ident(s.chain, s.wallet)));
    const totalValue = entries.reduce((sum, s) => sum + s.valueUsd, 0);
    const totalQty = entries.reduce((sum, s) => sum + s.amount, 0);
    const success = [...wallets].map((id) => byWallet.get(id)?.winRate).filter(Number.isFinite);
    return { chain: Number(chainId), token: tokenAddr, symbol: entries[0].symbol,
      tokenLogo: TOKEN_LOGOS[tokenAddr] || null, icon: TOKEN_LOGOS[tokenAddr] || null,
      wallets: wallets.size, averageEntryUsd: totalQty > 0 ? totalValue / totalQty : null,
      currentPriceUsd: null, changePct: null, liquidityUsd: null,
      historicalSuccessPct: success.length ? money(success.reduce((a, b) => a + b, 0) / success.length) : null,
      evidence: 'observed-pool-age-and-paired-swaps', firstAt: Math.min(...entries.map((s) => s.timestamp)),
      note: 'Early relative to the observed DEX pool, not necessarily token launch. Past win rate does not predict returns.' };
  }).sort((a, b) => b.wallets - a.wallets).slice(0, 8);

  const nodes = [
    ...[...graphWallets.values()].slice(0, 30),
    ...consensus.slice(0, 20).map((r) => ({ id: ident(r.chain, r.token), type: 'token', chain: r.chain,
      address: r.token, label: r.symbol, signal: r.signal, confidence: r.confidence }))
  ];
  const allowedNodes = new Set(nodes.map((r) => r.id));
  const lastProfileAt = validProfiles.length ? Math.max(...validProfiles.map((p) => p.updatedAt)) : null;
  const observed = observedLayer({ profiles, swaps, byWallet, cutoff, now, selectedChain, selectedToken, win });
  return {
    schema: 'fbt.smart-money-intelligence.v1', dataStatus: validProfiles.length && eligible.length ? 'observed' : 'insufficient-evidence',
    // Separate from dataStatus on purpose: `observed` stays reserved for
    // QUALIFIED evidence (FIOS/decision/strategy key off it). This says
    // whether the real on-chain sample behind the page exists at all.
    observedStatus: observed.status,
    at: now, indexedAt, window: win, durable, lastProfileAt,
    coverage: { classifiedWallets: validProfiles.length, sampledTrades: eligible.length,
      swapsInWindow: windowRows.length, walletsInWindow: graphWallets.size, observedSince: eligible.length ? Math.min(...eligible.map((s) => s.timestamp)) : null,
      analyzedWallets: observed.analyzedWallets, observedSwaps: observed.observedSwaps,
      observedSwapsInWindow: observed.swapsInWindow,
      completeness: 'sampled-indexer-pages',
      note: 'Only paired EVM token/allowlisted stablecoin swaps from qualified wallets. No native or Solana decoding yet. Cron/indexer coverage is sampled, not a real-time or full-chain view.' },
    consensus, leaderboard: validProfiles.sort((a, b) => b.score - a.score).slice(0, 20), earlyEntries,
    observed: { flow: observed.flow, recentSwaps: observed.recentSwaps, windowSwaps: observed.windowSwaps, candidates: observed.candidates,
      note: 'Paired stablecoin swaps reconstructed from each analysed wallet\'s own explorer history, qualified or not. Observed flow is NOT consensus and NOT a recommendation; only qualified wallets vote above.' },
    graph: { nodes, edges: graphEdges.filter((e) => allowedNodes.has(e.from) && allowedNodes.has(e.to)).slice(0, 100),
      fundingLinks: clusters.links.slice(0, 20), note: 'A shared funding address is correlation only, never proof of shared ownership.' },
    behaviours: behaviours.sort((a, b) => b.at - a.at).slice(0, 40),
    risk: { signalsAreTrades: true, priceForecast: false, identityVerifiedBySourceLinkOnly: true,
      note: 'No recommendation or guaranteed return. Stablecoin quote approximates USD; fees, depegs, unobserved swaps and incomplete indexer history can change P&L.' }
  };
}

/**
 * THE OBSERVED LAYER — every analysed wallet, qualified or not.
 *
 * Consensus is deliberately strict (≥3 independent performance-qualified
 * wallets), so on most days it is empty. Before, "empty consensus" meant an
 * empty page, which read as «not connected to real data» even when the index
 * held dozens of real, receipt-backed swaps. This exposes that sample as what
 * it is: paired fills with tx hashes from wallets we actually analysed, each
 * row carrying `qualified` so nothing unqualified is ever dressed up as smart
 * money. No votes, no confidence, no signal words here.
 */
export function observedLayer({ profiles = [], swaps = [], byWallet = new Map(), cutoff = 0, now = Date.now(),
  selectedChain = null, selectedToken = null, win = '24h' } = {}) {
  const fresh = (Array.isArray(profiles) ? profiles : [])
    .filter((p) => p && Number.isFinite(p.updatedAt) && p.updatedAt <= now && now - p.updatedAt <= MAX_PROFILE_AGE
      && (selectedChain == null || p.chain === selectedChain));
  const analysed = new Map(fresh.map((p) => [ident(p.chain, p.address), p]));
  const real = (Array.isArray(swaps) ? swaps : []).filter((s) =>
    s?.evidence === 'paired-explorer-transfers' && validToken(s.token) && ['BUY', 'SELL'].includes(s.side)
    && analysed.has(ident(s.chain, s.wallet))
    && Number.isFinite(s.timestamp) && s.timestamp > 0 && s.timestamp <= now
    && Number.isFinite(s.valueUsd) && s.valueUsd > 0
    && (selectedChain == null || s.chain === selectedChain)
    && (!selectedToken || s.token === selectedToken));
  const inWindow = real.filter((s) => s.timestamp >= cutoff);
  const flowMap = new Map();
  for (const s of inWindow) {
    const id = ident(s.chain, s.token);
    const r = flowMap.get(id) || { chain: s.chain, token: s.token, symbol: s.symbol || '???', buyUsd: 0, sellUsd: 0,
      swaps: 0, wallets: new Set(), buyers: new Set(), sellers: new Set(), qualifiedWallets: new Set(), lastAt: 0 };
    const w = ident(s.chain, s.wallet);
    r[s.side === 'BUY' ? 'buyUsd' : 'sellUsd'] += s.valueUsd;
    r.swaps++;
    r.wallets.add(w);
    (s.side === 'BUY' ? r.buyers : r.sellers).add(w);
    if (byWallet.has(w)) r.qualifiedWallets.add(w);
    r.lastAt = Math.max(r.lastAt, s.timestamp);
    flowMap.set(id, r);
  }
  const flow = [...flowMap.values()].map((r) => ({ chain: r.chain, token: r.token, symbol: r.symbol, window: win,
    tokenLogo: TOKEN_LOGOS[r.token] || null, icon: TOKEN_LOGOS[r.token] || null,
    buyUsd: money(r.buyUsd), sellUsd: money(r.sellUsd), netFlowUsd: money(r.buyUsd - r.sellUsd),
    buysUsd: money(r.buyUsd), sellsUsd: money(r.sellUsd), netUsd: money(r.buyUsd - r.sellUsd),
    swaps: r.swaps, wallets: r.wallets.size, buyers: r.buyers.size, sellers: r.sellers.size,
    qualifiedWallets: r.qualifiedWallets.size, lastAt: r.lastAt, basis: 'all-analysed-wallets' }))
    .sort((a, b) => (b.buyUsd + b.sellUsd) - (a.buyUsd + a.sellUsd)).slice(0, LIMIT);
  const recentSwaps = [...real].sort((a, b) => b.timestamp - a.timestamp).slice(0, RECENT_SWAPS).map((s) => ({
    chain: s.chain, wallet: s.wallet, token: s.token, symbol: s.symbol || '???', side: s.side,
    tokenLogo: TOKEN_LOGOS[s.token] || null, icon: TOKEN_LOGOS[s.token] || null,
    valueUsd: money(s.valueUsd), amount: s.amount, executionPriceUsd: Number.isFinite(s.executionPriceUsd) ? s.executionPriceUsd : null,
    hash: s.hash, at: s.timestamp, qualified: byWallet.has(ident(s.chain, s.wallet)),
    realizedRoiPct: Number.isFinite(s.realizedRoiPct) ? s.realizedRoiPct : null }));
  const windowSwaps = [...inWindow].sort((a, b) => b.timestamp - a.timestamp).slice(0, RECENT_SWAPS).map((s) => ({
    chain: s.chain, wallet: s.wallet, token: s.token, symbol: s.symbol || '???', side: s.side,
    tokenLogo: TOKEN_LOGOS[s.token] || null, icon: TOKEN_LOGOS[s.token] || null,
    valueUsd: money(s.valueUsd), amount: s.amount, executionPriceUsd: Number.isFinite(s.executionPriceUsd) ? s.executionPriceUsd : null,
    hash: s.hash, at: s.timestamp, qualified: byWallet.has(ident(s.chain, s.wallet)),
    realizedRoiPct: Number.isFinite(s.realizedRoiPct) ? s.realizedRoiPct : null }));
  const swapsByWallet = new Map();
  for (const s of real) swapsByWallet.set(ident(s.chain, s.wallet), (swapsByWallet.get(ident(s.chain, s.wallet)) || 0) + 1);
  const candidates = [...analysed.values()].map((p) => ({ chain: p.chain, address: p.address, label: p.label || null,
    kind: p.kind || null, score: Number.isFinite(p.score) ? p.score : null, coverage: Number.isFinite(p.coverage) ? p.coverage : 0,
    closedTrades: p.closedTrades || 0, realizedUsd: Number.isFinite(p.realizedUsd) ? p.realizedUsd : null,
    winRate: Number.isFinite(p.winRate) ? p.winRate : null, status: p.status || 'UNAVAILABLE',
    qualified: byWallet.has(ident(p.chain, p.address)), swaps: swapsByWallet.get(ident(p.chain, p.address)) || 0,
    discovery: p.discovery || null, updatedAt: p.updatedAt }))
    .sort((a, b) => Number(b.qualified) - Number(a.qualified) || (b.score ?? -1) - (a.score ?? -1)
      || b.closedTrades - a.closedTrades || b.swaps - a.swaps || b.updatedAt - a.updatedAt)
    .slice(0, 24);
  return {
    status: real.length ? 'sampled' : fresh.length ? 'analysed-no-swaps' : 'not-indexed',
    analyzedWallets: fresh.length, observedSwaps: real.length, swapsInWindow: inWindow.length,
    flow, recentSwaps, windowSwaps, candidates
  };
}
