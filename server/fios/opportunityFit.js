/**
 * FBT FINANCIAL INTELLIGENCE OS — Opportunity Fit (Phase 212, upgrade 16).
 * ---------------------------------------------------------------------------
 * An opportunity scanner says «این فرصت 18% APY دارد». A financial agent says
 * «برای شما مناسب نیست، چون با هدف ۴ ماهه و سقف افت سرمایه ۱۰٪ شما تناسب
 * ندارد». This module is the difference: every opportunity the OS sees is
 * scored THROUGH the owner's profile before it is ever shown:
 *
 *   opportunity → profit → probability → risk → liquidity → fees →
 *   slippage → capital requirement → time horizon → user goal →
 *   portfolio impact → decision (FITTED / NOT_FITTED / CONDITIONAL)
 *
 * Every dimension is computed from the opportunity's OWN numbers and the
 * owner's real profile; the verdict always names the dimension that decided
 * it, so «نه» همیشه دلیل دارد.
 */

import { requireFlag } from './flags.js';
import { requiredAnnualizedPct } from './goalReasoning.js';

export const OPPORTUNITY_FIT_SCHEMA = 'fbt.fi.opportunity-fit.v1';

export const FIT_VERDICTS = Object.freeze(['FITTED', 'CONDITIONAL', 'NOT_FITTED']);

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d = 2) => (num(v) === null ? null : Number(Number(v).toFixed(d)));

/** Net-yield arithmetic: the APY the poster advertises minus what it costs. */
export function netApyPct(opportunity = {}) {
  const apy = num(opportunity.apyPct ?? opportunity.yieldPct ?? opportunity.expectedReturnPct);
  if (apy === null) return null;
  const fees = num(opportunity.feePct) ?? 0;
  const il = num(opportunity.impermanentLossPct) ?? 0;
  return round(apy - fees - il, 2);
}

/**
 * Score ONE opportunity against the owner's profile + portfolio + goal.
 * Pure — the router/engine supplies the reads.
 *
 * @param {object} opportunity  { id?, kind, apyPct?, asset?, chain?, riskPct?,
 *                               liquidity?, feeUsd?, slippagePct?, capitalRequiredUsd?,
 *                               horizonMonths?, probabilityPct?, protocol? }
 * @param {object} profile      personalProfile.buildPersonalProfile() output
 * @param {object} [financial]  canonical financial state
 * @param {object} [goal]       { targetUsd, months, maxDrawdownPct }
 */
export function scoreOpportunityFit(opportunity = {}, profile = null, { financial = null, goal = null } = {}) {
  if (!profile) return { ok: false, code: 'NO_PROFILE', detail: 'fit needs the owner profile — build it first' };
  const dims = [];
  const add = (dimension, ok, value, detail, weight = 1) => dims.push({ dimension, ok, value, detail, weight });

  /* profit — net of fees and IL, never the poster number */
  const netApy = netApyPct(opportunity);
  add('profit', netApy !== null && netApy > 0, netApy, netApy === null ? 'no readable yield on this opportunity' : `net ${netApy}% after fees/IL (advertised ${num(opportunity.apyPct ?? opportunity.yieldPct) ?? 'n/a'}%)`, 1.2);

  /* probability — the protocol's own evidence */
  const probabilityPct = num(opportunity.probabilityPct);
  add('probability', probabilityPct === null || probabilityPct >= 50, probabilityPct, probabilityPct === null ? 'no probability estimate supplied — treated as unknown, not high' : `${probabilityPct}% modelled`, 0.8);

  /* risk — against the user's band */
  const riskPct = num(opportunity.riskPct ?? opportunity.potentialLossPct);
  const bandMap = { CONSERVATIVE: 20, MODERATE: 45, GROWTH: 70, AGGRESSIVE: 90 };
  const band = bandMap[String(profile.riskTolerance || '').toUpperCase()] ?? null;
  add('risk', riskPct === null ? null : band === null || riskPct <= band + 10, riskPct, riskPct === null ? 'risk not modelled' : `risk ${riskPct}% vs ${profile.riskTolerance || 'unknown'} band`, 1.5);

  /* liquidity — against the user's requirement */
  const liquidity = String(opportunity.liquidity || '').toUpperCase();
  const needHigh = profile.liquidityRequirement === 'high';
  const locked = /LOCKED|SLOW|EPOCH|VESTING/.test(liquidity) || opportunity.locked === true;
  add('liquidity', needHigh ? !locked : true, liquidity || null, needHigh ? (locked ? 'the user needs high liquidity and this locks capital' : 'liquidity adequate for a high-liquidity user') : 'no hard liquidity constraint', 1.1);

  /* fees + slippage — the cost of getting in and out */
  const feeUsd = num(opportunity.feeUsd) ?? 0;
  const slip = num(opportunity.slippagePct) ?? 0;
  const entryCostUsd = round(feeUsd + slip * (num(opportunity.capitalRequiredUsd) ?? 0) / 100, 2);
  add('costs', entryCostUsd !== null && (num(opportunity.capitalRequiredUsd) === null || entryCostUsd <= 0.05 * num(opportunity.capitalRequiredUsd)), entryCostUsd, `entry cost ${entryCostUsd} USD (fees ${feeUsd} + slippage ${slip}%)`, 1.0);

  /* capital — does the user actually have it */
  const capitalRequired = num(opportunity.capitalRequiredUsd);
  const available = num(financial?.computed?.availableCapitalUsd);
  add('capital', capitalRequired === null || available === null ? null : available >= capitalRequired, capitalRequired, capitalRequired === null ? 'no capital requirement stated' : available === null ? 'available capital unreadable' : `needs ${capitalRequired} USD, ${available} USD available`, 1.4);

  /* time horizon — the goal's clock */
  const horizon = num(opportunity.horizonMonths);
  const userHorizon = profile.horizonMonths ?? num(goal?.months);
  add('horizon', horizon === null || userHorizon === null ? null : horizon <= userHorizon, horizon, horizon === null ? 'no horizon stated' : userHorizon === null ? 'user horizon unknown' : `opportunity needs ${horizon}mo, user has ${userHorizon}mo`, 1.2);

  /* user goal — is this vehicle even pointed at the target? The honest
     comparison: the goal's REQUIRED annualized return vs what this
     opportunity actually nets. */
  if (goal?.targetUsd != null && netApy !== null) {
    const netWorth = num(financial?.computed?.netWorthUsd);
    const startUsd = num(goal.startUsd) ?? netWorth;
    const monthsAvailable = userHorizon ?? num(goal.months) ?? 12;
    const targetReturnPct = startUsd && startUsd > 0 ? round(((num(goal.targetUsd) - startUsd) / startUsd) * 100, 2) : null;
    const required = requiredAnnualizedPct({ targetReturnPct, horizonMonths: monthsAvailable });
    if (required !== null) {
      const ok = netApy >= required * 0.5; /* a single position carrying half
         the goal's required pace is a contribution; the whole plan is judged
         by the goal-scenarios engine, not by one opportunity */
      add('goal-fit', ok, required, `the goal needs ≈${required}% annualized over ${monthsAvailable}mo; this opportunity nets ${netApy}% — ${ok ? 'a real contribution to the target' : 'not pointed at this target'}`, 1.3);
    }
  }

  /* portfolio impact — concentration */
  const asset = String(opportunity.asset || '').toUpperCase();
  const existingExposure = num(financial?.computed?.assetExposureUsd?.[asset]);
  const netWorth = num(financial?.computed?.netWorthUsd);
  if (existingExposure !== null && netWorth && capitalRequired !== null) {
    const sharePct = round(((existingExposure + capitalRequired) / netWorth) * 100, 2);
    add('portfolio-impact', sharePct <= 40, sharePct, `${asset} would be ${sharePct}% of net worth after this position`, 1.1);
  }

  /* excluded assets — an explicit user veto */
  if (asset && Array.isArray(profile.excludedAssets) && profile.excludedAssets.includes(asset)) {
    add('excluded-asset', false, asset, `${asset} is on the user's exclusion list`, 3.0);
  }

  const hard = dims.filter((d) => d.ok === false);
  const unknown = dims.filter((d) => d.ok === null);
  const known = dims.filter((d) => d.ok !== null);
  const weightedScore = known.length
    ? known.reduce((a, d) => a + (d.ok === true ? d.weight : 0), 0) / known.reduce((a, d) => a + d.weight, 0)
    : 0;
  const verdict = hard.length ? 'NOT_FITTED' : unknown.length && unknown.length >= 3 ? 'CONDITIONAL' : weightedScore >= 0.7 ? 'FITTED' : weightedScore >= 0.5 ? 'CONDITIONAL' : 'NOT_FITTED';

  return {
    ok: true,
    schema: OPPORTUNITY_FIT_SCHEMA,
    opportunityId: opportunity.id || null,
    kind: opportunity.kind || null,
    asset: asset || null,
    chain: opportunity.chain || null,
    verdict,
    score: round(weightedScore * 100, 1),
    dimensions: dims,
    decidedBy: hard.length ? hard.map((d) => d.dimension) : (verdict === 'FITTED' ? ['weighted-score'] : ['insufficient-evidence']),
    reason: verdict === 'NOT_FITTED'
      ? `برای شما مناسب نیست: ${hard.map((d) => d.detail).join('؛ ')}`
      : verdict === 'CONDITIONAL'
        ? `قابل قبول با شرط: ${unknown.length} dimension(s) خوانده نشد (${unknown.map((d) => d.dimension).join(', ')}) — قبل از ورود باید خوانده شوند`
        : `برای شما مناسب است: ${known.filter((d) => d.ok === true).length} از ${known.length} معیار با پروفایل شما سازگار است`,
    estimate: true,
    note: 'fit is computed from the opportunity numbers and the real profile; the verdict always names its deciding dimension'
  };
}

/** The engine wrapper: score + persist + batch. */
export function createOpportunityFitEngine({ collections = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  async function score(owner, { opportunity = null, profile = null, financial = null, goal = null, correlationId = null } = {}) {
    const gate = requireFlag('OPPORTUNITY_FIT_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    const row = scoreOpportunityFit(opportunity, profile, { financial, goal });
    if (!row.ok) return row;
    row.at = now();
    row.owner = owner;
    if (collections) {
      try {
        await collections.put('opportunity_fits', owner, { ...row, id: row.opportunityId || `fit_${row.at}` }, { idKey: 'id' });
      } catch (err) {
        log(`opportunity-fit:persist-failed:${String(err?.message || err).slice(0, 80)}`);
      }
    }
    if (observability) observability.emit({ type: 'opportunity-fit.scored', owner, correlationId, payload: { verdict: row.verdict, score: row.score } });
    return { ok: true, fit: row };
  }

  /** Rank a scanned list by fit — the scanner becomes a decision engine. */
  async function rankFor(owner, { opportunities = [], profile = null, financial = null, goal = null, limit = 10 } = {}) {
    const gate = requireFlag('OPPORTUNITY_FIT_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag, ranked: [] };
    const rows = [];
    for (const opportunity of (Array.isArray(opportunities) ? opportunities : []).slice(0, 50)) {
      const fit = scoreOpportunityFit(opportunity, profile, { financial, goal });
      if (fit.ok) rows.push(fit);
    }
    rows.sort((a, b) => (a.verdict === b.verdict ? b.score - a.score : (FIT_VERDICTS.indexOf(a.verdict) - FIT_VERDICTS.indexOf(b.verdict))));
    return { ok: true, ranked: rows.slice(0, Math.max(1, limit)), count: rows.length };
  }

  return { schema: OPPORTUNITY_FIT_SCHEMA, score, rankFor, scoreOpportunityFit, VERDICTS: FIT_VERDICTS };
}
