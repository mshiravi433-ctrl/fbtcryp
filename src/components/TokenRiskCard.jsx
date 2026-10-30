import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useTelegram } from '../context/TelegramContext';
import { fetchTokenRisk, goplusChainId } from '../lib/tokenRisk';
import { IconChevronRight } from './Icons';

/**
 * Live token-security card — collapsible.
 *
 * The header is always visible and shows the level pill (Low/Medium/High/…)
 * so the user can see the verdict at a glance without expanding. Tapping
 * opens the breakdown (liquidity, holders, contract risk, rug %, flags).
 *
 * A missing address or an unsupported chain renders nothing.
 */
export default function TokenRiskCard({ chainId, address, symbol, compact = false, onRisk = null, collapsible = true }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const [risk, setRisk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openState, setOpenState] = useState(false);
  const open = collapsible ? openState : true;
  const Head = collapsible ? 'button' : 'div';

  const canScan = useMemo(
    () => Boolean(goplusChainId(chainId) && address && /^0x[a-fA-F0-9]{40}$/.test(address)),
    [chainId, address]
  );

  useEffect(() => {
    if (!canScan) {
      setRisk(null);
      return undefined;
    }
    let alive = true;
    setBusy(true);
    fetchTokenRisk({ chainId, address })
      .then((r) => {
        if (!alive) return;
        setRisk(r);
        // Lift the verdict to the parent so the execution gate can enforce it
        // (block a honeypot, require acknowledgement on high risk). The card
        // stays the display; this callback is how the signing button learns.
        if (typeof onRisk === 'function') onRisk(r);
        // Auto-open when the verdict is scary so a real warning can't hide
        // behind a collapsed header.
        if (r && (r.level === 'critical' || r.level === 'high')) setOpenState(true);
      })
      .catch(() => {
        if (!alive) return;
        setRisk(null);
        // A failed scan is honest data: the gate treats "no report" as
        // unknown, never safe. Lift null so the parent can warn accordingly.
        if (typeof onRisk === 'function') onRisk(null);
      })
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [canScan, chainId, address]);

  if (!canScan) return null;

  const level = risk?.level ?? (busy ? 'unknown' : 'unknown');
  const danger = level === 'critical' || level === 'high';
  const warn = level === 'medium';
  const tone = danger ? 'danger' : warn ? 'warn' : 'info';
  const score = risk?.score != null && Number.isFinite(Number(risk.score))
    ? Math.max(0, Math.min(100, Number(risk.score)))
    : null;

  return (
    <div
      className={`infobox infobox-${tone} token-risk-card ${open ? 'is-open' : ''}`}
      data-risk-level={level}
      style={{ marginTop: 10 }}
    >
      <Head
        type={collapsible ? 'button' : undefined}
        className={`infobox-head${collapsible ? '' : ' is-static'}`}
        aria-expanded={collapsible ? open : undefined}
        onClick={collapsible ? () => { haptic?.('select'); setOpenState((v) => !v); } : undefined}
      >
        <span className="infobox-dot" aria-hidden="true" />
        <span className="infobox-title token-risk-title">
          <span className="token-risk-title-text">
            {t('risk.badge', { symbol: symbol || 'Token' })}
          </span>
          <span className={`pill ${level === 'low' ? 'pill-up' : danger ? 'pill-down' : warn ? '' : 'pill-neutral'}`} style={{ fontSize: 10 }}>
            {busy ? t('common.loading') : t(`risk.level.${level}`)}
          </span>
        </span>
        {collapsible && <motion.span
          className="infobox-chev"
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.18 }}
          aria-hidden="true"
        >
          <IconChevronRight width={15} height={15} />
        </motion.span>}
      </Head>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="infobox-body">
              {busy && !risk && (
                <p className="faint" style={{ fontSize: 12, margin: 0 }}>…</p>
              )}

              {!busy && risk && !risk.unknown && (
                <>
                  {score != null && (
                    <div className="token-risk-score" data-tone={tone}>
                      <div className="token-risk-score-head">
                        <span>{t('risk.score', { defaultValue: 'Security score' })}</span>
                        <strong>{score}<small>/100</small></strong>
                      </div>
                      <div className="token-risk-score-track" role="meter" aria-label={t('risk.score', { defaultValue: 'Security score' })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
                        <span style={{ width: `${score}%` }} />
                      </div>
                    </div>
                  )}
                  <div className="token-risk-metrics">
                    <span className="faint">{t('risk.liquidity')}</span>
                    <span className="mono" style={{ textAlign: 'end' }}>{t(`risk.band.${risk.liquidityRisk}`)}</span>
                    <span className="faint">{t('risk.holders')}</span>
                    <span className="mono" style={{ textAlign: 'end' }}>
                      {risk.holderConcentration == null ? '—' : `${risk.holderConcentration}%`}
                    </span>
                    <span className="faint">{t('risk.contract')}</span>
                    <span className="mono" style={{ textAlign: 'end' }}>{t(`risk.band.${risk.contractRisk}`)}</span>
                    <span className="faint">{t('risk.rug')}</span>
                    <span className="mono" style={{ textAlign: 'end' }}>{risk.rugPull}%</span>
                  </div>
                  {risk.honeypot && <p className="notice notice-danger" style={{ marginTop: 8 }}>{t('risk.honeypot')}</p>}
                  {!compact && risk.flags?.slice(0, 3).map((f) => (
                    <p key={f.id} className="faint" style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.6 }}>
                      {t(`risk.flag.${f.id}`, { ...f.values, defaultValue: f.id })}
                    </p>
                  ))}
                </>
              )}

              {!busy && risk?.unknown && (
                <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t('risk.unknown')}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
