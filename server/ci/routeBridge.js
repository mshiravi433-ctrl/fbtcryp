/**
 * THE ROUTE-ADAPTER BRIDGE
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * `server/fios/routeIntelligence.js` was COMPLETE and DARK.
 *
 * It ranked candidate routes across five dimensions — total cost, liquidity
 * impact, time in flight, historical success and bridge risk — and it did
 * the hard part well: a dimension that could not be read stayed UNKNOWN,
 * an unread dimension discounted the score, and a route with no readable
 * dimension was REPORTED and never faked into a ranking.
 *
 * But it had no customers. The engine's own comment said it plainly:
 *
 *   «a route plan needs candidate routes from the quote step; the
 *     intelligence layer does not dial providers itself»
 *
 * So it was waiting for routes that only ever arrived if some other
 * layer had already quoted a cross-chain transfer. The result was a
 * complete ranking engine behind a door nobody opened: «which bridge
 * should I use to move my money?» had no route intelligence anywhere.
 *
 * WHAT THIS BRIDGE DOES
 *
 * It supplies the missing half — a LIVE candidate source — and it supplies
 * it in the engine's own terms:
 *
 *   1. The candidates come from the deployment's existing route provider
 *      (LI.FI's `/advanced/routes`), which is already the source of truth
 *      for the wallet's own route list. There is no second provider, no
 *      second quote, and no second gateway: one call, one set of numbers.
 *   2. The candidates are ADAPTED into the engine's dimension vocabulary,
 *      and every adaptation is either a real provider number or an
 *      explicit UNKNOWN. A field the provider did not send is not filled
 *      with a default that would read as a measurement.
 *   3. The adapter is INJECTABLE, so the brain can be exercised without a
 *      network, and so a provider outage is reported as an outage rather
 *      than as «no routes».
 *
 * WHY A BRIDGE AND NOT A DIRECT IMPORT
 *
 * The same ordering constraint as the fit and macro bridges: `fios` is
 * built after the brain, and the brain is built before `fios`. Holding a
 * direct reference to either side at construction time cannot work.
 *
 * It is also a CPU constraint. `server/fios/routeIntelligence.js` sits on
 * the composition root's dependency graph, and importing it eagerly from
 * the brain's module file would put it on the cold-start path of every
 * serverless instance. The provider is registered lazily and the engine is
 * reached through this one-slot bridge.
 *
 * THE THREE RULES (the same as every other bridge here)
 *
 *   1. The provider is optional. Until it is wired the surface reports a
 *      named reason — never a fabricated route.
 *   2. The provider is per-owner. A route plan belongs to one person's
 *      transfer, and the brain always passes its own owner.
 *   3. A failure is named, not thrown. An exception must not take the
 *      turn down.
 */

let provider = null;

/**
 * Register the route-candidate reader.
 *
 * @param {(owner: string, opts?: object) => Promise<any>} fn
 *   Returns `{ ok, routes, request, source }` — the live candidates and
 *   the request they answer.
 * @returns {() => void} a disposer, so a test can restore the previous state.
 */
export function setRouteProvider(fn) {
  const previous = provider;
  provider = typeof fn === 'function' ? fn : null;
  return () => { provider = previous; };
}

/** True once the route source has wired itself in. */
export function hasRouteProvider() {
  return typeof provider === 'function';
}

/**
 * Read the live route candidates for one owner.
 *
 * The returned shape is the adapter's OWN contract, not the engine's:
 *
 *   { ok: true,  routes: [...], request: {...}, source: 'lifi', at }
 *   { ok: false, code: 'ROUTE_PROVIDER_NOT_WIRED' | 'NO_ROUTE' | ..., detail }
 *
 * A failure is a NAMED code. The brain turns a named code into an honest
 * sentence; it never turns it into a zero, an empty ranking that looks
 * like a considered answer, or a thrown exception.
 */
export async function readRouteCandidates(owner, opts = {}) {
  if (!hasRouteProvider()) {
    return {
      ok: false,
      code: 'ROUTE_PROVIDER_NOT_WIRED',
      detail: 'the live route source is not wired in this deployment',
      routes: [],
      request: null,
      source: null
    };
  }
  try {
    const out = await provider(owner, opts);
    if (!out || typeof out !== 'object') {
      return {
        ok: false,
        code: 'ROUTE_PROVIDER_BAD_RESULT',
        detail: 'the route source returned something that is not a result',
        routes: [],
        request: null,
        source: null
      };
    }
    if (out.ok === false) {
      return {
        ok: false,
        code: out.code || 'ROUTE_SOURCE_FAILED',
        detail: out.detail || null,
        routes: [],
        request: out.request || null,
        source: out.source || null
      };
    }
    const routes = Array.isArray(out.routes) ? out.routes : [];
    if (!routes.length) {
      return {
        ok: false,
        code: out.code || 'NO_ROUTE',
        detail: out.detail || 'the provider offered no route for this transfer',
        routes: [],
        request: out.request || null,
        source: out.source || null
      };
    }
    return {
      ok: true,
      routes,
      request: out.request || null,
      source: out.source || null,
      at: out.at ?? Date.now()
    };
  } catch (err) {
    return {
      ok: false,
      code: 'ROUTE_SOURCE_FAILED',
      detail: String(err?.message || err).slice(0, 200) || null,
      routes: [],
      request: null,
      source: null
    };
  }
}

/**
 * Rank the candidates with the route-intelligence ENGINE.
 *
 * The engine lives in `server/fios/routeIntelligence.js`, which is on the
 * composition root's dependency graph — so it is imported DYNAMICALLY,
 * the first time a route is actually ranked, and never on the cold-start
 * path of a turn that does not ask about routes.
 *
 * The engine is reached through the FIOs root, because that is where it
 * is mounted with its collections and its observability. When the root is
 * not there (a bare process, a unit test), the engine's PURE build is
 * used directly — `buildRouteIntelligence` needs no store and no
 * telemetry, and refusing to rank without a store would make the
 * capability depend on a database rather than on a question.
 *
 * @returns {Promise<{ok: boolean, result?: object, code?: string, detail?: string}>}
 */
export async function routeIntelligenceFor(owner, { request = {}, routes = [], correlationId = null } = {}) {
  const rows = Array.isArray(routes) ? routes : [];
  if (!rows.length) {
    return {
      ok: false,
      code: 'NO_CANDIDATE_ROUTES',
      detail: 'a route ranking needs candidate routes; there were none'
    };
  }
  try {
    /* The mounted engine first — it persists the plan and emits the
       telemetry. */
    const fios = await import('../fios/index.js');
    if (typeof fios?.routeIntelligenceForOwner === 'function') {
      const out = await fios.routeIntelligenceForOwner(owner, { request, routes, correlationId });
      /* The root is exported but not MOUNTED in this process (a bare
         process, a unit test). That is not a failure of the ranking —
         the engine's pure build does the same work without a store and
         without telemetry — so the pure build takes it. */
      if (out?.ok !== false || out?.code !== 'ROUTE_ENGINE_NOT_MOUNTED') return out;
    }
  } catch {
    /* The root is not mounted in this process; fall through to the pure
       engine. */
  }
  try {
    const { buildRouteIntelligence } = await import('../fios/routeIntelligence.js');
    return { ok: true, result: buildRouteIntelligence(request, { routes }) };
  } catch (err) {
    return {
      ok: false,
      code: 'ROUTE_RANKING_FAILED',
      detail: String(err?.message || err).slice(0, 200) || null
    };
  }
}

/**
 * The adapter itself: LI.FI's live routes, adapted into the engine's
 * dimension vocabulary.
 *
 * The adaptation is deliberately conservative. For each dimension the
 * provider's OWN field is used when it sent one; otherwise the dimension
 * is left absent, which the engine reads as UNKNOWN. Nothing is defaulted
 * into a number that would look measured:
 *
 *   · total cost      — the provider's `totalCostUsd`, or the sum of its
 *                       named fee legs. Real either way.
 *   · liquidity       — the provider does NOT report pool depth, so the
 *                       depth is NOT invented. It stays UNKNOWN and the
 *                       score is discounted accordingly.
 *   · time in flight  — the provider's own `executionDuration` sum.
 *   · success rate    — LI.FI reports no per-route success history, so it
 *                       stays UNKNOWN. The engine's rule is explicit:
 *                       «never imputed».
 *   · bridge risk     — derived from the hop count, which IS known, and
 *                       from the provider's reliability when it supplies
 *                       one.
 *
 * The point of the adapter is not to produce five dimensions; it is to
 * produce the ones the provider actually measured, and to let the engine
 * discount the rest. A route with two known dimensions and a route with
 * five known dimensions are then honestly comparable, because the
 * unknown ones carry their full weight against both.
 */
export function adaptRoutesForIntelligence(routes = [], { request = {} } = {}) {
  const rows = Array.isArray(routes) ? routes : [];
  const amountUsd = numOrNull(request.amountUsd);
  return rows.map((route) => {
    const out = { ...route };
    const steps = Array.isArray(route?.steps) ? route.steps : [];

    /* Hops: the number of legs actually named by the provider. */
    out.hops = Math.max(1, steps.length);

    /* The amount being moved, in USD, when the provider priced it. The
       engine needs it to estimate the liquidity impact — and it needs a
       REAL number, so it comes from the provider's own `fromAmountUsd`,
       never from a guess. */
    const moveUsd = numOrNull(route?.fromAmountUsd) ?? amountUsd;
    if (moveUsd !== null) out.toAmountUsd = moveUsd;

    /* Total cost: the provider's explicit total wins; otherwise the
       named legs are summed. Both are provider numbers. */
    const explicit = numOrNull(route?.totalCostUsd);
    if (explicit !== null) {
      out.totalCostUsd = explicit;
    } else {
      const gas = numOrNull(route?.gasCostUsd);
      const bridge = numOrNull(route?.bridgeFeeUsd);
      const protocol = numOrNull(route?.protocolFeeUsd);
      if (gas !== null || bridge !== null || protocol !== null) {
        out.totalCostUsd = (gas || 0) + (bridge || 0) + (protocol || 0);
      }
    }
    /* Otherwise there is no cost figure and the dimension stays
       UNKNOWN — which the engine reads as «not free». */

    /* Time in flight: the provider's own duration, in seconds. */
    const seconds = numOrNull(route?.estimatedTime);
    if (seconds !== null) out.estimatedSeconds = seconds;

    /* Slippage: the provider's own tolerance. It feeds the risk model. */
    const slip = numOrNull(route?.slippage);
    if (slip !== null) out.slippagePct = slip;

    /* Historical success: LI.FI sends no per-route success rate. The
       field is deliberately ABSENT so the engine reads UNKNOWN rather
       than a fabricated 99%. */
    if (route?.historicalSuccessPct == null) delete out.historicalSuccessPct;

    /* Liquidity depth: not reported by the provider. Left absent, so the
       impact estimate is UNKNOWN rather than a made-up zero. */
    if (route?.liquidityUsd == null) delete out.liquidityUsd;

    return out;
  });
}

/** A number, or null. `null` means «the provider did not say». */
function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
