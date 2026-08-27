/**
 * PHASE 57 — LIVE DCA
 * A schedule is not an execution. Every periodic run needs a prior explicit
 * authorization and a fresh policy check, and the FIRST violation halts the
 * WHOLE program with a user notice — never "skip this one and continue".
 */
import { readFileSync } from 'node:fs';
import {
  armLiveDcaProgram, assertDcaAuthorization, tickLiveDca, stopLiveDca,
  DCA_HALT_REASONS, sanitizePolicy
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const POLICY = {
  ...sanitizePolicy({}).policy,
  maxCapitalUsd: 1000,
  maxTransactionUsd: 200,
  allowedChains: [42161],
  allowedProtocols: ['swap'],
  allowedAssets: ['USDC', 'ETH'],
  userConfirmed: true
};
const INTENT = { id: 'dca-intent', kind: 'swap', chainId: 42161, protocol: 'swap', amountUsd: 100 };
const AUTH = { confirmed: true, maxRuns: 3, maxAmountUsdPerRun: 150, expiresAt: NOW + 30 * 24 * HOUR };
const arm = (over = {}) => armLiveDcaProgram({
  id: 'dca-1',
  intent: INTENT,
  schedule: { intervalMs: HOUR, firstRunAt: NOW + HOUR },
  authorization: AUTH,
  maxRuns: 3,
  now: NOW,
  ...over
});

try {
  /* ---------- prior explicit authorization ---------- */
  check('no authorization at all is refused',
    assertDcaAuthorization(null, { runNumber: 1, now: NOW }).halt === 'AUTHORIZATION_MISSING');
  check('an authorization for a different program is refused',
    assertDcaAuthorization({ ...AUTH, programId: 'other' }, { programId: 'dca-1', runNumber: 1, now: NOW }).ok === false);
  check('an expired authorization is refused',
    assertDcaAuthorization({ ...AUTH, expiresAt: NOW - 1 }, { runNumber: 1, now: NOW }).halt === 'AUTHORIZATION_EXPIRED');
  check('a run beyond the authorized count is refused',
    assertDcaAuthorization(AUTH, { runNumber: 9, now: NOW }).halt === 'RUNS_EXHAUSTED');
  check('a run larger than the authorized per-run amount is refused',
    assertDcaAuthorization(AUTH, { runNumber: 1, amountUsd: 500, now: NOW }).halt === 'POLICY_VIOLATION');

  const unauthorized = arm({ authorization: { confirmed: false } });
  check('a program cannot even be armed without explicit authorization', unauthorized.ok === false);

  /* ---------- arming ---------- */
  const armed = arm();
  check('a valid program arms with its authorization bound to it',
    armed.ok === true && armed.program.authorization.programId === 'dca-1' && armed.program.halted === false);
  check('arming grants no execution permission by itself', armed.program.executionAuthorized === false);

  /* ---------- the trigger is real, and only when due ---------- */
  const early = await tickLiveDca(armed.program, { now: NOW, policy: POLICY, policyCheck: async () => ({ ok: true, decision: 'ALLOW_REVIEW_ONLY' }) });
  check('before the scheduled time nothing is prepared', early.ok === true && early.due === false && !early.run);

  const due = await tickLiveDca(armed.program, {
    now: NOW + HOUR,
    policy: POLICY,
    policyCheck: async () => ({ ok: true, decision: 'ALLOW_REVIEW_ONLY', policyVersion: 'v1' })
  });
  check('at the scheduled time a real run is prepared', due.ok === true && due.due === true && due.run.runNumber === 1);
  check('a prepared run still requires the confirmation gate — it is not an execution',
    due.run.executionAuthorized === false && due.run.requiresConfirmationGate === true);
  check('the schedule advances by exactly one interval', due.program.recurring.nextRunAt === NOW + 2 * HOUR);

  const second = await tickLiveDca(due.program, {
    now: NOW + 2 * HOUR,
    policy: POLICY,
    policyCheck: async () => ({ ok: true, decision: 'ALLOW_REVIEW_ONLY' })
  });
  check('a second in-policy run is prepared normally', second.ok === true && second.run.runNumber === 2);

  /* ---------- the policy is re-checked AT TRIGGER TIME ---------- */
  const tightened = { ...POLICY, maxTransactionUsd: 50 };
  const violated = await tickLiveDca(second.program, {
    now: NOW + 3 * HOUR,
    policy: tightened,
    policyCheck: async () => ({ ok: true, decision: 'ALLOW_REVIEW_ONLY' })
  });
  check('a run outside the CURRENT policy does not run', violated.ok === false && !violated.run);
  check('the first violation halts the WHOLE program, not just that run',
    violated.halted === true && violated.program.halted === true && violated.program.recurring.active === false);
  check('the halt reason is one of the declared reasons', DCA_HALT_REASONS.includes(violated.program.haltReason));
  check('the user is notified with a translatable notice',
    violated.notice.i18nKey === 'intentAI.dca.halt.POLICY_VIOLATION' && violated.notice.violations.length > 0);

  const afterHalt = await tickLiveDca(violated.program, {
    now: NOW + 4 * HOUR,
    policy: POLICY,
    policyCheck: async () => ({ ok: true, decision: 'ALLOW_REVIEW_ONLY' })
  });
  check('a halted program never resumes on its own', afterHalt.ok === false && afterHalt.halted === true);

  /* ---------- controls and policy re-check failures halt too ---------- */
  const stopped = await tickLiveDca(armed.program, { now: NOW + HOUR, policy: POLICY, controls: { stopped: true } });
  check('an active stop control halts the program', stopped.halted === true && stopped.program.haltReason === 'CONTROL_ACTIVE');

  const noPolicyCheck = await tickLiveDca(armed.program, { now: NOW + HOUR, policy: POLICY });
  check('no fresh policy evaluation means no run', noPolicyCheck.ok === false && noPolicyCheck.halted === true);

  const blockedByCheck = await tickLiveDca(armed.program, {
    now: NOW + HOUR,
    policy: POLICY,
    policyCheck: async () => ({ ok: true, decision: 'DENY' })
  });
  check('a policy evaluation that does not allow review blocks the program', blockedByCheck.ok === false);

  const userStopped = stopLiveDca(armed.program, { now: NOW + HOUR });
  check('the user can stop the whole program explicitly',
    userStopped.halted === true && userStopped.haltReason === 'USER_STOPPED');

  /* ---------- the halt notices are translated ---------- */
  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('every halt reason is translated in en, fa and ar',
    locales.every((locale) => DCA_HALT_REASONS.every((reason) => typeof locale?.intentAI?.dca?.halt?.[reason] === 'string')));

  console.log(JSON.stringify({ probe: 'phase57-live-dca', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
