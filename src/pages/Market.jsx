import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import {
  IconActivity,
  IconChart,
  IconGlobe,
  IconRefresh,
  IconSearch,
  IconSparkle,
  IconStar,
  IconX
} from '../components/Icons';
import FlameIcon from '../components/FlameIcon';
import FBTAICinemaBanner from '../components/FBTAICinemaBanner';
import Ticker from '../components/Ticker';
import DecisionOrb from '../components/DecisionOrb';
import CoinRow from '../components/CoinRow';
import CoinLogo from '../components/CoinLogo';
import AnimatedNumber from '../components/AnimatedNumber';
import Sparkline from '../components/Sparkline';
import TrendChart from '../components/TrendChart';
import MarketStories from '../components/MarketStories';
import '../styles/market-modern.css';
import '../styles/market-ai-search.css';
import { marketCapSeries } from '../lib/globalTrend';
import { useCoinSearch, useGlobalStats, useMarkets, useTrending } from '../hooks/useMarket';
import { fmtCompact, fmtNum, fmtPct, fmtUsd } from '../lib/format';
import { vsOf } from '../lib/currency';
import { useSettingsStore } from '../store/useSettingsStore';
import { getCategory, getMarkets, onMarketVisualsReady } from '../lib/api';
import { MARKET_CATEGORIES, sectorFromRows } from '../lib/marketSectors';
import { DEFAULT_SORT, MARKET_SORTS, freshness, marketBreadth, sortMarketRows } from '../lib/marketList';
import { mergeVisuals } from '../lib/marketVisuals';
import { useAppStore } from '../store/useAppStore';
import { runPriceAlerts, runTopMoverAlerts, syncPriceWatch } from '../lib/priceAlerts';
import { isSwappable, swapUrlFor } from '../lib/coinToSwap';
import { venueRoute } from '../lib/coinVenue';
import { rememberCoinVenues } from '../lib/coinVenues';
import { useCoinVenues } from '../hooks/useCoinVenues';
import { interpretMarketQuery, MARKET_INTENT_SUGGESTIONS } from '../lib/marketIntent';

const FILTERS = ['all', 'gainers', 'losers', 'favorites', 'volume'];

/**
 * HOW MANY TOKENS THE FIRST PAGE HOLDS.
 *
 * 60 made most coins untappable (the detail screen looked the id up in this
 * list and said "not found"); 250 was still a page a trader calls short.
 *
 * ─── WHY THIS IS 250 AND NOT 500 ────────────────────────────────────────
 * It was 500, and 500 never arrived. `/api/markets` clamps `per_page` to 250
 * (CoinGecko's documented maximum for one call), so the page asked for 500,
 * received 250, and then — because the "next page" button is gated on
 * `coins.length >= MARKET_PAGE_SIZE` — could never offer page 2 either. The
 * user was reading «۵۰۰» in the footer of a 250-row list with a button that
 * could not appear.
 *
 * 250 is what one upstream call really answers, and it is what the footer now
 * compares against, so «۵۰ توکن بعدی» works and the screen can reach 500 rows
 * — 250 on first paint, the rest on demand. Half the first-paint payload, one
 * upstream call instead of two, and a count that matches the data.
 */
const MARKET_PAGE_SIZE = 250;

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

function StatTile({ label, value, sub, tone, icon }) {
  return (
    <motion.div className="card card-tight market-stat-tile" variants={riseIn} data-tone={tone ?? 'cyan'}>
      <div className="market-stat-tile-top">
        <span className="market-stat-tile-ico" aria-hidden="true">{icon}</span>
        <div className="faint market-stat-tile-label">{label}</div>
      </div>
      <div className="stat-mini market-stat-tile-val" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub != null && (
        <div className={`mono market-stat-tile-sub ${tone === 'up' ? 'up' : tone === 'down' ? 'down' : ''}`}>
          {sub}
        </div>
      )}
    </motion.div>
  );
}

const SECTOR_GLYPHS = {
  gold: <><circle cx="12" cy="12" r="8" /><path d="m8 14 4-6 4 6H8Z" /><path d="M9 16h6" /></>,
  meme: <><path d="M4.5 13.5c0-4.5 3.2-8 7.5-8s7.5 3.5 7.5 8c0 3.4-3.2 5.5-7.5 5.5s-7.5-2.1-7.5-5.5Z" /><path d="M8.5 12h.01M15.5 12h.01M9 15c1.8 1.2 4.2 1.2 6 0" /></>,
  rwa: <><path d="M4 20h16M6 20V9l6-4 6 4v11" /><path d="M9 12h6M9 15h6" /></>,
  ai: <><path d="M9 7V5m6 2V5M8 8h8a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" /><path d="M9 12h.01M15 12h.01M9 16h6M2 12h3m14 0h3" /></>,
  gaming: <><path d="M7 8h10a4 4 0 0 1 3.8 5.2l-1 3.2a2 2 0 0 1-3.3.8L14 14h-4l-2.5 3.2a2 2 0 0 1-3.3-.8l-1-3.2A4 4 0 0 1 7 8Z" /><path d="M8 10v4m-2-2h4m7-1h.01m2 2h.01" /></>,
  solana: <><path d="M5 7h14l-2 3H3l2-3Zm0 7h14l-2 3H3l2-3Zm2-3h14l-2 3H5l2-3Z" /></>
};

function SectorGlyph({ sector }) {
  return <svg className="market-sector-icon" viewBox="0 0 24 24" aria-hidden="true">{SECTOR_GLYPHS[sector]}</svg>;
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
  /*
   * `updatedAt` is carried out of the poll so the list can say HOW live it is.
   * A dot labelled «قیمت‌های زنده» over a feed that stopped answering forty
   * seconds ago is the kind of claim a trader acts on, so the freshness is
   * printed as a number of seconds rather than asserted as a vibe.
   *
   * `error` + `refresh` are what turn a dead feed from "چیزی پیدا نشد" (which
   * is a lie — the search box is empty) into an honest card with a retry.
   */
  const {
    data: marketCoins,
    loading,
    error: marketError,
    updatedAt,
    refresh: refreshMarkets
  } = useMarkets(MARKET_PAGE_SIZE);
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

  /*
   * THE BACKGROUND MIRROR. The two effects above can only fire while this page
   * is open; `syncPriceWatch` hands the same watchlist to the server (under the
   * device's push identity) so FCM/Web Push delivers the same cards with the
   * app closed and the screen locked — «در پشت زمینه در جریان باشد». Internally
   * throttled by signature + 6h heartbeat, so the 30-second poll costs nothing.
   */
  useEffect(() => {
    if (!coins?.length) return;
    syncPriceWatch({ favorites, coins }).catch(() => {});
  }, [coins, favorites]);

  /*
   * Sector view. `null` means the ordinary market list.
   *
   * Held separately from the sort rather than folded into it because the two
   * are different operations — one re-orders rows already in memory, the other
   * issues a request — and a single piece of state would have to encode "am I
   * loading" for half its values and not the others.
   */
  const [sector, setSector] = useState(null);
  const [sectorCoins, setSectorCoins] = useState([]);
  const [sectorLoading, setSectorLoading] = useState(false);
  /*
   * ─── THE FIVE CHIPS ARE A VIEW, NOT A BUDGET ────────────────────────────
   *   «صعودی‌ها» used to be `sort(byChange).slice(0, 25)`: picking it did not
   *   reorder the market, it deleted 475 rows from it. Sort order and subset
   *   are now two separate pieces of state, and neither one shortens the list —
   *   see lib/marketList.js for the full story and the comparator.
   *
   *   `onlyFavorites` is the ONE subset, because it is defined by the user's
   *   own stars rather than by a number we invented.
   */
  const [query, setQuery] = useState('');
  const [smartIntent, setSmartIntent] = useState(null);
  const [smartFiltersOpen, setSmartFiltersOpen] = useState(false);
  const [sortKey, setSortKey] = useState(DEFAULT_SORT.key);
  const [sortDir, setSortDir] = useState(DEFAULT_SORT.dir);
  const [onlyFavorites, setOnlyFavorites] = useState(false);

  /*
   * Which chip reads as selected is DERIVED from the sort, not stored beside
   * it. One source of truth: choosing "ارزش بازار" in the sort menu has to
   * un-highlight «صعودی‌ها», and two independent states would eventually
   * disagree — a chip lit up over a list it does not describe.
   */
  const activeView = onlyFavorites
    ? 'favorites'
    : sortKey === 'rank' && sortDir === 'asc'
      ? 'all'
      : sortKey === 'change' && sortDir === 'desc'
        ? 'gainers'
        : sortKey === 'change' && sortDir === 'asc'
          ? 'losers'
          : sortKey === 'volume' && sortDir === 'desc'
            ? 'volume'
            : null;

  /*
   * Choosing from the sort menu resets the direction to the one that column is
   * normally read in: rank and price ascending (1, 2, 3 / cheapest first is a
   * fine default for a price column), every numeric measure descending. The
   * direction button beside the menu is what flips it, and the result is
   * visible in the chip row immediately because `activeView` is derived.
   */
  const chooseSort = useCallback((key) => {
    setSmartIntent(null);
    setSortKey(key);
    setSortDir(key === 'rank' ? 'asc' : 'desc');
  }, []);

  const applySmartSearch = useCallback((value) => {
    const intent = interpretMarketQuery(value);
    if (!intent) {
      setSmartIntent(null);
      return false;
    }
    setSmartIntent(intent);
    setSortKey(intent.sortKey);
    setSortDir(intent.sortDir);
    setOnlyFavorites(false);
    setSector(null);
    setSmartFiltersOpen(false);
    return true;
  }, []);

  const applyView = useCallback((view) => {
    /* A view is a market-wide ordering, so it also leaves the sector lens. */
    setSmartIntent(null);
    setSector(null);
    if (view === 'favorites') {
      setOnlyFavorites((on) => !on);
      return;
    }
    setOnlyFavorites(false);
    if (view === 'all') { setSortKey('rank'); setSortDir('asc'); return; }
    if (view === 'gainers') { setSortKey('change'); setSortDir('desc'); return; }
    if (view === 'losers') { setSortKey('change'); setSortDir('asc'); return; }
    if (view === 'volume') { setSortKey('volume'); setSortDir('desc'); }
  }, []);

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
  /* Re-ordering is a new reading of the same list: start it from the top
     rather than leaving the reader 400 rows down a list that no longer has
     those rows in that place. */
  useEffect(() => setVisibleCount(60), [sector, sortKey, sortDir, onlyFavorites, query]);
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

  /*
   * ─── THE ROWS THIS SCREEN ACTUALLY HOLDS ────────────────────────────────
   * A sector replaces the universe rather than filtering it: there are a
   * handful of tokenised-gold tokens in existence and none is in the top 250
   * by market cap, so filtering the loaded page for "gold" would correctly
   * return nothing. Everything below (list, breadth, count) reads this one
   * value, so the three can never describe different sets of coins.
   *
   * Sector fallback: do not blank the tab while the category endpoint is
   * warming or down. It only uses ID-verified members with quotes from the
   * main feed; it is not a symbol/name search or a fabricated category price.
   */
  const universe = useMemo(() => {
    if (sector) return sectorCoins.length ? sectorCoins : sectorFromRows(sector, coins);
    return [...(coins ?? []), ...(secondPage.vs === vs ? secondPage.rows : [])];
  }, [sector, sectorCoins, coins, secondPage, vs]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    // An interpreted natural-language request is an instruction to rank the
    // live universe, not a literal coin-name substring to filter down to zero.
    const rows = q && !smartIntent
      ? universe.filter((c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      : universe;
    const starred = onlyFavorites ? rows.filter((c) => favorites.includes(c.id)) : rows;
    return sortMarketRows(starred, sortKey, sortDir);
  }, [universe, query, smartIntent, onlyFavorites, favorites, sortKey, sortDir]);

  /*
   * Breadth is measured over the UNIVERSE, not over `list`: a search box with
   * four letters in it must not be able to make the market look 80% bearish.
   */
  const breadth = useMemo(() => marketBreadth(universe), [universe]);

  /*
   * ─── «میانگین تغییر» — THE ONE TILE THAT ALWAYS READ 0.00% ──────────────
   * Reported: «میانگین تغییر همیشه صفر نشون میده». It did, and the reason was
   * not the formatting: `global.avgChange` was hard-coded to 0 on the
   * CoinGecko path (that payload is a market-cap aggregate and carries no
   * per-asset average), and `Number(x) || 0` in the client then published the
   * missing value as a measurement of exactly zero.
   *
   * Two real sources now, in order of authority:
   *   1. the server's derived average over its cached markets page
   *      (server/providers.js — same rows, same number, no extra request);
   *   2. the average over the rows THIS screen is holding, which is what
   *      «نبض بازار» below already reports.
   * With neither available the tile prints «—»: an unread average is not 0%.
   */
  const liveAvgChange = useMemo(() => {
    const feedValue = Number.isFinite(Number(global?.avgChange)) && global?.avgChange != null
      ? Number(global.avgChange)
      : null;
    if (feedValue != null) return feedValue;
    return breadth.counted ? breadth.avgChange : null;
  }, [global?.avgChange, breadth]);

  /*
   * ─── HOW OLD IS THIS NUMBER? ────────────────────────────────────────────
   * `updatedAt` only changes when a poll SUCCEEDS, so the gap between it and
   * the clock is the feed's real age — not "time since the page opened". The
   * ticker exists because a static "live" label would keep saying live after
   * the feed had stopped, which is the one thing a price screen must never do.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(id);
  }, []);
  const fresh = freshness(updatedAt, now);

  // Sorting menu is an in-flow popover; it never changes the page's layout position.
  const [sortOpen, setSortOpen] = useState(false);
  const sortWrapRef = useRef(null);
  useEffect(() => {
    if (!sortOpen) return undefined;
    const onPointerDown = (event) => {
      if (!sortWrapRef.current?.contains(event.target)) setSortOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSortOpen(false);
        sortWrapRef.current?.querySelector('.market-sort-trigger')?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [sortOpen]);

  /*
   * ─── THE FIGURE UNDER THE NAME FOLLOWS THE SORT ─────────────────────────
   * Report against the old row: every row printed its volume whether or not
   * volume had anything to do with what the reader was looking at, and it
   * printed it over raw i18n keys. Now the row prints the measure the list is
   * ORDERED by — sort by market cap and the caps appear, sort by volume and
   * the volumes do — and prints nothing when the order is price or change,
   * because both of those numbers are already on the right of every row.
   */
  const rowMetric = useCallback(
    (coin) => {
      if (sortKey === 'volume') {
        return <>{fmtCompact(coin.volume || 0)} <i>{t('market.volumeShort')}</i></>;
      }
      if (sortKey === 'mcap') {
        return <>{fmtCompact(coin.mcap || 0)} <i>{t('market.mcapShort')}</i></>;
      }
      return null;
    },
    [sortKey, t]
  );

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
    if (!query.trim() || sector || smartIntent) return [];
    const have = new Set((list ?? []).map((c) => c.id));
    return (remoteHits ?? []).filter((c) => !have.has(c.id));
  }, [remoteHits, list, query, sector, smartIntent]);

  /*
   * ONE STABLE SLICE FOR THE RAIL.
   *
   * `(coins ?? []).slice(0, 18)` created a NEW array on every render, so the
   * Ticker's `useMemo` key changed on every 30-second poll AND on every
   * keystroke in the search box — rebuilding ~48 segments (and re-mounting
   * their <img> artwork) for a rail whose visible content had not changed.
   */
  const railCoins = useMemo(() => (coins ?? []).slice(0, 18), [coins]);

  /*
   * ─── «داغ‌ترین‌ها» CARRIES NUMBERS, NOT JUST NAMES ───────────────────────
   * `/api/trending` answers id + symbol + name + image + rank — a list of
   * names with no price, no move and no shape, which is why the old rail read
   * as a row of tags rather than as the hottest part of a trading screen.
   *
   * The screen is ALREADY polling 250 coins every 30 seconds, so every one of
   * those names usually has a live row sitting in memory. Joining the two by
   * id costs one Map lookup and no request, and it turns each chip into a real
   * card: rank medal, price, 24h move and the coin's own sparkline.
   *
   * A trending coin that is NOT in the loaded page keeps `price: null` — the
   * card then prints a dash instead of inventing a number. That distinction
   * matters on a screen where every other digit is live.
   */
  const hotCoins = useMemo(() => {
    if (!trending?.length) return [];
    const byId = new Map((coins ?? []).map((c) => [c.id, c]));
    return trending.slice(0, 8).map((t, i) => {
      const live = byId.get(t.id);
      const change = Number(live?.change24h);
      return {
        id: t.id,
        symbol: t.symbol,
        name: t.name,
        image: live?.image ?? t.image,
        place: i + 1,
        price: Number.isFinite(live?.price) && live.price > 0 ? live.price : null,
        change24h: Number.isFinite(change) ? change : null,
        sparkline: Array.isArray(live?.sparkline) && live.sparkline.length > 1 ? live.sparkline : null
      };
    });
  }, [trending, coins]);

  /*
   * ─── MICRO-CAP PRICES, READABLE ─────────────────────────────────────────
   * `fmtPrice` switches to scientific notation below 0.00001, which is right
   * for a dense table cell and wrong for a card whose whole job is to be read
   * at a glance: «$9.983e-6» is not a price anybody reads, it is a number
   * somebody decodes. Inside the hot rail a sub-cent price is printed as a
   * short decimal instead, and the currency mark is taken from `fmtUsd` itself
   * so a user who selected EUR never sees a dollar sign here.
   */
  const currencyMark = useMemo(() => fmtUsd(1).replace(/1(?:[.,]0+)?$/, ''), [vs]);
  const hotPrice = useCallback((p) => {
    if (p == null) return '—';
    if (p > 0 && p < 0.0001) {
      const decimals = Math.min(9, Math.max(4, -Math.floor(Math.log10(p)) + 2));
      const text = p.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
      return `${currencyMark}${text}`;
    }
    return fmtUsd(p);
  }, [currencyMark]);

  const [decisionOpen, setDecisionOpen] = useState(false);
  const hero = coins?.[0];
  /*
   * The 7-day shape of the total, built from the rows already in memory —
   * see lib/globalTrend.js for why it is rebuilt rather than fetched. Derived
   * from `coins`, which the page polls every 30s, so it refreshes with them.
   */
  const trend = useMemo(() => marketCapSeries(coins || [], { maxCoins: 60 }), [coins]);

  const isOffline = global?.offline || coins?.[0]?.offline;

  /*
   * ─── WHAT "MORE" MEANS, IN TWO DIFFERENT SENSES ─────────────────────────
   * The old footer had one button that either revealed rows already in memory
   * or fetched page 2 from the API, and printed the same number for both. They
   * are different promises — one is instant, one is a request — so they now
   * carry different labels, and the "next page" one only offers itself when
   * the feed actually has a page 2 to give and the current view is the plain
   * market list (a sorted or filtered view of the loaded rows would have its
   * order rewritten under the reader by an arriving page).
   */
  const canLoadNext = !sector && !query.trim() && !onlyFavorites
    && sortKey === 'rank' && sortDir === 'asc'
    && !pageDone && (coins?.length ?? 0) >= MARKET_PAGE_SIZE;
  const shownCount = Math.min(visibleCount, list.length);
  const hasMore = list.length > visibleCount || canLoadNext;
  const visibleList = list.slice(0, visibleCount);

  const swapRouteFor = (coin) => {
    const curated = isSwappable(coin.id);
    if (curated) return swapUrlFor(coin.id, 'buy');
    const venue = venues.get(coin.id);
    return venue?.tradeable ? venueRoute({ ...venue })?.href ?? null : null;
  };

  const emptyKind = onlyFavorites && !favorites.length
    ? 'favorites'
    : sector
      ? (sectorLoading ? 'loadingSector' : 'sector')
      : searching
        ? 'searching'
        : query.trim()
          ? 'search'
          : 'none';

  return (
    <>
    <DecisionOrb coins={coins} updatedAt={updatedAt} unavailable={!!marketError || !!isOffline} onOpenChange={setDecisionOpen} />
    <div className={`market-decision-content${decisionOpen ? ' is-open' : ''}`}>
    <PageTransition>
      <Ticker coins={railCoins} />

      {isOffline && <div className="notice">{t('common.offlineData')}</div>}

      <div className={`market-overview${hero ? ' has-hero' : ''}`}>
        {/* ---------- global market card (ultra-modern glassmorphic) ---------- */}
        <motion.section
          className="card market-glass-surface market-global-card"
          variants={riseIn}
          initial="hidden"
          animate="show"
        >
          {/*
            ─── THE SPHERE IS GONE ─────────────────────────────────────────
            «پشتش یک کره هست که زشته، مدرن نیست، شیشه‌ای نیست»

            What was behind this card were two 220px circles painted with a
            single `radial-gradient` — a hard-edged blob that reads as a
            sticker somebody dropped on the card, not as light coming from
            inside it. A sphere is also the one shape glass cannot fake: real
            glass bends what is behind it, and a radial gradient bends nothing.

            Replaced with an AURORA FIELD: three wide, low-opacity gradients
            that overlap, plus a 1px specular sheen along the top edge and a
            faint technical grid masked to fade out. Overlapping soft light is
            what actually reads as "frosted glass with something glowing behind
            it", and because the layers bleed past the card's rounded corners
            (the surface clips them) the colour feels like it belongs to the
            card rather than sitting on it.

            Motion budget: the two blooms animate `transform` + `opacity` only,
            on the compositor, and stop entirely under reduced motion and on
            native WebViews — see the guards at the bottom of market-modern.css.
          */}
          <span className="market-glass-aurora" aria-hidden="true">
            <i className="market-glass-bloom market-glass-bloom--a" />
            <i className="market-glass-bloom market-glass-bloom--b" />
            <i className="market-glass-conic market-glass-conic--global" />
            <i className="market-glass-grid" />
            <i className="market-glass-sheen" />
          </span>

          <div className="market-global-head">
            <div className="market-global-head-text">
              <div className="market-global-kicker">
                <span className="market-live-dot" aria-hidden="true" />
                <span>{t('market.livePrices')}</span>
              </div>
              <div className="market-global-label-row">
                <span className="market-global-mark" aria-hidden="true">
                  <IconGlobe width={15} height={15} />
                </span>
                <div className="market-global-label">{t('market.totalMcap')}</div>
              </div>
              <div className="market-global-value-wrap">
                <div className="stat-value market-global-value">
                  <AnimatedNumber value={global?.mcap ?? 0} format={(v) => fmtCompact(v)} flash={false} />
                </div>
              </div>
            </div>
            <span className={`pill market-change-badge ${(global?.mcapChange ?? 0) >= 0 ? 'pill-up is-up' : 'pill-down is-down'}`}>
              <span className="market-change-arrow" aria-hidden="true">{(global?.mcapChange ?? 0) >= 0 ? '▲' : '▼'}</span>
              {/* Isolated LTR run: without it the RTL paragraph moves the
                  leading «-» to the far side of the number («4.64%-»). */}
              <span className="market-change-num">{fmtPct(global?.mcapChange ?? 0, 2)}</span>
            </span>
          </div>

          <div className="market-global-metrics">
            <div className="market-metric-pod" data-tone="cyan">
              <div className="market-metric-pod-label">{t('market.volume24h')}</div>
              <div className="market-metric-pod-val">{fmtCompact(global?.volume ?? 0)}</div>
            </div>
            <div className="market-metric-pod" data-tone="amber">
              <div className="market-metric-pod-label">{t('market.btcDominance')}</div>
              <div className="market-metric-pod-val">{(global?.btcDominance ?? 0).toFixed(2)}%</div>
            </div>
            <div className="market-metric-pod" data-tone="violet">
              <div className="market-metric-pod-label">{t('market.ethDominance')}</div>
              <div className="market-metric-pod-val">{(global?.ethDominance ?? 0).toFixed(2)}%</div>
            </div>
          </div>

          {/*
            Dominance as a stacked bar WITH a legend. The bar alone said
            "56% of this coloured strip is orange" and left the reader to guess
            which asset the orange was; the legend makes the same three numbers
            above it legible in the shape as well.
          */}
          <div className="market-dominance-wrap">
            <div className="progress market-dominance-bar" role="img" aria-label={t('market.dominanceAria')}>
              <div
                className="progress-fill market-dom-seg market-dom-seg--btc"
                style={{ width: `${Math.min(85, Math.max(10, global?.btcDominance ?? 52))}%` }}
              />
              <div
                className="market-dom-seg market-dom-seg--eth"
                style={{ width: `${Math.min(40, Math.max(5, global?.ethDominance ?? 16))}%` }}
              />
              <div className="market-dom-seg market-dom-seg--other" />
            </div>
            <div className="market-dominance-legend">
              <span className="market-legend-item" data-tone="btc">
                <i aria-hidden="true" />BTC {(global?.btcDominance ?? 0).toFixed(1)}%
              </span>
              <span className="market-legend-item" data-tone="eth">
                <i aria-hidden="true" />ETH {(global?.ethDominance ?? 0).toFixed(1)}%
              </span>
              <span className="market-legend-item" data-tone="other">
                <i aria-hidden="true" />{t('market.dominanceOthers')}
              </span>
            </div>
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
            <div className="market-trend market-trend-glass" data-testid="global-market-trend">
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

        <motion.div className="grid-3 market-stat-grid" variants={stagger} initial="hidden" animate="show">
          <StatTile
            label={t('market.coins')}
            value={fmtNum(global?.coins ?? 0)}
            tone="cyan"
            icon={<IconGlobe width={14} height={14} />}
          />
          <StatTile
            label={t('market.markets')}
            value={fmtNum(global?.markets ?? 0)}
            tone="violet"
            icon={<IconChart width={14} height={14} />}
          />
          <StatTile
            label={t('market.avgChange')}
            value={liveAvgChange == null ? '—' : fmtPct(liveAvgChange, 2)}
            tone={liveAvgChange == null ? 'cyan' : liveAvgChange >= 0 ? 'up' : 'down'}
            icon={<IconActivity width={14} height={14} />}
          />
        </motion.div>

        {/* ---------- hero coin (Bitcoin glass box — no watermark, no swap button) ---------- */}
        {hero && (
          <motion.section
            className="card market-glass-surface market-hero-card"
            variants={riseIn}
            initial="hidden"
            animate="show"
            onClick={() => navigate(`/coin/${hero.id}`)}
            style={{ cursor: 'pointer' }}
            data-testid="market-btc-hero-card"
          >
            {/*
              ─── WHAT WAS REMOVED FROM THIS BOX, AND WHY ──────────────────
              «در پس‌زمینه لوگوی بیت‌کوین زشته، ببرش» · «دکمه swap btc را ببر»

              1. The background Bitcoin mark (an orange radial "orb" plus an
                 oversized ₿ watermark in the corner) is gone. A logo the size
                 of the card, at 16% opacity, behind text, does not decorate the
                 box — it competes with the number the box exists to show. The
                 coin's real logo already sits in the identity tile at 48px,
                 which is where a logo belongs.
              2. Every BUTTON is gone. The whole card is the tap target
                 (`onClick` → /coin/bitcoin), so a swap button inside it was a
                 second, smaller tap target nested inside a first one — the
                 interaction design equivalent of a door with a door on it. One
                 surface, one action, and a static (non-interactive) affordance
                 at the bottom that says what tapping does.

              What replaced the orange glow is the same aurora field as the
              market-cap card, tinted to the coin: light from inside the glass
              instead of a sticker on top of it.
            */}
            <span className="market-glass-aurora market-glass-aurora--hero" aria-hidden="true">
              <i className="market-glass-bloom market-glass-bloom--a" />
              <i className="market-glass-bloom market-glass-bloom--b" />
              <i className="market-glass-conic market-glass-conic--hero" />
              <i className="market-glass-grid" />
              <i className="market-glass-sheen" />
            </span>

            <div className="market-hero-top">
              <div className="market-hero-identity">
                <div className="market-hero-logo-halo">
                  <span className="market-hero-orbit" aria-hidden="true" />
                  <span className="market-hero-orbit market-hero-orbit--rev" aria-hidden="true" />
                  <CoinLogo coin={hero} preferVector />
                  <span className="market-hero-rank-badge mono">#{hero.rank || 1}</span>
                </div>
                <div className="market-hero-id-text">
                  <div className="market-hero-title">{hero.name}</div>
                  <div className="market-hero-pair-row">
                    <span className="market-hero-pair-pill mono">
                      {hero.symbol} / {vs.toUpperCase()}
                    </span>
                    <span className="market-hero-live" aria-hidden="true" />
                  </div>
                </div>
              </div>
              <div className="market-hero-price-col">
                <div className="stat-mini market-hero-price">
                  <AnimatedNumber value={hero.price} format={(v) => fmtUsd(v)} flash={false} />
                </div>
                <span className={`pill market-change-badge ${hero.change24h >= 0 ? 'pill-up is-up' : 'pill-down is-down'}`}>
                  <span className="market-change-arrow" aria-hidden="true">{hero.change24h >= 0 ? '▲' : '▼'}</span>
                  <span className="market-change-num">{fmtPct(hero.change24h)}</span>
                </span>
              </div>
            </div>

            {/*
              24-HOUR RANGE. The one thing this box had that no other card in
              the app shows: where the price sits between its own low and high
              of the last day. Five numbers about right now tell you nothing
              about whether now is the top of the day or the bottom of it; this
              does, in the width of a finger.
            */}
            {hero.low24h > 0 && hero.high24h > hero.low24h && (
              <div className="market-hero-range" data-testid="market-hero-range">
                <div className="market-hero-range-head">
                  <span className="market-hero-range-label">{t('market.range24h')}</span>
                  <span className="market-hero-range-pct mono">
                    {Math.round(
                      Math.min(100, Math.max(0, ((hero.price - hero.low24h) / (hero.high24h - hero.low24h)) * 100))
                    )}
                    %
                  </span>
                </div>
                <div className="market-hero-range-track">
                  <span
                    className="market-hero-range-marker"
                    style={{
                      insetInlineStart: `${Math.min(98, Math.max(2, ((hero.price - hero.low24h) / (hero.high24h - hero.low24h)) * 100))}%`
                    }}
                  />
                </div>
                <div className="market-hero-range-scale mono">
                  <span>{fmtUsd(hero.low24h)}</span>
                  <span>{fmtUsd(hero.high24h)}</span>
                </div>
              </div>
            )}

            <div className="market-hero-metrics">
              <div className="market-hero-mini-pod">
                <div className="market-hero-mini-lbl">{t('market.totalMcap')}</div>
                <div className="market-hero-mini-val mono">{fmtCompact(hero.mcap || 0)}</div>
              </div>
              <div className="market-hero-mini-pod">
                <div className="market-hero-mini-lbl">{t('market.volume24h')}</div>
                <div className="market-hero-mini-val mono">{fmtCompact(hero.volume || 0)}</div>
              </div>
              <div className="market-hero-mini-pod">
                <div className="market-hero-mini-lbl">{t('market.btcDominance')}</div>
                <div className="market-hero-mini-val mono">{(global?.btcDominance ?? 52).toFixed(1)}%</div>
              </div>
            </div>

            {/*
              The line now ends on a MARKER at the live price. Six days of
              shape with no point that says "this is now" made the reader work
              out which end of the curve they were looking at — the dot is the
              reading, the curve is the context. `strokeWidth` is nudged on the
              hero only; the 60 rows in the list keep the thin, glow-free,
              no-dot chart they need to stay cheap.
            */}
            <div className="market-hero-chart market-hero-chart-well">
              <Sparkline
                data={hero.sparkline ?? []}
                up={hero.change24h >= 0}
                width={470}
                height={64}
                strokeWidth={2.2}
                dot
              />
            </div>

            {/* A `<span>`, never a `<button>`: this card is already one big tap
                target and a nested control would fight it for the gesture. */}
            <span className="market-hero-explore">
              <span className="market-hero-explore-text">{t('market.heroExplore')}</span>
              <span className="market-hero-explore-arrow" aria-hidden="true" />
            </span>
          </motion.section>
        )}
      </div>

      {/* ---------- Instagram-style 1-minute App Stories below Bitcoin card ---------- */}
      <MarketStories coins={coins} global={global} />

      {/* The «سیگنال هوشمند» house ad, rebuilt as the FBT AI living-intelligence
          showcase. A dedicated component rather than another flag on the shared
          AdBanner — see FBTAICinemaBanner for why. */}
      <div className="market-signal-promo"><FBTAICinemaBanner /></div>

      {/* ---------- trending ---------- */}
      {hotCoins.length > 0 && (
        <section className="market-trending" aria-labelledby="market-trending-title">
          <span className="market-trending-aurora" aria-hidden="true" />
          <div className="market-trending-head">
            <span className="market-trending-flame" aria-hidden="true">
              <FlameIcon size={21} />
            </span>
            <span className="market-trending-heading">
              <span className="market-trending-title" id="market-trending-title">{t('market.trending')}</span>
              <span className="market-trending-kicker" aria-hidden="true">
                {t('market.trendingBasis', { defaultValue: 'Most searched right now' })}
              </span>
            </span>
            <span className="market-trending-badge mono">HOT</span>
          </div>
          {/*
            ─── WHY EACH CHIP HAS FOUR FACTS INSTEAD OF ONE ──────────────────
            The old chip was a rank, a logo and a ticker — a bookmark, not a
            market instrument. A ranked card is now: medal, identity, price,
            the day's move, and the coin's own 7-day line (thinned server-side
            to 48 points, so it is the same array the rows already carry).
            Everything except the medal comes from the rows this screen is
            already holding — see `hotCoins` above. Nothing here is fetched.
          */}
          <div className="tag-scroll market-trending-rail">
            {hotCoins.map((c) => (
              <button
                key={c.id}
                type="button"
                className="tag market-trending-chip"
                onClick={() => navigate(`/coin/${c.id}`)}
                aria-label={`${c.name} (${c.symbol}) — ${hotPrice(c.price)}${c.change24h == null ? '' : `, ${fmtPct(c.change24h, 1)}`}`}
              >
                <span className="market-trending-chip-head">
                  <span className="market-trending-rank mono" data-medal={c.place <= 3 ? c.place : undefined}>
                    {c.place}
                  </span>
                  <span className="market-trending-logo">
                    <CoinLogo coin={c} size="thumb" px={30} />
                  </span>
                  <span className="market-trending-txt">
                    <b>{c.symbol}</b>
                    <small>{c.name}</small>
                  </span>
                </span>
                {/* The price never shrinks and the pill never wraps: at 168px
                    both fit side by side, and a clipped price («$165.3») is
                    worse than a smaller one — it is a wrong number. */}
                <span className="market-trending-chip-price">
                  <span className="market-trending-price mono">{hotPrice(c.price)}</span>
                  {c.change24h != null && (
                    <span className="market-trending-chg mono" data-dir={c.change24h >= 0 ? 'up' : 'down'}>
                      {fmtPct(c.change24h, 1)}
                    </span>
                  )}
                </span>
                <span className="market-trending-spark" aria-hidden="true">
                  {c.sparkline
                    ? <Sparkline data={c.sparkline} width={132} height={22} up={(c.change24h ?? 0) >= 0} strokeWidth={1.7} glow={false} animate={false} />
                    : null}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/*
        ══════════════════════════════════════════════════════════════════════
        THE MARKET TERMINAL
        ══════════════════════════════════════════════════════════════════════
        What this section replaces, and why it is shaped this way:

        1. FOUR CONTROLS THAT DISAGREED. The old block was a title, a search
           box, a chip row and a second chip row, each with its own spacing,
           and the chips were three sorts pretending to be filters (see
           lib/marketList.js). They are now one glass command bar with three
           jobs: find (search), order (views + sort) and narrow (sectors,
           deliberately its own row because tapping one issues a request).

        2. THE CONTROLS NEVER FLOAT. Search and sort stay anchored to the list
           header in normal document flow, never overlapping or obscuring rows.

        3. NOTHING SAID HOW THE MARKET WAS DOING. Six numbers about right now
           and no answer to "is the page mostly green or mostly red". The
           breadth strip counts the rows this screen holds, and says how many
           that is — a count, never a sentiment score.

        4. A DEAD FEED LOOKED LIKE AN EMPTY SEARCH. With no rows and no error
           branch the page printed «چیزی پیدا نشد» over a working network and
           an empty query. There is now an explicit failure card with a retry.
      */}
      <section className="market-terminal" aria-labelledby="market-list-title">
        <div className="market-terminal-head">
          <h2 className="market-terminal-title" id="market-list-title">
            <span className="market-terminal-title-text">
              {sector ? t(`market.sector.${sector}`) : t('market.allCoins')}
            </span>
            <span className="market-count mono" aria-live="polite" data-testid="market-count">
              {fmtNum(list.length)}
            </span>
          </h2>

          <div className="market-head-actions">
            {fresh && (
              <span
                className="market-fresh mono"
                data-stale={fresh.stale ? 'true' : 'false'}
                title={t('market.freshTitle')}
              >
                <i aria-hidden="true" />
                {fresh.stale
                  ? t('market.updatedStale', { minutes: Math.max(1, fresh.minutes) })
                  : t('market.updatedAgo', { seconds: fresh.seconds })}
              </span>
            )}
            {/*
              A REFRESH THE READER CAN PRESS.

              The feed polls every 30s on its own, which is fine until it does
              not — and the freshness label above can then say "older than four
              minutes" with nothing to do about it except reload the app. This
              asks the same `usePoll` the timer does; it is not a second
              request, it is the same one, earlier.
            */}
            <button
              type="button"
              className="market-refresh"
              onClick={() => refreshMarkets?.()}
              disabled={loading}
              data-busy={loading ? 'true' : undefined}
              aria-label={t('market.refresh')}
              title={t('market.refresh')}
              data-testid="market-refresh"
            >
              <IconRefresh width={14} height={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="market-compare"
              onClick={() => navigate('/compare')}
              aria-label={t('market.compare')}
            >
              <IconChart width={14} height={14} aria-hidden="true" />
              <span>{t('market.compare')}</span>
            </button>
          </div>
        </div>

        {/* ---------- the command bar: find · order ----------
            Anchored in normal document flow: this block never becomes a
            floating overlay, so it can never cover a token row. */}
        <div className="market-cmd">
          <div className="market-search-wrap">
            <div className={`market-search market-search--smart${smartFiltersOpen ? ' is-open' : ''}`}>
              <span className="market-search-ico" aria-hidden="true">
                <IconSearch className="market-search-icon" width={15} height={15} />
              </span>
              <input
                id="market-coin-search"
                className="market-search-input"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSmartIntent(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applySmartSearch(query);
                  if (e.key === 'Escape') setSmartFiltersOpen(false);
                }}
                placeholder={t('market.aiPlaceholder', { defaultValue: 'از بازار بپرس… مثلاً پرسودترین ارزها' })}
                aria-label={t('market.searchAria')}
                autoComplete="off"
                enterKeyHint="search"
                spellCheck="false"
              />
              {query && (
                <button
                  type="button"
                  className="market-search-clear"
                  onClick={() => { setQuery(''); setSmartIntent(null); }}
                  aria-label={t('market.clearSearch')}
                >
                  <IconX width={13} height={13} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                className="market-ai-trigger"
                onClick={() => setSmartFiltersOpen((open) => !open)}
                aria-label={t('market.aiSearch', { defaultValue: 'جستجوی هوشمند بازار' })}
                aria-expanded={smartFiltersOpen}
                aria-controls="market-ai-suggestions"
                title={t('market.aiSearch', { defaultValue: 'جستجوی هوشمند بازار' })}
              >
                <IconSparkle width={18} height={18} aria-hidden="true" />
              </button>
            </div>
            {smartFiltersOpen && (
              <div className="market-ai-suggestions" id="market-ai-suggestions" role="group" aria-label={t('market.aiSuggestions', { defaultValue: 'پیشنهادهای جستجوی هوشمند' })}>
                <div className="market-ai-suggestions-head">
                  <span className="market-ai-live-dot" aria-hidden="true" />
                  <span>{t('market.aiHint', { defaultValue: 'از داده‌های زنده بازار سؤال کن' })}</span>
                </div>
                <div className="market-ai-suggestion-list">
                  {MARKET_INTENT_SUGGESTIONS.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion.key}
                      className="market-ai-suggestion"
                      onClick={() => {
                        setQuery(suggestion.query);
                        applySmartSearch(suggestion.query);
                      }}
                    >
                      <IconSparkle width={13} height={13} aria-hidden="true" />
                      <span>{t(`market.aiSuggestion.${suggestion.key}`, { defaultValue: suggestion.query })}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {smartIntent && (
              <div className="market-ai-result" role="status" aria-live="polite">
                <IconSparkle width={13} height={13} aria-hidden="true" />
                <span>{t(`market.aiApplied.${smartIntent.key}`, { defaultValue: `رتبه‌بندی بر اساس ${smartIntent.key}` })}</span>
                <span className="market-ai-result-note">{t('market.aiBasedOnLive', { defaultValue: 'بر پایه تغییرات واقعی ۲۴ ساعت' })}</span>
              </div>
            )}
          </div>

          <div className="market-cmd-row">
            <div className="market-views" role="group" aria-label={t('market.viewsAria')}>
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="market-view"
                  data-active={activeView === f ? 'true' : undefined}
                  aria-pressed={activeView === f}
                  onClick={() => applyView(f)}
                >
                  {t(`market.filter.${f}`)}
                </button>
              ))}
            </div>

            <div className="market-sort-wrap" ref={sortWrapRef}>
              <button
                type="button"
                className="market-sort-trigger"
                aria-label={t('market.sortAria')}
                aria-haspopup="menu"
                aria-expanded={sortOpen}
                aria-controls="market-sort-options"
                onClick={() => setSortOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setSortOpen(true);
                    requestAnimationFrame(() => sortWrapRef.current?.querySelector('.market-sort-option')?.focus());
                  }
                }}
                data-testid="market-sort"
              >
                <span className="market-sort-trigger-kicker">{t('market.sortAria')}</span>
                <span className="market-sort-trigger-value">{t(`market.sort.${sortKey}`)}</span>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
              </button>
              {sortOpen && (
                <div
                  className="market-sort-popover"
                  id="market-sort-options"
                  role="menu"
                  aria-label={t('market.sortAria')}
                  onKeyDown={(event) => {
                    const options = [...event.currentTarget.querySelectorAll('.market-sort-option')];
                    const index = options.indexOf(document.activeElement);
                    let next = null;
                    if (event.key === 'ArrowDown') next = (index + 1) % options.length;
                    else if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
                    else if (event.key === 'Home') next = 0;
                    else if (event.key === 'End') next = options.length - 1;
                    if (next != null) { event.preventDefault(); options[next]?.focus(); }
                  }}
                >
                  <span className="market-sort-popover-caret" aria-hidden="true" />
                  <div className="market-sort-popover-head mono">
                    {t('market.sortTitle', { defaultValue: t('market.sortAria') })}
                  </div>
                  {MARKET_SORTS.map((key) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortKey === key}
                      className="market-sort-option"
                      key={key}
                      onClick={() => { chooseSort(key); setSortOpen(false); }}
                    >
                      <span className="market-sort-option-dot" aria-hidden="true" />
                      <span className="market-sort-option-label">{t(`market.sort.${key}`)}</span>
                      {sortKey === key && <span className="market-sort-check" aria-hidden="true">✓</span>}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="market-dir"
                data-dir={sortDir}
                onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                aria-label={sortDir === 'desc' ? t('market.dirDesc') : t('market.dirAsc')}
                title={sortDir === 'desc' ? t('market.dirDesc') : t('market.dirAsc')}
                data-testid="market-sort-dir"
              >
                <span aria-hidden="true">{sortDir === 'desc' ? '↓' : '↑'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ---------- breadth: is this page mostly green or mostly red? ---------- */}
        <div
          className="market-breadth"
          data-empty={breadth.counted === 0 ? 'true' : undefined}
          data-testid="market-breadth"
        >
          <div className="market-breadth-head">
            <span className="market-breadth-title-wrap">
              <span className="market-breadth-mark" aria-hidden="true">
                <IconActivity width={13} height={13} />
              </span>
              <span className="market-breadth-title">{t('market.breadthTitle')}</span>
            </span>
            <span
              className="market-breadth-avg mono"
              data-tone={breadth.avgChange >= 0 ? 'up' : 'down'}
            >
              {t('market.breadthAvg', { pct: fmtPct(breadth.avgChange, 2) })}
            </span>
          </div>
          {/*
            THE ANSWER, AS A DIAL.
            «نبض بازار را باکسش خیلی مدرن تر کن»

            A single coloured bar answers "how much is up" and nothing else.
            The ring is the same three shares drawn as one circle — up, flat,
            down — with the up-share printed in the middle of it, which is the
            one number a trader reads first, and it is legible from across a
            room because it is the only figure in the card set in 11.5px black.

            It is a STATIC conic-gradient: no animation, no filter, no SVG, and
            the three shares are passed as custom properties so the ring can
            never disagree with the chips beside it (both read `breadth`).
          */}
          <div className="market-breadth-body">
            <span
              className="market-breadth-ring mono"
              /* The number in the middle IS the up-share, so its colour follows
                 that share — not the average change in the header. Two
                 different measurements, two different colours. */
              data-tone={breadth.upShare >= 0.5 ? 'up' : 'down'}
              role="img"
              aria-label={t('market.breadthAria', {
                up: fmtNum(breadth.up),
                down: fmtNum(breadth.down),
                total: fmtNum(breadth.counted)
              })}
              style={{
                '--up': (breadth.upShare * 100).toFixed(1),
                '--flat': (breadth.flatShare * 100).toFixed(1)
              }}
            >
              <b>{Math.round(breadth.upShare * 100)}%</b>
            </span>
            <div className="market-breadth-side">
              <div className="market-breadth-legend">
                <span className="market-breadth-item" data-tone="up" data-testid="market-breadth-up">
                  <i aria-hidden="true" />{t('market.breadthUp', { count: fmtNum(breadth.up) })}
                </span>
                <span className="market-breadth-item" data-tone="down" data-testid="market-breadth-down">
                  <i aria-hidden="true" />{t('market.breadthDown', { count: fmtNum(breadth.down) })}
                </span>
                {breadth.flat > 0 && (
                  <span className="market-breadth-item" data-tone="flat">
                    <i aria-hidden="true" />{t('market.breadthFlat', { count: fmtNum(breadth.flat) })}
                  </span>
                )}
                {breadth.unknown > 0 && (
                  <span className="market-breadth-item" data-tone="unknown">
                    <i aria-hidden="true" />{t('market.breadthUnknown', { count: fmtNum(breadth.unknown) })}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* The precise reading stays: the ring is the shape, the bar is the
              measurement, and a two-segment difference of 1% is easier to see
              as a proportion of a line than of a circle. */}
          <div
            className="market-breadth-bar"
            aria-hidden="true"
          >
            <span className="market-breadth-seg is-up" style={{ width: `${breadth.upShare * 100}%` }} />
            <span className="market-breadth-seg is-flat" style={{ width: `${breadth.flatShare * 100}%` }} />
            <span className="market-breadth-seg is-down" style={{ width: `${breadth.downShare * 100}%` }} />
          </div>

          <p className="market-breadth-note">
            {t('market.breadthNote', { count: fmtNum(breadth.counted) })}
          </p>
        </div>

        {/*
          Sectors on their own row, below the bar.

          Mixed into the view chips they would look like more sorts of the same
          list, which is exactly what they are not — tapping one issues a
          request for a different set of coins entirely. The coloured mark on
          each chip is the sector's own hue, so gold, memecoins and RWA are
          distinguishable at a glance instead of being six identical pills.
        */}
        <div className="market-sectors" role="group" aria-label={t('market.sectorsAria')}>
          <span className="market-sectors-label">{t('market.sectorsLabel')}</span>
          <div className="market-sectors-rail">
            {SECTORS.map((sec) => (
              <button
                key={sec}
                type="button"
                className="market-sector"
                data-sector={sec}
                data-active={sector === sec ? 'true' : undefined}
                aria-pressed={sector === sec}
                onClick={() => {
                  setSectorCoins([]);
                  setSector(sector === sec ? null : sec);
                }}
              >
                <span className="market-sector-ico" aria-hidden="true">
                  <SectorGlyph sector={sec} />
                </span>
                <span className="market-sector-txt">{t(`market.sector.${sec}`)}</span>
              </button>
            ))}
          </div>
        </div>

        {loading && !list.length ? (
          <div className="stack market-coin-grid" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skel market-skel-row" />
            ))}
          </div>
        ) : marketError && !list.length ? (
          /*
           * THE FEED IS DOWN, AND THE PAGE SAYS SO.
           *
           * Not «چیزی پیدا نشد»: that sentence is about a search that returned
           * nothing, and printing it over a network failure teaches the reader
           * that the app is empty rather than that the app is offline. Nothing
           * is drawn from memory here either — a stale price on a trade screen
           * is worse than a blank one.
           */
          <div className="market-empty" data-kind="error" data-testid="market-feed-error">
            <span className="market-empty-icon" aria-hidden="true">
              <IconRefresh width={20} height={20} />
            </span>
            <div className="market-empty-title">{t('market.feedDown')}</div>
            <p className="market-empty-help">{t('market.feedDownHelp')}</p>
            <button
              type="button"
              className="market-empty-action"
              onClick={() => refreshMarkets?.()}
              data-testid="market-retry"
            >
              <IconRefresh width={14} height={14} aria-hidden="true" />
              {t('market.retry')}
            </button>
          </div>
        ) : (
          <>
            {emptyKind !== 'none' && !list.length && !extraHits.length && (
              <div className="market-empty" data-kind={emptyKind}>
                <span className="market-empty-icon" aria-hidden="true">
                  {emptyKind === 'favorites'
                    ? <IconStar width={20} height={20} />
                    : emptyKind === 'searching' || emptyKind === 'loadingSector'
                      ? <IconRefresh width={20} height={20} />
                      : <IconSearch width={20} height={20} />}
                </span>
                <div className="market-empty-title">
                  {emptyKind === 'favorites'
                    ? t('market.emptyFavorites')
                    : emptyKind === 'searching'
                      ? t('market.searching')
                      : emptyKind === 'loadingSector'
                        ? t('market.loadingSector')
                        : emptyKind === 'sector'
                          ? t('market.sectorEmpty')
                          : t('market.noResults')}
                </div>
                {emptyKind === 'favorites' && (
                  <p className="market-empty-help">{t('market.emptyFavoritesHelp')}</p>
                )}
                {(emptyKind === 'favorites' || emptyKind === 'search' || emptyKind === 'sector') && (
                  <button
                    type="button"
                    className="market-empty-action"
                    onClick={() => {
                      setQuery('');
                      setSector(null);
                      setOnlyFavorites(false);
                      setSortKey('rank');
                      setSortDir('asc');
                    }}
                  >
                    {t('market.showAll')}
                  </button>
                )}
              </div>
            )}

            {/*
              NO STAGGERED ENTRANCE ON A 60-ROW LIST.
              The container used to hand each row a 0.04s delay, so a freshly
              loaded page kept its lower rows invisible for seconds — read as
              "the page is black until you scroll back up". Rows now animate
              themselves (see CoinRow), which keeps the list honest at any
              length: what has mounted is visible.
            */}
            <div className="stack market-coin-grid">
              {visibleList.map((c, i) => {
                /*
                  ─── ONE TAP, TWO ANSWERS ─────────────────────────────────
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
                const swapUrl = swapRouteFor(c);
                return (
                  <div key={c.id} className="market-coin-row">
                    <CoinRow
                      coin={c}
                      rank={c.rank || i + 1}
                      metric={rowMetric(c)}
                      /* Long list: no entrance animation, no stroke draw-in.
                         Sixty of each is what a scroll budget pays for nothing
                         the reader asked to see. */
                      animate={false}
                      onClick={() => navigate(`/coin/${c.id}`)}
                    />
                    {swapUrl && (
                      <button
                        type="button"
                        className="market-swap-btn"
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
            </div>

            {/*
              THE FOOTER SAYS WHERE YOU ARE.

              «نمایش بیشتر» alone left the reader guessing whether they had
              seen twenty coins or two hundred. The count is printed, the bar
              is the share of the loaded list already on screen, and the two
              kinds of "more" carry different labels because only one of them
              waits on the network.
            */}
            {hasMore && (
              <div className="market-more">
                <div className="market-more-meta">
                  <span className="mono" data-testid="market-showing">
                    {t('market.showing', {
                      shown: fmtNum(shownCount),
                      total: fmtNum(list.length || shownCount)
                    })}
                  </span>
                  <span className="market-more-track" aria-hidden="true">
                    <span
                      className="market-more-fill"
                      style={{ width: `${list.length ? Math.min(100, (shownCount / list.length) * 100) : 0}%` }}
                    />
                  </span>
                </div>
                <button
                  type="button"
                  className="market-show-more"
                  disabled={pageLoading}
                  onClick={() => (list.length > visibleCount ? setVisibleCount((n) => n + 60) : loadNextPage())}
                >
                  {pageLoading
                    ? t('market.loadingSector')
                    : list.length > visibleCount
                      ? t('market.showMore', { count: fmtNum(list.length - visibleCount) })
                      : t('market.nextPage')}
                </button>
              </div>
            )}

            {/* Coins the wider search found that are not in the loaded page. */}
            {extraHits.length > 0 && (
              <section className="market-more-results">
                <p className="section-label">{t('market.moreResults')}</p>
                <motion.div className="stack market-coin-grid" variants={stagger} initial="hidden" animate="show">
                  {extraHits.map((c) => {
                    const swapUrl = swapRouteFor(c);
                    return (
                      <div key={c.id} className="market-coin-row">
                        <CoinRow
                          coin={c}
                          rank={c.rank || undefined}
                          animate={false}
                          onClick={() => navigate(`/coin/${c.id}`)}
                        />
                        {swapUrl && (
                          <button
                            type="button"
                            className="market-swap-btn"
                            onClick={(e) => { e.stopPropagation(); navigate(swapUrl); }}
                          >
                            {t('market.swap')}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </motion.div>
              </section>
            )}
          </>
        )}
      </section>
    </PageTransition>
    </div>
    </>
  );
}
