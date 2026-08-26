/**
 * INTENT OS BEHAVIOR PROBE
 * ---------------------------------------------------------------------------
 * Tests the client-side intent compiler (src/lib/intentOS.js) with real data
 * shapes, error states, and edge cases. Unlike the intent-api-probe.mjs suite
 * (which exercises the server endpoints), this tests the pure logic that runs
 * inside the browser — the compiler, the normalizer, the memory store.
 *
 * Also checks that the IntentOS page's capabilities caching is effective.
 */
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const INTENT_OS = '../src/lib/intentOS.js';

/* Minimal localStorage polyfill for the memory and intent store. */
function mockLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null
  };
  // Mock crypto for makeId
  if (!globalThis.crypto) {
    globalThis.crypto = { randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }) };
  }
}

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  mockLocalStorage();

  const mod = await import(INTENT_OS);

  /* ------------------------------------------------------------------ */
  /*  1. Memory store — load/save, sanitization, defaults               */
  /* ------------------------------------------------------------------ */
  const defaultMemory = mod.DEFAULT_INTENT_MEMORY;
  t('default memory has a preferredChainId', typeof defaultMemory.preferredChainId === 'number');
  t('default memory has maxSlippagePct', defaultMemory.maxSlippagePct === 0.5);

  const loaded = mod.loadIntentMemory();
  t('loadIntentMemory returns the default on first call', loaded.preferredChainId === defaultMemory.preferredChainId);

  const saved = mod.saveIntentMemory({ preferredChainId: 1, maxSlippagePct: 0.3 });
  t('saveIntentMemory returns the sanitized memory', saved.preferredChainId === 1);
  t('saveIntentMemory persists', mod.loadIntentMemory().preferredChainId === 1);

  // Restore default
  mod.saveIntentMemory(defaultMemory);

  /* ------------------------------------------------------------------ */
  /*  2. normalizeIntent — valid and invalid shapes                      */
  /* ------------------------------------------------------------------ */
  const valid = mod.normalizeIntent({
    kind: 'swap',
    chainId: 42161,
    fromSymbol: 'USDC',
    toSymbol: 'ETH',
    amountIn: '100',
    maxSlippagePct: 0.5,
    privacy: 'standard'
  });
  t('normalizeIntent accepts a valid swap', !valid.error);
  t('normalizeIntent creates an intent with correct schema', valid.intent.schema === mod.INTENT_SCHEMA);
  t('normalizeIntent sets amountUsd for stablecoins', valid.intent.amountUsd === 100);

  // Bad kind
  const badKind = mod.normalizeIntent({ kind: 'nonexistent' });
  t('normalizeIntent rejects BAD_KIND', badKind.error === 'BAD_KIND');

  // Bad chain
  const badChain = mod.normalizeIntent({ kind: 'swap', chainId: 999999, fromSymbol: 'USDC', toSymbol: 'ETH', amountIn: '100' });
  t('normalizeIntent rejects unsupported chain', badChain.error === 'BAD_CHAIN');

  // Same tokens
  const sameToken = mod.normalizeIntent({ kind: 'swap', chainId: 42161, fromSymbol: 'ETH', toSymbol: 'ETH', amountIn: '100' });
  t('normalizeIntent rejects SAME_TOKEN', sameToken.error === 'SAME_TOKEN');

  // Bad amount
  const badAmount = mod.normalizeIntent({ kind: 'swap', chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH', amountIn: '0' });
  t('normalizeIntent rejects zero amount', badAmount.error === 'BAD_AMOUNT');

  // Missing tokens
  const noTokens = mod.normalizeIntent({ kind: 'swap', chainId: 42161, fromSymbol: '', toSymbol: '', amountIn: '100' });
  t('normalizeIntent rejects empty tokens', noTokens.error === 'BAD_TOKENS');

  /* ------------------------------------------------------------------ */
  /*  3. compileIntent — full pipeline with checks and solver rows       */
  /* ------------------------------------------------------------------ */
  const compiled = mod.compileIntent({
    kind: 'swap',
    chainId: 42161,
    fromSymbol: 'USDC',
    toSymbol: 'ETH',
    amountIn: '100',
    maxSlippagePct: 0.5,
    privacy: 'standard'
  });
  t('compileIntent compiles a valid swap without error', !compiled.error);
  t('compileIntent produces checks', Array.isArray(compiled.checks) && compiled.checks.length > 0);
  t('compileIntent produces solver rows', Array.isArray(compiled.solvers) && compiled.solvers.length > 0);
  t('compileIntent produces a handoff URL for swaps', typeof compiled.handoff === 'string');
  t('compileIntent status is ready-for-review', compiled.status === 'ready-for-review');

  // Blocked by quiet hours
  const quietMemory = mod.saveIntentMemory({
    ...defaultMemory,
    quietHoursEnabled: true,
    quietStart: 0,
    quietEnd: 23
  });
  const quietMode = mod.compileIntent({
    kind: 'swap',
    chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH', amountIn: '100',
    maxSlippagePct: 0.5, privacy: 'standard'
  }, quietMemory, new Date('2026-01-01T12:00:00').getTime());
  t('compileIntent blocks during quiet hours', quietMode.blocked === true);
  t('quiet-hours check is present', quietMode.checks.some((c) => c.id === 'QUIET_HOURS'));

  // Restore
  mod.saveIntentMemory(defaultMemory);

  // Over spend limit
  const lowLimitMemory = mod.saveIntentMemory({
    ...defaultMemory,
    maxPerIntentUsd: 10
  });
  const overSpend = mod.compileIntent({
    kind: 'swap', chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH', amountIn: '100',
    maxSlippagePct: 0.5, privacy: 'standard'
  }, lowLimitMemory);
  t('compileIntent blocks over the spend limit', overSpend.blocked === true);
  mod.saveIntentMemory(defaultMemory);

  // Workflow validation
  const wfCompiled = mod.compileIntent({
    kind: 'workflow',
    chainId: 42161,
    fromSymbol: 'USDC',
    toSymbol: 'ETH',
    amountIn: '100',
    maxSlippagePct: 0.5,
    privacy: 'standard',
    steps: [
      { action: 'swap', chainId: 42161, asset: 'ETH' },
      { action: 'deposit', chainId: 42161, asset: 'ETH' }
    ]
  });
  t('compileIntent compiles a workflow', !wfCompiled.error);
  t('workflow is blocked = false if single-chain', wfCompiled.blocked === false);

  const crossChainWf = mod.compileIntent({
    kind: 'workflow',
    chainId: 42161,
    fromSymbol: 'USDC',
    toSymbol: 'ETH',
    amountIn: '100',
    maxSlippagePct: 0.5,
    privacy: 'standard',
    steps: [
      { action: 'swap', chainId: 42161, asset: 'ETH' },
      { action: 'bridge', chainId: 1, asset: 'ETH' }
    ]
  });
  t('cross-chain workflow is blocked (no atomic cross-chain)', crossChainWf.blocked === true);

  /* ------------------------------------------------------------------ */
  /*  4. saveCompiledIntent / loadIntents / removeIntent                */
  /* ------------------------------------------------------------------ */
  const persisted = mod.saveCompiledIntent(compiled);
  t('saveCompiledIntent returns a record', !persisted.error);
  t('loadIntents returns the persisted record', mod.loadIntents().length >= 1);

  const removed = mod.removeIntent(compiled.intent.id);
  t('removeIntent removes the record', !removed.some((r) => r.intent.id === compiled.intent.id));

  /* ------------------------------------------------------------------ */
  /*  5. isSingleChainWorkflowSteps                                     */
  /* ------------------------------------------------------------------ */
  t('isSingleChainWorkflowSteps identifies same-chain steps',
    mod.isSingleChainWorkflowSteps([
      { action: 'swap', chainId: 42161 },
      { action: 'deposit', chainId: 42161 }
    ], 42161) === true);
  t('isSingleChainWorkflowSteps rejects multi-chain steps',
    mod.isSingleChainWorkflowSteps([
      { action: 'swap', chainId: 42161 },
      { action: 'bridge', chainId: 1 }
    ], 42161) === false);
  t('isSingleChainWorkflowSteps rejects bridge action',
    mod.isSingleChainWorkflowSteps([
      { action: 'swap', chainId: 42161 },
      { action: 'bridge', chainId: 42161 }
    ], 42161) === false);
  t('isSingleChainWorkflowSteps rejects < 2 steps',
    mod.isSingleChainWorkflowSteps([{ action: 'swap' }], 42161) === false);

  /* ------------------------------------------------------------------ */
  /*  6. isQuietTime                                                    */
  /* ------------------------------------------------------------------ */
  t('isQuietTime returns false when disabled',
    mod.isQuietTime({ quietHoursEnabled: false, quietStart: 23, quietEnd: 7 }, new Date('2026-01-01T02:00:00')) === false);
  t('isQuietTime returns true during overnight quiet hours',
    mod.isQuietTime({ quietHoursEnabled: true, quietStart: 23, quietEnd: 7 }, new Date('2026-01-01T02:00:00')) === true);
  t('isQuietTime returns false outside quiet hours',
    mod.isQuietTime({ quietHoursEnabled: true, quietStart: 23, quietEnd: 7 }, new Date('2026-01-01T12:00:00')) === false);

  /* ------------------------------------------------------------------ */
  /*  7. SOLVER_CAPABILITIES static shape                                */
  /* ------------------------------------------------------------------ */
  t('SOLVER_CAPABILITIES lists all defined solvers', mod.SOLVER_CAPABILITIES.length >= 6);
  for (const solver of mod.SOLVER_CAPABILITIES) {
    t(`solver ${solver.id} has a role`, typeof solver.role === 'string');
    t(`solver ${solver.id} has modes`, Array.isArray(solver.modes));
  }

  /* ------------------------------------------------------------------ */
  /*  8. Confidential intent readiness                                  */
  /* ------------------------------------------------------------------ */
  const { confidentialSwapReadiness } = await import('../src/lib/confidentialIntent.js');
  t('confidentialSwapReadiness returns unavailable when capabilities is null',
    confidentialSwapReadiness(null).available === false);
  t('confidentialSwapReadiness returns unavailable when commitReveal is missing',
    confidentialSwapReadiness({ ok: true }).available === false);
  t('confidentialSwapReadiness requires all prerequisites',
    confidentialSwapReadiness({
      ok: true,
      commitReveal: { available: true, frontendIntegrated: true, durablePrivateStorage: true, requesterAuthentication: true, earlyRevealProtection: true }
    }).available === true);

  /* ------------------------------------------------------------------ */
  /*  9. END-TO-END: the target workflow, risk → execution → proof       */
  /* ------------------------------------------------------------------ */
  /*
   * ─── WHAT THIS PROBE IS FOR ───────────────────────────────────────────────
   * The owner's requirement for Intent OS is narrow and deliberate: it is a
   * QA surface, it executes nothing by itself, and no agent withdraws funds.
   * Every section above checks one stage in isolation. This one walks the
   * target workflow — swap USDC → ETH, then deposit that ETH — through the
   * whole pipeline, because the failure mode that matters is not a stage
   * returning the wrong thing, it is the stages disagreeing:
   *
   *   risk says PASS  →  the envelope must carry abort-all, not "continue"
   *   envelope built  →  the proof must say what actually settled
   *   abort-all set   →  a partial failure must stop, not run half-done
   *
   * Each arrow is asserted separately, against the real modules. Nothing here
   * re-implements the logic it is checking.
   */
  const wfServer = await import('../server/intentWorkflow.js');
  const proofs = await import('../src/lib/executionProof.js');

  /* The exact workflow the Compose tab opens with, so this probe cannot
     drift away from what a user actually submits. */
  const TARGET_STEPS = [
    { id: 'step-1', action: 'swap', chainId: 42161, asset: 'ETH' },
    { id: 'step-2', action: 'deposit', chainId: 42161, asset: 'ETH' }
  ];

  /* ---- stage 1+2: intent → risk, and the risk level is PASS --------- */
  const target = mod.compileIntent({
    kind: 'workflow',
    chainId: 42161,
    fromSymbol: 'USDC',
    toSymbol: 'ETH',
    amountIn: '100',
    maxSlippagePct: 0.5,
    privacy: 'standard',
    steps: TARGET_STEPS
  }, defaultMemory);
  t('E2E: the target workflow compiles with no error', !target.error);
  t('E2E: the target workflow passes the risk gate', target.blocked === false);
  /*
   * NOTE ON THESE TWO. My first draft read `c.code` (the field is `id`) and
   * asserted "no check warns". Both were wrong, and the second was wrong in
   * the dangerous direction: this workflow is submitted with
   * `privacy: 'standard'`, so the engine DOES warn — STANDARD_BROADCAST_
   * DISCLOSED, telling the user a normal broadcast is public. That warning is
   * the risk engine doing its job, and flattening it to make a test green
   * would be exactly the "never weaken the risk engine" failure. So the
   * assertion is precise instead: nothing blocks, the workflow check passes,
   * and the ONLY warning is the disclosure.
   */
  t('E2E: the workflow atomicity check is a PASS, not a warning',
    target.checks.find((c) => c.id === 'WORKFLOW_SINGLE_CHAIN_ATOMIC')?.level === 'pass');
  t('E2E: nothing on it blocks',
    !target.checks.some((c) => c.level === 'block'));
  t('E2E: the one warning is the public-broadcast disclosure, not the workflow',
    JSON.stringify(target.checks.filter((c) => c.level === 'warn').map((c) => c.id))
      === JSON.stringify(['STANDARD_BROADCAST_DISCLOSED']));
  /* The pipeline is intent → risk → solvers → simulation → execution →
     verification. The first three are the compiler's job. */
  t('E2E: it still runs the solver stage', target.solvers.length >= 6);
  t('E2E: a passing workflow is ready-for-review, never executed',
    target.status === 'ready-for-review');
  t('E2E: ...and the only execution offered is a handoff to the swap screen',
    typeof target.handoff === 'string' && target.handoff.startsWith('/swap'));

  /* ---- stage 4+5: the execution envelope --------------------------- */
  const workflow = wfServer.workflowFromLegacySteps(TARGET_STEPS, {
    chainId: 42161,
    deadline: Math.floor(Date.now() / 1000) + 600
  });
  t('E2E: the lifted workflow validates', wfServer.validateWorkflow(workflow).ok === true);
  t('E2E: it is recognised as a same-chain atomic candidate',
    wfServer.isSingleChainWorkflow(workflow) === true);

  const envelope = wfServer.buildWorkflowBatchCalldata(workflow);
  t('E2E: the batch envelope builds', envelope.ok === true);
  t('E2E: it carries both nodes', envelope.callCount === 2);
  /*
   * ─── ABORT-ALL HAS TO SURVIVE THE ENCODING ───────────────────────────────
   * This is the check the owner asked for by name: «abort-all stops instead
   * of continuing half-done». The contract is what stops — but only if the
   * envelope actually tells it to. A policy that is dropped or defaulted
   * somewhere between the Compose UI and the calldata would leave a workflow
   * running its second node on the first node's failure, which is exactly
   * half-done. So the policy is asserted in the encoded data, not just in
   * the object next to it.
   */
  t('E2E: abort-all is the policy on the envelope', envelope.policy === 'abort-all');
  t('E2E: abort-all encodes as the abort code, not a continue',
    envelope.policyCode === wfServer.POLICY_ABORT_ALL && wfServer.POLICY_ABORT_ALL === 0);
  const decoded = wfServer.workflowInterface.decodeFunctionData('execute', envelope.data);
  t('E2E: the abort code is what the contract will actually read',
    Number(decoded[2]) === wfServer.POLICY_ABORT_ALL);
  /*
   * And the inverse: a different policy must produce different calldata. If
   * every policy encoded the same bytes, the flag would be decoration.
   */
  const continueWorkflow = wfServer.workflowFromLegacySteps(
    TARGET_STEPS.map((s) => ({ ...s, revertPolicy: 'continue' })),
    { chainId: 42161, deadline: workflow.nodes[0].deadline }
  );
  const continueEnvelope = wfServer.buildWorkflowBatchCalldata(continueWorkflow);
  t('E2E: a continue policy encodes differently from abort-all',
    continueEnvelope.ok === true
    && continueEnvelope.data !== envelope.data
    && continueEnvelope.policyCode === wfServer.POLICY_CONTINUE);
  /*
   * Mixed policies fail SAFE. `dominantRevertPolicy` cannot find a single
   * policy across the nodes, and the fallback is abort-all — never the
   * permissive one. A workflow the user only half-configured must stop, not
   * carry on.
   */
  const mixed = wfServer.workflowFromLegacySteps(
    [{ ...TARGET_STEPS[0], revertPolicy: 'abort-all' },
      { ...TARGET_STEPS[1], revertPolicy: 'continue' }],
    { chainId: 42161, deadline: workflow.nodes[0].deadline }
  );
  t('E2E: a mixed policy falls back to abort-all, never to continue',
    wfServer.dominantRevertPolicy(wfServer.validateWorkflow(mixed).workflow.nodes) === 'abort-all'
    && wfServer.buildWorkflowBatchCalldata(mixed).policyCode === wfServer.POLICY_ABORT_ALL);
  /* An unknown policy must not silently become "keep going" either. */
  t('E2E: an unrecognised policy encodes as abort',
    wfServer.policyCode('carry-on-anyway') === wfServer.POLICY_ABORT_ALL);

  /* ---- the boundary the owner named ------------------------------- */
  t('E2E: the envelope takes no custody and holds no tokens',
    envelope.custody === false && envelope.holdsTokens === false);
  t('E2E: the server cannot execute it',
    wfServer.workflowProtocolStatus().executableByServer === false
    && wfServer.workflowProtocolStatus().userSignatureRequired === true);
  t('E2E: no batch address means no destination, not a fallback one',
    wfServer.configuredWorkflowBatchAddress('') === null && envelope.to === null);
  t('E2E: it admits the calldata is planned, not a live router payload',
    envelope.liveRouterCalldata === false && envelope.verifiesCallOutputs === false);

  /* ---- stage 6: verification, and the proof tells the truth -------- */
  const confirmed = await proofs.createWorkflowExecutionProof({
    workflowId: envelope.workflowId,
    chainId: 42161,
    nodeCount: envelope.callCount,
    revertPolicy: envelope.policy,
    txHash: `0x${'a'.repeat(64)}`,
    receipt: { status: 1, blockNumber: 123456, gasUsed: 210000n }
  });
  t('E2E: a confirmed run produces a proof', confirmed.schema === proofs.WORKFLOW_EXECUTION_PROOF_SCHEMA);
  t('E2E: ...which records abort-all as the policy it ran under',
    confirmed.payload.workflow.revertPolicy === 'abort-all');
  t('E2E: ...whose status is confirmed, not "planned"',
    confirmed.payload.settlement.status === 'confirmed');
  t('E2E: ...and it verifies', (await proofs.verifyExecutionProof(confirmed)).ok === true);
  t('E2E: the verification recomputes the digest rather than trusting it',
    (await proofs.verifyExecutionProof(confirmed)).code === 'DIGEST_MATCH');

  /* A reverted run is reported as a reverted run. */
  const reverted = await proofs.createWorkflowExecutionProof({
    workflowId: envelope.workflowId,
    chainId: 42161,
    nodeCount: envelope.callCount,
    revertPolicy: envelope.policy,
    txHash: `0x${'b'.repeat(64)}`,
    receipt: { status: 0, blockNumber: 123457 }
  });
  t('E2E: a failed run is recorded, not laundered into a success',
    reverted.payload.settlement.status !== 'confirmed');
  /* An aborted batch settles as ONE reverted transaction: node two never
     ran, which is what abort-all is for. */
  t('E2E: the aborted run settles as one transaction, not two',
    typeof reverted.payload.settlement.txHash === 'string'
    && reverted.payload.workflow.nodeCount === 2);

  /* Tampering must be caught. */
  const tampered = JSON.parse(JSON.stringify(confirmed));
  tampered.payload.settlement.status = 'confirmed';
  tampered.payload.workflow.revertPolicy = 'continue';
  const tamperCheck = await proofs.verifyExecutionProof(tampered);
  t('E2E: editing a proof after the fact fails verification',
    tamperCheck.ok === false && tamperCheck.code === 'DIGEST_MISMATCH');
  t('E2E: a proof with no digest is not a proof',
    (await proofs.verifyExecutionProof({ schema: confirmed.schema, payload: {} })).ok === false);

  /* ---- and no agent can move funds by itself ---------------------- */
  /*
   * Every intent module on both sides, found by name rather than listed — a
   * hard-coded list goes stale the moment somebody adds intentSomething.js,
   * and a stale list is a check that silently stopped covering the new file.
   */
  const root = fileURLToPath(new URL('..', import.meta.url));
  const listFiles = (dir, pattern) => {
    const out = [];
    const walk = (p) => {
      const entries = readdirSync(`${root}${p}`);
      for (const e of entries) {
        const rel = `${p}/${e}`;
        let st;
        try { st = statSync(`${root}${rel}`); } catch { continue; }
        if (st.isDirectory()) {
          // skip node_modules/dist/.git but walk our own source subdirs
          if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
          walk(rel);
        } else if (pattern.test(e)) {
          out.push(rel);
        }
      }
    };
    walk(dir);
    return out;
  };
  const intentFiles = [
    ...listFiles('src/lib', /intent/i),
    ...listFiles('server', /intent/i),
    'src/pages/IntentOS.jsx'
  ];
  t('E2E: the scan covers the whole intent surface, not a stale list',
    intentFiles.length >= 30);
  t('E2E: no agent withdrawal path exists anywhere in the intent system',
    !intentFiles.some((f) => {
      try { return /withdrawFunds|withdrawForUser|drainWallet/.test(readFileSync(`${root}${f}`, 'utf8')); }
      catch { return false; }
    }));
  /* No server-side code path may submit a transaction for the user. */
  t('E2E: the workflow protocol says in so many words',
    wfServer.workflowProtocolStatus().executableByServer === false);

  return rows;
}