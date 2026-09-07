/*
 * GOAL-PIPELINE PROBE — does a Persian goal request actually reach the
 * compiler WITH live rates?
 *
 * This is the end-to-end seam the unit probes could not see. The compiler
 * refuses (`NO_LIVE_RATES`) rather than guess, which is correct behaviour —
 * but it means a wiring gap upstream shows up as "every goal card refuses".
 * Two real gaps were found and fixed here:
 *
 *   · `toolExecutor` did not run the opportunity scan for GOAL_PLAN, so
 *     `data.yieldOpportunities` never existed.
 *   · the chat carried `goalRequest` onto the message but not the tool
 *     payload, so `planFromIntent` always got `results: {}`.
 *
 * So this probe drives the real modules: understandIntent → executeIntentTools
 * → buildHumanResponse → planFromIntent, and asserts the plan is built from
 * rates rather than refused.
 */
import { understandIntent } from '../../src/lib/intent-ai/os/intentUnderstanding.js';
import { executeIntentTools } from '../../src/lib/intent-ai/os/toolExecutor.js';
import { buildHumanResponse } from '../../src/lib/intent-ai/os/humanResponse.js';
import { planFromIntent, goalSourcesFrom } from '../../src/lib/intent-ai/autonomy/goalSources.js';

const results = [];
const check = (name, ok, extra) => results.push({ name, ok: !!ok, extra });

// A services stub that only has to satisfy the scanner's reads. The scanner
// is exercised elsewhere; here it may legitimately come back empty, which is
// why the rate rows are injected through the same field the real one fills.
const services = {};

async function main() {
  /* ── 1. The Persian goal is recognised as GOAL_PLAN with its numbers ──── */
  const understood = understandIntent('سودم ۲ برابر شود در ۹۰ روز', { locale: 'fa' });
  const intent = understood?.intent || understood;
  check('understands the goal as GOAL_PLAN', intent?.type === 'GOAL_PLAN', intent?.type);
  check('reads a 2× target from Persian', Number(intent?.entities?.goalMultiple) === 2, intent?.entities?.goalMultiple);
  check('reads a 90-day horizon', Number(intent?.entities?.horizonDays) === 90, intent?.entities?.horizonDays);

  /* ── 2. The tool layer now scans for GOAL_PLAN ────────────────────────── */
  const tools = await executeIntentTools({
    intent,
    services,
    context: { portfolio: { totalValueUsd: 10000, holdings: [] }, locale: 'fa' },
    walletState: { connected: true }
  });
  const scanned = (tools?.toolsUsed || []).some((t) => t?.id === 'opportunity.scan');
  check('GOAL_PLAN triggers the opportunity scan', scanned, JSON.stringify((tools?.toolsUsed || []).map((t) => t?.id)));
  check('the scan result is exposed on data.yieldOpportunities', !!tools?.data?.yieldOpportunities);

  /* ── 3. The human layer asks for a card instead of inventing numbers ──── */
  const human = buildHumanResponse({
    intent,
    toolsResult: tools,
    context: { portfolio: { totalValueUsd: 10000, holdings: [] }, wallet: { connected: true } },
    locale: 'fa'
  });
  check('human layer returns GOAL_PLAN_CARD', human?.ui?.type === 'GOAL_PLAN_CARD', human?.ui?.type);
  check('it declares that execution is required', human?.requiresExecution === true, human?.requiresExecution);
  check('it carries the request forward', human?.goalRequest?.multiple === 2 && human?.goalRequest?.horizonDays === 90, JSON.stringify(human?.goalRequest));
  check('it does NOT fabricate a plan', !human?.goalPlan);

  /* ── 4. Feeding the SAME payload the chat now carries gives a real plan ─ */
  // The field the message carries (`osResult.data`) is exactly what the
  // compiler is handed, so use it verbatim rather than re-deriving it.
  const payload = tools?.data || {};
  const withRates = {
    ...payload,
    // Mirror the SCANNER's real vocabulary, not a plausible one: mapPool()
    // emits lowercase `lending` / `farm` / `lp` / `yield`, and a lending row
    // is built from `supplyApyPct` with `chainId` taken from the market's
    // `chain`. A probe that invents `kind: 'LEND'` exercises nothing.
    yieldOpportunities: {
      ok: true,
      opportunities: [
        { id: 'lending:aave-v3:USDC', kind: 'lending', protocol: 'aave-v3', symbol: 'USDC', chainId: 8453, apy: 4.62, risk: 'low', tvlUsd: null },
        { id: 'farm:jupiter:SOL-USDC', kind: 'farm', protocol: 'Jupiter', symbol: 'SOL-USDC', chainId: 501, apy: 18.4, risk: 'medium', tvlUsd: 12e6 },
        { id: 'lp:orca:BTC-USDC', kind: 'lp', protocol: 'Orca', symbol: 'BTC-USDC', chainId: 501, apy: 31.0, risk: 'high', tvlUsd: 4e6 }
      ]
    },
    // The scanner never emits `perp` rows, so perp funding arrives as its own
    // source — which is exactly how the compiler is meant to read it.
    perpFunding: [
      { id: 'perp:velocity:BTC-PERP', kind: 'perp', protocol: 'Velocity', symbol: 'BTC-PERP', chainId: 501, apy: 41.5, risk: 'high' }
    ]
  };

  const sources = goalSourcesFrom({ opportunities: withRates.yieldOpportunities.opportunities });
  const readRows = [];
  for (const key of Object.keys(sources)) {
    const out = await sources[key]();
    if (out?.ok && Array.isArray(out.rows)) readRows.push({ key, n: out.rows.length });
  }
  check('rate rows are readable from the payload', readRows.some((r) => r.n > 0), JSON.stringify(readRows));

  const { plan } = await planFromIntent({
    intent,
    context: { portfolio: { totalValueUsd: 10000, holdings: [] } },
    results: withRates,
    locale: 'fa'
  });

  check('a plan is built', !!plan, JSON.stringify(plan?.code));
  check('it is NOT refused for missing rates', plan?.code !== 'NO_LIVE_RATES', plan?.code);
  check('it is NOT refused for missing capital', plan?.code !== 'CAPITAL_REQUIRED', plan?.code);
  check('it read the capital', Number(plan?.capitalUsd) === 10000, plan?.capitalUsd);
  check('it states the required APY for 2× in 90 days', Math.abs(Number(plan?.requiredApyPct) - 1562.81) < 1, plan?.requiredApyPct);

  check('it reports the best live rate', Number(plan?.bestAvailableApyPct) > 0, plan?.bestAvailableApyPct);
  check('a verdict is computed', plan?.verdict && typeof plan.verdict === 'object', JSON.stringify(plan?.verdict)?.slice(0, 80));
  check('2× in 90 days at 4.62% is honestly called unreachable', plan?.verdict?.reachable === false, plan?.verdict?.reachable);
  check('it names what the best rate DOES give instead', Number(plan?.verdict?.multipleAtHorizon) > 1 && Number(plan?.verdict?.multipleAtHorizon) < 1.5, plan?.verdict?.multipleAtHorizon);
  check('honesty text travels with it', typeof plan?.honesty === 'string' && plan.honesty.length > 10, plan?.honesty?.slice(0, 60));
  check('options are offered', Array.isArray(plan?.options) && plan.options.length > 0, plan?.options?.length);
  check('every option carries executable actions', (plan?.options || []).every((o) => Array.isArray(o.actions) && o.actions.length > 0));

  /* ── 5. The seam the bug lived in: empty results still refuse honestly ── */
  const empty = await planFromIntent({ intent, context: { portfolio: { totalValueUsd: 10000 } }, results: {}, locale: 'fa' });
  check('with no rates it refuses rather than guesses', empty?.plan?.code === 'NO_LIVE_RATES', empty?.plan?.code);
}

main().then(() => {
  const passed = results.filter((r) => r.ok).length;
  console.log(`probe: ${passed}/${results.length} passed`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    for (const f of failed) console.log(`✗ ${f.name}${f.extra ? ` — ${f.extra}` : ''}`);
    process.exit(1);
  }
  console.log('OK: intent-ai/goal-pipeline-probe');
}).catch((err) => {
  console.error('probe crashed:', err);
  process.exit(1);
});
