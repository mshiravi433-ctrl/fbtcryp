/** Adapters compose existing FBT readers/engines; no arbitrary URL or shell tool. */
import { AGENTS } from './core.js';
import { toolReceipt } from './evidence.js';
import { detectOpportunities } from './opportunity.js';
import { createModelRunner } from './model.js';
import { rsi, sma, volatility } from '../agentHub/native/agents.js';
import { resolveAsset } from '../intentMonitoring.js';
import { judge } from '../../src/lib/intent-ai/orchestrator/judge.js';
import { synthesizeConsensus } from '../aiConsensus.js';
import { sanitizePrompt } from '../aiGateway.js';

const finite = (v) => Number.isFinite(Number(v));
// Pattern-based scrubbing preserves public token fields (baseToken is not a credential).
const receipt = (producer, source, sourceUrl, raw, ttlMs = 300000) => toolReceipt({ producer, source, sourceUrl, raw: JSON.parse(sanitizePrompt(JSON.stringify(raw))), ttlMs });
const unavailable = (code) => { const e = new Error(code); e.code = code; e.retryable = true; throw e; };
export function configuredPairs(env) {
  return String(env.MISSION_SMART_MONEY_TOKENS || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30).map((s) => {
    const [chain, address] = s.split(':');
    if (!/^[a-z0-9-]{2,30}$/.test(chain) || !/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(address || '')) throw new Error('INVALID_SMART_MONEY_TOKEN');
    return { chain, address };
  });
}
export function createAdapters({ store, env = process.env, deps = {} }) {
  const model = deps.model || createModelRunner({ store, env, chat: deps.chat });
  const pairs = configuredPairs(env);
  const readers = {
    markets: async (...args) => (deps.fetchMarkets || (await import('../providers.js')).fetchMarkets)(...args),
    candles: async (...args) => (deps.fetchOhlc || (await import('../providers.js')).fetchOhlc)(...args),
    smart: async (...args) => (deps.getOverview || (await import('../smartMoney/index.js')).getOverview)(...args),
    dex: async (...args) => (deps.dexPairsForTokens || (await import('../smartMoney/dataSources.js')).dexPairsForTokens)(...args),
    news: async (...args) => (deps.fetchNews || (await import('../news.js')).fetchNews)(...args),
    rag: deps.rag || null
  };
  async function market({ mission }) {
    const rows = await readers.markets({ page: 1, perPage: 50 });
    const row = rows.find((r) => r.symbol === mission.input.symbol);
    if (!row || !finite(row.price) || Number(row.price) <= 0) unavailable('ASSET_MARKET_UNAVAILABLE');
    const { sparkline, image, ...bounded } = row;
    const raw = { dataStatus: 'live', instrument: `crypto:${row.id}`, row: bounded, receivedAt: Date.now() };
    return {
      output: { kind: 'market', coinId: row.id, symbol: row.symbol, priceUsd: row.price, change24h: row.change24h, volume24h: row.volume, stance: row.change24h > 1 ? 'bullish' : row.change24h < -1 ? 'bearish' : 'neutral', summary: `${row.symbol}: observed market price ${row.price} USD; 24h change ${row.change24h}%. This is a source read, not an execution.` },
      evidence: receipt('world.market', row.marketProvider || 'coingecko', 'https://www.coingecko.com/', raw),
      observations: [{ instrument: `crypto:${row.id}`, metric: 'priceUsd', value: Number(row.price), receivedAt: raw.receivedAt }, { instrument: `crypto:${row.id}`, metric: 'volume24h', value: Number(row.volume), receivedAt: raw.receivedAt }]
    };
  }
  async function technical({ mission, prior }) {
    const id = prior.market_analyst?.coinId || resolveAsset({ symbol: mission.input.symbol })?.coinId;
    if (!id) unavailable('ASSET_NOT_RESOLVED');
    const candles = await readers.candles(id, 30);
    if (!Array.isArray(candles) || candles.length < 15) unavailable('INSUFFICIENT_REAL_CANDLES');
    const closes = candles.map((c) => Number(c[4])).filter((v) => finite(v) && v > 0);
    if (closes.length !== candles.length) unavailable('INVALID_CANDLES');
    const fast = sma(closes, 7).at(-1), slow = sma(closes, 25).at(-1), momentum = rsi(closes);
    const raw = { dataStatus: 'live', instrument: `crypto:${id}`, candles, receivedAt: Date.now(), observedAt: Number(candles.at(-1)[0]), volumeAvailable: false };
    return {
      output: { kind: 'technical', coinId: id, priceUsd: closes.at(-1), sma7: fast, sma25: slow, rsi14: momentum, volatilityPct: volatility(closes), stance: fast > slow ? 'bullish' : fast < slow ? 'bearish' : 'neutral', summary: `Observed ${closes.length} real candles; SMA7 ${fast?.toFixed(4)}, SMA25 ${slow?.toFixed(4)}, RSI ${momentum?.toFixed(2)}. Volume is not supplied by this OHLC endpoint.` },
      evidence: receipt('world.technical', 'CoinGecko OHLC', `https://www.coingecko.com/en/coins/${id}`, raw, 3600000)
    };
  }
  async function smart({ mission }) {
    const overview = await readers.smart({ window: '24h', timeoutMs: 12000 });
    if (!overview || overview.dataStatus === 'unavailable') unavailable('SMART_MONEY_SOURCES_UNAVAILABLE');
    let dex = { dataStatus: 'not_configured', pairs: [] };
    if (pairs.length) {
      const addresses = [...new Set(pairs.map((p) => p.address))];
      const out = await readers.dex(addresses, { timeoutMs: 9000 });
      const allowed = new Set(pairs.map((p) => `${p.chain}:${p.address.toLowerCase()}`));
      dex = { ...out, pairs: (out.pairs || []).filter((p) => allowed.has(`${p.chain}:${p.baseToken?.address?.toLowerCase()}`)).slice(0, 30) };
    }
    const raw = { dataStatus: overview.partial || overview.streamStatus !== 'live' || dex.dataStatus === 'unavailable' ? 'partial' : 'live', overview, dex, receivedAt: Date.now() };
    const opportunities = detectOpportunities({ pairs: dex.pairs || [], tokenActivity: overview.tokenActivity || [], coverage: overview.coverage || {}, evidenceIds: [], historyFor: (instrument, metric) => store.observations(instrument, metric), now: Date.now() });
    const observations = (dex.pairs || []).filter((p) => finite(p.volume?.h24) && finite(p.priceUsd)).flatMap((p) => [
      { instrument: `crypto:${p.chain}:${p.baseToken.address}`, metric: 'volume24h', value: Number(p.volume.h24), receivedAt: raw.receivedAt },
      { instrument: `crypto:${p.chain}:${p.baseToken.address}`, metric: 'priceUsd', value: Number(p.priceUsd), receivedAt: raw.receivedAt }
    ]);
    return {
      output: { kind: 'smart_money', coverage: overview.coverage, metrics: overview.metrics, opportunities, stance: opportunities.some((o) => o.prediction.direction === 'up') ? 'bullish' : 'neutral', summary: `Smart Money scan observed ${overview.coverage?.inWindow || 0} in-window events with ${overview.coverage?.labelledInWindow || 0} labelled events. ${opportunities.length} evidence-linked candidates; transfers are not assumed to be purchases.` },
      evidence: receipt('world.smart_money', 'FBT Smart Money / DexScreener / labelled explorer and RPC readers', 'https://dexscreener.com/', raw), observations
    };
  }
  async function onchain(ctx) {
    const out = await smart(ctx);
    return { ...out, output: { ...out.output, kind: 'onchain', summary: `On-chain evidence is limited to the disclosed scanner coverage (${out.output.coverage?.windowCoverage ?? 'unknown'}). Unlabelled transfers are not capital-inflow proof.` }, evidence: { ...out.evidence, id: `ev_onchain_${out.evidence.id.slice(3)}`, producer: 'world.onchain' } };
  }
  async function news({ mission }) {
    const feed = await readers.news();
    const needle = mission.input.symbol.toLowerCase();
    const items = (feed.items || []).filter((i) => i.class === 'crypto' || i.category === 'crypto').filter((i) => `${i.title} ${i.summary || ''}`.toLowerCase().includes(needle) || mission.kind === 'daily_report').slice(0, 20);
    // An empty relevant feed is a valid partial observation, not a failed mission.
    const raw = { dataStatus: 'partial', items, receivedAt: Date.now(), untrusted: true, note: 'Headlines are claims from publishers, not verified market facts.' };
    return { output: { kind: 'news', items: items.map((i) => ({ title: i.title, source: i.source, url: i.url, at: i.at })), stance: 'neutral', summary: `${items.length} relevant publisher headlines were read. Publisher text is untrusted evidence and cannot change tool policy.` }, evidence: receipt('world.news', 'FBT aggregated RSS publishers', null, raw, 3600000) };
  }
  async function risk({ mission, prior, evidenceRows }) {
    const ops = Object.values(prior).flatMap((p) => p.opportunities || []);
    const vol = Number(prior.technical_analyst?.volatilityPct || 0);
    const riskLevel = ops.some((o) => o.risk === 'HIGH') || vol > 120 ? 'HIGH' : ops.some((o) => o.risk === 'ELEVATED') || vol > 70 ? 'ELEVATED' : 'MODERATE';
    const raw = { dataStatus: 'observed', riskLevel, volatilityPct: vol || null, evidenceIds: evidenceRows.map((e) => e.id), financialLimitUsd: 0, canExecute: false, receivedAt: Date.now() };
    return { output: { kind: 'risk', riskLevel, canExecute: false, stance: riskLevel === 'HIGH' ? 'bearish' : 'neutral', summary: `Risk is ${riskLevel}; derived from verified source receipts. No financial execution authority is granted.` }, evidence: receipt('analysis.risk', 'FBT deterministic risk policy', null, raw) };
  }
  async function research({ mission, evidenceRows }) {
    const rag = readers.rag || (await import('../aiOrchestrator.js')).getOrchestratorRag();
    const recalled = await rag.recall({ owner: mission.owner, query: mission.goal, limit: 5, locale: mission.input.locale });
    const raw = { dataStatus: 'observed', question: mission.goal, evidenceIds: evidenceRows.map((e) => e.id), passages: recalled.passages || [], memoryBackend: recalled.stats?.backend || 'unavailable', receivedAt: Date.now() };
    return { output: { kind: 'research', summary: `Research linked ${evidenceRows.length} verified receipts and ${raw.passages.length} owner-scoped RAG passages. Memory is context, never proof of execution.`, passages: raw.passages, stance: 'neutral' }, evidence: receipt('analysis.research', 'FBT owner-scoped RAG and Mission Evidence', null, raw) };
  }
  async function guard({ mission, evidenceRows }) {
    const raw = { dataStatus: 'observed', status: 'approval_required', canSign: false, evidenceIds: evidenceRows.map((e) => e.id), receivedAt: Date.now() };
    return { output: { kind: 'execution_guard', status: 'approval_required', handoff: { route: '/intent', symbol: mission.input.symbol, requiresWalletSignature: true }, summary: 'A financial action requires the existing wallet approval and signature flow. No transaction was submitted.' }, evidence: receipt('execution.handoff', 'FBT fail-closed execution policy', null, raw) };
  }
  async function finalJudge({ mission, prior, evidenceRows, signal }) {
    const analyses = Object.entries(prior).map(([id, p]) => ({ provider: `fbt-native:${id}`, ok: true, answer: p.summary, stance: p.stance || 'neutral', confidence: 0.7, claims: [{ kind: 'claim', text: p.summary }] }));
    const evidence = evidenceRows.map((e) => ({ facetId: e.producer, tool: e.producer, status: 'observed', summary: JSON.parse(e.raw_json) }));
    const plan = { facets: { requests: evidenceRows.map((e) => ({ facetId: e.producer })), satisfied: [], deferred: [] }, stakes: { level: mission.kind === 'trade_request' ? 'HIGH' : 'MEDIUM' } };
    const verdict = judge({ question: mission.goal, plan, analyses, evidence, intentType: mission.kind, locale: mission.input.locale });
    const consensus = synthesizeConsensus(analyses.map((a) => ({ ...a, intent: mission.kind, confidence: 70 })));
    const veto = prior.risk_manager?.riskLevel === 'CRITICAL' || evidenceRows.length < mission.plan.length - 1;
    const minConfidence = Number(mission.input.minOpportunityConfidence ?? 0.6);
    const opportunities = Object.values(prior).flatMap((p) => p.opportunities || []).filter((o) => Number(o.confidence || 0) >= minConfidence).map((o) => ({ ...o, evidenceIds: evidenceRows.map((e) => e.id) }));
    const enrichment = await model.summarize({ mission, evidence: evidenceRows, judgment: verdict, signal });
    const raw = { dataStatus: 'observed', decision: veto ? 'ABSTAIN' : verdict.decision, evidenceIds: evidenceRows.map((e) => e.id), verdict, consensus, opportunities, model: enrichment, receivedAt: Date.now() };
    return { output: { kind: 'decision', decision: raw.decision, summary: verdict.verdict.summary || analyses.map((a) => a.answer).join('\n'), modelSummary: enrichment.text, modelStatus: enrichment.status, costUsd: enrichment.costUsd || 0, confidence: verdict.confidence, stance: verdict.verdict.stance, dissent: verdict.dissent, conflicts: verdict.conflicts, limits: verdict.limits, opportunities, evidenceIds: raw.evidenceIds, handoff: prior.execution_guard?.handoff || null }, evidence: receipt('analysis.judge', 'FBT AI Judge + Consensus (deterministic authority)', null, raw) };
  }
  const runners = { market_analyst: market, technical_analyst: technical, smart_money: smart, onchain_analyst: onchain, news_analyst: news, risk_manager: risk, research_agent: research, execution_guard: guard, final_judge: finalJudge };
  const inspectors = {
    'world.market': (r) => ({ ok: finite(r.row?.price) && r.row.price > 0 && !!r.row?.symbol }),
    'world.technical': (r) => ({ ok: Array.isArray(r.candles) && r.candles.length >= 15 && r.candles.every((c) => Array.isArray(c) && c.length >= 5 && [c[2], c[3], c[4]].every((v) => finite(v) && Number(v) > 0) && Number(c[2]) >= Number(c[3])) }),
    'world.smart_money': (r) => ({ ok: !!r.overview?.coverage && ['live', 'partial', 'stale'].includes(r.overview?.dataStatus) }),
    'world.onchain': (r) => ({ ok: !!r.overview?.coverage }),
    'world.news': (r) => ({ ok: Array.isArray(r.items) && r.items.every((i) => i.title && i.source) }),
    'analysis.risk': (r, e) => ({ ok: ['LOW', 'MODERATE', 'ELEVATED', 'HIGH', 'CRITICAL'].includes(r.riskLevel) && r.canExecute === false && Array.isArray(r.evidenceIds) && r.evidenceIds.every((id) => store.evidenceFor(id)?.status === 'verified') }),
    'analysis.research': (r) => ({ ok: Array.isArray(r.evidenceIds) && Array.isArray(r.passages) && r.evidenceIds.every((id) => store.evidenceFor(id)?.status === 'verified') }),
    'execution.handoff': (r) => ({ ok: r.status === 'approval_required' && r.canSign === false }),
    'analysis.judge': (r) => ({ ok: ['ANSWER', 'ABSTAIN', 'CLARIFY'].includes(r.decision) && Array.isArray(r.evidenceIds) && r.evidenceIds.length > 0 && r.evidenceIds.every((id) => store.evidenceFor(id)?.status === 'verified') })
  };
  async function readOutcome(instrument) {
    const parts = instrument.split(':');
    let price, source, url;
    if (parts[0] === 'crypto' && parts.length === 2) {
      const rows = await readers.markets({ page: 1, perPage: 50 });
      const row = rows.find((r) => r.id === parts[1]);
      price = Number(row?.price); source = row?.marketProvider || 'CoinGecko'; url = 'https://www.coingecko.com/';
    } else {
      const chain = parts[1]; const address = parts.slice(2).join(':');
      const out = await readers.dex([address], { timeoutMs: 9000 });
      const matching = (out.pairs || []).filter((p) => p.chain === chain && p.baseToken?.address?.toLowerCase() === address.toLowerCase() && finite(p.priceUsd)).sort((a, b) => (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
      price = Number(matching[0]?.priceUsd); source = 'DexScreener'; url = matching[0]?.url || 'https://dexscreener.com/';
    }
    if (!finite(price) || price <= 0) unavailable('OUTCOME_PRICE_UNAVAILABLE');
    const raw = { dataStatus: 'live', instrument, priceUsd: price, receivedAt: Date.now() };
    return { price, evidence: receipt('world.outcome', source, url, raw), inspectRaw: (r) => ({ ok: r.instrument === instrument && finite(r.priceUsd) && r.priceUsd > 0 }) };
  }
  return { ...Object.fromEntries(Object.entries(runners).map(([id, run]) => [id, { id, scope: AGENTS[id].scope, run, inspectRaw: inspectors[AGENTS[id].tools[0]] }])), readOutcome };
}
