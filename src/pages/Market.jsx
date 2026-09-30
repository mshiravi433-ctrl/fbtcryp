import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import AdBanner from '../components/AdBanner';
import Ticker from '../components/Ticker';
import CoinRow from '../components/CoinRow';
import CoinLogo from '../components/CoinLogo';
import AnimatedNumber from '../components/AnimatedNumber';
import Sparkline from '../components/Sparkline';
import TrendChart from '../components/TrendChart';
import { marketCapSeries } from '../lib/globalTrend';
import { useCoinSearch, useGlobalStats, useMarkets, useTrending } from '../hooks/useMarket';
import { fmtCompact, fmtNum, fmtPct, fmtUsd } from '../lib/format';
import { vsOf } from '../lib/currency';
import { useSettingsStore } from '../store/useSettingsStore';
import { getCategory, getMarkets, onMarketVisualsReady } from '../lib/api';
import { MARKET_CATEGORIES, sectorFromRows } from '../lib/marketSectors';
import { mergeVisuals } from '../lib/marketVisuals';
import { useAppStore } from '../store/useAppStore';
import { runPriceAlerts, runTopMoverAlerts } from '../lib/priceAlerts';
import { isSwappable, swapUrlFor } from '../lib/coinToSwap';
import { venueRoute } from '../lib/coinVenue';
import { rememberCoinVenues } from '../lib/coinVenues';
import { useCoinVenues } from '../hooks/useCoinVenues';

const FILTERS = ['all', 'gainers', 'losers', 'favorites', 'volume'];

/**
 * HOW MANY TOKENS THE FIRST PAGE HOLDS.
 *
 * 60 made most coins untappable (the detail screen looked the id up in this
 * list and said "not found"); 250 was still a page a trader calls short.
 * CoinGecko's bulk endpoint answers 250 per call, so 500 is two calls — and
 * 500 is exactly the batch ceiling the venue resolver is specified for, so
 * "resolve every row on screen" stays a single request however the list grows.
 */
const MARKET_PAGE_SIZE = 500;

/**
 * SECTOR TABS — gold, memecoins, RWA, AI, gaming.
 *
 * ─── WHY THESE ARE NOT JUST MORE FILTERS ────────────────────────────────────
 * Every existing filter re-sorts the same 250 rows already in memory. A sector
 * cannot: there are only a handful of tokenized-gold tokens in existence and
 * none is in the top 250 by market cap, so filtering the loaded page for
 * "gold" would correctly return nothing. These fetch the whole universe for
 * that category instead (see lib/api.js).
 *
 * Ordered by how likely someone is to want them. Gold first because it is the
 * one a non-crypto person recognises, and the reason they might open a crypto
 * app at all where the local currency is unstable.
 */
const SECTORS = Object.keys(MARKET_CATEGORIES);

function StatTile({ label, value, sub, tone }) {
  return (
    <motion.div className="card card-tight" variants={riseIn}>
      <div className="faint" style={{ marginBottom: 4 }}>{label}</div>
      <div className="stat-mini">{value}</div>
      {sub != null && (
        <div className={`mono ${tone === 'up' ? 'up' : tone === 'down' ? 'down' : ''}`} style={{ fontSize: 10.5, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </motion.div>
  );
}

export default function Market() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const favorites = useAppStore((s) => s.favorites);
  const vs = vsOf(useSettingsStore((s) => s.currency));

  const { data: global } = useGlobalStats();
  /*
   * ─── HOW MANY TOKENS THIS PAGE SHOWS ───────────────────────────────────
   *   «تعداد توکن های صفحه بازار خیلی کمه»
   *
   * 60 made most coins untappable (the detail screen looked the id up in
   * THIS list), then 250 was still a page a trader calls short. CoinGecko's
   * bulk endpoint answers 250 per call, so 500 is two — and this screen
   * already loads the second page on demand below, which is where the rest
   * comes from.
   *
   * 500 is also the ceiling the batch venue resolver is specified for
   * (lib/coinVenues.js), so "ask about everything on screen" stays exactly
   * one request.
   */
  const { data: marketCoins, loading } = useMarkets(MARKET_PAGE_SIZE);
  const [visualVersion, setVisualVersion] = useState(0);
  useEffect(() => onMarketVisualsReady(() => setVisualVersion((v) => v + 1)), []);
  const coins = useMemo(() => (marketCoins ?? []).map(mergeVisuals), [marketCoins, visualVersion]);
  const { data: trending } = useTrending();

  /*
   * ─── FAVOURITE-COIN PRICE ALERTS ────────────────────────────────────────
   * `priceAlerts` was a switch in Settings with NO consumer anywhere: the
   * user could turn it on, the app remembered it, and nothing ever compared
   * a price. See lib/priceAlerts.js.
   *
   * Hooked here rather than in App.jsx on purpose — this screen already
   * polls 250 coins every 30s, so the check costs no extra request. A second
   * poller running app-wide would double the market traffic to power a
   * feature that is off for anyone who has not starred a coin.
   *
   * The wording is built here because it has to be translated; the library
   * decides WHETHER to alert and never what it says.
   */
  /*
   * ─── TOP-MOVER ALERTS ───────────────────────────────────────────────────
   * «برای ۳ ارز اول که بیش از ۵ درصد افت یا سود کرد نوتیفیکیشن بفرستد». Not
   * gated on favourites: the first three coins BY RANK whose 24h change is
   * beyond ±5% are announced, with the feed's own number, once per cooldown.
   */
  useEffect(() => {
    if (!coins?.length) return;
    runTopMoverAlerts({
      coins,
      format: (a) => ({
        title: t(a.changePct >= 0 ? 'notify.mover.titleUp' : 'notify.mover.titleDown', {
          symbol: a.symbol, pct: Math.abs(a.changePct).toFixed(1)
        }),
        body: t(a.changePct >= 0 ? 'notify.mover.up' : 'notify.mover.down', {
          name: a.name, symbol: a.symbol, pct: Math.abs(a.changePct).toFixed(1),
          price: a.price >= 1 ? a.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) : a.price.toPrecision(4),
          rank: a.rank ?? '—'
        })
      })
    });
  }, [coins, t]);

  useEffect(() => {
    if (!coins?.length || !favorites?.length) return;
    runPriceAlerts({
      favorites,
      coins,
      format: (a) => ({
        title: t('notify.price.title', { symbol: a.symbol }),
        body: t(a.changePct >= 0 ? 'notify.price.up' : 'notify.price.down', {
          symbol: a.symbol,
          pct: Math.abs(a.changePct).toFixed(1),
          price: a.price
        })
      })
    });
  }, [coins, favorites, t]);

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');

  /*
   * Sector view. `null` means the ordinary market list.
   *
   * Held separately from `filter` rather than folded into it because the two
   * are different operations — one re-sorts memory, the other issues a
   * request — and a single piece of state would have to encode "am I loading"
   * for half its values and not the others.
   */
  const [sector, setSector] = useState(null);
  const [sectorCoins, setSectorCoins] = useState([]);
  const [sectorLoading, setSectorLoading] = useState(false);
  /*
   * 60 rows a page, up from 40. Each one is a card with a sparkline and a
   * swap button; forty of them filled two screens and a half on a phone, and
   * the complaint was that the market had too few tokens. The number is a
   * RENDER budget, not a data budget — the list still only ever holds the
   * rows a user has scrolled near, because the resolver below asks about the
   * visible slice alone.
   */
  const [visibleCount, setVisibleCount] = useState(60);
  const [secondPage, setSecondPage] = useState({ vs, rows: [] });
  const currentVs = useRef(vs);
  currentVs.current = vs;
  const [pageLoading, setPageLoading] = useState(false);
  const [pageDone, setPageDone] = useState(false);
  const loadNextPage = async () => {
    if (pageLoading || pageDone) return;
    setPageLoading(true);
    try {
      const rows = await getMarkets({ page: 2, perPage: 250, vs });
      if (currentVs.current !== vs) return;
      const known = new Set(coins.map((row) => row.id));
      const newRows = (rows ?? []).filter((row) => !known.has(row.id));
      setSecondPage({ vs, rows: newRows });
      setPageDone(true); // cap at 750; the next page is deliberately on demand
      setVisibleCount((n) => n + 60);
    } catch {
      // A failed page must remain retryable, never cached as a successful empty page.
    } finally {
      setPageLoading(false);
    }
  };
  useEffect(() => setVisibleCount(60), [sector, filter, query]);
  useEffect(() => { setSecondPage({ vs, rows: [] }); setPageDone(false); }, [vs]);

  useEffect(() => {
    if (!sector) {
      setSectorCoins([]);
      return undefined;
    }
    let alive = true;
    setSectorCoins([]);
    setSectorLoading(true);
    getCategory(sector, { vs })
      .then((rows) => alive && setSectorCoins(rows ?? []))
      .catch(() => alive && setSectorCoins([]))
      .finally(() => alive && setSectorLoading(false));
    return () => {
      alive = false;
    };
  }, [sector, vs]);

  // Anything not in the loaded page is found by querying the full universe.
  const { results: remoteHits, searching } = useCoinSearch(query);

  const list = useMemo(() => {
    /*
     * A sector replaces the list rather than filtering it. Search still
     * applies on top, because "show me gold, containing 'pax'" is a
     * reasonable thing to want; the sort filters do not, since they belong to
     * the main list and are visually deselected while a sector is active.
     */
    if (sector) {
      // Do not blank the tab while the category endpoint is warming or down.
      // The fallback only uses ID-verified members with quotes from the main
      // feed; it is not a symbol/name search or fabricated category price.
      const rows = sectorCoins.length ? sectorCoins : sectorFromRows(sector, coins);
      if (!query.trim()) return rows;
      const q = query.trim().toLowerCase();
      return rows.filter(
        (c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
      );
    }

    let out = [...(coins ?? []), ...(secondPage.vs === vs ? secondPage.rows : [])];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      out = out.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
    }
    switch (filter) {
      case 'gainers':
        return [...out].sort((a, b) => b.change24h - a.change24h).slice(0, 25);
      case 'losers':
        return [...out].sort((a, b) => a.change24h - b.change24h).slice(0, 25);
      case 'favorites':
        return out.filter((c) => favorites.includes(c.id));
      case 'volume':
        return [...out].sort((a, b) => b.volume - a.volume).slice(0, 25);
      default:
        return out;
    }
  }, [coins, secondPage, vs, filter, query, favorites, sector, sectorCoins]);

  /*
   * ─── SWAPPABILITY FOR EVERY ROW, IN ONE REQUEST ────────────────────────
   * The rows used to decide their own swap button from the 46-entry curated
   * table alone, which is why a 250-row list showed a button on a dozen of
   * them and answered «cannot swap» for coins this app trades every day.
   * `useCoinVenues` asks the server for the whole visible page's real
   * contracts in ONE call; curated still wins per row, so nothing that
   * already worked can get worse.
   *
   * Only the rows actually ON SCREEN are asked about: a coin nobody can see
   * has no button to light up, and asking about all 500 would be a request
   * whose answer is thrown away.
   */
  const visibleCoins = useMemo(() => (list ?? []).slice(0, visibleCount), [list, visibleCount]);
  const { venues } = useCoinVenues(visibleCoins.map((c) => c.id));
  useEffect(() => {
    /* Hand the answers to the per-coin cache, so opening a row is instant
       and the coin page never re-asks for what this list just learned. */
    for (const [id, venue] of venues) rememberCoinVenues(id, venue);
  }, [venues]);

  // Coins the search found that aren't in the loaded page. Shown separately so
  // it's obvious they came from a wider lookup, and tappable like any other.
  const extraHits = useMemo(() => {
    if (!query.trim() || sector) return [];
    const have = new Set((list ?? []).map((c) => c.id));
    return (remoteHits ?? []).filter((c) => !have.has(c.id));
  }, [remoteHits, list, query, sector]);

  const hero = coins?.[0];
  /*
   * The 7-day shape of the total, built from the rows already in memory —
   * see lib/globalTrend.js for why it is rebuilt rather than fetched. Derived
   * from `coins`, which the page polls every 30s, so it refreshes with them.
   */
  const trend = useMemo(() => marketCapSeries(coins || [], { maxCoins: 60 }), [coins]);

  const isOffline = global?.offline || coins?.[0]?.offline;

  return (
    <PageTransition>
      <Ticker coins={(coins ?? []).slice(0, 18)} />

      {isOffline && <div className="notice">{t('common.offlineData')}</div>}

      {/* ---------- global market card ---------- */}
      <motion.section
        className="card card-rgb card-glow-cyan"
        variants={riseIn}
        initial="hidden"
        animate="show"
      >
        <div className="sheen" />
        <div className="row-between" style={{ marginBottom: 10 }}>
          <div>
            <div className="faint">{t('market.totalMcap')}</div>
            <div className="stat-value">
              <AnimatedNumber value={global?.mcap ?? 0} format={(v) => fmtCompact(v)} />
            </div>
          </div>
          <span className={`pill ${(global?.mcapChange ?? 0) >= 0 ? 'pill-up' : 'pill-down'}`}>
            {fmtPct(global?.mcapChange ?? 0, 2)}
          </span>
        </div>

        <div className="grid-3">
          <div>
            <div className="faint">{t('market.volume24h')}</div>
            <div className="mono" style={{ fontSize: 13 }}>{fmtCompact(global?.volume ?? 0)}</div>
          </div>
          <div>
            <div className="faint">{t('market.btcDominance')}</div>
            <div className="mono" style={{ fontSize: 13 }}>{(global?.btcDominance ?? 0).toFixed(2)}%</div>
          </div>
          <div>
            <div className="faint">{t('market.ethDominance')}</div>
            <div className="mono" style={{ fontSize: 13 }}>{(global?.ethDominance ?? 0).toFixed(2)}%</div>
          </div>
        </div>

        <div className="progress" style={{ marginTop: 12 }}>
          <motion.div
            className="progress-fill"
            initial={{ width: 0 }}
            animate={{ width: `${global?.btcDominance ?? 50}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </div>

        {/*
          7-day shape of the total. Reported as: "does the global market
          card not need a chart?" It did. Five figures about right now, with no
          way to see whether the number was climbing or falling into them.

          The series is rebuilt from the loaded coins, not fetched: there is no
          free historical endpoint for total market cap. The caption names the
          coins and the method, because a chart that looks authoritative while
          covering only the top of the book is worse than none.
        */}
        {trend && (
          <div className="market-trend" data-testid="global-market-trend">
            <div className="market-trend-head">
              <span className="faint">
                {t('market.trendTitle', {
                  defaultValue: `Total market cap · ${trend.days} days`,
                  days: trend.days
                })}
              </span>
              <span className={`mono ${trend.changePct >= 0 ? 'up' : 'down'}`}>
                {fmtPct(trend.changePct, 2)}
              </span>
            </div>
            <TrendChart
              points={trend.points}
              height={76}
              up={trend.changePct >= 0}
              formatValue={(v) => fmtCompact(v)}
              testId="global-market-trend-chart"
            />
            <p className="faint market-trend-note">
              {t('market.trendNote', {
                defaultValue: 'Rebuilt from the largest {{n}} coins already on this page — each one’s hourly price history × its circulating supply. It is the top of the market, not the whole market, and supply is held constant across the window.',
                n: trend.coins
              })}
            </p>
          </div>
        )}
      </motion.section>

      <motion.div className="grid-3" variants={stagger} initial="hidden" animate="show">
        <StatTile label={t('market.coins')} value={fmtNum(global?.coins ?? 0)} />
        <StatTile label={t('market.markets')} value={fmtNum(global?.markets ?? 0)} />
        <StatTile
          label={t('market.avgChange')}
          value={fmtPct(global?.avgChange ?? 0, 2)}
          tone={(global?.avgChange ?? 0) >= 0 ? 'up' : 'down'}
        />
      </motion.div>

      {/* ---------- hero coin ---------- */}
      {hero && (
        <motion.section
          className="card"
          variants={riseIn}
          initial="hidden"
          animate="show"
          onClick={() => navigate(`/coin/${hero.id}`)}
          style={{ cursor: 'pointer' }}
        >
          <div className="row-between">
            <div className="row">
              <CoinLogo coin={hero} />
              <div>
                <div style={{ fontWeight: 700 }}>{hero.name}</div>
                <div className="faint">{hero.symbol} / {vs.toUpperCase()}</div>
              </div>
            </div>
            <div style={{ textAlign: 'end' }}>
              <div className="stat-mini">
                <AnimatedNumber value={hero.price} format={(v) => fmtUsd(v)} />
              </div>
              <div className={`mono ${hero.change24h >= 0 ? 'up' : 'down'}`} style={{ fontSize: 11 }}>
                {fmtPct(hero.change24h)}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <Sparkline data={hero.sparkline ?? []} up={hero.change24h >= 0} width={470} height={64} strokeWidth={2} />
          </div>
        </motion.section>
      )}

      <AdBanner slot="signals" />

      {/* ---------- trending ---------- */}
      {trending?.length > 0 && (
        <section>
          <p className="section-label">🔥 {t('market.trending')}</p>
          <div className="tag-scroll" style={{ marginTop: 8 }}>
            {trending.map((c) => (
              <motion.button
                key={c.id}
                className="tag"
                whileTap={{ scale: 0.94 }}
                onClick={() => navigate(`/coin/${c.id}`)}
              >
                <CoinLogo
                  coin={c}
                  size="thumb"
                  px={14}
                  className="coin-chip"
                  style={{ marginInlineEnd: 5, verticalAlign: -2 }}
                />
                {c.symbol}
              </motion.button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- list ---------- */}
      <section>
        <div className="row-between" style={{ alignItems: 'center' }}>
          <p className="section-label" style={{ margin: 0 }}>{t('market.allCoins')}</p>
          <button
            type="button"
            className="tag"
            onClick={() => navigate('/compare')}
            aria-label={t('market.compare')}
          >
            ⚖️ {t('market.compare')}
          </button>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('market.search')}
          style={{ margin: '10px 0' }}
        />

        <div className="tag-scroll" style={{ marginBottom: 10 }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`tag ${!sector && filter === f ? 'active' : ''}`}
              onClick={() => {
                setSector(null);
                setFilter(f);
              }}
            >
              {t(`market.filter.${f}`)}
            </button>
          ))}
        </div>

        {/*
          Sector tabs on their own row.

          Mixed into the row above they would look like more sorts of the same
          list, which is exactly what they are not — tapping one issues a
          request for a different set of coins entirely.
        */}
        <div className="tag-scroll" style={{ marginBottom: 10 }}>
          {SECTORS.map((sec) => (
            <button
              key={sec}
              className={`tag ${sector === sec ? 'active' : ''}`}
              onClick={() => { setSectorCoins([]); setSector(sector === sec ? null : sec); }}
            >
              {t(`market.sector.${sec}`)}
            </button>
          ))}
        </div>

        {loading && !list.length ? (
          <div className="stack">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skel" style={{ height: 58 }} />
            ))}
          </div>
        ) : list.length === 0 && extraHits.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">🔍</span>
            {sectorLoading ? t('market.loadingSector') : sector ? t('market.sectorEmpty') : searching ? t('market.searching') : t('market.noResults')}
          </div>
        ) : (
          <motion.div className="stack" style={{ gap: 8 }} variants={stagger} initial="hidden" animate="show">
            {list.slice(0, visibleCount).map((c, i) => {
              /*
                ─── ONE TAP, TWO ANSWERS ───────────────────────────────────
                The curated answer (`isSwappable`) is INSTANT and offline: a
                hand-checked contract on our cheapest chain. The resolved
                answer comes from CoinGecko's own platform map and is what
                makes a Solana memecoin or a long-tail Base token swappable
                at all — see lib/coinVenues.js.

                Curated is asked first and always wins, because it carries a
                counter-token and a verified contract. Resolved is the
                fallback that turns «cannot swap» into a real route for the
                majority of the list.
              */
              const curated = isSwappable(c.id);
              const venue = curated ? null : venues.get(c.id);
              const resolved = !curated && venue?.tradeable ? venueRoute({ ...venue }) : null;
              const swapUrl = curated ? swapUrlFor(c.id, 'buy') : resolved?.href ?? null;
              return (
                <div key={c.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CoinRow coin={c} rank={c.rank || i + 1} onClick={() => navigate(`/coin/${c.id}`)} />
                  </div>
                  {swapUrl && (
                    <button
                      className="tag market-swap-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(swapUrl);
                      }}
                      title={t('market.swapOnCorrectNetwork', { symbol: c.symbol })}
                      data-testid={`market-swap-${c.id}`}
                    >
                      {t('market.swap')}
                    </button>
                  )}
                </div>
              );
            })}

            {(list.length > visibleCount || (!sector && filter === 'all' && !query && !pageDone && coins.length >= MARKET_PAGE_SIZE)) && (
              <button type="button" className="tag" disabled={pageLoading}
                onClick={() => (list.length > visibleCount ? setVisibleCount((n) => n + 60) : loadNextPage())}>
                {pageLoading ? t('market.loadingSector') : t('market.showMore', { count: Math.max(0, list.length - visibleCount) || 250 })}
              </button>
            )}
            {extraHits.length > 0 && (
              <>
                <p className="section-label" style={{ marginTop: 8 }}>{t('market.moreResults')}</p>
                {extraHits.map((c) => {
                  const curated = isSwappable(c.id);
                  const venue = curated ? null : venues.get(c.id);
                  const resolved = !curated && venue?.tradeable ? venueRoute({ ...venue }) : null;
                  const swapUrl = curated ? swapUrlFor(c.id, 'buy') : resolved?.href ?? null;
                  return (
                    <div key={c.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <button
                        className="coin-row"
                        onClick={() => navigate(`/coin/${c.id}`)}
                        style={{ flex: 1, minWidth: 0, textAlign: 'start' }}
                      >
                        <CoinLogo coin={c} />
                        <div className="coin-meta">
                          <div className="coin-sym">{c.symbol}</div>
                          <div className="coin-name">{c.name}</div>
                        </div>
                        {c.rank > 0 && <span className="faint mono" style={{ fontSize: 11 }}>#{c.rank}</span>}
                      </button>
                      {swapUrl && (
                        <button
                          className="tag market-swap-btn"
                          onClick={(e) => { e.stopPropagation(); navigate(swapUrl); }}
                        >
                          {t('market.swap')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </motion.div>
        )}
      </section>
    </PageTransition>
  );
}
