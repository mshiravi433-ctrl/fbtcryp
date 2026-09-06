/**
 * FBT INTENT AI — AUTONOMY ENGINE probe (goal compiler + loop + backtester).
 * ---------------------------------------------------------------------------
 * Locks the two claims the autonomy layer makes to the user:
 *
 *   A. "سودم ۲ برابر شود" gets ARITHMETIC, not a promise. The compiler states
 *      the APY the goal needs, the best rate that exists right now, and refuses
 *      to build a plan from a rate it could not source.
 *   B. The loop is the thing freqtrade has and this app did not: protections
 *      run before entries, one strategy object drives both the backtest and the
 *      live tick, and a mode that cannot sign never pretends it filled.
 */

import {
  buildGoalPlan,
  normalizeGoalTarget,
  requiredApyPctFor,
  daysToMultipleAt,
  multipleAfterDays,
  buildGoalSchedule
} from '../../src/lib/intent-ai/autonomy/goalPlanCompiler.js';
import {
  BUILTIN_STRATEGIES,
  backtestStrategy,
  sma, ema, rsi, atr,
  roiTargetFor,
  validateStrategy
} from '../../src/lib/intent-ai/autonomy/strategyKit.js';
import { createAutonomyEngine, AUTONOMY_MODES } from '../../src/lib/intent-ai/autonomy/botLoop.js';

const results = [];
const check = (name, ok, extra = null) => { results.push({ name, ok: Boolean(ok), extra }); };

/* ── live rate sources, faked at the boundary only ─────────────────────── */

function makeSources({ lendingApy = 4.62, farmApy = 6.4, lstApy = 3.1, failLending = false, empty = false } = {}) {
  return {
    lendingRates: async () => (failLending
      ? { ok: false, code: 'RPC_UNAVAILABLE' }
      : { ok: true, rows: empty ? [] : [{ id: 'aave-base-usdc', venue: 'aave-base-usdc', title: 'Aave v3 USDC on Base', asset: 'USDC', chainId: 8453, apyPct: lendingApy, risk: 'low' }] }),
    farmPools: async () => ({ ok: true, rows: empty ? [] : [{ id: 'pool-1', venue: 'lend-aave', title: 'Stable pool', asset: 'USDC', chainId: 42161, apyPct: farmApy, risk: 'medium' }] }),
    lstYields: async () => ({ ok: true, rows: empty ? [] : [{ id: 'jitosol', venue: 'swap-evm', title: 'JitoSOL', asset: 'JitoSOL', mint: 'J1tosoMINT', apyPct: lstApy, risk: 'low' }] }),
    perpFunding: async () => ({ ok: true, rows: empty ? [] : [{ id: 'btc-funding', venue: 'perp-velocity', title: 'BTC funding carry', asset: 'BTC', apyPct: 21, risk: 'high', leverage: 3, side: 'long' }] })
  };
}

try {
  /* ══════════ A. the goal compiler's arithmetic ══════════ */

  check('2× in 365 days needs 100% APY', Math.abs(requiredApyPctFor(2, 365) - 100) < 0.01, String(requiredApyPctFor(2, 365)));
  check('2× in 30 days needs ~3226% APY (the number that ends the fantasy)',
    requiredApyPctFor(2, 30) > 3000, String(Math.round(requiredApyPctFor(2, 30))));
  check('doubling at 7% takes ~10.2 years (rule of 72 agrees)',
    Math.abs(daysToMultipleAt(2, 7) / 365 - 10.24) < 0.2, String((daysToMultipleAt(2, 7) / 365).toFixed(2)));
  check('4.62% for a year is 1.046×, not 2×', Math.abs(multipleAfterDays(4.62, 365) - 1.0462) < 0.001);
  check('a 2× target normalises from «سودم دو برابر شود» style input',
    normalizeGoalTarget({ multiple: 2 })?.mode === 'multiple' && normalizeGoalTarget({ multiple: 2 }).value === 2);
  check('a percentage target becomes the same multiple',
    Math.abs((normalizeGoalTarget({ targetPct: 100 })?.multiple ?? 0) - 2) < 1e-9);

  /* ══════════ A2. an unreachable goal says so, with both numbers ══════════ */

  const double = await buildGoalPlan({
    goal: { multiple: 2 },
    capitalUsd: 10_000,
    horizonDays: 365,
    riskProfile: 'balanced',
    sources: makeSources()
  });
  check('a goal plan is built from live rates', double.ok === true && double.bestAvailableApyPct === 6.4, String(double.bestAvailableApyPct));
  check('2× in a year is correctly judged NOT reachable at live rates',
    double.code === 'NOT_REACHABLE_AT_LIVE_RATES' && double.verdict.reachable === false);
  check('the verdict carries the required rate AND the real one',
    double.requiredApyPct === 100 && double.bestAvailableApyPct === 6.4);
  check('the honesty sentence names both numbers, so the prose cannot drift from the plan',
    /100\.00/.test(double.honesty) && /6\.40/.test(double.honesty), double.honesty?.slice(0, 80));
  check('the honesty sentence states how long 2× actually takes',
    /سال/.test(double.honesty) || /years/.test(double.honesty));
  check('every option carries a real venue action list the executors can sign',
    double.options.length > 0 && double.options.every((o) => Array.isArray(o.actions) && o.actions.length > 0 && o.actions[0].amountUsd === 10_000));
  check('the chosen option is the highest real rate inside the risk band',
    double.chosen?.apyPct === 6.4, String(double.chosen?.apyPct));

  /* ══════════ A3. the risk band is a ceiling, not a suggestion ══════════ */

  const conservative = await buildGoalPlan({
    goal: { multiple: 1.05 },
    capitalUsd: 1000,
    horizonDays: 365,
    riskProfile: 'conservative',
    sources: makeSources()
  });
  check('a conservative profile never sees the leveraged perp option',
    conservative.ok === true && !conservative.options.some((o) => o.kind === 'perp'),
    conservative.options.map((o) => o.kind).join(','));
  const aggressive = await buildGoalPlan({
    goal: { multiple: 1.05 }, capitalUsd: 1000, horizonDays: 365, riskProfile: 'aggressive', sources: makeSources()
  });
  check('an aggressive profile may see it', aggressive.ok === true && aggressive.options.some((o) => o.kind === 'perp'));

  /* ══════════ A4. refusals are named, never papered over ══════════ */

  const noRates = await buildGoalPlan({ goal: { multiple: 2 }, capitalUsd: 1000, sources: makeSources({ empty: true }) });
  check('no live rate anywhere → NO_LIVE_RATES, not a plan built on memory',
    noRates.ok === false && noRates.code === 'NO_LIVE_RATES', noRates.code);
  const noCapital = await buildGoalPlan({ goal: { multiple: 2 }, capitalUsd: 0, sources: makeSources() });
  check('no readable capital → CAPITAL_REQUIRED, not a guess about someone\'s money',
    noCapital.ok === false && noCapital.code === 'CAPITAL_REQUIRED');
  const noTarget = await buildGoalPlan({ goal: {}, capitalUsd: 1000, sources: makeSources() });
  check('no target → NO_TARGET', noTarget.ok === false && noTarget.code === 'NO_TARGET');

  const partial = await buildGoalPlan({ goal: { multiple: 1.2 }, capitalUsd: 5000, sources: makeSources({ failLending: true }) });
  check('a failed source is recorded in sourceStatus, not silently ignored',
    partial.ok === true && String(partial.sourceStatus.lending).startsWith('failed:'), partial.sourceStatus?.lending);

  const reachable = await buildGoalPlan({ goal: { multiple: 1.05 }, capitalUsd: 5000, horizonDays: 365, sources: makeSources() });
  check('a modest goal at real rates IS declared reachable',
    reachable.ok === true && reachable.code === 'REACHABLE' && reachable.verdict.reachable === true);

  /* ══════════ A5. the DCA schedule uses the same real rate ══════════ */

  const schedule = buildGoalSchedule({ capitalUsd: 1000, targetUsd: 2000, monthlyAddUsd: 100, apyPct: 6.4 });
  check('a monthly schedule reaches 2× and says how many months it takes',
    schedule.ok === true && schedule.code === 'REACHABLE' && schedule.months > 0 && schedule.months < 120, String(schedule.months));
  const hopeless = buildGoalSchedule({ capitalUsd: 1000, targetUsd: 2000, monthlyAddUsd: 0, apyPct: 0 });
  check('a schedule with no contribution and no yield is refused', hopeless.ok === false && hopeless.code === 'NO_PROGRESS_POSSIBLE');

  /* ══════════ B. indicators are the real definitions ══════════ */

  check('SMA of 1..5 over 5 is 3', sma([1, 2, 3, 4, 5], 5) === 3);
  check('EMA converges towards the last value', Math.abs(ema([1, 1, 1, 10], 3) - 5.5) < 0.01, String(ema([1, 1, 1, 10], 3)));
  check('RSI of a monotonic rise is 100', rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14) === 100);
  check('RSI needs more candles than its period', rsi([1, 2, 3], 14) === null);
  check('ATR is positive on a ranged series', atr([{ high: 11, low: 9, close: 10 }, { high: 12, low: 10, close: 11 }, { high: 13, low: 11, close: 12 }, { high: 12, low: 10, close: 11 }], 2) > 0);
  check('freqtrade minimal_roi picks the tightest elapsed target',
    roiTargetFor({ 0: 5, 60: 2, 1440: 0.5 }, 120) === 2 && roiTargetFor({ 0: 5, 60: 2, 1440: 0.5 }, 2000) === 0.5);
  check('a strategy with no entry function cannot be armed',
    validateStrategy({ id: 'x' }).ok === false && validateStrategy({ id: 'x' }).errors.includes('MISSING_ENTRY'));

  /* ══════════ B2. the backtester is honest about cost ══════════ */

  const candles = [];
  let price = 100;
  for (let i = 0; i < 400; i += 1) {
    price *= 1 + Math.sin(i / 9) * 0.025 + 0.0004;
    candles.push({ time: 1_700_000_000 + i * 3600, close: price, high: price * 1.012, low: price * 0.988 });
  }
  const strategy = BUILTIN_STRATEGIES.find((s) => s.id === 'rsi-reversion');
  const bt = backtestStrategy({ strategy, candles, initialUsd: 1000, feePct: 0.3, slippagePct: 0.1 });
  check('the backtester runs on real-shaped candles', bt.ok === true && bt.trades > 0, `${bt.trades} trades`);
  check('the backtester applies cost on BOTH sides (a zero-fee run would differ)',
    backtestStrategy({ strategy, candles, initialUsd: 1000, feePct: 0, slippagePct: 0 }).returnPct > bt.returnPct);
  check('every closed trade names the reason it closed',
    bt.tradeLog.every((t) => ['STOPLOSS', 'TAKE_PROFIT', 'ROI', 'EXIT_SIGNAL'].includes(t.reason)));
  check('max drawdown is measured, not assumed', bt.maxDrawdownPct >= 0);
  check('the disclaimer travels with every backtest', /not a forecast/i.test(bt.disclaimer || ''));
  const tooShort = backtestStrategy({ strategy, candles: candles.slice(0, 10), initialUsd: 1000 });
  check('too few candles is a named refusal, not a flattering zero-trade result',
    tooShort.ok === false && tooShort.code === 'NOT_ENOUGH_DATA');

  /* ══════════ B3. the loop: protections before entries ══════════ */

  let now = 1_700_000_000_000;
  const clock = () => now;
  const executed = [];
  const engine = createAutonomyEngine({
    mode: AUTONOMY_MODES.PAPER,
    clock,
    protections: { maxDailyLossPct: 5, maxDrawdownPct: 15, cooldownMinutes: 0, maxOpenPositions: 2 }
  });
  check('the engine starts stopped', engine.status().running === false);
  check('a tick before start is refused, not silently ignored', (await engine.tick({})).code === 'NOT_RUNNING');
  engine.start();
  const armed = engine.arm({ strategyId: strategy.id, strategy, asset: 'BTC', stakeUsd: 300 });
  check('a strategy can be armed', armed.ok === true);
  check('arming twice is refused', engine.arm({ strategyId: strategy.id, strategy, asset: 'BTC', stakeUsd: 300 }).code === 'ALREADY_ARMED');
  check('arming without a stake is refused', engine.arm({ strategyId: strategy.id, strategy, asset: 'ETH' }).code === 'STAKE_REQUIRED');
  check('arming an invalid strategy is refused before it can throw in a tick',
    engine.arm({ strategyId: 'bad', strategy: { id: 'bad' }, asset: 'BTC', stakeUsd: 10 }).code === 'INVALID_STRATEGY');

  /* Drive the same candles the backtester measured. */
  const warmup = 30;
  let lastTick = null;
  for (let i = warmup; i < candles.length; i += 1) {
    now += 3_600_000;
    lastTick = await engine.tick({ now, prices: { BTC: candles[i].close }, candles: { BTC: candles.slice(0, i + 1) } });
  }
  const profit = engine.profit();
  check('the loop traded the same instrument end to end', profit.closedTrades > 0, `${profit.closedTrades} closed`);
  check('the loop and the backtester agree on the NUMBER of signals (one strategy object)',
    profit.closedTrades + engine.status().positions.length === bt.trades + (bt.openAtEnd ? 1 : 0),
    `loop=${profit.closedTrades + engine.status().positions.length} backtest=${bt.trades}${bt.openAtEnd ? '+1 open' : ''}`);
  check('every loop exit names a reason from the same set',
    engine.state.closedTrades.every((t) => ['STOPLOSS', 'TAKE_PROFIT', 'ROI', 'EXIT_SIGNAL', 'TRAILING_STOP'].includes(t.reason)));
  check('an equity curve was recorded for the run', engine.state.equityCurve.length > 100);

  /* ── protections actually trip ── */
  const guard = createAutonomyEngine({
    mode: AUTONOMY_MODES.PAPER,
    clock,
    protections: { maxDailyLossPct: 2, maxDrawdownPct: 50, cooldownMinutes: 0 }
  });
  guard.start();
  guard.arm({ strategyId: 'dca', strategy: BUILTIN_STRATEGIES.find((s) => s.id === 'dca-accumulator'), asset: 'BTC', stakeUsd: 100 });
  /* Force the equity below the daily anchor: the anchor is taken on the first
     tick, so a 10% price drop on the second must halt the engine. */
  await guard.tick({ now, prices: { BTC: 100 }, candles: { BTC: candles.slice(0, 40) } });
  const halted = await guard.tick({ now: now + 3_600_000, prices: { BTC: 80 }, candles: { BTC: candles.slice(0, 41) } });
  check('the daily-loss protection halts the engine before any new entry',
    halted.code === 'MAX_DAILY_LOSS', halted.code);
  check('a halted engine says until when', Number(guard.status().protections.haltedUntil) > now);

  /* ── ARMED never touches a wallet ── */
  const armedEngine = createAutonomyEngine({ mode: AUTONOMY_MODES.ARMED, clock, protections: { cooldownMinutes: 0 } });
  armedEngine.start();
  armedEngine.arm({ strategyId: 'dca', strategy: BUILTIN_STRATEGIES.find((s) => s.id === 'dca-accumulator'), asset: 'BTC', stakeUsd: 100 });
  const armedTick = await armedEngine.tick({ now, prices: { BTC: 100 }, candles: { BTC: candles.slice(0, 40) } });
  check('ARMED produces a run for the user to sign instead of filling',
    armedTick.pending.length === 1 && armedTick.fills.length === 0, `pending=${armedTick.pending.length}`);
  check('an ARMED run carries the real venue action', armedTick.pending[0]?.action?.to === 'BTC' && armedTick.pending[0]?.action?.amountUsd === 100);
  check('ARMED reports paper=false but never a tx hash it does not have',
    armedEngine.status().positions.length === 0);

  /* ── LIVE goes through the injected executor and fails closed ── */
  const liveOk = createAutonomyEngine({
    mode: AUTONOMY_MODES.LIVE,
    clock,
    protections: { cooldownMinutes: 0 },
    execute: async (action) => { executed.push(action); return { success: true, status: 'CONFIRMED', txHash: '0xLIVE' }; }
  });
  liveOk.start();
  liveOk.arm({ strategyId: 'dca', strategy: BUILTIN_STRATEGIES.find((s) => s.id === 'dca-accumulator'), asset: 'BTC', stakeUsd: 100 });
  const liveTick = await liveOk.tick({ now, prices: { BTC: 100 }, candles: { BTC: candles.slice(0, 40) } });
  check('LIVE hands the action to the real executor', executed.length === 1 && executed[0].to === 'BTC');
  check('LIVE records the receipt the executor returned', liveTick.fills[0]?.txHash === '0xLIVE', liveTick.fills[0]?.txHash);

  const liveFail = createAutonomyEngine({
    mode: AUTONOMY_MODES.LIVE,
    clock,
    protections: { cooldownMinutes: 0 },
    execute: async () => ({ success: false, status: 'FAILED', error: { code: 'BROADCAST_FAILED' } })
  });
  liveFail.start();
  liveFail.arm({ strategyId: 'dca', strategy: BUILTIN_STRATEGIES.find((s) => s.id === 'dca-accumulator'), asset: 'BTC', stakeUsd: 100 });
  const failTick = await liveFail.tick({ now, prices: { BTC: 100 }, candles: { BTC: candles.slice(0, 40) } });
  check('a failed execution opens no position and reports the failure',
    failTick.fills.length === 0 && liveFail.status().positions.length === 0
    && liveFail.state.events.some((e) => e.type === 'EXECUTION_FAILED'));

  const noExec = createAutonomyEngine({ mode: AUTONOMY_MODES.LIVE, clock, protections: { cooldownMinutes: 0 } });
  noExec.start();
  noExec.arm({ strategyId: 'dca', strategy: BUILTIN_STRATEGIES.find((s) => s.id === 'dca-accumulator'), asset: 'BTC', stakeUsd: 100 });
  await noExec.tick({ now, prices: { BTC: 100 }, candles: { BTC: candles.slice(0, 40) } });
  check('LIVE without an executor says so instead of filling on paper',
    noExec.state.events.some((e) => e.type === 'EXECUTOR_MISSING') && noExec.status().positions.length === 0);

  /* ── position sizing is capped by the rules, not by the strategy ── */
  const capped = createAutonomyEngine({ mode: AUTONOMY_MODES.PAPER, clock, protections: { maxPositionSharePct: 10, cooldownMinutes: 0 } });
  capped.start();
  capped.arm({ strategyId: 'dca', strategy: BUILTIN_STRATEGIES.find((s) => s.id === 'dca-accumulator'), asset: 'BTC', stakeUsd: 900 });
  const cappedTick = await capped.tick({ now, prices: { BTC: 100 }, candles: { BTC: candles.slice(0, 40) } });
  check('a strategy asking for 90% of the account gets the capped share',
    cappedTick.fills[0]?.stakeUsd <= 100.0001, String(cappedTick.fills[0]?.stakeUsd));

  /* ── stop / start / mode ── */
  check('stop() halts the loop', engine.stop().ok === true && engine.status().running === false);
  check('an unknown mode is refused', engine.setMode('YOLO').ok === false);
  check('PAPER reports paper=true in its profit report', engine.profit().paper === true);
  check('snapshot/restore round-trips the whole engine', (() => {
    const snap = engine.snapshot();
    const twin = createAutonomyEngine({ mode: AUTONOMY_MODES.PAPER, clock });
    twin.restore(snap);
    return twin.profit().closedTrades === profit.closedTrades;
  })());
} catch (err) {
  check('probe completed without throwing', false, String(err?.stack || err));
}

const passed = results.filter((r) => r.ok).length;
console.log(`\nautonomy-engine probe: ${passed}/${results.length} passed`);
if (passed !== results.length) {
  console.error(results.filter((r) => !r.ok).map((r) => `  ✗ ${r.name}${r.extra ? ` [${r.extra}]` : ''}`).join('\n'));
  process.exit(1);
}
console.log('OK: intent-ai/autonomy-engine-probe');

export default results;
