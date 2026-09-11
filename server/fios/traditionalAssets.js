/**
 * FBT FINANCIAL INTELLIGENCE OS — Traditional Assets in the Decision Engine
 * (Phase 215): RWA · stocks · forex · commodities · etf · funds.
 * ---------------------------------------------------------------------------
 * Before this module the traditional classes ended at the classifier:
 * `instrumentOf` recognised them, INSTRUMENT_QUERY answered, and the decision
 * engine only ever saw crypto. Now the classes flow through the SAME pipeline
 * as crypto — discovery → decision → why → scenarios — with ONE contract:
 *
 *   discovery   the global-intel domains (stocks/forex/commodities/rwa) are
 *               normalised into opportunities; a class with no readable feed
 *               is honestly absent, never filled with invented rows
 *   decision    every opportunity — crypto or traditional — is scored through
 *               the SAME opportunityFit contract (no parallel if/else by
 *               asset class; the class is DATA on the row, not a branch)
 *   why         the why engine names the class, the OBSERVED 24h change (a
 *               read, not a model) and whether execution exists at all
 *   scenarios   goalScenarios carries the multi-class allocation: real
 *               capital × documented preset weights, observed changes where
 *               readable, and NO portfolio return number (there is no model
 *               for the traditional classes in this deployment — a number
 *               here would be invented)
 *
 * THE EXECUTION LAW (the honesty gate this phase is named after):
 *   - crypto executes through the EXISTING DEX/CEX adapters (the brain's
 *     swap/bridge modules; the wallet signs, as always);
 *   - stocks/forex/commodities/rwa/etf/funds execute ONLY through a
 *     broker/off-ramp provider that was actually registered AND configured —
 *     the lending-engine registry pattern (allowlist, explicit configured
 *     flag, nothing dialed by default);
 *   - without a configured provider the answer is exactly:
 *     «این کلاس دارایی فقط تحلیل می‌شود، اجرا ندارد» — analysis only, no
 *     execution — and the route never simulates a fill, never invents an
 *     order id, never flips an authority flag.
 */

import { randomUUID } from 'node:crypto';
import { requireFlag } from './flags.js';
import { scoreOpportunityFit } from './opportunityFit.js';

export const TRADITIONAL_ASSETS_SCHEMA = 'fbt.fi.traditional-assets.v1';

/** The classes `instrumentOf` (src/lib/central/intent.js) recognises. */
export const TRADITIONAL_CLASSES = Object.freeze(['etf', 'funds', 'stocks', 'forex', 'commodities', 'rwa']);
/** Every class the decision engine can weigh, crypto included. */
export const ALL_CLASSES = Object.freeze(['crypto', ...TRADITIONAL_CLASSES]);

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d = 2) => (num(v) === null ? null : Number(Number(v).toFixed(d)));

/* ══════════════════ the execution provider registry ══════════════════════ */
/* Lending-engine pattern: an allowlist of providers, one per class, with an
   explicit `configured` flag. Nothing is dialed by default; a class with no
   configured provider is analysis-only by construction, not by accident. */

const EXECUTION_PROVIDERS = new Map();

export function registerExecutionProvider({ id, assetClass, name = id, execute = null, configured = false } = {}) {
  const key = String(assetClass || '').toLowerCase();
  if (!ALL_CLASSES.includes(key)) throw new Error(`registerExecutionProvider: unknown class ${assetClass}`);
  if (typeof execute !== 'function') throw new Error(`registerExecutionProvider: ${id} needs an execute() that returns an unsigned hand-off`);
  EXECUTION_PROVIDERS.set(key, {
    id: String(id), assetClass: key, name: String(name), execute,
    /* configured:true without a callable execute is a lie — refuse it. */
    configured: configured === true
  });
  return key;
}

export function unregisterExecutionProvider(assetClass) {
  return EXECUTION_PROVIDERS.delete(String(assetClass || '').toLowerCase());
}

export function listExecutionProviders() {
  return [...EXECUTION_PROVIDERS.values()].map(({ id, assetClass, name, configured }) => ({
    id, assetClass, name, configured, executeAvailable: configured
  }));
}

/** The honest execution status of one class. `crypto` is special: its
 *  adapters (DEX/CEX through the central brain) exist in every deployment. */
export function executionStatus(assetClass) {
  const key = String(assetClass || '').toLowerCase();
  if (key === 'crypto') {
    return {
      available: true,
      via: 'dex-cex-adapters',
      detail: 'crypto executes through the existing DEX/CEX adapters; the unsigned hand-off ends at the user wallet'
    };
  }
  const p = EXECUTION_PROVIDERS.get(key);
  if (!p || !p.configured) {
    return {
      available: false,
      code: 'NO_EXECUTION_PROVIDER',
      via: null,
      note: `این کلاس دارایی فقط تحلیل می‌شود، اجرا ندارد — broker/off-ramp provider برای ${key} configure نشده است`,
      detail: `no configured broker/off-ramp provider for ${key}; analysis only — execution is refused rather than simulated`
    };
  }
  return { available: true, code: null, via: p.id, providerName: p.name, detail: `${key} executes only through the configured provider ${p.id}` };
}

/* ══════════════════ the opportunity contract ═════════════════════════════ */
/* The SAME fields opportunityFit reads for a crypto opportunity. Traditional
   instruments carry OBSERVED data only: price + 24h change live under
   `observation`; return/risk/probability stay null (UNKNOWN) until a real
   model reads them. A made number is the one thing this module will not do. */

export function normalizeOpportunity(raw = {}, assetClass = null, { now = Date.now() } = {}) {
  const cls = String(assetClass || raw.assetClass || '').toLowerCase();
  if (!ALL_CLASSES.includes(cls)) {
    return { ok: false, code: 'UNKNOWN_ASSET_CLASS', detail: `${assetClass || raw.assetClass} is not a recognised class (expected one of ${ALL_CLASSES.join(', ')})` };
  }
  const clsKey = cls === 'crypto' ? 'crypto' : cls;
  const row = {
    id: raw.id || null,
    kind: clsKey.toUpperCase(),
    assetClass: clsKey,
    asset: raw.asset ? String(raw.asset).toUpperCase() : (raw.symbol ? String(raw.symbol).toUpperCase() : null),
    venue: raw.venue ? String(raw.venue).slice(0, 24) : null,
    chain: raw.chain ? String(raw.chain).slice(0, 24) : null,
    protocol: raw.protocol ? String(raw.protocol).slice(0, 24) : (raw.venue ? String(raw.venue).slice(0, 24) : null),
    /* Crypto scans DO carry a real APY from the yield feed; traditional
       instruments carry none — the fields exist so the one contract holds,
       and null is the honest value. */
    apyPct: num(raw.apyPct ?? raw.yieldPct),
    expectedReturnPct: num(raw.expectedReturnPct),
    feePct: num(raw.feePct),
    feeUsd: num(raw.feeUsd),
    slippagePct: num(raw.slippagePct),
    impermanentLossPct: num(raw.impermanentLossPct),
    probabilityPct: num(raw.probabilityPct),
    riskPct: num(raw.riskPct ?? raw.potentialLossPct),
    liquidity: raw.liquidity ? String(raw.liquidity).toUpperCase() : null,
    capitalRequiredUsd: num(raw.capitalRequiredUsd),
    horizonMonths: num(raw.horizonMonths),
    observation: {
      priceUsd: num(raw.priceUsd),
      change24hPct: num(raw.change24hPct ?? raw.change24hPct),
      source: raw.source ? String(raw.source).slice(0, 40) : null,
      at: raw.at ?? now
    },
    execution: executionStatus(clsKey),
    estimate: false
  };
  return { ok: true, opportunity: row };
}

/* ══════════════════ discovery ════════════════════════════════════════════ */
/* From the global-intel snapshot the same pass the world model reads. A class
   whose feed did not answer is named in `coverage` with its reason — the row
   list only ever contains instruments the feed actually reported. */

export function discoverOpportunities({ globalSnapshot = null, now = Date.now() } = {}) {
  const domains = (globalSnapshot && typeof globalSnapshot === 'object' ? globalSnapshot.domains : null) || {};
  const rows = [];
  const coverage = {};
  for (const cls of TRADITIONAL_CLASSES) {
    if (cls === 'etf' || cls === 'funds') {
      coverage[cls] = { status: 'NO_FEED', detail: 'no live feed for this class in this deployment; opportunities arrive only when the caller names them' };
      continue;
    }
    const domain = domains[cls];
    if (!domain || domain.status !== 'OK') {
      coverage[cls] = { status: 'UNREADABLE', reason: domain?.reason || 'UNREAD' };
      continue;
    }
    const instruments = Array.isArray(domain.data?.instruments) ? domain.data.instruments : [];
    coverage[cls] = { status: 'OK', count: instruments.length, venue: domain.data?.venue || domain.source || null };
    for (const inst of instruments) {
      if (!inst?.symbol) continue;
      const got = normalizeOpportunity({
        id: `trad_${cls}_${String(inst.symbol).toUpperCase()}`,
        symbol: inst.symbol,
        priceUsd: inst.priceUsd,
        change24hPct: inst.change24hPct,
        venue: domain.data?.venue || domain.source,
        source: domain.source || `global-intel:${cls}`,
        at: domain.at || now
      }, cls, { now });
      if (got.ok) rows.push(got.opportunity);
    }
  }
  return {
    ok: true,
    schema: TRADITIONAL_ASSETS_SCHEMA,
    at: now,
    opportunities: rows,
    count: rows.length,
    coverage,
    note: 'traditional opportunities carry observed data only; return/risk/probability stay UNKNOWN (null) until a real model reads them'
  };
}

/* ══════════════════ scoring: the SAME contract as crypto ═════════════════ */
/* No if/else on the class — scoreOpportunityFit is the one code path for
   every row. The class is data on the opportunity, not a branch in the
   decision engine. */

export function scoreOpportunities(opportunities = [], profile = null, { financial = null, goal = null } = {}) {
  if (!profile) return { ok: false, code: 'NO_PROFILE', detail: 'scoring needs the owner profile — build it first', ranked: [] };
  const rows = [];
  for (const raw of (Array.isArray(opportunities) ? opportunities : []).slice(0, 50)) {
    const normalized = raw.assetClass ? raw : (normalizeOpportunity(raw, raw.assetClass || null, {}).opportunity || null);
    if (!normalized) continue;
    const fit = scoreOpportunityFit(normalized, profile, { financial, goal });
    if (fit.ok) {
      rows.push({
        ...normalized,
        verdict: fit.verdict,
        score: fit.score,
        decidedBy: fit.decidedBy,
        fitReason: fit.reason,
        fitDimensions: fit.dimensions
      });
    }
  }
  const order = { FITTED: 0, CONDITIONAL: 1, NOT_FITTED: 2 };
  rows.sort((a, b) => ((order[a.verdict] ?? 9) - (order[b.verdict] ?? 9)) || ((b.score ?? 0) - (a.score ?? 0)));
  return { ok: true, ranked: rows, count: rows.length };
}

/* ══════════════════ multi-class allocation (scenarios) ═══════════════════ */
/* Real capital × documented preset weights → target mix in USD, the observed
   24h change of each sleeve where the feed answered, and the EXECUTION status
   of each sleeve. The portfolio return is deliberately null: no model for the
   traditional classes exists in this deployment, and a blended number would
   be invented. The crypto sleeve reports the live blended yield the financial
   state actually read, when it could. */

export const MULTICLASS_PRESETS = Object.freeze({
  CONSERVATIVE: { stable: 0.5, stocks: 0.25, commodities: 0.1, crypto: 0.15 },
  MODERATE: { stable: 0.3, stocks: 0.3, commodities: 0.15, crypto: 0.25 },
  GROWTH: { stable: 0.15, stocks: 0.35, commodities: 0.15, crypto: 0.35 },
  AGGRESSIVE: { stable: 0.1, stocks: 0.3, commodities: 0.15, crypto: 0.45 }
});

/** The profile's risk tolerance onto the preset ladder (same bands as the
 *  opportunity fit: CONSERVATIVE 20 / MODERATE 45 / GROWTH 70 / AGGRESSIVE 90). */
export function riskProfileKey(riskTolerance) {
  const t = String(riskTolerance || '').toUpperCase();
  if (t.includes('CONSERVATIVE')) return 'CONSERVATIVE';
  if (t.includes('AGGRESSIVE') || t.includes('HIGH')) return 'AGGRESSIVE';
  if (t.includes('GROWTH') || t.includes('ELEVATED')) return 'GROWTH';
  return 'MODERATE';
}

export function allocateMultiClass({ capitalUsd = null, riskTolerance = 'MODERATE', goal = null, opportunities = null, financial = null, now = Date.now() } = {}) {
  const capital = num(capitalUsd) ?? num(financial?.computed?.netWorthUsd);
  if (capital === null || capital <= 0) {
    return { ok: false, code: 'NO_CAPITAL_READ', detail: 'a multi-class allocation needs a readable capital figure; nothing was modelled and nothing was guessed' };
  }
  const profileKey = riskProfileKey(riskTolerance);
  const preset = MULTICLASS_PRESETS[profileKey];
  const sleeves = {
    stable: { assetClass: 'stablecash', label: 'Stables / cash', execution: { available: true, via: 'dex-cex-adapters (stablecoin swaps)' } },
    stocks: { assetClass: 'stocks', label: 'Stocks', execution: executionStatus('stocks') },
    commodities: { assetClass: 'commodities', label: 'Commodities', execution: executionStatus('commodities') },
    crypto: { assetClass: 'crypto', label: 'Crypto', execution: executionStatus('crypto') }
  };
  const classes = {};
  for (const [key, sleeve] of Object.entries(sleeves)) {
    const weight = preset[key];
    classes[key] = {
      assetClass: sleeve.assetClass,
      label: sleeve.label,
      weightPct: round(weight * 100, 2),
      allocationUsd: round(capital * weight, 2),
      expectedReturnPct: null,
      observed24hChangePct: null,
      observedSymbol: null,
      liveYieldPct: null,
      execution: sleeve.execution
    };
  }
  /* The observed 24h change is a READ from discovery — real or null.
     First reported instrument per class wins: deterministic in feed order,
     and the symbol is named so the number is attributable. */
  for (const o of (Array.isArray(opportunities) ? opportunities : [])) {
    const key = o.assetClass === 'stocks' ? 'stocks' : o.assetClass === 'commodities' ? 'commodities' : null;
    if (key && o.observation?.change24hPct != null && classes[key].observed24hChangePct === null) {
      classes[key].observed24hChangePct = round(o.observation.change24hPct, 2);
      classes[key].observedSymbol = o.asset;
    }
  }
  /* The one real crypto number in this deployment: the live blended yield the
     financial state read this pass (null when unread — never a preset). */
  const liveYield = num(financial?.computed?.blendedYieldPct);
  if (liveYield !== null) classes.crypto.liveYieldPct = liveYield;

  const executableSleeves = Object.keys(classes).filter((k) => classes[k].execution.available === true);
  return {
    ok: true,
    schema: TRADITIONAL_ASSETS_SCHEMA,
    at: now,
    capitalUsd: round(capital, 2),
    profileKey,
    goal: goal || null,
    classes,
    executableSleeves,
    analysisOnlySleeves: Object.keys(classes).filter((k) => classes[k].execution.available !== true),
    expectedPortfolioReturnPct: null,
    expectedPortfolioReturnNote: 'no return model exists for the traditional sleeves in this deployment — this is a target mix with observed changes, not a return forecast; the crypto sleeve reports the live blended yield only when the financial state read one',
    estimate: false,
    signs: false,
    submits: false,
    simulated: false
  };
}

/* ══════════════════ the engine wrapper ═══════════════════════════════════ */

export function createTraditionalAssetsEngine({ collections = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  async function discover(owner, { globalSnapshot = null, persist = true } = {}) {
    const gate = requireFlag('TRADITIONAL_ASSETS_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const result = discoverOpportunities({ globalSnapshot, now: now() });
    if (persist && collections && result.count) {
      try {
        await collections.put('traditional_opportunities', owner, { ...result, id: 'latest', owner }, { idKey: 'id' });
      } catch (err) {
        log(`traditional-assets:persist-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    if (observability) observability.emit({ type: 'traditional-assets.discovered', owner, payload: { count: result.count, classes: Object.keys(result.coverage) } });
    return { ok: true, result };
  }

  async function scoreFor(owner, { opportunities = null, profile = null, financial = null, goal = null } = {}) {
    const gate = requireFlag('TRADITIONAL_ASSETS_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag, result: { ranked: [] } };
    if (!Array.isArray(opportunities) || !opportunities.length) {
      return { ok: false, code: 'OPPORTUNITIES_REQUIRED', detail: 'pass opportunities[] (normalized or raw with assetClass)' };
    }
    const result = scoreOpportunities(opportunities, profile, { financial, goal });
    if (!result.ok) return result;
    if (observability) observability.emit({ type: 'traditional-assets.scored', owner, payload: { count: result.count, top: result.ranked[0]?.asset || null } });
    return { ok: true, result };
  }

  async function allocateFor(owner, { capitalUsd = null, riskTolerance = null, goal = null, opportunities = null, financial = null } = {}) {
    const gate = requireFlag('TRADITIONAL_ASSETS_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const result = allocateMultiClass({ capitalUsd, riskTolerance, goal, opportunities, financial, now: now() });
    return result.ok ? { ok: true, result } : result;
  }

  /**
   * The execution gate. crypto → the existing DEX/CEX adapters (the response
   * names the path; the wallet signs as always). Traditional classes → the
   * configured provider's UNSIGNED hand-off, or the honest refusal. A
   * simulated fill does not exist in this module.
   */
  async function executeCheck(owner, { assetClass = null, instrument = null, side = null, amountUsd = null, correlationId = null } = {}) {
    const gate = requireFlag('TRADITIONAL_ASSETS_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const key = String(assetClass || '').toLowerCase();
    if (!ALL_CLASSES.includes(key)) {
      return { ok: false, code: 'UNKNOWN_ASSET_CLASS', detail: `${assetClass} is not a recognised class (expected one of ${ALL_CLASSES.join(', ')})`, simulated: false, executionPermission: false };
    }
    const status = executionStatus(key);
    const record = {
      id: `exec_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      owner,
      at: now(),
      assetClass: key,
      instrument: instrument ? String(instrument).toUpperCase() : null,
      side: side ? String(side).toLowerCase() : null,
      amountUsd: num(amountUsd),
      executionStatus: status,
      handoff: null,
      error: null,
      simulated: false,
      signs: false,
      submits: false,
      executionPermission: false
    };
    if (!status.available) {
      record.error = status.code;
      try { await collections?.put('traditional_opportunities', owner, record, { idKey: 'id' }); } catch { /* the refusal still answers */ }
      if (observability) observability.emit({ type: 'traditional-assets.execution-refused', owner, correlationId, payload: { assetClass: key, code: status.code } });
      return { ok: false, code: status.code, detail: status.note, execution: record, simulated: false, executionPermission: false };
    }
    if (key === 'crypto') {
      /* The real path is the brain's swap/bridge unsigned hand-off — this
         surface reports it, it does not duplicate it. */
      record.handoff = { module: 'swap', status: 'ROUTES_EXIST', detail: status.detail };
      try { await collections?.put('traditional_opportunities', owner, record, { idKey: 'id' }); } catch { /* the check still answers */ }
      return { ok: true, execution: record, simulated: false, executionPermission: false, detail: status.detail };
    }
    const provider = EXECUTION_PROVIDERS.get(key);
    let out = null;
    let error = null;
    try {
      out = await provider.execute({ owner, assetClass: key, instrument: record.instrument, side: record.side, amountUsd: record.amountUsd, signed: false });
    } catch (err) {
      error = String(err?.code || err?.message || err).slice(0, 120);
    }
    if (out && out.ok === true) record.handoff = { provider: provider.id, ...out };
    else {
      error = error || (out?.code || 'PROVIDER_REFUSED');
      record.error = error;
    }
    try { await collections?.put('traditional_opportunities', owner, record, { idKey: 'id' }); } catch { /* the check still answers */ }
    if (observability) observability.emit({ type: 'traditional-assets.execution-checked', owner, correlationId, payload: { assetClass: key, ok: record.error === null, via: record.handoff?.provider || null } });
    return record.error === null
      ? { ok: true, execution: record, simulated: false, executionPermission: false, detail: `unsigned hand-off from the configured provider ${provider.id}; the broker session and the user's confirmation are the next gates` }
      : { ok: false, code: record.error, detail: 'the configured provider refused or failed; nothing was simulated', execution: record, simulated: false, executionPermission: false };
  }

  return {
    schema: TRADITIONAL_ASSETS_SCHEMA,
    discover, scoreFor, allocateFor, executeCheck,
    normalizeOpportunity,
    discoverOpportunities,
    scoreOpportunities,
    allocateMultiClass,
    executionStatus,
    listExecutionProviders,
    registerExecutionProvider,
    unregisterExecutionProvider,
    CLASSES: ALL_CLASSES,
    TRADITIONAL: TRADITIONAL_CLASSES,
    PRESETS: MULTICLASS_PRESETS
  };
}
