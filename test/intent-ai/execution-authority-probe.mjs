#!/usr/bin/env node
/**
 * Execution authority probe — proves executionPermission + guaranteed can
 * activate, but ONLY when every gate passes, and that returns stay unguaranteed.
 *
 * Run: node test/intent-ai/execution-authority-probe.mjs
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const results = [];
const check = (name, ok) => {
  results.push({ name, ok: Boolean(ok) });
  if (!ok) console.error(`  ✗ ${name}`);
};

try {
  const {
    resolveExecutionAuthority,
    limitsFromContext,
    EXECUTION_AUTHORITY_SCHEMA
  } = await import('../../server/fios/executionAuthority.js');
  const { createDecisionEngine } = await import('../../server/fios/decision.js');
  const { createCollections } = await import('../../server/fios/collections.js');
  const { createEvidenceStore } = await import('../../server/fios/evidence.js');
  const { createTraceStore } = await import('../../server/fios/trace.js');
  const { createConfidenceEngine } = await import('../../server/fios/confidence.js');

  /* ── pure resolver ───────────────────────────────────────────────────── */
  const idle = resolveExecutionAuthority({});
  check('default is proposal-only (both flags false)',
    idle.executionPermission === false && idle.guaranteed === false && idle.returnGuaranteed === false);

  const half = resolveExecutionAuthority({
    executionRequested: true,
    userConfirmed: true,
    authorizationScreenShown: true
    /* missing guardian + policy + confidence + chosen */
  });
  check('partial gates stay blocked',
    half.executionPermission === false && half.guaranteed === false && half.blockers.length >= 2);

  const full = resolveExecutionAuthority({
    executionRequested: true,
    userConfirmed: true,
    authorizationScreenShown: true,
    guardianApproved: true,
    policyVerdict: { ok: true, decision: 'ALLOW', policyId: 'pol_test' },
    confidence: { actionable: true, overall: 0.8, blockers: [] },
    risk: { level: 'MODERATE' },
    chosen: { id: 'hold', type: 'HOLD', strategyId: 'hold' },
    liveSimulation: true
  });
  check('all gates → executionPermission true', full.executionPermission === true && full.executionAuthorized === true);
  check('all gates → process guaranteed true', full.guaranteed === true && full.processGuaranteed === true);
  check('returns are NEVER guaranteed', full.returnGuaranteed === false);
  check('automatic execution stays false (wallet must sign)', full.automaticExecution === false);
  check('status is AUTHORIZED_FOR_UNSIGNED_HANDOFF', full.status === 'AUTHORIZED_FOR_UNSIGNED_HANDOFF');
  check('guaranteedWhat names the process, not profit',
    full.guaranteedWhat === 'process-limits-guardian-unsigned-handoff');
  check('schema is versioned', full.schema === EXECUTION_AUTHORITY_SCHEMA);

  const critical = resolveExecutionAuthority({
    executionRequested: true,
    userConfirmed: true,
    authorizationScreenShown: true,
    guardianApproved: true,
    policyVerdict: { ok: true, decision: 'ALLOW', policyId: 'pol_x' },
    confidence: { actionable: true, overall: 0.9, blockers: [] },
    risk: { level: 'CRITICAL' },
    chosen: { id: 'dca-in' }
  });
  check('CRITICAL risk blocks even with every other gate',
    critical.executionPermission === false && critical.blockers.some((b) => /CRITICAL/i.test(b)));

  const stopped = resolveExecutionAuthority({
    executionRequested: true,
    userConfirmed: true,
    authorizationScreenShown: true,
    guardianApproved: true,
    policyVerdict: { ok: true, decision: 'ALLOW' },
    confidence: { actionable: true, overall: 0.9, blockers: [] },
    risk: { level: 'LOW' },
    chosen: { id: 'hold' },
    controls: { stopped: true }
  });
  check('emergency STOP blocks authority', stopped.executionPermission === false);

  const limits = limitsFromContext({
    chosen: { feesUsd: 3, riskPct: 20, route: ['swap'], slippagePct: 0.4 },
    financial: { computed: { netWorthUsd: 10000, chainExposureUsd: { ethereum: 1 } } },
    policyVerdict: { maxPerExecutionUsd: 500, maxCumulativeUsd: 5000, expiration: Date.now() + 86400_000, slippageLimitPct: 1, trigger: { kinds: ['SWAP'], chains: [1] } }
  });
  check('limitsFromContext fills capital/fee/chain',
    limits.capital === 10000 && limits.fee === 3 && Array.isArray(limits.chain));

  /* ── decision engine integration ─────────────────────────────────────── */
  const collections = createCollections({});
  const evidence = createEvidenceStore({ collections });
  const traceStore = createTraceStore({ collections });
  const confidenceEngine = createConfidenceEngine({});
  const decisionEngine = createDecisionEngine({ collections, evidence, traceStore, confidenceEngine });

  const OWNER = 'dev:auth-probe';
  const now = Date.now();
  const financial = {
    status: 'OK',
    confidence: 0.9,
    computed: {
      status: 'OK',
      netWorthUsd: 24000,
      availableCapitalUsd: 6000,
      holdingsCounted: 4,
      volatilityPct: 40,
      blendedYieldPct: 3,
      concentration: { level: 'MODERATE', topSharePct: 40, topAsset: 'BTC', hhi: 0.3 },
      drawdownPct: -10,
      stableUsd: 6000,
      debtUsd: 0,
      chainExposureUsd: { ethereum: 10000 },
      assetExposureUsd: { BTC: 16000, USDC: 8000 }
    },
    provenance: { coverage: 0.9, fresh: ['portfolio'], stale: [], unavailable: [] }
  };
  const strategies = [
    {
      id: 'hold', name: 'Hold', kind: 'HOLD', schema: 'fbt.intent-strategy-proposal.v1',
      riskPct: 25, expectedReturnPct: 3, potentialLossPct: -8, maximumDrawdownPct: 12,
      feesUsd: 0, liquidity: 'unchanged', route: ['no-action'], uses: [],
      assumptions: ['flat'], evidence: [{ source: 'financial-state', sampleSize: 12, quality: 0.9, observedAt: now }],
      evidenceQuality: { status: 'observed', sampleSize: 12, score: 0.9 },
      confidencePct: 80, goalCompatibilityPct: 70, guaranteed: false,
      financialExecutionAuthorized: false
    },
    {
      id: 'dca-in', name: 'DCA', kind: 'DCA_IN', schema: 'fbt.intent-strategy-proposal.v1',
      riskPct: 35, expectedReturnPct: 5, potentialLossPct: -15, maximumDrawdownPct: 20,
      feesUsd: 4, liquidity: 'reduced', route: ['swap'], uses: ['quote'],
      assumptions: ['fills at quote'], evidence: [{ source: 'financial-state', sampleSize: 12, quality: 0.85, observedAt: now }],
      evidenceQuality: { status: 'observed', sampleSize: 12, score: 0.85 },
      confidencePct: 70, goalCompatibilityPct: 75, guaranteed: false,
      financialExecutionAuthorized: false
    }
  ];
  const competition = {
    id: 'cmp_test',
    scored: strategies.map((s) => ({
      strategyId: s.id, kind: s.kind, comparisonScore: 1, eligible: true,
      rejectionReasons: [], vetoed: false, rejectedByGenome: false,
      evidenceStatus: 'observed', goalCompatibilityPct: s.goalCompatibilityPct
    })),
    judge: { winnerId: 'hold', winnerStatus: 'live-simulated-provisional', rejected: [], alternatives: [] },
    disagreement: false,
    liveSimulation: true
  };

  /* Default path: both flags false. */
  const plain = await decisionEngine.decide({
    owner: OWNER,
    intent: { intentId: 'i1', intentType: 'GROW_CAPITAL', confidence: 0.85 },
    financial,
    world: { id: 'w1', provenance: { coverage: 0.9, fresh: ['x'], stale: [], unavailable: [] }, domains: {} },
    strategies,
    competition,
    risk: { level: 'MODERATE' },
    preferences: { riskTolerance: 'MODERATE' },
    executionRequested: false
  });
  check('plain decision keeps both flags false',
    plain.ok && plain.decision.executionPermission === false && plain.decision.guaranteed === false
    && plain.decision.returnGuaranteed === false);

  /* Authorized path: every gate supplied. */
  const authorized = await decisionEngine.decide({
    owner: OWNER,
    intent: { intentId: 'i2', intentType: 'GROW_CAPITAL', confidence: 0.9 },
    financial,
    world: {
      id: 'w2',
      provenance: { coverage: 0.95, fresh: ['portfolio', 'markets'], stale: [], unavailable: [] },
      domains: { user: { wallets: { value: { connected: true } } } },
      capabilities: { swap: true }
    },
    strategies,
    competition,
    simulation: {
      id: 'sim1', status: 'OK', scenarios: [
        { id: 'BASE', status: 'OK' }, { id: 'BULL', status: 'OK' }, { id: 'BEAR', status: 'OK' }
      ]
    },
    risk: { level: 'MODERATE', securitySignals: [] },
    preferences: { riskTolerance: 'MODERATE' },
    policyVerdict: { ok: true, decision: 'ALLOW', policyId: 'pol_auth_1' },
    executionRequested: true,
    userConfirmed: true,
    authorizationScreenShown: true,
    guardianApproved: true,
    runtimeEvidence: {
      providerId: 'fios-route-simulator',
      health: 'healthy',
      attested: true,
      checkedAt: now,
      expiresAt: now + 300_000
    }
  });
  check('authorized decision flips executionPermission',
    authorized.ok && authorized.decision.executionPermission === true);
  check('authorized decision flips process guaranteed',
    authorized.decision.guaranteed === true && authorized.decision.processGuaranteed === true);
  check('authorized decision still has returnGuaranteed false',
    authorized.decision.returnGuaranteed === false);
  check('authorized decision never sets automaticExecution',
    authorized.decision.automaticExecution === false);
  check('authority status is AUTHORIZED_FOR_UNSIGNED_HANDOFF',
    authorized.authority?.status === 'AUTHORIZED_FOR_UNSIGNED_HANDOFF'
    || authorized.decision.authority?.status === 'AUTHORIZED_FOR_UNSIGNED_HANDOFF');
  check('authorized decision still signs:false / submits:false',
    authorized.decision.signs === false && authorized.decision.submits === false);
  check('guaranteedNote explains process vs return',
    /NOT guaranteed|not guaranteed/i.test(authorized.decision.guaranteedNote || ''));

  /* Requested but unconfirmed stays false. */
  const unconfirmed = await decisionEngine.decide({
    owner: OWNER,
    intent: { intentId: 'i3', intentType: 'GROW_CAPITAL', confidence: 0.8 },
    financial,
    world: { id: 'w3', provenance: { coverage: 0.9, fresh: [], stale: [], unavailable: [] }, domains: {} },
    strategies,
    competition,
    risk: { level: 'LOW' },
    preferences: { riskTolerance: 'MODERATE' },
    policyVerdict: { ok: true, decision: 'ALLOW', policyId: 'pol_x' },
    executionRequested: true,
    userConfirmed: false,
    authorizationScreenShown: true,
    guardianApproved: true
  });
  check('execute without userConfirmed stays false',
    unconfirmed.decision.executionPermission === false && unconfirmed.decision.guaranteed === false);
  check('unconfirmed lists confirmation in conditions or blockers',
    (unconfirmed.decision.conditions || []).some((c) => /confirm/i.test(c))
    || (unconfirmed.decision.authority?.blockers || []).some((b) => /CONFIRM/i.test(b)));

  const passed = results.filter((r) => r.ok).length;
  console.log(JSON.stringify({
    probe: 'execution-authority',
    passed,
    total: results.length,
    authorizedFlags: authorized.ok ? {
      executionPermission: authorized.decision.executionPermission,
      guaranteed: authorized.decision.guaranteed,
      returnGuaranteed: authorized.decision.returnGuaranteed,
      processGuaranteed: authorized.decision.processGuaranteed
    } : null,
    results
  }, null, 2));
  if (passed !== results.length) process.exitCode = 1;
} catch (err) {
  console.error(JSON.stringify({
    probe: 'execution-authority',
    failed: true,
    error: String(err?.stack || err),
    results
  }, null, 2));
  process.exitCode = 1;
}

export default results;
