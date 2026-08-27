/**
 * PHASE 74 — LIVE SPECIALIST MARKETPLACE
 * A market is not a shop window. An agent without proven, independently
 * attested, recent work in a capability is never suggested — and an empty
 * market is an honest answer.
 */
import { readFileSync } from 'node:fs';
import {
  proveSkill, computeSupply, computeDemand, marketConditions, suggestSpecialists,
  assertOnlyProvenSuggested, MARKETPLACE_SCHEMA, MIN_PROVEN_JOBS, PROOF_MAX_AGE_MS
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const job = (over = {}) => ({ capability: 'analysis', verified: true, attestedBy: 'assurance-op', outcome: 'success', at: NOW - 86_400_000, ...over });
const agent = (id, over = {}) => ({
  id, priceUsd: 50, activeJobs: 0, maxConcurrentJobs: 3,
  completedJobs: Array.from({ length: MIN_PROVEN_JOBS + 1 }, () => job()), ...over
});

const AGENTS = [
  agent('good'),
  agent('novice', { completedJobs: [job(), job()] }),
  agent('unverified', { completedJobs: Array.from({ length: 8 }, () => job({ verified: false })) }),
  agent('self-attested', { completedJobs: Array.from({ length: 8 }, () => job({ attestedBy: 'self-attested' })) }),
  agent('stale', { completedJobs: Array.from({ length: 8 }, () => job({ at: NOW - PROOF_MAX_AGE_MS - 1 })) }),
  agent('failing', { completedJobs: Array.from({ length: 8 }, (_, i) => job({ outcome: i < 6 ? 'failed' : 'success' })) }),
  agent('busy', { activeJobs: 3 }),
  agent('suspended', { suspended: true }),
  agent('wrong-skill', { completedJobs: Array.from({ length: 8 }, () => job({ capability: 'translation' })) })
];

try {
  /* ---------- what proof means ---------- */
  const proven = proveSkill({ agent: agent('good'), capability: 'analysis', now: NOW });
  check('a real track record proves the skill', proven.proven === true);
  check('the sample size is reported', proven.sampleSize === MIN_PROVEN_JOBS + 1);
  check('the success rate is reported', proven.successRate === 1);
  check('too few jobs is not proof',
    proveSkill({ agent: agent('n', { completedJobs: [job()] }), capability: 'analysis', now: NOW }).reasons.includes('NOT_ENOUGH_PROVEN_JOBS'));
  check('unverified jobs are not evidence',
    proveSkill({ agent: AGENTS[2], capability: 'analysis', now: NOW }).proven === false);
  check('self-attested jobs are not evidence',
    proveSkill({ agent: AGENTS[3], capability: 'analysis', now: NOW }).proven === false);
  check('work from years ago is not current evidence',
    proveSkill({ agent: AGENTS[4], capability: 'analysis', now: NOW }).proven === false);
  check('a mostly-failing record is not proof',
    proveSkill({ agent: AGENTS[5], capability: 'analysis', now: NOW }).reasons.includes('SUCCESS_RATE_TOO_LOW'));
  check('experience in another skill does not transfer',
    proveSkill({ agent: AGENTS[8], capability: 'analysis', now: NOW }).proven === false);
  check('no agent means no proof', proveSkill({ capability: 'analysis', now: NOW }).proven === false);
  check('no capability means no proof', proveSkill({ agent: agent('good'), now: NOW }).proven === false);
  check('an unproven skill is a translatable notice', proveSkill({ agent: AGENTS[1], capability: 'analysis', now: NOW }).i18nKey === 'intentAI.market.unproven');

  /* ---------- supply is real ---------- */
  const supply = computeSupply({ agents: AGENTS, capability: 'analysis', now: NOW });
  check('supply counts only agents who can actually take work', supply.supply === 1);
  check('the available agent is the proven one', supply.available[0].id === 'good');
  check('everybody else is withheld with a reason', supply.withheld.length === AGENTS.length - 1);
  check('a busy agent is withheld for capacity', supply.withheld.find((w) => w.id === 'busy').reason === 'AT_CAPACITY');
  check('a suspended agent is withheld', supply.withheld.find((w) => w.id === 'suspended').reason === 'SUSPENDED');
  check('an unproven agent is withheld for lack of proof',
    supply.withheld.find((w) => w.id === 'novice').reason === 'NOT_ENOUGH_PROVEN_JOBS');
  check('free capacity is reported', supply.available[0].freeSlots === 3);
  check('an empty roster is empty supply', computeSupply({ agents: [], capability: 'analysis', now: NOW }).supply === 0);

  /* ---------- demand is real ---------- */
  const demand = computeDemand({
    requests: [
      { capability: 'analysis', state: 'open', expiresAt: NOW + 60_000 },
      { capability: 'analysis', state: 'open' },
      { capability: 'analysis', state: 'filled' },
      { capability: 'analysis', state: 'open', expiresAt: NOW - 1 },
      { capability: 'translation', state: 'open' }
    ],
    capability: 'analysis', now: NOW
  });
  check('demand counts only open requests', demand.demand === 2);
  check('a filled request is not demand', demand.requests.every((r) => r.state === 'open'));
  check('an expired request is not demand', demand.requests.every((r) => (r.expiresAt ?? Infinity) > NOW));
  check('another capability is not this demand', demand.requests.every((r) => r.capability === 'analysis'));

  /* ---------- conditions ---------- */
  const cond = marketConditions({ supply, demand, now: NOW });
  check('conditions are computed', cond.ok === true && cond.schema === MARKETPLACE_SCHEMA);
  check('one specialist against two requests is tight', cond.state === 'tight');
  check('the ratio is stated', cond.ratio === 0.5);
  check('no supply is its own state',
    marketConditions({ supply: { supply: 0 }, demand: { demand: 3 }, now: NOW }).state === 'no-supply');
  check('no demand is its own state',
    marketConditions({ supply: { supply: 3 }, demand: { demand: 0 }, now: NOW }).state === 'no-demand');
  check('plenty of supply is called ample',
    marketConditions({ supply: { supply: 10 }, demand: { demand: 2 }, now: NOW }).state === 'ample');
  check('a balanced market is called balanced',
    marketConditions({ supply: { supply: 3 }, demand: { demand: 3 }, now: NOW }).state === 'balanced');
  check('unknown conditions are not invented', marketConditions({ now: NOW }).state === 'unknown');

  /* ---------- suggestions ---------- */
  const suggested = suggestSpecialists({ agents: AGENTS, capability: 'analysis', requestSizeUsd: 100, now: NOW });
  check('a suggestion is made when someone qualifies', suggested.suggestions.length === 1);
  check('the suggestion carries its evidence',
    suggested.suggestions[0].provenJobs >= MIN_PROVEN_JOBS && suggested.suggestions[0].successRate >= 0.7);
  check('a suggestion authorizes nothing', suggested.suggestions[0].executionAuthorized === false);
  check('a suggestion still goes through the gate', suggested.suggestions[0].requiresConfirmationGate === true);
  check('an unproven agent is NEVER suggested', suggested.suggestions.every((s) => s.agentId !== 'novice'));
  check('a suspended agent is never suggested', suggested.suggestions.every((s) => s.agentId !== 'suspended'));
  check('an agent at capacity is never suggested', suggested.suggestions.every((s) => s.agentId !== 'busy'));
  const noneQualified = suggestSpecialists({ agents: AGENTS.filter((a) => a.id !== 'good'), capability: 'analysis', now: NOW });
  check('with nobody qualified the list is empty', noneQualified.suggestions.length === 0 && noneQualified.empty === true);
  check('the empty market is stated honestly, not padded', noneQualified.i18nKey === 'intentAI.market.noneQualified');
  check('the withheld agents are still explained', noneQualified.withheld.length > 0);
  check('a capability nobody has returns nothing',
    suggestSpecialists({ agents: AGENTS, capability: 'rocket-science', now: NOW }).suggestions.length === 0);
  check('no capability at all is refused', suggestSpecialists({ agents: AGENTS, now: NOW }).ok === false);
  const twoGood = suggestSpecialists({
    agents: [agent('a1', { completedJobs: Array.from({ length: 6 }, (_, i) => job({ outcome: i === 0 ? 'failed' : 'success' })) }), agent('a2')],
    capability: 'analysis', now: NOW
  });
  check('better proven records rank first', twoGood.suggestions[0].agentId === 'a2');

  /* ---------- the guard ---------- */
  check('the guard accepts honest suggestions', assertOnlyProvenSuggested(suggested, { agents: AGENTS, now: NOW }).ok === true);
  check('the guard catches a smuggled unproven agent',
    assertOnlyProvenSuggested({ ...suggested, suggestions: [{ agentId: 'novice', capability: 'analysis', provenJobs: 9, executionAuthorized: false }] }, { agents: AGENTS, now: NOW }).ok === false);
  check('the guard catches a suspended agent',
    assertOnlyProvenSuggested({ ...suggested, suggestions: [{ agentId: 'suspended', capability: 'analysis', provenJobs: 9 }] }, { agents: AGENTS, now: NOW }).ok === false);
  check('the guard catches an under-sampled claim',
    assertOnlyProvenSuggested({ ...suggested, suggestions: [{ agentId: 'good', capability: 'analysis', provenJobs: 1 }] }, { agents: AGENTS, now: NOW }).reasons.some((r) => r.startsWith('UNDER_SAMPLED')));
  check('the guard catches a suggestion claiming authority',
    assertOnlyProvenSuggested({ ...suggested, suggestions: [{ ...suggested.suggestions[0], executionAuthorized: true }] }, { agents: AGENTS, now: NOW }).ok === false);
  check('the guard rejects a non-market result', assertOnlyProvenSuggested({ suggestions: [] }).ok === false);
  check('an empty suggestion list trivially passes', assertOnlyProvenSuggested(noneQualified, { agents: AGENTS, now: NOW }).ok === true);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the marketplace copy is translated in en, fa and ar',
    locales.every((loc) => ['suggestions', 'noneQualified', 'unproven', 'unknown', 'noSupply', 'noDemand', 'tight', 'balanced', 'ample']
      .every((k) => typeof loc?.intentAI?.market?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase74-live-marketplace', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
