import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GlyphChevron } from './MarketGlyphs.jsx';
import { fmtCompact, fmtNum } from '../../lib/format.js';
import { mergeNetworkTelemetry } from '../../lib/fbtSwapNetworks.js';

function GlyphNetworksMesh() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="4" r="2.2" stroke="currentColor" strokeWidth="1.45" />
      <circle cx="4" cy="14.5" r="2.2" stroke="currentColor" strokeWidth="1.45" />
      <circle cx="16" cy="14.5" r="2.2" stroke="currentColor" strokeWidth="1.45" />
      <circle cx="10" cy="11" r="1.6" fill="currentColor" />
      <path
        d="M10 6.2V9.4M8.6 11.9L5.9 13.4M11.4 11.9L14.1 13.4"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GlyphExternal() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M8.2 2.5H11.5V5.8M11.2 2.8L6.2 7.8M5.8 3.5H3.3C2.86 3.5 2.5 3.86 2.5 4.3V10.7C2.5 11.14 2.86 11.5 3.3 11.5H9.7C10.14 11.5 10.5 11.14 10.5 10.7V8.2"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const INITIAL_VISIBLE = 8;

function MarketFbtNetworks({ swapNetworks = null }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRtl =
    typeof i18n?.dir === 'function'
      ? i18n.dir() === 'rtl'
      : /^(fa|ar|ur|he)\b/i.test(String(i18n?.language || 'fa'));

  const [family, setFamily] = useState('all');
  const [expanded, setExpanded] = useState(false);

  const model = useMemo(
    () => swapNetworks || mergeNetworkTelemetry({ loading: true }),
    [swapNetworks]
  );

  const filtered = useMemo(() => {
    if (family === 'all') return model.networks;
    return model.networks.filter((n) => n.family === family);
  }, [model.networks, family]);

  const visibleNetworks = useMemo(() => {
    if (family !== 'all' || expanded) return filtered;
    return filtered.slice(0, INITIAL_VISIBLE);
  }, [filtered, family, expanded]);

  const anyChecking = model.networks.some((n) => n.status === 'checking');

  const statusLabelFor = (status) => {
    if (status === 'online') return t('marketPhase2.netStatusOnline');
    if (status === 'slow') return t('marketPhase2.netStatusSlow');
    if (status === 'checking') return t('marketPhase2.netStatusChecking');
    return t('marketPhase2.netStatusOffline');
  };

  return (
    <section
      className="mx-p2-card mx-net-card"
      data-testid="market-fbt-networks"
      aria-label={t('marketPhase2.netTitle')}
    >
      <header className="mx-p2-head">
        <div className="mx-p2-title-wrap">
          <span className="mx-p2-mark mx-p2-mark--emerald">
            <GlyphNetworksMesh />
          </span>
          <div className="mx-p2-headings">
            <span className="mx-p2-eyebrow" dir="ltr">
              {t('marketPhase2.netEyebrow')}
            </span>
            <h2 className="mx-p2-title">{t('marketPhase2.netTitle')}</h2>
            <p className="mx-p2-sub">{t('marketPhase2.netSubtitle')}</p>
          </div>
        </div>

        <div className="mx-p2-seg" role="group" aria-label={t('marketPhase2.netTitle')}>
          {[
            ['all', `${t('marketPhase2.netFilterAll')} (${model.totalCount})`],
            ['l1', t('marketPhase2.netFilterL1')],
            ['l2', t('marketPhase2.netFilterL2')],
            ['non-evm', t('marketPhase2.netFilterNonEvm')]
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={family === id}
              className={`mx-p2-seg-btn${family === id ? ' is-active' : ''}`}
              onClick={() => setFamily(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-net-kpis">
        <div className="mx-net-kpi">
          <span className="mx-net-kpi-lbl">{t('marketPhase2.netStatOnline')}</span>
          <strong className="mx-net-kpi-val" dir="ltr">
            {anyChecking && model.onlineCount === 0
              ? `— / ${model.totalCount}`
              : `${model.onlineCount} / ${model.totalCount}`}
          </strong>
        </div>

        <div className="mx-net-kpi">
          <span className="mx-net-kpi-lbl">{t('marketPhase2.netStatLatency')}</span>
          <strong className="mx-net-kpi-val" dir="ltr">
            {model.medianLatencyMs != null ? `${model.medianLatencyMs} ms` : '—'}
          </strong>
        </div>

        <div className="mx-net-kpi">
          <span className="mx-net-kpi-lbl">{t('marketPhase2.netStatRouters')}</span>
          <strong className="mx-net-kpi-val" dir="ltr">
            {model.executorCount}
          </strong>
          <span className="mx-net-kpi-sub" dir="ltr">
            {model.executors.slice(0, 4).join(' · ')}
          </span>
        </div>

        <div className="mx-net-kpi">
          <span className="mx-net-kpi-lbl">{t('marketPhase2.netStatTvl')}</span>
          <strong className="mx-net-kpi-val" dir="ltr">
            {model.totalFbtTvlUsd ? `$${fmtCompact(model.totalFbtTvlUsd)}` : '—'}
          </strong>
        </div>
      </div>

      <div className="mx-net-grid" role="list">
        {visibleNetworks.map((net) => {
          const isBridgeRail = net.swapHref.startsWith('/bridge');
          return (
            <article
              key={net.key}
              role="listitem"
              className="mx-net-item"
              data-status={net.status}
              data-chain-key={net.key}
            >
              <div className="mx-net-item-head">
                <div className="mx-net-id">
                  <span
                    className="mx-net-orb"
                    style={{ '--net-color': net.color }}
                    aria-hidden="true"
                  >
                    <span className="mx-net-orb-core" />
                  </span>
                  <div className="mx-net-names">
                    <strong>{net.name}</strong>
                    <span dir="ltr">
                      {net.nativeSymbol} · {net.family === 'non-evm' ? 'Native' : net.family.toUpperCase()}
                    </span>
                  </div>
                </div>

                <span className="mx-net-status" data-status={net.status}>
                  <span className="mx-net-status-dot" aria-hidden="true" />
                  <span>{statusLabelFor(net.status)}</span>
                </span>
              </div>

              <div className="mx-net-telemetry" dir="ltr">
                <div className="mx-net-tel-cell">
                  <small>{t('marketPhase2.netLatency')}</small>
                  <b>{net.latencyMs != null ? `${net.latencyMs} ms` : '—'}</b>
                </div>
                <div className="mx-net-tel-cell">
                  <small>{t('marketPhase2.netBlock')}</small>
                  <b>{net.latestBlock != null ? `#${fmtNum(net.latestBlock, 0)}` : '—'}</b>
                </div>
                <div className="mx-net-tel-cell">
                  <small>{t('marketPhase2.netCadence')}</small>
                  <b>{net.feeHint || (net.cadence ? `~${net.cadence}` : '—')}</b>
                </div>
              </div>

              <div className="mx-net-item-foot">
                <div className="mx-net-router-meta">
                  <span className="mx-net-router-pill" dir="ltr">{net.primaryExecutor}</span>
                  {net.redundancy > 1 && (
                    <span className="mx-net-red-badge">
                      {net.redundancy} {t('marketPhase2.netRoutesRedundant')}
                    </span>
                  )}
                  {net.tvlUsd != null && (
                    <span className="mx-net-tvl-pill" dir="ltr">
                      ${fmtCompact(net.tvlUsd)}
                    </span>
                  )}
                </div>

                <div className="mx-net-actions">
                  {net.explorer && (
                    <a
                      href={net.explorer}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mx-net-ext-link"
                      aria-label={`${net.name} Explorer`}
                      title={net.explorer}
                    >
                      <GlyphExternal />
                    </a>
                  )}
                  <button
                    type="button"
                    className="mx-net-swap-btn"
                    onClick={() => navigate(net.swapHref)}
                  >
                    <span>
                      {isBridgeRail
                        ? t('marketPhase2.netBridgeNow')
                        : t('marketPhase2.netSwapNow')}
                    </span>
                    <span className={`mx-p2-chev${isRtl ? ' is-rtl' : ''}`}>
                      <GlyphChevron />
                    </span>
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {family === 'all' && filtered.length > INITIAL_VISIBLE && (
        <div className="mx-net-more-row">
          <button
            type="button"
            className="mx-net-more-btn"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            <span>
              {expanded
                ? t('marketPhase2.netShowLess')
                : t('marketPhase2.netShowAll')}
            </span>
          </button>
        </div>
      )}
    </section>
  );
}

export default memo(MarketFbtNetworks);
