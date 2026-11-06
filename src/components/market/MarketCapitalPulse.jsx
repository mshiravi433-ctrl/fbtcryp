import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CoinLogo from '../CoinLogo.jsx';
import { fmtCompact, fmtPct } from '../../lib/format.js';
import { marketPrice } from '../../lib/marketPresentation.js';
import { computeCapitalPulse } from '../../lib/marketHeatmap.js';

function GlyphPulseMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M2 10.5H5.4L7.7 5.2L10.8 15.2L13.3 8.4L15.1 10.5H18"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10.8" cy="15.2" r="1.5" fill="currentColor" />
    </svg>
  );
}

function fmtSignedUsd(val) {
  if (val == null || !Number.isFinite(val)) return '—';
  const sign = val >= 0 ? '+' : '-';
  return `${sign}$${fmtCompact(Math.abs(val))}`;
}

function MarketCapitalPulse({ coins = [], global = null, vs = 'usd' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [board, setBoard] = useState('gainers');

  const pulse = useMemo(() => computeCapitalPulse(coins, global), [coins, global]);

  const rows =
    board === 'losers'
      ? pulse.losers
      : board === 'volume'
        ? pulse.volumeLeaders
        : pulse.gainers;

  const breadthUp = pulse.breadthUpPct != null ? Math.round(pulse.breadthUpPct) : 50;

  return (
    <section
      className="mx-p2-card mx-pulse-card"
      data-testid="market-capital-pulse"
      aria-label={t('marketPhase2.pulseTitle')}
    >
      <header className="mx-p2-head">
        <div className="mx-p2-title-wrap">
          <span className="mx-p2-mark mx-p2-mark--violet">
            <GlyphPulseMark />
          </span>
          <div className="mx-p2-headings">
            <span className="mx-p2-eyebrow" dir="ltr">
              {t('marketPhase2.pulseEyebrow')}
            </span>
            <h2 className="mx-p2-title">{t('marketPhase2.pulseTitle')}</h2>
          </div>
        </div>

        <div className="mx-p2-seg" role="group" aria-label={t('marketPhase2.pulseTitle')}>
          <button
            type="button"
            aria-pressed={board === 'gainers'}
            className={`mx-p2-seg-btn${board === 'gainers' ? ' is-active' : ''}`}
            onClick={() => setBoard('gainers')}
          >
            {t('marketPhase2.pulseTabGainers')}
          </button>
          <button
            type="button"
            aria-pressed={board === 'losers'}
            className={`mx-p2-seg-btn${board === 'losers' ? ' is-active' : ''}`}
            onClick={() => setBoard('losers')}
          >
            {t('marketPhase2.pulseTabLosers')}
          </button>
          <button
            type="button"
            aria-pressed={board === 'volume'}
            className={`mx-p2-seg-btn${board === 'volume' ? ' is-active' : ''}`}
            onClick={() => setBoard('volume')}
          >
            {t('marketPhase2.pulseTabVolume')}
          </button>
        </div>
      </header>

      <div className="mx-pulse-kpis">
        <div className="mx-pulse-kpi">
          <span className="mx-pulse-kpi-lbl">{t('marketPhase2.pulseAltShare')}</span>
          <strong className="mx-pulse-kpi-val" dir="ltr">
            {pulse.altcoinSharePct != null ? `${pulse.altcoinSharePct.toFixed(1)}%` : '—'}
          </strong>
          <div className="mx-pulse-meter" aria-hidden="true">
            <span
              className="mx-pulse-meter-fill mx-pulse-meter-fill--violet"
              style={{ width: `${Math.min(100, Math.max(0, pulse.altcoinSharePct || 0))}%` }}
            />
          </div>
        </div>

        <div className="mx-pulse-kpi">
          <span className="mx-pulse-kpi-lbl">{t('marketPhase2.pulseVelocity')}</span>
          <strong className="mx-pulse-kpi-val" dir="ltr">
            {pulse.turnoverPct != null ? `${pulse.turnoverPct.toFixed(2)}%` : '—'}
          </strong>
          <span className="mx-pulse-kpi-note" dir="ltr">
            {pulse.totalVolume ? `$${fmtCompact(pulse.totalVolume)}` : '—'}
          </span>
        </div>

        <div className="mx-pulse-kpi">
          <span className="mx-pulse-kpi-lbl">
            {pulse.netMcapFlow24h != null
              ? t('marketPhase2.pulseNetFlow')
              : t('marketPhase2.pulseMedian')}
          </span>
          <strong
            className="mx-pulse-kpi-val"
            data-dir={
              pulse.netMcapFlow24h != null
                ? pulse.netMcapFlow24h >= 0
                  ? 'up'
                  : 'down'
                : pulse.medianChange24h == null
                  ? 'flat'
                  : pulse.medianChange24h >= 0
                    ? 'up'
                    : 'down'
            }
            dir="ltr"
          >
            {pulse.netMcapFlow24h != null
              ? fmtSignedUsd(pulse.netMcapFlow24h)
              : pulse.medianChange24h != null
                ? fmtPct(pulse.medianChange24h)
                : '—'}
          </strong>
          {pulse.netMcapFlow24h != null && pulse.medianChange24h != null && (
            <span className="mx-pulse-kpi-note" dir="ltr">
              {t('marketPhase2.pulseMedian')}: {fmtPct(pulse.medianChange24h)}
            </span>
          )}
        </div>

        <div className="mx-pulse-kpi">
          <span className="mx-pulse-kpi-lbl">{t('marketPhase2.pulseBreadth')}</span>
          <div className="mx-pulse-breadth-nums" dir="ltr">
            <span className="is-up">
              {pulse.upCount} {t('marketPhase2.pulseUpShort')}
            </span>
            <span className="is-down">
              {pulse.downCount} {t('marketPhase2.pulseDownShort')}
            </span>
          </div>
          <div className="mx-pulse-breadth-bar" aria-hidden="true" dir="ltr">
            <span className="mx-pulse-breadth-up" style={{ width: `${breadthUp}%` }} />
            <span className="mx-pulse-breadth-down" style={{ width: `${100 - breadthUp}%` }} />
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="mx-pulse-list" role="list">
          {rows.map((entry, i) => {
            const { coin, barPct } = entry;
            const chg = Number(coin.change24h);
            const tone = !Number.isFinite(chg) ? 'flat' : chg >= 0 ? 'up' : 'down';
            return (
              <button
                key={coin.id}
                type="button"
                role="listitem"
                className="mx-pulse-row"
                onClick={() => navigate(`/coin/${encodeURIComponent(coin.id)}`)}
              >
                <span className="mx-pulse-rank" dir="ltr">{i + 1}</span>
                <CoinLogo src={coin.image} symbol={coin.symbol} name={coin.name} size={26} />
                <span className="mx-pulse-coin">
                  <span className="mx-pulse-name">{coin.name}</span>
                  <span className="mx-pulse-sym" dir="ltr">{coin.symbol}</span>
                </span>
                <span className="mx-pulse-bar-track" aria-hidden="true" dir="ltr">
                  <span
                    className={`mx-pulse-bar-fill mx-pulse-bar-fill--${board === 'volume' ? 'teal' : tone}`}
                    style={{ width: `${barPct.toFixed(1)}%` }}
                  />
                </span>
                <span className="mx-pulse-figures" dir="ltr">
                  <strong className="mx-pulse-price">{marketPrice(coin.price, vs) || '—'}</strong>
                  {board === 'volume' ? (
                    <span className="mx-pulse-vol">${fmtCompact(entry.value)}</span>
                  ) : (
                    <span className="mx-pulse-delta" data-dir={tone}>
                      {Number.isFinite(chg) ? fmtPct(chg) : '—'}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default memo(MarketCapitalPulse);
