/**
 * PHASE 97 — GRADUAL AUTONOMY (L1 → L3)
 * Autonomy is earned from real history and taken, never given: eligibility is
 * computed, promotion needs an explicit request, levels rise one at a time,
 * and going back to L1 is always available.
 */
import { readFileSync } from 'node:fs';
import {
  autonomyProfile, evaluatePromotion, requestPromotion, demoteToL1, assertNoAutoPromotion,
  AUTONOMY_LEVELS, PROMOTION_REQUIREMENTS, PROMOTION_COOLDOWN_MS, AUTONOMY_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const REQUEST = { userConfirmed: true, at: NOW - 1000 };

const historyFor = (level) => ({
  userId: 'u1',
  confirmedIntents: PROMOTION_REQUIREMENTS[level].minConfirmedIntents,
  firstSeenAt: NOW - PROMOTION_REQUIREMENTS[level].minAccountAgeMs,
  safetyIncidents: 0,
  riskQuizPassed: true
});

try {
  /* ---------- the profile ---------- */
  const profile = autonomyProfile({ history: historyFor(2), currentLevel: 1, now: NOW });
  check('a profile is built', profile.ok === true && profile.schema === AUTONOMY_SCHEMA);
  check('the profile reports the current level', profile.level === 1);
  check('the profile never says it promoted anybody', profile.autoPromoted === false);
  check('the profile names the next level as a possibility', profile.nextLevel === 2);
  check('at the top there is no next level', autonomyProfile({ history: historyFor(3), currentLevel: 3, now: NOW }).nextLevel === null);
  check('an unknown level falls back to level 1', autonomyProfile({ currentLevel: 9, now: NOW }).level === 1);
  check('an empty-string level is not read as zero', autonomyProfile({ currentLevel: '', now: NOW }).level === 1);
  check('a null level is not read as zero', autonomyProfile({ currentLevel: null, now: NOW }).level === 1);
  check('a boolean level is not read as one', autonomyProfile({ currentLevel: true, now: NOW }).level === 1);
  check('no history means no progress, not a default pass', autonomyProfile({ now: NOW }).confirmedIntents === 0);
  check('the level list is exactly 1, 2, 3', AUTONOMY_LEVELS.join(',') === '1,2,3');

  /* ---------- eligibility ---------- */
  const eligible = evaluatePromotion({ history: historyFor(2), currentLevel: 1, now: NOW });
  check('a full record is eligible for the next level', eligible.eligible === true && eligible.targetLevel === 2);
  check('eligibility is not promotion', eligible.promoted === false);
  check('eligibility says an explicit request is still needed', eligible.requiresExplicitRequest === true);
  check('a thin record is not eligible',
    evaluatePromotion({ history: { ...historyFor(2), confirmedIntents: 1 }, currentLevel: 1, now: NOW }).eligible === false);
  check('the missing evidence is named',
    evaluatePromotion({ history: { ...historyFor(2), confirmedIntents: 1 }, currentLevel: 1, now: NOW }).missing.includes('NOT_ENOUGH_CONFIRMED_INTENTS'));
  check('a brand-new account is not eligible',
    evaluatePromotion({ history: { ...historyFor(2), firstSeenAt: NOW - DAY }, currentLevel: 1, now: NOW }).missing.includes('ACCOUNT_TOO_NEW'));
  check('a safety incident blocks promotion',
    evaluatePromotion({ history: { ...historyFor(2), safetyIncidents: 1 }, currentLevel: 1, now: NOW }).missing.includes('SAFETY_INCIDENT_ON_RECORD'));
  check('risk understanding has to be shown',
    evaluatePromotion({ history: { ...historyFor(2), riskQuizPassed: false }, currentLevel: 1, now: NOW }).missing.includes('RISK_UNDERSTANDING_NOT_SHOWN'));
  check('an unanswered quiz is not a pass',
    evaluatePromotion({ history: { ...historyFor(2), riskQuizPassed: 'yes' }, currentLevel: 1, now: NOW }).missing.includes('RISK_UNDERSTANDING_NOT_SHOWN'));
  check('a recent promotion holds the next one',
    evaluatePromotion({ history: historyFor(3), currentLevel: 2, lastPromotedAt: NOW - 1000, now: NOW }).missing.includes('COOLDOWN_ACTIVE'));
  check('the cooldown expires',
    evaluatePromotion({ history: historyFor(3), currentLevel: 2, lastPromotedAt: NOW - PROMOTION_COOLDOWN_MS - 1, now: NOW }).eligible === true);
  check('L3 needs a much longer record than L2',
    PROMOTION_REQUIREMENTS[3].minConfirmedIntents > PROMOTION_REQUIREMENTS[2].minConfirmedIntents);
  check('no level tolerates a safety incident',
    Object.values(PROMOTION_REQUIREMENTS).every((r) => r.maxIncidents === 0));
  check('at the maximum level there is nothing to evaluate',
    evaluatePromotion({ history: historyFor(3), currentLevel: 3, now: NOW }).atMax === true);
  check('no history at all is not eligible', evaluatePromotion({ currentLevel: 1, now: NOW }).eligible === false);

  /* ---------- promotion is always requested ---------- */
  const promoted = requestPromotion({ history: historyFor(2), currentLevel: 1, targetLevel: 2, userRequest: REQUEST, now: NOW });
  check('an eligible, requested promotion succeeds', promoted.ok === true && promoted.level === 2);
  check('the promotion is never marked automatic', promoted.autoPromoted === false);
  check('the promotion records when the user asked', promoted.requestedAt === REQUEST.at);
  check('the promotion is reversible', promoted.reversible === true);
  check('even a promoted level still needs the confirmation gate', promoted.requiresConfirmationGate === true);
  check('a promotion without an explicit request is refused',
    requestPromotion({ history: historyFor(2), currentLevel: 1, targetLevel: 2, now: NOW }).promoted === false);
  check('the missing request is an authorization failure',
    requestPromotion({ history: historyFor(2), currentLevel: 1, targetLevel: 2, now: NOW }).error.code === 'USER_AUTHORIZATION_REQUIRED');
  check('an unconfirmed request is not a request',
    requestPromotion({ history: historyFor(2), currentLevel: 1, targetLevel: 2, userRequest: { userConfirmed: false, at: NOW }, now: NOW }).promoted === false);
  check('an untimestamped request is not a request',
    requestPromotion({ history: historyFor(2), currentLevel: 1, targetLevel: 2, userRequest: { userConfirmed: true }, now: NOW }).promoted === false);
  check('an empty-string timestamp is not read as the epoch',
    requestPromotion({ history: historyFor(2), currentLevel: 1, targetLevel: 2, userRequest: { userConfirmed: true, at: '' }, now: NOW }).promoted === false);
  check('L1 to L3 in one step is refused even with a perfect record',
    requestPromotion({ history: historyFor(3), currentLevel: 1, targetLevel: 3, userRequest: REQUEST, now: NOW }).promoted === false);
  check('the skip refusal names itself',
    requestPromotion({ history: historyFor(3), currentLevel: 1, targetLevel: 3, userRequest: REQUEST, now: NOW }).reason === 'NO_LEVEL_SKIPPING');
  check('the skip refusal is a friendly, translatable notice',
    requestPromotion({ history: historyFor(3), currentLevel: 1, targetLevel: 3, userRequest: REQUEST, now: NOW }).i18nKey === 'intentAI.autonomy.noSkipping');
  check('an ineligible request is refused',
    requestPromotion({ history: { ...historyFor(2), confirmedIntents: 0 }, currentLevel: 1, targetLevel: 2, userRequest: REQUEST, now: NOW }).promoted === false);
  check('the ineligible refusal lists what is missing',
    requestPromotion({ history: { ...historyFor(2), confirmedIntents: 0 }, currentLevel: 1, targetLevel: 2, userRequest: REQUEST, now: NOW }).missing.length > 0);
  check('asking for a level you already hold is refused',
    requestPromotion({ history: historyFor(2), currentLevel: 2, targetLevel: 2, userRequest: REQUEST, now: NOW }).promoted === false);
  check('asking for a lower level through promotion is refused',
    requestPromotion({ history: historyFor(2), currentLevel: 3, targetLevel: 2, userRequest: REQUEST, now: NOW }).reason === 'NOT_A_PROMOTION');
  check('an invented level is refused',
    requestPromotion({ history: historyFor(2), currentLevel: 1, targetLevel: 7, userRequest: REQUEST, now: NOW }).promoted === false);
  check('the two-step path L1 to L2 to L3 works',
    requestPromotion({
      history: historyFor(3), currentLevel: 2, targetLevel: 3,
      userRequest: REQUEST, lastPromotedAt: NOW - PROMOTION_COOLDOWN_MS - 1, now: NOW
    }).level === 3);

  /* ---------- going back is always possible ---------- */
  const demoted = demoteToL1({ currentLevel: 3, reason: 'USER_REQUEST', now: NOW });
  check('demotion to L1 always works', demoted.ok === true && demoted.level === 1);
  check('the demotion remembers where it came from', demoted.previousLevel === 3);
  check('the demotion needs no eligibility check', demoted.demoted === true);
  check('a demotion resets the cooldown so trust is rebuilt', demoted.cooldownResetAt === NOW);
  check('demotion from L2 works too', demoteToL1({ currentLevel: 2, now: NOW }).level === 1);
  check('demotion from L1 is a no-op that still succeeds', demoteToL1({ currentLevel: 1, now: NOW }).level === 1);
  check('a demotion after an incident is available immediately',
    demoteToL1({ currentLevel: 3, reason: 'SUSPECTED_COMPROMISE', now: NOW }).reason === 'SUSPECTED_COMPROMISE');
  check('after a demotion the next promotion is on cooldown',
    evaluatePromotion({ history: historyFor(2), currentLevel: 1, lastPromotedAt: demoted.lastPromotedAt, now: NOW }).missing.includes('COOLDOWN_ACTIVE'));

  /* ---------- the guard ---------- */
  check('an honest promotion passes the guard',
    assertNoAutoPromotion({ evaluation: eligible, promotion: promoted, profile }).ok === true);
  check('an evaluation that promoted is caught',
    assertNoAutoPromotion({ evaluation: { ...eligible, promoted: true } }).reasons.includes('EVALUATION_PROMOTED'));
  check('an automatic promotion is caught',
    assertNoAutoPromotion({ promotion: { ...promoted, autoPromoted: true } }).reasons.includes('AUTO_PROMOTED'));
  check('a promotion with no request is caught',
    assertNoAutoPromotion({ promotion: { ...promoted, requestedAt: null } }).reasons.includes('PROMOTED_WITHOUT_REQUEST'));
  check('a skipped level is caught',
    assertNoAutoPromotion({ promotion: { ...promoted, previousLevel: 1, level: 3 } }).reasons.includes('LEVEL_SKIPPED'));
  check('an irreversible promotion is caught',
    assertNoAutoPromotion({ promotion: { ...promoted, reversible: false } }).reasons.includes('PROMOTION_IRREVERSIBLE'));
  check('a promotion that skips the gate is caught',
    assertNoAutoPromotion({ promotion: { ...promoted, requiresConfirmationGate: false } }).reasons.includes('PROMOTION_SKIPS_GATE'));
  check('an unrequested rise in a transition log is caught',
    assertNoAutoPromotion({ transitions: [{ from: 1, to: 2, userRequested: false }] }).reasons.includes('UNREQUESTED_LEVEL_RISE'));
  check('a requested rise in a transition log passes',
    assertNoAutoPromotion({ transitions: [{ from: 1, to: 2, userRequested: true }] }).ok === true);
  check('a blocked demotion is caught',
    assertNoAutoPromotion({ transitions: [{ from: 3, to: 1, blocked: true }] }).reasons.includes('DEMOTION_BLOCKED'));
  check('the guard rejection is a guardian rejection',
    assertNoAutoPromotion({ promotion: { ...promoted, autoPromoted: true } }).error.code === 'GUARDIAN_REJECTED');

  /* ---------- copy ---------- */
  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the autonomy copy is translated in en, fa and ar',
    locales.every((loc) => ['level1', 'level2', 'level3', 'eligible', 'notEligible', 'needsRequest', 'noSkipping', 'promoted', 'demoted']
      .every((k) => typeof loc?.intentAI?.autonomy?.[k] === 'string')));
  check('the english copy says levels never rise on their own',
    /never rise on their own/i.test(locales[0].intentAI.autonomy.needsRequest));
  check('the english copy offers the way back',
    /return to level 1/i.test(locales[0].intentAI.autonomy.promoted));
  check('the english copy never promises a better outcome at a higher level',
    !/profit|earn more|better returns/i.test(Object.values(locales[0].intentAI.autonomy).join(' ')));

  console.log(JSON.stringify({ probe: 'phase97-gradual-autonomy', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
