import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from '../Sheet';
import InfoBox from '../InfoBox';
import { IconShield, IconSwap } from '../Icons';
import { useWallet } from '../../context/WalletContext';
import { EVM_CHAINS, explorerAddr, explorerTx } from '../../lib/chains';
import {
  LIDO_STAKE_MAX_ETH_PER_TX,
  LIDO_STAKE_MAX_ETH_TOTAL,
  LIDO_STAKE_ALLOWLIST,
  lidoStakeAllowedFor,
  lidoWithdrawAllowedFor
} from '../../lib/features';
import { LIDO_STAKE_OPEN_TO_PUBLIC } from '../../lib/farmRolloutMode';
import {
  LIDO,
  isLidoPool,
  fromStETHWei,
  fromWstETHWei,
  fromEthWei,
  getPosition,
  getProtocolStatus,
  buildStakePlan,
  buildWrapPlan,
  buildUnwrapPlan,
  buildRequestWithdrawPlan,
  buildClaimPlan,
  buildRevokePlan,
  explainRevert,
  verifyDeployment,
  verifyLidoReceipt
} from '../../lib/defi/lido';
import {
  cancelLidoAction,
  confirmLidoAction,
  failLidoAction,
  replaceLidoAction,
  timeoutLidoAction,
  loadLidoHistoryFor,
  recordLidoAction
} from '../../lib/defi/lidoHistory';
import {
  buildUnsignedTransaction,
  simulateUnsignedTransaction
} from '../../lib/preSignSimulation';
import { evaluateExecutionGate, isBlocked } from '../../lib/executionGate';
import {
  executeGuardedStep, simulateGuardedStep, isTransactionReplacement, isTransactionTimeout, isUserRejection
} from '../../lib/defi/guardedExecution';

const fmt = (n, d = 4) => {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const num = Number(n);
  if (Math.abs(num) >= 1000) return num.toFixed(2);
  if (Math.abs(num) >= 1) return num.toFixed(d);
  return num.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
};

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
    <ol className="farm-aave-steps" style={{ margin: '8px 0 0', paddingLeft: 20 }}>
      {steps.map((s, i) => (
        <li key={`${s.kind}-${i}`} style={{ fontSize: 12.6, lineHeight: 1.9 }}>
          {s.description?.amount != null
            ? t(s.description.key, { amount: s.description.amount, symbol: s.description?.symbol || '' })
            : t(s.description.key, { symbol: s.description?.symbol || '' })}
        </li>
      ))}
    </ol>
  );
}

export default function LidoPanel({ pool }) {
  const { t } = useTranslation();
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('stake'); // stake | wrap | unwrap | requestWithdraw | claim
  const [amount, setAmount] = useState('');
  const [claimId, setClaimId] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState(null);
  const [plan, setPlan] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [lastTx, setLastTx] = useState(null);
  const [history, setHistory] = useState([]);
  const alive = useRef(true);

  const isTarget = isLidoPool(pool);
  const owner = wallet.address;
  const hasPosition = Boolean(position?.hasPosition);
  const stakeAllowed = lidoStakeAllowedFor(owner);
  const withdrawAllowed = lidoWithdrawAllowedFor({ owner, hasPosition });

  const refresh = useCallback(async () => {
    if (!isTarget || !owner) return;
    setHistory(loadLidoHistoryFor(owner));
    // Read Ethereum positions and withdrawal tickets on every active wallet
    // network. Stake/exit signatures still require an explicit chain switch.
    setBusy('loading');
    try {
      const provider = await wallet.getReadProvider(LIDO.chainId);
      const [pos, proto] = await Promise.all([
        getPosition(provider, owner, { history: loadLidoHistoryFor(owner) }).catch(() => null),
        getProtocolStatus(provider).catch(() => null)
      ]);
      if (!alive.current) return;
      setPosition(pos);
      setStatus(proto);
      setHistory(loadLidoHistoryFor(owner));
    } catch {
      /* keep previous state */
    } finally {
      if (alive.current) setBusy('');
    }
  }, [isTarget, owner, wallet]);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const maxStakeEth = useMemo(() => {
    if (!position) return LIDO_STAKE_MAX_ETH_PER_TX;
    const existing = Number(position.totalEthEquivalent ?? 0);
    const remainingTotal = Math.max(0, LIDO_STAKE_MAX_ETH_TOTAL - existing);
    const walletEth = wallet.nativeBalance != null ? Number(wallet.nativeBalance) : Infinity;
    return Math.max(0, Math.min(LIDO_STAKE_MAX_ETH_PER_TX, remainingTotal, walletEth * 0.95));
  }, [position, wallet.nativeBalance]);

  const maxWrap = position?.stETH ?? 0;
  const maxUnwrap = position?.wstETH ?? 0;
  const maxRequest = position?.stETH ?? 0;

  const buildPlan = useCallback(async (nextAmount, nextMode, nextClaimId) => {
    setSimulation(null);
    setPlan(null);
    if (!owner) return;
    if (nextMode === 'claim') {
      const id = String(nextClaimId ?? '').trim();
      if (!id) return;
      try {
        const provider = await wallet.getReadProvider(LIDO.chainId);
        const built = await buildClaimPlan({ provider, owner, requestId: id });
        if (!alive.current) return;
        setPlan(built);
      } catch (err) {
        if (alive.current) setError(explainRevert(err).reason ?? String(err));
      }
      return;
    }
    if (!(Number(nextAmount) > 0)) return;
    try {
      const provider = await wallet.getReadProvider(LIDO.chainId);
      let built = null;
      if (nextMode === 'stake') {
        built = await buildStakePlan({
          provider,
          owner,
          amountEth: nextAmount,
          history: loadLidoHistoryFor(owner),
          nativeBalance: wallet.nativeBalance == null ? null : await toWei(wallet.nativeBalance)
        });
      } else if (nextMode === 'wrap') {
        built = await buildWrapPlan({ provider, owner, amountStETH: nextAmount });
      } else if (nextMode === 'unwrap') {
        built = await buildUnwrapPlan({ provider, owner, amountWstETH: nextAmount });
      } else if (nextMode === 'requestWithdraw') {
        built = await buildRequestWithdrawPlan({ provider, owner, amountStETH: nextAmount });
      }
      if (!alive.current) return;
      setPlan(built);
    } catch (err) {
      if (alive.current) setError(explainRevert(err).reason ?? err?.code ?? String(err));
    }
  }, [owner, wallet]);

  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => buildPlan(amount, mode, claimId), 350);
    return () => clearTimeout(id);
  }, [amount, mode, claimId, open, buildPlan]);

  useEffect(() => {
    let cancelled = false;
    const step = plan?.steps?.[0];
    if (!step || !owner) { setSimulation(null); return undefined; }
    setSimulating(true);
    (async () => {
      try {
        const provider = await wallet.getReadProvider(LIDO.chainId);
        const tx = buildUnsignedTransaction({
          from: owner,
          to: step.to,
          data: step.data,
          value: step.value ?? 0n
        });
        const outcome = await simulateUnsignedTransaction({
          provider,
          tx,
          allowance: step.kind === 'wrap' || step.kind === 'requestWithdraw'
            ? { token: LIDO.stETH, owner, spender: step.kind === 'wrap' ? LIDO.wstETH : LIDO.withdrawalQueue, amountWei: plan.checks.amountWei ?? 0n }
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
    simulation: simulation ?? { status: 'unknown' },
    acknowledgedHigh: true
  }), [simulation]);

  const blockedByPlan = (plan?.checks?.blocked?.length ?? 0) > 0;
  const canSign = Boolean(plan?.steps?.length)
    && simulation?.status === 'simulated-clean'
    && !isBlocked(gate)
    && !busy;

  const execute = useCallback(async () => {
    const signer = wallet.getSigner?.();
    if (!signer || !plan?.steps?.length) return;
    setBusy('signing');
    setError(null);
    let provider;
    try {
      provider = await wallet.getReadProvider(LIDO.chainId);
      for (let i = 0; i < plan.steps.length; i += 1) {
        const step = plan.steps[i];
        const symbol = step.kind === 'stake' ? 'ETH' : step.kind === 'wrap' || step.kind === 'requestWithdraw' ? 'stETH' : step.kind === 'unwrap' ? 'wstETH' : '';
        const record = recordLidoAction({
          action: step.kind,
          owner,
          chainId: LIDO.chainId,
          amountWei: plan.checks.amountWei == null ? null : String(plan.checks.amountWei),
          amount: plan.checks.amountEth ?? plan.checks.amountStETH ?? plan.checks.amountWstETH ?? null,
          symbol,
          status: 'pending',
          requestId: plan.checks.requestId != null ? String(plan.checks.requestId) : null
        });
        try {
          await simulateGuardedStep({
            provider,
            owner,
            step,
            allowance: step.kind === 'wrap' || step.kind === 'requestWithdraw'
              ? { token: LIDO.stETH, owner, spender: step.kind === 'wrap' ? LIDO.wstETH : LIDO.withdrawalQueue, amountWei: plan.checks.amountWei ?? 0n }
              : undefined
          });
          const before = step.kind === 'stake' || step.kind === 'wrap' || step.kind === 'unwrap'
            ? await getPosition(provider, owner)
            : null;
          const result = await executeGuardedStep({
            signer, provider, owner, chainId: LIDO.chainId, step,
            verifyReceipt: ({ receipt }) => verifyLidoReceipt({
              provider, receipt, owner, action: step.kind,
              amountWei: plan.checks.amountWei,
              expectedSpender: step.spender,
              beforePosition: before,
              requestId: plan.checks.requestId
            })
          });
          const requestId = result.proof?.requestId ?? plan.checks.requestId ?? null;
          confirmLidoAction(record.id, {
            txHash: result.receipt?.hash ?? result.tx.hash,
            blockNumber: result.receipt?.blockNumber ?? null,
            requestId
          });
          setLastTx({ hash: result.receipt?.hash ?? result.tx.hash, kind: step.kind });
        } catch (err) {
          const explained = explainRevert(err);
          if (isUserRejection(err)) cancelLidoAction(record.id, 'USER_REJECTED');
          else if (isTransactionTimeout(err)) timeoutLidoAction(record.id);
          else if (isTransactionReplacement(err)) replaceLidoAction(record.id, {
            error: err?.code ?? 'TRANSACTION_REPLACED',
            txHash: err?.replacement?.hash ?? err?.receipt?.hash ?? null
          });
          else failLidoAction(record.id, {
            error: err?.code ?? explained.reason ?? err?.message ?? 'FAILED',
            revertKey: explained.key
          });
          const label = isUserRejection(err)
            ? t('farm.lido.userRejected', { defaultValue: 'Signature rejected' })
            : isTransactionTimeout(err)
              ? t('farm.lido.timeout', { defaultValue: 'Transaction is still pending; check the wallet or explorer.' })
              : isTransactionReplacement(err)
                ? t('farm.lido.replaced', { defaultValue: 'Transaction was replaced or cancelled.' })
                : (explained.key ? t(explained.key) : (explained.reason ?? err?.code ?? t('farm.lido.failed')));
          setError(label);
          setBusy('');
          await refresh();
          return;
        }
      }
    } catch (err) {
      setError(err?.code ?? t('farm.lido.failed'));
    }
    setBusy('');
    setOpen(false);
    setAmount('');
    setClaimId('');
    await refresh();
  }, [owner, plan, refresh, t, wallet]);

  const revoke = useCallback(async (spenderKind) => {
    const signer = wallet.getSigner?.();
    if (!signer) return;
    setBusy('revoking');
    setError(null);
    try {
      const provider = await wallet.getReadProvider(LIDO.chainId);
      const { steps } = await buildRevokePlan({ provider, owner, spender: spenderKind });
      await simulateGuardedStep({ provider, owner, step: steps[0] });
      const result = await executeGuardedStep({
        signer, provider, owner, chainId: LIDO.chainId, step: steps[0],
        verifyReceipt: ({ receipt }) => verifyLidoReceipt({
          provider, receipt, owner, action: 'revoke', amountWei: 0n,
          expectedSpender: steps[0].spender
        })
      });
      recordLidoAction({
        action: 'revoke', owner, chainId: LIDO.chainId, amountWei: '0',
        txHash: result.receipt?.hash ?? result.tx.hash,
        blockNumber: result.receipt?.blockNumber ?? null, status: 'confirmed'
      });
    } catch (err) {
      const explained = explainRevert(err);
      setError(isUserRejection(err)
        ? t('farm.lido.userRejected', { defaultValue: 'Signature rejected' })
        : isTransactionTimeout(err)
          ? t('farm.lido.timeout', { defaultValue: 'Transaction is still pending; check the wallet or explorer.' })
          : (explained.reason ?? err?.code ?? t('farm.lido.failed')));
    } finally {
      setBusy('');
      await refresh();
    }
  }, [owner, refresh, t, wallet]);

  if (!isTarget) return null;
  const wrongChain = wallet.isConnected && wallet.chainId !== LIDO.chainId;
  const knownHere = wrongChain && (hasPosition || history.some(
    (r) => r.action === 'stake' && (r.status === 'confirmed' || r.status === 'pending')
  ));

    /*
   * Visibility, not permission. In a public-open build the entry point is
   * shown to EVERY visitor — including one with no wallet connected yet, who
   * is exactly the person the rollout is meant to reach. Nothing here widens
   * what a wallet may sign: the buttons below still read stakeAllowed, which
   * needs a connected owner.
   */
  if (!stakeAllowed && !hasPosition && !knownHere && !LIDO_STAKE_OPEN_TO_PUBLIC) return null;

  const openSheet = (nextMode) => {
    setMode(nextMode);
    setAmount('');
    setClaimId('');
    setError(null);
    setPlan(null);
    setSimulation(null);
    setOpen(true);
  };

  const claimable = position?.withdrawals?.statuses?.filter((s) => s.isFinalized && !s.isClaimed) ?? [];
  const pending = position?.withdrawals?.statuses?.filter((s) => !s.isFinalized && !s.isClaimed) ?? [];

  return (
    <section className="card card-soft farm-aave-panel farm-lido-panel" aria-label={t('farm.lido.panelTitle')}>
      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.4 }}>
            <span style={{ verticalAlign: '-4px', marginRight: 6 }}><IconShield width={16} height={16} /></span>
            {t('farm.lido.panelTitle')}
          </div>
          <div className="muted" style={{ fontSize: 11.6, margin: '3px 0 0' }}>
            {t('farm.lido.panelSub', { chain: EVM_CHAINS[LIDO.chainId].name })}
          </div>
        </div>
        {status?.feeBps != null && (
          <span className="pill pill-neutral mono" dir="ltr">{(status.feeBps / 100).toFixed(1)}% {t('farm.lido.fee')}</span>
        )}
      </div>

      {/* Protocol status */}
      {status && (
        <div className="farm-economics" style={{ marginTop: 10 }}>
          <Row label={t('farm.lido.totalPooled')} value={`${fmt(fromEthWei(status.totalPooledEtherWei), 2)} ETH`} />
          <Row label={t('farm.lido.queueLength')} value={`${status.withdrawalQueueLength?.toString() ?? '—'}`} />
          <Row label={t('farm.lido.isPaused')} value={status.isStakingPaused ? t('farm.lido.yes') : t('farm.lido.no')} />
          <Row label={t('farm.lido.bunkerMode')} value={status.isBunkerModeActive ? t('farm.lido.yes') : t('farm.lido.no')} />
        </div>
      )}

      {/* Position */}
      {hasPosition && position && (
        <div className="farm-economics" style={{ marginTop: 10 }}>
          <Row label="stETH" value={`${fmt(position.stETH, 6)} stETH`} />
          <Row label="wstETH" value={`${fmt(position.wstETH, 6)} wstETH`} />
          <Row label={t('farm.lido.totalEth')} value={position.totalEthEquivalent != null ? `${fmt(position.totalEthEquivalent, 6)} ETH` : '—'} />
          <Row label={t('farm.lido.withdrawalTickets')} value={`${position.withdrawals?.requestIds?.length ?? 0}`} />
          <Row label={t('farm.lido.claimable')} value={`${claimable.length}`} />
          <Row label={t('farm.lido.pendingQueue')} value={`${pending.length}`} />
        </div>
      )}

      {knownHere && (
        <p className="muted" style={{ fontSize: 11.6, margin: '10px 0 0' }}>
          {t('farm.lido.wrongChainNote', { chain: EVM_CHAINS[LIDO.chainId].name })}
        </p>
      )}

      {/* Allowances notice */}
      {position?.allowances && (position.allowances.wstETHAllowanceWei > 0n || position.allowances.queueAllowanceWei > 0n) && (
        <div className="notice" style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 6px', fontSize: 12 }}>
            {t('farm.lido.allowanceNotice', {
              wst: fmt(fromStETHWei(position.allowances.wstETHAllowanceWei), 4),
              queue: fmt(fromStETHWei(position.allowances.queueAllowanceWei), 4)
            })}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {position.allowances.wstETHAllowanceWei > 0n && (
              <button className="btn btn-ghost btn-sm" disabled={busy === 'revoking'} onClick={() => revoke('wstETH')}>
                {t('farm.lido.revokeWstETH')}
              </button>
            )}
            {position.allowances.queueAllowanceWei > 0n && (
              <button className="btn btn-ghost btn-sm" disabled={busy === 'revoking'} onClick={() => revoke('queue')}>
                {t('farm.lido.revokeQueue')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="farm-actions" style={{ marginTop: 10, flexWrap: 'wrap' }}>
        {!wallet.isConnected && <span className="faint">{t('farm.lido.connectFirst')}</span>}
        {wrongChain && (
          <button className="btn btn-ghost farm-btn" onClick={() => wallet.switchChain(LIDO.chainId)}>
            {t('farm.lido.switchChain', { chain: EVM_CHAINS[LIDO.chainId].name })}
          </button>
        )}
        {wallet.isConnected && !wrongChain && stakeAllowed && (
          <button className="btn btn-primary farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('stake')}>
            <IconSwap width={15} height={15} /> {t('farm.lido.stakeInApp')}
          </button>
        )}
        {wallet.isConnected && !wrongChain && withdrawAllowed && (
          <>
            <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('wrap')}>
              {t('farm.lido.wrap')}
            </button>
            <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('unwrap')}>
              {t('farm.lido.unwrap')}
            </button>
            <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('requestWithdraw')}>
              {t('farm.lido.requestWithdraw')}
            </button>
            <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('claim')}>
              {t('farm.lido.claim')} {claimable.length > 0 ? `(${claimable.length})` : ''}
            </button>
          </>
        )}
        <a className="btn btn-ghost farm-btn farm-btn-minor" href={explorerAddr(LIDO.chainId, LIDO.stETH)} target="_blank" rel="noopener noreferrer">
          {t('farm.lido.explorer')}
        </a>
      </div>

      {stakeAllowed && (
        <p className="faint" style={{ margin: '8px 0 0', fontSize: 11.4 }}>
          {t('farm.lido.capsLine', { perTx: LIDO_STAKE_MAX_ETH_PER_TX, total: LIDO_STAKE_MAX_ETH_TOTAL })}
          {LIDO_STAKE_ALLOWLIST.length > 0 && <> · {t('farm.lido.allowlisted')}</>}
        </p>
      )}

      {/* Claimable quick list */}
      {claimable.length > 0 && (
        <div className="card card-soft" style={{ marginTop: 10 }}>
          <p style={{ fontWeight: 700, fontSize: 12, margin: '0 0 6px' }}>{t('farm.lido.claimableTitle')}</p>
          {claimable.slice(0, 5).map((s) => (
            <div key={s.requestIdStr} className="farm-metric">
              <span className="faint">#{s.requestIdStr} · {fmt(fromStETHWei(s.amountOfStETHWei), 4)} stETH</span>
              <button className="btn btn-ghost btn-sm" onClick={() => { setClaimId(s.requestIdStr); openSheet('claim'); }}>{t('farm.lido.claim')}</button>
            </div>
          ))}
        </div>
      )}

      <Sheet open={open} onClose={() => { if (!busy) setOpen(false); }} title={
        mode === 'stake' ? t('farm.lido.stakeTitle')
          : mode === 'wrap' ? t('farm.lido.wrapTitle')
            : mode === 'unwrap' ? t('farm.lido.unwrapTitle')
              : mode === 'requestWithdraw' ? t('farm.lido.requestWithdrawTitle')
                : t('farm.lido.claimTitle')
      } size="md">
        <div className="stack" style={{ gap: 10 }}>
          {mode !== 'claim' ? (
            <>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <input
                  className="farm-amt-input"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\\d.]/g, ''))}
                  placeholder="0.00"
                  aria-label={t('farm.lido.amount')}
                  style={{ flex: 1 }}
                />
                <span className="mono">{mode === 'stake' ? 'ETH' : mode === 'wrap' || mode === 'requestWithdraw' ? 'stETH' : 'wstETH'}</span>
                <button
                  className="tag"
                  type="button"
                  onClick={() => {
                    const max = mode === 'stake' ? maxStakeEth : mode === 'wrap' ? maxWrap : mode === 'unwrap' ? maxUnwrap : maxRequest;
                    setAmount(String(Math.floor(Number(max) * 1e6) / 1e6));
                  }}
                >
                  {t('farm.lido.max')}
                </button>
              </div>

              <p className="faint" style={{ margin: 0, fontSize: 11.8 }}>
                {mode === 'stake'
                  ? t('farm.lido.maxHintStake', { amount: fmt(maxStakeEth, 4), wallet: wallet.nativeBalance != null ? fmt(wallet.nativeBalance, 4) : '—' })
                  : mode === 'wrap'
                    ? t('farm.lido.maxHintWrap', { amount: fmt(maxWrap, 4) })
                    : mode === 'unwrap'
                      ? t('farm.lido.maxHintUnwrap', { amount: fmt(maxUnwrap, 4) })
                      : t('farm.lido.maxHintRequest', { amount: fmt(maxRequest, 4) })}
              </p>
            </>
          ) : (
            <>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                <input
                  className="farm-amt-input"
                  inputMode="numeric"
                  value={claimId}
                  onChange={(e) => setClaimId(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder={t('farm.lido.requestIdPlaceholder')}
                  aria-label={t('farm.lido.requestId')}
                  style={{ flex: 1 }}
                />
                <span className="mono">ID</span>
              </div>
              {pending.length > 0 && (
                <div>
                  <p className="faint" style={{ margin: '4px 0' }}>{t('farm.lido.pendingListTitle')}</p>
                  {pending.slice(0, 5).map((s) => (
                    <div key={s.requestIdStr} className="farm-metric">
                      <span className="faint">#{s.requestIdStr} · {fmt(fromStETHWei(s.amountOfStETHWei), 4)} stETH · {new Date(s.timestamp * 1000).toLocaleString()}</span>
                      <span className="pill pill-rgb">{t('farm.lido.pending')}</span>
                    </div>
                  ))}
                </div>
              )}
              {claimable.length > 0 && (
                <div>
                  <p className="faint" style={{ margin: '4px 0' }}>{t('farm.lido.claimableListTitle')}</p>
                  {claimable.slice(0, 5).map((s) => (
                    <div key={s.requestIdStr} className="farm-metric">
                      <span className="faint">#{s.requestIdStr} · {fmt(fromStETHWei(s.amountOfStETHWei), 4)} stETH</span>
                      <button className="tag" onClick={() => setClaimId(s.requestIdStr)}>{t('farm.lido.useId')}</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <StepList steps={plan?.steps} t={t} />

          {blockedByPlan && (
            <p className="notice notice-danger" style={{ margin: 0 }}>
              {plan.checks.blocked.map((code) => t(`farm.lido.block.${code}`, { defaultValue: code })).join(' · ')}
            </p>
          )}

          {simulating && <p className="faint" style={{ margin: 0 }}>{t('farm.lido.simulating')}</p>}
          {simulation?.status === 'simulated-clean' && (
            <p className="notice" style={{ margin: 0 }}>{t('farm.lido.simClean')}</p>
          )}
          {simulation?.status === 'revert-detected' && (
            <p className="notice notice-danger" style={{ margin: 0 }}>
              {t('farm.lido.simRevert')}: {simulation.revert?.key ? t(simulation.revert.key) : (simulation.revertReason ?? '—')}
            </p>
          )}
          {simulation?.status === 'provider-busy' && (
            <p className="notice notice-danger" style={{ margin: 0 }}>{t('farm.lido.simBusy')}</p>
          )}
          {simulation?.status === 'unknown' && plan?.steps?.length > 0 && (
            <p className="notice" style={{ margin: 0 }}>{t('farm.lido.simNotRun')}</p>
          )}

          {error && <p className="notice notice-danger" style={{ margin: 0 }}>{error}</p>}

          {lastTx && (
            <a className="faint" href={explorerTx(LIDO.chainId, lastTx.hash)} target="_blank" rel="noopener noreferrer" dir="ltr">
              {t('farm.lido.viewTx')}
            </a>
          )}

          <div className="farm-actions">
            <button className="btn btn-primary farm-btn" disabled={!canSign} onClick={execute}>
              {busy === 'signing' ? t('farm.lido.working') : (
                mode === 'stake' ? t('farm.lido.stakeInApp')
                  : mode === 'wrap' ? t('farm.lido.wrap')
                    : mode === 'unwrap' ? t('farm.lido.unwrap')
                      : mode === 'requestWithdraw' ? t('farm.lido.requestWithdraw')
                        : t('farm.lido.claim')
              )}
            </button>
            <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>

          {history.length > 0 && (
            <div>
              <p className="section-label" style={{ margin: '6px 0 4px' }}>{t('farm.lido.recentTitle')}</p>
              {history.slice(0, 5).map((r) => (
                <div key={r.id} className="farm-metric">
                  <span className="faint">
                    {t(`farm.lido.action.${r.action}`, { defaultValue: r.action })} · {r.amount != null ? `${r.amount} ${r.symbol}` : r.requestId ? `#${r.requestId}` : '—'} · {new Date(r.at).toLocaleString()}
                  </span>
                  <span className="mono">{t(`farm.lido.status.${r.status}`, { defaultValue: r.status })}</span>
                </div>
              ))}
            </div>
          )}

          <InfoBox title={t('farm.lido.riskTitle')} tone="warning" defaultOpen id="farm-lido-risk">
            <p>{t('farm.lido.risk1')}</p>
            <p>{t('farm.lido.risk2')}</p>
            <p>{t('farm.lido.risk3')}</p>
            <p>{t('farm.lido.risk4')}</p>
            <p>{t('farm.lido.risk5')}</p>
          </InfoBox>
        </div>
      </Sheet>
    </section>
  );
}

async function toWei(eth) {
  const { parseUnits } = await import('ethers');
  try {
    return parseUnits(String(eth), 18);
  } catch {
    return null;
  }
}
