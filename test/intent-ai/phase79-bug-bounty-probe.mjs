/**
 * PHASE 79 — BUG BOUNTY AND DISCLOSURE POLICY
 * A reward is a thank-you, never an admission of liability and never a promise
 * to cover losses. Good-faith research is protected; a report is answered
 * within a stated window and published either way.
 */
import { readFileSync } from 'node:fs';
import {
  buildBountyPolicy, submitReport, assessReward, disclosureDecision, assertNoLiabilityPromise,
  SEVERITY_BANDS, REWARD_BANDS, REWARD_CAP_USD, RESPONSE_WINDOW_MS,
  BOUNTY_IN_SCOPE, BOUNTY_OUT_OF_SCOPE, REPORT_STATES, BOUNTY_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const REPORT = {
  id: 'bb-1', area: 'confirmation-gate', severity: 'high',
  summary: 'The gate can be bypassed by replaying a stale confirmation token.',
  reproSteps: ['open gate', 'capture token', 'replay after expiry'],
  researcher: 'anon', goodFaith: true, now: NOW
};

try {
  /* ---------- the policy ---------- */
  const policy = buildBountyPolicy({ contact: 'security@example.com', now: NOW });
  check('a policy is published', policy.ok === true && policy.schema === BOUNTY_SCHEMA);
  check('the policy has a contact', policy.contact === 'security@example.com');
  check('the policy grants safe harbour', policy.safeHarbour === true);
  check('the policy commits to coordinated disclosure', policy.coordinatedDisclosure === true);
  check('the policy does NOT accept financial liability', policy.financialLiabilityAccepted === false);
  check('the policy does NOT promise to cover losses', policy.compensatesLosses === false);
  check('rewards are explicitly discretionary', policy.rewardIsDiscretionary === true);
  check('the reward cap is published', policy.rewardCapUsd === REWARD_CAP_USD);
  check('the response windows are published', policy.responseWindowMs.acknowledge === RESPONSE_WINDOW_MS.acknowledge);
  check('the acknowledge window is shorter than the fix window', RESPONSE_WINDOW_MS.acknowledge < RESPONSE_WINDOW_MS.fix);
  check('scope is stated', BOUNTY_IN_SCOPE.includes('confirmation-gate') && BOUNTY_IN_SCOPE.includes('session-keys'));
  check('market losses are explicitly out of scope', BOUNTY_OUT_OF_SCOPE.includes('market-loss'));
  check('a policy with no contact is not published', buildBountyPolicy({ now: NOW }).ok === false);
  check('the unpublished policy says why', buildBountyPolicy({ now: NOW }).i18nKey === 'intentAI.bounty.policyIncomplete');

  /* ---------- intake ---------- */
  const report = submitReport(REPORT);
  check('a good report is received', report.ok === true && report.state === 'received');
  check('the report gets an id', report.id === 'bb-1');
  check('an unnamed report still gets an id', typeof submitReport({ ...REPORT, id: null }).id === 'string');
  check('the acknowledge deadline is set', report.acknowledgeBy === NOW + RESPONSE_WINDOW_MS.acknowledge);
  check('the fix deadline is set', report.fixBy === NOW + RESPONSE_WINDOW_MS.fix);
  check('good-faith research is protected', report.safeHarbour === true);
  check('every state is a known state', REPORT_STATES.includes(report.state));
  check('an out-of-scope area is refused', submitReport({ ...REPORT, area: 'market-loss' }).reasons.includes('OUT_OF_SCOPE'));
  check('an unknown area is refused', submitReport({ ...REPORT, area: 'aliens' }).reasons.includes('UNKNOWN_AREA'));
  check('a report with no reproduction is refused', submitReport({ ...REPORT, reproSteps: [] }).reasons.includes('NO_REPRODUCTION'));
  check('a one-word report is refused', submitReport({ ...REPORT, summary: 'bug' }).reasons.includes('SUMMARY_TOO_SHORT'));
  check('a report with no severity is refused', submitReport({ ...REPORT, severity: null }).ok === false);
  check('a rejected report is still told why', submitReport({ ...REPORT, area: 'aliens' }).i18nKey === 'intentAI.bounty.rejected');
  check('even a rejected good-faith report keeps safe harbour', submitReport({ ...REPORT, area: 'aliens' }).safeHarbour === true);

  /* ---------- rewards are banded, capped, and not liability ---------- */
  const reward = assessReward({ report, quality: 1, now: NOW });
  check('a valid report earns a reward', reward.ok === true && reward.amountUsd > 0);
  check('the reward sits inside its band',
    reward.amountUsd >= REWARD_BANDS.high.min && reward.amountUsd <= REWARD_BANDS.high.max);
  check('a low-quality report earns the band floor',
    assessReward({ report, quality: 0, now: NOW }).amountUsd === REWARD_BANDS.high.min);
  check('critical pays more than low',
    assessReward({ report, severity: 'critical', quality: 1 }).amountUsd > assessReward({ report, severity: 'low', quality: 1 }).amountUsd);
  check('no reward exceeds the cap',
    SEVERITY_BANDS.every((s) => assessReward({ report, severity: s, quality: 1 }).amountUsd <= REWARD_CAP_USD));
  check('the reward is discretionary', reward.discretionary === true);
  check('paying does NOT accept liability', reward.financialLiabilityAccepted === false);
  check('paying does NOT compensate losses', reward.compensatesLosses === false);
  check('the reward is a translatable notice', reward.i18nKey === 'intentAI.bounty.reward');
  check('an invalid report earns nothing', assessReward({ report: { ok: false }, severity: 'high' }).amountUsd === 0);
  check('no report at all earns nothing', assessReward({ now: NOW }).ok === false);

  /* ---------- coordinated disclosure ---------- */
  const embargo = disclosureDecision({ report, fixed: false, now: NOW + 1000 });
  check('an unfixed report inside the window is embargoed', embargo.publish === false && embargo.reason === 'FIX_IN_PROGRESS');
  check('the embargo has a publication date', embargo.publishAt === report.fixBy);
  check('the embargo withholds details', embargo.withholdDetails === true);
  const fixed = disclosureDecision({ report, fixed: true, now: NOW + 1000 });
  check('a fixed report is published', fixed.publish === true && fixed.reason === 'FIXED');
  check('a published fix can show details', fixed.withholdDetails === false);
  const elapsed = disclosureDecision({ report, fixed: false, now: NOW + RESPONSE_WINDOW_MS.fix + 1 });
  check('an unfixed report is published anyway when the window ends', elapsed.publish === true);
  check('the reason for late publication is stated', elapsed.reason === 'WINDOW_ELAPSED');
  check('exploit details are withheld when unfixed', elapsed.withholdDetails === true);
  check('a report is never simply buried', [embargo, fixed, elapsed].every((d) => d.ok === true));
  check('no report means no decision', disclosureDecision({ now: NOW }).publish === false);

  /* ---------- the guard that must never let a promise ship ---------- */
  check('the honest policy may be published', assertNoLiabilityPromise(policy).mayPublish === true);
  check('a policy accepting liability is blocked',
    assertNoLiabilityPromise({ ...policy, financialLiabilityAccepted: true }).reasons.includes('ACCEPTS_FINANCIAL_LIABILITY'));
  check('a policy promising to cover losses is blocked',
    assertNoLiabilityPromise({ ...policy, compensatesLosses: true }).reasons.includes('PROMISES_LOSS_COMPENSATION'));
  check('a guaranteed payout is blocked',
    assertNoLiabilityPromise({ ...policy, guaranteedPayout: true }).reasons.includes('GUARANTEES_PAYOUT'));
  check('a reward above the cap is blocked',
    assertNoLiabilityPromise({ ...reward, amountUsd: REWARD_CAP_USD + 1 }).reasons.includes('REWARD_ABOVE_CAP'));
  check('an honest reward passes the guard', assertNoLiabilityPromise(reward).mayPublish === true);
  check('the guard rejects a non-policy', assertNoLiabilityPromise(null).ok === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the bounty copy is translated in en, fa and ar',
    locales.every((loc) => ['policy', 'received', 'rejected', 'reward', 'embargoed', 'disclosedFixed', 'disclosedUnfixed', 'liabilityNote']
      .every((k) => typeof loc?.intentAI?.bounty?.[k] === 'string')));
  check('the english liability note denies liability',
    /not an admission of liability/i.test(locales[0].intentAI.bounty.liabilityNote));
  check('no bounty copy promises to refund losses',
    Object.values(locales[0].intentAI.bounty).every((v) => !/we will (refund|reimburse|cover your)/i.test(v)));

  console.log(JSON.stringify({ probe: 'phase79-bug-bounty', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
