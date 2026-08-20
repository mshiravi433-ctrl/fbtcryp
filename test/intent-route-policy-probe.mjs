/**
 * DETERMINISTIC ROUTE SCORING PROBE
 * ---------------------------------------------------------------------------
 * The scoring rule decides where the user's money goes, so it is tested for
 * the properties that make it defensible rather than for a single "best" pick:
 *
 *   · net-USD ranking is used ONLY when gas and valuation are truly comparable
 *   · incomplete gas/valuation data falls back to the honest same-assumptions
 *     policy, with the claim string to match
 *   · a different fee, slippage, chain or pair is REJECTED, never compared
 *   · an expired or non-executable quote can never win
 *   · a critical/integrity failure removes a route instead of docking points
 *   · the result is identical for any input order
 *   · every rejection carries a reason code
 */

export default async function run() {
  const rows = [];
  const t = (name, ok) => rows.push([name, Boolean(ok)]);

  const rp = await import('../src/lib/intentRoutePolicy.js');
  const now = 1_780_000_000_000;

  const base = {
    chainId: 42161,
    fromSymbol: 'USDC',
    toSymbol: 'ETH',
    feeBps: 70,
    slippagePct: 0.5,
    observedAt: now - 1000,
    priceSource: 'kyberswap-usd',
    executable: true
  };

  t('both policies are named exactly as specified',
    rp.ROUTE_POLICIES.NET_USD === 'MAX_NET_OUTPUT_USD_AFTER_COMPARABLE_GAS_V1'
    && rp.ROUTE_POLICIES.SAME_ASSUMPTIONS === 'MAX_OUTPUT_WITHIN_SAME_ASSUMPTIONS_V2');

  /* ----------------------- 1. comparable gas → policy 1 -------------------- */
  const comparable = [
    { ...base, solver: 'kyberswap', amountOutWei: '1000', amountOutUsd: 100, gasUsd: 2, hops: 2, latencyMs: 300 },
    { ...base, solver: 'openocean', amountOutWei: '1010', amountOutUsd: 101, gasUsd: 6, hops: 3, latencyMs: 400 }
  ];
  const netUsd = rp.scoreRoutes(comparable, { now });
  t('fully comparable data selects the net-USD policy', netUsd.policy === rp.ROUTE_POLICIES.NET_USD);
  t('net output beats raw output when gas is comparable', netUsd.selected.solver === 'kyberswap');
  t('the net output is computed as amountOutUsd - gasUsd', netUsd.selected.netOutputUsd === 98);
  t('the claim names the quote round, not the world',
    netUsd.claim === rp.ROUTE_POLICY_CLAIMS[rp.ROUTE_POLICIES.NET_USD]);
  t('nothing is missing when everything is comparable', netUsd.missingFields.length === 0);

  /* --------------------- 2. incomplete gas → policy 2 ---------------------- */
  const missingGas = [
    { ...base, solver: 'kyberswap', amountOutWei: '1000', amountOutUsd: 100, gasUsd: 2 },
    { ...base, solver: 'openocean', amountOutWei: '1010', amountOutUsd: 101, gasUsd: null }
  ];
  const fallback = rp.scoreRoutes(missingGas, { now });
  t('incomplete gas data falls back to the same-assumptions policy',
    fallback.policy === rp.ROUTE_POLICIES.SAME_ASSUMPTIONS);
  t('the fallback claim is exactly the specified sentence',
    fallback.claim === 'best executable output among comparable responses observed in this quote round');
  t('the fallback ranks on raw output', fallback.selected.solver === 'openocean');
  t('the missing field is named', fallback.missingFields.some((f) => f.includes('gasUsd')));

  const mixedPriceSource = rp.scoreRoutes([
    { ...base, solver: 'a', amountOutWei: '1000', amountOutUsd: 100, gasUsd: 1, priceSource: 'x' },
    { ...base, solver: 'b', amountOutWei: '1001', amountOutUsd: 101, gasUsd: 1, priceSource: 'y' }
  ], { now });
  t('two different price sources are not comparable',
    mixedPriceSource.policy === rp.ROUTE_POLICIES.SAME_ASSUMPTIONS
    && mixedPriceSource.missingFields.includes('priceSource:mixed'));

  const staleSpread = rp.scoreRoutes([
    { ...base, solver: 'a', amountOutWei: '1000', amountOutUsd: 100, gasUsd: 1, observedAt: now - 1000 },
    { ...base, solver: 'b', amountOutWei: '1001', amountOutUsd: 101, gasUsd: 1, observedAt: now - 40_000 }
  ], { now });
  t('valuations measured far apart are not comparable',
    staleSpread.policy === rp.ROUTE_POLICIES.SAME_ASSUMPTIONS
    && staleSpread.missingFields.includes('observedAt:spread'));

  /* ------------------------ 3. assumption mismatches ----------------------- */
  const feeMismatch = rp.scoreRoutes([
    { ...base, solver: 'a', amountOutWei: '1000' },
    { ...base, solver: 'b', amountOutWei: '9999', feeBps: 0 },
    { ...base, solver: 'c', amountOutWei: '1001' }
  ], { now });
  t('a fee-free quote never wins', feeMismatch.selected.solver === 'c');
  t('the fee mismatch is reported as a rejection',
    feeMismatch.rejected.some((r) => r.solver === 'b' && r.code === 'FEE_MISMATCH'));

  const slippageMismatch = rp.scoreRoutes([
    { ...base, solver: 'a', amountOutWei: '1000' },
    { ...base, solver: 'b', amountOutWei: '9999', slippagePct: 5 },
    { ...base, solver: 'c', amountOutWei: '1002' }
  ], { now });
  t('a quote assuming different slippage is rejected',
    slippageMismatch.rejected.some((r) => r.solver === 'b' && r.code === 'SLIPPAGE_MISMATCH'));

  const chainMismatch = rp.scoreRoutes([
    { ...base, solver: 'a', amountOutWei: '1000' },
    { ...base, solver: 'b', amountOutWei: '9999', chainId: 8453 },
    { ...base, solver: 'c', amountOutWei: '1003' }
  ], { now });
  t('a quote on another chain is rejected',
    chainMismatch.rejected.some((r) => r.solver === 'b' && r.code === 'CHAIN_MISMATCH'));

  const pairMismatch = rp.scoreRoutes([
    { ...base, solver: 'a', amountOutWei: '1000' },
    { ...base, solver: 'b', amountOutWei: '9999', toSymbol: 'WBTC' },
    { ...base, solver: 'c', amountOutWei: '1004' }
  ], { now });
  t('a quote for another pair is rejected',
    pairMismatch.rejected.some((r) => r.solver === 'b' && r.code === 'PAIR_MISMATCH'));

  /* ------------------------- 4. hard eligibility --------------------------- */
  const expired = rp.scoreRoutes([
    { ...base, solver: 'a', amountOutWei: '1000' },
    { ...base, solver: 'stale', amountOutWei: '9999', observedAt: now - 600_000 }
  ], { now });
  t('an expired quote is not eligible',
    expired.selected.solver === 'a' && expired.rejected.some((r) => r.code === 'QUOTE_EXPIRED'));

  const notExecutable = rp.scoreRoutes([
    { ...base, solver: 'velora', amountOutWei: '9999', executable: false },
    { ...base, solver: 'kyberswap', amountOutWei: '1000' }
  ], { now });
  t('a quote-only source never wins', notExecutable.selected.solver === 'kyberswap');
  t('a quote-only source is rejected with a reason',
    notExecutable.rejected.some((r) => r.solver === 'velora' && r.code === 'NOT_EXECUTABLE'));

  const critical = rp.scoreRoutes([
    { ...base, solver: 'risky', amountOutWei: '9999', riskLevel: 'critical' },
    { ...base, solver: 'safe', amountOutWei: '1000' }
  ], { now });
  t('a critical-risk route is removed, not merely penalised',
    critical.selected.solver === 'safe' && critical.rejected.some((r) => r.code === 'CRITICAL_RISK'));

  const brokenIntegrity = rp.scoreRoutes([
    { ...base, solver: 'tampered', amountOutWei: '9999', integrityOk: false },
    { ...base, solver: 'clean', amountOutWei: '1000' }
  ], { now });
  t('a route failing integrity is removed',
    brokenIntegrity.selected.solver === 'clean'
    && brokenIntegrity.rejected.some((r) => r.code === 'INTEGRITY_FAILED'));

  const noOutput = rp.scoreRoutes([{ ...base, solver: 'zero', amountOutWei: '0' }], { now });
  t('a zero-output quote is rejected', noOutput.selected === null && noOutput.rejected[0].code === 'NO_OUTPUT');

  const errored = rp.scoreRoutes([{ ...base, solver: 'boom', amountOutWei: '10', error: 'NO_ROUTE' }], { now });
  t('an errored quote is rejected', errored.rejected[0].code === 'QUOTE_ERROR');

  t('with no eligible route nothing is selected', rp.scoreRoutes([], { now }).selected === null);

  /* ------------------------- 5. deterministic ties ------------------------- */
  const tie = [
    { ...base, solver: 'zulu', amountOutWei: '1000', gasUsd: 2, amountOutUsd: 100, hops: 2, latencyMs: 100 },
    { ...base, solver: 'alpha', amountOutWei: '1000', gasUsd: 2, amountOutUsd: 100, hops: 2, latencyMs: 100 }
  ];
  const tie1 = rp.scoreRoutes(tie, { now });
  const tie2 = rp.scoreRoutes([...tie].reverse(), { now });
  t('an exact tie is broken lexically by solver id', tie1.selected.solver === 'alpha');
  t('the tie-break does not depend on input order', tie1.selected.solver === tie2.selected.solver);

  const gasTie = rp.scoreRoutes([
    { ...base, solver: 'a', amountOutWei: '1000', amountOutUsd: 100, gasUsd: 5 },
    { ...base, solver: 'b', amountOutWei: '1000', amountOutUsd: 100, gasUsd: 1 }
  ], { now });
  t('equal net output prefers the cheaper gas', gasTie.selected.solver === 'b');

  const latencyTie = rp.scoreRoutes([
    { ...base, solver: 'a', amountOutWei: '1000', latencyMs: 900, hops: 1 },
    { ...base, solver: 'b', amountOutWei: '1000', latencyMs: 100, hops: 1 }
  ], { now });
  t('equal output with no USD data prefers lower latency', latencyTie.selected.solver === 'b');

  const hopTie = rp.scoreRoutes([
    { ...base, solver: 'a', amountOutWei: '1000', latencyMs: 100, hops: 4 },
    { ...base, solver: 'b', amountOutWei: '1000', latencyMs: 100, hops: 1 }
  ], { now });
  t('equal output and latency prefers fewer hops', hopTie.selected.solver === 'b');

  const slipTie = rp.scoreRoutes([
    { ...base, solver: 'a', amountOutWei: '1000', slippagePct: 0.5 },
    { ...base, solver: 'b', amountOutWei: '1000', slippagePct: 0.5 }
  ], { now });
  t('routes sharing every field still resolve to one winner', Boolean(slipTie.selected));

  /* -------------------------- 6. full determinism -------------------------- */
  const wide = [
    { ...base, solver: 'kyberswap', amountOutWei: '1002', amountOutUsd: 100.2, gasUsd: 1.5, hops: 2, latencyMs: 220 },
    { ...base, solver: 'openocean', amountOutWei: '1004', amountOutUsd: 100.4, gasUsd: 2.0, hops: 3, latencyMs: 190 },
    { ...base, solver: 'velora', amountOutWei: '1010', executable: false },
    { ...base, solver: 'other', amountOutWei: '1050', feeBps: 0 }
  ];
  const shuffles = [
    wide,
    [...wide].reverse(),
    [wide[2], wide[0], wide[3], wide[1]],
    [wide[3], wide[1], wide[2], wide[0]]
  ].map((rowsIn) => JSON.stringify(rp.scoreRoutes(rowsIn, { now }).ranked.map((r) => r.solver)));
  t('the ranking is identical for every input order', new Set(shuffles).size === 1);
  const repeated = JSON.stringify(rp.scoreRoutes(wide, { now }));
  t('the same input always produces the same output', repeated === JSON.stringify(rp.scoreRoutes(wide, { now })));

  const decision = rp.scoreRoutes(wide, { now });
  t('every rejected route carries a code',
    decision.rejected.length === 2 && decision.rejected.every((r) => rp.REJECTION_CODES.includes(r.code)));
  t('the decision records the assumptions it compared under',
    decision.assumptions.feeBps === 70 && decision.assumptions.chainId === 42161);
  t('the decision is schema-tagged', decision.schema === 'fbt.intent-route-policy.v1');
  t('ranks are 1-based and contiguous',
    decision.ranked.every((row, index) => row.rank === index + 1));

  /* ------------------- 7. adapter from the live quote trace ---------------- */
  const candidates = rp.candidatesFromQuoteTrace([
    { solver: 'kyberswap', status: 'quoted', executable: true, amountOutWei: '1000', gasUsd: 1, feeBps: 70, slippage: 0.5, hops: 2, latencyMs: 100 },
    { solver: 'velora', status: 'quoted', executable: false, amountOutWei: '1100', feeBps: 70, slippage: 0.5 },
    { solver: 'openocean', status: 'rejected', executable: false, amountOutWei: null, error: 'timeout' }
  ], { chainId: 42161, fromSymbol: 'USDC', toSymbol: 'ETH', observedAt: now });
  const fromTrace = rp.scoreRoutes(candidates, { now });
  t('the live quote trace maps into the policy input', fromTrace.selected.solver === 'kyberswap');
  t('a rejected solver from the trace is reported',
    fromTrace.rejected.some((r) => r.solver === 'openocean'));

  return rows;
}
