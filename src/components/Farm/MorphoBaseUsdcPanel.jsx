import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from '../Sheet';
import InfoBox from '../InfoBox';
import { IconShield, IconSwap } from '../Icons';
import { useWallet } from '../../context/WalletContext';
import { EVM_CHAINS, explorerAddr, explorerTx } from '../../lib/chains';
import {
  MORPHO_BASE_SUPPLY_ALLOWLIST, morphoBaseSupplyAllowedFor, morphoBaseWithdrawAllowedFor
} from '../../lib/features';
import { MORPHO_BASE_SUPPLY_OPEN_TO_PUBLIC } from '../../lib/farmRolloutMode';
import {
  MORPHO_BLUE_BASE, buildRevokePlan, buildSupplyPlan, buildWithdrawPlan,
  fromUsdcWei, getPosition, getMarketState, isMorphoBlueBaseMarket,
  verifyMorphoReceipt
} from '../../lib/defi/morphoBlueBase';
import { localChainLabel } from '../../lib/farmDeFi';
import {
  cancelMorphoAction, confirmMorphoAction, derivePartialApprovalState, failMorphoAction,
  replaceMorphoAction, timeoutMorphoAction, loadMorphoHistoryFor, recordMorphoAction
} from '../../lib/defi/morphoBlueHistory';
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

const fmtUsdc = (wei) => (wei == null ? '—' : Number(fromUsdcWei(wei)).toFixed(2));
const fmtUsd = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);

function Row({ label, value, mono = true }) {
  return (
    <div className="farm-metric">
      <span className="faint">{label}</span>
      <span className={mono ? 'mono' : ''} dir="ltr">{value}</span>
    </div>
  );
}

function StepList({ steps, t }) {
  if (!steps?.length) return null;
  return (
    <ol className="farm-morpho-steps" style={{ margin: '8px 0 0', paddingLeft: 20 }}>
      {steps.map((s, i) => (
        <li key={`${s.kind}-${i}`} style={{ fontSize: 12.6, lineHeight: 1.9 }}>
          {s.description?.amount != null
            ? t(s.description.key, { amount: s.description.amount, symbol: MORPHO_BLUE_BASE.loanSymbol })
            : t(s.description.key, { symbol: MORPHO_BLUE_BASE.loanSymbol })}
        </li>
      ))}
    </ol>
  );
}

export default function MorphoBaseUsdcPanel({ pool }) {
  const { t } = useTranslation();
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('supply');
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

  const isTarget = pool ? isMorphoBlueBaseMarket(pool) : true;
  // When used inside FarmPositionHub we pass a descriptor that is NOT the real DefiLlama UUID.
  // So we also accept the hub's morpho descriptor.
  const isHubDescriptor = pool?.project === 'morpho-blue' && String(pool?.chain).toLowerCase() === 'base';
  const shouldRender = isTarget || isHubDescriptor;

  const owner = wallet.address;
  const supplyAllowed = morphoBaseSupplyAllowedFor(owner);
  const hasPosition = (position?.suppliedUsdc ?? 0n) > 0n || (position?.supplyShares ?? 0n) > 0n;
  const withdrawAllowed = morphoBaseWithdrawAllowedFor({ owner, hasPosition });

  const refresh = useCallback(async () => {
    if (!shouldRender || !owner) return;
    setHistory(loadMorphoHistoryFor(owner));
    setBusy('loading');
    try {
      const provider = await wallet.getReadProvider(MORPHO_BLUE_BASE.chainId);
      const [pos, mkt] = await Promise.all([
        withRpcRetry(() => getPosition(provider, owner), { label: 'morpho position' }).catch(() => null),
        withRpcRetry(() => getMarketState(provider), { label: 'morpho market' }).catch(() => null)
      ]);
      if (!alive.current) return;
      setPosition(pos);
      setStatus(mkt);
      setHistory(loadMorphoHistoryFor(owner));
      const bal = await withRpcRetry(() => walletBalanceOf(provider, owner), { label: 'morpho wallet' });
      if (!alive.current) return;
      setWalletUsdc(bal);
      const rinfo = await withRpcRetry(
        () => loadSplitRouterInfo(provider, MORPHO_BLUE_BASE.chainId),
        { label: 'morpho router' }
      ).catch(() => null);
      if (!alive.current) return;
      setRouterInfo(rinfo);
      /* When a router is live the allowance that matters is the ROUTER's —
       * the protocol allowance is no longer the spender that will pull. */
      const allowance = await withRpcRetry(
        () => walletAllowanceOf(provider, owner, rinfo?.address),
        { label: 'morpho allowance' }
      );
      setPartial(derivePartialApprovalState({
        owner,
        allowanceUsdcWei: allowance ?? 0n,
        positionUsdcWei: pos?.suppliedUsdc ?? 0n
      }));
    } catch {
      /* keep previous */
    } finally {
      if (alive.current) setBusy('');
    }
  }, [shouldRender, owner, wallet]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const maxSupplyUsdc = useMemo(() => {
    /* No platform caps: the wallet balance is the only ceiling. */
    const limits = [];
    if (walletUsdc != null) limits.push(Number(fromUsdcWei(walletUsdc)));
    return Math.max(0, Math.min(...limits));
  }, [position, walletUsdc]);

  const maxWithdrawUsdc = position ? Number(fromUsdcWei(position.suppliedUsdc)) : 0;

  const buildPlan = useCallback(async (nextAmount, nextMode) => {
    setSimulation(null);
    setPlan(null);
    if (!owner) return;
    const amt = String(nextAmount).toLowerCase() === 'max' ? 'max' : nextAmount;
    if (nextMode === 'withdraw' && amt !== 'max' && !(Number(amt) > 0)) return;
    if (nextMode !== 'withdraw' && !(Number(amt) > 0)) return;
    try {
      const provider = await wallet.getReadProvider(MORPHO_BLUE_BASE.chainId);
      let built = nextMode === 'withdraw'
        ? await buildWithdrawPlan({ provider, owner, amountUsdc: amt })
        : await buildSupplyPlan({
            provider, owner, amountUsdc: amt,
            nativeBalance: wallet.nativeBalance == null ? null : await toWei(wallet.nativeBalance)
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
        const rinfo = await loadSplitRouterInfo(provider, MORPHO_BLUE_BASE.chainId);
        if (rinfo) {
          const routerAllowanceWei = await walletAllowanceOf(provider, owner, rinfo.address);
          built = routeSupplyPlan(built, {
            chainId: MORPHO_BLUE_BASE.chainId,
            protocolId: 'morpho-base',
            feeBps: rinfo.feeBps,
            routerAllowanceWei,
            asset: MORPHO_BLUE_BASE.loanToken
          });
        }
      }
      if (!alive.current) return;
      setPlan(built);
    } catch (err) {
      if (alive.current) setError(farmErrorLabel(err, t));
    }
  }, [owner, wallet]);

  useEffect(() => {
    if (!open || mode === 'revoke') return undefined;
    const id = setTimeout(() => buildPlan(amount, mode), 350);
    return () => clearTimeout(id);
  }, [amount, mode, open, buildPlan]);

  useEffect(() => {
    let cancelled = false;
    const step = plan?.steps?.[0];
    if (!step || !owner) { setSimulation(null); return undefined; }
    setSimulating(true);
    (async () => {
      try {
        const provider = await wallet.getReadProvider(MORPHO_BLUE_BASE.chainId);
        const tx = buildUnsignedTransaction({ from: owner, to: step.to, data: step.data, value: 0n });
        const outcome = await simulateUnsignedTransaction({
          provider,
          tx,
          allowance: step.kind === 'supply'
            ? { token: MORPHO_BLUE_BASE.loanToken, owner, spender: plan.checks.splitRouter?.address ?? MORPHO_BLUE_BASE.morpho, amountWei: plan.checks.amountWei ?? 0n }
            : undefined
        });
        if (!cancelled) setSimulation(outcome);
      } catch {
        if (!cancelled) setSimulation({ status: 'provider-busy', revertReason: null });
      } finally {
        if (!cancelled) setSimulating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [plan, owner, wallet]);

  const gate = useMemo(() => evaluateExecutionGate({
    simulation: simulation ?? { status: 'unknown' },
    acknowledgedHigh: true
  }), [simulation]);

  const blockedByPlan = (plan?.checks?.blocked?.length ?? 0) > 0;
  const canSign = Boolean(plan?.steps?.length) && simulation?.status === 'simulated-clean' && !isBlocked(gate) && !busy;

  const execute = useCallback(async () => {
    const signer = wallet.getSigner?.();
    if (!signer || !plan?.steps?.length) return;
    setBusy('signing');
    setError(null);
    let provider;
    try {
      provider = await wallet.getReadProvider(MORPHO_BLUE_BASE.chainId);
      for (let i = 0; i < plan.steps.length; i += 1) {
        const step = plan.steps[i];
        const record = recordMorphoAction({
          action: step.kind,
          owner,
          chainId: MORPHO_BLUE_BASE.chainId,
          amountUsdcWei: plan.checks.amountWei == null ? null : String(plan.checks.amountWei),
          amountUsdc: plan.checks.amountUsdc ?? null,
          status: 'pending'
        });
        try {
          await simulateGuardedStep({
            provider, owner, step,
            allowance: step.kind === 'supply'
              ? { token: MORPHO_BLUE_BASE.loanToken, owner, spender: plan.checks.splitRouter?.address ?? MORPHO_BLUE_BASE.morpho, amountWei: plan.checks.amountWei ?? 0n }
              : undefined
          });
          const before = step.kind === 'supply' || step.kind === 'withdraw' ? await getPosition(provider, owner) : null;
          const result = await executeGuardedStep({
            signer, provider, owner, chainId: MORPHO_BLUE_BASE.chainId, step,
            verifyReceipt: ({ receipt }) => verifyMorphoReceipt({
              provider, receipt, owner, action: step.kind,
              amountWei: plan.checks.amountWei,
              beforePositionWei: before?.suppliedUsdc ?? null,
              beforeSupplyShares: before?.supplyShares ?? null,
              /* Present only on routed supply plans — makes the receipt
               * proof demand the Routed event + net-amount protocol credit. */
              splitRouter: plan.checks.splitRouter ?? null
            })
          });
          confirmMorphoAction(record.id, {
            txHash: result.receipt?.hash ?? result.tx.hash,
            blockNumber: result.receipt?.blockNumber ?? null
          });
          setLastTx({ hash: result.receipt?.hash ?? result.tx.hash, kind: step.kind });
        } catch (err) {
          if (isUserRejection(err)) cancelMorphoAction(record.id, 'USER_REJECTED');
          else if (isTransactionTimeout(err)) timeoutMorphoAction(record.id);
          else if (isTransactionReplacement(err)) replaceMorphoAction(record.id, {
            error: err?.code ?? 'TRANSACTION_REPLACED',
            txHash: err?.replacement?.hash ?? err?.receipt?.hash ?? null
          });
          else failMorphoAction(record.id, { error: err?.code ?? err?.message ?? 'FAILED' });
          const label = isUserRejection(err) ? t('farm.morpho.userRejected', { defaultValue: 'Signature rejected' })
            : isTransactionTimeout(err) ? t('farm.morpho.timeout', { defaultValue: 'Pending; check wallet.' })
            : isTransactionReplacement(err) ? t('farm.morpho.replaced', { defaultValue: 'Replaced/cancelled' })
            : farmErrorLabel(err, t);
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
      const provider = await wallet.getReadProvider(MORPHO_BLUE_BASE.chainId);
      /* When a router is live, the standing allowance the user may want to
         kill is the ROUTER's — that is what the sheet shows and what a revoke
         must actually revoke. */
      const { steps } = await buildRevokePlan({ provider, owner, spender: routerInfo?.address ?? null });
      await simulateGuardedStep({ provider, owner, step: steps[0] });
      const result = await executeGuardedStep({
        signer, provider, owner, chainId: MORPHO_BLUE_BASE.chainId, step: steps[0],
        verifyReceipt: ({ receipt }) => verifyMorphoReceipt({ provider, receipt, owner, action: 'revoke', amountWei: 0n, expectedSpender: routerInfo?.address ?? undefined })
      });
      recordMorphoAction({
        action: 'revoke', owner, chainId: MORPHO_BLUE_BASE.chainId, amountUsdcWei: '0',
        txHash: result.receipt?.hash ?? result.tx.hash,
        blockNumber: result.receipt?.blockNumber ?? null, status: 'confirmed'
      });
      setPartial({ needed: false, allowanceUsdcWei: 0n, source: null, lastApprove: null });
    } catch (err) {
      setError(isUserRejection(err) ? t('farm.morpho.userRejected', { defaultValue: 'Signature rejected' }) : farmErrorLabel(err, t));
    } finally {
      setBusy('');
      await refresh();
    }
  }, [owner, refresh, t, wallet]);

  if (!shouldRender) return null;
  const wrongChain = wallet.isConnected && wallet.chainId !== MORPHO_BLUE_BASE.chainId;
  const knownHere = wrongChain && (hasPosition || history.some((r) => r.action === 'supply' && (r.status === 'confirmed' || r.status === 'pending')));

    /*
   * Visibility, not permission. In a public-open build the entry point is
   * shown to EVERY visitor — including one with no wallet connected yet, who
   * is exactly the person the rollout is meant to reach. Nothing here widens
   * what a wallet may sign: the buttons below still read supplyAllowed, which
   * needs a connected owner.
   */
  if (!supplyAllowed && !hasPosition && !knownHere && !MORPHO_BASE_SUPPLY_OPEN_TO_PUBLIC) return null;

  const openSheet = (nextMode) => {
    setMode(nextMode);
    setAmount('');
    setError(null);
    setPlan(null);
    setSimulation(null);
    setOpen(true);
  };

  return (
    <section className="card card-soft farm-morpho-panel" aria-label={t('farm.morpho.panelTitle', { defaultValue: 'Morpho Blue · Base USDC/cbBTC' })}>
      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.4 }}>
            <span style={{ verticalAlign: '-4px', marginRight: 6 }}><IconShield width={16} height={16} /></span>
            {t('farm.morpho.panelTitle', { defaultValue: 'Morpho Blue · Base USDC/cbBTC' })}
          </div>
          <div className="muted" style={{ fontSize: 11.6, margin: '3px 0 0' }}>
            {t('farm.morpho.panelSub', { defaultValue: 'One pinned market · USDC loan / cbBTC collateral · Base 8453', chain: localChainLabel(EVM_CHAINS[MORPHO_BLUE_BASE.chainId].name, t) })}
          </div>
        </div>
        {status?.totalSupplyAssets != null && (
          <span className="pill pill-neutral mono" dir="ltr">{fmtUsd(Number(status.totalSupplyAssets) / 1e6)} {t('farm.morpho.supply', { defaultValue: 'supply' })}</span>
        )}
      </div>

      <div className="farm-economics" style={{ marginTop: 10 }}>
        <Row label="Market ID" value={`${MORPHO_BLUE_BASE.marketId.slice(0, 10)}…${MORPHO_BLUE_BASE.marketId.slice(-6)}`} />
        <Row label="Loan" value={`${MORPHO_BLUE_BASE.loanSymbol} · ${MORPHO_BLUE_BASE.loanToken.slice(0, 6)}…`} />
        <Row label="Collateral" value={`${MORPHO_BLUE_BASE.collateralSymbol} · ${MORPHO_BLUE_BASE.collateralToken.slice(0, 6)}…`} />
        <Row label="LLTV" value="86%" />
        <Row label="Oracle" value={`${MORPHO_BLUE_BASE.oracle.slice(0, 6)}…${MORPHO_BLUE_BASE.oracle.slice(-4)}`} />
      </div>

      {hasPosition && position && (
        <div className="farm-economics" style={{ marginTop: 10 }}>
          <Row label={t('farm.morpho.supplied', { defaultValue: 'Supplied' })} value={`${fmtUsdc(position.suppliedUsdc)} ${MORPHO_BLUE_BASE.loanSymbol}`} />
          <Row label={t('farm.morpho.shares', { defaultValue: 'Shares' })} value={`${position.supplyShares.toString()}`} />
          {position.hasBorrow && <Row label={t('farm.morpho.borrow', { defaultValue: 'Borrow shares' })} value={`${position.borrowShares.toString()}`} />}
          {position.collateralCbBtc > 0n && <Row label={t('farm.morpho.collateral', { defaultValue: 'Collateral cbBTC' })} value={`${position.collateralCbBtc.toString()}`} />}
        </div>
      )}

      {knownHere && (
        <p className="muted" style={{ fontSize: 11.6, margin: '10px 0 0' }}>
          {t('farm.morpho.wrongChainNote', { defaultValue: 'Position found on Base, but wallet is on another chain. Switch to sign.', chain: localChainLabel(EVM_CHAINS[MORPHO_BLUE_BASE.chainId].name, t) })}
        </p>
      )}

      {partial?.needed && (
        <div className="notice notice-danger" style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 6px' }}>
            {t('farm.morpho.partialBody', { defaultValue: 'You have {{amount}} USDC allowance to Morpho with no supply landed.', amount: fmtUsdc(partial.allowanceUsdcWei) })}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => openSheet('supply')}>
              {t('farm.morpho.continue', { defaultValue: 'Continue supply' })}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy === 'revoking'} onClick={revoke}>
              {busy === 'revoking' ? t('farm.morpho.working', { defaultValue: 'Working…' }) : t('farm.morpho.revoke', { defaultValue: 'Revoke' })}
            </button>
          </div>
        </div>
      )}

      <div className="farm-actions" style={{ marginTop: 10 }}>
        {!wallet.isConnected && <span className="faint">{t('farm.morpho.connectFirst', { defaultValue: 'Connect wallet' })}</span>}
        {wrongChain && (
          <button className="btn btn-ghost farm-btn" onClick={() => wallet.switchChain(MORPHO_BLUE_BASE.chainId)}>
            {t('farm.morpho.switchChain', { defaultValue: 'Switch to {{chain}}', chain: localChainLabel(EVM_CHAINS[MORPHO_BLUE_BASE.chainId].name, t) })}
          </button>
        )}
        {wallet.isConnected && !wrongChain && supplyAllowed && (
          <button className="btn btn-primary farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('supply')}>
            <IconSwap width={15} height={15} /> {t('farm.morpho.supplyInApp', { defaultValue: 'Supply in-app' })}
          </button>
        )}
        {wallet.isConnected && !wrongChain && withdrawAllowed && (
          <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('withdraw')}>
            {t('farm.morpho.withdraw', { defaultValue: 'Withdraw' })}
          </button>
        )}
        <a className="btn btn-ghost farm-btn farm-btn-minor" href={explorerAddr(MORPHO_BLUE_BASE.chainId, MORPHO_BLUE_BASE.morpho)} target="_blank" rel="noopener noreferrer">
          {t('farm.morpho.explorer', { defaultValue: 'Explorer' })}
        </a>
      </div>

      {supplyAllowed && (
        <p className="faint" style={{ margin: '8px 0 0', fontSize: 11.4 }}>
          {MORPHO_BASE_SUPPLY_ALLOWLIST.length > 0 && <> · {t('farm.morpho.allowlisted', { defaultValue: 'allowlisted' })}</>}
        </p>
      )}

      <Sheet open={open} onClose={() => { if (!busy) setOpen(false); }} title={mode === 'withdraw' ? t('farm.morpho.withdrawTitle', { defaultValue: 'Withdraw from Morpho' }) : t('farm.morpho.supplyTitle', { defaultValue: 'Supply to Morpho' })} size="md">
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              className="farm-amt-input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\\d.]/g, ''))}
              placeholder={mode === 'withdraw' ? '0.00 or max' : '0.00'}
              aria-label={t('farm.morpho.amount', { defaultValue: 'Amount' })}
              style={{ flex: 1 }}
            />
            <span className="mono">{MORPHO_BLUE_BASE.loanSymbol}</span>
            <button className="tag" type="button" disabled={mode !== 'withdraw' && maxSupplyUsdc == null} onClick={() => setAmount(String(Math.floor((mode === 'withdraw' ? maxWithdrawUsdc : (maxSupplyUsdc ?? 0)) * 1e6) / 1e6))}>
              {t('farm.morpho.max', { defaultValue: 'Max' })}
            </button>
          </div>

          <p className="faint" style={{ margin: 0, fontSize: 11.8 }}>
            {mode === 'withdraw'
              ? t('farm.morpho.withdrawMaxHint', { defaultValue: 'Withdrawable {{amount}} — type max for full exit', amount: fmtUsd(maxWithdrawUsdc) })
              : t('farm.morpho.maxHint', { defaultValue: 'Max {{amount}} · wallet {{wallet}}', amount: fmtUsd(maxSupplyUsdc), wallet: walletUsdc == null ? '—' : fmtUsdc(walletUsdc) })}
          </p>

          <StepList steps={plan?.steps} t={t} />

          {/* THE FEE, disclosed before the signature — not in a receipt.
              Rendered only when this plan is actually routed; a direct
              deposit shows nothing, because it charges nothing. */}
          {plan?.checks?.splitRouter && (
            <p className="notice" style={{ margin: '8px 0 0' }}>
              {t('farm.splitRouter.feeNotice', {
                pct: (Number(plan.checks.splitRouter.feeBps ?? 0n) / 100).toString(),
                fee: fmtUsdc(plan.checks.splitRouter.feeAmount ?? 0n),
                net: fmtUsdc(plan.checks.splitRouter.netAmount ?? 0n),
                total: plan.checks.amountUsdc ?? '—',
                symbol: MORPHO_BLUE_BASE.loanSymbol
              })}
              <br />
              <span className="faint">{t('farm.splitRouter.trustNote')}</span>
            </p>
          )}

          {blockedByPlan && (
            <p className="notice notice-danger" style={{ margin: 0 }}>
              {plan.checks.blocked.map((code) => t(`farm.morpho.block.${code}`, { defaultValue: code })).join(' · ')}
            </p>
          )}

          {simulating && <p className="faint" style={{ margin: 0 }}>{t('farm.morpho.simulating', { defaultValue: 'Simulating…' })}</p>}
          {simulation?.status === 'simulated-clean' && <p className="notice" style={{ margin: 0 }}>{t('farm.morpho.simClean', { defaultValue: 'Simulation clean — ready to sign' })}</p>}
          {simulation?.status === 'revert-detected' && <p className="notice notice-danger" style={{ margin: 0 }}>{t('farm.morpho.simRevert', { defaultValue: 'Simulation reverted' })}: {simulation.revertReason ?? '—'}</p>}
          {simulation?.status === 'provider-busy' && <p className="notice notice-danger" style={{ margin: 0 }}>{t('farm.morpho.simBusy', { defaultValue: 'RPC busy — retry' })}</p>}
          {simulation?.status === 'unknown' && plan?.steps?.length > 0 && <p className="notice" style={{ margin: 0 }}>{t('farm.morpho.simNotRun', { defaultValue: 'Simulation not run yet' })}</p>}

          {error && <p className="notice notice-danger" style={{ margin: 0 }}>{error}</p>}

          {lastTx && <a className="faint" href={explorerTx(MORPHO_BLUE_BASE.chainId, lastTx.hash)} target="_blank" rel="noopener noreferrer" dir="ltr">{t('farm.morpho.viewTx', { defaultValue: 'View tx' })}</a>}

          <div className="farm-actions">
            <button className="btn btn-primary farm-btn" disabled={!canSign} onClick={execute}>
              {busy === 'signing' ? t('farm.morpho.working', { defaultValue: 'Working…' }) : (mode === 'withdraw' ? t('farm.morpho.withdraw', { defaultValue: 'Withdraw' }) : t('farm.morpho.supplyInApp', { defaultValue: 'Supply in-app' }))}
            </button>
            <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => setOpen(false)}>{t('common.cancel', { defaultValue: 'Cancel' })}</button>
          </div>

          {history.length > 0 && (
            <div>
              <p className="section-label" style={{ margin: '6px 0 4px' }}>{t('farm.morpho.recentTitle', { defaultValue: 'Recent' })}</p>
              {history.slice(0, 5).map((r) => (
                <div key={r.id} className="farm-metric">
                  <span className="faint">{r.action} · {r.amountUsdc != null ? `${r.amountUsdc} USDC` : '—'} · {new Date(r.at).toLocaleString()}</span>
                  <span className="mono">{r.status}</span>
                </div>
              ))}
            </div>
          )}

          <InfoBox title={t('farm.morpho.riskTitle', { defaultValue: 'Risks' })} tone="warning" defaultOpen id="farm-morpho-risk">
            <p>{t('farm.morpho.risk1', { defaultValue: 'Morpho Blue is an immutable lending market; supplied USDC is exposed to borrower defaults and oracle/liquidation risk of the cbBTC collateral leg.' })}</p>
            <p>{t('farm.morpho.risk2', { defaultValue: 'This adapter only supplies the loan token USDC; it never supplies collateral or opens debt. Withdraw is share-based and can leave dust due to rounding.' })}</p>
            <p>{t('farm.morpho.risk3', { defaultValue: 'Smart contract risk — Morpho Blue core is audited but not risk-free.' })}</p>
            <p>{t('farm.morpho.risk4', { defaultValue: 'No rewards claim path is implemented in this scope.' })}</p>
          </InfoBox>
        </div>
      </Sheet>
    </section>
  );
}

async function walletBalanceOf(provider, owner) {
  const { Contract } = await import('ethers');
  const c = new Contract(MORPHO_BLUE_BASE.loanToken, ['function balanceOf(address) view returns (uint256)'], provider);
  try { return await c.balanceOf(owner); } catch { return null; }
}

async function walletAllowanceOf(provider, owner, spender = null) {
  const { Contract } = await import('ethers');
  const c = new Contract(MORPHO_BLUE_BASE.loanToken, ['function allowance(address,address) view returns (uint256)'], provider);
  try { return await c.allowance(owner, spender ?? MORPHO_BLUE_BASE.morpho); } catch { return 0n; }
}

async function toWei(eth) {
  const { parseUnits } = await import('ethers');
  try { return parseUnits(String(eth), 18); } catch { return null; }
}
