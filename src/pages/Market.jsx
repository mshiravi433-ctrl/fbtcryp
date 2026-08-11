import { useEffect, useMemo, useState } from 'react';
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
import { useCoinSearch, useGlobalStats, useMarkets, useTrending } from '../hooks/useMarket';
import { fmtCompact, fmtNum, fmtPct } from '../lib/format';
import { MARKET_CATEGORIES, getCategory } from '../lib/api';
import { useAppStore } from '../store/useAppStore';
import { runPriceAlerts } from '../lib/priceAlerts';
import { isSwappable, swapUrlFor } from '../lib/coinToSwap';

const FILTERS = ['all', 'gainers', 'losers', 'favorites', 'volume'];

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

  const { data: global } = useGlobalStats();
  // 250 rows instead of 60: the old page made most coins untappable, because
  // the detail screen looked the id up in THIS list and said "not found" when
  // it wasn't there.
  const { data: coins, loading } = useMarkets(250);
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

  useEffect(() => {
    if (!sector) {
      setSectorCoins([]);
      return undefined;
    }
    let alive = true;
    setSectorLoading(true);
    getCategory(sector)
      .then((rows) => alive && setSectorCoins(rows ?? []))
      .catch(() => alive && setSectorCoins([]))
      .finally(() => alive && setSectorLoading(false));
    return () => {
      alive = false;
    };
  }, [sector]);

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
      const rows = sectorCoins;
      if (!query.trim()) return rows;
      const q = query.trim().toLowerCase();
      return rows.filter(
        (c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
      );
    }

    let out = coins ?? [];
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
  }, [coins, filter, query, favorites, sector, sectorCoins]);

  // Coins the search found that aren't in the loaded page. Shown separately so
  // it's obvious they came from a wider lookup, and tappable like any other.
  const extraHits = useMemo(() => {
    if (!query.trim()) return [];
    const have = new Set((list ?? []).map((c) => c.id));
    return (remoteHits ?? []).filter((c) => !have.has(c.id));
  }, [remoteHits, list, query]);

  const hero = coins?.[0];
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
                <div className="faint">{hero.symbol} / USD</div>
              </div>
            </div>
            <div style={{ textAlign: 'end' }}>
              <div className="stat-mini">
                <AnimatedNumber value={hero.price} format={(v) => `$${fmtNum(v, 2)}`} />
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
        <p className="section-label">{t('market.allCoins')}</p>

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
              onClick={() => setSector(sector === sec ? null : sec)}
            >
              {t(`market.sector.${sec}`)}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="stack">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skel" style={{ height: 58 }} />
            ))}
          </div>
        ) : list.length === 0 && extraHits.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">🔍</span>
            {searching ? t('market.searching') : t('market.noResults')}
          </div>
        ) : (
          <motion.div className="stack" style={{ gap: 8 }} variants={stagger} initial="hidden" animate="show">
            {list.map((c, i) => {
              const swappable = isSwappable(c.id);
              const swapUrl = swappable ? swapUrlFor(c.id, 'buy') : null;
              return (
                <div key={c.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <CoinRow coin={c} rank={i + 1} onClick={() => navigate(`/coin/${c.id}`)} />
                  </div>
                  {swappable && swapUrl && (
                    <button
                      className="tag"
                      style={{ flexShrink: 0, minHeight: 36, padding: '6px 10px', borderRadius: 10, background: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))', color: '#fff', border: 'none', fontWeight: 800, fontSize: 11 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(swapUrl);
                      }}
                      title={`${c.symbol} → سواپ در شبکه درست`}
                    >
                      سواپ
                    </button>
                  )}
                </div>
              );
            })}

            {extraHits.length > 0 && (
              <>
                <p className="section-label" style={{ marginTop: 8 }}>{t('market.moreResults')}</p>
                {extraHits.map((c) => {
                  const swappable = isSwappable(c.id);
                  const swapUrl = swappable ? swapUrlFor(c.id, 'buy') : null;
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
                      {swappable && swapUrl && (
                        <button
                          className="tag"
                          style={{ flexShrink: 0, minHeight: 36, padding: '6px 10px', borderRadius: 10, background: 'linear-gradient(135deg, var(--rgb-1), var(--rgb-2))', color: '#fff', border: 'none', fontWeight: 800, fontSize: 11 }}
                          onClick={(e) => { e.stopPropagation(); navigate(swapUrl); }}
                        >
                          سواپ
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
