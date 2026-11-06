import { memo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MarketSparkline from './MarketSparkline.jsx';
import CoinLogo from '../CoinLogo.jsx';
import AssetIcon from '../AssetIcon.jsx';
import { MarketSelect } from './MarketControlMenu.jsx';
import { FBT_SWAP_NETWORKS } from '../../lib/fbtSwapNetworks.js';
import { GlyphChevron } from './MarketGlyphs.jsx';
import { fmtCompact, fmtPct } from '../../lib/format.js';

function GlyphDefiPrism() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <polygon
        points="10,2 17.5,6.3 17.5,13.7 10,18 2.5,13.7 2.5,6.3"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
      <path d="M10 2V18M2.5 6.3L10 10.4L17.5 6.3" stroke="currentColor" strokeWidth="1.25" strokeOpacity="0.8" />
    </svg>
  );
}

function GlyphRefresh() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.6 8A5.6 5.6 0 1 1 12 4.1M13.8 2.4V5.6H10.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const CHAIN_COLORS = [
  '#627EEA',
  '#14F195',
  '#F0B90B',
  '#F7931A',
  '#0052FF',
  '#28A0F0',
  '#FF060A',
  '#B29AFF'
];

function fmtUsd(v) {
  if (v == null || !Number.isFinite(Number(v)) || Number(v) <= 0) return '—';
  return `$${fmtCompact(Number(v))}`;
}

function fmtSignedUsd(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return `${n >= 0 ? '+' : '-'}$${fmtCompact(Math.abs(n))}`;
}

function MarketDefiIntel({
  defi = null,
  global = null,
  loading = false,
  offline = false,
  onRefresh
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRtl =
    typeof i18n?.dir === 'function'
      ? i18n.dir() === 'rtl'
      : /^(fa|ar|ur|he)\b/i.test(String(i18n?.language || 'fa'));
  const [lens, setLens] = useState('chains');
  const [expanded, setExpanded] = useState(false);
  const changeLens = (value) => { setLens(value); setExpanded(false); };

  const hasData = Boolean(
    defi &&
      (defi.totalTvlUsd != null ||
        defi.topChains?.length > 0 ||
        defi.topProtocols?.length > 0 ||
        defi.stablecoinTotalUsd != null)
  );

  const globalVol = Number(global?.volume);
  const dexSpotRatio =
    defi?.dexVolume24hUsd > 0 && Number.isFinite(globalVol) && globalVol > 0
      ? (defi.dexVolume24hUsd / globalVol) * 100
      : null;

  const topChains = defi?.topChains || [];
  const categories = defi?.categories || [];
  const topProtocols = defi?.topProtocols || [];
  const topStables = defi?.topStablecoins || [];
  const lenses = [
    { value: 'chains', label: t('marketPhase2.defiTabChains') },
    { value: 'categories', label: t('marketPhase2.defiTabCategories') },
    { value: 'protocols', label: t('marketPhase2.defiTabProtocols') },
    { value: 'stables', label: t('marketPhase2.defiTabStables') }
  ];
  const activeRows = lens === 'chains' ? topChains : lens === 'categories' ? categories : lens === 'protocols' ? topProtocols : topStables;
  const limitRows = (rows) => expanded ? rows : rows.slice(0, 4);
  const chainIcon = (chain) => {
    const key = String(chain.name || '').toLowerCase();
    const net = FBT_SWAP_NETWORKS.find((n) => n.name.toLowerCase() === key || n.llamaAliases.includes(key));
    return net ? <AssetIcon chain={net.chainId} size={24} /> : <AssetIcon symbol={chain.symbol || chain.name} size={24} />;
  };

  return (
    <section
      className="mx-p2-card mx-defi-card"
      data-testid="market-defi-intel"
      aria-label={t('marketPhase2.defiTitle')}
    >
      <header className="mx-p2-head">
        <div className="mx-p2-title-wrap">
          <span className="mx-p2-mark mx-p2-mark--amber">
            <GlyphDefiPrism />
          </span>
          <div className="mx-p2-headings">
            <span className="mx-p2-eyebrow" dir="ltr">
              {t('marketPhase2.defiEyebrow')}
            </span>
            <h2 className="mx-p2-title">{t('marketPhase2.defiTitle')}</h2>
            <p className="mx-p2-sub">{t('marketPhase2.defiSubtitle')}</p>
          </div>
        </div>

        <div className="mx-p2-head-right mx-p2-controls">
          <MarketSelect label={t('marketPhase2.controlsView')} value={lens} options={lenses} onChange={changeLens} testId="market-defi-lens" />
          <span
            className="mx-p2-live-pill"
            data-unavailable={offline || !hasData ? 'true' : undefined}
          >
            <span className="mx-p2-live-dot" aria-hidden="true" />
            <span>
              {offline || !hasData
                ? t('marketPhase2.defiOfflineBadge')
                : t('marketPhase2.defiLiveBadge')}
            </span>
          </span>

          {typeof onRefresh === 'function' && (
            <button
              type="button"
              className="mx-p2-icon-btn"
              onClick={onRefresh}
              aria-label={t('marketPhase2.defiRefresh')}
              title={t('marketPhase2.defiRefresh')}
            >
              <GlyphRefresh />
            </button>
          )}
        </div>
      </header>

      <div className="mx-defi-kpis">
        <div className="mx-defi-kpi">
          <span className="mx-defi-kpi-lbl">{t('marketPhase2.defiKpiTvl')}</span>
          <strong className="mx-defi-kpi-val" dir="ltr">
            {fmtUsd(defi?.totalTvlUsd)}
          </strong>
          <div className="mx-defi-kpi-sub" dir="ltr">
            {defi?.tvlChange24hPct != null && (
              <span data-dir={defi.tvlChange24hPct >= 0 ? 'up' : 'down'}>
                {fmtPct(defi.tvlChange24hPct)}
              </span>
            )}
            {defi?.ethSharePct != null && (
              <span>
                {t('marketPhase2.defiKpiEthShare')}: {defi.ethSharePct.toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        <div className="mx-defi-kpi">
          <span className="mx-defi-kpi-lbl">{t('marketPhase2.defiKpiStables')}</span>
          <strong className="mx-defi-kpi-val" dir="ltr">
            {fmtUsd(defi?.stablecoinTotalUsd)}
          </strong>
          <div className="mx-defi-kpi-sub" dir="ltr">
            {defi?.stablecoinNet24hUsd != null ? (
              <span data-dir={defi.stablecoinNet24hUsd >= 0 ? 'up' : 'down'}>
                {t('marketPhase2.defiKpiNet24h')}: {fmtSignedUsd(defi.stablecoinNet24hUsd)}
              </span>
            ) : (
              <span>—</span>
            )}
          </div>
        </div>

        <div className="mx-defi-kpi">
          <span className="mx-defi-kpi-lbl">{t('marketPhase2.defiKpiDexVol')}</span>
          <strong className="mx-defi-kpi-val" dir="ltr">
            {fmtUsd(defi?.dexVolume24hUsd)}
          </strong>
          <div className="mx-defi-kpi-sub" dir="ltr">
            {defi?.dexChange24hPct != null && (
              <span data-dir={defi.dexChange24hPct >= 0 ? 'up' : 'down'}>
                {fmtPct(defi.dexChange24hPct)}
              </span>
            )}
            {dexSpotRatio != null && (
              <span>
                {t('marketPhase2.defiKpiDexRatio')}: {dexSpotRatio.toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        <div className="mx-defi-kpi">
          <span className="mx-defi-kpi-lbl">{t('marketPhase2.defiKpiFees')}</span>
          <strong className="mx-defi-kpi-val" dir="ltr">
            {fmtUsd(defi?.fees24hUsd)}
          </strong>
          <div className="mx-defi-kpi-sub" dir="ltr">
            {defi?.revenue24hUsd != null ? (
              <span>
                {t('marketPhase2.defiKpiRevenue')}: {fmtUsd(defi.revenue24hUsd)}
              </span>
            ) : defi?.feesChange24hPct != null ? (
              <span data-dir={defi.feesChange24hPct >= 0 ? 'up' : 'down'}>
                {fmtPct(defi.feesChange24hPct)}
              </span>
            ) : (
              <span>—</span>
            )}
          </div>
        </div>
      </div>

      {Array.isArray(defi?.tvlHistory90d) && defi.tvlHistory90d.length >= 4 && (
        <div className="mx-defi-chart-box">
          <div className="mx-defi-chart-head">
            <span className="mx-defi-chart-title">{t('marketPhase2.defiChartTitle')}</span>
            <div className="mx-defi-chart-deltas" dir="ltr">
              {defi.tvlChange30dPct != null && (
                <span data-dir={defi.tvlChange30dPct >= 0 ? 'up' : 'down'}>
                  {t('marketPhase2.defiPeriod30d')}: {fmtPct(defi.tvlChange30dPct)}
                </span>
              )}
              {defi.tvlChange90dPct != null && (
                <span data-dir={defi.tvlChange90dPct >= 0 ? 'up' : 'down'}>
                  {t('marketPhase2.defiPeriod90d')}: {fmtPct(defi.tvlChange90dPct)}
                </span>
              )}
            </div>
          </div>
          <MarketSparkline
            points={defi.tvlHistory90d}
            up={(defi.tvlChange90dPct ?? 0) >= 0}
            height={46}
            interactive
            glow
            liveDot
            label={t('marketPhase2.defiChartTitle')}
            formatValue={(v) => `$${fmtCompact(v)}`}
          />
        </div>
      )}

      {!hasData && !loading ? (
        <div className="mx-defi-unavailable" role="status">
          <span>{t('marketPhase2.defiUnavailable')}</span>
        </div>
      ) : lens === 'chains' ? (
        <div className="mx-defi-panel">
          {topChains.length > 0 && (
            <div className="mx-defi-stack-bar" aria-hidden="true" dir="ltr">
              {topChains.map((c, idx) => (
                <span
                  key={c.name}
                  style={{
                    width: `${Math.max(2, c.sharePct).toFixed(2)}%`,
                    backgroundColor: c.color || CHAIN_COLORS[idx % CHAIN_COLORS.length]
                  }}
                />
              ))}
            </div>
          )}
          <div className="mx-defi-grid">
            {limitRows(topChains).map((c, idx) => {
              const swatch = c.color || CHAIN_COLORS[idx % CHAIN_COLORS.length];
              return (
                <div key={c.name} className="mx-defi-item">
                  <div className="mx-defi-item-top">
                    <span className="mx-defi-chain-id">
                      <span className="mx-defi-logo" style={{ '--chain-color': swatch }}>{chainIcon(c)}</span>
                      <strong>{c.name}</strong>
                      {c.symbol && <small dir="ltr">{c.symbol}</small>}
                    </span>
                    <strong className="mx-defi-num" dir="ltr">
                      {fmtUsd(c.tvlUsd)}
                    </strong>
                  </div>
                  <div className="mx-defi-item-bot">
                    <span className="mx-defi-share" dir="ltr">{c.sharePct.toFixed(1)}%</span>
                    {c.fbtSupported && c.swapHref && (
                      <button
                        type="button"
                        className="mx-defi-tag-btn"
                        onClick={() => navigate(c.swapHref)}
                      >
                        <span>{t('marketPhase2.defiFbtReady')}</span>
                        <span className={`mx-p2-chev${isRtl ? ' is-rtl' : ''}`}>
                          <GlyphChevron />
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : lens === 'categories' ? (
        <div className="mx-defi-panel">
          <div className="mx-defi-grid">
            {limitRows(categories).map((cat) => (
              <div key={cat.id} className="mx-defi-item">
                <div className="mx-defi-item-top">
                  <strong>{t(`marketPhase2.defiCat_${cat.id}`)}</strong>
                  <strong className="mx-defi-num" dir="ltr">{fmtUsd(cat.tvlUsd)}</strong>
                </div>
                <div className="mx-pulse-meter" aria-hidden="true" dir="ltr">
                  <span
                    className="mx-pulse-meter-fill mx-pulse-meter-fill--teal"
                    style={{ width: `${Math.min(100, Math.max(4, cat.sharePct)).toFixed(1)}%` }}
                  />
                </div>
                <div className="mx-defi-item-bot">
                  <span className="mx-defi-meta">
                    {t('marketPhase2.defiLeader')}: <b dir="ltr">{cat.leaderName}</b> · {cat.protocolCount}{' '}
                    {t('marketPhase2.defiProtocolsCount')}
                  </span>
                  {cat.fbtRoute && (
                    <button
                      type="button"
                      className="mx-defi-tag-btn"
                      onClick={() => navigate(cat.fbtRoute)}
                    >
                      <span>{t('marketPhase2.defiOpenRoom')}</span>
                      <span className={`mx-p2-chev${isRtl ? ' is-rtl' : ''}`}>
                        <GlyphChevron />
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : lens === 'protocols' ? (
        <div className="mx-defi-panel">
          <div className="mx-defi-proto-list">
            {limitRows(topProtocols).map((p, idx) => (
              <div key={p.slug} className="mx-defi-proto-row">
                <span className="mx-pulse-rank" dir="ltr">{idx + 1}</span>
                <CoinLogo coin={{ image: p.logo, symbol: p.symbol || p.name, name: p.name }} size="small" px={26} />
                <div className="mx-defi-proto-main">
                  <div className="mx-defi-proto-top">
                    <strong>{p.name}</strong>
                    {p.symbol && <span className="mx-hm-ins-sym" dir="ltr">{p.symbol}</span>}
                    <span className="mx-defi-cat-pill">{p.category}</span>
                  </div>
                  <div className="mx-defi-proto-sub">
                    <span>
                      {p.chainsCount} {t('marketPhase2.defiChainsCount')}
                    </span>
                    {p.fbtIntegrated && p.fbtRoute && (
                      <button
                        type="button"
                        className="mx-defi-tag-btn"
                        onClick={() => navigate(p.fbtRoute)}
                      >
                        <span>{t('marketPhase2.defiIntegrated')}</span>
                        <span className={`mx-p2-chev${isRtl ? ' is-rtl' : ''}`}>
                          <GlyphChevron />
                        </span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="mx-defi-proto-nums" dir="ltr">
                  <strong>{fmtUsd(p.tvlUsd)}</strong>
                  {p.change1d != null && (
                    <span data-dir={p.change1d >= 0 ? 'up' : 'down'}>{fmtPct(p.change1d)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mx-defi-panel">
          <div className="mx-defi-grid">
            {limitRows(topStables).map((s) => (
              <div key={s.symbol} className="mx-defi-item">
                <div className="mx-defi-item-top">
                  <span className="mx-defi-chain-id">
                    <AssetIcon symbol={s.symbol} size={24} />
                    <strong dir="ltr">{s.symbol}</strong>
                    <small>{s.name}</small>
                  </span>
                  <strong className="mx-defi-num" dir="ltr">{fmtUsd(s.circulatingUsd)}</strong>
                </div>
                <div className="mx-defi-item-bot" dir="ltr">
                  <span className="mx-defi-share">{s.sharePct.toFixed(1)}%</span>
                  {s.delta24hUsd != null && (
                    <span
                      className="mx-defi-flow-delta"
                      data-dir={s.delta24hUsd >= 0 ? 'up' : 'down'}
                    >
                      {fmtSignedUsd(s.delta24hUsd)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {(defi?.chainInflows?.length > 0 || defi?.chainOutflows?.length > 0) && (
            <div className="mx-defi-flows-split">
              {defi.chainInflows?.length > 0 && (
                <div className="mx-defi-flow-col">
                  <h3 className="mx-defi-flow-hd">{t('marketPhase2.defiInflowsTitle')}</h3>
                  {defi.chainInflows.map((f) => (
                    <div key={f.chain} className="mx-defi-flow-row" dir="ltr">
                      <span>{f.chain}</span>
                      <strong className="is-up">{fmtSignedUsd(f.delta24hUsd)}</strong>
                    </div>
                  ))}
                </div>
              )}
              {defi.chainOutflows?.length > 0 && (
                <div className="mx-defi-flow-col">
                  <h3 className="mx-defi-flow-hd">{t('marketPhase2.defiOutflowsTitle')}</h3>
                  {defi.chainOutflows.map((f) => (
                    <div key={f.chain} className="mx-defi-flow-row" dir="ltr">
                      <span>{f.chain}</span>
                      <strong className="is-down">{fmtSignedUsd(f.delta24hUsd)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {activeRows.length > 4 && (
        <button type="button" className="mx-p2-more" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          <span>{expanded ? t('marketPhase2.controlsShowLess') : t('marketPhase2.controlsShowMore', { count: activeRows.length })}</span>
        </button>
      )}
    </section>
  );
}

export default memo(MarketDefiIntel);
