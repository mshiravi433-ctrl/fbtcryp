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
export default function TokenRiskCard({ chainId, address, symbol, compact = false, onRisk = null }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const [risk, setRisk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

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
        if (r && (r.level === 'critical' || r.level === 'high')) setOpen(true);
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

  return (
    <div
      className={`infobox infobox-${tone} ${open ? 'is-open' : ''}`}
      style={{ marginTop: 10 }}
    >
      <button
        type="button"
        className="infobox-head"
        aria-expanded={open}
        onClick={() => {
          haptic?.('select');
          setOpen((v) => !v);
        }}
      >
        <span className="infobox-dot" aria-hidden="true" />
        <span className="infobox-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>
            {t('risk.badge', { symbol: symbol || 'Token' })}
          </span>
          <span className={`pill ${level === 'low' ? 'pill-up' : danger ? 'pill-down' : warn ? '' : 'pill-neutral'}`} style={{ fontSize: 10 }}>
            {busy ? t('common.loading') : t(`risk.level.${level}`)}
          </span>
        </span>
        <motion.span
          className="infobox-chev"
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.18 }}
          aria-hidden="true"
        >
          <IconChevronRight width={15} height={15} />
        </motion.span>
      </button>

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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11.5 }}>
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
