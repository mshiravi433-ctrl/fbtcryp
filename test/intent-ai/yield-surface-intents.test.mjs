/**
 * The yield surface: three capabilities that were registered, readable and
 * live — and that no intent could ever reach.
 *
 * The measurement that prompted this work:
 *
 *     modules an intent asks for : 27
 *     REGISTERED BUT NEVER ASKED  : farming, liquidity, staking
 *
 * A user who asked «بهترین ییلد کجاست؟» or «ریسک نقدینگی LP چقدره؟»
 * got UNSUPPORTED. These tests lock that shut, and they lock the two
 * subtler failure modes that were found on the way:
 *
 *   1. an EXPLICIT capability name must beat a follow-up rewrite
 *      («ریسک نقدینگی LP چقدره؟» is not a question about a loan);
 *   2. a confirmation or a cancellation must STILL beat it (those are
 *      about an action, not about a topic).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { classify, INTENT_TYPES } from '../../src/lib/central/intent.js';
import { setCiSource, resetCiSources } from '../../server/ci/sources.js';

/* ── the fixtures ─────────────────────────────────────────────────────── */

const POOLS = [
  { id: 'aave-usdc', project: 'Aave', chain: 'Ethereum', symbol: 'USDC', apy: 5.2, tvlUsd: 120_000_000, risk: 'low', ilRisk: false },
  { id: 'lido-steth', project: 'Lido', chain: 'Ethereum', symbol: 'STETH', apy: 3.8, tvlUsd: 9_000_000_000, risk: 'low', ilRisk: false },
  { id: 'uniswap-weth-usdc', project: 'Uniswap', chain: 'Ethereum', symbol: 'WETH-USDC', apy: 24.5, tvlUsd: 400_000_000, risk: 'high', ilRisk: true }
];

/* The capabilities as the registry reports them when the engine answered. */
const CAPS = {
  wallet: 'AVAILABLE', portfolio: 'AVAILABLE', lending: 'AVAILABLE',
  farming: 'READ_ONLY', liquidity: 'READ_ONLY', staking: 'READ_ONLY',
  markets: 'AVAILABLE', risk: 'AVAILABLE', crypto: 'AVAILABLE'
};
const CTX = { capabilities: CAPS, stateHas: { farming: true, liquidity: true, portfolio: true } };

/* ── 1. the three intents exist and are wired to the right modules ─────── */

test('the yield surface intents exist and name the modules that own the data', () => {
  assert.ok(INTENT_TYPES.YIELD_OPPORTUNITY, 'YIELD_OPPORTUNITY must be a real intent');
  assert.ok(INTENT_TYPES.LIQUIDITY_RISK, 'LIQUIDITY_RISK must be a real intent');
  assert.ok(INTENT_TYPES.STAKING_REWARD, 'STAKING_REWARD must be a real intent');

  assert.ok(INTENT_TYPES.YIELD_OPPORTUNITY.modules.includes('farming'), 'a yield question reads the farming module');
  assert.ok(INTENT_TYPES.LIQUIDITY_RISK.modules.includes('liquidity'), 'an LP question reads the liquidity module');
  assert.ok(INTENT_TYPES.STAKING_REWARD.modules.includes('staking'), 'a staking question reads the staking module');
});

test('no intent may require a section that no owner maps', () => {
  /* farming / liquidity / staking were state sections owned by nobody, so
     SERVE_UNAVAILABLE could not tell "missing" from "unreadable". */
  for (const name of ['YIELD_OPPORTUNITY', 'LIQUIDITY_RISK', 'STAKING_REWARD']) {
    for (const section of INTENT_TYPES[name].modules) {
      assert.ok(
        ['farming', 'liquidity', 'staking', 'portfolio', 'risk'].includes(section),
        `${name} requires ${section}, which is not a section this change introduced`
      );
    }
  }
});

/* ── 2. the questions a user actually asks reach the right intent ─────── */

test('a question about the best yield reaches the yield intent', () => {
  const c = classify('بهترین ییلد کجاست؟', { context: CTX, state: {} });
  assert.equal(c.type, 'YIELD_OPPORTUNITY', `expected YIELD_OPPORTUNITY, got ${c.type} (${JSON.stringify(c.evidence)})`);
});

test('a question about staking rewards reaches the staking intent', () => {
  const c = classify('سود استیکینگ اتریوم چقدره؟', { context: CTX, state: {} });
  assert.equal(c.type, 'STAKING_REWARD', `expected STAKING_REWARD, got ${c.type} (${JSON.stringify(c.evidence)})`);
});

test('a question about LP risk reaches the liquidity intent', () => {
  const c = classify('ریسک نقدینگی LP چقدره؟', { context: CTX, state: {} });
  assert.equal(c.type, 'LIQUIDITY_RISK', `expected LIQUIDITY_RISK, got ${c.type} (${JSON.stringify(c.evidence)})`);
});

test('the yield surface wins over the generic asset-analysis intent', () => {
  /* ASSET_ANALYSIS claims «yield», «farm» and «apy». It must not win a
     question that is actually about a pool. */
  for (const q of ['بهترین ییلد فارمینگ کجاست؟', 'کدام استخر ییلد بهتری دارد؟', 'سود استیکینگ چقدر است؟']) {
    const c = classify(q, { context: CTX, state: {} });
    assert.notEqual(c.type, 'ASSET_ANALYSIS', `«${q}» fell through to ASSET_ANALYSIS`);
  }
});

/* ── 3. the follow-up rewrite must not steal an explicit question ─────── */

test('an explicit capability name is not rewritten into a follow-up', () => {
  /* RISK_QUERY rewrote every «ریسک … چقدره؟» to LOAN_STATUS. That is
     right for «ریسک وامم چقدره؟» and wrong for «ریسک نقدینگی LP چقدره؟». */
  const memory = { lastEntities: { asset: 'ETH' }, conversationContext: { focus: ['ETH'] } };
  const c = classify('ریسک نقدینگی LP چقدره؟', { context: { ...CTX, memory }, state: {} });
  assert.equal(c.type, 'LIQUIDITY_RISK', `expected LIQUIDITY_RISK, got ${c.type} (${JSON.stringify(c.evidence)})`);
});

test('a loan-risk follow-up still resolves to the loan intent', () => {
  /* The fix must not disable the follow-up machinery it was repairing. */
  const memory = { lastEntities: { asset: 'ETH' }, conversationContext: { focus: ['ETH'] } };
  const c = classify('ریسک وامم چقدره؟', { context: { ...CTX, memory }, state: {} });
  assert.equal(c.type, 'LOAN_STATUS', `expected LOAN_STATUS, got ${c.type} (${JSON.stringify(c.evidence)})`);
});

/* ── 4. the modules actually read the live engine ─────────────────────── */

test('the farming module reads the yields engine', async () => {
  setCiSource('yields', async () => ({ ok: true, pools: POOLS, considered: POOLS.length, source: 'yields-engine', at: Date.now() }));
  try {
    const { createModules } = await import('../../server/ci/modules.js');
    const mods = createModules({});
    const farming = mods.find((m) => m.id === 'farming');
    assert.ok(farming, 'the farming module must be registered');
    const out = await farming.read();
    assert.equal(out.status, 'OK', `the farming read failed: ${out.reason}`);
    assert.equal(out.data.pools.length, 3);
    assert.equal(out.data.pools[0].project, 'Aave');
  } finally {
    resetCiSources();
  }
});

test('the liquidity module reads the same engine and keeps the IL flag', async () => {
  setCiSource('yields', async () => ({ ok: true, pools: POOLS, considered: POOLS.length, source: 'yields-engine', at: Date.now() }));
  try {
    const { createModules } = await import('../../server/ci/modules.js');
    const mods = createModules({});
    const liquidity = mods.find((m) => m.id === 'liquidity');
    assert.ok(liquidity, 'the liquidity module must be registered');
    const out = await liquidity.read();
    assert.equal(out.status, 'OK', `the liquidity read failed: ${out.reason}`);
    const flagged = out.data.pools.filter((p) => p.ilRisk === true);
    assert.equal(flagged.length, 1, 'the impermanent-loss flag must survive the read');
  } finally {
    resetCiSources();
  }
});

test('the staking module is registered and reads the farming state', async () => {
  const { createModules } = await import('../../server/ci/modules.js');
  const mods = createModules({});
  const staking = mods.find((m) => m.id === 'staking');
  assert.ok(staking, 'the staking module must be registered');
  assert.deepEqual(staking.state, ['farming'], 'staking reads the farming section');
});

/* ── 5. the live HTTP path reads the right sections ───────────────────── */

test('the brain reads the yield sections over the real HTTP path', async () => {
  setCiSource('yields', async () => ({ ok: true, pools: POOLS, considered: POOLS.length, source: 'yields-engine', at: Date.now() }));
  let srv = null;
  try {
    const app = (await import('../../server/app.js')).default;
    srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    const port = srv.address().port;
    const ask = async (message) => {
      const res = await fetch(`http://127.0.0.1:${port}/api/brain/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, locale: 'fa' })
      });
      assert.equal(res.status, 200);
      return res.json();
    };

    const yieldOut = await ask('بهترین ییلد کجاست؟');
    assert.equal(yieldOut.intent.intentType, 'YIELD_OPPORTUNITY');
    assert.ok(yieldOut.meta.sectionsRead.includes('farming'), 'the farming section must be read');
    assert.ok(yieldOut.recommendation.ok, 'the answer must not be an empty recommendation');

    const stakingOut = await ask('سود استیکینگ اتریوم چقدره؟');
    assert.equal(stakingOut.intent.intentType, 'STAKING_REWARD');

    const lpOut = await ask('ریسک نقدینگی LP چقدره؟');
    assert.equal(lpOut.intent.intentType, 'LIQUIDITY_RISK');
    assert.ok(lpOut.meta.sectionsRead.includes('liquidity'), 'the liquidity section must be read');

    /* The change must not have broken an existing intent. */
    const loanOut = await ask('وامم چطوره؟');
    assert.equal(loanOut.intent.intentType, 'LOAN_STATUS', 'the loan intent must still win a loan question');
  } finally {
    if (srv) srv.close();
    resetCiSources();
  }
});

/* ── 6. a failure must say WHY ────────────────────────────────────────── */

test('an upstream failure keeps its detail instead of an empty one', async () => {
  const { guarded } = await import('../../server/ci/sources.js');
  const out = await guarded('test-yields-source', async () => { throw new Error('fetch failed'); }, { maxAttempts: 1 });
  assert.equal(out.ok, false);
  assert.ok(out.detail && out.detail.length > 0, 'a failure must carry a detail — an empty one tells the operator nothing');
  assert.match(out.detail, /fetch failed/);
});
