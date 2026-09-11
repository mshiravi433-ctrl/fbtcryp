/**
 * THE FIVE VENUES — the rail at the TOP of the Farm screen.
 * ---------------------------------------------------------------------------
 * «در صفحه فارم ۵ تا شبکه داریم که هر کدام باید بالای صفحه قرار بگیرند داخل
 * باکس مدرن‌تر؛ وقتی روش می‌زنی تحلیل و نمودار بالاترین و کمترین باشد، مثل
 * صفحه یونی‌سواپ.»
 *
 * ─── WHAT WAS WRONG WITH THE OLD PLACEMENT ─────────────────────────────────
 * The five adapters (Aave on Base, Compound on Base, Aave on Arbitrum, Lido on
 * Ethereum, Morpho on Base) existed only as five collapsed rows INSIDE the
 * «داخل اپ» tab — the third screenful of the page, past the status card, the
 * feed controls and the tab rail. Discovery is the top of a page.
 *
 * ─── WHY THIS IS A SEPARATE COMPONENT FROM FarmPositionHub ─────────────────
 * They answer two different questions and must not drift:
 *
 *   · THIS FILE answers «what is happening on this venue right now» — the live
 *     rate, the spread between the highest and the lowest pool on its network,
 *     the history chart, the analysis. It transacts nothing.
 *   · FarmPositionHub answers «what can I do with my money here» — the five
 *     panels, each reading its own pinned contracts. Give it a wallet and it
 *     signs; give it nothing and it says so.
 *
 * The venue table below is DERIVED from `FARM_EXECUTION_ADAPTERS`, so the rail
 * cannot list a venue the execution hub does not have, and the same matcher
 * (`adapter.matches`) decides which live feed row belongs to which venue. One
 * table, two surfaces — the failure this repo has already paid for once.
 *
 * ─── NOTHING HERE IS INVENTED ──────────────────────────────────────────────
 * Every number on this rail is either (a) a live feed row joined through the
 * adapter's own matcher, (b) computed from those rows (highest, lowest, the
 * venue's position between them), or (c) an em-dash. There is no placeholder
 * rate, no hard-coded «~5%», and no chart drawn from anything but the feed and
 * the pool's own history endpoint. When the feed is down the rail says so and
 * shows dashes; a pretty empty chart would be the exact lie this screen exists
 * to avoid.
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import AssetIcon from '../AssetIcon';
import PoolGlyph from './PoolGlyph';
import TrendChart from '../TrendChart';
import { FARM_EXECUTION_ADAPTERS } from './FarmPositionHub';
import { projectDisplayName } from '../../lib/farmDeFi';
import { getYieldHistory, investRoute, realShare, rateIsUnusual } from '../../lib/yields';
import { fmtCompact } from '../../lib/format';

/**
 * Presentation for the five adapters: the network mark, the chain id the swap
 * handoff needs, and the title key the hub already uses. No rate, no position,
 * no address — a table of labels, kept next to the rail that renders it.
 */
const VENUE_META = Object.freeze({
  'aave-base': { chainId: '8453', chainKey: '8453', symbol: 'USDC', protocol: 'aave-v3', titleKey: 'farm.aave.panelTitle' },
  'compound-base': { chainId: '8453', chainKey: '8453', symbol: 'USDC', protocol: 'compound-v3', titleKey: 'farm.compound.panelTitle' },
  'aave-arbitrum': { chainId: '42161', chainKey: '42161', symbol: 'USDC', protocol: 'aave-v3', titleKey: 'farm.aaveArb.panelTitle' },
  lido: { chainId: '1', chainKey: '1', symbol: 'STETH', protocol: 'lido', titleKey: 'farm.lido.panelTitle' },
  'morpho-base': { chainId: '8453', chainKey: '8453', symbol: 'USDC', protocol: 'morpho-blue', titleKey: 'farm.morpho.panelTitle' }
});

/** The five venues, straight off the adapter table. */
export const FARM_VENUES = Object.freeze(FARM_EXECUTION_ADAPTERS.map((adapter) => Object.freeze({
  id: adapter.id,
  project: adapter.descriptor.project,
  chain: adapter.descriptor.chain,
  symbol: adapter.descriptor.symbol,
  ...VENUE_META[adapter.id]
})));

/** A matcher that throws on an odd feed row must not take the rail down. */
function matches(adapter, pool) {
  try {
    return adapter.matches(pool);
  } catch {
    return false;
  }
}

const finiteApy = (pool) => (Number.isFinite(Number(pool?.apy)) ? Number(pool.apy) : null);

/** Every chain gets a readable label; the locale files own the translations. */
const chainLabel = (name, t) => t(`farm.chainLabels.${name}`, { defaultValue: name });

/**
 * Where this venue's rate sits between the lowest and the highest rate its own
 * network offers today — the same question the range bar on a Uniswap pool
 * header answers, built from our feed instead of theirs. Returns null when the
 * spread is unknown or flat, and the caller then draws no bar at all rather
 * than a decorative one at 50%.
 */
export function venuePosition(apy, low, high) {
  /*
   * `apy == null` is checked BEFORE the coercion, because `Number(null)` is 0
   * — not NaN — so a venue whose rate is unknown would be drawn at the very
   * bottom of the range, i.e. as the network's worst pool. The same trap is
   * documented in lib/solanaAssetsClient.js for `projectStake`; a missing
   * number must produce no marker, not a confident wrong one.
   */
  if (apy == null || apy === '' || low == null || high == null) return null;
  const a = Number(apy);
  const lo = Number(low);
  const hi = Number(high);
  if (!Number.isFinite(a) || !Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
  return Math.min(1, Math.max(0, (a - lo) / (hi - lo)));
}

/* ------------------------------------------------------------------------- */
/* the breadth chart — highest and lowest, when there is no history to draw   */
/* ------------------------------------------------------------------------- */

/**
 * Nine bars, tallest first: the spread of live rates on this venue's network,
 * with the highest and the lowest named. It is drawn from the feed rows the
 * page already holds, so it costs no request and cannot disagree with the list
 * below it. The venue's own pool is outlined, which is the one thing a bar
 * chart has to answer here: «where does the pool I can actually use sit».
 */
function VenueBreadthChart({ rows, hereId, t, chain }) {
  const bars = useMemo(() => {
    const withRate = rows.filter((p) => finiteApy(p) != null).sort((a, b) => finiteApy(b) - finiteApy(a)).slice(0, 9);
    if (withRate.length < 2) return [];
    const rates = withRate.map(finiteApy);
    const high = Math.max(...rates);
    const low = Math.max(0, Math.min(...rates));
    const span = high - low || high || 1;
    return withRate.map((pool, i) => ({
      id: pool.id,
      symbol: pool.symbol,
      apy: finiteApy(pool),
      /* a floor of 16% so the shortest bar is still a bar and not a line */
      height: 16 + ((finiteApy(pool) - low) / span) * 84,
      role: i === 0 ? 'high' : i === withRate.length - 1 ? 'low' : 'mid',
      here: pool.id === hereId
    }));
  }, [rows, hereId]);

  if (bars.length === 0) return <p className="farm-venue-empty">{t('farm.venue.noSpread')}</p>;

  return (
    <div>
      <div className="farm-venue-bars" role="img" aria-label={t('farm.venue.breadthAria', { chain: chainLabel(chain, t) })}>
        {bars.map((bar) => (
          <span key={bar.id} className={`farm-venue-bar is-${bar.role}${bar.here ? ' is-here' : ''}`}>
            <span className="farm-venue-bar-value mono" dir="ltr">{bar.apy}%</span>
            <span className="farm-venue-bar-fill" style={{ height: `${bar.height}%` }} />
            <span className="farm-venue-bar-label" dir="ltr">{bar.symbol}</span>
          </span>
        ))}
      </div>
      <p className="faint farm-venue-note">{t('farm.venue.breadthNote')}</p>
    </div>
  );
}

/* ------------------------------------------------------------------------- */
/* the venue chart — history when we have it, the spread when we do not       */
/* ------------------------------------------------------------------------- */

const RANGE_DAYS = [7, 30, 90];

function VenueChart({ venue, pool, chainRows, t }) {
  const [days, setDays] = useState(30);
  const [history, setHistory] = useState({ status: 'IDLE', points: [] });
  const [retry, setRetry] = useState(0);
  const poolId = pool?.id ?? null;

  useEffect(() => {
    if (!poolId) {
      setHistory({ status: 'IDLE', points: [] });
      return undefined;
    }
    let alive = true;
    const ctrl = new AbortController();
    setHistory({ status: 'LOADING', points: [] });
    getYieldHistory(poolId, { signal: ctrl.signal })
      .then((result) => {
        if (!alive) return;
        setHistory({ status: 'READY', points: Array.isArray(result?.points) ? result.points : [] });
      })
      .catch(() => {
        if (alive) setHistory({ status: 'ERROR', points: [] });
      });
    return () => { alive = false; ctrl.abort(); };
  }, [poolId, retry]);

  /* Named `range`, NOT `window`: shadowing the global inside a component is
     the kind of thing that turns a later `window.location` into a crash. */
  const range = useMemo(() => {
    if (history.status !== 'READY') return null;
    const cutoff = Date.now() - days * 86_400_000;
    const points = history.points
      .filter((row) => Number.isFinite(Number(row?.apy)) && Number(row?.timestamp) >= cutoff)
      .map((row) => ({ x: Number(row.timestamp), y: Number(row.apy) }))
      .sort((a, b) => a.x - b.x);
    if (points.length < 2) return null;
    let high = points[0];
    let low = points[0];
    for (const point of points) {
      if (point.y > high.y) high = point;
      if (point.y < low.y) low = point;
    }
    return { points, high, low, first: points[0], last: points.at(-1) };
  }, [history, days]);

  return (
    <section className="farm-venue-chart" aria-label={t('farm.venue.chartTitle')}>
      <div className="farm-venue-chart-head">
        <p className="farm-venue-chart-title">{t('farm.venue.chartTitle')}</p>
        {range && (
          <div className="farm-venue-chart-ranges" role="group" aria-label={t('farm.historyRange')}>
            {RANGE_DAYS.map((n) => (
              <button type="button" key={n} className={`farm-venue-chip${days === n ? ' is-on' : ''}`} onClick={() => setDays(n)}>
                {t('farm.historyDays', { count: n })}
              </button>
            ))}
          </div>
        )}
      </div>

      {history.status === 'LOADING' && <div className="skel farm-venue-skel" />}
      {history.status === 'ERROR' && (
        <div>
          <p className="faint farm-venue-note">{t('farm.venue.historyUnavailable')}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRetry((n) => n + 1)}>{t('farm.retry')}</button>
        </div>
      )}

      {range && (
        <>
          {/* the two numbers this chart exists to show, named and dated */}
          <div className="farm-venue-chart-highlow">
            <div className="farm-venue-chart-hl is-high">
              <span className="farm-venue-range-role">{t('farm.venue.highInWindow', { days })}</span>
              <span className="farm-venue-range-value mono" dir="ltr">{range.high.y.toFixed(2)}%</span>
              <span className="farm-venue-range-sym">{new Date(range.high.x).toLocaleDateString()}</span>
            </div>
            <div className="farm-venue-chart-hl is-low">
              <span className="farm-venue-range-role">{t('farm.venue.lowInWindow', { days })}</span>
              <span className="farm-venue-range-value mono" dir="ltr">{range.low.y.toFixed(2)}%</span>
              <span className="farm-venue-range-sym">{new Date(range.low.x).toLocaleDateString()}</span>
            </div>
          </div>
          <TrendChart
            timeScale
            points={range.points}
            height={132}
            up={range.last.y >= range.first.y}
            formatValue={(v) => `${Number(v).toFixed(2)}%`}
            testId={`farm-venue-history-${venue.id}`}
          />
          <p className="faint farm-venue-note">{t('farm.venue.historyNote', { pool: pool.symbol })}</p>
        </>
      )}

      {!range && history.status !== 'LOADING' && (
        <>
          <p className="faint farm-venue-note">
            {pool ? t('farm.venue.noHistoryNote') : t('farm.venue.noPoolNote', { chain: chainLabel(venue.chain, t) })}
          </p>
          <VenueBreadthChart rows={chainRows} hereId={pool?.id ?? null} t={t} chain={venue.chain} />
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* one venue, opened                                                          */
/* ------------------------------------------------------------------------- */

function VenueDetail({ venue, pool, chainRows, chainHigh, chainLow, t, onGoToPositions, onGetTokens, onOpenPool }) {
  const apy = finiteApy(pool);
  const share = pool ? realShare(pool) : null;
  const realPct = share == null ? null : Math.round(share * 100);
  const unusual = pool ? rateIsUnusual(pool) : null;
  const route = pool ? investRoute(pool) : null;
  const title = t(venue.titleKey, { defaultValue: projectDisplayName(venue.project) });

  const cell = (role, row, key) => (
    <div className={`farm-venue-range-cell is-${role}`}>
      <span className="farm-venue-range-role">{t(key)}</span>
      <span className="farm-venue-range-value mono" dir="ltr">{row == null ? '—' : `${row.apy}%`}</span>
      <span className="farm-venue-range-sym" dir="ltr">{row?.symbol ?? '—'}</span>
    </div>
  );

  return (
    <motion.section
      className="farm-venue-detail"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      data-testid={`farm-venue-detail-${venue.id}`}
    >
      <header className="farm-venue-detail-head">
        <PoolGlyph pool={{ project: venue.project, symbol: pool?.symbol ?? venue.symbol }} size={40} chainKey={venue.chainKey} />
        <div className="farm-venue-detail-id">
          <p className="farm-venue-detail-title">{title}</p>
          <p className="farm-venue-detail-sub">{projectDisplayName(venue.project)} · {chainLabel(venue.chain, t)} · <span dir="ltr">{pool?.symbol ?? venue.symbol}</span></p>
        </div>
        <div className="farm-venue-pills">
          <span className={`pill ${apy == null ? 'pill-down' : 'pill-neutral'} mono`} dir="ltr">{apy == null ? t('farm.venue.noRate') : `${apy}%`}</span>
          <span className="pill pill-neutral">{t('farm.venue.chipAnalysis')}</span>
        </div>
      </header>
      {apy != null && <p className="faint farm-venue-note">{t('farm.estimatedApy')}</p>}

      {/* HIGH · THIS POOL · LOW — the three numbers, side by side */}
      <div className="farm-venue-range-row">
        {cell('high', chainHigh, 'farm.venue.highOnChain')}
        {cell('here', pool ? { apy: pool.apy, symbol: pool.symbol } : null, 'farm.venue.thisPool')}
        {cell('low', chainLow, 'farm.venue.lowOnChain')}
      </div>

      <VenueChart venue={venue} pool={pool} chainRows={chainRows} t={t} />

      <div className="farm-venue-analysis">
        <div className="farm-venue-analysis-row">
          <span className="farm-venue-analysis-key">{t('farm.risk')}</span>
          <span className="farm-venue-analysis-val">{t(`farm.risk.${pool?.risk ?? 'high'}`)}</span>
        </div>
        <div className="farm-venue-analysis-row">
          <span className="farm-venue-analysis-key">{t('farm.tvl')}</span>
          <span className="farm-venue-analysis-val mono" dir="ltr">{pool?.tvlUsd == null ? '—' : fmtCompact(pool.tvlUsd)}</span>
        </div>
        <div className="farm-venue-analysis-row">
          <span className="farm-venue-analysis-key">{t('farm.realYieldShare')}</span>
          <span className="farm-venue-analysis-val mono" dir="ltr">
            {realPct == null ? '—' : t('farm.splitLine', { real: realPct, emissions: 100 - realPct })}
          </span>
        </div>
        <div className="farm-venue-analysis-row">
          <span className="farm-venue-analysis-key">{t('farm.rateVs30d')}</span>
          <span className="farm-venue-analysis-val mono" dir="ltr">
            {pool?.apyMean30d == null ? '—' : `${pool.apy}% / ${pool.apyMean30d}%`}
          </span>
        </div>
        <div className="farm-venue-analysis-row">
          <span className="farm-venue-analysis-key">{t('farm.volume24h')}</span>
          <span className="farm-venue-analysis-val mono" dir="ltr">
            {pool?.volumeUsd1d == null ? '—' : fmtCompact(pool.volumeUsd1d)}
          </span>
        </div>
        <div className="farm-venue-analysis-row">
          <span className="farm-venue-analysis-key">{t('farm.venue.type')}</span>
          <span className="farm-venue-analysis-val">
            {pool ? (pool.exposure === 'single' ? t('farm.category.staking') : t('farm.category.lp')) : '—'}
          </span>
        </div>
      </div>

      <p className={`farm-venue-verdict ${unusual?.direction === 'above' ? 'is-high' : unusual?.direction === 'below' ? 'is-low' : ''}`}>
        {unusual
          ? t(`farm.unusual.${unusual.direction}`, { ratio: unusual.ratio, mean: unusual.mean })
          : t('farm.venue.verdictNormal')}
      </p>

      <div className="farm-venue-actions">
        <button type="button" className="btn btn-primary farm-btn" onClick={() => onGoToPositions(venue.id)}>
          {t('farm.venue.executeCta')}
        </button>
        {route && (
          <button type="button" className="btn btn-ghost farm-btn" onClick={() => onGetTokens(route)}>
            {t('farm.getTokens', { a: route.from, b: route.to })}
          </button>
        )}
        {pool?.url && (
          <button type="button" className="btn btn-ghost farm-btn farm-btn-minor" onClick={() => onOpenPool(pool.url)}>
            {t('farm.openPool')}
          </button>
        )}
      </div>
      <p className="faint farm-venue-note">{t('farm.venue.executeNote')}</p>
    </motion.section>
  );
}

/* ------------------------------------------------------------------------- */
/* the rail                                                                   */
/* ------------------------------------------------------------------------- */

export default function VenueRail({ pools = [], t, onGoToPositions, onGetTokens, onOpenPool }) {
  const [openId, setOpenId] = useState(null);

  const venues = useMemo(() => FARM_EXECUTION_ADAPTERS.map((adapter) => {
    const meta = VENUE_META[adapter.id] ?? {};
    const matched = pools.filter((pool) => matches(adapter, pool));
    const chainRows = pools
      .filter((pool) => pool.chain === adapter.descriptor.chain && finiteApy(pool) != null)
      .sort((a, b) => finiteApy(b) - finiteApy(a));
    return {
      id: adapter.id,
      project: adapter.descriptor.project,
      chain: adapter.descriptor.chain,
      symbol: adapter.descriptor.symbol,
      ...meta,
      pool: matched[0] ?? null,
      chainRows,
      chainHigh: chainRows[0] ?? null,
      chainLow: chainRows.length > 1 ? chainRows.at(-1) : null
    };
  }), [pools]);

  const open = venues.find((v) => v.id === openId) ?? null;
  const rated = venues.filter((v) => finiteApy(v.pool) != null).length;

  return (
    <motion.section className="farm-venue-box" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} aria-label={t('farm.venue.title')}>
      <div className="farm-venue-box-head">
        <div className="farm-venue-box-text">
          <p className="farm-venue-box-title">{t('farm.venue.title')}</p>
          <p className="farm-venue-box-sub">{t('farm.venue.sub')}</p>
        </div>
        <span className="pill pill-neutral farm-venue-box-pill mono" dir="ltr">{t('farm.venue.liveCount', { count: rated, total: venues.length })}</span>
      </div>

      {/* A plain scrollable rail of BUTTONS. It deliberately carries no ARIA
          list role: overriding a button's role to `listitem` would strip the
          button semantics a screen reader needs to announce «opens analysis» —
          the container's label plus each card's `aria-expanded` says enough. */}
      <div className="farm-venue-rail">
        {venues.map((venue) => {
          const apy = finiteApy(venue.pool);
          const position = venuePosition(apy, finiteApy(venue.chainLow), finiteApy(venue.chainHigh));
          const isOpen = venue.id === openId;
          return (
            <button
              key={venue.id}
              type="button"
              className={`farm-venue-card${isOpen ? ' is-open' : ''}`}
              aria-expanded={isOpen}
              onClick={() => setOpenId(isOpen ? null : venue.id)}
              title={`${t(venue.titleKey, { defaultValue: projectDisplayName(venue.project) })} · ${chainLabel(venue.chain, t)}`}
              data-testid={`farm-venue-card-${venue.id}`}
            >
              <span className="farm-venue-card-top">
                <PoolGlyph pool={{ project: venue.project, symbol: venue.symbol }} size={34} chainKey={venue.chainKey} />
                <span className="farm-venue-chain">
                  <AssetIcon chain={venue.chainKey} size={14} />
                  <span>{chainLabel(venue.chain, t)}</span>
                </span>
              </span>
              <span className="farm-venue-card-name">{projectDisplayName(venue.project)}</span>
              <span className="farm-venue-card-apy mono" dir="ltr">{apy == null ? '—' : `${apy}%`}</span>
              <span className="farm-venue-card-apy-label">{t('farm.estimatedApy')}</span>
              {position == null
                ? <span className="farm-venue-card-range is-empty" aria-hidden="true" />
                : (
                  <span className="farm-venue-card-range" aria-hidden="true">
                    <span className="farm-venue-card-range-fill" style={{ insetInlineStart: `${Math.round(position * 100)}%` }} />
                  </span>
                )}
              <span className="farm-venue-card-hint">{isOpen ? t('farm.venue.close') : t('farm.venue.open')}</span>
            </button>
          );
        })}
      </div>

      {open
        ? (
          <VenueDetail
            key={open.id}
            venue={open}
            pool={open.pool}
            chainRows={open.chainRows}
            chainHigh={open.chainHigh}
            chainLow={open.chainLow}
            t={t}
            onGoToPositions={onGoToPositions}
            onGetTokens={onGetTokens}
            onOpenPool={onOpenPool}
          />
        )
        : <p className="faint farm-venue-note">{t('farm.venue.tapHint')}</p>}
    </motion.section>
  );
}
