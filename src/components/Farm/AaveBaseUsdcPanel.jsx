import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from '../Sheet';
import InfoBox from '../InfoBox';
import { IconShield, IconSwap } from '../Icons';
import { useWallet } from '../../context/WalletContext';
import { EVM_CHAINS, explorerAddr, explorerTx } from '../../lib/chains';
import {
  AAVE_BASE_SUPPLY_ALLOWLIST, aaveBaseSupplyAllowedFor, aaveBaseWithdrawAllowedFor
} from '../../lib/features';
import { AAVE_BASE_SUPPLY_OPEN_TO_PUBLIC } from '../../lib/farmRolloutMode';
import {
  AAVE_V3_BASE, buildRevokePlan, buildSupplyPlan, buildWithdrawPlan,
  explainRevert, fromUsdcWei, getPosition, getReserveStatus, isAaveBaseUsdcPool,
  verifyAaveReceipt
} from '../../lib/defi/aaveV3Base';
import { localChainLabel } from '../../lib/farmDeFi';
import {
  cancelAaveAction, confirmAaveAction, derivePartialApprovalState, failAaveAction,
  replaceAaveAction, timeoutAaveAction, loadAaveHistoryFor, recordAaveAction
} from '../../lib/defi/aaveV3History';
import {
  buildUnsignedTransaction, simulateUnsignedTransaction
} from '../../lib/preSignSimulation';
import { evaluateExecutionGate, isBlocked } from '../../lib/executionGate';
import {
  executeGuardedStep, simulateGuardedStep, isTransactionReplacement, isTransactionTimeout, isUserRejection
} from '../../lib/defi/guardedExecution';
import { farmErrorLabel, farmErrorText } from '../../lib/defi/farmErrors';
import { withRpcRetry } from '../../lib/defi/rpcRetry.js';
import { loadSplitRouterInfo, routeSupplyPlan } from '../../lib/defi/splitRouter.js';

/*
 * AAVE V3 · BASE · USDC — the in-app supply / withdraw surface.
 * ---------------------------------------------------------------------------
 * This is the ONLY place the adapter is driven from a UI. Everything about the
 * transaction is decided in lib/defi/aaveV3Base.js (amounts, caps, calldata);
 * this file only renders it, asks for a simulation before every signature, and
 * records what happened locally.
 *
 * Two rules this file must not break:
 *   · The sign button stays disabled until the pre-sign simulation ran CLEAN.
 *     A busy RPC is not a clean simulation and must not be dressed up as one.
 *   · Withdraw is reachable whenever there is something to withdraw, even with
 *     the feature flag off. Killing the entry point would strand the funds.
 */

const fmtUsdc = (wei) => (wei == null ? '—' : Number(fromUsdcWei(wei)).toFixed(2));
const fmtUsd = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);

function Row({ label, value, mono = true, dir }) {
  return (
    <div className="farm-metric">
      <span className="faint">{label}</span>
      <span className={mono ? 'mono' : ''} dir={dir ?? 'ltr'}>{value}</span>
    </div>
  );
}

/**
 * The plain-language step list shown before signing. "1. Allow Aave to use
 * exactly X USDC  2. Supply X USDC" — never a hex blob.
 */
function StepList({ steps, t }) {
  if (!steps?.length) return null;
  return (
    <ol className="farm-aave-steps" style={{ margin: '8px 0 0', paddingLeft: 20 }}>
      {steps.map((s, i) => (
        <li key={`${s.kind}-${i}`} style={{ fontSize: 12.6, lineHeight: 1.9 }}>
          {s.description?.amount != null
            ? t(s.description.key, { amount: s.description.amount, symbol: AAVE_V3_BASE.usdcSymbol })
            : t(s.description.key, { symbol: AAVE_V3_BASE.usdcSymbol })}
        </li>
      ))}
    </ol>
  );
}

export default function AaveBaseUsdcPanel({ pool }) {
  const { t } = useTranslation();
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('supply'); // 'supply' | 'withdraw'
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState(null);
  const [walletUsdc, setWalletUsdc] = useState(null);
  const [partial, setPartial] = useState(null);
  const [plan, setPlan] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [lastTx, setLastTx] = useState(null);
  const [history, setHistory] = useState([]);
  /* null = no router configured for this chain (or its fee could not be
   * read) → every plan stays direct and fee-less. Fail-open, never fail-dead. */
  const [routerInfo, setRouterInfo] = useState(null);
  const alive = useRef(true);

  const isTarget = isAaveBaseUsdcPool(pool);
  const owner = wallet.address;
  const supplyAllowed = aaveBaseSupplyAllowedFor(owner);
  const hasPosition = (position?.aTokenBalance ?? 0n) > 0n;
  const withdrawAllowed = aaveBaseWithdrawAllowedFor({ owner, hasPosition });

  /* ── read the position + reserve status ─────────────────────────────────── */
  const refresh = useCallback(async () => {
    if (!isTarget || !owner) return;
    /*
     * Local history helps recovery, but is never the source of truth. The
     * position is read from pinned Base contracts even when the wallet is on
     * another network, so an imported wallet can still discover its exit.
     */
    setHistory(loadAaveHistoryFor(owner));
    // Read through the pinned Base RPC even when the signing wallet is on a
    // different chain. Discovery must not depend on local history or the
    // currently selected network; writes still require an explicit switch.
    setBusy('loading');
    try {
      const provider = await wallet.getReadProvider(AAVE_V3_BASE.chainId);
      const [pos, res, rows] = await Promise.all([
        withRpcRetry(() => getPosition(provider, owner, { history: loadAaveHistoryFor(owner) }), { label: 'aave-base position' }).catch(() => null),
        withRpcRetry(() => getReserveStatus(provider), { label: 'aave-base reserve' }).catch(() => null),
        Promise.resolve(loadAaveHistoryFor(owner))
      ]);
      if (!alive.current) return;
      setPosition(pos);
      setStatus(res);
      setHistory(rows);
      const bal = await withRpcRetry(() => walletBalanceOf(provider, owner), { label: 'aave-base wallet' });
      if (!alive.current) return;
      setWalletUsdc(bal);
      const rinfo = await withRpcRetry(
        () => loadSplitRouterInfo(provider, AAVE_V3_BASE.chainId),
        { label: 'aave-base router' }
      ).catch(() => null);
      if (!alive.current) return;
      setRouterInfo(rinfo);
      /* When a router is live the allowance that matters is the ROUTER's —
       * the protocol allowance is no longer the spender that will pull. */
      const allowance = await withRpcRetry(
        () => walletAllowanceOf(provider, owner, rinfo?.address),
        { label: 'aave-base allowance' }
      );
      setPartial(derivePartialApprovalState({
        owner,
        allowanceUsdcWei: allowance ?? 0n,
        positionUsdcWei: pos?.aTokenBalance ?? 0n
      }));
    } catch {
      /* a failed read leaves the previous state; the UI shows "—" not a guess */
    } finally {
      if (alive.current) setBusy('');
    }
  }, [isTarget, owner, wallet]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { refresh(); }, [refresh]);

  /* ── the amount the user may actually supply ────────────────────────────── */
  const maxSupplyUsdc = useMemo(() => {
    /* No platform caps: the honest ceilings are what the user actually holds
       and the protocol's own reserve supply cap, when Aave reports one. */
    const limits = [];
    if (walletUsdc != null) limits.push(Number(fromUsdcWei(walletUsdc)));
    if (status?.supplyCapUsdc != null && status.currentSuppliedUsdc != null) {
      limits.push(Number(fromUsdcWei(status.supplyCapUsdc - status.currentSuppliedUsdc)));
    }
    return limits.length ? Math.max(0, Math.min(...limits)) : null;
  }, [status, walletUsdc]);

  const maxWithdrawUsdc = position ? Number(fromUsdcWei(position.suppliedUsdc)) : 0;

  /* ── build the plan whenever the amount changes ─────────────────────────── */
  const buildPlan = useCallback(async (nextAmount, nextMode) => {
    setSimulation(null);
    setPlan(null);
    if (!owner || !(Number(nextAmount) > 0)) return;
    try {
      const provider = await wallet.getReadProvider(AAVE_V3_BASE.chainId);
      let built = nextMode === 'withdraw'
        ? await buildWithdrawPlan({ provider, owner, amountUsdc: nextAmount })
        : await buildSupplyPlan({
            provider, owner, amountUsdc: nextAmount,
            history: loadAaveHistoryFor(owner),
            nativeBalance: wallet.nativeBalance == null
              ? null
              : await toWei(wallet.nativeBalance)
          });
      /*
       * SPLIT ROUTER — the fee-on-deposit seam. ONLY supply plans, NEVER
       * withdrawals: an exit stays exactly as direct as it is today.
       * routeSupplyPlan returns the SAME plan (same reference, fee-less,
       * direct) unless a router is configured for this chain, its feeBps
       * was read on-chain and the plan's steps match exactly what it can
       * rewrite — every other case fails open to the direct deposit.
       */
      if (nextMode !== 'withdraw' && Array.isArray(built?.steps) && built.steps.length > 0) {
        const rinfo = await loadSplitRouterInfo(provider, AAVE_V3_BASE.chainId);
        if (rinfo) {
          const routerAllowanceWei = await walletAllowanceOf(provider, owner, rinfo.address);
          built = routeSupplyPlan(built, {
            chainId: AAVE_V3_BASE.chainId,
            protocolId: 'aave-base',
            feeBps: rinfo.feeBps,
            routerAllowanceWei,
            asset: AAVE_V3_BASE.usdc
          });
        }
      }
      if (!alive.current) return;
      setPlan(built);
    } catch (err) {
      if (alive.current) setError(farmErrorText(err, t, explainRevert(err)));
    }
  }, [owner, wallet, t]);

  useEffect(() => {
    if (!open || mode === 'revoke') return undefined;
    const id = setTimeout(() => buildPlan(amount, mode), 350);
    return () => clearTimeout(id);
  }, [amount, mode, open, buildPlan]);

  /* ── simulate the FIRST step; every signature needs a clean simulation ──── */
  useEffect(() => {
    let cancelled = false;
    const step = plan?.steps?.[0];
    if (!step || !owner) { setSimulation(null); return undefined; }
    setSimulating(true);
    (async () => {
      try {
        const provider = await wallet.getReadProvider(AAVE_V3_BASE.chainId);
        const tx = buildUnsignedTransaction({ from: owner, to: step.to, data: step.data, value: 0n });
        const outcome = await simulateUnsignedTransaction({
          provider,
          tx,
          allowance: step.kind === 'supply'
            ? { token: AAVE_V3_BASE.usdc, owner, spender: plan.checks.splitRouter?.address ?? AAVE_V3_BASE.pool, amountWei: plan.checks.amountWei ?? 0n }
            : undefined
        });
        if (!cancelled) {
          setSimulation(outcome.status === 'revert-detected'
            ? { ...outcome, revert: explainRevert({ reason: outcome.revertReason, message: outcome.revertReason }) }
            : outcome);
        }
      } catch {
        if (!cancelled) setSimulation({ status: 'provider-busy', revertReason: null });
      } finally {
        if (!cancelled) setSimulating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [plan, owner, wallet]);

  const gate = useMemo(() => evaluateExecutionGate({
    // USDC on a verified Aave deployment: no token-risk scan is run here, so
    // the gate keys off the simulation. An absent simulation is a warning, not
    // a pass — see lib/executionGate.js.
    simulation: simulation ?? { status: 'unknown' },
    acknowledgedHigh: true
  }), [simulation]);

  const blockedByPlan = (plan?.checks?.blocked?.length ?? 0) > 0;
  const canSign = Boolean(plan?.steps?.length)
    && simulation?.status === 'simulated-clean'
    && !isBlocked(gate)
    && !busy;

  /* ── execute: re-check context, sign, mine, prove event + position ──────── */
  const execute = useCallback(async () => {
    const signer = wallet.getSigner?.();
    if (!signer || !plan?.steps?.length) return;
    setBusy('signing');
    setError(null);
    let provider;
    try {
      provider = await wallet.getReadProvider(AAVE_V3_BASE.chainId);
      for (let i = 0; i < plan.steps.length; i += 1) {
        const step = plan.steps[i];
        const record = recordAaveAction({
          action: step.kind,
          owner,
          chainId: AAVE_V3_BASE.chainId,
          amountUsdcWei: plan.checks.amountWei == null ? null : String(plan.checks.amountWei),
          amountUsdc: plan.checks.amountUsdc ?? null,
          status: 'pending'
        });
        try {
          await simulateGuardedStep({
            provider,
            owner,
            step,
            allowance: step.kind === 'supply'
              ? { token: AAVE_V3_BASE.usdc, owner, spender: plan.checks.splitRouter?.address ?? AAVE_V3_BASE.pool, amountWei: plan.checks.amountWei ?? 0n }
              : undefined
          });
          const before = step.kind === 'supply' || step.kind === 'withdraw'
            ? await getPosition(provider, owner)
            : null;
          const result = await executeGuardedStep({
            signer, provider, owner, chainId: AAVE_V3_BASE.chainId, step,
            verifyReceipt: ({ receipt }) => verifyAaveReceipt({
              provider, receipt, owner, action: step.kind,
              amountWei: plan.checks.amountWei,
              beforePositionWei: before?.aTokenBalance ?? null,
              /* Present only on routed supply plans — makes the receipt
               * proof demand the Routed event + net-amount protocol credit. */
              splitRouter: plan.checks.splitRouter ?? null
            })
          });
          confirmAaveAction(record.id, {
            txHash: result.receipt?.hash ?? result.tx.hash,
            blockNumber: result.receipt?.blockNumber ?? null
          });
          setLastTx({ hash: result.receipt?.hash ?? result.tx.hash, kind: step.kind });
        } catch (err) {
          const explained = explainRevert(err);
          if (isUserRejection(err)) cancelAaveAction(record.id, 'USER_REJECTED');
          else if (isTransactionTimeout(err)) timeoutAaveAction(record.id);
          else if (isTransactionReplacement(err)) replaceAaveAction(record.id, {
            error: err?.code ?? 'TRANSACTION_REPLACED',
            txHash: err?.replacement?.hash ?? err?.receipt?.hash ?? null
          });
          else failAaveAction(record.id, {
            error: err?.code ?? explained.reason ?? err?.message ?? 'FAILED',
            revertKey: explained.key
          });
          const label = isUserRejection(err)
            ? t('farm.aave.userRejected', { defaultValue: 'Signature rejected' })
            : isTransactionTimeout(err)
              ? t('farm.aave.timeout', { defaultValue: 'Transaction is still pending; check the wallet or explorer.' })
              : isTransactionReplacement(err)
                ? t('farm.aave.replaced', { defaultValue: 'Transaction was replaced or cancelled.' })
                : (explained.key ? t(explained.key) : farmErrorLabel(err, t));
          setError(label);
          setBusy('');
          await refresh();
          return;
        }
      }
    } catch (err) {
      setError(farmErrorLabel(err, t));
    }
    setBusy('');
    setOpen(false);
    setAmount('');
    await refresh();
  }, [owner, plan, refresh, t, wallet]);

  const revoke = useCallback(async () => {
    const signer = wallet.getSigner?.();
    if (!signer) return;
    setBusy('revoking');
    setError(null);
    try {
      const provider = await wallet.getReadProvider(AAVE_V3_BASE.chainId);
      /* When a router is live, the standing allowance the user may want to
         kill is the ROUTER's — that is what the sheet shows and what a revoke
         must actually revoke. */
      const { steps } = await buildRevokePlan({ provider, owner, spender: routerInfo?.address ?? null });
      await simulateGuardedStep({ provider, owner, step: steps[0] });
      const result = await executeGuardedStep({
        signer, provider, owner, chainId: AAVE_V3_BASE.chainId, step: steps[0],
        verifyReceipt: ({ receipt }) => verifyAaveReceipt({
          provider, receipt, owner, action: 'revoke', amountWei: 0n, expectedSpender: routerInfo?.address ?? undefined
        })
      });
      recordAaveAction({
        action: 'revoke', owner, chainId: AAVE_V3_BASE.chainId, amountUsdcWei: '0',
        txHash: result.receipt?.hash ?? result.tx.hash,
        blockNumber: result.receipt?.blockNumber ?? null, status: 'confirmed'
      });
      setPartial({ needed: false, allowanceUsdcWei: 0n, source: null, lastApprove: null });
    } catch (err) {
      const explained = explainRevert(err);
      setError(isUserRejection(err)
        ? t('farm.aave.userRejected', { defaultValue: 'Signature rejected' })
        : isTransactionTimeout(err)
          ? t('farm.aave.timeout', { defaultValue: 'Transaction is still pending; check the wallet or explorer.' })
          : (explained.key ? t(explained.key) : farmErrorLabel(err, t)));
    } finally {
      setBusy('');
      await refresh();
    }
  }, [owner, refresh, t, wallet]);

  if (!isTarget) return null;
  const wrongChain = wallet.isConnected && wallet.chainId !== AAVE_V3_BASE.chainId;
  /*
   * Kill switch. With the flag off, supply is gone — and if there is also no
   * position to withdraw, there is nothing left for this panel to say, so it
   * renders nothing rather than an empty card. A position still renders: the
   * withdrawal path is never gated.
   */
  /* On another network, a directly read position (or a recovery record) keeps
     the card visible and asks for an explicit switch before any signature. */
  const knownHere = wrongChain && (hasPosition || history.some(
    (r) => r.action === 'supply' && (r.status === 'confirmed' || r.status === 'pending')
  ));
    /*
   * Visibility, not permission. In a public-open build the entry point is
   * shown to EVERY visitor — including one with no wallet connected yet, who
   * is exactly the person the rollout is meant to reach. Nothing here widens
   * what a wallet may sign: the buttons below still read supplyAllowed, which
   * needs a connected owner.
   */
  if (!supplyAllowed && !hasPosition && !knownHere && !AAVE_BASE_SUPPLY_OPEN_TO_PUBLIC) return null;

  const openSheet = (nextMode) => {
    setMode(nextMode);
    setAmount('');
    setError(null);
    setPlan(null);
    setSimulation(null);
    setOpen(true);
  };

  return (
    <section className="card card-soft farm-aave-panel" aria-label={t('farm.aave.panelTitle')}>
      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.4 }}>
            <span style={{ verticalAlign: '-4px', marginRight: 6 }}><IconShield width={16} height={16} /></span>
            {t('farm.aave.panelTitle')}
          </div>
          <div className="muted" style={{ fontSize: 11.6, margin: '3px 0 0' }}>
            {t('farm.aave.panelSub', { chain: localChainLabel(EVM_CHAINS[AAVE_V3_BASE.chainId].name, t), symbol: AAVE_V3_BASE.usdcSymbol })}
          </div>
        </div>
        {status?.supplyApyPct != null && (
          <span className="pill pill-neutral mono" dir="ltr">{status.supplyApyPct.toFixed(2)}% {t('farm.aave.apy')}</span>
        )}
      </div>

      {/* ── position ─────────────────────────────────────────────────────── */}
      {hasPosition && (
        <div className="farm-economics" style={{ marginTop: 10 }}>
          <Row label={t('farm.aave.supplied')} value={`${fmtUsdc(position.suppliedUsdc)} ${AAVE_V3_BASE.usdcSymbol}`} />
          <Row label={t('farm.aave.usdValue')} value={fmtUsd(position.suppliedUsd)} />
          <Row label={t('farm.aave.apy')} value={status?.supplyApyPct == null ? '—' : `${status.supplyApyPct.toFixed(2)}%`} />
          <Row label={t('farm.aave.accrued')} value={position.accruedSinceUsdc == null ? '—' : `${fmtUsdc(position.accruedSinceUsdc)} ${AAVE_V3_BASE.usdcSymbol}`} />
          {/* Read honestly: there is no debt in this flow, so the health factor
              is "—" rather than a reassuring number. */}
          <Row label={t('farm.aave.healthFactor')} value={position.healthFactor == null ? '—' : String(position.healthFactor)} />
        </div>
      )}

      {knownHere && (
        <p className="muted" style={{ fontSize: 11.6, margin: '10px 0 0' }}>
          {t('farm.aave.wrongChainNote', { chain: localChainLabel(EVM_CHAINS[AAVE_V3_BASE.chainId].name, t) })}
        </p>
      )}

      {/* ── stuck allowance ──────────────────────────────────────────────── */}
      {partial?.needed && (
        <div className="notice notice-danger" style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 6px' }}>
            {t('farm.aave.partialBody', { amount: fmtUsdc(partial.allowanceUsdcWei), symbol: AAVE_V3_BASE.usdcSymbol })}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => openSheet('supply')}>
              {t('farm.aave.continue')}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy === 'revoking'} onClick={revoke}>
              {busy === 'revoking' ? t('farm.aave.working') : t('farm.aave.revoke')}
            </button>
          </div>
        </div>
      )}

      {/* ── actions ──────────────────────────────────────────────────────── */}
      <div className="farm-actions" style={{ marginTop: 10 }}>
        {!wallet.isConnected && <span className="faint">{t('farm.aave.connectFirst')}</span>}
        {wrongChain && (
          <button className="btn btn-ghost farm-btn" onClick={() => wallet.switchChain(AAVE_V3_BASE.chainId)}>
            {t('farm.aave.switchChain', { chain: localChainLabel(EVM_CHAINS[AAVE_V3_BASE.chainId].name, t) })}
          </button>
        )}
        {wallet.isConnected && !wrongChain && supplyAllowed && (
          <button className="btn btn-primary farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('supply')}>
            <IconSwap width={15} height={15} /> {t('farm.aave.supplyInApp')}
          </button>
        )}
        {wallet.isConnected && !wrongChain && withdrawAllowed && (
          <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('withdraw')}>
            {t('farm.aave.withdraw')}
          </button>
        )}
        <a
          className="btn btn-ghost farm-btn farm-btn-minor"
          href={explorerAddr(AAVE_V3_BASE.chainId, AAVE_V3_BASE.pool)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('farm.aave.explorer')}
        </a>
      </div>

      {/* A canary build says so: in a public build this line is absent and
          every connected wallet may supply any amount its balance allows. */}
      {supplyAllowed && !AAVE_BASE_SUPPLY_OPEN_TO_PUBLIC && AAVE_BASE_SUPPLY_ALLOWLIST.length > 0 && (
        <p className="faint" style={{ margin: '8px 0 0', fontSize: 11.4 }}>
          {t('farm.aave.allowlisted')}
        </p>
      )}

      <Sheet open={open} onClose={() => { if (!busy) setOpen(false); }} title={mode === 'withdraw' ? t('farm.aave.withdrawTitle') : t('farm.aave.supplyTitle')} size="md">
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              className="farm-amt-input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0.00"
              aria-label={t('farm.aave.amount')}
              style={{ flex: 1 }}
            />
            <span className="mono">{AAVE_V3_BASE.usdcSymbol}</span>
            <button
              className="tag"
              type="button"
              disabled={mode !== 'withdraw' && maxSupplyUsdc == null}
              onClick={() => setAmount(String(Math.floor((mode === 'withdraw' ? maxWithdrawUsdc : (maxSupplyUsdc ?? 0)) * 1e6) / 1e6))}
            >
              {t('farm.aave.max')}
            </button>
          </div>

          <p className="faint" style={{ margin: 0, fontSize: 11.8 }}>
            {mode === 'withdraw'
              ? t('farm.aave.withdrawMaxHint', { amount: fmtUsd(maxWithdrawUsdc) })
              : t('farm.aave.maxHint', {
                  amount: fmtUsd(maxSupplyUsdc),
                  wallet: walletUsdc == null ? '—' : fmtUsdc(walletUsdc),
                  apy: status?.supplyApyPct == null ? '—' : `${status.supplyApyPct.toFixed(2)}%`
                })}
          </p>

          {/* Plain-language step list BEFORE any signature. */}
          <StepList steps={plan?.steps} t={t} />

          {/* THE FEE, disclosed before the signature — not in a receipt.
              Rendered only when this plan is actually routed; a direct
              deposit shows nothing, because it charges nothing. */}
          {plan?.checks?.splitRouter && (
            <p className="notice" style={{ margin: '8px 0 0' }}>
              {t('farm.splitRouter.feeNotice', {
                pct: (Number(plan.checks.splitRouter.feeBps ?? 0n) / 100).toString(),
                fee: fromUsdcWei(plan.checks.splitRouter.feeAmount ?? 0n),
                net: fromUsdcWei(plan.checks.splitRouter.netAmount ?? 0n),
                total: plan.checks.amountUsdc ?? '—',
                symbol: AAVE_V3_BASE.usdcSymbol
              })}
              <br />
              <span className="faint">{t('farm.splitRouter.trustNote')}</span>
            </p>
          )}

          {/* Checks the plan refused, in words. */}
          {blockedByPlan && (
            <p className="notice notice-danger" style={{ margin: 0 }}>
              {plan.checks.blocked.map((code) => t(`farm.aave.block.${code}`, { defaultValue: code })).join(' · ')}
            </p>
          )}

          {/* Simulation result, shown before every signature. */}
          {simulating && <p className="faint" style={{ margin: 0 }}>{t('farm.aave.simulating')}</p>}
          {simulation?.status === 'simulated-clean' && (
            <p className="notice" style={{ margin: 0 }}>{t('farm.aave.simClean')}</p>
          )}
          {simulation?.status === 'revert-detected' && (
            <p className="notice notice-danger" style={{ margin: 0 }}>
              {t('farm.aave.simRevert')}: {simulation.revert?.key ? t(simulation.revert.key) : (simulation.revertReason ?? '—')}
            </p>
          )}
          {simulation?.status === 'provider-busy' && (
            <p className="notice notice-danger" style={{ margin: 0 }}>{t('farm.aave.simBusy')}</p>
          )}
          {simulation?.status === 'unknown' && plan?.steps?.length > 0 && (
            <p className="notice" style={{ margin: 0 }}>{t('farm.aave.simNotRun')}</p>
          )}

          {error && <p className="notice notice-danger" style={{ margin: 0 }}>{error}</p>}

          {lastTx && (
            <a className="faint" href={explorerTx(AAVE_V3_BASE.chainId, lastTx.hash)} target="_blank" rel="noopener noreferrer" dir="ltr">
              {t('farm.aave.viewTx')}
            </a>
          )}

          <div className="farm-actions">
            <button className="btn btn-primary farm-btn" disabled={!canSign} onClick={execute}>
              {busy === 'signing' ? t('farm.aave.working') : (mode === 'withdraw' ? t('farm.aave.withdraw') : t('farm.aave.supplyInApp'))}
            </button>
            <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>

          {history.length > 0 && (
            <div>
              <p className="section-label" style={{ margin: '6px 0 4px' }}>{t('farm.aave.recentTitle')}</p>
              {history.slice(0, 5).map((r) => (
                <div key={r.id} className="farm-metric">
                  <span className="faint">
                    {t(`farm.aave.action.${r.action}`)} · {r.amountUsdc != null ? `${r.amountUsdc} ${AAVE_V3_BASE.usdcSymbol}` : '—'} · {new Date(r.at).toLocaleString()}
                  </span>
                  <span className="mono">{t(`farm.aave.status.${r.status}`)}</span>
                </div>
              ))}
            </div>
          )}

          <InfoBox title={t('farm.aave.riskTitle')} tone="warning" defaultOpen id="farm-aave-risk">
            <p>{t('farm.aave.risk1')}</p>
            <p>{t('farm.aave.risk2')}</p>
            <p>{t('farm.aave.risk3')}</p>
            <p>{t('farm.aave.risk4')}</p>
          </InfoBox>
        </div>
      </Sheet>
    </section>
  );
}

/* ── tiny read helpers (kept here so the adapter stays provider-shape free) ── */
async function walletBalanceOf(provider, owner) {
  const { Contract } = await import('ethers');
  const c = new Contract(AAVE_V3_BASE.usdc, ['function balanceOf(address) view returns (uint256)'], provider);
  try {
    return await c.balanceOf(owner);
  } catch {
    return null;
  }
}

async function walletAllowanceOf(provider, owner, spender = null) {
  const { Contract } = await import('ethers');
  const c = new Contract(AAVE_V3_BASE.usdc, ['function allowance(address,address) view returns (uint256)'], provider);
  try {
    return await c.allowance(owner, spender ?? AAVE_V3_BASE.pool);
  } catch {
    return 0n;
  }
}

async function toWei(eth) {
  const { parseUnits } = await import('ethers');
  try {
    return parseUnits(String(eth), 18);
  } catch {
    return null;
  }
}
