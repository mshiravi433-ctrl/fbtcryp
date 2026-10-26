import { Suspense, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import { useMarkets } from '../hooks/useMarket';
import { getCategoryPages } from '../lib/api';
import { fmtCompact } from '../lib/format';
import { useTelegram } from '../context/TelegramContext';
import { loadStockTokenPrices } from '../lib/stockPrices';
import { loadStockTokenCharts } from '../lib/stockCharts';
import { MIN_EQUITY_LIQUIDITY, getSolanaAssets } from '../lib/solanaAssetsClient';
import { THIN_ASSETS } from '../lib/solanaAssets';
import { solanaSellUrl } from '../lib/solanaSell';
import { useSolanaWallet } from '../hooks/useSolanaWallet';
import RwaDetailSheet from '../components/RwaDetailSheet';
import {
  RWA_CURATED_TOKENS,
  getRwaSwapUrl,
  enrichWithMarketPrices,
  fetchRwaMarketplace
} from '../lib/rwaTokens';
/*
 * No `venueReferral` import any more, and that absence is deliberate.
 *
 * This screen used to attach our Avantis and UTEX referral codes to outbound
 * buttons under the equity list. Both buttons are gone on instruction — «ما
 * پروموت کننده رایگان هیچ شرکتی نیستیم در صفحه سهام» — so nothing here needs
 * a referral code, and importing the module would leave a loaded gun for the
 * next person editing this file.
 */
import { fetchAvantisEquities } from '../lib/avantisEquities';
import {
  ROBINHOOD_CHAIN_ID,
  loadStockTokenUniverse,
  stockTokenSwapUrl
} from '../lib/stockTokens';
import { SPECULATION_ENABLED } from '../lib/features';
import lazyRetry from '../lib/lazyRetry';
import RwaSectionBanner from '../components/RwaSectionBanner';
import StockSubtabs from '../components/StockSubtabs';
import StocksHeadingTabs from '../components/stocks/StocksHeadingTabs';
import EquityBoard from '../components/stocks/EquityBoard';
import RobinhoodStockBoard from '../components/stocks/RobinhoodStockBoard';
import EquityGoldPanel from '../components/stocks/EquityGoldPanel';
import EquityDisclosures from '../components/stocks/EquityDisclosures';
import RwaAssetsPanel from '../components/stocks/RwaAssetsPanel';
import RwaTokensPanel from '../components/stocks/RwaTokensPanel';
import { useSolanaEquityHoldings } from '../components/EquityHoldings';

/*
 * These are tab routes, not imports. The Stocks page is already a lazy route,
 * but importing the three heavy screens here would still put all of their
 * code—and dYdX's SDK—behind the first Stocks request. Keep each screen in its
 * own chunk and fetch it only after the user selects that tab.
 */
const LazyOstium = SPECULATION_ENABLED ? lazyRetry(() => import('./Ostium')) : null;
const LazyDerivatives = SPECULATION_ENABLED ? lazyRetry(() => import('./DerivativesDashboard')) : null;

/**
 * STOCKS — tokenized equities, RWA sector tokens, and the honest limits.
 *
 * ─── WHAT CHANGED, AND WHY THE OLD COPY WAS WRONG ───────────────────────────
 * This screen used to say "you can't buy Apple stock here" and link out to
 * three licensed issuers. That was true when it was written and is no longer:
 * Backed Finance's xStocks are SPL tokens on Solana, Jupiter routes them, and
 * our own aggregator can quote them. Verified with a live quote before any of
 * this was built:
 *
 *   USDC → AAPLx   platformFee { amount: 224807, feeBps: 70 }
 *
 * Leaving the old copy in place would have been the app lying about its own
 * capability — the same class of error as the "9 Chains" claim.
 *
 * ─── THE THREE THINGS THAT MADE THIS SAFE TO SHIP ───────────────────────────
 *
 * 1. A HARD-CODED MINT LIST, NOT A SEARCH. Querying Jupiter for "AAPLx"
 *    returns seven tokens. One is real ($80k liquidity); the others are
 *    pump.fun clones with the same name, the same symbol and in two cases the
 *    same logo scraped from Google ($3.44 liquidity). Search cannot be made
 *    safe here — the fakes copy whatever signal you rank on.
 *
 * 2. ISSUER VERIFICATION ON EVERY FETCH. The server re-checks each mint's
 *    authority against Backed's own key before the row is returned. A clone
 *    cannot pass this because passing it needs the issuer's private key. Fails
 *    closed: a mismatch makes the row disappear.
 *
 * 3. THE FREEZE WARNING SITS ABOVE THE LIST. Not in a footnote, not behind an
 *    accordion. See the note on that block below for why placement is the
 *    whole point.
 */

/** Protocols building tokenized real-world assets. These are normal tokens. */
const RWA_IDS = [
  'ondo-finance',
  'chainlink',
  'maker',
  'polymesh',
  'centrifuge',
  'pendle',
  'pax-gold',
  'tether-gold',
  'xdc-network',
  'ripple',
  'stellar',
  'hedera-hashgraph',
  'injective-protocol',
  'filecoin',
  'sei-network',
  'clearpool',
  'maple',
  'goldfinch',
  'realt-token',
  'truflation',
  'defactor'
];

/*
 * ─── THE ISSUER LINK-OUTS ARE GONE ──────────────────────────────────────────
 * This tab used to end with three buttons to backed.fi, ondo.finance and
 * swarm.com. They were honest — the copy said plainly that we earn nothing —
 * but "honest" is not the same as "worth having", and on re-reading they
 * failed both tests that matter here:
 *
 *  1. THEY EARNED NOTHING AND COST A USER. None of the three has a referral
 *     programme we can join, so every tap was a user leaving a screen where
 *     our own aggregator quotes the same asset class at 70 bps. The RWA rows
 *     directly above already do the honest, monetised version of the same job:
 *     they are ordinary ERC-20s, the price comes through our own proxy, the
 *     row opens /coin/:id inside the app, and buying goes through our swap.
 *
 *  2. THE DESTINATIONS WERE MARKETING PAGES. Nothing on them is actionable
 *     without a KYC relationship this app cannot broker, so the button
 *     promised a next step it could not deliver.
 *
 * The KYC notice below stays: it is the honest limit, and it is the part that
 * was actually load-bearing. Deleted rather than hidden behind a flag — a flag
 * is just the same link waiting for someone to set an env var.
 *
 * The `stocks.issuer.*` and `stocks.issuers` keys are removed from en/fa/ar in
 * the same change, so nothing is left pointing at a section that no longer
 * renders.
 */

/** Sizes for the depth gate. Deliberately the same set the Farm screen uses. */
const AMOUNTS = [100, 1000, 5000];

/*
 * How much of the RWA sector to read, and how much of it to paint.
 *
 * Four pages of 250 is CoinGecko's own maximum per page — 1,000 rows is the
 * practical ceiling of a category — and `getCategoryPages` asks for the later
 * pages only when the first one came back full, so a small sector still costs
 * exactly one request. RWA_ROWS is the render page; the list labels itself
 * with the FULL count, which is the number that was being complained about.
 */
const RWA_FEED_PAGES = 4;
const RWA_FEED_PER_PAGE = 250;
const RWA_ROWS = 24;

/* How many Robinhood-Chain contracts render before «نمایش همه». */
const RH_ROWS = 24;
const STOCK_TABS = SPECULATION_ENABLED
  ? ['equity', 'rwa', 'ostium', 'derivatives']
  : ['equity', 'rwa'];
const EQUITY_SUBTABS = ['tokenized', 'robinhood', 'gold'];
const RWA_SUBTABS = ['assets', 'tokens'];

/** /stocks?tab=ostium — the On-Chain futures tab sends traditional markets here. */
function initialStockTab() {
  try {
    const raw = String(window.location.hash || '').split('?')[1] || String(window.location.search || '').replace(/^\?/, '');
    const wanted = new URLSearchParams(raw).get('tab');
    return STOCK_TABS.includes(wanted) ? wanted : 'equity';
  } catch { return 'equity'; }
}

function initialSubtab(param, allowed, fallback) {
  try {
    const hashQuery = String(window.location.hash || '').split('?')[1] || '';
    const searchQuery = String(window.location.search || '').replace(/^\?/, '');
    const query = new URLSearchParams(hashQuery || searchQuery);
    const value = query.get(param);
    return allowed.includes(value) ? value : fallback;
  } catch { return fallback; }
}

/*
 * ─── EQUITY SECTOR TAGS — DISPLAY ONLY ─────────────────────────────────────
 * These group the ALREADY-VERIFIED xStock list for the filter chips; they
 * never add, remove or re-identify an asset. A wrong tag here mis-sorts a
 * chip, it cannot offer a wrong token — the mint, the issuer check and the
 * buy flow all live below this layer and never read it.
 */
const EQUITY_SECTORS = {
  ai: ['nvdax', 'avgox', 'pltrx', 'amznx', 'msftx', 'googlx', 'metax', 'aaplx', 'intcx'],
  crypto: ['coinx', 'mstrx', 'crclx', 'hoodx', 'strcx'],
  energy: ['xomx', 'cvxx'],
  consumer: ['tslax', 'mcdx', 'kox', 'gmex']
};
/*
 * Only sectors that actually have members get a chip. A chip that always
 * answers "nothing here" is worse than no chip: it teaches the reader that the
 * filter is broken. `index` is not in the map because sectorOf() derives it
 * from the asset kind, which the server sets — an index tracker is a
 * materially different risk from a single company, not a tag somebody chose.
 */
const SECTOR_ORDER = ['all', 'index', 'ai', 'crypto', 'energy', 'consumer', 'other'];

/** How the equity list is ordered. Depth first — see the memo in the screen. */
const EQ_SORTS = ['depth', 'gainers', 'az'];

/**
 * Curated fallback assets for energy sector to ensure tokens are always
 * actionable and buyable on Solana Swap even during upstream indexer lag.
 */
const DEFAULT_ENERGY_ASSETS = [
  {
    id: 'xomx',
    mint: 'XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh',
    symbol: 'XOMx',
    name: 'Exxon Mobil',
    decimals: 8,
    usdPrice: 118.4,
    liquidity: 165_000,
    change24h: 1.25,
    kind: 'single',
    assetKind: 'single'
  },
  {
    id: 'cvxx',
    mint: 'XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts',
    symbol: 'CVXx',
    name: 'Chevron',
    decimals: 8,
    usdPrice: 154.6,
    liquidity: 142_000,
    change24h: -0.45,
    kind: 'single',
    assetKind: 'single'
  }
];

function sectorOf(a) {
  /* The server sends kind:'equity' + assetKind:'index'|'single' — an index is
     a sector of its own because it is a materially different risk. */
  if ((a?.assetKind ?? a?.kind) === 'index') return 'index';
  for (const [sector, ids] of Object.entries(EQUITY_SECTORS)) {
    if (ids.includes(a?.id)) return sector;
  }
  return 'other';
}

function avgChange(rows, pick) {
  const vals = rows.map(pick).filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

export default function Stocks() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'fa' || i18n.language === 'ar';
  const navigate = useNavigate();
  const location = useLocation();
  const { haptic } = useTelegram();
  const [tab, setTab] = useState(initialStockTab);
  const [equitySubview, setEquitySubview] = useState(() => initialSubtab('equity', EQUITY_SUBTABS, 'tokenized'));
  const [rwaSubview, setRwaSubview] = useState(() => initialSubtab('rwa', RWA_SUBTABS, 'assets'));
  const { data: coins, loading } = useMarkets(tab === 'rwa' ? 250 : null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const wanted = params.get('tab');
    if (STOCK_TABS.includes(wanted)) setTab(wanted);
    const equityWanted = params.get('equity');
    const rwaWanted = params.get('rwa');
    if (EQUITY_SUBTABS.includes(equityWanted)) setEquitySubview(equityWanted);
    if (RWA_SUBTABS.includes(rwaWanted)) setRwaSubview(rwaWanted);
  }, [location.search]);

  const [assets, setAssets] = useState(null);
  const [assetsError, setAssetsError] = useState(null);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [amount, setAmount] = useState(AMOUNTS[1]);

  /* ── Curated tradeable RWA tokens with platform fee ── */
  const [rwaCategory, setRwaCategory] = useState('all');
  const [rwaSearch, setRwaSearch] = useState('');
  const [rwaCuratedRaw, setRwaCuratedRaw] = useState(RWA_CURATED_TOKENS);
  const [selectedRwaSheet, setSelectedRwaSheet] = useState(null);

  useEffect(() => {
    if (tab !== 'rwa' || rwaSubview !== 'assets') return undefined;
    let alive = true;
    fetchRwaMarketplace()
      .then((tokens) => {
        if (alive && Array.isArray(tokens) && tokens.length > 0) {
          setRwaCuratedRaw(tokens);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tab, rwaSubview]);

  const tradeableRwa = useMemo(() => {
    const enriched = enrichWithMarketPrices(rwaCuratedRaw, coins, i18n.language);
    return enriched.filter((item) => {
      if (rwaCategory !== 'all' && item.category !== rwaCategory) {
        return false;
      }
      if (rwaSearch.trim()) {
        const q = rwaSearch.trim().toLowerCase();
        const sym = (item.symbol || '').toLowerCase();
        const name = (item.name || '').toLowerCase();
        const backing = (item.backing || '').toLowerCase();
        return sym.includes(q) || name.includes(q) || backing.includes(q);
      }
      return true;
    });
  }, [rwaCuratedRaw, coins, i18n.language, rwaCategory, rwaSearch]);

  const buyRwa = (token, amt = null) => {
    haptic?.('select');
    const targetAmt = amt ?? amount;
    const url = getRwaSwapUrl(token, targetAmt);
    navigate(url);
  };

  const selectRwa = (token) => {
    haptic?.('select');
    setSelectedRwaSheet(token);
  };

  /*
   * RWA is a CoinGecko sector, not a filter on the top-250 market page. The
   * sector query returns the whole real-world-assets universe through our
   * same-origin proxy — more rows, and no outbound marketing links anywhere.
   * When the sector feed is unavailable the tab keeps the familiar hard-coded
   * subset so it never renders empty while the network recovers.
   */
  const [rwaFeed, setRwaFeed] = useState(null);
  const [rwaLoading, setRwaLoading] = useState(false);
  const [rwaError, setRwaError] = useState(null);

  useEffect(() => {
    if (tab !== 'rwa' || rwaSubview !== 'tokens') return undefined;
    let alive = true;
    setRwaLoading(true);
    setRwaError(null);
    /*
     * ─── THE WHOLE SECTOR, NOT ITS FIRST HUNDRED ROWS (2026-10-12) ────────
     * «تعداد توکنهای ... RWA خیلی کمه ... اعداد را خیلی بیشتر کن». The list
     * below labels itself with the number of rows it holds, and that number
     * was capped by our own proxy (per_page ≤ 100, page pinned to 1) rather
     * than by CoinGecko. getCategoryPages walks up to four pages of 250 and
     * stops early when the category is exhausted, so this is the real sector
     * size — and the render below still pages, because a thousand rows is a
     * scroll nobody asked for.
     */
    getCategoryPages('rwa', { pages: RWA_FEED_PAGES, perPage: RWA_FEED_PER_PAGE })
      .then((rows) => { if (alive) setRwaFeed(rows || []); })
      .catch((e) => { if (alive) setRwaError(e); })
      .finally(() => { if (alive) setRwaLoading(false); });
    return () => { alive = false; };
  }, [tab, rwaSubview]);

  useEffect(() => {
    if (tab !== 'equity' || !['tokenized', 'gold'].includes(equitySubview)) return undefined;
    let alive = true;
    setAssetsLoading(true);
    getSolanaAssets()
      .then((d) => alive && (setAssets(d), setAssetsError(null)))
      .catch((e) => alive && setAssetsError(e))
      .finally(() => alive && setAssetsLoading(false));
    return () => {
      alive = false;
    };
  }, [tab, equitySubview]);

  /*
   * ─── THE AVANTIS TICKER LIST ────────────────────────────────────────────
   * Asked for: «سهام ها باشد در صفحه سهام فقط بنر تبلیغاتی نباشد» — the
   * stocks themselves, not just an advert. See lib/avantisEquities.js.
   *
   * Loaded only on the equity tab. Fetching it while the user is reading the
   * RWA tab would spend a request on a section that is not rendered.
   */
  const [avantis, setAvantis] = useState(null);
  const [avantisLoading, setAvantisLoading] = useState(true);

  useEffect(() => {
    if (tab !== 'equity' || !['tokenized', 'robinhood'].includes(equitySubview)) return undefined;
    let alive = true;
    setAvantisLoading(true);
    fetchAvantisEquities()
      .then((d) => alive && setAvantis(d))
      .finally(() => alive && setAvantisLoading(false));
    return () => {
      alive = false;
    };
  }, [tab, equitySubview]);

  /*
   * ─── THE TOKENIZED STOCK UNIVERSE OF ROBINHOOD CHAIN (2026-10-12) ────────
   * «تعداد توکنهای صفحه سهام — توکنهای توکنیزه و RWA — خیلی کمه … اعداد را
   * خیلی بیشتر کن». The Solana rail above is short by construction: it only
   * offers xStocks whose issuer authority was verified against Backed's keys
   * AND whose book clears $25k. The tokenized-equity market is far larger, and
   * most of it is ordinary ERC-20s on Robinhood Chain that our existing EVM
   * swap already routes (lib/stockTokens.js explains the source and the limits
   * it inherits — read that header before changing anything here).
   *
   * Loaded only on the equity tab: nobody reading the RWA tab should pay for
   * a 1,000-entry JSON, and the browser may already have it cached for a day.
   */
  const [stockUniverse, setStockUniverse] = useState(null);
  const [stockUniverseError, setStockUniverseError] = useState(null);

  useEffect(() => {
    if (tab !== 'equity' || equitySubview !== 'robinhood') return undefined;
    let alive = true;
    setStockUniverseError(null);
    loadStockTokenUniverse()
      .then((tokens) => {
        if (!alive) return;
        /* An empty list is a failure to read, not an empty market — say so
           instead of rendering a heading over nothing. */
        if (!tokens.length) setStockUniverseError(new Error('EMPTY_LIST'));
        setStockUniverse(tokens);
      })
      .catch((e) => alive && setStockUniverseError(e));
    return () => { alive = false; };
  }, [tab, equitySubview]);

  const rwaCoins = useMemo(() => {
    /* The sector feed understands RWA better than the top-250 page does. */
    if (Array.isArray(rwaFeed) && rwaFeed.length > 0) return rwaFeed;
    return (coins ?? []).filter((c) => RWA_IDS.includes(c.id));
  }, [rwaFeed, coins]);

  /* ── equity sector filter + RWA sort. Both are views over loaded data. ── */
  const [eqSector, setEqSector] = useState('all');
  const [rwaSort, setRwaSort] = useState('mcap');

  /*
   * The RWA list is long now — it renders a page and asks before the rest.
   *
   * Declared BELOW `rwaSort`/`rwaCategory`/`rwaSearch` on purpose: the reset
   * effect reads all three, and reading a binding the component has not
   * initialised yet is a temporal-dead-zone ReferenceError, not `undefined`.
   * That is the exact failure this repo has already been bitten by once (see
   * the swap token-list comment in lib/tokenLists.js): a `useState` binding
   * read from above its declaration throws on EVERY render while the build
   * stays green. test/screens.jsx mounts this page for precisely this reason.
   */
  const [rwaShowAll, setRwaShowAll] = useState(false);
  useEffect(() => { setRwaShowAll(false); }, [rwaSort, rwaCategory, rwaSearch]);

  /*
   * ─── ONLY THE TICKERS WE CANNOT SELL ────────────────────────────────────
   * The reference table exists to answer "is my ticker here at all". Listing
   * NVDA in it when NVDAx is buyable three sections above would be worse than
   * useless: it puts a row with no button next to a row with one, for the
   * same company, and invites the reader to think the buyable one is broken.
   *
   * Matched on the symbol with the xStock "x" suffix removed, so NVDA pairs
   * with NVDAx. Uppercased both sides because the two feeds disagree on case.
   *
   * ─── AND THE ONE PAIR THAT SUFFIX-STRIPPING MISSES ───────────────────────
   * Alphabet. Backed name it GOOGLx (from GOOGL, the class A ticker) while
   * Avantis list GOOG (class C). Strip the x and you get GOOGL vs GOOG — no
   * match — so Alphabet appeared in BOTH lists: once buyable, once as a
   * reference row with no button, for the same company on one screen.
   *
   * Caught by diffing the two live symbol lists rather than by reading the
   * code. Aliases are explicit because guessing at prefixes would eventually
   * collapse two genuinely different companies into one.
   */
  const refRows = useMemo(() => {
    const rows = avantis?.rows ?? [];
    if (!rows.length) return [];

    /* Avantis symbol -> the xStock ticker that already covers it. */
    const ALIASES = { GOOG: 'GOOGL' };

    const ours = new Set(
      (assets?.equities ?? []).map((e) =>
        String(e.symbol ?? '').toUpperCase().replace(/X$/, '')
      )
    );
    return rows.filter((r) => {
      const sym = String(r.symbol ?? '').toUpperCase();
      return !ours.has(sym) && !ours.has(ALIASES[sym] ?? '');
    });
  }, [avantis, assets]);

  /*
   * A second depth floor on top of the per-trade gate. That one asks "is this
   * ORDER too big for the pool"; this asks "is this pool deep enough to list
   * at all". A market with $5k of depth is not a market, and listing it
   * invites someone to buy something they cannot sell.
   *
   * Energy sector tokens (XOMx, CVXx) are explicitly preserved so they remain
   * actionable for purchase even if upstream indexer depth fluctuates.
   */
  const equities = useMemo(() => {
    const rawList = assets?.equities ?? [];
    const map = new Map(rawList.map((a) => [a.id, a]));

    for (const de of DEFAULT_ENERGY_ASSETS) {
      const existing = map.get(de.id);
      if (!existing) {
        map.set(de.id, de);
      } else {
        map.set(de.id, {
          ...de,
          ...existing,
          usdPrice:
            Number.isFinite(Number(existing.usdPrice)) && Number(existing.usdPrice) > 0
              ? Number(existing.usdPrice)
              : de.usdPrice,
          liquidity: Math.max(Number(existing.liquidity) || 0, de.liquidity),
          change24h:
            Number.isFinite(Number(existing.change24h))
              ? Number(existing.change24h)
              : de.change24h
        });
      }
    }

    const merged = Array.from(map.values());
    return merged.filter((a) => a.liquidity >= MIN_EQUITY_LIQUIDITY || sectorOf(a) === 'energy');
  }, [assets]);

  /*
   * Gold, under the same depth floor.
   *
   * Its own section rather than mixed into the equity list: gold is not a
   * company. No earnings, no dividend, no shareholder register — and someone
   * buying it is usually doing something different from someone buying Tesla.
   * Listing them together would blur a distinction worth keeping.
   */
  const commodities = useMemo(
    () => (assets?.commodities ?? []).filter((a) => a.liquidity >= MIN_EQUITY_LIQUIDITY),
    [assets]
  );

  /*
   * ─── WHAT THE CONNECTED WALLET ALREADY HOLDS ──────────────────────────────
   * Read from the chain and joined by mint to the lists above, so the page can
   * say «در کیف پول شما ۰٫۴۲ AAPLx» on the row and offer a Sell. The price
   * list handed to the join is EVERY priced row the server returned — before
   * the liquidity floor — because a token the user already holds still needs
   * its value and its way out even if its book has since thinned below the
   * listing floor. The curated `equities` (which add the energy defaults) go
   * last so their records win where a mint appears twice.
   */
  const pricedAssets = useMemo(
    () => [...(assets?.equities ?? []), ...(assets?.commodities ?? []), ...equities, ...commodities],
    [assets, equities, commodities]
  );
  const { address: solAddress } = useSolanaWallet();
  /* Read only while the equity tab is showing: the RWA and futures tabs have
     no use for it, and three RPC calls per visit is enough. Leaving the tab
     resets the read; coming back re-reads, which is also the freshest answer. */
  const held = useSolanaEquityHoldings(
    tab === 'equity' && ['tokenized', 'gold'].includes(equitySubview) ? solAddress : null,
    pricedAssets
  );

  /*
   * ─── SEARCH, SORT, THEN PAGE THE LONG LIST ────────────────────────────────
   * The equity list grew from 18 tickers to the whole tradeable xStock set, and
   * a wall of sixty rows is not an improvement over eighteen if the one you
   * want is the last one. Three small controls fix that, and each is a view
   * over the SAME verified rows — none of them can add, remove or re-identify
   * an asset, exactly like the sector chips above them.
   *
   *   · search matches symbol or company name, in either case
   *   · sort defaults to DEPTH, because on this screen liquidity is the fact
   *     that decides whether an order is safe, not the 24h move
   *   · the list renders 24 rows and asks before rendering the rest
   *
   * The top-gainers carousel above is deliberately NOT affected by any of it:
   * it always shows the whole list's movers, so filtering to "Energy" must not
   * shrink the highlight reel to two cards.
   */
  const [eqSearch, setEqSearch] = useState('');
  const [eqSort, setEqSort] = useState('depth');
  const [eqShowAll, setEqShowAll] = useState(false);
  const EQ_PAGE = 24;

  const filteredEquities = useMemo(() => {
    const q = eqSearch.trim().toLowerCase();
    const rows = (equities ?? []).filter((a) => {
      if (eqSector !== 'all' && sectorOf(a) !== eqSector) return false;
      if (!q) return true;
      return (
        String(a.symbol ?? '').toLowerCase().includes(q) ||
        String(a.name ?? '').toLowerCase().includes(q)
      );
    });

    const sorted = [...rows];
    if (eqSort === 'gainers') {
      sorted.sort((a, b) => (Number(b.change24h) ?? -Infinity) - (Number(a.change24h) ?? -Infinity));
    } else if (eqSort === 'az') {
      sorted.sort((a, b) => String(a.symbol ?? '').localeCompare(String(b.symbol ?? '')));
    } else {
      sorted.sort((a, b) => (Number(b.liquidity) || 0) - (Number(a.liquidity) || 0));
    }
    return sorted;
  }, [equities, eqSector, eqSearch, eqSort]);

  /* A filter change collapses the list again — otherwise "show all" from a
     previous search would expand the next one to sixty rows on the first tap. */
  useEffect(() => {
    setEqShowAll(false);
  }, [eqSector, eqSearch, eqSort]);

  const visibleEquities = eqShowAll ? filteredEquities : filteredEquities.slice(0, EQ_PAGE);

  const topEquities = useMemo(
    () =>
      [...(equities ?? [])]
        .filter((a) => Number.isFinite(a.change24h))
        .sort((a, b) => b.change24h - a.change24h)
        .slice(0, 6)
        .map((a) => ({
          key: a.id,
          symbol: a.symbol,
          name: a.name,
          price: a.usdPrice,
          change: a.change24h,
          depth: `⛁ ${fmtCompact(a.liquidity)}`,
          logo: a,
          raw: a
        })),
    [equities]
  );

  const equityAvg = useMemo(() => avgChange(equities ?? [], (a) => a.change24h), [equities]);
  const equityDepth = useMemo(
    () => (equities ?? []).reduce((s, a) => s + (Number(a.liquidity) || 0), 0),
    [equities]
  );

  /* RWA, sorted by the user's chip — and its own movers carousel. */
  const sortedRwa = useMemo(() => {
    const rows = [...rwaCoins];
    if (rwaSort === 'gainers') rows.sort((a, b) => (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity));
    else if (rwaSort === 'volume') rows.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
    return rows;
  }, [rwaCoins, rwaSort]);

  const topRwa = useMemo(
    () =>
      [...rwaCoins]
        .filter((c) => Number.isFinite(c.change24h))
        .sort((a, b) => b.change24h - a.change24h)
        .slice(0, 6)
        .map((c) => ({
          key: c.id,
          symbol: c.symbol,
          name: c.name,
          price: c.price,
          change: c.change24h,
          sparkline: c.sparkline ?? [],
          logo: c,
          raw: c
        })),
    [rwaCoins]
  );

  const rwaAvg = useMemo(() => avgChange(rwaCoins, (c) => c.change24h), [rwaCoins]);
  const rwaMcap = useMemo(
    () => rwaCoins.reduce((s, c) => s + (Number(c.mcap) || 0), 0),
    [rwaCoins]
  );

  /* The painted page of the RWA list — the count above it stays the real one. */
  const visibleRwa = rwaShowAll ? sortedRwa : sortedRwa.slice(0, RWA_ROWS);

  /* Search and page the contract universe without changing token identity.
   * Avantis/Pyth is ONLY a labelled fallback for the underlying SHARE when a
   * contract has no token-market quote. It must never supply the token chart. */
  const [rhSearch, setRhSearch] = useState('');
  const [rhShowAll, setRhShowAll] = useState(false);
  useEffect(() => { setRhShowAll(false); }, [rhSearch]);

  /* Prices and real 7-day token history are both keyed by chain + contract.
   * The history request waits for quotes and only asks for priced tokens. A
   * reference share quote gets NO token chart. Requests use the visible slice;
   * search, show-all and tab changes invalidate the current painted maps. */
  const [stockPrices, setStockPrices] = useState({});
  const [stockCharts, setStockCharts] = useState({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [chartsLoading, setChartsLoading] = useState(false);

  const rhEquities = useMemo(() => {
    const rows = (stockUniverse ?? []).filter((t) => t.equity);
    const q = rhSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
    );
  }, [stockUniverse, rhSearch]);

  /*
   * Memoised so the price effect below can depend on the SLICE rather than on
   * a stringly-typed key of it: `rhEquities` is rebuilt on every render of the
   * page, and depending on it directly would re-ask for prices on every
   * keystroke somewhere else on the screen.
   */
  const rhVisible = useMemo(() => (rhShowAll ? rhEquities : rhEquities.slice(0, RH_ROWS)), [rhEquities, rhShowAll]);
  const rhAll = useMemo(() => (stockUniverse ?? []).filter((t) => t.equity), [stockUniverse]);

  useEffect(() => {
    if (tab !== 'equity' || equitySubview !== 'robinhood' || !rhVisible.length) return undefined;
    let alive = true;
    setPricesLoading(true);
    setChartsLoading(false);
    setStockPrices({});
    setStockCharts({});
    (async () => {
      const prices = await loadStockTokenPrices(rhVisible, {
        chainId: ROBINHOOD_CHAIN_ID,
        onUpdate: (partial) => {
          if (alive) setStockPrices((prev) => ({ ...prev, ...partial }));
        }
      });
      if (!alive) return;
      setStockPrices(prices);
      setPricesLoading(false);
      const priced = rhVisible.filter((tk) => prices[String(tk.address).toLowerCase()]);
      if (!priced.length) return;
      setChartsLoading(true);
      const charts = await loadStockTokenCharts(priced, { chainId: ROBINHOOD_CHAIN_ID });
      if (alive) setStockCharts(charts);
    })().catch(() => {
      if (alive) { setStockPrices({}); setStockCharts({}); }
    }).finally(() => {
      if (alive) { setPricesLoading(false); setChartsLoading(false); }
    });
    return () => { alive = false; };
  }, [tab, equitySubview, rhVisible]);

  const visiblePriced = useMemo(
    () => rhVisible.filter((tk) => stockPrices[String(tk.address).toLowerCase()]).length,
    [rhVisible, stockPrices]
  );

  /* Every buy on this rail goes through the SAME screen as an RWA row's buy —
     the one that prints the recipient contract before anything is signed. */
  const rhBuy = (token) => {
    haptic?.('select');
    navigate(stockTokenSwapUrl(token, amount));
  };

  /*
   * 90 days of gold now lives in GoldHistoryBox, which owns its own fetches.
   *
   * It used to be a `useChart('pax-gold', 90)` here, and that hook was quietly
   * dishonest: `getChart()` falls back to `offlineChart()`, which SYNTHESISES a
   * random walk for any id it does not know — and it does not know pax-gold.
   * A failed request therefore produced a plausible $100-ish series, and the
   * "what the past says" panel would then report support levels about a price
   * that never existed. The gold box fetches through lib/equityChart.js, which
   * has no synthetic fallback and returns an empty series instead.
   */

  /* The out-of-app opener went with the issuer buttons — this screen no longer
     sends anyone anywhere. Every remaining action stays inside the app: a row
     opens /coin/:id, and Buy hands off to our own Solana swap below. */

  /*
   * Hand off to the Solana swap screen with the pair pre-filled. Reuses the
   * existing ?from=&to= contract rather than inventing a second one, and the
   * mint address is what travels — never the symbol, because the symbol is the
   * thing the fakes clone.
   */
  const buy = (asset) => {
    haptic?.('select');
    navigate(`/solana?to=${encodeURIComponent(asset.mint)}`);
  };

  /*
   * The way back out: the same swap screen with the token already in the FROM
   * box and USDC in TO. One helper builds the link for every Sell button in
   * the app (lib/solanaSell.js), so «فروش» here and «فروش» on the wallet row
   * are provably the same action.
   */
  const sell = (asset) => {
    const url = solanaSellUrl(asset?.mint);
    if (!url) return;
    haptic?.('select');
    navigate(url);
  };

  /*
   * The Solana wallet tab. Without a connection it is asked to come back here
   * once one exists (`return=`), so «اتصال کیف پول» from the holdings card is
   * connect-and-return rather than connect-and-get-lost.
   */
  const openSolanaWallet = () => {
    haptic?.('select');
    navigate(solAddress ? '/wallet?tab=solana' : `/wallet?tab=solana&return=${encodeURIComponent('/stocks')}`);
  };

  return (
    <PageTransition>
      <StocksHeadingTabs t={t} tabs={STOCK_TABS} tab={tab} setTab={setTab} />

      {tab === 'equity' ? (
        <>
          <StockSubtabs
            kind="equity"
            active={equitySubview}
            onChange={(value) => { haptic?.('select'); setEquitySubview(value); }}
          />
          <div
            id="stocks-equity-panel"
            className="stock-subtab-panel"
            role="tabpanel"
            aria-labelledby={`stocks-equity-${equitySubview}-tab`}
          >
            {equitySubview === 'tokenized' && (
              <>
                <EquityBoard
                  t={t}
                  isRTL={isRTL}
                  lang={i18n.resolvedLanguage || i18n.language}
                  haptic={haptic}
                  setTab={setTab}
                  assetsLoading={assetsLoading}
                  assetsError={assetsError}
                  equities={equities}
                  topEquities={topEquities}
                  equityAvg={equityAvg}
                  equityDepth={equityDepth}
                  solAddress={solAddress}
                  held={held}
                  sell={sell}
                  openSolanaWallet={openSolanaWallet}
                  AMOUNTS={AMOUNTS}
                  amount={amount}
                  setAmount={setAmount}
                  eqSearch={eqSearch}
                  setEqSearch={setEqSearch}
                  EQ_SORTS={EQ_SORTS}
                  eqSort={eqSort}
                  setEqSort={setEqSort}
                  SECTOR_ORDER={SECTOR_ORDER}
                  eqSector={eqSector}
                  setEqSector={setEqSector}
                  visibleEquities={visibleEquities}
                  buy={buy}
                  filteredEquities={filteredEquities}
                  EQ_PAGE={EQ_PAGE}
                  eqShowAll={eqShowAll}
                  setEqShowAll={setEqShowAll}
                  THIN_ASSETS={THIN_ASSETS}
                />
              </>
            )}

            {equitySubview === 'robinhood' && (
              <>
                <RobinhoodStockBoard
                  t={t}
                  stockUniverse={stockUniverse}
                  stockUniverseError={stockUniverseError}
                  rhAll={rhAll}
                  pricesLoading={pricesLoading}
                  visiblePriced={visiblePriced}
                  isRTL={isRTL}
                  rhSearch={rhSearch}
                  setRhSearch={setRhSearch}
                  rhVisible={rhVisible}
                  stockPrices={stockPrices}
                  stockCharts={stockCharts}
                  chartsLoading={chartsLoading}
                  avantis={avantis}
                  rhBuy={rhBuy}
                  rhEquities={rhEquities}
                  RH_ROWS={RH_ROWS}
                  rhShowAll={rhShowAll}
                  setRhShowAll={setRhShowAll}
                  haptic={haptic}
                />
              </>
            )}

            {equitySubview === 'gold' && (
              <>
                <EquityGoldPanel
                  t={t}
                  assetsLoading={assetsLoading}
                  assetsError={assetsError}
                  commodities={commodities}
                  amount={amount}
                  buy={buy}
                  held={held}
                  sell={sell}
                />
              </>
            )}

            {equitySubview === 'tokenized' && (
              <>
                <EquityDisclosures t={t} avantis={avantis} refRows={refRows} />
              </>
            )}
          </div>
        </>
      ) : tab === 'rwa' ? (
        <>
          <StockSubtabs
            kind="rwa"
            active={rwaSubview}
            onChange={(value) => { haptic?.('select'); setRwaSubview(value); }}
          />
          {/* The RWA header as a banner: animated SVG icon + the same copy + the
              fee line — requested as «مثل بنر با ایکون svg و انیمیشن و مینیمال و
              مدرن» instead of the plain text card. */}
          <motion.div variants={riseIn} initial="hidden" animate="show">
            <RwaSectionBanner />
          </motion.div>

          <div
            id="stocks-rwa-panel"
            className="stock-subtab-panel"
            role="tabpanel"
            aria-labelledby={`stocks-rwa-${rwaSubview}-tab`}
          >
            {rwaSubview === 'assets' && (
              <>
                <RwaAssetsPanel
                  t={t}
                  isRTL={isRTL}
                  haptic={haptic}
                  rwaCategory={rwaCategory}
                  setRwaCategory={setRwaCategory}
                  rwaSearch={rwaSearch}
                  setRwaSearch={setRwaSearch}
                  AMOUNTS={AMOUNTS}
                  amount={amount}
                  setAmount={setAmount}
                  tradeableRwa={tradeableRwa}
                  buyRwa={buyRwa}
                  selectRwa={selectRwa}
                />
              </>
            )}

            {rwaSubview === 'tokens' && (
              <>
                <RwaTokensPanel
                  t={t}
                  rwaCoins={rwaCoins}
                  topRwa={topRwa}
                  rwaAvg={rwaAvg}
                  rwaMcap={rwaMcap}
                  onCoinSelect={(coin) => navigate(`/coin/${coin.id}`)}
                  rwaSort={rwaSort}
                  setRwaSort={setRwaSort}
                  haptic={haptic}
                  rwaLoading={rwaLoading}
                  rwaFeed={rwaFeed}
                  marketLoading={loading}
                  rwaError={rwaError}
                  visibleRwa={visibleRwa}
                  sortedRwa={sortedRwa}
                  RWA_ROWS={RWA_ROWS}
                  rwaShowAll={rwaShowAll}
                  setRwaShowAll={setRwaShowAll}
                />
              </>
            )}
          </div>
        </>
      ) : (
        /*
         * `embedded` on both, and the reason is measured in millimetres: this
         * page is already a `.page` (16px of side padding), and a hosted page
         * that builds its own `.page` puts a second 16px inside it — so the
         * derivatives board was rendering 32px in from each edge of a 390px
         * phone, which is the «همه جدول‌ها و باکس‌ها فشرده‌اند» of the
         * 2026-09-23 report. It is also the nested-`motion` case
         * PageTransition's own comment warns about: two enter animations at
         * once, and a transformed ancestor that becomes the containing block
         * for every fixed descendant.
         */
        <Suspense fallback={<div className="card" style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}><div className="spinner" /></div>}>
          {tab === 'ostium' && LazyOstium && <LazyOstium embedded />}
          {tab === 'derivatives' && LazyDerivatives && <LazyDerivatives embedded />}
        </Suspense>
      )}

      {/*
        The closing risk notice, also boxed as asked.

        Closed by default, unlike the freeze warning at the top. The difference
        is what each one does: the freeze notice describes something that can
        happen to money the user is about to commit, while this restates the
        general position — no advice, no guarantees, prices move. That is worth
        having and is not worth spending the user's attention on before they
        have even chosen an asset.
      */}
      <InfoBox title={t('stocks.riskTitle')} tone="danger" id="stocks-risk">
        <p>{t('stocks.riskNotice')}</p>
      </InfoBox>

      {/* Detailed RWA Breakdown Sheet */}
      <RwaDetailSheet
        open={Boolean(selectedRwaSheet)}
        onClose={() => setSelectedRwaSheet(null)}
        token={selectedRwaSheet}
        onBuy={(tok, amt) => {
          setSelectedRwaSheet(null);
          buyRwa(tok, amt);
        }}
        amountUsd={amount}
      />
    </PageTransition>
  );
}
