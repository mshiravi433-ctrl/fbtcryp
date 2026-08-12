import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Switch from './Switch';
import { estimateSandwichRisk, privateRelayFor, simulateSwap, suggestPriorityFee } from '../lib/mev';

/**
 * Pre-send pipeline: Simulation → Expected → Gas → MEV → Execute.
 *
 * The private-relay toggle is a recommendation. We cannot change the wallet's
 * RPC from here; flipping it records the preference and shows the URL the
 * user (or WalletConnect metadata) can use.
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
    () => estimateSandwichRisk({ slippagePct, priceImpact, amountUsd, bothStable }),
    [slippagePct, priceImpact, amountUsd, bothStable]
  );
  const sim = useMemo(
    () => simulateSwap({
      amountOut, minOut, gasNative, slippagePct, priceImpact, amountUsd, bothStable, chainId
    }),
    [amountOut, minOut, gasNative, slippagePct, priceImpact, amountUsd, bothStable, chainId]
  );
  const relay = privateRelayFor(chainId);
  const tip = suggestPriorityFee({ congested: sandwich.score >= 45 });

  if (!sim) return null;

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
          <span className="mono">{sandwich.score}</span>
        </div>
        <div className="row-between">
          <span className="faint">{t('mev.priority')}</span>
          <span className="mono">{tip.gwei} gwei</span>
        </div>
      </div>

      {relay ? (
        <>
          <div className="set-row" style={{ padding: '10px 0 0' }}>
            <span className="set-row-label">
              <div>{t('mev.privateTitle')}</div>
              <div className="set-row-sub">{t('mev.privateSub', { name: relay.name })}</div>
            </span>
            <Switch on={protectOn} label={t('mev.privateTitle')} onChange={onProtectChange} />
          </div>
          {protectOn && (
            <p className="faint" style={{ marginTop: 8, fontSize: 11, lineHeight: 1.7 }}>
              {t('mev.noKey', { defaultValue: 'No API key needed — switch your wallet RPC to the URL below.' })}
            </p>
          )}
        </>
      ) : (
        <div style={{ marginTop: 8 }}>
          <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.7, margin: 0 }}>{t('mev.noRelay')}</p>
          <p className="faint" style={{ fontSize: 11, lineHeight: 1.7, margin: '6px 0 0' }}>
            {t('mev.noKey', { defaultValue: 'No API key required — on supported chains you only point your wallet at a Protect RPC (e.g. Flashbots on Ethereum).' })}
          </p>
        </div>
      )}

      {protectOn && relay && (
        <p className="mono faint" style={{ marginTop: 6, fontSize: 10, wordBreak: 'break-all' }}>{relay.rpc}</p>
      )}
    </div>
  );
}
