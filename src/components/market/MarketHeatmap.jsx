import { memo, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CoinLogo from '../CoinLogo.jsx';
import { GlyphChevron } from './MarketGlyphs.jsx';
import { MarketPopover, MarketSelect, GlyphClock, GlyphFilters } from './MarketControlMenu.jsx';
import { fmtCompact, fmtPct } from '../../lib/format.js';
import { marketPrice } from '../../lib/marketPresentation.js';
import { isSwappable, swapUrlFor } from '../../lib/coinToSwap.js';
import {
  HEATMAP_LIMITS,
  HEATMAP_WINDOWS,
  buildHeatmapLayout
} from '../../lib/marketHeatmap.js';

const PREFS_KEY = 'fbt.marketHeatmap.prefs.v1';

function readInitialPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      limit: HEATMAP_LIMITS.includes(Number(parsed.limit)) ? Number(parsed.limit) : 24,
      metric: parsed.metric === 'volume' ? 'volume' : 'mcap',
      window: HEATMAP_WINDOWS.includes(parsed.window) ? parsed.window : '24h',
      excludeStables: parsed.excludeStables !== false
    };
  } catch {
    return null;
  }
}

function GlyphHeatmapMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="9" height="10" rx="2.4" fill="currentColor" fillOpacity="0.28" stroke="currentColor" strokeWidth="1.4" />
      <rect x="13" y="2" width="5" height="6" rx="1.8" fill="currentColor" fillOpacity="0.14" stroke="currentColor" strokeWidth="1.4" />
      <rect x="13" y="10" width="5" height="8" rx="1.8" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="14" width="9" height="4" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function GlyphSearchSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.7 10.7L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function MarketHeatmap({ coins = [], vs = 'usd' }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isRtl =
    typeof i18n?.dir === 'function'
      ? i18n.dir() === 'rtl'
      : /^(fa|ar|ur|he)\b/i.test(String(i18n?.language || 'fa'));

  const saved = useMemo(() => readInitialPrefs(), []);
  const [limit, setLimit] = useState(saved?.limit || 24);
  const [metric, setMetric] = useState(saved?.metric || 'mcap');
  const [win, setWin] = useState(saved?.window || '24h');
  const [excludeStables, setExcludeStables] = useState(saved ? saved.excludeStables : true);
  const [query, setQuery] = useState('');
  const [compactViewport, setCompactViewport] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 620px)').matches;
  });
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(max-width: 620px)');
    const onChange = (ev) => setCompactViewport(ev.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    return undefined;
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ limit, metric, window: win, excludeStables })
      );
    } catch {
      // ignore storage quota errors
    }
  }, [limit, metric, win, excludeStables]);

  const layout = useMemo(
    () =>
      buildHeatmapLayout(coins, {
        limit,
        metric,
        window: win,
        excludeStables,
        query,
        aspect: compactViewport ? 1.08 : 1.95
      }),
    [coins, limit, metric, win, excludeStables, query, compactViewport]
  );

  const inspectedTile = useMemo(() => {
    if (!layout.tiles.length) return null;
    if (activeId) {
      const hit = layout.tiles.find((item) => item.coin.id === activeId);
      if (hit) return hit;
    }
    return layout.tiles[0];
  }, [layout.tiles, activeId]);

  const windowLabels = {
    '1h': t('marketPhase2.heatmapWin1h'),
    '24h': t('marketPhase2.heatmapWin24h'),
    '7d': t('marketPhase2.heatmapWin7d')
  };

  const hasCoins = Array.isArray(coins) && coins.length > 0;
  const filterCount = Number(limit !== 24) + Number(metric !== 'mcap') + Number(!excludeStables) + Number(Boolean(query.trim()));

  return (
    <section
      className="mx-p2-card mx-heatmap-card"
      data-testid="market-heatmap"
      aria-label={t('marketPhase2.heatmapTitle')}
    >
      <header className="mx-p2-head">
        <div className="mx-p2-title-wrap">
          <span className="mx-p2-mark mx-p2-mark--teal">
            <GlyphHeatmapMark />
          </span>
          <div className="mx-p2-headings">
            <span className="mx-p2-eyebrow" dir="ltr">
              {t('marketPhase2.heatmapEyebrow')}
            </span>
            <h2 className="mx-p2-title">{t('marketPhase2.heatmapTitle')}</h2>
            <p className="mx-p2-sub">{t('marketPhase2.heatmapSubtitle')}</p>
          </div>
        </div>

        <div className="mx-hm-toolbar mx-p2-controls" role="toolbar" aria-label={t('marketPhase2.heatmapTitle')}>
          <MarketSelect
            label={t('marketPhase2.controlsTimeRange')}
            value={layout.activeWindow}
            icon={<GlyphClock />}
            testId="market-heatmap-window"
            onChange={setWin}
            options={['1h', '24h', '7d'].map((w) => ({
              value: w,
              label: windowLabels[w],
              disabled: w !== '24h' && !layout.availableWindows[w],
              note: w !== '24h' && !layout.availableWindows[w] ? t('marketPhase2.controlsNoData') : undefined
            }))}
          />
          <MarketPopover
            label={t('marketPhase2.controlsFilters')}
            icon={<GlyphFilters />}
            badge={filterCount || undefined}
            active={filterCount > 0}
            testId="market-heatmap-filters"
          >
            {({ close }) => (
              <div className="mx-control-filter-body">
                <label className="mx-hm-filter">
                  <GlyphSearchSmall />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('marketPhase2.heatmapFilterPlaceholder')}
                    aria-label={t('marketPhase2.heatmapFilterPlaceholder')}
                  />
                </label>
                <div className="mx-control-field">
                  <span className="mx-control-label">{t('marketPhase2.controlsUniverse')}</span>
                  <div className="mx-p2-seg mx-control-seg">
                    {HEATMAP_LIMITS.map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`mx-p2-seg-btn${limit === n ? ' is-active' : ''}`}
                        aria-pressed={limit === n}
                        disabled={n === 100 && coins.length > 0 && coins.length < 55}
                        onClick={() => setLimit(n)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mx-control-field">
                  <span className="mx-control-label">{t('marketPhase2.controlsTileSize')}</span>
                  <div className="mx-p2-seg mx-control-seg">
                    {[['mcap', t('marketPhase2.heatmapSizeMcap')], ['volume', t('marketPhase2.heatmapSizeVol')]].map(([id, label]) => (
                      <button key={id} type="button" className={`mx-p2-seg-btn${metric === id ? ' is-active' : ''}`} aria-pressed={metric === id} onClick={() => setMetric(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className={`mx-control-switch${excludeStables ? ' is-on' : ''}`}
                  role="switch"
                  aria-checked={excludeStables}
                  onClick={() => setExcludeStables((v) => !v)}
                >
                  <span>{t('marketPhase2.heatmapNoStables')}</span>
                  <span className="mx-control-switch-track" aria-hidden="true"><span /></span>
                </button>
                <div className="mx-control-footer">
                  <button type="button" className="mx-control-reset" onClick={() => { setLimit(24); setMetric('mcap'); setExcludeStables(true); setQuery(''); }}>
                    {t('marketPhase2.controlsReset')}
                  </button>
                  <button type="button" className="mx-p2-action-btn mx-p2-action-btn--primary" onClick={() => close()}>
                    {t('marketPhase2.controlsDone')}
                  </button>
                </div>
              </div>
            )}
          </MarketPopover>
        </div>
      </header>

      {!hasCoins ? (
        <div className="mx-hm-skeleton" role="status">
          <span>{t('marketPhase2.heatmapLoading')}</span>
        </div>
      ) : layout.tiles.length === 0 ? (
        <div className="mx-hm-empty" role="status">
          <span>{t('marketPhase2.heatmapEmpty')}</span>
        </div>
      ) : (
        <div className="mx-hm-stage" dir="ltr" data-compact={compactViewport ? 'true' : undefined}>
          {layout.tiles.map((tile) => {
            const { coin, change, tone, tier, sharePct, xPct, yPct, wPct, hPct } = tile;
            const selected = inspectedTile?.coin?.id === coin.id;
            const changeStr = change == null ? '—' : fmtPct(change);
            const priceStr = marketPrice(coin.price, vs) || '—';

            return (
              <button
                key={coin.id}
                type="button"
                className={`mx-hm-tile${selected ? ' is-selected' : ''}`}
                data-tone={tone}
                data-tier={tier}
                data-symbol={coin.symbol}
                style={{
                  left: `${xPct.toFixed(3)}%`,
                  top: `${yPct.toFixed(3)}%`,
                  width: `${wPct.toFixed(3)}%`,
                  height: `${hPct.toFixed(3)}%`
                }}
                onPointerEnter={() => setActiveId(coin.id)}
                onFocus={() => setActiveId(coin.id)}
                onClick={() => navigate(`/coin/${encodeURIComponent(coin.id)}`)}
                aria-label={`${coin.symbol} ${priceStr} ${changeStr}`}
                title={`${coin.name} (${coin.symbol}) · ${priceStr} · ${changeStr}`}
              >
                <span className="mx-hm-tile-inner">
                  <span className="mx-hm-logo">
                    <CoinLogo
                      coin={coin}
                      size={tier === 'xl' || tier === 'lg' ? 'small' : 'thumb'}
                      px={tier === 'xl' ? 26 : tier === 'lg' ? 20 : tier === 'md' ? 16 : 12}
                      className="coin-logo mx-hm-coin-logo"
                    />
                  </span>
                  <span className="mx-hm-sym">{coin.symbol}</span>
                  {tier !== 'xs' && (
                    <span className="mx-hm-chg">{changeStr}</span>
                  )}
                  {(tier === 'xl' || tier === 'lg' || tier === 'md') && (
                    <span className="mx-hm-prc">{priceStr}</span>
                  )}
                  {tier === 'xl' && (
                    <span className="mx-hm-shr">{sharePct.toFixed(1)}%</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mx-hm-scale" aria-hidden="true">
        <span className="mx-hm-scale-lbl">{t('marketPhase2.heatmapScaleBear')}</span>
        <div className="mx-hm-scale-stops" dir="ltr">
          <span data-tone="down-5">-8%+</span>
          <span data-tone="down-3">-2%</span>
          <span data-tone="flat">0%</span>
          <span data-tone="up-3">+2%</span>
          <span data-tone="up-5">+8%+</span>
        </div>
        <span className="mx-hm-scale-lbl">{t('marketPhase2.heatmapScaleBull')}</span>
      </div>

      {inspectedTile && (
        <footer className="mx-hm-inspector" data-testid="market-heatmap-inspector">
          <div className="mx-hm-ins-id">
            <CoinLogo coin={inspectedTile.coin} size="small" px={30} />
            <div className="mx-hm-ins-names">
              <div className="mx-hm-ins-top">
                <strong>{inspectedTile.coin.name}</strong>
                <span className="mx-hm-ins-sym" dir="ltr">{inspectedTile.coin.symbol}</span>
                {inspectedTile.coin.rank != null && (
                  <span className="mx-hm-ins-rank" dir="ltr">#{inspectedTile.coin.rank}</span>
                )}
              </div>
              <div className="mx-hm-ins-meta">
                <span dir="ltr">{marketPrice(inspectedTile.coin.price, vs) || '—'}</span>
                <span
                  className="mx-hm-ins-delta"
                  data-dir={
                    inspectedTile.change == null
                      ? 'flat'
                      : inspectedTile.change >= 0
                        ? 'up'
                        : 'down'
                  }
                  dir="ltr"
                >
                  {inspectedTile.change == null ? '—' : fmtPct(inspectedTile.change)}
                </span>
                <span>
                  {t('marketPhase2.heatmapShare')}: <b dir="ltr">{inspectedTile.sharePct.toFixed(1)}%</b>
                </span>
                {Number(inspectedTile.coin.mcap) > 0 && (
                  <span>
                    {t('marketPhase2.heatmapSizeMcap')}: <b dir="ltr">${fmtCompact(inspectedTile.coin.mcap)}</b>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mx-hm-ins-actions">
            {isSwappable(inspectedTile.coin.id) && (
              <button
                type="button"
                className="mx-p2-action-btn mx-p2-action-btn--ghost"
                onClick={() => navigate(swapUrlFor(inspectedTile.coin.id, 'buy'))}
              >
                <span>{t('marketPhase2.heatmapSwapCoin')}</span>
              </button>
            )}
            <button
              type="button"
              className="mx-p2-action-btn mx-p2-action-btn--primary"
              onClick={() => navigate(`/coin/${encodeURIComponent(inspectedTile.coin.id)}`)}
            >
              <span>{t('marketPhase2.heatmapOpenCoin')}</span>
              <span className={`mx-p2-chev${isRtl ? ' is-rtl' : ''}`}>
                <GlyphChevron />
              </span>
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

export default memo(MarketHeatmap);
