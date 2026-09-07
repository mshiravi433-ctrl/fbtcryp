/**
 * FBT INTENT AI — AUTONOMY LOOP (autonomy core, layer 3b)
 * ---------------------------------------------------------------------------
 * The part of freqtrade that this app was missing entirely: a LOOP.
 *
 * Before this, "automation" in FBT meant a stored row with a schedule
 * (`liveRecurringIntents`) and a chat that could only hand you a link. There
 * was nothing that woke up, looked at live data, decided, and acted. This file
 * is that thing, and it keeps freqtrade's three ideas that make a loop safe
 * enough to point at real money:
 *
 *   1. PROTECTIONS RUN FIRST. StoplossGuard, MaxDrawdown, daily-loss cap and a
 *      cooldown after a stopped trade are evaluated BEFORE any entry, so a
 *      losing day ends the day rather than compounding.
 *   2. ONE STRATEGY OBJECT drives both the backtest and the loop (see
 *      strategyKit.js). What you measured is what runs.
 *   3. EXPLICIT MODES. PAPER fills against real prices with no signature;
 *      ARMED produces a run the user must confirm; LIVE executes through the
 *      venue executors — and because this app never holds a key, "live" still
 *      means the wallet signs each run. That is stated, not hidden.
 *
 * The engine is pure state + injected side effects: `execute` is the only way
 * it touches a wallet, `clock` the only way it reads time, `store` the only
 * way it persists. That is what lets a probe drive a full day of ticks with no
 * network and no chain.
 */

import { buildContext, roiTargetFor, validateStrategy } from './strategyKit.js';

export const AUTONOMY_SCHEMA = 'fbt.ai-autonomy-engine.v1';

export const AUTONOMY_MODES = Object.freeze({
  /** Simulated fills at real prices. Nothing is signed, nothing moves. */
  PAPER: 'PAPER',
  /** The loop decides, the user signs. One confirmation card per run. */
  ARMED: 'ARMED',
  /** The loop decides and executes through the venue executors; the wallet
      still signs each run, because this app never holds a key. */
  LIVE: 'LIVE'
});

export const DEFAULT_PROTECTIONS = Object.freeze({
  /** Stop the day's trading after this much loss against the day's anchor. */
  maxDailyLossPct: 5,
  /** Halt the whole engine after this drawdown from its own peak. */
  maxDrawdownPct: 15,
  /** freqtrade's StoplossGuard: N stoploss exits inside the window → halt. */
  stoplossGuard: { count: 3, windowMinutes: 240, haltMinutes: 240 },
  /** Minutes a strategy must sit out after one of its trades is stopped. */
  cooldownMinutes: 60,
  maxOpenPositions: 3,
  /** Never risk more than this fraction of the account on one position. */
  maxPositionSharePct: 25
});

const MINUTE = 60_000;
const DAY = 86_400_000;

let seq = 0;
const nextId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(seq += 1).toString(36)}`;

function clampPct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function createAutonomyEngine({
  mode = AUTONOMY_MODES.PAPER,
  protections = {},
  state = null,
  store = null,
  execute = null,
  clock = () => Date.now(),
  logger = null
} = {}) {
  const rules = { ...DEFAULT_PROTECTIONS, ...(protections || {}) };
  let current = state ? JSON.parse(JSON.stringify(state)) : freshState(mode);
  if (current.mode !== mode) current.mode = mode;

  const persist = () => {
    if (store && typeof store.save === 'function') {
      try { store.save(JSON.parse(JSON.stringify(current))); } catch { /* persistence is best-effort */ }
    }
  };
  const log = (event) => {
    current.events.push({ ...event, at: event.at ?? clock() });
    if (current.events.length > 400) current.events = current.events.slice(-400);
    if (logger && typeof logger.log === 'function') { try { logger.log(event); } catch { /* no-op */ } }
  };

  /* ── arm / disarm ────────────────────────────────────────────────────── */

  function arm(input = {}) {
    const strategyId = String(input.strategyId || input.strategy?.id || '');
    if (!strategyId) return { ok: false, code: 'MISSING_STRATEGY' };
    if (current.automations.some((a) => a.strategyId === strategyId && a.active && a.asset === (input.asset || null))) {
      return { ok: false, code: 'ALREADY_ARMED' };
    }
    const stakeUsd = Number(input.stakeUsd);
    if (!(stakeUsd > 0)) return { ok: false, code: 'STAKE_REQUIRED' };
    /* A custom strategy is validated before it can be armed, not after it has
       already thrown inside a tick. */
    if (input.strategy) {
      const valid = validateStrategy(input.strategy);
      if (!valid.ok) return { ok: false, code: 'INVALID_STRATEGY', errors: valid.errors };
    }

    const automation = {
      id: nextId('auto'),
      strategyId,
      strategyTitle: input.strategyTitle || strategyId,
      asset: String(input.asset || 'USDC'),
      chainId: input.chainId != null ? Number(input.chainId) : null,
      venue: input.venue || null,
      stakeUsd,
      leverage: Number(input.leverage) > 1 ? Number(input.leverage) : 1,
      side: String(input.side || 'long').toLowerCase(),
      stoplossPct: input.stoplossPct != null ? clampPct(input.stoplossPct) : null,
      takeProfitPct: input.takeProfitPct != null ? clampPct(input.takeProfitPct) : null,
      backtest: input.backtest || null,
      strategy: input.strategy || null,
      mode: current.mode,
      active: true,
      armedAt: clock(),
      lastRunAt: null,
      cooldownUntil: null,
      runs: 0,
      realizedUsd: 0
    };
    current.automations.push(automation);
    log({ type: 'ARMED', automationId: automation.id, strategyId, asset: automation.asset, stakeUsd, mode: current.mode });
    persist();
    return { ok: true, automation };
  }

  function disarm(id) {
    const row = current.automations.find((a) => a.id === id);
    if (!row) return { ok: false, code: 'NOT_FOUND' };
    row.active = false;
    log({ type: 'DISARMED', automationId: id });
    persist();
    return { ok: true, automation: row };
  }

  function setMode(next) {
    const mode_ = String(next || '').toUpperCase();
    if (!Object.values(AUTONOMY_MODES).includes(mode_)) return { ok: false, code: 'UNKNOWN_MODE' };
    current.mode = mode_;
    for (const a of current.automations) a.mode = mode_;
    log({ type: 'MODE_CHANGED', mode: mode_ });
    persist();
    return { ok: true, mode: mode_ };
  }

  function start() { current.running = true; current.startedAt = clock(); log({ type: 'STARTED' }); persist(); return { ok: true }; }
  function stop() { current.running = false; log({ type: 'STOPPED' }); persist(); return { ok: true }; }

  /* ── protections ─────────────────────────────────────────────────────── */

  function protectionVerdict({ now, equity }) {
    const p = current.protections;
    if (p.haltedUntil && now < p.haltedUntil) {
      return { blocked: true, code: 'HALTED', until: p.haltedUntil, reason: p.haltReason || 'protection' };
    }
    if (p.dailyAnchorAt == null || now - p.dailyAnchorAt >= DAY) {
      p.dailyAnchorAt = now;
      p.dailyAnchorValue = equity;
    }
    if (p.dailyAnchorValue > 0) {
      const dailyLossPct = ((p.dailyAnchorValue - equity) / p.dailyAnchorValue) * 100;
      p.dailyLossPct = dailyLossPct;
      if (dailyLossPct >= Number(rules.maxDailyLossPct)) {
        p.haltedUntil = p.dailyAnchorAt + DAY;
        p.haltReason = `DAILY_LOSS_${dailyLossPct.toFixed(2)}PCT`;
        log({ type: 'PROTECTION', code: 'MAX_DAILY_LOSS', dailyLossPct, haltedUntil: p.haltedUntil });
        return { blocked: true, code: 'MAX_DAILY_LOSS', dailyLossPct, until: p.haltedUntil };
      }
    }
    if (equity > p.peakEquity) p.peakEquity = equity;
    const drawdownPct = p.peakEquity > 0 ? ((p.peakEquity - equity) / p.peakEquity) * 100 : 0;
    p.drawdownPct = drawdownPct;
    if (drawdownPct >= Number(rules.maxDrawdownPct)) {
      p.haltedUntil = now + 24 * 60 * MINUTE;
      p.haltReason = `MAX_DRAWDOWN_${drawdownPct.toFixed(2)}PCT`;
      log({ type: 'PROTECTION', code: 'MAX_DRAWDOWN', drawdownPct, haltedUntil: p.haltedUntil });
      return { blocked: true, code: 'MAX_DRAWDOWN', drawdownPct, until: p.haltedUntil };
    }
    /* StoplossGuard — the window slides, old stops fall out of it. */
    const win = Number(rules.stoplossGuard?.windowMinutes || 240) * MINUTE;
    p.stoplossTimes = (p.stoplossTimes || []).filter((t) => now - t <= win);
    if (p.stoplossTimes.length >= Number(rules.stoplossGuard?.count || 3)) {
      p.haltedUntil = now + Number(rules.stoplossGuard?.haltMinutes || 240) * MINUTE;
      p.haltReason = 'STOPLOSS_GUARD';
      log({ type: 'PROTECTION', code: 'STOPLOSS_GUARD', count: p.stoplossTimes.length, haltedUntil: p.haltedUntil });
      return { blocked: true, code: 'STOPLOSS_GUARD', until: p.haltedUntil };
    }
    return { blocked: false };
  }

  function noteStoploss(now) {
    current.protections.stoplossTimes = [...(current.protections.stoplossTimes || []), now];
  }

  /* ── the tick ────────────────────────────────────────────────────────── */

  /**
   * One iteration. `prices` is `{ [asset]: number }` read live by the caller;
   * `candles` is `{ [asset]: candle[] }` for the strategy's own signals.
   *
   * Returns everything that happened, so the chat can report it in one card
   * instead of the user having to go hunting for it.
   */
  async function tick({ now = clock(), prices = {}, candles = {} } = {}) {
    const result = { ok: true, at: now, fills: [], exits: [], events: [], pending: [], protection: null, equity: null };
    if (!current.running) {
      result.ok = false;
      result.code = 'NOT_RUNNING';
      return result;
    }

    const mark = (pos, price) => (pos ? pos.units * price : 0);
    const liveEquity = () => current.cash
      + current.positions.reduce((sum, p) => sum + mark(p, Number(prices[p.asset] ?? p.lastPrice ?? p.entryPrice)), 0);

    let equity = liveEquity();
    const guard = protectionVerdict({ now, equity });
    result.protection = guard;
    if (guard.blocked) {
      result.code = guard.code;
      result.equity = equity;
      persist();
      return result;
    }

    /* ── 1. manage what is already open ─────────────────────────────────── */
    for (const pos of current.positions.slice()) {
      const price = Number(prices[pos.asset]);
      if (!Number.isFinite(price) || price <= 0) continue;
      pos.lastPrice = price;
      const stepMinutes = Number(pos.timeframeMinutes) || 60;
      const minutesHeld = (now - pos.openedAt) / MINUTE;
      const changePct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
      const auto = current.automations.find((a) => a.id === pos.automationId);

      const stop = pos.stoplossPct != null ? -Number(pos.stoplossPct) : null;
      const tp = pos.takeProfitPct != null ? Number(pos.takeProfitPct) : null;
      /* Trailing: once the position is up past the activation, the stop walks
         up behind it and never back down. */
      if (pos.trailing && changePct >= Number(pos.trailing.activationPct)) {
        const candidate = changePct - Number(pos.trailing.distancePct);
        if (pos.trailingStopPct == null || candidate > pos.trailingStopPct) pos.trailingStopPct = candidate;
      }
      const effectiveStop = pos.trailingStopPct != null ? pos.trailingStopPct : stop;

      const roiTarget = roiTargetFor(pos.roi, minutesHeld);
      const strategy = pos.strategy || null;
      const exitSignal = strategy && typeof strategy.exit === 'function'
        ? Boolean(strategy.exit(buildContext({ candles: candles[pos.asset] || [], index: (candles[pos.asset] || []).length - 1, strategy, position: pos })))
        : false;

      let reason = null;
      if (effectiveStop != null && changePct <= effectiveStop) reason = pos.trailingStopPct != null && changePct <= pos.trailingStopPct && stop != null && changePct > stop ? 'TRAILING_STOP' : 'STOPLOSS';
      else if (tp != null && changePct >= tp) reason = 'TAKE_PROFIT';
      else if (roiTarget != null && changePct >= roiTarget) reason = 'ROI';
      else if (exitSignal) reason = 'EXIT_SIGNAL';
      if (!reason) continue;

      const outcome = await closePosition({ pos, price, now, reason, result });
      if (outcome?.closed) {
        if (reason === 'STOPLOSS' || reason === 'TRAILING_STOP') {
          noteStoploss(now);
          if (auto) auto.cooldownUntil = now + Number(rules.cooldownMinutes || 60) * MINUTE;
        }
        if (auto) auto.realizedUsd = Number(auto.realizedUsd || 0) + Number(outcome.netUsd || 0);
      }
    }

    equity = liveEquity();

    /* ── 2. entries, only if the protections still allow it ─────────────── */
    const recheck = protectionVerdict({ now, equity });
    if (!recheck.blocked) {
      for (const auto of current.automations) {
        if (!auto.active) continue;
        if (auto.cooldownUntil && now < auto.cooldownUntil) continue;
        if (current.positions.length >= Number(rules.maxOpenPositions)) break;
        if (current.positions.some((p) => p.automationId === auto.id && p.asset === auto.asset)) continue;

        const rows = candles[auto.asset];
        if (!Array.isArray(rows) || rows.length < 5) continue;
        const strategy = auto.strategy || null;
        if (!strategy || typeof strategy.entry !== 'function') continue;
        const price = Number(rows[rows.length - 1]?.close);
        if (!Number.isFinite(price) || price <= 0) continue;
        /* The SAME context builder the backtester uses — one signal shape, so
           the rule that was measured is the rule that runs. */
        const ctx = buildContext({ candles: rows, index: rows.length - 1, strategy, position: null });
        let signal = false;
        try { signal = Boolean(strategy.entry(ctx)); } catch { signal = false; }
        if (!signal) continue;

        /* Position sizing is capped by the protection rules, not by the
           strategy's own wish — a strategy that asks for the whole account
           gets the share the rules allow and nothing more. */
        const capUsd = equity * (Number(rules.maxPositionSharePct) / 100);
        const stakeUsd = Math.min(Number(auto.stakeUsd), capUsd);
        if (!(stakeUsd > 0) || stakeUsd > current.cash + 1e-9) continue;

        await openPosition({ auto, strategy, price, stakeUsd, now, result });
      }
    } else {
      result.protection = recheck;
    }

    result.equity = liveEquity();
    current.protections.equity = result.equity;
    current.equityCurve.push({ at: now, value: result.equity });
    if (current.equityCurve.length > 2000) current.equityCurve = current.equityCurve.slice(-2000);
    result.events = current.events.slice(-12);
    persist();
    return result;
  }

  async function openPosition({ auto, strategy, price, stakeUsd, now, result }) {
    const action = {
      type: strategy.kind === 'dca' ? 'BUY' : (auto.venue === 'perp-velocity' ? 'FUTURES' : 'BUY'),
      venue: auto.venue || strategy.venue || null,
      from: 'USDC',
      to: auto.asset,
      asset: auto.asset,
      chainId: auto.chainId,
      side: auto.side,
      leverage: auto.leverage,
      amountUsd: stakeUsd,
      automationId: auto.id,
      strategyId: auto.strategyId
    };

    if (current.mode === AUTONOMY_MODES.ARMED) {
      /* ARMED never touches a wallet. The loop hands the chat a run to confirm;
         the confirmation gate and the venue executors do the rest. */
      current.pendingRuns.push({
        id: nextId('run'),
        automationId: auto.id,
        strategyId: auto.strategyId,
        action,
        price,
        createdAt: now,
        reason: 'ENTRY_SIGNAL'
      });
      result.pending.push(current.pendingRuns[current.pendingRuns.length - 1]);
      log({ type: 'PENDING_RUN', automationId: auto.id, asset: auto.asset, stakeUsd, price });
      return { opened: false };
    }

    let receipt = null;
    if (current.mode === AUTONOMY_MODES.LIVE) {
      if (typeof execute !== 'function') {
        log({ type: 'EXECUTOR_MISSING', automationId: auto.id });
        result.events = current.events.slice(-12);
        return { opened: false };
      }
      try {
        const res = await execute(action, { mode: current.mode, automationId: auto.id });
        receipt = res || null;
        if (!res || res.success !== true) {
          log({ type: 'EXECUTION_FAILED', automationId: auto.id, code: res?.error?.code || res?.status || 'UNKNOWN' });
          result.events = current.events.slice(-12);
          return { opened: false };
        }
      } catch (err) {
        log({ type: 'EXECUTION_ERROR', automationId: auto.id, detail: String(err?.message || '').slice(0, 140) });
        result.events = current.events.slice(-12);
        return { opened: false };
      }
    }

    const feePct = Number(strategy.feePct ?? 0.3) + Number(strategy.slippagePct ?? 0.1);
    const effectiveUsd = stakeUsd * (1 - feePct / 100);
    const position = {
      id: nextId('pos'),
      automationId: auto.id,
      strategyId: auto.strategyId,
      strategy,
      asset: auto.asset,
      venue: auto.venue || strategy.venue || null,
      entryPrice: price,
      lastPrice: price,
      units: effectiveUsd / price,
      stakeUsd,
      leverage: auto.leverage,
      side: auto.side,
      timeframeMinutes: Number(strategy.timeframeMinutes) || 60,
      stoplossPct: auto.stoplossPct != null ? auto.stoplossPct : (strategy.stoplossPct ?? null),
      takeProfitPct: auto.takeProfitPct != null ? auto.takeProfitPct : (strategy.takeProfitPct ?? null),
      roi: strategy.roi || null,
      trailing: strategy.trailing || null,
      trailingStopPct: null,
      openedAt: now,
      mode: current.mode,
      txHash: receipt?.txHash || null,
      paper: current.mode === AUTONOMY_MODES.PAPER
    };
    current.positions.push(position);
    current.cash -= stakeUsd;
    auto.runs += 1;
    auto.lastRunAt = now;
    result.fills.push({ ...position, kind: 'OPEN', price, stakeUsd });
    log({ type: 'OPENED', positionId: position.id, asset: position.asset, price, stakeUsd, mode: current.mode });
    return { opened: true, position };
  }

  async function closePosition({ pos, price, now, reason, result }) {
    const action = {
      type: pos.venue === 'perp-velocity' ? 'CLOSE_POSITION' : 'SELL',
      venue: pos.venue,
      from: pos.asset,
      to: 'USDC',
      asset: pos.asset,
      chainId: pos.chainId ?? null,
      amount: pos.units,
      amountUsd: pos.units * price,
      automationId: pos.automationId,
      strategyId: pos.strategyId
    };

    let receipt = null;
    if (current.mode === AUTONOMY_MODES.ARMED) {
      current.pendingRuns.push({
        id: nextId('run'),
        automationId: pos.automationId,
        strategyId: pos.strategyId,
        action,
        price,
        createdAt: now,
        reason
      });
      result.pending.push(current.pendingRuns[current.pendingRuns.length - 1]);
      log({ type: 'PENDING_RUN', positionId: pos.id, reason, price });
      return { closed: false };
    }
    if (current.mode === AUTONOMY_MODES.LIVE) {
      if (typeof execute !== 'function') {
        log({ type: 'EXECUTOR_MISSING', positionId: pos.id });
        return { closed: false };
      }
      try {
        const res = await execute(action, { mode: current.mode, positionId: pos.id });
        if (!res || res.success !== true) {
          /* An exit that could not be executed is left OPEN on purpose: closing
             it on paper while the chain still holds it would be the worst kind
             of lie this engine could tell. */
          log({ type: 'EXIT_FAILED', positionId: pos.id, reason, code: res?.error?.code || res?.status || 'UNKNOWN' });
          return { closed: false };
        }
        receipt = res;
      } catch (err) {
        log({ type: 'EXIT_ERROR', positionId: pos.id, detail: String(err?.message || '').slice(0, 140) });
        return { closed: false };
      }
    }

    const feePct = Number(pos.strategy?.feePct ?? 0.3) + Number(pos.strategy?.slippagePct ?? 0.1);
    const gross = pos.units * price;
    const net = gross * (1 - feePct / 100);
    const netUsd = net - pos.stakeUsd;
    current.cash += net;
    current.positions = current.positions.filter((p) => p.id !== pos.id);
    const closed = {
      ...pos,
      kind: 'CLOSE',
      exitPrice: price,
      exitAt: now,
      netUsd,
      netPct: (netUsd / pos.stakeUsd) * 100,
      reason,
      heldMinutes: (now - pos.openedAt) / MINUTE,
      txHash: receipt?.txHash || pos.txHash || null
    };
    current.realizedUsd = Number(current.realizedUsd || 0) + netUsd;
    current.closedTrades.push({
      positionId: pos.id,
      automationId: pos.automationId,
      strategyId: pos.strategyId,
      asset: pos.asset,
      entryPrice: pos.entryPrice,
      exitPrice: price,
      openedAt: pos.openedAt,
      exitAt: now,
      stakeUsd: pos.stakeUsd,
      netUsd,
      netPct: closed.netPct,
      reason,
      paper: pos.paper
    });
    if (current.closedTrades.length > 500) current.closedTrades = current.closedTrades.slice(-500);
    result.exits.push(closed);
    log({ type: 'CLOSED', positionId: pos.id, asset: pos.asset, reason, netUsd, price });
    return { closed: true, netUsd };
  }

  /** The ARMED queue is drained by the chat after the user signs. */
  function resolvePendingRun(id, { executed = false, txHash = null } = {}) {
    const idx = current.pendingRuns.findIndex((r) => r.id === id);
    if (idx < 0) return { ok: false, code: 'NOT_FOUND' };
    const [run] = current.pendingRuns.splice(idx, 1);
    log({ type: executed ? 'RUN_EXECUTED' : 'RUN_DECLINED', runId: id, txHash });
    persist();
    return { ok: true, run, executed };
  }

  /* ── reporting: the chat's /status and /profit ───────────────────────── */

  function status({ prices = {} } = {}) {
    const mark = (p) => p.units * Number(prices[p.asset] ?? p.lastPrice ?? p.entryPrice);
    const openValue = current.positions.reduce((s, p) => s + mark(p), 0);
    const equity = current.cash + openValue;
    return {
      schema: AUTONOMY_SCHEMA,
      mode: current.mode,
      running: current.running,
      startedAt: current.startedAt,
      automations: current.automations.map((a) => ({
        id: a.id,
        strategyId: a.strategyId,
        strategyTitle: a.strategyTitle,
        asset: a.asset,
        stakeUsd: a.stakeUsd,
        active: a.active,
        runs: a.runs,
        realizedUsd: a.realizedUsd,
        cooldownUntil: a.cooldownUntil,
        mode: a.mode
      })),
      positions: current.positions.map((p) => ({
        id: p.id,
        asset: p.asset,
        strategyId: p.strategyId,
        entryPrice: p.entryPrice,
        lastPrice: Number(prices[p.asset] ?? p.lastPrice ?? p.entryPrice),
        stakeUsd: p.stakeUsd,
        valueUsd: mark(p),
        pnlUsd: mark(p) - p.stakeUsd,
        pnlPct: ((mark(p) - p.stakeUsd) / p.stakeUsd) * 100,
        openedAt: p.openedAt,
        stoplossPct: p.stoplossPct,
        takeProfitPct: p.takeProfitPct,
        paper: p.paper
      })),
      pendingRuns: current.pendingRuns.length,
      cash: current.cash,
      openValue,
      equity,
      protections: { ...current.protections },
      lastEvents: current.events.slice(-8)
    };
  }

  function profit() {
    const closed = current.closedTrades;
    const wins = closed.filter((t) => t.netUsd > 0);
    const losses = closed.filter((t) => t.netUsd <= 0);
    const grossWin = wins.reduce((a, t) => a + t.netUsd, 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netUsd, 0));
    const unrealised = current.positions.reduce((a, p) => a + (p.units * (p.lastPrice ?? p.entryPrice) - p.stakeUsd), 0);
    return {
      schema: AUTONOMY_SCHEMA,
      mode: current.mode,
      closedTrades: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRatePct: closed.length ? (wins.length / closed.length) * 100 : null,
      realizedUsd: current.realizedUsd,
      unrealisedUsd: unrealised,
      totalUsd: Number(current.realizedUsd || 0) + unrealised,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
      maxDrawdownPct: current.protections.drawdownPct ?? 0,
      dailyLossPct: current.protections.dailyLossPct ?? 0,
      haltedUntil: current.protections.haltedUntil || null,
      haltReason: current.protections.haltReason || null,
      /* Said out loud in every report: a PAPER number is a simulation of fills
         at real prices, not money earned. */
      paper: current.mode === AUTONOMY_MODES.PAPER
    };
  }

  function snapshot() { return JSON.parse(JSON.stringify(current)); }
  function restore(next) { if (next && typeof next === 'object') current = JSON.parse(JSON.stringify(next)); return { ok: true }; }
  function reset({ startingCash = 1000 } = {}) { current = freshState(current.mode, startingCash); persist(); return { ok: true }; }

  return {
    schema: AUTONOMY_SCHEMA,
    arm, disarm, setMode, start, stop, tick, status, profit, snapshot, restore, reset,
    resolvePendingRun,
    get state() { return current; },
    get rules() { return rules; }
  };
}

function freshState(mode, startingCash = 1000) {
  return {
    schema: AUTONOMY_SCHEMA,
    mode,
    running: false,
    startedAt: null,
    cash: Number(startingCash) || 0,
    startingCash: Number(startingCash) || 0,
    automations: [],
    positions: [],
    pendingRuns: [],
    closedTrades: [],
    realizedUsd: 0,
    equityCurve: [],
    events: [],
    protections: {
      haltedUntil: null,
      haltReason: null,
      dailyAnchorAt: null,
      dailyAnchorValue: null,
      dailyLossPct: 0,
      peakEquity: Number(startingCash) || 0,
      drawdownPct: 0,
      stoplossTimes: []
    }
  };
}
