/**
 * Pure wallet → token relationship graph and evidence-weighted consensus.
 * Inputs are PROVEN paired swap fills + independently scored wallet profiles.
 * Large transfers and CEX withdrawals are deliberately excluded from votes.
 * No HOLD vote: silence in a sampled window is not proof of holding a token.
 */
import { EVM_CHAINS } from '../chainsLite.js';
import { isNonWallet } from './moneyFlow.js';
import { WINDOWS, WINDOW_KEYS } from './config.js';

const MAX_PROFILE_AGE = 36 * WINDOWS.H1; // actual cron cadence may be daily
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
      && p.coverage >= 0.75 && p.closedTrades >= 5 && p.realizedUsd > 0 && p.winRate >= 55
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
  return {
    schema: 'fbt.smart-money-intelligence.v1', dataStatus: validProfiles.length && eligible.length ? 'observed' : 'insufficient-evidence',
    at: now, indexedAt, window: win, durable, lastProfileAt,
    coverage: { classifiedWallets: validProfiles.length, sampledTrades: eligible.length,
      swapsInWindow: windowRows.length, walletsInWindow: graphWallets.size, observedSince: eligible.length ? Math.min(...eligible.map((s) => s.timestamp)) : null,
      completeness: 'sampled-indexer-pages',
      note: 'Only paired EVM token/allowlisted stablecoin swaps from qualified wallets. No native or Solana decoding yet. Cron/indexer coverage is sampled, not a real-time or full-chain view.' },
    consensus, leaderboard: validProfiles.sort((a, b) => b.score - a.score).slice(0, 20), earlyEntries,
    graph: { nodes, edges: graphEdges.filter((e) => allowedNodes.has(e.from) && allowedNodes.has(e.to)).slice(0, 100),
      fundingLinks: clusters.links.slice(0, 20), note: 'A shared funding address is correlation only, never proof of shared ownership.' },
    behaviours: behaviours.sort((a, b) => b.at - a.at).slice(0, 40),
    risk: { signalsAreTrades: true, priceForecast: false, identityVerifiedBySourceLinkOnly: true,
      note: 'No recommendation or guaranteed return. Stablecoin quote approximates USD; fees, depegs, unobserved swaps and incomplete indexer history can change P&L.' }
  };
}
