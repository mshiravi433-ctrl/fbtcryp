/**
 * FBT INTENT AI — PHASE 9 Intent OS foundation probe.
 *
 * This probe locks the specification boundary: exactly three modes, analysis
 * separated from financial execution, runtime/evidence-backed capabilities,
 * honest target reality, independent challenge/council, local-first memory,
 * and fail-closed controls/policies.
 */

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);
  const modes = await import('../../src/lib/intent-ai/sessionModes.js');
  const caps = await import('../../src/lib/intent-ai/capabilityScanner.js');
  const reality = await import('../../src/lib/intent-ai/targetReality.js');
  const council = await import('../../src/lib/intent-ai/agentCouncil.js');
  const genome = await import('../../src/lib/intent-ai/intentGenome.js');
  const memory = await import('../../src/lib/intent-ai/agentMemory.js');
  const guard = await import('../../src/lib/intent-ai/policyGuard.js');
  const human = await import('../../src/lib/intent-ai/humanAi.js');

  t('the product declares exactly three primary modes',
    modes.PRIMARY_MODES.length === 3
    && modes.PRIMARY_MODES.join('|') === 'human-ai|ai-ai-inside-fbt|fbt-external-ai'
    && new Set(modes.PRIMARY_MODES).size === 3);
  t('mode labels match the specification',
    modes.MODE_LABELS['human-ai'] === 'HUMAN ↔ AI'
    && modes.MODE_LABELS['ai-ai-inside-fbt'] === 'AI ↔ AI INSIDE FBT'
    && modes.MODE_LABELS['fbt-external-ai'] === 'FBT AI ↔ EXTERNAL AI AGENT');
  t('analysis and preparation are not execution',
    modes.classifyRequest('research') === 'analysis'
    && modes.classifyRequest('prepare') === 'preparation'
    && modes.classifyRequest('swap') === 'execution');
  const prepBoundary = modes.buildPermissionBoundary({
    mode: 'ai-ai-inside-fbt', request: { action: 'swap', stage: 'preparation' }
  });
  t('preparation boundary cannot authorize financial execution',
    prepBoundary.requestClass === 'preparation'
    && prepBoundary.financialExecutionAllowed === false);
  t('unknown mode is blocked instead of silently falling back',
    modes.createModeSession({ mode: 'future-mode' }).code === 'UNKNOWN_PRIMARY_MODE'
    && modes.assertModeBoundary({ mode: 'future-mode', stage: 'analysis' }).ok === false);
  t('external mode requires verification and rejects raw credentials',
    modes.assertModeBoundary({ mode: 'fbt-external-ai', stage: 'analysis' }).code === 'EXTERNAL_AGENT_NOT_VERIFIED'
    && modes.assertModeBoundary({ mode: 'fbt-external-ai', stage: 'analysis', externalVerified: true, rawCredential: true }).code === 'RAW_CREDENTIAL_FORBIDDEN');

  const scoreMissing = caps.capabilityScore({ usefulness: 80 });
  t('capability score is withheld without all seven metrics', scoreMissing.score === null && scoreMissing.status === 'insufficient-evidence');
  const runtime = caps.scanCapabilities({
    runtime: {
      swap: {
        configured: true, operational: true,
        evidence: ['mock-rpc-health'],
        metrics: { usefulness: 80, risk: 20, cost: 10, reliability: 90, liquidity: 70, expectedImpact: 65, executionQuality: 85 }
      },
      bridge: { configured: true, operational: false, evidence: ['adapter-disabled'] }
    }
  });
  const swap = runtime.capabilities.find((row) => row.id === 'swap');
  const bridge = runtime.capabilities.find((row) => row.id === 'bridge');
  t('runtime scan distinguishes available and configured-not-operational',
    swap?.status === 'available' && swap.score != null && swap.evidence.includes('mock-rpc-health')
    && bridge?.status === 'configured-not-operational');
  t('optional recommendations require material evidence and user choice',
    caps.recommendOptionalCapabilities(runtime).every((item) => item.automaticEnable === false && item.userChoiceRequired === true));
  const replanned = caps.replanAfterCapabilityDecline({
    declinedCapability: 'futures',
    strategies: [{ id: 'lev', uses: ['futures'] }, { id: 'spot', uses: ['swap'] }]
  });
  t('declining an optional capability keeps a safe alternative',
    replanned.ok && replanned.alternatives.length === 1 && replanned.alternatives[0].id === 'spot');

  const target = reality.assessTarget({ capital: 1000, targetPct: 50, durationHrs: 24 });
  t('unrealistic target is labelled extreme and never guaranteed',
    target.ok && target.realism.level === 'extreme'
    && target.guaranteed === false && target.expectedReturnPct === null
    && target.estimatedProbabilityPct === null && target.disclaimers.includes('NOT_GUARANTEED'));
  t('target recommendations include risk, duration and strategy choices',
    ['REDUCE_RISK', 'EXTEND_DURATION', 'CHANGE_STRATEGY'].every((choice) => target.recommendations.includes(choice)));

  const challenged = council.challengeStrategy({ id: 'high-lev', strategy: 'perpetual_dydx', uses: ['futures'], leverage: 10 }, { maxLeverage: 5 });
  t('independent challenge identifies a policy disagreement',
    challenged.ok && challenged.decision === 'REVISE' && challenged.canExecute === false && challenged.disagreements.length > 0);
  const rejectedCouncil = council.runAgentCouncil({
    proposal: { id: 'blocked', strategy: 'spot_swap', uses: ['swap'] },
    roles: ['strategy', 'risk', 'guardian'],
    votes: { risk: { decision: 'REJECT', confidence: 96, reason: 'loss cap exceeded' } },
    context: {}, highRisk: true
  });
  t('Guardian/Risk rejection dominates council approval',
    rejectedCouncil.ok && rejectedCouncil.decision === 'REJECT'
    && rejectedCouncil.canExecute === false && rejectedCouncil.replacesGuardian === false);

  const g = genome.createIntentGenome({ riskTolerance: 30, evidence: ['explicit user preference'] });
  const match = genome.matchIntentDNA(g, { values: { riskTolerance: 30, timeHorizon: 50, liquidityNeed: 50, feeSensitivity: 50, drawdownTolerance: 50, automationPreference: 50, privacyPreference: 50 } });
  t('Intent DNA matching is explainable and not an outcome promise',
    match.ok && match.score >= 90 && match.neverGuaranteesOutcome === true && match.requiresRiskReview === true);
  const evolved = genome.evolveIntentGenome(g, { accepted: false, dimension: 'riskTolerance', reason: 'too volatile' });
  t('genome evolution is bounded and cannot grant execution',
    evolved.ok && evolved.genome.values.riskTolerance < g.values.riskTolerance
    && evolved.executionPermissionChanged === false);
  t('secret-shaped genome feedback is rejected',
    genome.evolveIntentGenome(g, { accepted: true, reason: 'private key: 0xabc' }).ok === false);
  const secretText = `0x${'ab'.repeat(32)}`;
  const secretSession = human.startSession({ mode: 'human-ai', level: 1 });
  const secretTurn = human.chatTurn(secretSession, secretText);
  t('raw credential chat input is rejected before persistence',
    secretTurn.reply?.type === 'credential-rejected'
    && secretTurn.session.messages.every((message) => !JSON.stringify(message).includes(secretText)));

  const store = memory.createMemoryStore({ maxEvents: 3 });
  store.append('intent.created', { note: 'hello' });
  store.append('authorization.requested', { privateKey: 'never-store-this', amountUsd: 10 });
  const event = store.list().find((item) => item.type === 'authorization.requested');
  t('structured memory redacts secret fields and stays bounded',
    event?.payload?.privateKey === '[redacted-secret-field]' && store.size() === 2);
  t('learning batch is local-first and upload-disabled by default',
    memory.buildLearningBatch(store.list()).localFirst === true
    && memory.buildLearningBatch(store.list()).upload === 'disabled-by-default'
    && memory.buildLearningBatch(store.list()).containsSecrets === false);

  const policy = {
    capitalLimitUsd: 1000,
    transactionLimitUsd: 100,
    riskLimitPct: 10,
    protocolAllowlist: ['swap'],
    chainAllowlist: ['42161'],
    timeLimitSeconds: 600,
    feeLimitUsd: 5,
    maxSlippagePct: 1
  };
  const allowed = guard.evaluatePolicy({
    policy, amountUsd: 50, capitalUsd: 500, riskPct: 5, protocol: 'swap', chain: '42161',
    durationSeconds: 60, feeUsd: 1, slippagePct: 0.5, userAuthorized: true,
    guardianApproved: true, expiresAt: Date.now() + 60_000
  });
  t('policy evaluates all seven limits but only allows review',
    allowed.ok && allowed.decision === 'ALLOW_REVIEW_ONLY'
    && Object.values(allowed.checked).every(Boolean) && allowed.executionStillRequiresAdapter === true);
  const blocked = guard.evaluatePolicy({ policy, amountUsd: 50, capitalUsd: 500, riskPct: 5, protocol: 'swap', chain: '42161', durationSeconds: 60, feeUsd: 1, slippagePct: 0.5, guardianApproved: true, expiresAt: Date.now() + 60_000 });
  t('missing explicit user authorization fails closed', blocked.ok === false && blocked.code === 'USER_AUTHORIZATION_REQUIRED');
  const controls = guard.applyControl(guard.createControlState(), 'PAUSE');
  t('pause/revoke/disconnect/emergency controls are explicit fail-closed state',
    controls.ok && controls.controls.paused === true
    && guard.evaluatePolicy({ policy, amountUsd: 50, capitalUsd: 500, riskPct: 5, protocol: 'swap', chain: '42161', durationSeconds: 60, feeUsd: 1, slippagePct: 0.5, userAuthorized: true, guardianApproved: true, expiresAt: Date.now() + 60_000, controls: controls.controls }).code === 'PAUSED');
  t('unknown fees block execution', guard.feeTransparency({ fees: { network: 1, protocol: null } }).executionAllowed === false);

  const humanSession = human.startSession({ mode: 'human-ai', level: 2, defaultChainId: 42161 });
  let signerCalls = 0;
  const bypass = human.executeConfirmed(humanSession, {
    action: 'CONFIRM',
    signer: () => { signerCalls += 1; return { signedTx: 'must-not-be-called' }; }
  });
  t('executeConfirmed rejects a direct submit without an authorization screen',
    bypass.ok === false && bypass.error?.code === 'USER_AUTHORIZATION_REQUIRED' && signerCalls === 0);
  const humanTurn = human.chatTurn(humanSession, 'swap 100 USDC to ETH on Arbitrum');
  t('Human ↔ AI prepares a draft with a separate authorization screen',
    humanTurn.reply?.type === 'prepared-draft'
    && humanTurn.reply.payload.authorizationScreen?.required === true
    && humanTurn.reply.payload.financialExecutionAuthorized === false);
  const inside = human.startSession({ mode: 'ai-ai-inside-fbt', level: 2, defaultChainId: 42161 });
  const insideTurn = human.chatTurn(inside, 'swap 100 USDC to ETH on Arbitrum');
  t('AI ↔ AI inside FBT exposes non-executable agent dialogue',
    insideTurn.reply?.type === 'prepared-draft'
    && insideTurn.reply.payload.agentDialogue?.messages.every((item) => item.executable === false));
  const external = human.startSession({ mode: 'fbt-external-ai', level: 1, defaultChainId: 42161 });
  const externalTurn = human.chatTurn(external, 'analyze BTC');
  t('unverified external Agent cannot enter the session', externalTurn.reply?.type === 'mode-boundary-blocked');
  const invalid = human.startSession({ mode: 'not-a-mode' });
  t('Human session never creates an implicit fourth/fallback mode', invalid.status === 'BLOCKED' && invalid.mode === null);

  return rows;
}
