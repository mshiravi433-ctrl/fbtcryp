/**
 * FBT INTENT AI — AUTONOMY CORE
 * ---------------------------------------------------------------------------
 * The layer that turns "the AI navigates you to a page" into "the AI does the
 * thing". Four pieces, each with its own probe:
 *
 *   venueExecutors.js   what each venue needs to sign, bound to the app's own
 *                       primitives — lending, the fork-probed Base USDC pool,
 *                       Solana perps, tokenised equities, EVM swap.
 *   goalPlanCompiler.js "double my profit" → the APY the goal needs, the best
 *                       rate that exists right now, and an executable plan.
 *                       It refuses to promise what the live rates cannot give.
 *   strategyKit.js      declarative strategies + the backtester that measures
 *                       them, sharing one signal shape with the loop.
 *   botLoop.js          the loop itself: protections first, then exits, then
 *                       entries — PAPER / ARMED / LIVE.
 *   chatRoutes.js       the contract between the routes the AI emits and the
 *                       screens the router actually mounts.
 *   browserDrivers.js   the browser-only binding of real primitives.
 *
 * Probes: test/intent-ai/autonomy-execution-probe.mjs,
 *         test/intent-ai/autonomy-engine-probe.mjs,
 *         test/intent-ai/chat-route-contract-probe.mjs
 */

export * from './venueExecutors.js';
export * from './goalPlanCompiler.js';
export * from './strategyKit.js';
export * from './botLoop.js';
export * from './chatRoutes.js';
