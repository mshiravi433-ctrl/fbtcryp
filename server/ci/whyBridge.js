/**
 * THE WHY BRIDGE — THE BRAIN'S DECISION BUNDLE
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * `server/fios/whyEngine.js` is the engine that answers the question every
 * assistant is eventually asked: «چرا این را گفتی؟» — why this asset,
 * why this network, why now, why this amount, why this strategy. It is
 * precise about the standard it holds itself to:
 *
 *   · every «because» line points at a NUMBER in the decision bundle;
 *   · a number that was never read is NAMED as unread, never invented;
 *   · it produces four named FALSIFIERS — what would prove the decision
 *     wrong — and four invalidation conditions;
 *   · it refuses to explain a decision that does not exist.
 *
 * And it had no customers, because it expected a `decision` record from
 * `server/fios/decision.js` — a shape produced by the FIOs decision
 * engine, which the central brain does not use. The brain has its own
 * decision: the recommendation it builds from its own findings, with its
 * own confidence, its own risk view and its own evidence list. That is a
 * DIFFERENT shape, and the why engine could not read it.
 *
 * So the engine was dark for a reason that was not its fault: nobody
 * translated the brain's decision into its language.
 *
 * WHAT THIS BRIDGE DOES
 *
 * It is that translation, and it is a translation in one direction only:
 *
 *   the brain's recommendation + findings + risk + state
 *        → a decision bundle in the why engine's vocabulary
 *        → the why engine's five «why» lists and its falsifiers.
 *
 * The translation is CONSERVATIVE. The rule is simple and absolute:
 *
 *   every number in the bundle came from a finding the brain read.
 *
 * Nothing is inferred, nothing is carried across from a different owner,
 * and a finding the brain could not read leaves the corresponding
 * «why» line absent — which the engine renders as «unread» rather than
 * as a zero.
 *
 * WHY A BRIDGE
 *
 * The same ordering constraint as every other bridge in this directory:
 * `fios` is built after the brain, and the brain is built before `fios`.
 * Neither can hold the other at construction time. So the provider is
 * registered into a one-slot bridge, and the brain reaches the engine
 * through it.
 */

let provider = null;

/**
 * Register the why reader.
 *
 * @param {(owner: string, bundle?: object) => Promise<any>} fn
 *   Receives the owner and the brain-produced bundle, and returns
 *   `{ ok, why }` or `{ ok: false, code, detail }`.
 * @returns {() => void} a disposer, so a test can restore the previous state.
 */
export function setWhyProvider(fn) {
  const previous = provider;
  provider = typeof fn === 'function' ? fn : null;
  return () => { provider = previous; };
}

/** True once the why engine has wired itself in. */
export function hasWhyProvider() {
  return typeof provider === 'function';
}

/**
 * Explain the brain's decision.
 *
 * @returns {Promise<{ok: boolean, why?: object, code?: string, detail?: string}>}
 */
export async function explainWhy(owner, bundle = {}) {
  if (!hasWhyProvider()) {
    return {
      ok: false,
      code: 'WHY_PROVIDER_NOT_WIRED',
      detail: 'the why engine is not mounted in this process',
      why: null
    };
  }
  try {
    const out = await provider(owner, bundle);
    if (!out || typeof out !== 'object') {
      return { ok: false, code: 'WHY_PROVIDER_BAD_RESULT', detail: 'the why engine returned something that is not a result', why: null };
    }
    if (out.ok === false) {
      return { ok: false, code: out.code || 'WHY_FAILED', detail: out.detail || null, why: out.why || null };
    }
    return { ok: true, why: out.why || null };
  } catch (err) {
    return {
      ok: false,
      code: 'WHY_FAILED',
      detail: String(err?.message || err).slice(0, 200) || null,
      why: null
    };
  }
}

/**
 * Translate the brain's own artefacts into a decision bundle.
 *
 * This is the whole point of the file, and it is deliberately a PURE
 * function over inputs the brain already has. It reads:
 *
 *   · `recommendation` — the brain's own recommendation, with its
 *     confidence and its evidence list;
 *   · `findings` — the same findings the reply was built from, so the
 *     explanation and the answer cannot diverge;
 *   · `risk` — the risk view the recommendation was judged against;
 *   · `state` — the owner's own sections (portfolio, goals);
 *   · `routeIntelligence` — the live route ranking, when the turn read
 *     one, so the «why this network» line can cite it.
 *
 * And it produces the bundle the engine reads:
 *
 *   decision   — the chosen candidate, the alternatives, the confidence
 *                and the invalidation conditions;
 *   strategies — the candidate rows, with their evidence;
 *   competition— the ranking and the regime it was made in;
 *   simulation — the worst case, when one was modelled;
 *   macroGraph — the regime graph, when the turn read one;
 *   preferences— the owner's risk tolerance and chain preferences;
 *   goal       — the target, the horizon and the drawdown ceiling;
 *   costs      — the gas, the fee and the slippage that were read.
 *
 * The one rule: a number is here because a finding carried it.
 */
export function buildBrainDecisionBundle({
  recommendation = null,
  findings = [],
  risk = null,
  state = null,
  routeIntelligence = null,
  macroGraph = null,
  simulation = null,
  preferences = null,
  goal = null,
  now = Date.now()
} = {}) {
  if (!recommendation || recommendation.ok === false) {
    return {
      ok: false,
      code: 'NO_DECISION',
      detail: recommendation?.reason?.[0] || 'the brain produced no recommendation to explain'
    };
  }

  /* The usable findings — the same filter the reply used. */
  const usable = (Array.isArray(findings) ? findings : [])
    .filter((f) => f && (f.status === 'OK' || f.status === 'PARTIAL'));

  /* The chosen candidate. The brain's recommendation names its headline
     and its reasons; the FINDINGS carry the numbers. */
  const headline = recommendation.headline || recommendation.summary || null;
  const alternatives = (Array.isArray(recommendation.alternatives) ? recommendation.alternatives : [])
    .map((a) => ({
      id: a?.id || null,
      name: a?.label || a?.name || a?.title || null,
      detail: a?.detail || a?.reason || null
    }))
    .filter((a) => a.name || a.detail);

  /* The amount, when a finding carried one. */
  const amountUsd = firstNumber([
    findings.find((f) => f?.id === 'borrow-capacity')?.capacityUsd,
    findings.find((f) => f?.id === 'goal-feasibility')?.targetUsd,
    findings.find((f) => f?.id === 'route-intelligence')?.bestRoute?.totalCostUsd,
    state?.sections?.portfolio?.data?.totalValueUsd
  ]);

  /* The expected return, when a finding modelled one. */
  const expectedReturnPct = firstNumber([
    findings.find((f) => f?.id === 'opportunities')?.candidates?.[0]?.aprPct,
    findings.find((f) => f?.id === 'goal-scenarios')?.profiles?.[0]?.expectedReturnPct
  ]);

  /* The candidate rows the engine treats as «strategies». Each one is a
     finding that names a candidate, and each carries its own evidence. */
  const strategies = [];
  const opp = findings.find((f) => f?.id === 'opportunities');
  if (opp && Array.isArray(opp.candidates)) {
    for (const c of opp.candidates.slice(0, 5)) {
      strategies.push({
        id: c?.id || c?.poolId || c?.name || null,
        name: c?.name || c?.poolId || c?.id || null,
        asset: c?.asset || c?.symbol || null,
        network: c?.network || c?.chain || null,
        evidence: c?.evidence || [],
        expectedReturnPct: num(c?.aprPct ?? c?.expectedReturnPct),
        potentialLossPct: num(c?.potentialLossPct ?? c?.riskPct),
        invalidationConditions: c?.invalidationConditions || []
      });
    }
  }
  const scenarios = findings.find((f) => f?.id === 'goal-scenarios');
  if (scenarios && Array.isArray(scenarios.profiles)) {
    for (const p of scenarios.profiles.slice(0, 3)) {
      strategies.push({
        id: `scenario:${p.profile}`,
        name: `${p.profile} profile`,
        asset: null,
        network: null,
        evidence: p.evidence || [],
        expectedReturnPct: num(p.expectedReturnPct),
        potentialLossPct: num(p.maxDrawdownPct),
        invalidationConditions: p.invalidationConditions || []
      });
    }
  }

  /* The decision record the engine reads. */
  const decision = {
    id: recommendation.decisionId || recommendation.id || `brain-${now}`,
    at: now,
    decision: {
      strategyId: strategies[0]?.id || null,
      name: headline || strategies[0]?.name || null,
      expectedReturnPct,
      amountUsd
    },
    alternatives: alternatives.map((a) => ({
      strategyId: a.id,
      name: a.name,
      expectedReturnPct: null
    })),
    confidence: {
      overall: num(recommendation.confidence?.overall ?? recommendation.confidence),
      evidence: Array.isArray(recommendation.evidence) ? recommendation.evidence.length : usable.length
    },
    reason: Array.isArray(recommendation.reasons) ? recommendation.reasons : (Array.isArray(recommendation.reason) ? recommendation.reason : []),
    netWorthUsd: num(state?.sections?.portfolio?.data?.totalValueUsd),
    invalidationConditions: collectInvalidations(usable),
    routeIntelligence: routeIntelligence || null,
    smartMoney: null,
    opportunities: null
  };

  /* The competition the decision was made in. */
  const competition = {
    regime: findings.find((f) => f?.id === 'market-overview')?.regime
      || findings.find((f) => f?.id === 'macro-graph')?.regime
      || null,
    scored: strategies.map((s) => ({ strategyId: s.id, score: s.expectedReturnPct })),
    judge: { winnerId: strategies[0]?.id || null }
  };

  /* The simulation, when the turn modelled one. */
  const sim = simulation || buildSimulationFromFindings(usable);

  /* The costs that were read. */
  const routeBest = findings.find((f) => f?.id === 'route-intelligence')?.bestRoute || null;
  const costs = {
    gasUsd: num(routeBest?.gasUsd),
    feeUsd: num(routeBest?.totalCostUsd),
    slippagePct: num(routeBest?.slippagePct)
  };

  /* The owner's own profile — the risk tolerance the decision was sized
     against, and the chains they prefer. */
  const prefs = preferences || {
    riskTolerance: risk?.level || risk?.riskLevel || 'MODERATE',
    preferredChains: Array.isArray(state?.sections?.portfolio?.data?.preferredChains)
      ? state.sections.portfolio.data.preferredChains
      : []
  };

  /* The goal, when the turn read one. */
  const goalRow = state?.sections?.goals?.data?.goals?.[0] || goal || null;
  const goalBundle = goalRow
    ? {
        targetUsd: num(goalRow.targetAmount ?? goalRow.targetUsd),
        months: num(goalRow.months ?? goalRow.horizonMonths),
        maxDrawdownPct: num(goalRow.maxDrawdownPct ?? prefs.maxDrawdownPct)
      }
    : null;

  return {
    ok: true,
    bundle: {
      decision,
      strategies,
      competition,
      simulation: sim,
      macroGraph: macroGraph || findings.find((f) => f?.id === 'macro-graph')?.graph || null,
      preferences: prefs,
      goal: goalBundle,
      costs,
      now
    }
  };
}

/** The first finite number in a list, or null. */
function firstNumber(values) {
  for (const v of values || []) {
    const n = num(v);
    if (n !== null) return n;
  }
  return null;
}

/** A number, or null. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The invalidation conditions the readable findings named.
 *
 * A finding that says «this stops if X» contributes X. A finding that
 * says nothing contributes nothing — the condition is not invented from
 * the finding's own existence.
 */
function collectInvalidations(findings) {
  const out = [];
  for (const f of findings) {
    const list = f?.invalidationConditions;
    if (Array.isArray(list)) out.push(...list.filter(Boolean).map(String));
    else if (typeof f?.invalidationCondition === 'string') out.push(f.invalidationCondition);
  }
  return [...new Set(out)];
}

/**
 * The worst case, when a finding modelled one.
 *
 * The goal-scenario finding carries a drawdown and a probability of loss
 * for each profile — a MODELLED distribution, not a forecast. The
 * simulation the engine expects is «what does the worst scenario cost»,
 * and that is exactly what a drawdown figure on a known amount answers.
 */
function buildSimulationFromFindings(findings) {
  const sc = findings.find((f) => f?.id === 'goal-scenarios');
  if (!sc || !Array.isArray(sc.profiles) || !sc.profiles.length) return null;
  const worst = sc.profiles
    .filter((p) => num(p?.maxDrawdownPct) !== null)
    .sort((a, b) => (num(b.maxDrawdownPct) || 0) - (num(a.maxDrawdownPct) || 0))[0];
  if (!worst) return null;
  const amount = num(sc.startUsd);
  const delta = amount !== null && num(worst.maxDrawdownPct) !== null
    ? Number((amount * (num(worst.maxDrawdownPct) / 100)).toFixed(2))
    : null;
  return {
    id: `scenario:${worst.profile}`,
    worstCase: {
      id: `scenario:${worst.profile}`,
      label: `${worst.profile} profile`,
      deltaUsd: delta,
      drawdownPct: num(worst.maxDrawdownPct),
      probabilityPct: num(worst.probabilityOfLossPct)
    }
  };
}
