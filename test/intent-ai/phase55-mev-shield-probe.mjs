/**
 * PHASE 55 — MEV AND SLIPPAGE SHIELD
 * A submitted transaction is not a protected one: every transaction carries an
 * explicit deadline and slippage ceiling, exceeding the ceiling is a refusal
 * (not hope), and private submission is a real option in the architecture.
 */
import {
  applyMevShield, assertProtected, shieldTransaction,
  HARD_MAX_SLIPPAGE_PCT, SUBMISSION_CHANNELS, DEFAULT_DEADLINE_SECS,
  normalizeQuote
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const NOW = 1_800_000_000_000;
const quote = normalizeQuote({ amountIn: 100, amountOut: 0.04, source: 'aggregator', at: NOW }, { now: NOW }).quote;

try {
  /* --- every transaction gets an explicit envelope --- */
  const shield = applyMevShield({ draft: { slippagePct: 0.5 }, quote, now: NOW });
  check('every transaction carries an explicit deadline',
    shield.guard.deadlineAt === NOW + DEFAULT_DEADLINE_SECS * 1000);
  check('every transaction carries an explicit slippage ceiling', shield.guard.maxSlippagePct === 0.5);
  check('the minimum output is derived from the locked quote and the ceiling',
    Math.abs(shield.guard.minAmountOut - 0.04 * 0.995) < 1e-12);
  check('the submission channel is always declared', SUBMISSION_CHANNELS.includes(shield.guard.submissionChannel));

  /* --- the policy can only tighten, never loosen --- */
  const tightened = applyMevShield({ draft: { slippagePct: 2 }, policy: { maxSlippagePct: 0.3 }, quote, now: NOW });
  check('the session policy tightens the ceiling', tightened.guard.maxSlippagePct === 0.3);
  const capped = applyMevShield({ draft: { slippagePct: 40 }, quote, now: NOW });
  check('no request can raise slippage above the hard cap', capped.guard.maxSlippagePct === HARD_MAX_SLIPPAGE_PCT);
  const cappedDeadline = applyMevShield({ draft: {}, quote, now: NOW, deadlineSecs: 999_999 });
  check('the deadline cannot be pushed arbitrarily far out', cappedDeadline.guard.deadlineSecs <= 1800);

  /* --- private submission is a real option --- */
  const priv = applyMevShield({ draft: {}, quote, now: NOW, privateRelay: { available: true, name: 'relay-a' } });
  check('a private relay is used when it is really available',
    priv.guard.submissionChannel === 'private' && priv.guard.mevProtected === true && priv.guard.privateRelay === 'relay-a');
  const pub = applyMevShield({ draft: {}, quote, now: NOW, privateRelay: { available: false } });
  check('without a relay the public channel is stated honestly, not claimed as protected',
    pub.guard.submissionChannel === 'public' && pub.guard.mevProtected === false);

  /* --- the pre-signing assertion is fail-closed --- */
  check('no guard at all is refused', assertProtected(null).ok === false);
  check('a guard with no deadline is refused',
    assertProtected({ ...shield.guard, deadlineAt: null }).error.detail === 'NO_DEADLINE');
  check('an expired guard is refused as a passed deadline',
    assertProtected(shield.guard, { now: NOW + 10_000_000 }).error.code === 'DEADLINE_PASSED');
  check('a guard with no slippage limit is refused',
    assertProtected({ ...shield.guard, maxSlippagePct: 0 }).error.detail === 'NO_SLIPPAGE_LIMIT');
  check('a guard above the hard cap is BLOCKED, not hoped through',
    assertProtected({ ...shield.guard, maxSlippagePct: HARD_MAX_SLIPPAGE_PCT + 1 }).error.code === 'RISK_BLOCKED');
  check('a guard with no declared channel is refused',
    assertProtected({ ...shield.guard, submissionChannel: 'somewhere' }).ok === false);
  check('a well-formed guard passes', assertProtected(shield.guard, { now: NOW }).ok === true);
  check('a minimum output below the stated ceiling is refused',
    assertProtected({ ...shield.guard, minAmountOut: 0.03 }, { now: NOW, quotedAmountOut: 0.04 }).error.code === 'RISK_BLOCKED');

  /* --- the guard travels with the transaction --- */
  const shielded = shieldTransaction({ chainId: 42161 }, shield.guard);
  check('the protection is written into the transaction itself',
    shielded.ok === true
    && shielded.tx.deadline === Math.floor(shield.guard.deadlineAt / 1000)
    && shielded.tx.maxSlippagePct === 0.5
    && shielded.tx.submissionChannel === 'public');
  check('an unprotected transaction cannot be built', shieldTransaction({}, null).ok === false);

  console.log(JSON.stringify({ probe: 'phase55-mev-shield', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
