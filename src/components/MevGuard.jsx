import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Switch from './Switch';
import {
  chainAdjustedRisk,
  estimateSandwichRisk,
  mevChainModel,
  privateRelayFor,
  simulateSwap,
  suggestPriorityFee
} from '../lib/mev';

/**
 * Pre-send pipeline: Simulation → Expected → Gas → MEV → Execute.
 *
 * The private-relay toggle is a recommendation. We cannot change the wallet's
 * RPC from here; flipping it records the preference and shows the URL the
 * user (or WalletConnect metadata) can use.
 *
 * ─── 2026-10-03: THE SENTENCE UNDER THE TOGGLE ─────────────────────────────
 * The card used to print one sentence for every chain — "Prefer {{name}} so
 * this swap stays out of the public mempool" — which is false in two different
 * directions at once. On a chain with no public mempool there is no "public
 * mempool" to stay out of, and on a chain where the only endpoint we have is a
 * plain RPC the sentence promises protection the endpoint does not provide.
 *
 * So the wording now follows `relay.kind`, and the risk number is discounted
 * by the chain's own mempool model (see chainAdjustedRisk) rather than being
 * presented as the same score it would be on Ethereum.
 */
export default function MevGuard({
  chainId,
  slippagePct,
  priceImpact,
  amountUsd,
  amountOut,
  minOut,
  gasNative,
  bothStable,
  protectOn,
  onProtectChange
}) {
  const { t } = useTranslation();
  const sandwich = useMemo(
    () => chainAdjustedRisk(
      chainId,
      estimateSandwichRisk({ slippagePct, priceImpact, amountUsd, bothStable })
    ),
    [chainId, slippagePct, priceImpact, amountUsd, bothStable]
  );
  const sim = useMemo(
    () => simulateSwap({
      amountOut, minOut, gasNative, slippagePct, priceImpact, amountUsd, bothStable, chainId
    }),
    [amountOut, minOut, gasNative, slippagePct, priceImpact, amountUsd, bothStable, chainId]
  );
  const relay = privateRelayFor(chainId);
  const model = mevChainModel(chainId);
  const tip = suggestPriorityFee({ congested: sandwich.score >= 45 });

  if (!sim) return null;

  /* The one sentence that says what the toggle actually does on THIS chain. */
  const relaySub = !relay
    ? null
    : relay.kind === 'sequencer'
      ? t('mev.privateSubSequencer', { name: relay.name })
      : relay.kind === 'encrypted'
        ? t('mev.privateSubEncrypted', { name: relay.name })
        : t('mev.privateSub', { name: relay.name });

  return (
    <div className="card card-tight" style={{ marginTop: 10 }}>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 12.5 }}>{t('mev.title')}</strong>
        <span className={`pill ${sandwich.level === 'low' ? 'pill-up' : sandwich.level === 'high' || sandwich.level === 'critical' ? 'pill-down' : ''}`} style={{ fontSize: 10 }}>
          {t(`mev.level.${sandwich.level}`)}
        </span>
      </div>

      <div className="stack" style={{ gap: 5, fontSize: 11.5 }}>
        <div className="row-between">
          <span className="faint">{t('mev.expected')}</span>
          <span className="mono">{Number(sim.expectedOut).toPrecision(6)}</span>
        </div>
        <div className="row-between">
          <span className="faint">{t('mev.minOut')}</span>
          <span className="mono">{Number(sim.minOut).toPrecision(6)}</span>
        </div>
        {sim.gasNative != null && (
          <div className="row-between">
            <span className="faint">{t('mev.gas')}</span>
            <span className="mono">{sim.gasNative.toFixed(5)}</span>
          </div>
        )}
        <div className="row-between">
          <span className="faint">{t('mev.sandwich')}</span>
          <span className="mono">
            {sandwich.score}
            {sandwich.adjusted ? <span className="faint"> / {sandwich.rawScore}</span> : null}
          </span>
        </div>
        <div className="row-between">
          <span className="faint">{t('mev.priority')}</span>
          <span className="mono">{tip.gwei} gwei</span>
        </div>
      </div>

      {/*
        HOW THIS CHAIN ORDERS TRANSACTIONS. Printed before the toggle because
        it is the reason the score above reads the way it does — a discounted
        number with no explanation is just a smaller number the user has to
        trust.
      */}
      {model && (
        <p className="faint" style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.7 }}>
          {t(`mev.model.${model.mempool}`)}
          {sandwich.adjusted ? ` ${t('mev.scoreAdjusted')}` : ''}
        </p>
      )}

      {relay ? (
        <div className="set-row" style={{ padding: '10px 0 0' }}>
          <span className="set-row-label">
            <div>{t('mev.privateTitle')}</div>
            <div className="set-row-sub">{relaySub}</div>
          </span>
          <Switch on={protectOn} label={t('mev.privateTitle')} onChange={onProtectChange} />
        </div>
      ) : (
        /* Two different absences, two different sentences. "No relay yet"
           implies one is coming; on a chain with a public mempool and no
           documented private relay, the honest statement is that we could not
           verify one — and that slippage is what is left. */
        <p className="faint" style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.7 }}>
          {model?.mempool === 'public' ? t('mev.noRelay') : t('mev.noRelayUnknownChain')}
        </p>
      )}

      {protectOn && relay && (
        <p className="mono faint" style={{ marginTop: 6, fontSize: 10, wordBreak: 'break-all' }}>{relay.rpc}</p>
      )}
    </div>
  );
}
