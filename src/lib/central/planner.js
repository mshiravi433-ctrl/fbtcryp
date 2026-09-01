/**
 * FBT CENTRAL INTELLIGENCE OS — Central Planner (spec §13, §14, §18).
 * ---------------------------------------------------------------------------
 * Simple requests get one step. Complex ones get an ordered graph, and every
 * step names the module and the operation that will produce its input — which is
 * what makes §14 ("modules must not think separately") mechanical instead of
 * aspirational: a step that needs portfolio data must depend on a portfolio
 * read, and `validatePlan` rejects the plan if it does not.
 *
 * THE INVARIANT THIS FILE OWNS (§33, §44)
 * No plan reaches an EXECUTE step without a CONFIRM gate before it. That is
 * enforced in two places on purpose: the template builder inserts the gate, and
 * the validator refuses any plan (including one a model or a future developer
 * hand-authored) that lacks it. A prompt cannot re-order this; only this file
 * and `policy.js` decide.
 */
import { CI_SCHEMA, MODULE_OPERATIONS, PERMISSION, OPERATION_PERMISSION, RISK_CONTEXT } from './schema.js';

export const PLAN_SCHEMA = 'fbt.central-plan.v1';

/** A gate step is part of the plan, so "we asked" is auditable per intent. */
const CONFIRM_GATE = Object.freeze({
  id: 'confirm',
  module: 'policy',
  operation: 'confirmation',
  permission: PERMISSION.EXECUTE,
  gate: true,
  note: 'explicit user confirmation; never assumed from silence or from a prior "yes"'
});

const step = (id, module, operation, { dependsOn = [], input = {}, note = null, riskContext = null, optional = false } = {}) => ({
  id,
  module,
  operation,
  permission: OPERATION_PERMISSION[operation] || PERMISSION.READ,
  dependsOn: Array.from(new Set(dependsOn)),
  input,
  note,
  optional,
  riskContext
});

/*
 * Templates. `read` steps are cheap and idempotent, so they run first and in
 * parallel; `quote`/`simulate` need those reads; execution needs the gate.
 * The order of `dependsOn` is the data flow, not a wish.
 */
export const PLAN_TEMPLATES = Object.freeze({
  /* §29/§30 — an instrument question is a READ, and the only honest read of it is
     the module that would have to serve the price. When that module is registered
     UNAVAILABLE the step is pruned by the capability check and the turn ends in the
     registry's refusal; when a market feed exists for the symbol, it answers with
     that feed's number. Either way there is no path where a number is typed by hand. */
  INSTRUMENT_QUERY: () => [
    { id: 'markets.instrument', module: 'crypto', operation: 'read', permission: PERMISSION.READ, optional: true, dependsOn: [], produces: 'markets', input: { asset: null } }
  ],
  PORTFOLIO_ANALYSIS: () => [
    step('wallet.read', 'wallet', 'read'),
    step('portfolio.read', 'portfolio', 'read', { dependsOn: ['wallet.read'] }),
    step('markets.read', 'crypto', 'read', { input: { scope: 'holdings' } }),
    step('positions.read', 'lending', 'read', { optional: true, dependsOn: ['wallet.read'] }),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['portfolio.read', 'markets.read'], riskContext: 'portfolio', note: 'central risk engine, shared with every other module (§24)' }),
    step('present', 'session', 'read', { dependsOn: ['wallet.read', 'portfolio.read', 'markets.read', 'risk.analyze'] })
  ],
  CONCENTRATION_CHECK: () => [
    step('portfolio.read', 'portfolio', 'read'),
    step('risk.concentration', 'risk', 'read', { dependsOn: ['portfolio.read'], input: { factor: 'concentration' } }),
    step('present', 'session', 'read', { dependsOn: ['portfolio.read', 'risk.concentration'] })
  ],
  ASSET_ANALYSIS: () => [
    step('markets.read', 'crypto', 'read', { input: { include: ['price', 'volume', 'volatility'] } }),
    step('signals.read', 'signals', 'read', { optional: true }),
    step('news.read', 'news', 'read', { optional: true }),
    step('portfolio.exposure', 'portfolio', 'read', { dependsOn: [], input: { factor: 'exposure' } }),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['markets.read'], input: { scope: 'asset' } }),
    step('present', 'session', 'read', { dependsOn: ['markets.read', 'signals.read', 'news.read', 'risk.analyze'] })
  ],
  BALANCE_QUERY: () => [
    step('wallet.read', 'wallet', 'read'),
    step('present', 'session', 'read', { dependsOn: ['wallet.read'] })
  ],
  LOAN_STATUS: () => [
    step('lending.positions', 'lending', 'read', { input: { include: ['collateral', 'debt', 'healthFactor'] } }),
    step('wallet.read', 'wallet', 'read'),
    step('oracle.check', 'lending', 'read', { dependsOn: ['lending.positions'], input: { factor: 'oracle' }, note: 'an oracle reading is part of the risk number, not an afterthought (§24)' }),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['lending.positions'], riskContext: 'borrowing', input: { factor: 'liquidationDistance' } }),
    step('present', 'session', 'read', { dependsOn: ['lending.positions', 'wallet.read', 'risk.analyze', 'oracle.check'] })
  ],
  BORROW_CAPACITY: () => [
    step('lending.market', 'lending', 'read', { input: { scope: 'market', asset: '$asset', network: '$network' } }),
    step('portfolio.read', 'portfolio', 'read'),
    step('borrow.capacity', 'borrowing', 'read', { dependsOn: ['lending.market', 'portfolio.read'] }),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['borrow.capacity'], riskContext: 'borrowing' }),
    step('present', 'session', 'read', { dependsOn: ['borrow.capacity', 'risk.analyze'] })
  ],
  FUTURES_RISK: () => [
    step('futures.read', 'futures', 'read'),
    step('dydx.read', 'dydx', 'read', { optional: true }),
    step('portfolio.read', 'portfolio', 'read'),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['futures.read', 'portfolio.read'], riskContext: 'futures', note: 'new leverage is evaluated against the WHOLE portfolio (§24)' }),
    step('present', 'session', 'read', { dependsOn: ['futures.read', 'portfolio.read', 'risk.analyze'] })
  ],
  MARKET_OVERVIEW: () => [
    step('markets.read', 'crypto', 'read', { input: { include: ['price', 'volume', 'funding', 'openInterest'] } }),
    step('signals.read', 'signals', 'read', { optional: true }),
    step('news.read', 'news', 'read', { optional: true }),
    step('present', 'session', 'read', { dependsOn: ['markets.read', 'signals.read', 'news.read'] })
  ],
  NEWS_SUMMARY: () => [
    step('news.read', 'news', 'read'),
    step('signals.read', 'signals', 'read', { optional: true }),
    step('markets.read', 'crypto', 'read', { optional: true }),
    step('present', 'session', 'read', { dependsOn: ['news.read', 'signals.read'] })
  ],
  SIGNAL_READING: () => [
    step('signals.read', 'signals', 'read'),
    step('markets.read', 'crypto', 'read'),
    step('news.read', 'news', 'read', { optional: true }),
    step('present', 'session', 'read', { dependsOn: ['signals.read', 'markets.read'] })
  ],
  WHATIF_SIMULATION: () => [
    step('portfolio.read', 'portfolio', 'read'),
    step('markets.read', 'crypto', 'read'),
    step('forecast.read', 'forecast', 'read', { optional: true }),
    step('lab.simulate', 'lab', 'simulate', { dependsOn: ['portfolio.read', 'markets.read'], input: { scenario: 'shock', shockPct: '$percent' } }),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['lab.simulate'], input: { scope: 'post-shock' } }),
    step('present', 'session', 'read', { dependsOn: ['lab.simulate', 'risk.analyze'] })
  ],
  GOAL_PLAN: () => [
    step('goals.read', 'goals', 'read', { optional: true }),
    step('portfolio.read', 'portfolio', 'read'),
    step('markets.read', 'crypto', 'read'),
    step('forecast.read', 'forecast', 'read', { optional: true }),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['portfolio.read'], riskContext: 'goals' }),
    step('goals.plan', 'goals', 'simulate', { dependsOn: ['goals.read', 'portfolio.read', 'forecast.read', 'risk.analyze'] }),
    step('profitPlan.read', 'profit-plan', 'read', { optional: true }),
    step('present', 'session', 'read', { dependsOn: ['goals.plan', 'risk.analyze'] })
  ],
  PROFIT_PLAN: () => [
    step('portfolio.read', 'portfolio', 'read'),
    step('markets.read', 'crypto', 'read'),
    step('signals.read', 'signals', 'read', { optional: true }),
    step('forecast.read', 'forecast', 'read', { optional: true }),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['portfolio.read', 'markets.read'] }),
    step('profitPlan.optimize', 'profit-plan', 'simulate', { dependsOn: ['portfolio.read', 'risk.analyze', 'forecast.read'] }),
    step('present', 'session', 'read', { dependsOn: ['profitPlan.optimize', 'risk.analyze'] })
  ],
  QUOTE_SWAP: () => [
    step('wallet.read', 'wallet', 'read'),
    step('markets.read', 'crypto', 'read'),
    step('swap.quote', 'swap', 'quote', { dependsOn: ['wallet.read', 'markets.read'], input: { from: '$fromAsset', to: '$toAsset', amountUsd: '$amountUsd' } }),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['swap.quote'], riskContext: 'swap' }),
    step('present', 'session', 'read', { dependsOn: ['swap.quote', 'risk.analyze'] })
  ],
  QUOTE_BRIDGE: () => [
    step('wallet.read', 'wallet', 'read'),
    step('bridge.quote', 'bridge', 'quote', { dependsOn: ['wallet.read'], input: { asset: '$asset', toNetwork: '$destinationNetwork' } }),
    step('present', 'session', 'read', { dependsOn: ['bridge.quote'] })
  ],
  EXECUTE_SWAP: () => [
    step('wallet.read', 'wallet', 'read'),
    step('markets.read', 'crypto', 'read'),
    step('swap.quote', 'swap', 'quote', { dependsOn: ['wallet.read', 'markets.read'], input: { from: '$fromAsset', to: '$toAsset', amountUsd: '$amountUsd' } }),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['swap.quote'], riskContext: 'swap' }),
    step('swap.prepare', 'swap', 'prepare', { dependsOn: ['swap.quote', 'risk.analyze'] }),
    step('swap.simulate', 'swap', 'simulate', { dependsOn: ['swap.prepare'] }),
    { ...CONFIRM_GATE, dependsOn: ['swap.simulate', 'risk.analyze'] },
    step('swap.execute', 'swap', 'execute', { dependsOn: ['confirm', 'swap.simulate'] }),
    step('swap.verify', 'swap', 'verify', { dependsOn: ['swap.execute'] }),
    step('state.refresh', 'registry', 'read', { dependsOn: ['swap.verify'], note: '§16 cascade: wallet → portfolio → risk → goals → alerts' }),
    step('present', 'session', 'read', { dependsOn: ['swap.verify', 'state.refresh'] })
  ],
  EXECUTE_BRIDGE: () => [
    step('wallet.read', 'wallet', 'read'),
    step('bridge.quote', 'bridge', 'quote', { dependsOn: ['wallet.read'], input: { asset: '$asset', toNetwork: '$destinationNetwork', amountUsd: '$amountUsd' } }),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['bridge.quote'], riskContext: 'bridge' }),
    step('bridge.prepare', 'bridge', 'prepare', { dependsOn: ['bridge.quote', 'risk.analyze'] }),
    step('bridge.simulate', 'bridge', 'simulate', { dependsOn: ['bridge.prepare'] }),
    { ...CONFIRM_GATE, dependsOn: ['bridge.simulate'] },
    step('bridge.execute', 'bridge', 'execute', { dependsOn: ['confirm', 'bridge.simulate'] }),
    step('bridge.verify', 'bridge', 'verify', { dependsOn: ['bridge.execute'] }),
    step('state.refresh', 'registry', 'read', { dependsOn: ['bridge.verify'] }),
    step('present', 'session', 'read', { dependsOn: ['bridge.verify', 'state.refresh'] })
  ],
  EXECUTE_LEND: () => [
    step('lending.market', 'lending', 'read'),
    step('wallet.read', 'wallet', 'read'),
    step('lending.quote', 'lending', 'quote', { dependsOn: ['lending.market', 'wallet.read'] }),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['lending.quote'], riskContext: 'lending' }),
    step('lending.prepare', 'lending', 'prepare', { dependsOn: ['lending.quote'] }),
    step('lending.simulate', 'lending', 'simulate', { dependsOn: ['lending.prepare'] }),
    { ...CONFIRM_GATE, dependsOn: ['lending.simulate'] },
    step('lending.execute', 'lending', 'execute', { dependsOn: ['confirm'] }),
    step('lending.verify', 'lending', 'verify', { dependsOn: ['lending.execute'] }),
    step('state.refresh', 'registry', 'read', { dependsOn: ['lending.verify'], note: '§16: position → portfolio → risk → health factor → goals → alerts' }),
    step('present', 'session', 'read', { dependsOn: ['lending.verify'] })
  ],
  EXECUTE_BORROW: () => [
    step('lending.market', 'borrowing', 'read'),
    step('wallet.read', 'wallet', 'read'),
    step('borrow.capacity', 'borrowing', 'read', { dependsOn: ['lending.market'] }),
    step('borrow.quote', 'borrowing', 'quote', { dependsOn: ['borrow.capacity'] }),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['borrow.quote'], riskContext: 'borrowing' }),
    step('borrow.prepare', 'borrowing', 'prepare', { dependsOn: ['borrow.quote', 'risk.analyze'] }),
    step('borrow.simulate', 'borrowing', 'simulate', { dependsOn: ['borrow.prepare'] }),
    { ...CONFIRM_GATE, dependsOn: ['borrow.simulate'] },
    step('borrow.execute', 'borrowing', 'execute', { dependsOn: ['confirm'] }),
    step('borrow.verify', 'borrowing', 'verify', { dependsOn: ['borrow.execute'] }),
    step('state.refresh', 'registry', 'read', { dependsOn: ['borrow.verify'] }),
    step('present', 'session', 'read', { dependsOn: ['borrow.verify'] })
  ],
  EXECUTE_REPAY: () => [
    step('lending.positions', 'lending', 'read'),
    step('repay.quote', 'borrowing', 'quote', { dependsOn: ['lending.positions'] }),
    step('repay.prepare', 'borrowing', 'prepare', { dependsOn: ['repay.quote'] }),
    { ...CONFIRM_GATE, dependsOn: ['repay.prepare'] },
    step('repay.execute', 'borrowing', 'execute', { dependsOn: ['confirm'] }),
    step('repay.verify', 'borrowing', 'verify', { dependsOn: ['repay.execute'] }),
    step('state.refresh', 'registry', 'read', { dependsOn: ['repay.verify'] }),
    step('present', 'session', 'read', { dependsOn: ['repay.verify'] })
  ],
  EXECUTE_REBALANCE: () => [
    step('portfolio.read', 'portfolio', 'read'),
    step('markets.read', 'crypto', 'read'),
    step('risk.analyze', 'risk', 'read', { dependsOn: ['portfolio.read'], riskContext: 'rebalance' }),
    step('portfolio.plan', 'portfolio', 'simulate', { dependsOn: ['risk.analyze', 'markets.read'] }),
    { ...CONFIRM_GATE, dependsOn: ['portfolio.plan'] },
    step('swap.execute', 'swap', 'execute', { dependsOn: ['confirm', 'portfolio.plan'], note: 'each leg is its own action with its own idempotency key (§34)' }),
    step('swap.verify', 'swap', 'verify', { dependsOn: ['swap.execute'] }),
    step('state.refresh', 'registry', 'read', { dependsOn: ['swap.verify'] }),
    step('present', 'session', 'read', { dependsOn: ['state.refresh'] })
  ],
  CREATE_GOAL: () => [
    step('portfolio.read', 'portfolio', 'read'),
    step('goals.prepare', 'goals', 'prepare', { dependsOn: ['portfolio.read'], input: { targetUsd: '$targetUsd', horizon: '$horizon' } }),
    { ...CONFIRM_GATE, dependsOn: ['goals.prepare'], permission: PERMISSION.PREPARE },
    step('goals.execute', 'goals', 'execute', { dependsOn: ['confirm'] }),
    step('goals.verify', 'goals', 'verify', { dependsOn: ['goals.execute'] })
  ],
  SET_ALERT: () => [
    step('markets.read', 'crypto', 'read'),
    step('alerts.prepare', 'alerts', 'prepare', { input: { symbol: '$asset', condition: '$explicit' } }),
    { ...CONFIRM_GATE, dependsOn: ['alerts.prepare'], permission: PERMISSION.PREPARE },
    step('alerts.execute', 'alerts', 'execute', { dependsOn: ['confirm'] }),
    step('alerts.verify', 'alerts', 'verify', { dependsOn: ['alerts.execute'] })
  ],
  CONFIRM_PENDING: () => [],
  CANCEL_PENDING: () => [],
  NAVIGATE: () => [step('session.navigate', 'session', 'read', { input: { route: '$page.module' } })],
  UNSUPPORTED: () => []
});

export function templateFor(intentType) {
  const build = PLAN_TEMPLATES[intentType];
  return build ? build() : [];
}

/**
 * Resolve the template against reality: drop steps whose module is not
 * registered or whose capability forbids the operation, keep a record of WHY
 * (so the answer can say "signals were unavailable, so this is price-only"
 * instead of silently shrinking), and re-point dependents.
 */
export function buildPlan({ intent, capabilities = {}, registry = {}, health = {}, state = null, now = Date.now() } = {}) {
  let raw = templateFor(intent.intentType).map((s) => ({ ...s, input: bindEntities(s.input, intent.entities) }));
  /* §12/§13 — a compound request («convert, then bridge to Arbitrum») is ONE plan
     with both legs, ordered, with the single confirmation gate placed before the
     first money-moving step. Merging templates rather than running two turns is the
     point: two turns race, and a user who confirmed the first leg would have to be
     asked again for a route the second leg might make impossible. Step ids already
     carry their module (`swap.quote`, `bridge.quote`), so shared reads collapse to
     one fetch and each leg's `dependsOn` still resolves. */
  const legs = Array.from(new Set((intent.compound || []).map((c) => c.intent).filter((t) => t && t !== intent.intentType)));
  const seenIds = new Set(raw.map((r) => r.id));
  for (const leg of legs) {
    for (const step of templateFor(leg)) {
      if (seenIds.has(step.id)) continue;
      seenIds.add(step.id);
      raw.push({ ...step, input: bindEntities(step.input, intent.entities), leg });
    }
  }
  if (legs.length) raw = raw.map((r) => ({ ...r, compound: legs.slice() }));
  const steps = [];
  const skipped = [];
  for (const candidate of raw) {
    if (candidate.module === 'policy' || candidate.module === 'session' || candidate.module === 'registry') {
      steps.push({ ...candidate, status: 'READY' });
      continue;
    }
    const registered = registry[candidate.module];
    const cap = capabilities[candidate.module] || registered?.capability || null;
    if (!registered) {
      skipped.push({ id: candidate.id, module: candidate.module, reason: 'MODULE_NOT_REGISTERED', optional: candidate.optional });
      continue;
    }
    if (cap === 'UNAVAILABLE' || cap === 'INCOMPLETE') {
      skipped.push({ id: candidate.id, module: candidate.module, reason: `CAPABILITY_${cap}`, optional: candidate.optional });
      continue;
    }
    if (candidate.permission === PERMISSION.EXECUTE && (cap === 'READ_ONLY' || cap === 'DEGRADED')) {
      skipped.push({ id: candidate.id, module: candidate.module, reason: `CAPABILITY_${cap}_BLOCKS_EXECUTE`, optional: false });
      continue;
    }
    if (!MODULE_OPERATIONS.includes(candidate.operation) && candidate.operation !== 'confirmation') {
      skipped.push({ id: candidate.id, module: candidate.module, reason: 'OPERATION_NOT_DECLARED', optional: candidate.optional });
      continue;
    }
    if (candidate.operation === 'prepare' || candidate.operation === 'quote') {
      if (typeof registered.prepare !== 'function' && candidate.operation === 'prepare') {
        skipped.push({ id: candidate.id, module: candidate.module, reason: 'OPERATION_NOT_IMPLEMENTED', optional: candidate.optional });
        continue;
      }
    }
    const degradation = health[candidate.module]?.status && health[candidate.module].status !== 'HEALTHY'
      ? { degraded: true, detail: String(health[candidate.module].detail || health[candidate.module].status).slice(0, 80) }
      : null;
    steps.push({ ...candidate, status: 'READY', ...(degradation ? { degraded: true, degradedDetail: degradation.detail } : {}) });
  }
  const kept = new Set(steps.map((s) => s.id));
  /* A leg whose modules were pruned must not leave a dangling dependency, and the
     ordering between legs is preserved by the ids the templates already declare. */
  const pruned = steps.map((s) => ({
    ...s,
    dependsOn: s.dependsOn.filter((d) => kept.has(d)),
    droppedDeps: s.dependsOn.filter((d) => !kept.has(d))
  }));
  let order = topoSort(pruned);
  /* The presentation and refresh steps are the TAIL of a turn, whatever the order
     the templates were merged in. Left in place they would "present" a plan whose
     second leg had not run yet — a reply about a half-finished action. */
  const tail = order.filter((x) => x.id === 'state.refresh' || x.id === 'present');
  if (tail.length) order = [...order.filter((x) => !tail.includes(x)), ...tail];
  const plan = {
    schema: PLAN_SCHEMA,
    brain: CI_SCHEMA,
    intentId: intent.intentId,
    builtAt: now,
    steps: order,
    skipped,
    hasGate: pruned.some((s) => s.gate === true),
    executable: pruned.some((s) => s.permission === PERMISSION.EXECUTE),
    /** §13: nothing here may be executed without a confirmation, in any plan. */
    readOnly: pruned.every((s) => s.permission === PERMISSION.READ),
    requiredSections: Array.from(new Set(pruned.flatMap((s) => sectionsFor(s, intent))))
  };
  return { plan, problems: validatePlan(plan) };
}

function sectionsFor(s, intent) {
  const map = { wallet: 'wallet', portfolio: 'portfolio', crypto: 'markets', lending: 'lending', borrowing: 'borrowing', futures: 'futures', dydx: 'dydx', signals: 'signals', news: 'news', goals: 'goals', 'profit-plan': 'profitPlan', alerts: 'alerts', transactions: 'transactions' };
  const base = map[s.module];
  const risk = s.riskContext ? (RISK_CONTEXT[s.riskContext]?.sections || []) : [];
  return [base, ...risk].filter(Boolean);
}

function bindEntities(input = {}, entities = {}) {
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string' && v.startsWith('$')) {
      const key = v.slice(1);
      out[k] = entities?.[key] ?? null;
    } else out[k] = v;
  }
  return out;
}

function topoSort(steps) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const seen = new Set();
  const out = [];
  const visit = (node, path) => {
    if (seen.has(node.id)) return;
    if (path.has(node.id)) return; // cycle: leave ordering to the template, never throw on it
    const next = new Set(path).add(node.id);
    for (const dep of node.dependsOn) {
      const d = byId.get(dep);
      if (d) visit(d, next);
    }
    seen.add(node.id);
    out.push(node);
  };
  for (const s of steps) visit(s, new Set());
  return out;
}

/**
 * The two things a plan must never be, checked structurally so no future
 * template can regress them.
 */
export function validatePlan(plan) {
  const problems = [];
  const index = new Map(plan.steps.map((s, i) => [s.id, i]));
  const executeSteps = plan.steps.filter((s) => s.permission === PERMISSION.EXECUTE && s.operation === 'execute');
  for (const ex of executeSteps) {
    const gateIdx = index.get('confirm');
    const exIdx = index.get(ex.id);
    if (gateIdx === undefined) problems.push({ code: 'MISSING_CONFIRMATION_GATE', step: ex.id });
    else if (gateIdx > exIdx) problems.push({ code: 'CONFIRMATION_GATE_AFTER_EXECUTE', step: ex.id });
    else if (!(ex.dependsOn || []).includes('confirm')) problems.push({ code: 'EXECUTE_STEP_NOT_GATED', step: ex.id });
  }
  for (const s of plan.steps) {
    for (const d of s.dependsOn || []) if (!index.has(d)) problems.push({ code: 'DANGLING_DEPENDENCY', step: s.id, dependsOn: d });
  }
  return problems;
}

/**
 * §13's "complex request" example, verbatim in shape: portfolio → risk →
 * correlations → exposure → opportunities → recommendation → simulation.
 * Used when the user asks to reduce risk and find the best path, which the old
 * system answered with a paragraph instead of a sequence.
 */
export function buildRiskReductionPlan({ intent, capabilities = {}, registry = {} } = {}) {
  const seq = [
    ['wallet.read', 'wallet', 'read'],
    ['portfolio.read', 'portfolio', 'read'],
    ['markets.read', 'crypto', 'read'],
    ['risk.analyze', 'risk', 'read'],
    ['risk.correlations', 'risk', 'read'],
    ['risk.exposure', 'risk', 'read'],
    ['opportunities.scan', 'signals', 'read'],
    ['recommendations.generate', 'portfolio', 'read'],
    ['lab.simulate', 'lab', 'simulate'],
    ['presentPlan', 'session', 'read']
  ];
  const steps = [];
  const skipped = [];
  let prev = null;
  for (const [id, module, operation] of seq) {
    if (module !== 'risk' && module !== 'session' && !registry[module]) {
      skipped.push({ id, module, reason: 'MODULE_NOT_REGISTERED' });
      continue;
    }
    if (module !== 'session' && capabilities[module] === 'UNAVAILABLE') {
      skipped.push({ id, module, reason: 'CAPABILITY_UNAVAILABLE' });
      continue;
    }
    steps.push(step(id, module, operation, { dependsOn: prev ? [prev] : [], note: 'risk-reduction plan (§13)' }));
    prev = id;
  }
  const plan = { schema: PLAN_SCHEMA, kind: 'RISK_REDUCTION', intentId: intent?.intentId || null, steps, skipped, hasGate: false, executable: false, readOnly: true };
  return { plan, problems: validatePlan(plan) };
}
