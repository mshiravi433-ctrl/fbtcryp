import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  LOOP_DEFAULTS,
  liquidationDropPct,
  simulateLoop
} from '../lib/loopMath.js';
import { buildPositionPreview, compareLoopPosition } from '../lib/loopPreview.js';
import { loopExecutionGate, readLoopFeatureFlags } from '../lib/loopFeatureFlags.js';
import { buildLiveLoopPlan, LOOP_PLAN_DEFAULTS } from '../lib/loopPlan.js';
import { LOOP_RUN_STATE } from '../lib/loopExecution.js';
import AssetIcon from './AssetIcon';
import LoopFold from './loop/LoopFold.jsx';
import LoopPlanner from './loop/LoopPlanner.jsx';
import LoopRunner from './loop/LoopRunner.jsx';
import LoopCalculator from './loop/LoopCalculator.jsx';
import LoopPosition from './loop/LoopPosition.jsx';
import { useLoopRun, LOOP_QUOTE_MAX_AGE_MS } from './loop/useLoopRun.js';
import { formatFactor, formatMultiple, hfTone, tr } from './loop/loopFormat.js';
import '../styles/loan-loop.css';

const OPEN_KEY = 'fbt.loan.loop.open';
const COLLATERAL_PREFERENCE = ['USDC', 'USDT', 'DAI', 'USDC.E', 'USDBC', 'WETH', 'ETH'];
const BORROW_PREFERENCE = ['USDT', 'USDC', 'DAI', 'USDC.E', 'USDBC'];

const readOpen = (fallback) => {
  try {
    const stored = globalThis.localStorage?.getItem(OPEN_KEY);
    return stored == null ? fallback : stored === '1';
  } catch { return fallback; }
};
const writeOpen = (open) => {
  try { globalThis.localStorage?.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* private mode */ }
};

const rank = (list, symbol) => {
  const i = list.indexOf(String(symbol || '').toUpperCase());
  return i === -1 ? list.length : i;
};

/**
 * Sensible starting pair — the loop with the least PRICE risk:
 *   1. a stable collateral the market accepts;
 *   2. a different stable to borrow (USDC ⇄ USDT);
 *   3. else the same asset (no swap, no price exposure — its usually negative
 *      carry is shown, not hidden);
 *   4. only then anything else that can be borrowed.
 * A volatile borrow is never the default: borrowing BTC against USDC is a
 * short position, and nobody should open one because it was preselected.
 * Reserve flags are honoured once they are read; before that, symbols decide.
 */
export function pickDefaultPair(assets = [], reserves = {}) {
  const list = Array.isArray(assets) ? assets : [];
  if (!list.length) return { collateralId: null, borrowId: null };
  const r = (a) => reserves?.[a.id] ?? null;
  const known = (a) => r(a)?.listed != null;
  const canCollateral = (a) => !known(a) || (r(a).listed && Number(r(a).ltvPct) > 0 && r(a).status !== 'paused' && r(a).status !== 'frozen');
  const canBorrow = (a) => !known(a) || (r(a).listed && r(a).borrowingEnabled !== false && r(a).status !== 'paused' && r(a).status !== 'frozen');
  const isStable = (a) => rank(BORROW_PREFERENCE, a.symbol) < BORROW_PREFERENCE.length;
  const byPref = (pref) => (a, b) => rank(pref, a.symbol) - rank(pref, b.symbol);
  const collateral = [...list].filter(canCollateral).sort(byPref(COLLATERAL_PREFERENCE))[0] ?? list[0];
  const otherStable = [...list]
    .filter((a) => a.id !== collateral.id && isStable(a) && canBorrow(a))
    .sort(byPref(BORROW_PREFERENCE))[0];
  const borrow = otherStable
    ?? (canBorrow(collateral) ? collateral : null)
    ?? [...list].filter((a) => a.id !== collateral.id && canBorrow(a))[0]
    ?? null;
  return { collateralId: collateral?.id ?? null, borrowId: borrow?.id ?? null };
}

/**
 * COLLATERAL LOOP — one expandable box on the Loan page.
 *
 *   1 · Live plan       real reserves, oracle prices and the user's position
 *   2 · Step execution  one click = one transaction, each re-checked and
 *                       simulated right before its signature
 *   · Your position     the read-only account preview
 *   · Manual calculator the original what-if calculator (typed numbers)
 *
 * The box is closed by default and remembers the user's choice. Closed
 * content stays mounted (inert), so a run in progress keeps its state and its
 * progress is summarised in the header chips.
 */
export default function CollateralLoopPanel({
  t,
  lang = 'en',
  dir = 'ltr',
  account = null,
  dataStatus = 'unavailable',
  readAt = null,
  ageMs = null,
  source = null,
  chainId = null,
  wallet = null,
  isConnected = false,
  supportedChain = false,
  flags = null,
  calculatorEnabled = true,
  staleAfterMs,
  market = null,
  walletChainId = null,
  readOnly = false,
  loopDeps = null,
  swapFeeBps = 70,
  chainName = '',
  explorerTxUrl = null,
  onConnect,
  onSwitchChain,
  onRefresh,
  onStepResult,
  onOpenPositions,
  defaultOpen = false
}) {
  const bodyId = `loop-box-${useId().replace(/:/g, '')}`;
  const [open, setOpen] = useState(() => readOpen(Boolean(defaultOpen)));
  const toggleOpen = () => setOpen((was) => { writeOpen(!was); return !was; });

  /* ── manual calculator (Stage A) ─────────────────────────────────────── */
  const [input, setInput] = useState(() => ({ ...LOOP_DEFAULTS }));
  const projection = useMemo(() => simulateLoop(input), [input]);
  const update = (key, value) => setInput((current) => ({ ...current, [key]: value }));

  /* ── position preview (Stage B) ──────────────────────────────────────── */
  const preview = useMemo(() => buildPositionPreview({
    account, dataStatus, readAt, ageMs, source, staleAfterMs
  }), [account, dataStatus, readAt, ageMs, source, staleAfterMs]);
  const positionAccount = preview.account ? { ok: true, ...preview.account } : null;
  const positionComparison = useMemo(() => compareLoopPosition({
    account: positionAccount,
    intendedCollateralUsd: input.collateralUsd,
    ltvPct: input.ltvPct
  }), [positionAccount, input.collateralUsd, input.ltvPct]);
  const positionDrop = liquidationDropPct(preview.account?.healthFactor);
  const usePosition = () => {
    if (preview.account?.totalCollateralUsd != null) update('startingCollateralUsd', String(preview.account.totalCollateralUsd));
    if (preview.account?.totalDebtUsd != null) update('startingDebtUsd', String(preview.account.totalDebtUsd));
  };

  /* ── live plan (Stage 1) ─────────────────────────────────────────────── */
  const assets = useMemo(() => (Array.isArray(market?.assets) ? market.assets : []), [market?.assets]);
  const reserves = market?.reserves ?? {};
  const [pair, setPair] = useState({ collateralId: null, borrowId: null });
  const userPicked = useRef(false);
  const [amount, setAmount] = useState('');
  const [settings, setSettings] = useState(() => ({ ...LOOP_PLAN_DEFAULTS }));

  /* A different chain is a different market: start the pair over. */
  useEffect(() => {
    userPicked.current = false;
    setAmount('');
    setPair({ collateralId: null, borrowId: null });
  }, [chainId]);

  useEffect(() => {
    if (!assets.length) return;
    const ids = new Set(assets.map((a) => a.id));
    const stillValid = ids.has(pair.collateralId) && ids.has(pair.borrowId);
    if (userPicked.current && stillValid) return;
    const next = pickDefaultPair(assets, reserves);
    if (next.collateralId !== pair.collateralId || next.borrowId !== pair.borrowId) setPair(next);
  }, [assets, reserves, pair.collateralId, pair.borrowId]);

  const planAccount = isConnected && account?.ok ? account : null;
  const plan = useMemo(() => buildLiveLoopPlan({
    assets,
    reserves,
    prices: market?.prices ?? {},
    positions: isConnected ? market?.positions ?? {} : {},
    account: planAccount,
    userConfiguration: isConnected ? market?.userConfiguration ?? null : null,
    collateralId: pair.collateralId,
    borrowId: pair.borrowId,
    amount,
    settings,
    swapFeeBps
  }), [assets, reserves, market?.prices, market?.positions, market?.userConfiguration, planAccount, isConnected, pair, amount, settings, swapFeeBps]);

  /* ── execution (Stage 2) ─────────────────────────────────────────────── */
  const loopFlags = useMemo(() => flags ?? readLoopFeatureFlags(), [flags]);
  const executionGate = useMemo(() => loopExecutionGate({
    flags: loopFlags,
    chainId,
    wallet: isConnected ? wallet : null,
    supportedChain,
    walletChainId,
    readOnly
  }), [loopFlags, chainId, wallet, isConnected, supportedChain, walletChainId, readOnly]);

  const loopRun = useLoopRun({ deps: loopDeps, chainId, wallet, swapFeeBps, onStepResult });
  const { run, runPlan, busy, active } = loopRun;
  /* A run keeps its plan on screen until the user taps «New loop» — also after
     it completes: re-planning live on top of the position the run just built,
     with the amount that was already supplied, would read as a second loop. */
  const locked = Boolean(run);
  const shownPlan = locked && runPlan ? runPlan : plan;
  const canStart = executionGate.allowed && Boolean(plan.ok) && Boolean(loopDeps) && !busy;

  const startRun = useCallback(() => {
    if (!canStart) return;
    loopRun.start(plan);
  }, [canStart, loopRun, plan]);

  /* After confirmed steps the wallet and the position have changed, so the old
     amount is stale; a run that never sent anything keeps it for a retry. */
  const resetRun = useCallback(() => {
    const hadConfirmed = (run?.completed?.length ?? 0) > 0;
    if (loopRun.reset() && hadConfirmed) setAmount('');
  }, [loopRun, run]);

  const fillCalculatorFromLive = () => {
    const m = plan.market;
    if (!m?.collateral) return;
    setInput((current) => ({
      ...current,
      collateralAsset: m.collateral.symbol,
      borrowAsset: m.borrow?.symbol ?? current.borrowAsset,
      ltvPct: m.ltvPct != null ? String(m.ltvPct) : current.ltvPct,
      liquidationThresholdPct: m.liquidationThresholdPct != null ? String(m.liquidationThresholdPct) : current.liquidationThresholdPct,
      supplyApyPct: m.supplyApyPct != null ? String(Number(m.supplyApyPct.toFixed(3))) : current.supplyApyPct,
      borrowApyPct: m.borrowApyPct != null ? String(Number(m.borrowApyPct.toFixed(3))) : current.borrowApyPct,
      swapCostPct: m.sameAsset ? '0' : String(Number(((Number(swapFeeBps) || 0) / 100 + Number(settings.slippagePct || 0)).toFixed(3))),
      rounds: String(settings.rounds),
      headroomPct: String(settings.headroomPct),
      ...(plan.initialWei && plan.summary?.initialUsd > 0 ? { collateralUsd: String(Number(plan.summary.initialUsd.toFixed(2))) } : {})
    }));
  };

  /* ── header chips ─────────────────────────────────────────────────────── */
  const totalSteps = run?.steps?.length ?? 0;
  const doneSteps = run?.completed?.length ?? 0;
  let headerChips = null;
  if (run) {
    const tone = run.status === LOOP_RUN_STATE.COMPLETED ? 'live'
      : [LOOP_RUN_STATE.FAILED].includes(run.status) ? 'danger'
        : [LOOP_RUN_STATE.PAUSED, LOOP_RUN_STATE.PARTIAL].includes(run.status) ? 'warn'
          : busy ? 'wait' : 'live';
    headerChips = (
      <span className={`loop-chip is-${tone}`} data-testid="loop-box-run-chip">
        <span className="loop-chip-dot" aria-hidden="true" />
        {run.status === LOOP_RUN_STATE.COMPLETED
          ? tr(t, 'loan.loop.exec.status.completed')
          : <bdi dir="ltr">{tr(t, 'loan.loop.box.stepChip', { done: doneSteps, total: totalSteps })}</bdi>}
      </span>
    );
  } else if (plan.ok && plan.summary) {
    headerChips = (
      <>
        <span className="loop-chip is-soft" data-testid="loop-box-leverage-chip"><bdi dir="ltr">{formatMultiple(plan.summary.leverage)}</bdi></span>
        <span className={`loop-chip is-${hfTone(plan.summary.finalHealthFactor) === 'safe' ? 'live' : hfTone(plan.summary.finalHealthFactor) === 'watch' ? 'warn' : 'danger'}`} data-testid="loop-box-hf-chip">
          <bdi dir="ltr">HF {formatFactor(plan.summary.finalHealthFactor)}</bdi>
        </span>
      </>
    );
  } else if (executionGate.allowed || executionGate.reason === 'WALLET_REQUIRED') {
    headerChips = <span className="loop-chip is-live"><span className="loop-chip-dot" aria-hidden="true" />{tr(t, 'loan.loop.box.live')}</span>;
  }

  const collateralSymbol = shownPlan?.market?.collateral?.symbol ?? null;
  const borrowSymbol = shownPlan?.market?.borrow?.symbol ?? null;
  const sameAsset = Boolean(shownPlan?.market?.sameAsset);

  return (
    <section
      className={`loan-loop-shell loop-box${open ? ' is-open' : ''}${active ? ' is-running' : ''}`}
      data-testid="loan-collateral-loop"
      data-open={open ? 'true' : 'false'}
      dir={dir}
      data-dir={dir}
    >
      <button
        type="button"
        className="loop-box-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggleOpen}
        data-testid="loop-box-toggle"
      >
        <span className="loop-box-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3l3 3-3 3" /><path d="M20 6H9a5 5 0 0 0-5 5v1" /><path d="M7 21l-3-3 3-3" /><path d="M4 18h11a5 5 0 0 0 5-5v-1" />
          </svg>
        </span>
        <span className="loop-box-copy">
          <span className="loop-box-title">{tr(t, 'loan.loop.title')}</span>
          <span className="loop-box-sub">{tr(t, 'loan.loop.box.subtitle')}</span>
        </span>
        <span className="loop-box-chips">{headerChips}</span>
        <span className="loop-box-chev" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
        </span>
      </button>

      <div
        className="loop-box-body"
        id={bodyId}
        aria-hidden={open ? undefined : 'true'}
        {...(open ? {} : { inert: '' })}
      >
        <div className="loop-box-inner">
          <div className="loop-box-content">
            {collateralSymbol && borrowSymbol && (
              <div className="loop-flow" data-testid="loop-flow" aria-label={tr(t, 'loan.loop.box.flowLabel')}>
                <span className="loop-flow-node"><AssetIcon symbol={collateralSymbol} size={18} radius={6} className="asset-icon loop-asset-icon" />{tr(t, 'loan.loop.box.flowSupply', { symbol: collateralSymbol })}</span>
                <span className="loop-flow-arrow" aria-hidden="true">→</span>
                <span className="loop-flow-node"><AssetIcon symbol={borrowSymbol} size={18} radius={6} className="asset-icon loop-asset-icon" />{tr(t, 'loan.loop.box.flowBorrow', { symbol: borrowSymbol })}</span>
                {!sameAsset && (
                  <>
                    <span className="loop-flow-arrow" aria-hidden="true">→</span>
                    <span className="loop-flow-node">{tr(t, 'loan.loop.box.flowSwap', { from: borrowSymbol, to: collateralSymbol })}</span>
                  </>
                )}
                <span className="loop-flow-arrow" aria-hidden="true">↺</span>
                <span className="loop-flow-node is-repeat">{tr(t, 'loan.loop.box.flowRepeat', { n: shownPlan?.rows?.length || Number(settings.rounds) || 1 })}</span>
              </div>
            )}

            <p className="loan-loop-disclaimer" data-testid="loop-disclaimer">
              {tr(t, 'loan.loop.box.disclaimer')}
            </p>

            <LoopPlanner
              t={t}
              assets={assets}
              reserves={reserves}
              plan={shownPlan}
              collateralId={locked && runPlan ? runPlan.market?.collateral?.id : pair.collateralId}
              borrowId={locked && runPlan ? runPlan.market?.borrow?.id : pair.borrowId}
              amount={amount}
              settings={settings}
              onCollateral={(id) => { userPicked.current = true; setPair((p) => ({ ...p, collateralId: id })); }}
              onBorrow={(id) => { userPicked.current = true; setPair((p) => ({ ...p, borrowId: id })); }}
              onAmount={setAmount}
              onSettings={setSettings}
              locked={locked}
              lockedNote={active ? 'loan.loop.plan.locked' : 'loan.loop.plan.lockedDone'}
              liveWalletWei={plan.walletWei}
              loading={Boolean(market?.loading)}
              isConnected={isConnected}
              swapFeeBps={swapFeeBps}
            />

            <LoopRunner
              t={t}
              gate={executionGate}
              plan={plan}
              run={run}
              runPlan={runPlan}
              busy={busy}
              quoteMaxAgeMs={LOOP_QUOTE_MAX_AGE_MS}
              canStart={canStart}
              hasDebt={Boolean(preview.status !== 'unavailable' && preview.account?.totalDebtUsd > 0)}
              currentHealthFactor={account?.ok ? account.healthFactor ?? null : null}
              chainName={chainName}
              onStart={startRun}
              onAdvance={loopRun.advance}
              onStop={loopRun.stop}
              onResume={loopRun.resume}
              onReset={resetRun}
              onConnect={onConnect}
              onSwitchChain={onSwitchChain}
              onOpenPositions={onOpenPositions}
              explorerTxUrl={explorerTxUrl}
            />

            <LoopFold
              testId="loop-position-fold"
              title={tr(t, 'loan.loop.box.positionTitle')}
              subtitle={tr(t, 'loan.loop.box.positionSub')}
              badge={preview.account?.healthFactor != null
                ? <span className={`loop-chip is-${hfTone(preview.account.healthFactor) === 'safe' ? 'live' : hfTone(preview.account.healthFactor) === 'watch' ? 'warn' : 'danger'}`}><bdi dir="ltr">HF {formatFactor(preview.account.healthFactor)}</bdi></span>
                : null}
            >
              <LoopPosition
                t={t}
                lang={lang}
                preview={preview}
                positionComparison={positionComparison}
                positionDrop={positionDrop}
                isConnected={isConnected}
                onUsePosition={usePosition}
                onRefresh={onRefresh}
              />
            </LoopFold>

            {calculatorEnabled && (
              <LoopFold
                testId="loop-calculator"
                title={tr(t, 'loan.loop.box.calculatorTitle')}
                subtitle={tr(t, 'loan.loop.box.calculatorSub')}
              >
                <p className="loop-muted">{tr(t, 'loan.loop.disclaimer')}</p>
                <LoopCalculator
                  t={t}
                  input={input}
                  projection={projection}
                  onUpdate={update}
                  onFillLive={fillCalculatorFromLive}
                  canFillLive={Boolean(plan.market?.ok)}
                />
              </LoopFold>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
