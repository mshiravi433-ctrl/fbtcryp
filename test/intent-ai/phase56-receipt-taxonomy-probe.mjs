/**
 * PHASE 56 — RECEIPT ERROR TAXONOMY (the reported bug)
 * ---------------------------------------------------------------------------
 * Reproduction: a $100 swap → the confirmation screen → the amount edited to
 * $500 (under the $5k product ceiling, OVER the default $200 L3 session-policy
 * ceiling) → confirm. The receipt used to say "Unavailable — no live venue".
 * It must say "above the session policy limit", and the final confirm must be
 * locked before the user ever gets there.
 */
import { readFileSync } from 'node:fs';
import {
  sessionPolicyCaps, checkSessionPolicy, explainExecutionFailure, receiptStatusForReason,
  RECEIPT_REASONS, guardianReasonsFromError,
  startSession, chatTurn, confirmSessionPolicy, executeConfirmed, sanitizePolicy
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const L3_POLICY = {
  maxCapitalUsd: 1000,
  maxTransactionUsd: 200,
  maxLossUsd: 100,
  maxLeverage: 2,
  allowedChains: [42161, 8453],
  allowedProtocols: ['swap'],
  allowedAssets: ['USDC', 'ETH', 'BTC'],
  durationMs: 3_600_000
};

try {
  const policy = { ...sanitizePolicy({ ...L3_POLICY, level: 3 }).policy, ...L3_POLICY, userConfirmed: true };

  /* ---------- 1. the ceilings the screen must show ---------- */
  const caps = sessionPolicyCaps(policy);
  check('the active session policy exposes its per-transaction ceiling', caps.maxTransactionUsd === 200);
  check('the active session policy exposes its capital ceiling', caps.maxCapitalUsd === 1000);
  check('with no policy there is nothing to claim', sessionPolicyCaps(null) === null);

  /* ---------- 2. the reproduction case, checked before execution ---------- */
  const ok100 = checkSessionPolicy({ amountUsd: 100, chainId: 42161, protocol: 'swap', fromSymbol: 'USDC', toSymbol: 'ETH' }, policy);
  check('a $100 swap is inside the session policy', ok100.ok === true && ok100.violations.length === 0);

  const over500 = checkSessionPolicy({ amountUsd: 500, chainId: 42161, protocol: 'swap', fromSymbol: 'USDC', toSymbol: 'ETH' }, policy);
  check('a $500 edit breaks the session policy even though it clears the product ceiling',
    over500.ok === false && over500.violations[0].code === 'SESSION_PER_TX_OVER_POLICY');
  check('the violation names the amount AND the session limit',
    over500.violations[0].params.value === 500 && over500.violations[0].params.limit === 200);
  check('the violation points at a translatable session-policy message',
    over500.violations[0].i18nKey === RECEIPT_REASONS.POLICY_PER_TX);

  const badChain = checkSessionPolicy({ amountUsd: 50, chainId: 1 }, policy);
  check('a network outside the policy is its own named violation', badChain.violations[0].code === 'SESSION_CHAIN_NOT_ALLOWED');
  const badAsset = checkSessionPolicy({ amountUsd: 50, chainId: 42161, fromSymbol: 'USDC', toSymbol: 'DOGE' }, policy);
  check('an asset outside the policy is its own named violation', badAsset.violations[0].code === 'SESSION_ASSET_NOT_ALLOWED');
  const badProtocol = checkSessionPolicy({ amountUsd: 50, chainId: 42161, protocol: 'bridge' }, policy);
  check('a protocol outside the policy is its own named violation', badProtocol.violations[0].code === 'SESSION_PROTOCOL_NOT_ALLOWED');

  /* ---------- 3. every failure gets its OWN receipt line ---------- */
  const guardianRejection = explainExecutionFailure({
    error: { code: 'GUARDIAN_REJECTED', detail: JSON.stringify({ reasons: ['TRANSACTION_LIMIT_EXCEEDED'] }) },
    policy,
    terms: { amountIn: 500 }
  });
  check('a guardian per-transaction rejection is NOT reported as "no live venue"',
    guardianRejection.reason === 'POLICY_PER_TX' && guardianRejection.status === 'blocked' && guardianRejection.status !== 'unavailable');
  check('the receipt reason carries the real numbers',
    guardianRejection.params.value === 500 && guardianRejection.params.limit === 200);
  check('the guardian reasons survive into the receipt',
    guardianRejection.reasons.includes('TRANSACTION_LIMIT_EXCEEDED')
    && guardianReasonsFromError({ detail: JSON.stringify({ reasons: ['ASSET_NOT_IN_POLICY'] }) })[0] === 'ASSET_NOT_IN_POLICY');

  const cases = [
    [{ code: 'GUARDIAN_REJECTED', detail: JSON.stringify({ reasons: ['ASSET_NOT_IN_POLICY'] }) }, 'POLICY_ASSET'],
    [{ code: 'GUARDIAN_REJECTED', detail: JSON.stringify({ reasons: ['CHAIN_NOT_IN_POLICY'] }) }, 'POLICY_CHAIN'],
    [{ code: 'GUARDIAN_REJECTED', detail: JSON.stringify({ reasons: ['PROTOCOL_NOT_IN_POLICY'] }) }, 'POLICY_PROTOCOL'],
    [{ code: 'GUARDIAN_REJECTED', detail: JSON.stringify({ reasons: ['SESSION_EXPIRED'] }) }, 'POLICY_EXPIRED'],
    [{ code: 'GUARDIAN_REJECTED', detail: JSON.stringify({ reasons: ['CAPITAL_ABOVE_GLOBAL_HARD_CAP'] }) }, 'PRODUCT_LIMIT'],
    [{ code: 'USER_AUTHORIZATION_REQUIRED', detail: 'AUTHORIZATION_SCREEN_NOT_CONFIRMED' }, 'AUTHORIZATION'],
    [{ code: 'EMERGENCY_STOP' }, 'EMERGENCY_STOP'],
    [{ code: 'MISSING_DATA', detail: 'NO_SIGNER' }, 'NO_SIGNER'],
    [{ code: 'MISSING_DATA', detail: 'NO_PROVIDER' }, 'NO_PROVIDER'],
    [{ code: 'MISSING_DATA', detail: 'NO_QUOTE_SOURCE' }, 'NO_QUOTE'],
    [{ code: 'MISSING_DATA', detail: 'NO_BROADCASTER' }, 'NO_BROADCASTER'],
    [{ code: 'MISSING_DATA', detail: 'BRIDGE_EXECUTE_UNAVAILABLE' }, 'BRIDGE_UNAVAILABLE'],
    [{ code: 'TERMS_CHANGED', detail: 'SLIPPAGE_EXCEEDED:3.4' }, 'SLIPPAGE_MOVED'],
    [{ code: 'ONCHAIN_REVERT' }, 'REVERTED'],
    [{ code: 'RISK_BLOCKED' }, 'RISK_BLOCKED'],
    [{ code: 'SESSION_KEY_REVOKED' }, 'SESSION_KEY']
  ];
  const distinct = cases.every(([error, expected]) => explainExecutionFailure({ error, policy }).reason === expected);
  check('each failure class gets its own reason instead of one generic label', distinct);
  const keys = new Set(cases.map(([error]) => explainExecutionFailure({ error, policy }).i18nKey));
  check('those reasons map to distinct translatable keys', keys.size === new Set(cases.map(([, r]) => r)).size);

  check('an emergency stop is not "unavailable"', receiptStatusForReason('EMERGENCY_STOP') === 'emergency-stop');
  check('a missing authorization is not "unavailable"', receiptStatusForReason('AUTHORIZATION') === 'unconfirmed');
  check('a policy refusal is "blocked"', receiptStatusForReason('POLICY_ASSET') === 'blocked');
  check('a genuinely dead route is still honestly "unavailable"', receiptStatusForReason('NO_ROUTE') === 'unavailable');

  /* ---------- 4. end to end through the real pipeline ---------- */
  let session = startSession({ mode: 'human-ai', level: 3, defaultChainId: 42161, policyInput: L3_POLICY });
  session = confirmSessionPolicy(session).session;
  const prepared = chatTurn(session, 'swap 100 USDC to ETH on Arbitrum');
  session = prepared.session;
  const draft = session.drafts.at(-1);
  check('the $100 swap really did prepare a draft', Boolean(draft));

  // The user edits the amount on the confirmation screen: 100 → 500.
  session = { ...session, drafts: session.drafts.map((d) => (d.id === draft.id ? { ...d, amountIn: 500, amountUsd: 500 } : d)) };
  const executed = executeConfirmed(session, { action: 'CONFIRM', draftId: draft.id });
  check('the over-policy execution is refused', executed.ok === false);
  check('the refusal explains itself as a SESSION POLICY limit, not a dead venue',
    executed.explain && ['POLICY_PER_TX', 'POLICY_CAPITAL'].includes(executed.explain.reason) && executed.explain.status === 'blocked');
  check('the chat message carries the same reason key',
    executed.session.messages.at(-1)?.payload?.reasonKey === executed.explain.i18nKey);

  /* ---------- 5. the panel really shows it ---------- */
  const panel = readFileSync('src/components/IntentAIPanel.jsx', 'utf8');
  check('the panel computes the active session-policy ceilings',
    panel.includes('sessionPolicyCaps(') && panel.includes('checkSessionPolicy('));
  check('the panel renders the session ceilings under the fields',
    panel.includes('session-policy-per-tx') && panel.includes('intentAI.policyLimits.hintPerTx'));
  check('the panel renders the violation and locks the final confirm',
    panel.includes('session-policy-violation') && panel.includes('disabled={confirmBlocked}'));
  check('the receipt renders the real reason', panel.includes('receipt-reason') && panel.includes('receipt.reasonKey'));
  check('the panel still holds no hardcoded Persian or Arabic text', !/[\u0600-\u06ff]/.test(panel));
  check('the panel keeps the four gate actions and the audited identifiers',
    ['CONFIRM', 'REJECT', 'CANCEL', 'REAUTHORIZE'].every((a) => panel.includes(`'${a}'`))
    && ['openConfirmationGate', 'decideGate', 'assertGateAllowsSubmit', 'venueHealth', 'reconcile'].every((id) => panel.includes(id)));

  /* ---------- 6. every reason is translated in en, fa and ar ---------- */
  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  const reasonLeaves = Object.values(RECEIPT_REASONS).map((k) => k.split('.').slice(1));
  const translated = locales.every((locale) => reasonLeaves.every((path) => {
    const value = path.reduce((acc, key) => (acc ? acc[key] : undefined), locale.intentAI ? { intentAI: locale.intentAI }.intentAI : undefined);
    return typeof value === 'string' && value.length > 0;
  }));
  check('every receipt reason is translated in en, fa and ar', translated);
  check('the session-policy captions are translated in en, fa and ar',
    locales.every((locale) => ['hintPerTx', 'hintCapital', 'violationTitle']
      .every((key) => typeof locale?.intentAI?.policyLimits?.[key] === 'string')));
  check('the blocked receipt status is translated in en, fa and ar',
    locales.every((locale) => typeof locale?.intentAI?.receipt?.blocked === 'string'));

  console.log(JSON.stringify({ probe: 'phase56-receipt-taxonomy', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
