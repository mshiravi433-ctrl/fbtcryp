/**
 * FBT CENTRAL INTELLIGENCE OS — Policy Engine (spec §18, §23, §33).
 * ---------------------------------------------------------------------------
 * Three permission tiers, evaluated against the plan and the FRESH state, never
 * against a model's summary of it. Every verdict carries the checks that
 * produced it, because "blocked" with no reason is indistinguishable from a bug
 * and users (correctly) stop trusting it.
 *
 * WHY THIS IS A GATE AND NOT A GUIDELINE
 * `brain.js` is written so that EXECUTE can only be reached through
 * `verdict.allowExecute === true` — one field, produced here, from
 * confirmation + capability + freshness + risk + security signals together.
 * A future feature that wants to skip a check must edit this file, which is
 * reviewable; a prompt cannot reach it.
 *
 * FAIL-CLOSED BY CONSTRUCTION
 * Missing data is not permission. No balance → cannot execute. No risk verdict
 * → cannot execute. Unverifiable quote → cannot execute. The only generous path
 * in here is READ, where stale data is allowed if it is *labelled* stale.
 */
import {
  CAPABILITY, CI_SCHEMA, DATA_SOURCES, hashString, PERMISSION, SAFE_STOP_CODES,
  SIGNATURE_REQUIRED_ACTIONS, usableNumber
} from './schema.js';
import { freshness, getSection } from './state.js';

export const POLICY_SCHEMA = 'fbt.central-policy.v1';

/** Quote/price validity windows: an expired quote is refused, not silently re-used. */
export const QUOTE_MAX_AGE_MS = 90_000;
export const MAX_SLIPPAGE_PCT = 5;
export const MAX_PRICE_IMPACT_PCT = 3;
/** Health factor below which adding borrowable risk is refused outright. */
export const MIN_HEALTH_FACTOR_FOR_BORROW = 1.35;
export const LIQUIDATION_WARNING_DISTANCE = 0.15;

const securitySignalCodes = (signals = []) => signals.map((s) => String(s?.code || s || '')).filter(Boolean);

/**
 * §18 as an ordered list of gates. Order matters: a security signal must be
 * able to stop the pipeline before any cost-of-quoting work happens, and a
 * capability check must precede a freshness check so that "the source is down"
 * is not reported as "your data is old".
 */
export function evaluatePolicy({
  intent, plan, capabilities = {}, state = null, risk = null, quote = null, confirmation = null,
  securitySignals = [], wallet = null, now = Date.now(), page = null, actionType = null
} = {}) {
  const checks = [];
  const reasons = [];
  const gates = {};
  let verdict = 'ALLOW';
  const decide = (v, priority = 0) => {
    const rank = { ALLOW: 0, REQUIRE_CONFIRMATION: 1, BLOCK: 2, SAFE_STOP: 3 };
    if (rank[v] > rank[verdict]) verdict = v;
    if (priority) reasons.push(v);
  };

  /* 1 — security, before anything else (§23). */
  const codes = securitySignalCodes(securitySignals);
  const stoppers = codes.filter((c) => SAFE_STOP_CODES.includes(c));
  checks.push({ id: 'security', ok: stoppers.length === 0, detail: stoppers.length ? stoppers.join(',') : 'no security signals' });
  if (stoppers.length) {
    return finalize({
      verdict: 'SAFE_STOP', reasons: [`${stoppers[0]} — this operation was stopped by a security check and cannot be retried, rerouted or overridden`],
      checks, gates: { security: false }, safeStopCodes: stoppers, intent, blockExecute: true
    });
  }

  /* 2 — bypass detection: an attempt to skip a gate is itself a stop condition. */
  const bypassAttempt = confirmation?.bypassRequested === true || codes.includes('POLICY_BYPAGE_ATTEMPT');
  checks.push({ id: 'bypass-attempt', ok: !bypassAttempt, detail: bypassAttempt ? 'an override was requested' : 'none' });
  if (bypassAttempt) {
    return finalize({ verdict: 'SAFE_STOP', reasons: ['security policy cannot be bypassed, even on request'], checks, gates: { bypass: false }, safeStopCodes: ['POLICY_BYPAGE_ATTEMPT'], intent, blockExecute: true });
  }

  /* 3 — capability (§8). */
  const required = (plan?.steps || []).map((s) => s.module).filter((m) => m && m !== 'session' && m !== 'registry' && m !== 'policy');
  const capFailures = [];
  for (const module of new Set(required)) {
    const cap = capabilities[module];
    if (!cap) capFailures.push({ module, reason: 'NOT_REGISTERED' });
    else if (cap === CAPABILITY.UNAVAILABLE || cap === CAPABILITY.INCOMPLETE) capFailures.push({ module, reason: cap });
  }
  gates.capability = capFailures.length === 0;
  checks.push({ id: 'capability', ok: gates.capability, detail: capFailures.length ? capFailures.map((f) => `${f.module}:${f.reason}`).join(' ') : 'all required modules available' });
  if (!gates.capability) {
    const executeNeeded = (plan?.steps || []).some((s) => s.permission === PERMISSION.EXECUTE);
    if (executeNeeded) decide('BLOCK');
    reasons.push(`some required modules are unavailable (${capFailures.map((f) => `${f.module}=${f.reason}`).join(', ')}); only the parts that can be answered will be answered`);
  }

  /* 4 — plan integrity (a hand-edited or model-authored plan is validated too). */
  const planProblems = (plan?.problems || []);
  gates.plan = planProblems.length === 0;
  checks.push({ id: 'plan-integrity', ok: gates.plan, detail: gates.plan ? 'plan validated' : planProblems.map((p) => p.code).join(',') });
  if (!gates.plan) {
    decide('BLOCK');
    reasons.push('the generated plan is structurally invalid and was not executed');
  }

  /* 5 — data freshness for every section the plan depends on (§18 "is the data fresh?"). */
  const staleSections = [];
  const missingSections = [];
  const unreadOptionalSections = [];
  if (state) {
    /* Two different things must not share one gate. `plan.requiredSections` are the
       inputs THIS action is decided on: if one of them was never read, executing on
       a guess is exactly what §33 forbids. `intent.requiredModules` is a wider set
       — the modules an intent may touch at all, including the ones that only become
       relevant AFTER the action (a swap's own `transactions` row, `notifications`).
       Blocking a swap because its receipt does not exist yet is the kind of policy
       that trains users to work around the policy. */
    const planNeeds = new Set(plan?.requiredSections || []);
    const intentNeeds = new Set((intent?.requiredModules || []).map(moduleToSection).filter(Boolean));
    for (const key of new Set([...planNeeds, ...intentNeeds])) {
      const f = freshness(state, key, now);
      if (f.status === 'MISSING') {
        if (planNeeds.has(key)) missingSections.push({ key, reason: f.reason });
        else unreadOptionalSections.push(key);
      } else if (f.status === 'STALE' || f.status === 'PARTIAL' || f.status === 'UNAVAILABLE') {
        staleSections.push({ key, ageMs: f.ageMs, status: f.status, reason: f.reason });
      }
    }
  }
  gates.freshness = staleSections.length === 0 && missingSections.length === 0;
  checks.push({ id: 'data-freshness', ok: gates.freshness, detail: gates.freshness ? 'all inputs live' : `stale:${staleSections.map((s) => s.key).join(',') || '-'} missing:${missingSections.map((s) => s.key).join(',') || '-'}` });

  /* 6 — quote validity (an expired quote is the classic "executed at yesterday's
     price" failure, so it is checked even though it is a data problem). */
  const quoteAge = quote?.at ? now - Number(quote.at) : null;
  const quoteExpired = quoteAge !== null && quoteAge > QUOTE_MAX_AGE_MS;
  const quoteDrift = usableNumber(quote?.priceDriftPct);
  gates.quote = Boolean(quote) ? !quoteExpired && !(quoteDrift !== null && Math.abs(quoteDrift) > 0.5) : true;
  checks.push({ id: 'quote-validity', ok: gates.quote, detail: !quote ? 'no quote required' : quoteExpired ? `quote is ${Math.round(quoteAge / 1000)}s old (max ${QUOTE_MAX_AGE_MS / 1000}s)` : `age ${Math.round((quoteAge || 0) / 1000)}s` });

  /* 7 — slippage and impact limits (§24, on real numbers only). */
  const slippage = usableNumber(quote?.slippagePct ?? risk?.inputs?.slippagePct);
  const impact = usableNumber(quote?.priceImpactPct ?? risk?.inputs?.priceImpactPct);
  const limits = [];
  if (slippage !== null && slippage > MAX_SLIPPAGE_PCT) limits.push({ code: 'SLIPPAGE_TOO_HIGH', value: slippage, limit: MAX_SLIPPAGE_PCT });
  if (impact !== null && impact > MAX_PRICE_IMPACT_PCT) limits.push({ code: 'PRICE_IMPACT_TOO_HIGH', value: impact, limit: MAX_PRICE_IMPACT_PCT });
  gates.limits = limits.length === 0;
  checks.push({ id: 'limits', ok: gates.limits, detail: gates.limits ? 'within limits' : limits.map((l) => `${l.code}=${l.value}`).join(' ') });
  if (!gates.limits) { decide('BLOCK'); reasons.push('slippage or price impact is above the safety limit; the operation was not run'); }

  /* 8 — balance sufficiency: only when the balance is actually known. */
  const insufficient = [];
  const knownBalance = usableNumber(wallet?.availableUsd ?? getSection(state || {}, 'wallet').data?.totalValueUsd);
  const need = usableNumber(quote?.amountUsd ?? intent?.entities?.amountUsd);
  if (need !== null && knownBalance !== null && knownBalance + 1e-9 < need) insufficient.push({ asset: quote?.fromAsset || 'USD', need, have: knownBalance });
  gates.balance = insufficient.length === 0;
  checks.push({ id: 'balance', ok: gates.balance && knownBalance !== null, detail: knownBalance === null ? 'balance unknown — execution refused' : gates.balance ? 'sufficient' : insufficient.map((i) => `needs ${i.need}, has ${i.have}`).join(' ') });
  if (!gates.balance) { decide('BLOCK'); reasons.push('the wallet does not hold enough of the source asset for this amount'); }
  else if (knownBalance === null) {
    const wantsExecute = (plan?.steps || []).some((s) => s.permission === PERMISSION.EXECUTE);
    if (wantsExecute) {
      decide('BLOCK');
      reasons.push('your wallet balance could not be read, so the operation cannot be attempted (§3: the model may not stand in for the wallet service)');
    }
  }

  /* 9 — risk (§24): a plan step carrying a riskContext MUST have a risk verdict. */
  const needsRisk = (plan?.steps || []).some((s) => s.riskContext);
  const riskMissing = needsRisk && (!risk || !risk.level);
  const riskBlocked = risk?.decision === 'block' || risk?.level === 'critical';
  gates.risk = !riskMissing && !riskBlocked;
  checks.push({ id: 'risk', ok: gates.risk, detail: riskMissing ? 'risk verdict missing for a gated module' : riskBlocked ? `risk engine blocked: ${(risk.reasons || [])[0] || 'critical'}` : `risk=${risk?.level || 'low'}` });
  if (riskMissing || riskBlocked) {
    decide((plan?.steps || []).some((s) => s.permission === PERMISSION.EXECUTE) ? 'BLOCK' : 'ALLOW');
    if (riskMissing) reasons.push('the central risk engine could not produce a verdict from live data');
    else reasons.push(`risk engine blocked this action: ${(risk.reasons || []).slice(0, 2).join('; ')}`);
  }

  /* 10 — lending health factor floor (a real numeric floor, not a mood). */
  const hf = usableNumber(risk?.inputs?.healthFactor ?? getSection(state || {}, 'lending').data?.healthFactor);
  const isBorrow = actionType === 'BORROW' || intent?.intentType === 'EXECUTE_BORROW';
  const healthOk = !isBorrow || (hf !== null && hf >= MIN_HEALTH_FACTOR_FOR_BORROW);
  gates.lending = healthOk;
  checks.push({ id: 'lending-health', ok: healthOk, detail: !isBorrow ? 'not a borrow' : hf === null ? 'health factor unreadable' : `healthFactor ${hf} vs floor ${MIN_HEALTH_FACTOR_FOR_BORROW}` });
  if (isBorrow && !healthOk) {
    decide('BLOCK');
    reasons.push(hf === null
      ? 'the position health factor could not be read from the protocol, so no new debt was proposed'
      : `health factor ${hf} is at or below the ${MIN_HEALTH_FACTOR_FOR_BORROW} floor for taking on more debt`);
  }

  /* 11 — explicit confirmation (§33). Absent, silent, or stale → no execution. */
  const executeIntended = (plan?.steps || []).some((s) => s.permission === PERMISSION.EXECUTE && s.operation === 'execute');
  const signatureRequired = executeIntended && (actionType ? SIGNATURE_REQUIRED_ACTIONS.includes(actionType) : true);
  const confirmed = confirmation?.confirmed === true
    && confirmation?.intentId === intent?.intentId
    && confirmation?.planDigest === plan?.digest;
  gates.confirmation = !executeIntended || confirmed;
  checks.push({ id: 'confirmation', ok: gates.confirmation, detail: !executeIntended ? 'no execution in this plan' : confirmed ? 'explicit confirmation for THIS plan' : 'no confirmation bound to this exact plan' });
  if (executeIntended && !confirmed) decide('REQUIRE_CONFIRMATION');
  if (confirmation?.confirmed === true && !confirmed) {
    decide('BLOCK');
    reasons.push('the confirmation does not match this plan (the quote, amounts or routes changed after you were asked) — nothing was executed');
  }

  /* 12 — read-only surfaces may not execute even if a user says so. */
  const pageReadOnly = page?.module && capabilities[page.module] === CAPABILITY.READ_ONLY;
  if (executeIntended && pageReadOnly) {
    decide('BLOCK');
    reasons.push(`the ${page.module} surface is read-only right now`);
  }

  if (staleSections.length && executeIntended) {
    decide('BLOCK');
    reasons.push(`state for ${staleSections.map((s) => s.key).join(', ')} is not fresh; the numbers this action would be judged on are superseded`);
  }
  if (missingSections.length && executeIntended) {
    decide('BLOCK');
    reasons.push(`required state was never read: ${missingSections.map((s) => s.key).join(', ')}`);
  }

  const allowExecute = verdict === 'ALLOW' && executeIntended && gates.confirmation && gates.capability && gates.freshness && gates.risk && gates.balance && gates.quote && gates.limits;
  return finalize({
    verdict,
    reasons,
    checks,
    gates,
    intent,
    allowExecute,
    requiresConfirmation: verdict === 'REQUIRE_CONFIRMATION',
    signatureRequired,
    staleSections,
    missingSections,
    unreadOptionalSections,
    /** What the reply is allowed to state as fact. */
    mayQuoteNumbers: state ? !staleSections.some((s) => ['wallet', 'portfolio'].includes(s.key)) : false,
    provenance: { policy: POLICY_SCHEMA, evaluatedAt: now, source: DATA_SOURCES.RISK_ENGINE }
  });
}

function finalize(input) {
  const { verdict, reasons = [], checks = [], gates = {}, intent = null, blockExecute = false, safeStopCodes = [], ...rest } = input;
  return {
    schema: POLICY_SCHEMA,
    brain: CI_SCHEMA,
    intentId: intent?.intentId || null,
    verdict,
    allowed: verdict === 'ALLOW',
    allowExecute: rest.allowExecute === true && !blockExecute,
    blocked: verdict === 'BLOCK' || verdict === 'SAFE_STOP',
    safeStop: verdict === 'SAFE_STOP',
    safeStopCodes,
    requiresConfirmation: rest.requiresConfirmation === true || verdict === 'REQUIRE_CONFIRMATION',
    reasons: Array.from(new Set(reasons.filter(Boolean))),
    checks,
    gates,
    ...rest
  };
}

const MODULE_SECTION = Object.freeze({
  wallet: 'wallet', portfolio: 'portfolio', crypto: 'markets', swap: 'markets',
  bridge: 'wallet', lending: 'lending', borrowing: 'borrowing', farming: 'farming',
  liquidity: 'liquidity', staking: 'farming', futures: 'futures', dydx: 'dydx',
  signals: 'signals', news: 'news', goals: 'goals', 'profit-plan': 'profitPlan',
  alerts: 'alerts', transactions: 'transactions', risk: 'risk'
});
export function moduleToSection(module) {
  return MODULE_SECTION[module] || null;
}

/**
 * A confirmation is only valid if it is bound to the exact plan it was asked for.
 * Otherwise a "yes" to a 500 USD swap authorises a 5000 USD one — the classic
 * stale-approval bug. `digest` covers amounts, routes, slippage and network.
 */
export function planDigest(plan = {}) {
  const parts = (plan.steps || []).filter((s) => s.permission !== PERMISSION.READ).map((s) => {
    const i = s.input || {};
    return `${s.id}|${s.module}|${s.operation}|${i.from ?? ''}>${i.to ?? ''}|${i.amountUsd ?? i.asset ?? ''}|${i.network ?? i.toNetwork ?? ''}|${i.slippagePct ?? ''}`;
  });
  return hashString(parts.join('#'));
}

/** Convenience for the READ tier: analysis is allowed on stale data, labelled. */
export function readOnlyVerdict({ stale = [], missing = [] } = {}) {
  return finalize({
    verdict: 'ALLOW',
    reasons: [...(stale.length ? [`some inputs are stale: ${stale.join(', ')}`] : []), ...(missing.length ? [`not available: ${missing.join(', ')}`] : [])],
    checks: [{ id: 'permission', ok: true, detail: 'READ tier — no execution attempted' }],
    gates: { capability: true, freshness: stale.length === 0 && missing.length === 0, confirmation: true, risk: true, balance: true, quote: true, limits: true, plan: true, security: true },
    allowExecute: false,
    mayQuoteNumbers: stale.length === 0 && missing.length === 0
  });
}
