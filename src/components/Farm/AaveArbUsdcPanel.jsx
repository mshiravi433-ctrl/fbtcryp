import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from '../Sheet';
import InfoBox from '../InfoBox';
import { IconShield, IconSwap } from '../Icons';
import { useWallet } from '../../context/WalletContext';
import { EVM_CHAINS, explorerAddr, explorerTx } from '../../lib/chains';
import {
  AAVE_ARB_SUPPLY_MAX_USDC_PER_TX, AAVE_ARB_SUPPLY_MAX_USDC_TOTAL,
  AAVE_ARB_SUPPLY_ALLOWLIST, aaveArbSupplyAllowedFor, aaveArbWithdrawAllowedFor
} from '../../lib/features';
import {
  AAVE_V3_ARBITRUM, buildRevokePlan, buildSupplyPlan, buildWithdrawPlan,
  explainRevert, fromUsdcWei, getPosition, getReserveStatus, isAaveArbUsdcPool,
  verifyAaveReceipt
} from '../../lib/defi/aaveV3Arbitrum';
import {
  cancelAaveArbAction, confirmAaveArbAction, derivePartialApprovalState, failAaveArbAction,
  replaceAaveArbAction, timeoutAaveArbAction, loadAaveArbHistoryFor, recordAaveArbAction
} from '../../lib/defi/aaveV3ArbHistory';
import {
  buildUnsignedTransaction, simulateUnsignedTransaction
} from '../../lib/preSignSimulation';
import { evaluateExecutionGate, isBlocked } from '../../lib/executionGate';
import {
  executeGuardedStep, simulateGuardedStep, isTransactionReplacement, isTransactionTimeout, isUserRejection
} from '../../lib/defi/guardedExecution';

/*
 * AAVE V3 · ARBITRUM · USDC — the in-app supply / withdraw surface.
 * ---------------------------------------------------------------------------
 * This is the ONLY place the adapter is driven from a UI. Everything about the
 * transaction is decided in lib/defi/aaveV3Arbitrum.js (amounts, caps, calldata);
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
    <ol className="farm-aavearb-steps" style={{ margin: '8px 0 0', paddingLeft: 20 }}>
      {steps.map((s, i) => (
        <li key={`${s.kind}-${i}`} style={{ fontSize: 12.6, lineHeight: 1.9 }}>
          {s.description?.amount != null
            ? t(s.description.key, { amount: s.description.amount, symbol: AAVE_V3_ARBITRUM.usdcSymbol })
            : t(s.description.key, { symbol: AAVE_V3_ARBITRUM.usdcSymbol })}
        </li>
      ))}
    </ol>
  );
}

export default function AaveArbUsdcPanel({ pool }) {
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
  const alive = useRef(true);

  const isTarget = isAaveArbUsdcPool(pool);
  const owner = wallet.address;
  const supplyAllowed = aaveArbSupplyAllowedFor(owner);
  const hasPosition = (position?.aTokenBalance ?? 0n) > 0n;
  const withdrawAllowed = aaveArbWithdrawAllowedFor({ owner, hasPosition });

  /* ── read the position + reserve status ─────────────────────────────────── */
  const refresh = useCallback(async () => {
    if (!isTarget || !owner) return;
    /*
     * The ledger is a pure localStorage read, so it is safe on any chain — and
     * it is the only way to know this wallet has an Aave position when the
     * wallet itself is sitting on the wrong network. Everything below needs a
     * Base provider, so the chain guard comes after it, not before.
     */
    setHistory(loadAaveArbHistoryFor(owner));
    if (wallet.chainId !== AAVE_V3_ARBITRUM.chainId) return;
    setBusy('loading');
    try {
      const provider = await wallet.getReadProvider(AAVE_V3_ARBITRUM.chainId);
      const [pos, res, rows] = await Promise.all([
        getPosition(provider, owner, { history: loadAaveArbHistoryFor(owner) }).catch(() => null),
        getReserveStatus(provider).catch(() => null),
        Promise.resolve(loadAaveArbHistoryFor(owner))
      ]);
      if (!alive.current) return;
      setPosition(pos);
      setStatus(res);
      setHistory(rows);
      const bal = await walletBalanceOf(provider, owner);
      if (!alive.current) return;
      setWalletUsdc(bal);
      const allowance = await walletAllowanceOf(provider, owner);
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
    const limits = [
      AAVE_ARB_SUPPLY_MAX_USDC_PER_TX,
      AAVE_ARB_SUPPLY_MAX_USDC_TOTAL - (position ? Number(fromUsdcWei(position.suppliedUsdc)) : 0)
    ];
    if (walletUsdc != null) limits.push(Number(fromUsdcWei(walletUsdc)));
    if (status?.supplyCapUsdc != null && status.currentSuppliedUsdc != null) {
      limits.push(Number(fromUsdcWei(status.supplyCapUsdc - status.currentSuppliedUsdc)));
    }
    return Math.max(0, Math.min(...limits));
  }, [position, status, walletUsdc]);

  const maxWithdrawUsdc = position ? Number(fromUsdcWei(position.suppliedUsdc)) : 0;

  /* ── build the plan whenever the amount changes ─────────────────────────── */
  const buildPlan = useCallback(async (nextAmount, nextMode) => {
    setSimulation(null);
    setPlan(null);
    if (!owner || !(Number(nextAmount) > 0)) return;
    try {
      const provider = await wallet.getReadProvider(AAVE_V3_ARBITRUM.chainId);
      const built = nextMode === 'withdraw'
        ? await buildWithdrawPlan({ provider, owner, amountUsdc: nextAmount })
        : await buildSupplyPlan({
            provider, owner, amountUsdc: nextAmount,
            history: loadAaveArbHistoryFor(owner),
            nativeBalance: wallet.nativeBalance == null
              ? null
              : await toWei(wallet.nativeBalance)
          });
      if (!alive.current) return;
      setPlan(built);
    } catch (err) {
      if (alive.current) setError(explainRevert(err).reason ?? err?.code ?? String(err));
    }
  }, [owner, wallet]);

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
        const provider = await wallet.getReadProvider(AAVE_V3_ARBITRUM.chainId);
        const tx = buildUnsignedTransaction({ from: owner, to: step.to, data: step.data, value: 0n });
        const outcome = await simulateUnsignedTransaction({
          provider,
          tx,
          allowance: step.kind === 'supply'
            ? { token: AAVE_V3_ARBITRUM.usdc, owner, spender: AAVE_V3_ARBITRUM.pool, amountWei: plan.checks.amountWei ?? 0n }
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
      provider = await wallet.getReadProvider(AAVE_V3_ARBITRUM.chainId);
      for (let i = 0; i < plan.steps.length; i += 1) {
        const step = plan.steps[i];
        const record = recordAaveArbAction({
          action: step.kind,
          owner,
          chainId: AAVE_V3_ARBITRUM.chainId,
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
              ? { token: AAVE_V3_ARBITRUM.usdc, owner, spender: AAVE_V3_ARBITRUM.pool, amountWei: plan.checks.amountWei ?? 0n }
              : undefined
          });
          const before = step.kind === 'supply' || step.kind === 'withdraw'
            ? await getPosition(provider, owner)
            : null;
          const result = await executeGuardedStep({
            signer, provider, owner, chainId: AAVE_V3_ARBITRUM.chainId, step,
            verifyReceipt: ({ receipt }) => verifyAaveReceipt({
              provider, receipt, owner, action: step.kind,
              amountWei: plan.checks.amountWei,
              beforePositionWei: before?.aTokenBalance ?? null
            })
          });
          confirmAaveArbAction(record.id, {
            txHash: result.receipt?.hash ?? result.tx.hash,
            blockNumber: result.receipt?.blockNumber ?? null
          });
          setLastTx({ hash: result.receipt?.hash ?? result.tx.hash, kind: step.kind });
        } catch (err) {
          const explained = explainRevert(err);
          if (isUserRejection(err)) cancelAaveArbAction(record.id, 'USER_REJECTED');
          else if (isTransactionTimeout(err)) timeoutAaveArbAction(record.id);
          else if (isTransactionReplacement(err)) replaceAaveArbAction(record.id, {
            error: err?.code ?? 'TRANSACTION_REPLACED',
            txHash: err?.replacement?.hash ?? err?.receipt?.hash ?? null
          });
          else failAaveArbAction(record.id, {
            error: err?.code ?? explained.reason ?? err?.message ?? 'FAILED',
            revertKey: explained.key
          });
          const label = isUserRejection(err)
            ? t('farm.aaveArb.userRejected', { defaultValue: 'Signature rejected' })
            : isTransactionTimeout(err)
              ? t('farm.aaveArb.timeout', { defaultValue: 'Transaction is still pending; check the wallet or explorer.' })
              : isTransactionReplacement(err)
                ? t('farm.aaveArb.replaced', { defaultValue: 'Transaction was replaced or cancelled.' })
                : (explained.key ? t(explained.key) : (explained.reason ?? err?.code ?? t('farm.aaveArb.failed')));
          setError(label);
          setBusy('');
          await refresh();
          return;
        }
      }
    } catch (err) {
      setError(err?.code ?? t('farm.aaveArb.failed'));
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
      const provider = await wallet.getReadProvider(AAVE_V3_ARBITRUM.chainId);
      const { steps } = await buildRevokePlan({ provider, owner });
      await simulateGuardedStep({ provider, owner, step: steps[0] });
      const result = await executeGuardedStep({
        signer, provider, owner, chainId: AAVE_V3_ARBITRUM.chainId, step: steps[0],
        verifyReceipt: ({ receipt }) => verifyAaveReceipt({
          provider, receipt, owner, action: 'revoke', amountWei: 0n
        })
      });
      recordAaveArbAction({
        action: 'revoke', owner, chainId: AAVE_V3_ARBITRUM.chainId, amountUsdcWei: '0',
        txHash: result.receipt?.hash ?? result.tx.hash,
        blockNumber: result.receipt?.blockNumber ?? null, status: 'confirmed'
      });
      setPartial({ needed: false, allowanceUsdcWei: 0n, source: null, lastApprove: null });
    } catch (err) {
      const explained = explainRevert(err);
      setError(isUserRejection(err)
        ? t('farm.aaveArb.userRejected', { defaultValue: 'Signature rejected' })
        : isTransactionTimeout(err)
          ? t('farm.aaveArb.timeout', { defaultValue: 'Transaction is still pending; check the wallet or explorer.' })
          : (explained.reason ?? err?.code ?? t('farm.aaveArb.failed')));
    } finally {
      setBusy('');
      await refresh();
    }
  }, [owner, refresh, t, wallet]);

  if (!isTarget) return null;
  const wrongChain = wallet.isConnected && wallet.chainId !== AAVE_V3_ARBITRUM.chainId;
  /*
   * Kill switch. With the flag off, supply is gone — and if there is also no
   * position to withdraw, there is nothing left for this panel to say, so it
   * renders nothing rather than an empty card. A position still renders: the
   * withdrawal path is never gated.
   */
  /*
   * Third case: the wallet is on another network, so the chain read never ran
   * and the position is unknown — but the local ledger says this owner supplied
   * through this app. Hiding the card there would leave someone holding an Aave
   * position with no in-app route to it, which is exactly what the kill switch
   * must not do. Show the card and the switch prompt instead.
   */
  const knownHere = wrongChain && !hasPosition && history.some(
    (r) => r.action === 'supply' && (r.status === 'confirmed' || r.status === 'pending')
  );
  if (!supplyAllowed && !hasPosition && !knownHere) return null;

  const openSheet = (nextMode) => {
    setMode(nextMode);
    setAmount('');
    setError(null);
    setPlan(null);
    setSimulation(null);
    setOpen(true);
  };

  return (
    <section className="card card-soft farm-aavearb-panel" aria-label={t('farm.aaveArb.panelTitle')}>
      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.4 }}>
            <span style={{ verticalAlign: '-4px', marginRight: 6 }}><IconShield width={16} height={16} /></span>
            {t('farm.aaveArb.panelTitle')}
          </div>
          <div className="muted" style={{ fontSize: 11.6, margin: '3px 0 0' }}>
            {t('farm.aaveArb.panelSub', { chain: EVM_CHAINS[AAVE_V3_ARBITRUM.chainId].name, symbol: AAVE_V3_ARBITRUM.usdcSymbol })}
          </div>
        </div>
        {status?.supplyApyPct != null && (
          <span className="pill pill-neutral mono" dir="ltr">{status.supplyApyPct.toFixed(2)}% {t('farm.aaveArb.apy')}</span>
        )}
      </div>

      {/* ── position ─────────────────────────────────────────────────────── */}
      {hasPosition && (
        <div className="farm-economics" style={{ marginTop: 10 }}>
          <Row label={t('farm.aaveArb.supplied')} value={`${fmtUsdc(position.suppliedUsdc)} ${AAVE_V3_ARBITRUM.usdcSymbol}`} />
          <Row label={t('farm.aaveArb.usdValue')} value={fmtUsd(position.suppliedUsd)} />
          <Row label={t('farm.aaveArb.apy')} value={status?.supplyApyPct == null ? '—' : `${status.supplyApyPct.toFixed(2)}%`} />
          <Row label={t('farm.aaveArb.accrued')} value={position.accruedSinceUsdc == null ? '—' : `${fmtUsdc(position.accruedSinceUsdc)} ${AAVE_V3_ARBITRUM.usdcSymbol}`} />
          {/* Read honestly: there is no debt in this flow, so the health factor
              is "—" rather than a reassuring number. */}
          <Row label={t('farm.aaveArb.healthFactor')} value={position.healthFactor == null ? '—' : String(position.healthFactor)} />
        </div>
      )}

      {knownHere && (
        <p className="muted" style={{ fontSize: 11.6, margin: '10px 0 0' }}>
          {t('farm.aaveArb.wrongChainNote', { chain: EVM_CHAINS[AAVE_V3_ARBITRUM.chainId].name })}
        </p>
      )}

      {/* ── stuck allowance ──────────────────────────────────────────────── */}
      {partial?.needed && (
        <div className="notice notice-danger" style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 6px' }}>
            {t('farm.aaveArb.partialBody', { amount: fmtUsdc(partial.allowanceUsdcWei), symbol: AAVE_V3_ARBITRUM.usdcSymbol })}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => openSheet('supply')}>
              {t('farm.aaveArb.continue')}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy === 'revoking'} onClick={revoke}>
              {busy === 'revoking' ? t('farm.aaveArb.working') : t('farm.aaveArb.revoke')}
            </button>
          </div>
        </div>
      )}

      {/* ── actions ──────────────────────────────────────────────────────── */}
      <div className="farm-actions" style={{ marginTop: 10 }}>
        {!wallet.isConnected && <span className="faint">{t('farm.aaveArb.connectFirst')}</span>}
        {wrongChain && (
          <button className="btn btn-ghost farm-btn" onClick={() => wallet.switchChain(AAVE_V3_ARBITRUM.chainId)}>
            {t('farm.aaveArb.switchChain', { chain: EVM_CHAINS[AAVE_V3_ARBITRUM.chainId].name })}
          </button>
        )}
        {wallet.isConnected && !wrongChain && supplyAllowed && (
          <button className="btn btn-primary farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('supply')}>
            <IconSwap width={15} height={15} /> {t('farm.aaveArb.supplyInApp')}
          </button>
        )}
        {wallet.isConnected && !wrongChain && withdrawAllowed && (
          <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('withdraw')}>
            {t('farm.aaveArb.withdraw')}
          </button>
        )}
        <a
          className="btn btn-ghost farm-btn farm-btn-minor"
          href={explorerAddr(AAVE_V3_ARBITRUM.chainId, AAVE_V3_ARBITRUM.pool)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('farm.aaveArb.explorer')}
        </a>
      </div>

      {/* The supply caps are shown, not hidden: a user must be able to see why
          the input stops where it does. */}
      {supplyAllowed && (
        <p className="faint" style={{ margin: '8px 0 0', fontSize: 11.4 }}>
          {t('farm.aaveArb.capsLine', { perTx: AAVE_ARB_SUPPLY_MAX_USDC_PER_TX, total: AAVE_ARB_SUPPLY_MAX_USDC_TOTAL })}
          {AAVE_ARB_SUPPLY_ALLOWLIST.length > 0 && <> · {t('farm.aaveArb.allowlisted')}</>}
        </p>
      )}

      <Sheet open={open} onClose={() => { if (!busy) setOpen(false); }} title={mode === 'withdraw' ? t('farm.aaveArb.withdrawTitle') : t('farm.aaveArb.supplyTitle')} size="md">
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              className="farm-amt-input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0.00"
              aria-label={t('farm.aaveArb.amount')}
              style={{ flex: 1 }}
            />
            <span className="mono">{AAVE_V3_ARBITRUM.usdcSymbol}</span>
            <button
              className="tag"
              type="button"
              onClick={() => setAmount(String(Math.floor((mode === 'withdraw' ? maxWithdrawUsdc : maxSupplyUsdc) * 1e6) / 1e6))}
            >
              {t('farm.aaveArb.max')}
            </button>
          </div>

          <p className="faint" style={{ margin: 0, fontSize: 11.8 }}>
            {mode === 'withdraw'
              ? t('farm.aaveArb.withdrawMaxHint', { amount: fmtUsd(maxWithdrawUsdc) })
              : t('farm.aaveArb.maxHint', {
                  amount: fmtUsd(maxSupplyUsdc),
                  wallet: walletUsdc == null ? '—' : fmtUsdc(walletUsdc),
                  apy: status?.supplyApyPct == null ? '—' : `${status.supplyApyPct.toFixed(2)}%`
                })}
          </p>

          {/* Plain-language step list BEFORE any signature. */}
          <StepList steps={plan?.steps} t={t} />

          {/* Checks the plan refused, in words. */}
          {blockedByPlan && (
            <p className="notice notice-danger" style={{ margin: 0 }}>
              {plan.checks.blocked.map((code) => t(`farm.aaveArb.block.${code}`, { defaultValue: code })).join(' · ')}
            </p>
          )}

          {/* Simulation result, shown before every signature. */}
          {simulating && <p className="faint" style={{ margin: 0 }}>{t('farm.aaveArb.simulating')}</p>}
          {simulation?.status === 'simulated-clean' && (
            <p className="notice" style={{ margin: 0 }}>{t('farm.aaveArb.simClean')}</p>
          )}
          {simulation?.status === 'revert-detected' && (
            <p className="notice notice-danger" style={{ margin: 0 }}>
              {t('farm.aaveArb.simRevert')}: {simulation.revert?.key ? t(simulation.revert.key) : (simulation.revertReason ?? '—')}
            </p>
          )}
          {simulation?.status === 'provider-busy' && (
            <p className="notice notice-danger" style={{ margin: 0 }}>{t('farm.aaveArb.simBusy')}</p>
          )}
          {simulation?.status === 'unknown' && plan?.steps?.length > 0 && (
            <p className="notice" style={{ margin: 0 }}>{t('farm.aaveArb.simNotRun')}</p>
          )}

          {error && <p className="notice notice-danger" style={{ margin: 0 }}>{error}</p>}

          {lastTx && (
            <a className="faint" href={explorerTx(AAVE_V3_ARBITRUM.chainId, lastTx.hash)} target="_blank" rel="noopener noreferrer" dir="ltr">
              {t('farm.aaveArb.viewTx')}
            </a>
          )}

          <div className="farm-actions">
            <button className="btn btn-primary farm-btn" disabled={!canSign} onClick={execute}>
              {busy === 'signing' ? t('farm.aaveArb.working') : (mode === 'withdraw' ? t('farm.aaveArb.withdraw') : t('farm.aaveArb.supplyInApp'))}
            </button>
            <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>

          {history.length > 0 && (
            <div>
              <p className="section-label" style={{ margin: '6px 0 4px' }}>{t('farm.aaveArb.recentTitle')}</p>
              {history.slice(0, 5).map((r) => (
                <div key={r.id} className="farm-metric">
                  <span className="faint">
                    {t(`farm.aaveArb.action.${r.action}`)} · {r.amountUsdc != null ? `${r.amountUsdc} ${AAVE_V3_ARBITRUM.usdcSymbol}` : '—'} · {new Date(r.at).toLocaleString()}
                  </span>
                  <span className="mono">{t(`farm.aaveArb.status.${r.status}`)}</span>
                </div>
              ))}
            </div>
          )}

          <InfoBox title={t('farm.aaveArb.riskTitle')} tone="warning" defaultOpen id="farm-aavearb-risk">
            <p>{t('farm.aaveArb.risk1')}</p>
            <p>{t('farm.aaveArb.risk2')}</p>
            <p>{t('farm.aaveArb.risk3')}</p>
            <p>{t('farm.aaveArb.risk4')}</p>
          </InfoBox>
        </div>
      </Sheet>
    </section>
  );
}

/* ── tiny read helpers (kept here so the adapter stays provider-shape free) ── */
async function walletBalanceOf(provider, owner) {
  const { Contract } = await import('ethers');
  const c = new Contract(AAVE_V3_ARBITRUM.usdc, ['function balanceOf(address) view returns (uint256)'], provider);
  try {
    return await c.balanceOf(owner);
  } catch {
    return null;
  }
}

async function walletAllowanceOf(provider, owner) {
  const { Contract } = await import('ethers');
  const c = new Contract(AAVE_V3_ARBITRUM.usdc, ['function allowance(address,address) view returns (uint256)'], provider);
  try {
    return await c.allowance(owner, AAVE_V3_ARBITRUM.pool);
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
