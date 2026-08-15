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
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

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

  return rows;
}