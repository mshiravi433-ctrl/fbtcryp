import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Sheet from '../Sheet';
import InfoBox from '../InfoBox';
import { IconShield, IconSwap } from '../Icons';
import { useWallet } from '../../context/WalletContext';
import { EVM_CHAINS, explorerAddr, explorerTx } from '../../lib/chains';
import {
  COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX, COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL,
  COMPOUND_BASE_SUPPLY_ALLOWLIST, compoundBaseSupplyAllowedFor, compoundBaseWithdrawAllowedFor
} from '../../lib/features';
import { COMPOUND_BASE_SUPPLY_OPEN_TO_PUBLIC } from '../../lib/farmRolloutMode';
import {
  COMPOUND_V3_BASE, buildRevokePlan, buildSupplyPlan, buildWithdrawPlan,
  explainRevert, fromUsdcWei, getPosition, getMarketStatus, isCompoundBaseUsdcPool,
  verifyCompoundReceipt
} from '../../lib/defi/compoundV3Base';
import { localChainLabel } from '../../lib/farmDeFi';
import {
  cancelCompoundAction, confirmCompoundAction, derivePartialApprovalState, failCompoundAction,
  replaceCompoundAction, timeoutCompoundAction, loadCompoundHistoryFor, recordCompoundAction
} from '../../lib/defi/compoundV3History';
import {
  buildUnsignedTransaction, simulateUnsignedTransaction
} from '../../lib/preSignSimulation';
import { evaluateExecutionGate, isBlocked } from '../../lib/executionGate';
import {
  executeGuardedStep, simulateGuardedStep, isTransactionReplacement, isTransactionTimeout, isUserRejection
} from '../../lib/defi/guardedExecution';
import { farmErrorLabel, farmErrorText } from '../../lib/defi/farmErrors';

/*
 * COMPOUND V3 · BASE · USDC — the in-app supply / withdraw surface.
 * ---------------------------------------------------------------------------
 * This is the ONLY place the Compound adapter is driven from a UI. Everything
 * about the transaction is decided in lib/defi/compoundV3Base.js (amounts,
 * caps, calldata); this file only renders it, asks for a simulation before
 * every signature, and records what happened locally.
 *
 * Three rules this file must not break:
 *   · The sign button stays disabled until the pre-sign simulation ran CLEAN.
 *     A busy RPC is not a clean simulation and must not be dressed up as one.
 *   · Withdraw is reachable whenever there is something to withdraw, even with
 *     the feature flag off. Killing the entry point would strand the funds.
 *   · The APY shown is the COMPOUNDED figure, and the simple APR Compound's own
 *     interface prints is shown beside it, labelled. Comet quotes a per-second
 *     rate; printing one and calling it the other is the kind of number a user
 *     later discovers was never real.
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
 * The plain-language step list shown before signing. "1. Allow Compound to use
 * exactly X USDC  2. Supply X USDC" — never a hex blob.
 */
function StepList({ steps, t }) {
  if (!steps?.length) return null;
  return (
    <ol className="farm-compound-steps" style={{ margin: '8px 0 0', paddingLeft: 20 }}>
      {steps.map((s, i) => (
        <li key={`${s.kind}-${i}`} style={{ fontSize: 12.6, lineHeight: 1.9 }}>
          {s.description?.amount != null
            ? t(s.description.key, { amount: s.description.amount, symbol: COMPOUND_V3_BASE.usdcSymbol })
            : t(s.description.key, { symbol: COMPOUND_V3_BASE.usdcSymbol })}
        </li>
      ))}
    </ol>
  );
}

export default function CompoundBaseUsdcPanel({ pool }) {
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

  const isTarget = isCompoundBaseUsdcPool(pool);
  const owner = wallet.address;
  const supplyAllowed = compoundBaseSupplyAllowedFor(owner);
  const hasPosition = (position?.suppliedUsdc ?? 0n) > 0n;
  const withdrawAllowed = compoundBaseWithdrawAllowedFor({ owner, hasPosition });

  /* ── read the position + market status ──────────────────────────────────── */
  const refresh = useCallback(async () => {
    if (!isTarget || !owner) return;
    /*
     * Local history helps recovery, but is never the source of truth. The
     * position is read from pinned Base contracts even when the wallet is on
     * another network, so an imported wallet can still discover its exit.
     */
    setHistory(loadCompoundHistoryFor(owner));
    // Position discovery uses the pinned Base read provider on every wallet
    // network. Signing remains blocked until the wallet explicitly switches.
    setBusy('loading');
    try {
      const provider = await wallet.getReadProvider(COMPOUND_V3_BASE.chainId);
      const [pos, mkt, rows] = await Promise.all([
        getPosition(provider, owner, { history: loadCompoundHistoryFor(owner) }).catch(() => null),
        getMarketStatus(provider).catch(() => null),
        Promise.resolve(loadCompoundHistoryFor(owner))
      ]);
      if (!alive.current) return;
      setPosition(pos);
      setStatus(mkt);
      setHistory(rows);
      const bal = await walletBalanceOf(provider, owner);
      if (!alive.current) return;
      setWalletUsdc(bal);
      const allowance = await walletAllowanceOf(provider, owner);
      setPartial(derivePartialApprovalState({
        owner,
        allowanceUsdcWei: allowance ?? 0n,
        positionUsdcWei: pos?.suppliedUsdc ?? 0n
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
  /*
   * No supply-cap term here, unlike the Aave card: Comet enforces supply caps
   * on collateral assets only, so the base-asset maximum is the lowest of our
   * own two caps and the wallet balance. Inventing a protocol cap to make the
   * two cards symmetrical would be inventing a number.
   */
  const maxSupplyUsdc = useMemo(() => {
    const limits = [
      COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX,
      COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL - (position ? Number(fromUsdcWei(position.suppliedUsdc)) : 0)
    ];
    if (walletUsdc != null) limits.push(Number(fromUsdcWei(walletUsdc)));
    return Math.max(0, Math.min(...limits));
  }, [position, walletUsdc]);

  const maxWithdrawUsdc = position ? Number(fromUsdcWei(position.suppliedUsdc)) : 0;

  /* ── build the plan whenever the amount changes ─────────────────────────── */
  const buildPlan = useCallback(async (nextAmount, nextMode) => {
    setSimulation(null);
    setPlan(null);
    if (!owner || !(Number(nextAmount) > 0)) return;
    try {
      const provider = await wallet.getReadProvider(COMPOUND_V3_BASE.chainId);
      const built = nextMode === 'withdraw'
        ? await buildWithdrawPlan({ provider, owner, amountUsdc: nextAmount })
        : await buildSupplyPlan({
            provider, owner, amountUsdc: nextAmount,
            history: loadCompoundHistoryFor(owner),
            nativeBalance: wallet.nativeBalance == null
              ? null
              : await toWei(wallet.nativeBalance)
          });
      if (!alive.current) return;
      setPlan(built);
    } catch (err) {
      if (alive.current) setError(farmErrorText(err, t, explainRevert(err)));
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
        const provider = await wallet.getReadProvider(COMPOUND_V3_BASE.chainId);
        const tx = buildUnsignedTransaction({ from: owner, to: step.to, data: step.data, value: 0n });
        const outcome = await simulateUnsignedTransaction({
          provider,
          tx,
          allowance: step.kind === 'supply'
            ? { token: COMPOUND_V3_BASE.usdc, owner, spender: COMPOUND_V3_BASE.comet, amountWei: plan.checks.amountWei ?? 0n }
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
    // USDC on a verified Comet market: no token-risk scan is run here, so the
    // gate keys off the simulation. An absent simulation is a warning, not a
    // pass — see lib/executionGate.js.
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
      provider = await wallet.getReadProvider(COMPOUND_V3_BASE.chainId);
      for (let i = 0; i < plan.steps.length; i += 1) {
        const step = plan.steps[i];
        const record = recordCompoundAction({
          action: step.kind,
          owner,
          chainId: COMPOUND_V3_BASE.chainId,
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
              ? { token: COMPOUND_V3_BASE.usdc, owner, spender: COMPOUND_V3_BASE.comet, amountWei: plan.checks.amountWei ?? 0n }
              : undefined
          });
          const before = step.kind === 'supply' || step.kind === 'withdraw'
            ? await getPosition(provider, owner)
            : null;
          const result = await executeGuardedStep({
            signer, provider, owner, chainId: COMPOUND_V3_BASE.chainId, step,
            verifyReceipt: ({ receipt }) => verifyCompoundReceipt({
              provider, receipt, owner, action: step.kind,
              amountWei: plan.checks.amountWei,
              beforePositionWei: before?.suppliedUsdc ?? null
            })
          });
          confirmCompoundAction(record.id, {
            txHash: result.receipt?.hash ?? result.tx.hash,
            blockNumber: result.receipt?.blockNumber ?? null
          });
          setLastTx({ hash: result.receipt?.hash ?? result.tx.hash, kind: step.kind });
        } catch (err) {
          const explained = explainRevert(err);
          if (isUserRejection(err)) cancelCompoundAction(record.id, 'USER_REJECTED');
          else if (isTransactionTimeout(err)) timeoutCompoundAction(record.id);
          else if (isTransactionReplacement(err)) replaceCompoundAction(record.id, {
            error: err?.code ?? 'TRANSACTION_REPLACED',
            txHash: err?.replacement?.hash ?? err?.receipt?.hash ?? null
          });
          else failCompoundAction(record.id, {
            error: err?.code ?? explained.reason ?? err?.message ?? 'FAILED',
            revertKey: explained.key
          });
          const label = isUserRejection(err)
            ? t('farm.compound.userRejected', { defaultValue: 'Signature rejected' })
            : isTransactionTimeout(err)
              ? t('farm.compound.timeout', { defaultValue: 'Transaction is still pending; check the wallet or explorer.' })
              : isTransactionReplacement(err)
                ? t('farm.compound.replaced', { defaultValue: 'Transaction was replaced or cancelled.' })
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
      const provider = await wallet.getReadProvider(COMPOUND_V3_BASE.chainId);
      const { steps } = await buildRevokePlan({ provider, owner });
      await simulateGuardedStep({ provider, owner, step: steps[0] });
      const result = await executeGuardedStep({
        signer, provider, owner, chainId: COMPOUND_V3_BASE.chainId, step: steps[0],
        verifyReceipt: ({ receipt }) => verifyCompoundReceipt({
          provider, receipt, owner, action: 'revoke', amountWei: 0n
        })
      });
      recordCompoundAction({
        action: 'revoke', owner, chainId: COMPOUND_V3_BASE.chainId, amountUsdcWei: '0',
        txHash: result.receipt?.hash ?? result.tx.hash,
        blockNumber: result.receipt?.blockNumber ?? null, status: 'confirmed'
      });
      setPartial({ needed: false, allowanceUsdcWei: 0n, source: null, lastApprove: null });
    } catch (err) {
      const explained = explainRevert(err);
      setError(isUserRejection(err)
        ? t('farm.compound.userRejected', { defaultValue: 'Signature rejected' })
        : isTransactionTimeout(err)
          ? t('farm.compound.timeout', { defaultValue: 'Transaction is still pending; check the wallet or explorer.' })
          : (explained.key ? t(explained.key) : farmErrorLabel(err, t)));
    } finally {
      setBusy('');
      await refresh();
    }
  }, [owner, refresh, t, wallet]);

  if (!isTarget) return null;
  const wrongChain = wallet.isConnected && wallet.chainId !== COMPOUND_V3_BASE.chainId;
  /*
   * Kill switch. With the flag off, supply is gone — and if there is also no
   * position to withdraw, there is nothing left for this panel to say, so it
   * renders nothing rather than an empty card. A position still renders: the
   * withdrawal path is never gated.
   * On another network, a directly read position (or a recovery record) keeps
   * the card visible and asks for an explicit switch before any signature.
   */
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
  if (!supplyAllowed && !hasPosition && !knownHere && !COMPOUND_BASE_SUPPLY_OPEN_TO_PUBLIC) return null;

  const openSheet = (nextMode) => {
    setMode(nextMode);
    setAmount('');
    setError(null);
    setPlan(null);
    setSimulation(null);
    setOpen(true);
  };

  /*
   * Rewards are stated honestly or not at all. This market only accrues COMP
   * to positions at or above `baseMinForRewards` (1 000 USDC), which is above
   * both of our caps, so the card says so rather than showing a reward line
   * that will always read zero.
   */
  const rewardsOutOfReach =
    status?.rewardsActive === true
    && status?.rewardsMinUsdc != null
    && BigInt(Math.floor(COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL)) * 10n ** BigInt(COMPOUND_V3_BASE.usdcDecimals)
       < status.rewardsMinUsdc;

  return (
    <section className="card card-soft farm-compound-panel" aria-label={t('farm.compound.panelTitle')}>
      <div className="row-between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13.4 }}>
            <span style={{ verticalAlign: '-4px', marginRight: 6 }}><IconShield width={16} height={16} /></span>
            {t('farm.compound.panelTitle')}
          </div>
          <div className="muted" style={{ fontSize: 11.6, margin: '3px 0 0' }}>
            {t('farm.compound.panelSub', { chain: localChainLabel(EVM_CHAINS[COMPOUND_V3_BASE.chainId].name, t), symbol: COMPOUND_V3_BASE.usdcSymbol })}
          </div>
        </div>
        {status?.supplyApyPct != null && (
          <span className="pill pill-neutral mono" dir="ltr">{status.supplyApyPct.toFixed(2)}% {t('farm.compound.apy')}</span>
        )}
      </div>

      {/* ── position ─────────────────────────────────────────────────────── */}
      {hasPosition && (
        <div className="farm-economics" style={{ marginTop: 10 }}>
          <Row label={t('farm.compound.supplied')} value={`${fmtUsdc(position.suppliedUsdc)} ${COMPOUND_V3_BASE.usdcSymbol}`} />
          <Row label={t('farm.compound.usdValue')} value={fmtUsd(position.suppliedUsd)} />
          <Row label={t('farm.compound.apy')} value={status?.supplyApyPct == null ? '—' : `${status.supplyApyPct.toFixed(2)}%`} />
          {/* Compound's own interface prints the simple APR. Both are shown so
              the card cannot be accused of quoting a better number than the
              protocol does. */}
          <Row label={t('farm.compound.apr')} value={status?.supplyAprPct == null ? '—' : `${status.supplyAprPct.toFixed(2)}%`} />
          <Row label={t('farm.compound.accrued')} value={position.accruedSinceUsdc == null ? '—' : `${fmtUsdc(position.accruedSinceUsdc)} ${COMPOUND_V3_BASE.usdcSymbol}`} />
          {/* Comet is one contract for supply AND borrow: a debt opened
              elsewhere belongs on this card, not hidden behind it. */}
          {position.hasBorrow && (
            <Row label={t('farm.compound.borrowed')} value={`${fmtUsdc(position.borrowedUsdc)} ${COMPOUND_V3_BASE.usdcSymbol}`} />
          )}
        </div>
      )}

      {knownHere && (
        <p className="muted" style={{ fontSize: 11.6, margin: '10px 0 0' }}>
          {t('farm.compound.wrongChainNote', { chain: localChainLabel(EVM_CHAINS[COMPOUND_V3_BASE.chainId].name, t) })}
        </p>
      )}

      {/* ── stuck allowance ──────────────────────────────────────────────── */}
      {partial?.needed && (
        <div className="notice notice-danger" style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 6px' }}>
            {t('farm.compound.partialBody', { amount: fmtUsdc(partial.allowanceUsdcWei), symbol: COMPOUND_V3_BASE.usdcSymbol })}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => openSheet('supply')}>
              {t('farm.compound.continue')}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy === 'revoking'} onClick={revoke}>
              {busy === 'revoking' ? t('farm.compound.working') : t('farm.compound.revoke')}
            </button>
          </div>
        </div>
      )}

      {/* ── actions ──────────────────────────────────────────────────────── */}
      <div className="farm-actions" style={{ marginTop: 10 }}>
        {!wallet.isConnected && <span className="faint">{t('farm.compound.connectFirst')}</span>}
        {wrongChain && (
          <button className="btn btn-ghost farm-btn" onClick={() => wallet.switchChain(COMPOUND_V3_BASE.chainId)}>
            {t('farm.compound.switchChain', { chain: localChainLabel(EVM_CHAINS[COMPOUND_V3_BASE.chainId].name, t) })}
          </button>
        )}
        {wallet.isConnected && !wrongChain && supplyAllowed && (
          <button className="btn btn-primary farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('supply')}>
            <IconSwap width={15} height={15} /> {t('farm.compound.supplyInApp')}
          </button>
        )}
        {wallet.isConnected && !wrongChain && withdrawAllowed && (
          <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => openSheet('withdraw')}>
            {t('farm.compound.withdraw')}
          </button>
        )}
        <a
          className="btn btn-ghost farm-btn farm-btn-minor"
          href={explorerAddr(COMPOUND_V3_BASE.chainId, COMPOUND_V3_BASE.comet)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('farm.compound.explorer')}
        </a>
      </div>

      {/* The supply caps are shown, not hidden: a user must be able to see why
          the input stops where it does. */}
      {supplyAllowed && (
        <p className="faint" style={{ margin: '8px 0 0', fontSize: 11.4 }}>
          {t('farm.compound.capsLine', { perTx: COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX, total: COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL })}
          {COMPOUND_BASE_SUPPLY_ALLOWLIST.length > 0 && <> · {t('farm.compound.allowlisted')}</>}
        </p>
      )}

      {rewardsOutOfReach && (
        <p className="faint" style={{ margin: '4px 0 0', fontSize: 11.4 }}>
          {t('farm.compound.rewardsFloor', { min: fmtUsdc(status.rewardsMinUsdc), symbol: COMPOUND_V3_BASE.usdcSymbol })}
        </p>
      )}

      <Sheet open={open} onClose={() => { if (!busy) setOpen(false); }} title={mode === 'withdraw' ? t('farm.compound.withdrawTitle') : t('farm.compound.supplyTitle')} size="md">
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <input
              className="farm-amt-input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0.00"
              aria-label={t('farm.compound.amount')}
              style={{ flex: 1 }}
            />
            <span className="mono">{COMPOUND_V3_BASE.usdcSymbol}</span>
            <button
              className="tag"
              type="button"
              onClick={() => setAmount(String(Math.floor((mode === 'withdraw' ? maxWithdrawUsdc : maxSupplyUsdc) * 1e6) / 1e6))}
            >
              {t('farm.compound.max')}
            </button>
          </div>

          <p className="faint" style={{ margin: 0, fontSize: 11.8 }}>
            {mode === 'withdraw'
              ? t('farm.compound.withdrawMaxHint', { amount: fmtUsd(maxWithdrawUsdc) })
              : t('farm.compound.maxHint', {
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
              {plan.checks.blocked.map((code) => t(`farm.compound.block.${code}`, { defaultValue: code })).join(' · ')}
            </p>
          )}

          {/* Simulation result, shown before every signature. */}
          {simulating && <p className="faint" style={{ margin: 0 }}>{t('farm.compound.simulating')}</p>}
          {simulation?.status === 'simulated-clean' && (
            <p className="notice" style={{ margin: 0 }}>{t('farm.compound.simClean')}</p>
          )}
          {simulation?.status === 'revert-detected' && (
            <p className="notice notice-danger" style={{ margin: 0 }}>
              {t('farm.compound.simRevert')}: {simulation.revert?.key ? t(simulation.revert.key) : (simulation.revertReason ?? '—')}
            </p>
          )}
          {simulation?.status === 'provider-busy' && (
            <p className="notice notice-danger" style={{ margin: 0 }}>{t('farm.compound.simBusy')}</p>
          )}
          {simulation?.status === 'unknown' && plan?.steps?.length > 0 && (
            <p className="notice" style={{ margin: 0 }}>{t('farm.compound.simNotRun')}</p>
          )}

          {error && <p className="notice notice-danger" style={{ margin: 0 }}>{error}</p>}

          {lastTx && (
            <a className="faint" href={explorerTx(COMPOUND_V3_BASE.chainId, lastTx.hash)} target="_blank" rel="noopener noreferrer" dir="ltr">
              {t('farm.compound.viewTx')}
            </a>
          )}

          <div className="farm-actions">
            <button className="btn btn-primary farm-btn" disabled={!canSign} onClick={execute}>
              {busy === 'signing' ? t('farm.compound.working') : (mode === 'withdraw' ? t('farm.compound.withdraw') : t('farm.compound.supplyInApp'))}
            </button>
            <button className="btn btn-ghost farm-btn" disabled={Boolean(busy)} onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>

          {history.length > 0 && (
            <div>
              <p className="section-label" style={{ margin: '6px 0 4px' }}>{t('farm.compound.recentTitle')}</p>
              {history.slice(0, 5).map((r) => (
                <div key={r.id} className="farm-metric">
                  <span className="faint">
                    {t(`farm.compound.action.${r.action}`)} · {r.amountUsdc != null ? `${r.amountUsdc} ${COMPOUND_V3_BASE.usdcSymbol}` : '—'} · {new Date(r.at).toLocaleString()}
                  </span>
                  <span className="mono">{t(`farm.compound.status.${r.status}`)}</span>
                </div>
              ))}
            </div>
          )}

          <InfoBox title={t('farm.compound.riskTitle')} tone="warning" defaultOpen id="farm-compound-risk">
            <p>{t('farm.compound.risk1')}</p>
            <p>{t('farm.compound.risk2')}</p>
            <p>{t('farm.compound.risk3')}</p>
            <p>{t('farm.compound.risk4')}</p>
          </InfoBox>
        </div>
      </Sheet>
    </section>
  );
}

/* ── tiny read helpers (kept here so the adapter stays provider-shape free) ── */
async function walletBalanceOf(provider, owner) {
  const { Contract } = await import('ethers');
  const c = new Contract(COMPOUND_V3_BASE.usdc, ['function balanceOf(address) view returns (uint256)'], provider);
  try {
    return await c.balanceOf(owner);
  } catch {
    return null;
  }
}

async function walletAllowanceOf(provider, owner) {
  const { Contract } = await import('ethers');
  const c = new Contract(COMPOUND_V3_BASE.usdc, ['function allowance(address,address) view returns (uint256)'], provider);
  try {
    return await c.allowance(owner, COMPOUND_V3_BASE.comet);
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
