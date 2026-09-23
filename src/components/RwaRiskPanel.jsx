import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { fetchTokenRisk, goplusChainId } from '../lib/tokenRisk';
import { assessRwaRisk } from '../lib/rwaTokens';
import { IconChevronRight, IconRefresh, IconShield } from './Icons';
import { useTelegram } from '../context/TelegramContext';

const RANK = { unknown: 0, low: 1, medium: 2, high: 3, critical: 4 };

function worse(a, b) {
  return (RANK[a] ?? 0) >= (RANK[b] ?? 0) ? (a || b) : (b || a);
}

/**
 * AI risk read for one RWA.
 *
 * The contract scanner (GoPlus, via /api/token-risk) is the same engine the
 * swap screen uses. Robinhood Chain is outside that scanner, and a clean
 * ERC-20 report does not cancel an issuer freeze — so the structural read
 * always renders, and the header level is the worse of the two. Never a
 * "safe" badge from missing data.
 */
export default function RwaRiskPanel({ token }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const [open, setOpen] = useState(true);
  const [scan, setScan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);

  const structural = assessRwaRisk(token);
  const supported = Boolean(goplusChainId(token?.chainId) && token?.address);

  useEffect(() => {
    if (!token?.address) {
      setScan(null);
      return undefined;
    }
    let alive = true;
    setBusy(true);
    fetchTokenRisk({ chainId: token.chainId, address: token.address })
      .then((report) => { if (alive) setScan(report); })
      .catch(() => { if (alive) setScan(null); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [token?.chainId, token?.address, nonce]);

  if (!token) return null;

  const scanned = scan && !scan.unknown;
  const level = scanned
    ? worse(scan.level, structural?.level)
    : (structural?.level || 'unknown');
  const danger = level === 'critical' || level === 'high';
  const warn = level === 'medium';
  const tone = danger ? 'danger' : warn ? 'warn' : 'info';

  return (
    <div className={`infobox infobox-${tone} rwa-risk ${open ? 'is-open' : ''}`} id="rwa-risk">
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
        <span className="infobox-title rwa-risk-title">
          <IconShield width={14} height={14} />
          <span>{t('risk.badge', { symbol: token.symbol || 'RWA' })}</span>
          <span className={`pill ${level === 'low' ? 'pill-up' : danger ? 'pill-down' : 'pill-neutral'}`}>
            {busy && !scanned ? t('common.loading') : t(`risk.level.${level}`)}
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
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="infobox-body rwa-risk-body">
              {busy && !scanned && (
                <p className="faint rwa-risk-note">{t('common.loading')}</p>
              )}

              {scanned && (
                <div className="rwa-risk-block">
                  <div className="rwa-risk-kicker">{t('stocks.rwaRiskScan')}</div>
                  <div className="rwa-risk-grid">
                    <span>{t('risk.liquidity')}</span>
                    <span className="mono">{t(`risk.band.${scan.liquidityRisk}`)}</span>
                    <span>{t('risk.holders')}</span>
                    <span className="mono">{scan.holderConcentration == null ? '—' : `${scan.holderConcentration}%`}</span>
                    <span>{t('risk.contract')}</span>
                    <span className="mono">{t(`risk.band.${scan.contractRisk}`)}</span>
                    <span>{t('risk.rug')}</span>
                    <span className="mono">{scan.rugPull}%</span>
                  </div>
                  {scan.honeypot && <p className="notice notice-danger">{t('risk.honeypot')}</p>}
                  {scan.flags?.slice(0, 3).map((flag) => (
                    <p key={flag.id} className="rwa-risk-flag">
                      {t(`risk.flag.${flag.id}`, { ...flag.values, defaultValue: flag.id })}
                    </p>
                  ))}
                </div>
              )}

              {!busy && !scanned && (
                <p className="rwa-risk-note">
                  {supported ? t('risk.unknown') : t('stocks.rwaRiskScannerGap')}
                </p>
              )}

              {structural?.flags?.length > 0 && (
                <div className="rwa-risk-block">
                  <div className="rwa-risk-kicker">{t('stocks.rwaRiskStructural')}</div>
                  {structural.flags.map((flag) => (
                    <p key={flag.id} className={`rwa-risk-flag rwa-risk-flag-${flag.severity}`}>
                      {t(`stocks.rwaFlag.${flag.id}`)}
                    </p>
                  ))}
                </div>
              )}

              {supported && !busy && (
                <button
                  type="button"
                  className="rwa-risk-retry"
                  onClick={() => {
                    haptic?.('select');
                    setNonce((n) => n + 1);
                  }}
                >
                  <IconRefresh width={13} height={13} />
                  <span>{t('stocks.rwaRiskRetry')}</span>
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
