import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchTokenRisk, goplusChainId } from '../lib/tokenRisk';

/**
 * Live token-security card. Shown on Swap (the buy side) and CoinDetail.
 *
 * A missing address or an unsupported chain renders nothing — a "we could
 * not check" slab on every native-coin swap would train people to ignore it.
 */
export default function TokenRiskCard({ chainId, address, symbol, compact = false }) {
  const { t } = useTranslation();
  const [risk, setRisk] = useState(null);
  const [busy, setBusy] = useState(false);

  const canScan = Boolean(goplusChainId(chainId) && address && /^0x[a-fA-F0-9]{40}$/.test(address));

  useEffect(() => {
    if (!canScan) {
      setRisk(null);
      return undefined;
    }
    let alive = true;
    setBusy(true);
    fetchTokenRisk({ chainId, address })
      .then((r) => alive && setRisk(r))
      .catch(() => alive && setRisk(null))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [canScan, chainId, address]);

  if (!canScan) return null;

  const level = risk?.level ?? (busy ? 'unknown' : 'unknown');
  const tone =
    level === 'critical' || level === 'high' ? 'danger' : level === 'medium' ? 'warn' : 'info';

  return (
    <div className={`notice ${tone === 'danger' ? 'notice-danger' : ''}`} style={{ marginTop: 10 }}>
      <div className="row-between" style={{ marginBottom: 6 }}>
        <strong style={{ fontSize: 12.5 }}>
          {t('risk.badge', { symbol: symbol || 'Token' })}
        </strong>
        <span className={`pill ${level === 'low' ? 'pill-up' : level === 'critical' || level === 'high' ? 'pill-down' : ''}`} style={{ fontSize: 10 }}>
          {busy ? t('common.loading') : t(`risk.level.${level}`)}
        </span>
      </div>

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
            <p key={f.id} className="faint" style={{ marginTop: 5, fontSize: 11.5, lineHeight: 1.6 }}>
              {t(`risk.flag.${f.id}`, { ...f.values, defaultValue: f.id })}
            </p>
          ))}
        </>
      )}

      {!busy && risk?.unknown && (
        <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t('risk.unknown')}</p>
      )}
    </div>
  );
}
