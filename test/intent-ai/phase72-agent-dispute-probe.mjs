/**
 * PHASE 72 — AGENT DISPUTE RESOLUTION
 * A score is not a verdict. An agent can appeal with evidence, a decision
 * without evidence finalises nothing, and every slash is transparent,
 * appealable, capped and time-limited.
 */
import { readFileSync } from 'node:fs';
import {
  provisionalScore, fileAppeal, decideAppeal, finalizeScore, applySlash, assertDueProcess,
  DISPUTE_SCHEMA, APPEAL_WINDOW_MS, SLASH_REASONS, MAX_SLASH_FRACTION, SLASH_TTL_MS,
  MIN_OBSERVED_SAMPLE_SIZE
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const SCORE = provisionalScore({ agentId: 'agent-1', score: 0.42, sampleSize: 8, now: NOW });
const EVIDENCE = [{ kind: 'receipt', ref: 'r1' }, { kind: 'log', ref: 'l1' }];

try {
  /* ---------- a score starts provisional ---------- */
  check('a score is produced', SCORE.ok === true && SCORE.schema === DISPUTE_SCHEMA);
  check('a fresh score is NOT final', SCORE.final === false);
  check('the appeal window is stated', SCORE.appealableUntil === NOW + APPEAL_WINDOW_MS);
  check('the provisional state is a translatable key', SCORE.i18nKey === 'intentAI.dispute.provisional');
  const thin = provisionalScore({ agentId: 'agent-2', score: 0.1, sampleSize: MIN_OBSERVED_SAMPLE_SIZE - 1, now: NOW });
  check('an under-sampled score is not displayed', thin.displayable === false && thin.score === null);
  check('under-sampling is called insufficient evidence, not a bad score', thin.i18nKey === 'intentAI.dispute.insufficientEvidence');
  check('a score with no value is refused', provisionalScore({ agentId: 'agent-1', now: NOW }).ok === false);
  check('an empty-string score is not read as zero', provisionalScore({ agentId: 'agent-1', score: '', sampleSize: 9, now: NOW }).ok === false);

  /* ---------- appeals ---------- */
  const appeal = fileAppeal({ agentId: 'agent-1', caseId: 'case-1', score: SCORE, evidence: EVIDENCE, filedBy: 'agent-1', now: NOW + 1000 });
  check('an agent can appeal with evidence', appeal.ok === true && appeal.appeal.state === 'open');
  check('filing freezes the penalty', appeal.penaltyFrozen === true);
  check('the appeal has a decision deadline', appeal.appeal.decideBy === NOW + 1000 + APPEAL_WINDOW_MS);
  check('the filing is a translatable notice', appeal.i18nKey === 'intentAI.dispute.appealFiled');
  check('an appeal with no evidence is refused',
    fileAppeal({ agentId: 'agent-1', caseId: 'c', score: SCORE, evidence: [], filedBy: 'agent-1', now: NOW }).reasons.includes('NO_EVIDENCE'));
  check('junk evidence is not evidence',
    fileAppeal({ agentId: 'agent-1', caseId: 'c', score: SCORE, evidence: ['trust me'], filedBy: 'agent-1', now: NOW }).ok === false);
  check('somebody else cannot appeal for the agent',
    fileAppeal({ agentId: 'agent-1', caseId: 'c', score: SCORE, evidence: EVIDENCE, filedBy: 'agent-9', now: NOW }).reasons.includes('NOT_THE_AGENT'));
  check('an appeal after the window is refused',
    fileAppeal({ agentId: 'agent-1', caseId: 'c', score: SCORE, evidence: EVIDENCE, filedBy: 'agent-1', now: NOW + APPEAL_WINDOW_MS + 1 }).reasons.includes('APPEAL_WINDOW_CLOSED'));
  check('the late appeal is a deadline failure',
    fileAppeal({ agentId: 'agent-1', caseId: 'c', score: SCORE, evidence: EVIDENCE, filedBy: 'agent-1', now: NOW + APPEAL_WINDOW_MS + 1 }).error.code === 'DEADLINE_PASSED');

  /* ---------- decisions need evidence on the record ---------- */
  const noEvidence = decideAppeal(appeal.appeal, { upheld: false, reviewerId: 'rev-1', evidenceReviewed: [], now: NOW + 2000 });
  check('a decision with no reviewed evidence is refused', noEvidence.ok === false);
  check('such a decision finalises NOTHING', noEvidence.scoreFinal === false);
  check('the refusal asks for evidence', noEvidence.i18nKey === 'intentAI.dispute.needsEvidence');
  check('a decision with no reviewer is refused',
    decideAppeal(appeal.appeal, { upheld: true, evidenceReviewed: EVIDENCE, now: NOW + 2000 }).ok === false);
  const upheld = decideAppeal(appeal.appeal, { upheld: true, reviewerId: 'rev-1', evidenceReviewed: EVIDENCE, now: NOW + 2000 });
  check('an evidenced appeal can be upheld', upheld.appeal.state === 'upheld');
  check('upholding reverses the penalty', upheld.penaltyReversed === true && upheld.penaltyFrozen === false);
  check('upholding makes the score final', upheld.scoreFinal === true);
  const rejected = decideAppeal(appeal.appeal, { upheld: false, reviewerId: 'rev-1', evidenceReviewed: EVIDENCE, now: NOW + 2000 });
  check('an appeal can also be rejected on evidence', rejected.appeal.state === 'rejected' && rejected.penaltyReversed === false);
  check('the rejection is a translatable notice', rejected.i18nKey === 'intentAI.dispute.appealRejected');
  const expired = decideAppeal(appeal.appeal, { upheld: true, reviewerId: 'rev-1', evidenceReviewed: EVIDENCE, now: NOW + APPEAL_WINDOW_MS + 5000 });
  check('an undecided appeal expires', expired.appeal.state === 'expired');
  check('an expired appeal does not finalise the score either', expired.scoreFinal === false);
  check('deciding a closed appeal does nothing', decideAppeal({ state: 'upheld' }, { upheld: true, reviewerId: 'r', evidenceReviewed: EVIDENCE }).ok === false);

  /* ---------- finalisation ---------- */
  check('a score inside its window is not final', finalizeScore(SCORE, { now: NOW + 1000 }).final === false);
  check('an unappealed score finalises after the window', finalizeScore(SCORE, { now: NOW + APPEAL_WINDOW_MS + 1 }).final === true);
  check('an evidenced decision finalises the score', finalizeScore(SCORE, { appealDecision: rejected, now: NOW }).final === true);
  check('an unresolved appeal keeps the score provisional',
    finalizeScore(SCORE, { appealDecision: noEvidence, now: NOW }).final === false);
  check('an expired appeal keeps the score provisional',
    finalizeScore(SCORE, { appealDecision: expired, now: NOW }).final === false);
  check('an upheld appeal clears the score', finalizeScore(SCORE, { appealDecision: upheld, now: NOW }).score.score === null);
  check('the revision is recorded', finalizeScore(SCORE, { appealDecision: upheld, now: NOW }).score.revisedByAppeal === true);
  check('a final score says so', finalizeScore(SCORE, { appealDecision: rejected, now: NOW }).i18nKey === 'intentAI.dispute.final');
  check('finalising nothing is refused', finalizeScore(null, { now: NOW }).final === false);

  /* ---------- slashing is transparent ---------- */
  const slash = applySlash({ agentId: 'agent-1', reason: 'undelivered', stakeUsd: 1000, fraction: 0.1, caseId: 'case-1', now: NOW });
  check('a slash can be applied', slash.ok === true && slash.slash.amountUsd === 100);
  check('the slash names its case', slash.slash.caseId === 'case-1');
  check('the slash is appealable', slash.slash.appealable === true && slash.slash.appealableUntil === NOW + APPEAL_WINDOW_MS);
  check('the slash is transparent', slash.slash.transparent === true);
  check('the slash expires', slash.slash.expiresAt === NOW + SLASH_TTL_MS);
  check('the slash is frozen', Object.isFrozen(slash.slash));
  check('the slash is a translatable notice', slash.i18nKey === 'intentAI.dispute.slashed');
  check('a slash is capped',
    applySlash({ agentId: 'a', reason: 'undelivered', stakeUsd: 1000, fraction: 0.99, caseId: 'c', now: NOW }).slash.fraction === MAX_SLASH_FRACTION);
  check('a slash with no case reference is refused',
    applySlash({ agentId: 'a', reason: 'undelivered', stakeUsd: 100, now: NOW }).reasons.includes('NO_CASE_REFERENCE'));
  check('a slash for an invented reason is refused',
    applySlash({ agentId: 'a', reason: 'vibes', stakeUsd: 100, caseId: 'c', now: NOW }).reasons.includes('UNKNOWN_REASON'));
  check('a slash with no stake is refused', applySlash({ agentId: 'a', reason: 'undelivered', caseId: 'c', now: NOW }).ok === false);
  check('every slash reason is declared', SLASH_REASONS.length === 4);

  /* ---------- due process ---------- */
  check('an honest slash passes due process', assertDueProcess({ slash: slash.slash }).ok === true);
  check('an un-appealable slash is caught',
    assertDueProcess({ slash: { ...slash.slash, appealable: false } }).reasons.includes('SLASH_NOT_APPEALABLE'));
  check('a secret slash is caught',
    assertDueProcess({ slash: { ...slash.slash, transparent: false } }).reasons.includes('SLASH_NOT_TRANSPARENT'));
  check('a slash with no case is caught',
    assertDueProcess({ slash: { ...slash.slash, caseId: null } }).reasons.includes('SLASH_WITHOUT_CASE'));
  check('an oversized slash is caught',
    assertDueProcess({ slash: { ...slash.slash, fraction: 0.9 } }).reasons.includes('SLASH_ABOVE_CAP'));
  check('a permanent slash is caught',
    assertDueProcess({ slash: { ...slash.slash, expiresAt: null } }).reasons.includes('SLASH_NEVER_EXPIRES'));
  check('a displayed under-sampled score is caught',
    assertDueProcess({ score: { displayable: true, sampleSize: 1 } }).reasons.includes('SCORE_UNDER_SAMPLED'));
  check('an honest score passes due process', assertDueProcess({ score: SCORE }).ok === true);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the dispute copy is translated in en, fa and ar',
    locales.every((loc) => ['provisional', 'final', 'appealFiled', 'appealUpheld', 'appealRejected', 'slashed', 'needsEvidence']
      .every((k) => typeof loc?.intentAI?.dispute?.[k] === 'string')));
  check('the english slash copy says it can be appealed', /appeal/i.test(locales[0].intentAI.dispute.slashed));

  console.log(JSON.stringify({ probe: 'phase72-agent-dispute', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
