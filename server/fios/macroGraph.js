/**
 * FBT FINANCIAL INTELLIGENCE OS — Macro Intelligence Graph (Phase 212, upgrade 4).
 * ---------------------------------------------------------------------------
 * The decision brain's causal spine. The owner's example:
 *
 *   Fed decision → DXY → Treasury yields → BTC → ETH → RWA → Portfolio risk
 *
 * This module turns that chain into a COMPUTED graph over what the OS actually
 * read (the global intelligence snapshot: news topics, macro quotes, crypto
 * markets, stocks/forex/commodities/rwa, smart money, whales) so the AI can
 * answer «چرا BTC امروز ریسک بالاتری دارد؟» with a transmission path whose
 * every node carries a real number and every edge a signed sensitivity.
 *
 * HOW IT WORKS
 *   Nodes  — macro instruments (DXY, 2s10s, SPX, GOLD, WTI), event topics
 *           (FED/INFLATION/GEOPOLITICS/… classified from real headlines),
 *           assets (BTC/ETH/SOL/… from the market read), classes (stocks,
 *           commodities, rwa) and the owner's portfolio.
 *   Edges  — static transmission structure (a Fed hike lifts real yields and
 *           the dollar, which historically compresses risk assets) with
 *           signed weights, ACTIVATED only when both endpoints were actually
 *           read this pass. An unread node is a missing edge, never a zero.
 *   Deltas — each instrument node carries its real 24h change; the graph
 *           propagates a risk impulse along active edges and reports, per
 *           path, the cumulative contribution to portfolio risk.
 *
 * HONESTY
 * The edge weights are labelled `model: true` — they are first-order
 * sensitivities, not measured betas. The node deltas are real. The answer
 * always separates «what was read» from «what the model assumes».
 */

export const MACRO_GRAPH_SCHEMA = 'fbt.fi.macro-graph.v1';

/* Instrument symbols the macro desk publishes → graph node ids. */
const INSTRUMENT_NODES = Object.freeze({
  DXY: { id: 'dxy', label: 'Dollar (DXY)', kind: 'instrument' },
  '2Y': { id: 'yields2y', label: '2Y Treasury', kind: 'instrument' },
  '10Y': { id: 'yields10y', label: '10Y Treasury', kind: 'instrument' },
  '2s10s': { id: 'curve2s10s', label: '2s10s spread', kind: 'instrument' },
  SPX: { id: 'spx', label: 'S&P 500', kind: 'instrument' },
  GOLD: { id: 'gold', label: 'Gold', kind: 'instrument' },
  WTI: { id: 'wti', label: 'Oil (WTI)', kind: 'instrument' },
  BTC: { id: 'btc', label: 'Bitcoin', kind: 'asset' },
  ETH: { id: 'eth', label: 'Ethereum', kind: 'asset' },
  SOL: { id: 'sol', label: 'Solana', kind: 'asset' }
});

/* The transmission structure. `weight` is the signed first-order sensitivity
 * of the TARGET to a +1% move in the SOURCE; `why` is the human sentence.
 * These are model assumptions (labelled as such on every edge in output). */
const EDGES = Object.freeze([
  { from: 'topic:FED', to: 'dxy', weight: 0.6, why: 'a hawkish Fed reprices the dollar up' },
  { from: 'topic:FED', to: 'yields2y', weight: 0.8, why: 'policy expectations move the front end of the curve' },
  { from: 'topic:INFLATION', to: 'yields10y', weight: 0.5, why: 'inflation expectations steepen the long end' },
  { from: 'topic:GEOPOLITICS', to: 'gold', weight: 0.4, why: 'risk-off demand lifts havens' },
  { from: 'topic:GEOPOLITICS', to: 'wti', weight: 0.5, why: 'supply fear lifts energy' },
  { from: 'dxy', to: 'btc', weight: -0.5, why: 'a stronger dollar drains liquidity from risk assets' },
  { from: 'yields2y', to: 'yields10y', weight: 0.4, why: 'the curve moves together at the front' },
  { from: 'yields10y', to: 'btc', weight: -0.4, why: 'higher real yields discount long-duration assets harder' },
  { from: 'yields10y', to: 'spx', weight: -0.5, why: 'discount rates compress equity multiples' },
  { from: 'dxy', to: 'spx', weight: -0.3, why: 'dollar strength tightens financial conditions' },
  { from: 'spx', to: 'btc', weight: 0.6, why: 'crypto trades as the high-beta tail of risk appetite' },
  { from: 'btc', to: 'eth', weight: 0.8, why: 'ETH historically follows BTC with higher beta' },
  { from: 'btc', to: 'sol', weight: 0.9, why: 'high-beta majors follow BTC' },
  { from: 'btc', to: 'rwa', weight: 0.3, why: 'tokenized markets inherit crypto-market liquidity conditions' },
  { from: 'wti', to: 'topic:INFLATION', weight: 0.3, why: 'energy feeds headline inflation' },
  { from: 'gold', to: 'btc', weight: -0.1, why: 'havens and crypto compete for the same fear bid' },
  { from: 'eth', to: 'portfolio', weight: 1.0, why: 'the portfolio holds it' },
  { from: 'btc', to: 'portfolio', weight: 1.0, why: 'the portfolio holds it' },
  { from: 'sol', to: 'portfolio', weight: 1.0, why: 'the portfolio holds it' },
  { from: 'rwa', to: 'portfolio', weight: 0.5, why: 'the portfolio holds RWA exposure' },
  { from: 'spx', to: 'portfolio', weight: 0.3, why: 'equity beta reaches the portfolio through risk appetite' }
]);

const RISK_TOPICS = Object.freeze(['FED', 'INFLATION', 'GEOPOLITICS']);

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d = 3) => (num(v) === null ? null : Number(Number(v).toFixed(d)));

/**
 * Build the graph from a global intelligence snapshot + the owner's world.
 * Pure and total: every unread input simply fails to activate its nodes.
 *
 * @param {object} p
 * @param {object} p.globalIntel  the global snapshot (domains)
 * @param {object} [p.world]      the world model (market domain, portfolio)
 * @param {object} [p.financial]  canonical financial state (exposure)
 * @param {number} [p.now]
 */
export function buildMacroGraph({ globalIntel = null, world = null, financial = null, now = Date.now() } = {}) {
  const domains = globalIntel?.domains || {};
  const nodes = [];
  const readSources = [];

  /* ── event nodes: real classified headlines ─────────────────────────── */
  const macroData = domains.macro?.status === 'OK' ? domains.macro.data : null;
  if (macroData) {
    readSources.push(`macro:${domains.macro.source || 'classifier'}`);
    for (const [topic, count] of Object.entries(macroData.byTopic || {})) {
      if (!count) continue;
      nodes.push({
        id: `topic:${topic}`,
        label: topic,
        kind: 'event',
        attention: count,
        headlines: (macroData.items || []).filter((i) => i.topic === topic).slice(0, 3).map((i) => i.title),
        change24hPct: null,
        riskDirection: RISK_TOPICS.includes(topic) ? 'risk_up' : null
      });
    }
  }

  /* ── instrument/asset nodes: real quotes ────────────────────────────── */
  const pushInstrument = (row, nodeMeta) => {
    const change = num(row?.change24hPct);
    if (!row || num(row?.priceUsd) === null) return;
    nodes.push({
      id: nodeMeta.id,
      label: nodeMeta.label,
      kind: nodeMeta.kind,
      change24hPct: round(change, 3),
      priceUsd: num(row.priceUsd),
      riskDirection: change === null ? null : (nodeMeta.kind === 'asset' ? (change < 0 ? 'risk_up' : 'risk_down') : null)
    });
  };
  if (macroData) {
    for (const quote of macroData.quotes || macroData.instruments || []) {
      const meta = INSTRUMENT_NODES[String(quote.symbol || '').toUpperCase()];
      if (meta) pushInstrument(quote, meta);
    }
    if (macroData.curve) {
      nodes.push({ id: 'curve2s10s', label: '2s10s spread', kind: 'instrument', change24hPct: round(num(macroData.curve.change7dPct), 3), spreadPct: round(num(macroData.curve.spreadPct), 3), riskDirection: null });
    }
  }

  /* ── crypto assets: the same market read the brain quotes ───────────── */
  const marketValue = world?.domains?.market?.value ?? world?.domains?.market;
  const marketData = marketValue?.value ?? marketValue;
  const marketRows = Array.isArray(marketData?.instruments) ? marketData.instruments
    : Array.isArray(marketData?.symbols) ? marketData.symbols
      : (marketData?.prices ? Object.entries(marketData.prices).map(([symbol, priceUsd]) => ({ symbol, priceUsd, change24hPct: marketData.changes24hPct?.[symbol] ?? null })) : []);
  for (const row of marketRows) {
    const sym = String(row?.symbol || '').toUpperCase();
    const meta = INSTRUMENT_NODES[sym];
    if (meta && !nodes.some((n) => n.id === meta.id)) {
      pushInstrument({ priceUsd: row.priceUsd ?? row.price, change24hPct: row.change24hPct ?? row.change24h }, meta);
    }
  }

  /* ── class nodes ─────────────────────────────────────────────────────── */
  for (const [domain, id, label] of [['stocks', 'spx', 'S&P 500'], ['commodities', 'wti', 'Oil (WTI)'], ['rwa', 'rwa', 'RWA market'], ['forex', 'dxy', 'Dollar (DXY)']]) {
    const d = domains[domain];
    if (d?.status !== 'OK') continue;
    const instruments = d.data?.instruments || [];
    if (id === 'rwa' && !nodes.some((n) => n.id === 'rwa')) {
      const avgChange = instruments.length ? instruments.reduce((a, r) => a + (num(r.change24hPct) || 0), 0) / instruments.length : null;
      nodes.push({ id: 'rwa', label, kind: 'class', change24hPct: round(avgChange, 3), instruments: instruments.length, riskDirection: null });
      readSources.push(`${domain}:${d.source || 'brain'}`);
    }
  }

  /* ── the portfolio node: real exposure ───────────────────────────────── */
  const holdings = financial?.computed?.holdings || financial?.computed?.positions || null;
  const netWorthUsd = num(financial?.computed?.netWorthUsd);
  const portfolioNode = {
    id: 'portfolio',
    label: 'Portfolio',
    kind: 'portfolio',
    netWorthUsd,
    holdingsCount: Array.isArray(holdings) ? holdings.length : null,
    change24hPct: null,
    riskDirection: null
  };
  nodes.push(portfolioNode);

  /* ── edges: activated only when both endpoints exist ─────────────────── */
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = EDGES
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({ ...e, model: true }));

  /* ── risk transmission (first-order, labelled) ────────────────────────── */
  /* Two quantities per node, kept APART because they answer different
   * questions:
   *   impulse   the node's OWN real 24h move (events: attention-scaled risk
   *             value). What was read.
   *   pressure  the macro-driven causal pressure ON the node:
   *             Σ(impulse[src] × weight) over incoming edges. What the model
   *             transmits. NEGATIVE pressure on an asset = bearish headwind =
   *             higher risk of holding it today.
   * Instruments keep their own real move as their impulse (so dxy +0.8%
   * transmits -0.4 points to BTC through the -0.5 edge); assets and the
   * portfolio carry pressure only. */
  const impulse = new Map();
  for (const n of nodes) {
    if (n.kind === 'event' && n.riskDirection === 'risk_up') impulse.set(n.id, Math.min(1, 0.2 + 0.2 * (n.attention || 1)));
    else if (n.change24hPct !== null) impulse.set(n.id, n.change24hPct);
    else impulse.set(n.id, 0);
  }
  const pressure = new Map(); // node id → causal macro pressure (negative = bearish)
  const order = [...nodes].sort((a, b) => (a.kind === 'event' ? -1 : 0) - (b.kind === 'event' ? -1 : 0));
  const driverFor = new Map(); // node id → its strongest incoming driver
  for (const node of order) {
    const into = edges.filter((e) => e.to === node.id);
    let incoming = 0;
    let strongest = null;
    for (const e of into) {
      const src = impulse.get(e.from) || 0;
      const contribution = src * e.weight;
      incoming += contribution;
      if (!strongest || Math.abs(contribution) > Math.abs(strongest.contribution)) {
        const srcNode = nodes.find((n) => n.id === e.from);
        strongest = {
          from: e.from,
          fromLabel: srcNode?.label || e.from,
          fromChange24hPct: srcNode?.change24hPct ?? null,
          attention: srcNode?.attention ?? null,
          sensitivity: round(e.weight, 3),
          why: e.why,
          contribution: round(contribution, 4)
        };
      }
    }
    pressure.set(node.id, round(incoming, 4));
    if (strongest) driverFor.set(node.id, strongest);
    /* Instruments blend the macro pressure into their impulse so a second hop
       (dxy → spx → btc) still carries the causal signal, while keeping their
       own real move dominant. */
    if (node.kind === 'instrument') {
      impulse.set(node.id, (impulse.get(node.id) || 0) * 0.6 + incoming * 0.4);
    }
  }
  /* Portfolio risk impulse: bearish pressure on what the owner holds is a
     RISK-UP signal, so the sign flips — positive output = risk up. */
  const holdingIds = edges.filter((e) => e.to === 'portfolio').map((e) => e.from);
  const portfolioPressure = holdingIds.reduce((a, id) => a + (pressure.get(id) || 0), 0);
  const portfolioRiskImpulse = round(-portfolioPressure, 4);

  /* ── the answer to «چرا BTC امروز ریسک بالاتری دارد؟» ──────────────── */
  const whyRiskier = (assetId) => {
    const asset = nodes.find((n) => n.id === assetId);
    if (!asset) return { available: false, reason: 'ASSET_NOT_READ' };
    const into = edges.filter((e) => e.to === assetId);
    const drivers = into
      .map((e) => {
        const srcNode = nodes.find((n) => n.id === e.from);
        const src = impulse.get(e.from) || 0;
        return {
          from: e.from,
          fromLabel: srcNode?.label || e.from,
          fromChange24hPct: srcNode?.change24hPct ?? null,
          attention: srcNode?.attention ?? null,
          sensitivity: round(e.weight, 3),
          why: e.why,
          contribution: round(src * e.weight, 4)
        };
      })
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 5);
    const p = num(pressure.get(assetId));
    const net = p === null ? null : round(-p, 3);
    return {
      available: true,
      asset: assetId,
      assetLabel: asset.label,
      assetChange24hPct: asset.change24hPct,
      macroPressure: p,
      netRiskImpulse: net,
      direction: p === null ? 'flat' : p < -0.3 ? 'risk_up' : p > 0.3 ? 'risk_down' : 'flat',
      drivers,
      note: drivers.length
        ? `first-order transmission over ${drivers.length} active driver(s); driver moves are real reads, sensitivities are model assumptions; negative macro pressure = bearish headwind = higher holding risk`
        : 'no active transmission path was readable for this asset this pass'
    };
  };

  const coverage = {
    domainsRead: Object.entries(domains).filter(([, d]) => d?.status === 'OK').map(([k]) => k),
    nodes: nodes.length,
    edges: edges.length,
    sources: [...new Set(readSources)]
  };

  return {
    schema: MACRO_GRAPH_SCHEMA,
    at: now,
    nodes,
    edges,
    coverage,
    portfolioRiskImpulse,
    impulse: Object.fromEntries([...impulse.entries()].map(([k, v]) => [k, round(v, 4)])),
    pressure: Object.fromEntries([...pressure.entries()].map(([k, v]) => [k, round(v, 4)])),
    whyRiskier,
    whyPortfolioRiskier: () => {
      const out = whyRiskier('portfolio');
      return { ...out, asset: 'portfolio', netRiskImpulse: portfolioRiskImpulse, direction: portfolioRiskImpulse > 0.05 ? 'risk_up' : portfolioRiskImpulse < -0.05 ? 'risk_down' : 'flat' };
    },
    executionAuthorized: false,
    estimate: true
  };
}

/** Serializable projection of a graph (the `whyRiskier` functions stripped). */
export function macroGraphDigest(graph) {
  if (!graph) return null;
  return {
    schema: graph.schema,
    at: graph.at,
    coverage: graph.coverage,
    portfolioRiskImpulse: graph.portfolioRiskImpulse,
    nodes: graph.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, change24hPct: n.change24hPct, riskDirection: n.riskDirection, attention: n.attention ?? null })),
    edges: graph.edges.map((e) => ({ from: e.from, to: e.to, weight: e.weight, why: e.why, model: true }))
  };
}

/**
 * The engine wrapper: builds the graph from the owner's own snapshot + world
 * model and persists the digest (capped history) so the decision record can
 * link to the macro context it was made under.
 */
export function createMacroGraphEngine({ collections = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  async function graphFor(owner, { globalIntel = null, world = null, financial = null, correlationId = null } = {}) {
    const at = now();
    const graph = buildMacroGraph({ globalIntel, world, financial, now: at });
    const record = {
      ...macroGraphDigest(graph),
      id: `mg_${at.toString(36)}`,
      owner,
      executionAuthorized: false
    };
    if (collections) {
      try {
        await collections.put('macro_graphs', owner, { ...record, id: 'latest' }, { idKey: 'id' });
      } catch (err) {
        log(`macro-graph:persist-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    if (observability) observability.emit({ type: 'macro-graph.built', owner, correlationId, payload: { nodes: graph.coverage.nodes, edges: graph.coverage.edges, portfolioRiskImpulse: graph.portfolioRiskImpulse } });
    return { ok: true, graph, record, whyRiskier: graph.whyRiskier, whyPortfolioRiskier: graph.whyPortfolioRiskier };
  }

  async function latest(owner) {
    if (!collections) return null;
    try {
      const out = await collections.get('macro_graphs', owner, 'latest');
      return out.ok ? out.row : null;
    } catch { return null; }
  }

  return { schema: MACRO_GRAPH_SCHEMA, graphFor, latest, build: buildMacroGraph };
}
