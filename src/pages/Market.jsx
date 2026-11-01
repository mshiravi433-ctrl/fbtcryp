import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition from '../components/PageTransition';
import {
  IconActivity,
  IconChart,
  IconCheck,
  IconRefresh,
  IconSearch,
  IconSparkle,
  IconStar,
  IconSwap
} from '../components/Icons';
import {
  FILTER_GLYPHS,
  GlyphCaretDown,
  GlyphPulse,
  GlyphSortAsc,
  GlyphSortDesc
} from '../components/market/MarketGlyphs';
import DecisionOrb from '../components/DecisionOrb';
import CoinRow from '../components/CoinRow';
import MarketStories from '../components/MarketStories';
import MarketSearch from '../components/market/MarketSearch';
import MarketSectorRail from '../components/market/MarketSectorRail';
import MarketOverview from '../components/market/MarketOverview';
import MarketFreshness from '../components/market/MarketFreshness';
import SmartMoneyBanner from '../components/market/SmartMoneyBanner';
import HotCoins from '../components/market/HotCoins';
import MarketHeroBanner from '../components/market/MarketHeroBanner';
import MarketTabStrip from '../components/market/MarketTabStrip';
import { revealMarketTabStart, useMarketTab } from '../hooks/useMarketTab';
import { useMarketCategory } from '../hooks/useMarketCategory';
import '../styles/market-modern.css';
import '../styles/market-intelligence.css';
import '../styles/market-glass-v3.css';
import '../styles/market-aurora-glass.css';
import '../styles/market-obsidian-glass.css';
/*
 * ─── THE TAB STRIP — «مرور / توکن» ────────────────────────────────────────
 * The sheet that draws the two tabs, in the material the five layers above
 * already define (it declares no new colour, no new light and no blur). It
 * sits AFTER the design layers because it is the one control whose whole job
 * is to match them — and BEFORE the scroll budget, which must be able to
 * park anything this sheet animates.
 */
import '../styles/market-tabs.css';
import '../styles/market-hero-banner.css';
/*
 * ─── THE SCROLL BUDGET, LAST ──────────────────────────────────────────────
 * The five sheets above are the design layers (one per pass, each with its
 * own regression pins). This one is the stop policy: which ambient loops may
 * run while a reader scrolls, and which parts of a card the browser may treat
 * as independent paint units. It is imported LAST and only here, so its rules
 * win at equal specificity without editing a design sheet that a test
 * describes, and so no other route pays for it.
 *
 * It changes no number, no label and no colour — see styles/market-perf.css.
 */
import '../styles/market-perf.css';
import { marketCapSeries } from '../lib/globalTrend';
import { useCoinSearch, useGlobalStats, useMarkets, useTrending } from '../hooks/useMarket';
import { fmtCompact, fmtNum, fmtPct } from '../lib/format';
import { vsOf } from '../lib/currency';
import { useSettingsStore } from '../store/useSettingsStore';
import { getMarkets, onMarketVisualsReady } from '../lib/api';
import { MARKET_CATEGORIES, isBinanceRiskSector, sectorFromRows } from '../lib/marketSectors';
import { DEFAULT_SORT, MARKET_SORTS, marketBreadth, sortMarketRows } from '../lib/marketList';
import { mergeVisuals } from '../lib/marketVisuals';
import { useAppStore } from '../store/useAppStore';
import { runPriceAlerts, runTopMoverAlerts, syncPriceWatch } from '../lib/priceAlerts';
import { isSwappable, swapUrlFor } from '../lib/coinToSwap';
import { venueRoute } from '../lib/coinVenue';
import { rememberCoinVenues } from '../lib/coinVenues';
import { useCoinVenues } from '../hooks/useCoinVenues';
import { interpretMarketQuery } from '../lib/marketIntent';
import { finiteOrNull, positiveOrNull } from '../lib/marketPresentation';

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
const FOLDED_ROWS = 12;

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

/** The five list views, same vocabulary, same 14px optical size. */
function FilterGlyph({ view }) {
  const Glyph = FILTER_GLYPHS[view];
  if (!Glyph) return null;
  return <Glyph className="mx-view-icon" width={13} height={13} />;
}

export default function Market() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const favorites = useAppStore((s) => s.favorites);
  const vs = vsOf(useSettingsStore((s) => s.currency));

  /*
   * ─── THE TWO TABS ───────────────────────────────────────────────────────
   * «در صفحه بازار دو تب کن» — see lib/marketTabs.js for what belongs to each
   * one and why the model is a separate module.
   *
   * The state lives in the URL (`?tab=tokens`), so it survives a reload, a
   * return from another screen and a shared link, and it costs no request:
   * BOTH panels read the feed this component was already polling, and the
   * closed one is not mounted at all.
   */
  const [tab, setTab] = useMarketTab();
  const changeTab = useCallback((next) => {
    setTab(next);
    /* A tab of a different height must not open halfway down the previous
       one — see revealMarketTabStart(). */
    revealMarketTabStart();
  }, [setTab]);

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
  const category = useMarketCategory(sector, vs, tab === 'tokens');
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
  const [listFolded, setListFolded] = useState(false);
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
  useEffect(() => {
    setVisibleCount(60);
    setListFolded(false);
  }, [sector, sortKey, sortDir, onlyFavorites, query]);
  useEffect(() => { setSecondPage({ vs, rows: [] }); setPageDone(false); }, [vs]);

  // Anything not in the loaded page is found by querying the full universe.
  const { results: remoteHits, searching, error: searchError } = useCoinSearch(query, 2, vs);

  /*
   * ─── THE ROWS THIS SCREEN ACTUALLY HOLDS ────────────────────────────────
   * A sector replaces the universe rather than filtering it: there are a
   * handful of tokenised-gold tokens in existence and none is in the top 250
   * by market cap, so filtering the loaded page for "gold" would correctly
   * return nothing. Everything below (list, breadth, count) reads this one
   * value, so the three can never describe different sets of coins.
   *
   * Only after a provider failure may the small, dated ID-only backup be
   * shown, with a visible partial-list notice. Risk tags NEVER use that backup.
   */
  const universe = useMemo(() => {
    if (sector) {
      if (category.rows.length) return category.rows;
      if (category.error && !isBinanceRiskSector(sector)) {
        return sectorFromRows(sector, coins).map((row) => ({ ...row, classificationFallback: true }));
      }
      return [];
    }
    return [...(coins ?? []), ...(secondPage.vs === vs ? secondPage.rows : [])];
  }, [sector, category.rows, category.error, coins, secondPage, vs]);
  const categoryFallback = Boolean(sector && universe.some((row) => row.classificationFallback));
  const categoryStale = Boolean(sector && universe.some((row) => row.dataProvenance === 'stale'));

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
  /*
   * The clock moved OUT of this component (2026-11-01). It used to tick here,
   * which re-rendered the whole screen — stories reel, search results, sector
   * rail and 60 memoised rows — six times a minute to move ONE number in the
   * lens head. `<MarketFreshness>` owns the interval now and re-renders a
   * `<span>`. The rounding (5s steps) and the 90s staleness rule live in
   * lib/marketList.js `freshness()` and are unchanged: a feed that stopped
   * answering must stop calling itself live.
   */

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
  // Folding is a reading preference, not a pagination/data-budget reset.
  const rowCap = listFolded ? Math.min(FOLDED_ROWS, visibleCount) : visibleCount;
  const visibleCoins = useMemo(() => (list ?? []).slice(0, rowCap), [list, rowCap]);
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
      /* The trending feed's own quote is USD only: it fills a gap in the live
         row for a USD reader, and is never shown beside another currency. */
      const quote = vs === 'usd' ? t : null;
      return {
        id: t.id,
        symbol: t.symbol,
        name: t.name,
        image: live?.image ?? t.image,
        place: i + 1,
        price: positiveOrNull(live?.price) ?? positiveOrNull(quote?.price),
        /* finiteOrNull, not Number(): Number(null) is 0, and a missing move
           was being printed as a measured 0.00% with an up arrow. */
        change24h: finiteOrNull(live?.change24h) ?? finiteOrNull(quote?.change24h),
        volume: positiveOrNull(live?.volume),
        sparkline: Array.isArray(live?.sparkline) && live.sparkline.length > 1 ? live.sparkline : null
      };
    });
  }, [trending, coins, vs]);

  const [decisionOpen, setDecisionOpen] = useState(false);
  const bitcoin = useMemo(
    () => (coins ?? []).find((coin) => coin.id === 'bitcoin') ?? (coins ?? []).find((coin) => coin.symbol === 'BTC'),
    [coins]
  );
  const openCoin = useCallback((id) => navigate(`/coin/${id}`), [navigate]);
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
  const canLoadCategory = Boolean(sector && category.hasMore && !categoryFallback && !category.error);
  const hasMore = list.length > visibleCount || canLoadNext || canLoadCategory;
  const visibleList = list.slice(0, rowCap);
  const shownCount = visibleList.length;

  const swapRouteFor = (coin) => {
    const curated = isSwappable(coin.id);
    if (curated) return swapUrlFor(coin.id, 'buy');
    const venue = venues.get(coin.id);
    return venue?.tradeable ? venueRoute({ ...venue })?.href ?? null : null;
  };

  const emptyKind = sector && category.error && !universe.length
    ? 'sectorError'
    : onlyFavorites && !favorites.length
      ? 'favorites'
      : sector
        ? (category.loading ? 'loadingSector' : query.trim() ? 'search' : 'sector')
      : searching
        ? 'searching'
        : query.trim()
          ? 'search'
          : 'none';

  return (
    <>
      <DecisionOrb coins={coins} updatedAt={updatedAt} unavailable={!!marketError || !!isOffline} onOpenChange={setDecisionOpen} />
      <div className={`market-decision-content${decisionOpen ? ' is-open' : ''}`}>
        <PageTransition className="page mx-market">
          {isOffline && <div className="notice mx-offline">{t('common.offlineData')}</div>}

          <MarketHeroBanner
            global={global}
            breadth={breadth}
            coins={universe}
            trend={trend}
            vs={vs}
            onSelectTab={changeTab}
            onOpenCoin={openCoin}
          />

          {/* ─── THE TWO TABS, AND WHAT EACH ONE HOLDS ──────────────────────
              «در صفحه بازار دو تب کن — تب اول مرور: باکس ارزش کل، باکس
              بیت‌کوین، همراه با پول هوشمند بنر و باکس استوری‌ها. تب دوم بنام
              توکن: باکس داغ‌ترین‌ها، باکس جستجو و توکن‌ها.»

              TWO PANELS, ONE FEED. Neither panel fetches anything of its own:
              the deck, Bitcoin, the hot rail and every row all read the same
              poll this screen has always run, so opening a tab costs no
              request and a number can never disagree between the two.

              THE CLOSED TAB IS NOT MOUNTED. Not «hidden with CSS» — absent.
              The stories reel and the Smart Money blade are a dozen hand-drawn
              SVG scenes between them, and the list is sixty rows each with a
              sparkline. Rendering both panels and hiding one would pay the
              whole price of the screen twice for a control that only ever
              shows half of it, on the one page that was measured to be slow.

              THE READER'S WORK SURVIVES THE SWITCH. Search text, sort, the
              starred-only view, the chosen sector and the collapsed list all
              live in THIS component's state, above the panels, so a trip to
              «مرور» and back returns to the same list in the same order with
              the same words in the box.

              The order inside each panel is the order those boxes already had
              of each other («باکس استوری‌ها … بین داغ‌ترین‌ها و بنر تبلیغاتی
              قرار بگیرد» still holds inside «مرور»): readings, then the two
              surfaces that lead somewhere else, the blade last because it is
              the one that asks for a tap rather than offering a reading. */}
          <MarketTabStrip
            active={tab}
            onChange={changeTab}
            overviewId="market-panel-overview"
            tokensId="market-panel-tokens"
          />

          <div
            className="mx-tab-panel"
            id="market-panel-overview"
            role="tabpanel"
            aria-labelledby="market-tab-overview"
            /* `hidden` wins over the panel's own `display: flex` — the rule is
               in market-tabs.css §3, with the reason. */
            hidden={tab !== 'overview'}
            data-testid="market-panel-overview-box"
          >
            {/* The BODY only exists while its tab is open. The panel element
                itself stays (the strip's `aria-controls` must always resolve,
                and `hidden` is what keeps it out of the accessibility tree),
                but a closed tab carries no stories reel, no banner and no
                readings — see the note on the strip above. */}
            {tab === 'overview' && (
              <>
              <MarketOverview
                global={global}
                bitcoin={bitcoin}
                trend={trend}
                liveAvgChange={liveAvgChange}
                loading={loading}
                vs={vs}
                onOpenCoin={openCoin}
              />

              <div className="mx-stories">
                <MarketStories coins={coins} global={global} />
              </div>

              <SmartMoneyBanner />
              </>
            )}
          </div>

          <div
            className="mx-tab-panel"
            id="market-panel-tokens"
            role="tabpanel"
            aria-labelledby="market-tab-tokens"
            hidden={tab !== 'tokens'}
            data-testid="market-panel-tokens-box"
          >
            {tab === 'tokens' && (
              <>
            {/* «داغ‌ترین‌ها» leads THIS tab: it is the discovery surface, and
                the list below it is the answer to «what else is there». Its
                own render is cheap (eight cards) so it is always painted. */}
            <HotCoins coins={hotCoins} onOpen={openCoin} vs={vs} />

            {/* Feed tools and list controls are separate glass surfaces. */}
            <section className="mx-lens" id="market-lens" data-testid="market-lens" aria-labelledby="market-lens-title">
              <div className="mx-terminal-head mx-lens-head">
                <h2 className="market-terminal-title mx-terminal-title" id="market-lens-title">
                  <span>{t('marketIntel.railLabel')}</span>
                </h2>
                <div className="mx-terminal-actions">
                  <MarketFreshness updatedAt={sector ? (categoryStale ? 0 : category.updatedAt) : updatedAt} />
                  <button
                    type="button"
                    className="market-refresh mx-icon-btn"
                    onClick={() => { refreshMarkets?.(); if (sector) category.refresh(); }}
                    disabled={loading || category.refreshing}
                    data-busy={loading || category.refreshing ? 'true' : undefined}
                    aria-label={t('market.refresh')}
                    title={t('market.refresh')}
                    data-testid="market-refresh"
                  >
                    <IconRefresh width={15} height={15} aria-hidden="true" />
                  </button>
                  <button type="button" className="market-compare mx-compare" onClick={() => navigate('/compare')} aria-label={t('market.compare')}>
                    <IconChart width={14} height={14} aria-hidden="true" />
                    <span>{t('market.compare')}</span>
                  </button>
                </div>
              </div>

              {breadth.counted > 0 && (
                <div
                  className="market-breadth mx-breadth"
                  data-testid="market-breadth"
                  data-tone={breadth.avgChange >= 0 ? 'up' : 'down'}
                >
                  <div className="mx-breadth-head">
                    <span className="mx-breadth-title">
                      <span className="mx-breadth-mark" aria-hidden="true">
                        <GlyphPulse width={13} height={13} />
                      </span>
                      {t('market.breadthTitle')}
                    </span>
                    <span className="mx-breadth-avg mono" data-tone={breadth.avgChange >= 0 ? 'up' : 'down'}>
                      <IconActivity width={11} height={11} aria-hidden="true" />
                      {t('market.breadthAvg', { pct: fmtPct(breadth.avgChange, 2) })}
                    </span>
                  </div>
                  {/* Atmospheric light only: the measured breadth remains in the bar below. */}
                  <div className="mx-breadth-aurora" aria-hidden="true">
                    <svg viewBox="0 0 600 74" preserveAspectRatio="none">
                      <path className="mx-aurora-haze" d="M0 55 C75 70 95 15 165 34 S255 68 310 30 S390 10 450 35 S535 49 600 12" />
                      <path className="mx-aurora-line" d="M0 55 C75 70 95 15 165 34 S255 68 310 30 S390 10 450 35 S535 49 600 12" />
                      <path className="mx-aurora-echo" d="M0 61 C75 70 105 29 165 42 S255 71 310 40 S395 19 450 43 S535 56 600 23" />
                    </svg>
                  </div>
                  <div className="mx-breadth-bar" aria-hidden="true">
                    <span className="is-up" style={{ width: `${breadth.upShare * 100}%` }} />
                    <span className="is-flat" style={{ width: `${breadth.flatShare * 100}%` }} />
                    <span className="is-down" style={{ width: `${breadth.downShare * 100}%` }} />
                  </div>
                  <div className="mx-breadth-legend">
                    <span className="mx-breadth-item" data-tone="up" data-testid="market-breadth-up">
                      <i aria-hidden="true" />{t('market.breadthUp', { count: fmtNum(breadth.up) })}
                    </span>
                    <span className="mx-breadth-item" data-tone="down" data-testid="market-breadth-down">
                      <i aria-hidden="true" />{t('market.breadthDown', { count: fmtNum(breadth.down) })}
                    </span>
                    {breadth.flat > 0 && (
                      <span className="mx-breadth-item" data-tone="flat">
                        <i aria-hidden="true" />{t('market.breadthFlat', { count: fmtNum(breadth.flat) })}
                      </span>
                    )}
                    {breadth.unknown > 0 && (
                      <span className="mx-breadth-item" data-tone="unknown">
                        <i aria-hidden="true" />{t('market.breadthUnknown', { count: fmtNum(breadth.unknown) })}
                      </span>
                    )}
                  </div>
                  <p className="market-breadth-note mx-breadth-note">{t('market.breadthNote', { count: fmtNum(breadth.counted) })}</p>
                </div>
              )}

            </section>

            <section className="market-terminal mx-terminal" aria-labelledby="market-list-title">
              <div className="mx-list-hero">
                <div className="mx-list-hero-head">
                  <h2 className="mx-list-title" id="market-list-title">
                    <span className="market-terminal-title-text">{sector ? t(`market.sector.${sector}`) : t('marketIntel.allCoinsTitle')}</span>
                    <span className="market-count mono" aria-live="polite" data-testid="market-count">{fmtNum(list.length)}</span>
                  </h2>
                </div>

                {/* «زیر همه ارزها باید فیلد جستجو بیاد بالای فیلتر ها» — the field
                    that narrows THIS list lives inside this card, directly under
                    its head and directly above the chips that re-order it. */}
                <MarketSearch
                  query={query}
                  onQueryChange={(value) => { setQuery(value); setSmartIntent(null); }}
                  onApplyIntent={applySmartSearch}
                  onNavigate={navigate}
                  universe={universe}
                  remoteHits={remoteHits}
                  searching={searching}
                  searchError={searchError}
                  smartIntent={smartIntent}
                  vs={vs}
                />

                <div className="mx-controls">
                <div className="market-views mx-views" role="group" aria-label={t('market.viewsAria')}>
                  {FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className="market-view mx-view"
                      data-view={f}
                      data-active={activeView === f ? 'true' : undefined}
                      aria-pressed={activeView === f}
                      onClick={() => applyView(f)}
                    >
                      <FilterGlyph view={f} />
                      {t(`market.filter.${f}`)}
                    </button>
                  ))}
                </div>

                <div className="market-sort-wrap mx-sort-wrap" ref={sortWrapRef}>
                  <button
                    type="button"
                    className="market-sort-trigger mx-sort-trigger"
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
                    <span>{t(`market.sort.${sortKey}`)}</span>
                    <GlyphCaretDown className="mx-sort-caret" width={13} height={13} />
                  </button>
                  {sortOpen && (
                    <div
                      className="market-sort-popover mx-sort-popover"
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
                      {MARKET_SORTS.map((key) => (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={sortKey === key}
                          className="market-sort-option mx-sort-option"
                          key={key}
                          onClick={() => { chooseSort(key); setSortOpen(false); }}
                        >
                          <span>{t(`market.sort.${key}`)}</span>
                          {sortKey === key && <IconCheck className="mx-sort-check" width={13} height={13} aria-hidden="true" />}
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="market-dir mx-icon-btn"
                    data-dir={sortDir}
                    onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                    aria-label={sortDir === 'desc' ? t('market.dirDesc') : t('market.dirAsc')}
                    title={sortDir === 'desc' ? t('market.dirDesc') : t('market.dirAsc')}
                    data-testid="market-sort-dir"
                  >
                    {/* A drawn arrow, not a typed one: the down/up text glyphs arrive as artwork
                        whose weight and baseline differ per platform. */}
                    {sortDir === 'desc'
                      ? <GlyphSortDesc width={14} height={14} />
                      : <GlyphSortAsc width={14} height={14} />}
                  </button>
                </div>
                </div>
                </div>

            </section>

            <MarketSectorRail
              sectors={SECTORS}
              selected={sector}
              onSelect={setSector}
            />

              <section className="mx-table-wrap" aria-labelledby="market-list-title">

              {sector && (
                <div className="mx-category-note" data-testid="market-category-source" role="status">
                  <span>{t(isBinanceRiskSector(sector) ? 'market.categoryRiskSource' : 'market.categorySource')}</span>
                  {categoryFallback && <span>{t('market.categoryPartial')}</span>}
                  {categoryStale && <span>{t('market.categoryStale')}</span>}
                  {category.limitReached && <span>{t('market.categoryLimit')}</span>}
                  {(category.error && universe.length > 0) && <span>{t('market.categoryError')} <button type="button" onClick={category.refresh}>{t('market.retry')}</button></span>}
                  {category.pageError && <span>{t('market.categoryPageError')} <button type="button" onClick={category.loadMore}>{t('market.retry')}</button></span>}
                </div>
              )}

              {smartIntent && (
                <div className="mx-intent-result" role="status" aria-live="polite">
                  <IconSparkle width={13} height={13} aria-hidden="true" />
                  <span>{t(`market.aiApplied.${smartIntent.key}`)}</span>
                  <button type="button" onClick={() => { setSmartIntent(null); setQuery(''); }}>{t('market.clearSearch')}</button>
                </div>
              )}

              {(sector ? category.loading : loading) && !list.length ? (
                <div className="stack market-coin-grid mx-table" aria-busy="true">
                  {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skel market-skel-row mx-skel-row" />)}
                </div>
              ) : !sector && marketError && !list.length ? (
                <div className="market-empty mx-empty" data-kind="error" data-testid="market-feed-error">
                  <span className="market-empty-icon" aria-hidden="true"><IconRefresh width={20} height={20} /></span>
                  <div className="market-empty-title">{t('market.feedDown')}</div>
                  <p className="market-empty-help">{t('market.feedDownHelp')}</p>
                  <button type="button" className="market-empty-action mx-empty-action" onClick={() => refreshMarkets?.()} data-testid="market-retry">
                    <IconRefresh width={14} height={14} aria-hidden="true" />
                    {t('market.retry')}
                  </button>
                </div>
              ) : (
                <>
                  {emptyKind !== 'none' && !list.length && !extraHits.length && (
                    <div className="market-empty mx-empty" data-kind={emptyKind}>
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
                              : emptyKind === 'sectorError'
                                ? t('market.categoryError')
                                : emptyKind === 'sector'
                                  ? t('market.categoryEmpty')
                                : t('market.noResults')}
                      </div>
                      {emptyKind === 'favorites' && <p className="market-empty-help">{t('market.emptyFavoritesHelp')}</p>}
                      {emptyKind === 'sectorError' && (
                        <button type="button" className="market-empty-action mx-empty-action" onClick={category.refresh} data-testid="market-category-retry">
                          <IconRefresh width={14} height={14} aria-hidden="true" />{t('market.retry')}
                        </button>
                      )}
                      {(emptyKind === 'favorites' || emptyKind === 'search' || emptyKind === 'sector') && (
                        <button
                          type="button"
                          className="market-empty-action mx-empty-action"
                          onClick={() => { setQuery(''); setSector(null); setOnlyFavorites(false); setSortKey('rank'); setSortDir('asc'); }}
                        >
                          {t('market.showAll')}
                        </button>
                      )}
                    </div>
                  )}

                  <div className="stack market-coin-grid mx-table" id="market-list-rows">
                    {visibleList.map((c, i) => {
                      const swapUrl = swapRouteFor(c);
                      return (
                        <div key={c.id} className="market-coin-row mx-coin-row">
                          <CoinRow
                            coin={c}
                            rank={c.rank || i + 1}
                            metric={rowMetric(c)}
                            animate={false}
                            /*
                             * «لوگو ها دیر بالا میاد» — the first rows are the ones a
                             * reader meets before the list has finished arriving, so
                             * their artwork is asked for at high priority. Row 9
                             * onward stays lazy/low: 60 eager requests to one CDN host
                             * is the queue that caused the complaint in the first
                             * place (see lib/coinImage.js for the size half of it).
                             */
                            logoPriority={i < 8}
                            /*
                             * «ایکون بعضی باکس‌ها دیر بالا میاد» and the scroll
                             * stutter are the same accounting error: sixty SVG
                             * sparklines painted in one commit, fifty of them
                             * below the fold. The first screenful draws at once
                             * (a reader must never see it arrive); the rest draw
                             * as the list is scrolled, one screen ahead — see
                             * hooks/useRowWindow.js. Every number on every row is
                             * rendered either way.
                             */
                            deferSpark={i >= 8}
                            onClick={() => openCoin(c.id)}
                          />
                          <span className="mx-swap-slot" data-available={swapUrl ? 'true' : undefined}>
                          {swapUrl && (
                            <button
                              type="button"
                              className="market-swap-btn mx-swap-btn"
                              onClick={(e) => { e.stopPropagation(); navigate(swapUrl); }}
                              aria-label={t('market.swapOnCorrectNetwork', { symbol: c.symbol })}
                              title={t('market.swapOnCorrectNetwork', { symbol: c.symbol })}
                              data-testid={`market-swap-${c.id}`}
                            >
                              <IconSwap width={12} height={12} aria-hidden="true" />
                              <span className="mx-swap-label">{t('market.swap')}</span>
                            </button>
                          )}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {(hasMore || list.length > FOLDED_ROWS) && (
                    <div className="market-more mx-more">
                      <div className="market-more-meta">
                        <span className="mono" data-testid="market-showing">
                          {t('market.showing', { shown: fmtNum(shownCount), total: fmtNum(list.length || shownCount) })}
                        </span>
                        <span className="market-more-track" aria-hidden="true">
                          <span className="market-more-fill" style={{ width: `${list.length ? Math.min(100, (shownCount / list.length) * 100) : 0}%` }} />
                        </span>
                      </div>
                      <div className="mx-list-actions">
                      {hasMore && !listFolded && <button
                        type="button"
                        className="market-show-more mx-show-more"
                        disabled={pageLoading || category.loadingMore || category.refreshing}
                        onClick={async () => {
                          if (list.length > visibleCount) setVisibleCount((n) => n + 60);
                          else if (sector) {
                            if (await category.loadMore()) setVisibleCount((n) => n + 60);
                          } else loadNextPage();
                        }}
                      >
                        {pageLoading || category.loadingMore
                          ? t('market.loadingSector')
                          : list.length > visibleCount
                            ? t('market.showMore', { count: fmtNum(list.length - visibleCount) })
                            : t('market.nextPage')}
                      </button>}
                      {list.length > FOLDED_ROWS && <button
                        type="button"
                        className="mx-list-fold"
                        data-testid="market-list-fold"
                        data-folded={listFolded ? 'true' : 'false'}
                        aria-expanded={!listFolded}
                        aria-controls="market-list-rows"
                        onClick={() => setListFolded((folded) => !folded)}
                      >
                        <GlyphCaretDown width={13} height={13} aria-hidden="true" />
                        <span>{t(listFolded ? 'marketIntel.listExpand' : 'marketIntel.listCollapse')}</span>
                      </button>}
                      </div>
                    </div>
                  )}

                  {extraHits.length > 0 && (
                    <section className="market-more-results mx-more-results">
                      <p className="section-label">{t('market.moreResults')}</p>
                      <div className="stack market-coin-grid mx-table">
                        {extraHits.map((c) => {
                          const swapUrl = swapRouteFor(c);
                          return (
                            <div key={c.id} className="market-coin-row mx-coin-row">
                              <CoinRow coin={c} rank={c.rank || '—'} animate={false} onClick={() => openCoin(c.id)} />
                              <span className="mx-swap-slot" data-available={swapUrl ? 'true' : undefined}>
                              {swapUrl && (
                                <button type="button" className="market-swap-btn mx-swap-btn" aria-label={t('market.swapOnCorrectNetwork', { symbol: c.symbol })} onClick={(e) => { e.stopPropagation(); navigate(swapUrl); }}>
                                  <IconSwap width={12} height={12} aria-hidden="true" />
                                  <span className="mx-swap-label">{t('market.swap')}</span>
                                </button>
                              )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </>
              )}
              </section>
              </>
            )}
          </div>
        </PageTransition>
      </div>
    </>
  );
}
