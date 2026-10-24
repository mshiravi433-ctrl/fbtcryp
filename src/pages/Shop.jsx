import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
/* The shop is a lazy route; keep its visual layer out of the first paint. */
import '../styles/shop-modern.css';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Sheet from '../components/Sheet';
import ShopCountrySheet from '../components/ShopCountrySheet';
import ShopTile from '../components/ShopTile';
import ShopPromo from '../components/ShopPromo';
import ShopLoyaltyCard from '../components/ShopLoyaltyCard';
import ShopWeb3IdCard from '../components/ShopWeb3IdCard';
import ShareSheet from '../components/ShareSheet';
import HardwareWalletCard from '../components/HardwareWalletCard';

const PayGatewayPanel = lazy(() => import('../components/PayGatewayPanel'));
/*
 * The in-store counter (TapToPay) rides the PAY tab, where the merchant's
 * whole payment story lives. Lazy like the gateway: it pulls QrScanner and
 * the NFC helpers, none of which belong in the eager graph.
 */
const TapToPay = lazy(() => import('../components/TapToPay'));
import { useTelegram } from '../context/TelegramContext';
import { useWallet } from '../context/WalletContext';
import { useSolanaWallet } from '../hooks/useSolanaWallet';
import { useAppStore } from '../store/useAppStore';
import { useShare } from '../hooks/useShare';
import { referredBy, siteShareUrl } from '../lib/referral';
import { IconChevronLeft, IconQr, IconSearch } from '../components/Icons';
import { TOKENS } from '../lib/chains';
import { getBalances } from '../lib/swap';
import { readPortfolioSnapshot } from '../lib/portfolioSnapshot';
import { readSolanaPortfolio } from '../lib/solana/portfolio';
import {
  SHOP_PRICING_COINS,
  fetchShopCatalogue,
  fetchShopCountries,
  fetchShopProducts,
  fetchShopReadiness,
  fetchShopTrending,
  getShopCountry,
  normalizeShopCoin,
  reportShopInterest,
  setShopCountry
} from '../lib/shop';
import {
  GIFT_THEMES,
  buildGiftSharePath,
  giftThemeFor,
  orderRowsByTrending,
  parseGiftArrival,
  pushRecentView,
  getRecentViews,
  recallGiftTheme,
  rememberGiftTheme,
  resolveRecentViews,
  trendingHasHeat
} from '../lib/shopHub';
import {
  brandSlug,
  brandUrl,
  countryUrl,
  esimUrl,
  flightUrl,
  shopEarns,
  stayCityUrl,
  topUpUrl
} from '../lib/shopLinks';
import {
  IconBed,
  IconCard,
  IconChart,
  IconFlame,
  IconGamepad,
  IconGift,
  IconGlobe,
  IconMoney,
  IconPay,
  IconPlane,
  IconPlay,
  IconRecent,
  IconShare,
  IconSim,
  IconSpark,
  IconStar,
  IconStore,
  IconSwap,
  IconTopUp
} from '../components/ShopIcons';
import { openUrl } from '../lib/browser';
import { FLIGHT_ROUTES, STAY_CITIES, flagOf } from '../lib/shopDestinations';
import { LANGUAGES } from '../i18n/languages';
import en from '../i18n/locales/en.json';
import { PROMO_IMAGES, PROMO_SLIDES } from '../lib/shopImages';
import {
  BUDGET_TIERS,
  QUICK_REGIONS,
  SHOP_USE_CASES,
  brandFavoriteKey,
  buildSwapShortfallPlan,
  filterByBudget,
  filterByUseCase,
  getShopFavorites,
  pickFavoriteBrands,
  pickFeaturedBrands,
  sortShopBrands,
  toggleShopFavorite
} from '../lib/shopCatalogTools';

/**
 * SHOP — Luxury Crypto Commerce Hub (`/shop`)
 * ---------------------------------------------------------------------------
 * Six verticals under one glass storefront:
 *   1. `cards`   — Gift cards + Use-Case Hub + budget chips + best-sellers + pins
 *   2. `money`   — Prepaid Visa / Mastercard / PayPal vouchers
 *   3. `topup`   — Mobile credit in 140+ countries + global travel eSIM
 *   4. `flights` — Verified destination routes + travel eSIM/card cross-sell
 *   5. `stays`   — Verified hotel cities + travel eSIM/card cross-sell
 *   6. `pay`     — FBT Pay non-custodial merchant invoice & QR gateway
 *                  + the in-store counter (TapToPay) + whitelabel readiness
 *
 * PHASE 2/3 ADDS, ON TOP OF THE SAME SHELF:
 *   · Gift envelope shares — a brand sheet shared as one of four themed
 *     in-app gift links (`#/shop?c=..&b=..&gift=1&gt=..&ref=CODE`), read on
 *     arrival without ever rewriting the URL on mount.
 *   · A loyalty chip wired to the RANK system exactly as /rewards reads it —
 *     tier, real perks, distance. Points are never spent here.
 *   · A recently-viewed rail (this device's localStorage) and a regional
 *     trend re-rank (anonymous server counter × provider margin × stock).
 *   · Web3 `.eth` / `.sol` identity checks that validate shape and the
 *     published .eth price ladder, route the coin purchase through /swap,
 *     and never pretend to know chain state.
 *   · Hardware-wallet security hub: mobile/desktop comparison and the
 *     four-step seal checklist inside HardwareWalletCard.
 *   · Swap & Pay on the customer landing (PayLanding) and the optional
 *     invoice note on every gateway link (v:1-compatible, fee split intact).
 */

const TABS = [
  { id: 'cards', Icon: IconCard },
  { id: 'money', Icon: IconMoney },
  { id: 'topup', Icon: IconTopUp },
  { id: 'flights', Icon: IconPlane },
  { id: 'stays', Icon: IconBed },
  { id: 'pay', Icon: IconPay }
];

const USE_CASE_ICONS = {
  ai: IconSpark,
  trading: IconChart,
  gaming: IconGamepad,
  appstore: IconStore,
  streaming: IconPlay,
  virtualcard: IconMoney
};

const PRIORITY = ['e-money', 'e-commerce', 'games', 'streaming', 'food', 'groceries', 'retail', 'entertainment'];

/** How many brands a category shows before "see all". */
const PREVIEW = 4;

function catLabel(t, id) {
  const key = `shop.cat.${id}`;
  const s = t(key);
  return s === key ? String(id).replace(/[_-]/g, ' ') : s;
}

function destKey(raw) {
  return String(raw ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function langLabel(code) {
  const meta = LANGUAGES.find((l) => l.code === code);
  if (!meta) return String(code ?? '').toUpperCase();
  return (
    <span lang={meta.code} dir={meta.dir}>{meta.endonym}</span>
  );
}

function snapshotStableBalances(address, chainId) {
  if (!address) return null;
  try {
    const snap = readPortfolioSnapshot(address);
    if (!snap || !Array.isArray(snap.rows)) return null;
    const out = { USDC: 0, USDT: 0 };
    let found = false;
    for (const r of snap.rows) {
      const sym = String(r?.symbol ?? '').toUpperCase();
      if (sym !== 'USDC' && sym !== 'USDT') continue;
      if (chainId && Number(r?.chainId) !== Number(chainId)) continue;
      const n = Number(r?.balance);
      if (Number.isFinite(n) && n >= 0) {
        out[sym] += n;
        found = true;
      }
    }
    return found ? out : null;
  } catch {
    return null;
  }
}

function fmtAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function LimitsBox() {
  const { t } = useTranslation();
  return (
    <InfoBox title={t('shop.limits.title')} tone="info" id="shop-limits">
      <ul className="shop-limits">
        {['l1', 'l2', 'l3', 'l4', 'l5'].map((k) => (
          <li key={k}>{t(`shop.limits.${k}`)}</li>
        ))}
      </ul>
    </InfoBox>
  );
}

function RegionQuickBar({ country, countries, onPickCountry, onOpenAll, t }) {
  const knownMap = useMemo(() => {
    const m = new Map();
    for (const c of countries) m.set(c.code, c.name);
    return m;
  }, [countries]);

  return (
    <div className="shop-region-bar" role="group" aria-label={t('shop.quickRegion.label')}>
      <span className="shop-region-bar-label">
        <IconGlobe width={14} height={14} />
        <span>{t('shop.quickRegion.label')}</span>
      </span>
      <div className="shop-region-pills">
        {QUICK_REGIONS.map((cc) => {
          const active = country === cc;
          const localizedName = t(`shop.quickRegion.names.${cc}`, {
            defaultValue: knownMap.get(cc) || cc
          });
          return (
            <button
              key={cc}
              type="button"
              className="shop-region-pill"
              data-on={active ? 'true' : 'false'}
              aria-pressed={active}
              onClick={() => onPickCountry(cc)}
            >
              <span className="shop-region-flag" aria-hidden="true">{flagOf(cc)}</span>
              <span className="shop-region-name">{localizedName}</span>
              <span className="shop-region-code">{cc}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="shop-region-pill shop-region-pill--all"
          onClick={onOpenAll}
        >
          <span>{t('shop.quickRegion.allCountries')}</span>
        </button>
      </div>
    </div>
  );
}

function TravelCompanionCard({ t, open, onOpenCards }) {
  return (
    <section className="card shop-travel-cross" aria-label={t('shop.travelCross.title')}>
      <div className="shop-travel-cross-head">
        <span className="shop-hero-kicker">{t('shop.travelCross.kicker')}</span>
        <div className="shop-travel-cross-title">{t('shop.travelCross.title')}</div>
        <p className="shop-travel-cross-sub">{t('shop.travelCross.sub')}</p>
      </div>
      <div className="shop-travel-cross-grid">
        <div className="shop-travel-cross-item">
          <div className="shop-travel-cross-icon">
            <IconSim width={18} height={18} />
          </div>
          <div className="shop-travel-cross-copy">
            <div className="shop-travel-cross-name">{t('shop.travelCross.esimTitle')}</div>
            <div className="shop-travel-cross-desc">{t('shop.travelCross.esimBody')}</div>
          </div>
          <button
            type="button"
            className="btn btn-primary shop-travel-cross-btn"
            onClick={() => open(esimUrl())}
          >
            {t('shop.travelCross.esimCta')}
          </button>
        </div>
        <div className="shop-travel-cross-item">
          <div className="shop-travel-cross-icon">
            <IconMoney width={18} height={18} />
          </div>
          <div className="shop-travel-cross-copy">
            <div className="shop-travel-cross-name">{t('shop.travelCross.cardTitle')}</div>
            <div className="shop-travel-cross-desc">{t('shop.travelCross.cardBody')}</div>
          </div>
          <button
            type="button"
            className="btn btn-ghost shop-travel-cross-btn"
            onClick={onOpenCards}
          >
            {t('shop.travelCross.cardCta')}
          </button>
        </div>
      </div>
    </section>
  );
}

export default function Shop() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg, user } = useTelegram();
  const wallet = useWallet();
  const solWallet = useSolanaWallet();

  /*
   * Deep links (`#/shop?c=TR&b=steam` or `#/shop?tab=pay`) are read without
   * rewriting the URL so browser back navigation stays predictable.
   */
  const [searchParams] = useSearchParams();
  const linkedTab = useMemo(() => {
    const q = String(searchParams.get('tab') ?? '').trim().toLowerCase();
    return TABS.some((x) => x.id === q) ? q : null;
  }, [searchParams]);
  const linkedCountry = useMemo(() => {
    const cc = String(searchParams.get('c') ?? '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(cc) ? cc : null;
  }, [searchParams]);
  const linkedBrand = useMemo(() => brandSlug(searchParams.get('b')) || null, [searchParams]);
  const deepLinkDone = useRef(false);

  /*
   * GIFT ARRIVAL — `?gift=1&gt=<theme>` beside the usual `c`/`b` params.
   *
   * Read exactly like the other deep-link params: from the URL, once, into
   * a memo. `setSearchParams` is NEVER called on mount — rewriting your own
   * URL during the first render is how a share link ends up in the browser
   * history twice, how Telegram's in-app view loops reload a "cleaned" hash,
   * and how a React 18 strict-mode double effect turns one navigation into
   * two. The banner simply exists while the params exist; back-space still
   * leaves the shop the way it entered it.
   *
   * Attribution needs NO new mechanism: the app's boot already runs
   * `captureReferral()` over the hash query, so the sender's `ref=CODE` in a
   * gift link is recorded by the same first-touch, self-referral-refusing,
   * 90-day-windowed path as a plain invite. This page only displays what
   * that recorder decided — `referredBy()` — never a hopeful copy.
   */
  const giftArrival = useMemo(() => parseGiftArrival((k) => searchParams.get(k)), [searchParams]);
  const [giftTheme, setGiftTheme] = useState(() => recallGiftTheme());

  const [share, shareSheet] = useShare();
  const ensureRefCode = useAppStore((s) => s.ensureRefCode);
  const refCode = useMemo(
    () => (typeof ensureRefCode === 'function' ? ensureRefCode(user?.id) : ''),
    [ensureRefCode, user?.id]
  );

  const [tab, setTab] = useState(() => linkedTab ?? 'cards');
  const [country, setCountry] = useState(() => linkedCountry ?? getShopCountry());
  const [countries, setCountries] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [openCat, setOpenCat] = useState(null);
  const [query, setQuery] = useState('');
  const [activeUseCase, setActiveUseCase] = useState(null);
  const [budget, setBudget] = useState('all');
  const [favKeys, setFavKeys] = useState(() => getShopFavorites());

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [openBrand, setOpenBrand] = useState(null);
  const [pricingCoin, setPricingCoin] = useState('USDC');
  const [selectedDenomId, setSelectedDenomId] = useState(null);
  const [products, setProducts] = useState(null);
  const [productsLoading, setProductsLoading] = useState(false);

  const [evmBalances, setEvmBalances] = useState(null);
  const [solBalances, setSolBalances] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  /*
   * PHASE 2/3 HUB STATE — all three are additive reads of the same cached
   * data the page already fetches, and all three stay silent when the
   * server has nothing: an empty trending list re-renders the old rail, a
   * null readiness renders no card, and an empty recent list renders no bar.
   */
  const [recent, setRecent] = useState(() => getRecentViews());
  const [trending, setTrending] = useState([]);
  const [readiness, setReadiness] = useState(null);
  const [counterOpen, setCounterOpen] = useState(false);

  /* Opening a brand is both the shop's "view" (recently-viewed rail, this
     device's localStorage only) and its anonymous popularity tick (country +
     brand id over the wire, nothing else). See lib/shopHub and
     server/shop.js for the two privacy properties that make that legal. */
  const openedRef = useRef(null);
  useEffect(() => {
    const brand = openBrand;
    if (!brand || !country) return;
    if (openedRef.current === brand.id) return;
    openedRef.current = brand.id;
    setRecent(pushRecentView(brand));
    void reportShopInterest(country, brand.id);
  }, [openBrand, country]);

  useEffect(() => {
    if (!country) {
      setTrending([]);
      return undefined;
    }
    let alive = true;
    fetchShopTrending(country)
      .then((d) => { if (alive) setTrending(d?.rows ?? []); })
      .catch(() => { if (alive) setTrending([]); });
    return () => { alive = false; };
  }, [country]);

  useEffect(() => {
    let alive = true;
    fetchShopReadiness()
      .then((d) => { if (alive) setReadiness(d); })
      .catch(() => { /* absence is the correct render — see lib/shop.js */ });
    return () => { alive = false; };
  }, []);

  const open = useCallback(
    (url) => {
      if (!url) return;
      haptic?.('light');
      if (tg?.openLink) tg.openLink(url);
      else openUrl(url);
    },
    [haptic, tg]
  );

  useEffect(() => {
    let alive = true;
    fetchShopCountries().then((d) => alive && setCountries(d.rows));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!country) return undefined;
    let alive = true;
    setLoading(true);
    setOpenCat(null);
    fetchShopCatalogue(country)
      .then((d) => alive && setData(d))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [country]);

  const uiLang = String(i18n?.resolvedLanguage || i18n?.language || 'en').toLowerCase().slice(0, 2);

  useEffect(() => {
    if (!openBrand || !country) return undefined;
    let alive = true;
    setProducts(null);
    setProductsLoading(true);
    const opts = pricingCoin === 'USDC'
      ? { lang: uiLang }
      : { lang: uiLang, coin: normalizeShopCoin(pricingCoin) };
    fetchShopProducts(country, openBrand.family, opts)
      .then((d) => alive && setProducts(d))
      .finally(() => alive && setProductsLoading(false));
    return () => {
      alive = false;
    };
  }, [openBrand, country, uiLang, pricingCoin]);

  useEffect(() => {
    setSelectedDenomId(null);
  }, [openBrand?.id]);

  useEffect(() => {
    const list = products?.rows;
    if (!Array.isArray(list) || list.length === 0) return;
    setSelectedDenomId((prev) => {
      if (prev && list.some((p) => p.id === prev)) return prev;
      const best = typeof products?.bestSpreadPct === 'number'
        ? list.find((p) => p.spreadPct === products.bestSpreadPct)
        : null;
      return (best || list[0])?.id ?? null;
    });
  }, [products]);

  /* Connected EVM / Solana stablecoin balance reader (non-custodial, zero RPC when disconnected). */
  const evmConnected = Boolean(wallet?.isConnected && wallet?.address);
  const evmAddress = wallet?.address || null;
  const evmChainId = wallet?.chainId || null;
  const solConnected = Boolean(solWallet?.address);
  const solAddress = solWallet?.address || null;

  useEffect(() => {
    if (!evmConnected || !evmAddress) {
      setEvmBalances(null);
      return undefined;
    }
    const cached = snapshotStableBalances(evmAddress, evmChainId);
    if (cached) setEvmBalances(cached);
    if (!openBrand || typeof wallet?.getReadProvider !== 'function') return undefined;

    const chainTokens = Array.isArray(TOKENS?.[evmChainId]) ? TOKENS[evmChainId] : [];
    const stables = chainTokens.filter((tk) => tk.symbol === 'USDC' || tk.symbol === 'USDT');
    if (stables.length === 0) return undefined;

    let alive = true;
    setBalanceLoading(true);
    Promise.resolve()
      .then(() => {
        const provider = wallet.getReadProvider(evmChainId);
        return getBalances(provider, evmAddress, stables);
      })
      .then((res) => {
        if (!alive || !res) return;
        const next = { USDC: 0, USDT: 0 };
        for (const tk of stables) {
          const n = Number(res[tk.symbol]);
          if (Number.isFinite(n) && n >= 0) next[tk.symbol] = n;
        }
        setEvmBalances(next);
      })
      .catch(() => { /* keep snapshot or graceful null */ })
      .finally(() => {
        if (alive) setBalanceLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [openBrand, evmConnected, evmAddress, evmChainId, wallet]);

  useEffect(() => {
    if (!solConnected || !solAddress) {
      setSolBalances(null);
      return undefined;
    }
    if (!openBrand) return undefined;
    let alive = true;
    readSolanaPortfolio(solAddress)
      .then((snap) => {
        if (!alive || !Array.isArray(snap?.rows)) return;
        const next = { USDC: 0, USDT: 0 };
        for (const r of snap.rows) {
          const sym = String(r?.symbol ?? '').toUpperCase();
          if (sym === 'USDC' || sym === 'USDT') {
            const n = Number(r?.balance);
            if (Number.isFinite(n) && n >= 0) next[sym] += n;
          }
        }
        setSolBalances(next);
      })
      .catch(() => { /* keep graceful null */ });
    return () => {
      alive = false;
    };
  }, [openBrand, solConnected, solAddress]);

  useEffect(() => {
    if (deepLinkDone.current || !linkedBrand || !data?.rows?.length) return;
    deepLinkDone.current = true;
    const hit = data.rows.find((r) => brandSlug(r.family) === linkedBrand);
    if (hit) setOpenBrand(hit);
  }, [data, linkedBrand]);

  const shareBrand = useCallback(() => {
    if (!openBrand || !country) return;
    haptic?.('light');
    const url = siteShareUrl(
      `/shop?c=${encodeURIComponent(country)}&b=${encodeURIComponent(brandSlug(openBrand.family))}`,
      refCode
    );
    void share({ url, text: t('shop.shareText', { brand: openBrand.name }) });
  }, [openBrand, country, refCode, share, haptic, t]);

  /*
   * SEND AS GIFT — the same `siteShareUrl` mechanism as a normal share, with
   * `&gift=1&gt=<theme>` added. There is deliberately NO new attribution
   * path: the link's `ref=CODE` is read at boot by the existing
   * `captureReferral()`, which keeps first-touch, refuses self-referral, and
   * pays the referrer share for REFERRAL_WINDOW_DAYS (90) — that is the
   * whole promise, and the copy says exactly that. What the gift params add
   * is only WHICH CARD the recipient lands on and WHICH ENVELOPE paints the
   * sheet — presentation over a mechanism that already exists.
   */
  const sendGift = useCallback(() => {
    if (!openBrand || !country) return;
    haptic?.('light');
    const path = buildGiftSharePath(country, openBrand.family, giftTheme);
    if (!path) return;
    const url = siteShareUrl(path, refCode);
    void share({
      url,
      text: t('shop.gift.shareText', {
        brand: openBrand.name,
        theme: t(`shop.gift.theme.${giftTheme}`)
      })
    });
  }, [openBrand, country, giftTheme, refCode, share, haptic, t]);

  const pickGiftTheme = useCallback((id) => {
    haptic?.('select');
    setGiftTheme(rememberGiftTheme(giftThemeFor(id)));
  }, [haptic]);

  const handleTogglePin = useCallback((brand) => {
    if (!brand) return;
    haptic?.('light');
    setFavKeys((prev) => toggleShopFavorite(brand, prev));
  }, [haptic]);

  const favSet = useMemo(() => new Set(favKeys), [favKeys]);

  const allRows = data?.rows ?? [];
  const rows = useMemo(
    () => (tab === 'money'
      ? sortShopBrands(
        allRows.filter((r) => r.category === 'e-money' || (Array.isArray(r.tags) && r.tags.includes('e-money'))),
        favKeys
      )
      : sortShopBrands(allRows, favKeys)),
    [allRows, tab, favKeys]
  );

  const favoriteBrands = useMemo(() => pickFavoriteBrands(rows, favKeys), [rows, favKeys]);

  /*
   * THE TREND OPTIMISATION, IN ONE LINE — popularity + proven margin +
   * stock, weighted server-side over the catalogue that is already cached
   * (see `rankTrendingBrands` in server/shop.js); the client only RE-ORDERS
   * the flagship rail it already had. An empty or cold answer returns the
   * old order untouched, and `trendingHasHeat` keeps the flame badge from
   * claiming heat the counter has not actually seen — a rail labelled
   * "hottest in the region" on a server that heard zero clicks would be the
   * lie this repo keeps engineering against, not the feature.
   */
  const featuredBrands = useMemo(() => {
    const base = pickFeaturedBrands(allRows, 12);
    return orderRowsByTrending(base, trending, { limit: 12 });
  }, [allRows, trending]);
  const trendingHot = useMemo(() => trendingHasHeat(trending), [trending]);

  /* Recently viewed — joined onto the LIVE catalogue; brands the current
     country no longer carries (or that went out of stock) drop out. */
  const recentRows = useMemo(
    () => resolveRecentViews(recent, allRows),
    [recent, allRows]
  );

  const categories = useMemo(() => {
    const cs = data?.categories ?? [];
    const first = PRIORITY.map((id) => cs.find((c) => c.id === id)).filter(Boolean);
    return [...first, ...cs.filter((c) => !PRIORITY.includes(c.id))];
  }, [data]);

  const inCat = useCallback(
    (r, id) => r.category === id || (Array.isArray(r.tags) && r.tags.includes(id)),
    []
  );

  const hasActiveFilter = Boolean(query.trim() || (tab === 'cards' && activeUseCase) || budget !== 'all');

  const filteredRows = useMemo(() => {
    if (!hasActiveFilter) return null;
    let base = tab === 'cards' && activeUseCase
      ? filterByUseCase(rows, activeUseCase, favKeys)
      : rows;
    base = filterByBudget(base, budget);
    const q = query.trim().toLowerCase();
    if (q) {
      base = base.filter((r) =>
        `${r.name} ${r.category} ${(r.tags ?? []).join(' ')}`.toLowerCase().includes(q)
      );
    }
    return base;
  }, [hasActiveFilter, tab, activeUseCase, rows, favKeys, budget, query]);

  const catRows = useMemo(
    () => (openCat ? filterByBudget(rows.filter((r) => inCat(r, openCat)), budget) : []),
    [rows, openCat, inCat, budget]
  );

  const resetFilters = useCallback(() => {
    haptic?.('light');
    setQuery('');
    setActiveUseCase(null);
    setBudget('all');
  }, [haptic]);

  const pickCountry = (cc) => {
    haptic?.('select');
    setShopCountry(cc);
    setCountry(cc);
    setOpenBrand(null);
    setQuery('');
    setPickerOpen(false);
  };

  const countryName = countries.find((c) => c.code === country)?.name ?? country;
  const displayCountryName = useMemo(() => {
    if (country) {
      const loc = t(`shop.quickRegion.names.${country}`, { defaultValue: '' });
      if (loc) return loc;
    }
    return countryName;
  }, [country, countryName, t]);

  const proseLocale = products?.contentLocale ?? null;
  const proseLocalized = Boolean(proseLocale && proseLocale === uiLang);
  const ownStepsTranslated = t('shop.redeemSteps.s1') !== en?.shop?.redeemSteps?.s1;
  const showOwnSteps = Boolean(products) && !proseLocalized && ownStepsTranslated;

  const selectedDenom = useMemo(() => {
    const list = products?.rows;
    if (!Array.isArray(list) || list.length === 0) return null;
    return list.find((p) => p.id === selectedDenomId) || list[0];
  }, [products, selectedDenomId]);

  const swapPlan = useMemo(
    () => buildSwapShortfallPlan({
      denom: selectedDenom,
      pricingCoin,
      evmConnected,
      evmChainId,
      evmBalances,
      solConnected,
      solBalances
    }),
    [selectedDenom, pricingCoin, evmConnected, evmChainId, evmBalances, solConnected, solBalances]
  );

  const openBrandPinned = openBrand ? favSet.has(brandFavoriteKey(openBrand)) : false;

  const noteOriginHeader = !proseLocalized ? (
    <p className="faint" style={{ fontSize: 11, margin: '0 0 5px' }}>
      {t('shop.providerNote')}
      {proseLocale && <> ({langLabel(proseLocale)})</>}
    </p>
  ) : null;

  const howToOriginHeader = !proseLocalized ? (
    <p className="faint" style={{ fontSize: 11, margin: showOwnSteps ? '12px 0 5px' : '0 0 5px' }}>
      {t('shop.providerHowTo', { brand: openBrand?.name ?? '' })}
      {proseLocale && <> ({langLabel(proseLocale)})</>}
    </p>
  ) : null;

  const header = (
    <motion.div className="row-between shop-header" variants={riseIn} initial="hidden" animate="show">
      <div className="row" style={{ gap: 10 }}>
        <button
          type="button"
          className="icon-btn"
          onClick={() => {
            if (openCat) setOpenCat(null);
            else navigate(-1);
          }}
          aria-label={t('common.back')}
        >
          <IconChevronLeft width={18} height={18} />
        </button>
        <div>
          <h1 className="h1" style={{ fontSize: 19 }}>
            {openCat ? catLabel(t, openCat) : t('shop.title')}
          </h1>
          <p className="prose-sm">
            {openCat
              ? countryName
              : tab === 'pay'
                ? t('shop.pay.subtitle')
                : t('shop.subtitle')}
          </p>
        </div>
      </div>
      {country ? (
        <button type="button" className="chip shop-country-btn" onClick={() => setPickerOpen(true)}>
          <span aria-hidden="true">{flagOf(country)}</span> {country}
        </button>
      ) : (
        <button type="button" className="chip shop-country-btn" onClick={() => setPickerOpen(true)}>
          <IconGlobe width={15} height={15} />
          <span>{t('shop.chooseOne')}</span>
        </button>
      )}
    </motion.div>
  );

  const brandSheet = (
    <Sheet open={Boolean(openBrand)} onClose={() => setOpenBrand(null)} title={openBrand?.name ?? ''}>
      {/*
        THE GIFT ENVELOPE — what the recipient of a gift link sees on top of
        the very card they were sent, themed by the sender's pick. It reports
        only what is true at this moment: someone sent this card, the tab is
        open on it, and IF `referredBy()` found the sender's code recorded at
        boot, the referral line appears too. If the device already had
        another referrer (first-touch wins) or the code was invalid, the line
        is honestly absent — the gift still opens, the banner does not lie.
      */}
      {giftArrival && openBrand && (
        <div className="shop-gift-envelope" data-theme={giftArrival.theme} role="note" data-testid="shop-gift-envelope">
          <span className="shop-gift-envelope-mark" aria-hidden="true">
            {(GIFT_THEMES.find((g) => g.id === giftArrival.theme) || GIFT_THEMES[3]).emoji}
          </span>
          <div className="shop-gift-envelope-copy">
            <strong>{t('shop.gift.receivedTitle', { brand: openBrand.name })}</strong>
            <p>{t('shop.gift.receivedBody')}</p>
            {referredBy() ? (
              <span className="shop-gift-envelope-ref">✓ {t('shop.gift.referralActive')}</span>
            ) : null}
          </div>
        </div>
      )}
      {openBrand && (
        <div className="shop-sheet-toolbar">
          <div className="shop-coin-switch" role="group" aria-label={t('shop.checkout.coinLabel')}>
            <span className="shop-coin-switch-label">{t('shop.checkout.coinLabel')}</span>
            <div className="shop-coin-pills">
              {SHOP_PRICING_COINS.map((c) => {
                const active = normalizeShopCoin(pricingCoin) === c;
                return (
                  <button
                    key={c}
                    type="button"
                    className="shop-coin-pill"
                    data-on={active ? 'true' : 'false'}
                    aria-pressed={active}
                    onClick={() => {
                      haptic?.('select');
                      setPricingCoin(c);
                    }}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            className="shop-sheet-pin"
            data-pinned={openBrandPinned ? 'true' : 'false'}
            aria-pressed={openBrandPinned}
            onClick={() => handleTogglePin(openBrand)}
          >
            <IconStar width={14} height={14} filled={openBrandPinned} />
            <span>{t(openBrandPinned ? 'shop.fav.pinned' : 'shop.fav.pinAction')}</span>
          </button>
        </div>
      )}

      {/*
        GIFT THEME PICKER — four envelopes, one persistent default. Picking
        a theme here does not buy anything or open anything by itself; the
        envelope only materialises when the sender taps «ارسال هدیه» below.
        The chosen id rides the URL as `gt=<id>` and the receiver validates
        it against the SAME table (giftThemeFor), so a hand-typed theme can
        only ever land on the neutral gold.
      */}
      {openBrand && (
        <div className="shop-gift-row" role="group" aria-label={t('shop.gift.pickTheme')}>
          <span className="shop-gift-label">
            <IconGift width={14} height={14} />
            <span>{t('shop.gift.rowTitle')}</span>
          </span>
          <div className="shop-gift-pills">
            {GIFT_THEMES.map((g) => (
              <button
                key={g.id}
                type="button"
                className="shop-gift-pill"
                data-on={giftTheme === g.id ? 'true' : 'false'}
                aria-pressed={giftTheme === g.id}
                onClick={() => pickGiftTheme(g.id)}
              >
                <span aria-hidden="true">{g.emoji}</span>
                <span>{t(`shop.gift.theme.${g.id}`)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {productsLoading ? (
        <div className="stack" style={{ gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel" style={{ height: 44 }} />
          ))}
        </div>
      ) : !products?.rows?.length ? (
        <p className="faint">{t('shop.noDenoms')}</p>
      ) : (
        <>
          <p className="section-label">{t('shop.amounts')}</p>
          <div className="shop-denoms">
            {products.rows.map((p) => {
              const hasSpread = typeof p.spreadPct === 'number';
              const best =
                hasSpread &&
                typeof products.bestSpreadPct === 'number' &&
                p.spreadPct === products.bestSpreadPct;
              const isSelected = selectedDenom?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  className="shop-denom"
                  data-best={best ? 'true' : 'false'}
                  data-selected={isSelected ? 'true' : 'false'}
                  aria-pressed={isSelected}
                  onClick={() => {
                    haptic?.('light');
                    setSelectedDenomId(p.id);
                  }}
                >
                  <div className="shop-denom-face">{p.label}</div>
                  <div className="shop-denom-coin" dir="ltr">
                    {p.coinAmount ? `${p.coinAmount} ${p.coin}` : '—'}
                  </div>
                  {hasSpread && (
                    <div className="shop-denom-spread" data-best={best ? 'true' : 'false'}>
                      {t('shop.spread', { pct: p.spreadPct })}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {products.rows.some((p) => typeof p.spreadPct === 'number') && (
            <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.7, marginTop: 8 }}>
              {t('shop.spreadWhy')}
            </p>
          )}

          {selectedDenom && (
            <div className="shop-checkout-box">
              <div className="shop-checkout-grid">
                <div className="shop-checkout-row">
                  <span className="shop-checkout-k">{t('shop.checkout.payable')}</span>
                  <span className="shop-checkout-v" dir="ltr">
                    {swapPlan.requiredAmount != null
                      ? `${fmtAmount(swapPlan.requiredAmount)} ${swapPlan.coin}`
                      : selectedDenom.label}
                  </span>
                </div>
                {swapPlan.spreadPct !== null && (
                  <div className="shop-checkout-row">
                    <span className="shop-checkout-k">{t('shop.checkout.margin')}</span>
                    <span className="shop-checkout-v" dir="ltr">
                      {`${swapPlan.spreadPct >= 0 ? '+' : ''}${swapPlan.spreadPct}%`}
                    </span>
                  </div>
                )}
                <div className="shop-checkout-row">
                  <span className="shop-checkout-k">{t('shop.checkout.walletStatus')}</span>
                  <span
                    className="shop-checkout-status"
                    data-tone={
                      !swapPlan.anyConnected
                        ? 'neutral'
                        : swapPlan.walletBalance === null
                          ? 'neutral'
                          : swapPlan.hasEnough
                            ? 'ok'
                            : 'warn'
                    }
                  >
                    {!swapPlan.anyConnected
                      ? t('shop.checkout.walletDisconnected')
                      : balanceLoading && swapPlan.walletBalance === null
                        ? t('common.loading')
                        : swapPlan.walletBalance === null
                          ? t('shop.checkout.balanceUnavailable', { coin: swapPlan.coin })
                          : swapPlan.hasEnough
                            ? t('shop.checkout.balanceSufficient', {
                              balance: fmtAmount(swapPlan.walletBalance),
                              coin: swapPlan.coin
                            })
                            : t('shop.checkout.balanceDeficit', {
                              deficit: fmtAmount(swapPlan.deficitAmount),
                              coin: swapPlan.coin,
                              balance: fmtAmount(swapPlan.walletBalance)
                            })}
                  </span>
                </div>
              </div>

              <div className="shop-swap-callout">
                <button
                  type="button"
                  className="btn shop-swap-cta"
                  onClick={() => {
                    haptic?.('medium');
                    setOpenBrand(null);
                    navigate(swapPlan.primarySwapRoute);
                  }}
                >
                  <IconSwap width={16} height={16} />
                  <span>
                    {swapPlan.anyConnected && !swapPlan.hasEnough && swapPlan.deficitAmount
                      ? t('shop.checkout.swapDeficitCta', {
                        amount: fmtAmount(swapPlan.deficitAmount),
                        coin: swapPlan.coin
                      })
                      : t('shop.checkout.swapQuickCta', { coin: swapPlan.coin })}
                  </span>
                </button>
                <div className="shop-swap-subrow">
                  <span className="shop-swap-hint">{t('shop.checkout.swapHint')}</span>
                  <button
                    type="button"
                    className="shop-swap-alt-link"
                    onClick={() => {
                      haptic?.('light');
                      setOpenBrand(null);
                      navigate(
                        swapPlan.activeNetwork === 'solana'
                          ? swapPlan.evmSwapRoute
                          : swapPlan.solanaSwapRoute
                      );
                    }}
                  >
                    {swapPlan.activeNetwork === 'solana'
                      ? t('shop.checkout.swapOnEvm')
                      : t('shop.checkout.swapOnSolana')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {products?.note && (
        <div style={{ marginTop: 12 }}>
          {noteOriginHeader}
          <p
            className="notice"
            style={{ margin: 0, whiteSpace: 'pre-line' }}
            dir={proseLocalized ? undefined : 'ltr'}
          >
            {products.note}
          </p>
        </div>
      )}

      {(products?.howTo || showOwnSteps) && (
        <div style={{ marginTop: 10 }}>
          <InfoBox title={t('shop.howTo')} tone="info" id="shop-howto">
            {showOwnSteps && (
              <ol className="shop-steps">
                {['s1', 's2', 's3', 's4', 's5'].map((k) => (
                  <li key={k}>
                    {t(`shop.redeemSteps.${k}`, { brand: openBrand?.name ?? '', country: countryName })}
                  </li>
                ))}
              </ol>
            )}
            {products?.howTo && (
              <div>
                {howToOriginHeader}
                <p
                  className={proseLocalized ? undefined : 'faint'}
                  style={{ whiteSpace: 'pre-line', fontSize: proseLocalized ? undefined : 12 }}
                  dir={proseLocalized ? undefined : 'ltr'}
                >
                  {products.howTo}
                </p>
              </div>
            )}
          </InfoBox>
        </div>
      )}

      {openBrand && (
        <div className="shop-sheet-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => open(brandUrl(country, openBrand.family))}
          >
            {t('shop.buyAt', { brand: openBrand.name })}
          </button>
          <button type="button" className="btn btn-ghost" onClick={shareBrand}>
            <IconShare width={15} height={15} />
            {t('shop.share')}
          </button>
          {/*
            The gift share sits BESIDE the normal one, never replacing it —
            both route through the same useShare → native sheet → in-app
            fallback chain, so on a desktop with no navigator.share the gift
            link lands in the fallback sheet exactly like every other share.
          */}
          <button type="button" className="btn btn-ghost shop-gift-send" onClick={sendGift}>
            <IconGift width={15} height={15} />
            {t('shop.gift.send')}
          </button>
        </div>
      )}
    </Sheet>
  );

  /* ── No country yet (unless the user opened the global FBT Pay gateway tab) ── */
  if (!country && tab !== 'pay') {
    return (
      <PageTransition className="shop-shell">
        {header}
        <motion.section className="card card-rgb shop-welcome-card" variants={riseIn} initial="hidden" animate="show">
          <div className="sheen" />
          <div className="shop-welcome-title">{t('shop.pickCountry')}</div>
          <p className="prose-sm" style={{ margin: 0 }}>{t('shop.pickCountryWhy')}</p>

          <RegionQuickBar
            country={country}
            countries={countries}
            onPickCountry={pickCountry}
            onOpenAll={() => setPickerOpen(true)}
            t={t}
          />

          <div className="shop-welcome-actions">
            <button type="button" className="btn btn-primary" onClick={() => setPickerOpen(true)}>
              {t('shop.chooseOne')}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                haptic?.('select');
                setTab('pay');
              }}
            >
              <IconPay width={16} height={16} />
              <span>{t('shop.pay.openCta')}</span>
            </button>
          </div>
        </motion.section>

        <div className="shop-alt">
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/swap')}>
            {t('shop.alt.swap')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/earn')}>
            {t('shop.alt.earn')}
          </button>
        </div>

        <ShopWeb3IdCard />

        <HardwareWalletCard />

        <ShopCountrySheet
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          countries={countries}
          value={country}
          onPick={pickCountry}
        />
        <LimitsBox />
      </PageTransition>
    );
  }

  /* ── Single category full page ── */
  if (openCat) {
    return (
      <PageTransition className="shop-shell">
        {header}
        <div className="shop-budget-bar" role="group" aria-label={t('shop.budget.label')}>
          <span className="shop-budget-label">{t('shop.budget.label')}</span>
          <div className="shop-budget-pills">
            {BUDGET_TIERS.map((tier) => (
              <button
                key={tier.id}
                type="button"
                className="shop-budget-pill"
                data-on={budget === tier.id ? 'true' : 'false'}
                aria-pressed={budget === tier.id}
                onClick={() => { haptic?.('select'); setBudget(tier.id); }}
              >
                {t(`shop.budget.tier_${tier.id}`)}
              </button>
            ))}
          </div>
        </div>
        <p className="faint" style={{ fontSize: 11.5 }}>
          {t('shop.count', { n: catRows.length, country: countryName })}
        </p>
        <motion.div className="shop-grid" variants={stagger} initial="hidden" animate="show">
          {catRows.map((b) => (
            <ShopTile
              key={b.id}
              brand={b}
              open={openBrand?.id === b.id}
              pinned={favSet.has(brandFavoriteKey(b))}
              onTogglePin={handleTogglePin}
              onClick={() => setOpenBrand(b)}
            />
          ))}
        </motion.div>
        {brandSheet}
        <ShareSheet {...shareSheet} />
      </PageTransition>
    );
  }

  return (
    <PageTransition className="shop-shell">
      {header}

      {(tab === 'cards' || tab === 'money') && (
        <ShopPromo slides={PROMO_SLIDES} onSlide={(sl) => setTab(sl.go)} />
      )}

      <div className="shop-tabs" role="tablist" aria-label={t('shop.title')}>
        {TABS.map(({ id, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className="shop-tab"
            data-on={tab === id}
            onClick={() => {
              if (id !== 'pay' && !country) {
                setPickerOpen(true);
                return;
              }
              haptic?.('select');
              setTab(id);
              setOpenBrand(null);
              setOpenCat(null);
            }}
          >
            <Icon width={17} height={17} />
            <span>{t(`shop.tab.${id}`)}</span>
          </button>
        ))}
      </div>

      {(tab === 'cards' || tab === 'money' || tab === 'topup') && (
        <RegionQuickBar
          country={country}
          countries={countries}
          onPickCountry={pickCountry}
          onOpenAll={() => setPickerOpen(true)}
          t={t}
        />
      )}

      {tab === 'cards' || tab === 'money' ? (
        <>
          <motion.section className="shop-hero" variants={riseIn} initial="hidden" animate="show">
            <span className="shop-hero-kicker">{t('shop.heroKicker')}</span>
            <div className="shop-hero-title">{t('shop.heroTitle', { country: displayCountryName })}</div>
            <p className="shop-hero-sub">{t('shop.heroSub')}</p>
            <div className="shop-trust-row">
              <span className="shop-trust-pill">⚡ {t('shop.trust.fast')}</span>
              <span className="shop-trust-pill">◈ {t('shop.trust.crypto')}</span>
              <span className="shop-trust-pill">✉ {t('shop.trust.email')}</span>
            </div>
            <div className="shop-quick">
              <button type="button" onClick={() => open(countryUrl(country))}>
                <IconCard width={18} height={18} />
                {t('shop.quickAll')}
              </button>
              <button type="button" onClick={() => open(topUpUrl(country))}>
                <IconTopUp width={18} height={18} />
                {t('shop.quickTopUp')}
              </button>
            </div>
          </motion.section>

          {/* Rank, honestly — tier, real perks, distance to the next tier. */}
          {tab === 'cards' && <ShopLoyaltyCard />}

          {/*
            RECENTLY VIEWED — this device's short memory of the catalogue.
            Chips rather than tiles: the job is one-tap return to something
            you ALREADY chose, which a strip of names does in less height than
            a grid of artwork does, and the grid keeps its room for discovery.
          */}
          {recentRows.length > 0 && (
            <section className="shop-recent-bar" aria-label={t('shop.recent.title')} data-testid="shop-recent-bar">
              <span className="shop-recent-label">
                <IconRecent width={14} height={14} />
                <span>{t('shop.recent.title')}</span>
              </span>
              <div className="shop-recent-pills">
                {recentRows.slice(0, 8).map((b) => (
                  <button
                    key={`recent-${b.id}`}
                    type="button"
                    className="shop-recent-pill"
                    onClick={() => { haptic?.('light'); setOpenBrand(b); }}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Pinned / Favorite Brands Bar (`localStorage`) */}
          {favoriteBrands.length > 0 && (
            <section className="shop-fav-section" aria-label={t('shop.fav.sectionTitle')}>
              <div className="shop-cat-row shop-cat-row--tight">
                <h2 className="shop-cat-title shop-cat-title--fav">
                  <IconStar width={16} height={16} filled />
                  <span>{t('shop.fav.sectionTitle')}</span>
                  <span className="shop-cat-count">{favoriteBrands.length}</span>
                </h2>
              </div>
              <motion.div className="shop-rail" variants={stagger} initial="hidden" animate="show">
                {favoriteBrands.map((b) => (
                  <ShopTile
                    key={`fav-${b.id}`}
                    brand={b}
                    open={openBrand?.id === b.id}
                    pinned
                    onTogglePin={handleTogglePin}
                    onClick={() => setOpenBrand(b)}
                  />
                ))}
              </motion.div>
            </section>
          )}

          {/* Use-Case Hub — 6 interactive cards for global AI, Trading, Gaming, Stores, Streaming & Virtual Cards */}
          {tab === 'cards' && data?.live && rows.length > 0 && (
            <section className="shop-usecase-hub" aria-label={t('shop.useCase.title')}>
              <div className="shop-section-title-row">
                <div>
                  <h2 className="shop-section-heading">{t('shop.useCase.title')}</h2>
                  <p className="shop-section-sub">{t('shop.useCase.subtitle')}</p>
                </div>
                {activeUseCase && (
                  <button
                    type="button"
                    className="shop-more"
                    onClick={() => { haptic?.('light'); setActiveUseCase(null); }}
                  >
                    {t('shop.useCase.clear')}
                  </button>
                )}
              </div>
              <div className="shop-usecase-grid">
                {SHOP_USE_CASES.map((uc) => {
                  const UcIcon = USE_CASE_ICONS[uc.id] || IconCard;
                  const isOn = activeUseCase === uc.id;
                  return (
                    <button
                      key={uc.id}
                      type="button"
                      className="shop-usecase-card"
                      data-on={isOn ? 'true' : 'false'}
                      aria-pressed={isOn}
                      onClick={() => {
                        haptic?.('select');
                        setActiveUseCase((prev) => (prev === uc.id ? null : uc.id));
                      }}
                    >
                      <span className="shop-usecase-icon">
                        <UcIcon width={18} height={18} />
                      </span>
                      <span className="shop-usecase-copy">
                        <span className="shop-usecase-name">{t(`shop.useCase.${uc.id}.title`)}</span>
                        <span className="shop-usecase-tags">{t(`shop.useCase.${uc.id}.brands`)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {activeUseCase && (
                <div className="shop-usecase-guide">
                  <div className="shop-usecase-guide-body">
                    <strong>{t(`shop.useCase.${activeUseCase}.title`)}: </strong>
                    <span>{t(`shop.useCase.${activeUseCase}.guide`)}</span>
                  </div>
                  <button
                    type="button"
                    className="shop-usecase-guide-reset"
                    onClick={() => { haptic?.('light'); setActiveUseCase(null); }}
                  >
                    {t('shop.useCase.clear')}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Search + Quick Budget Chips */}
          <div className="shop-filter-toolbar">
            <label className="shop-search">
              <IconSearch width={18} height={18} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('shop.search', { country: displayCountryName })}
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} aria-label={t('shop.clear')}>×</button>
              )}
            </label>

            <div className="shop-budget-bar" role="group" aria-label={t('shop.budget.label')}>
              <span className="shop-budget-label">{t('shop.budget.label')}</span>
              <div className="shop-budget-pills">
                {BUDGET_TIERS.map((tier) => {
                  const active = budget === tier.id;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      className="shop-budget-pill"
                      data-on={active ? 'true' : 'false'}
                      aria-pressed={active}
                      onClick={() => {
                        haptic?.('select');
                        setBudget(tier.id);
                      }}
                    >
                      {t(`shop.budget.tier_${tier.id}`)}
                    </button>
                  );
                })}
              </div>
              {hasActiveFilter && (
                <button
                  type="button"
                  className="shop-budget-reset"
                  onClick={resetFilters}
                >
                  {t('shop.budget.reset')}
                </button>
              )}
            </div>
          </div>

          {loading && !data ? (
            <div className="stack" style={{ gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="shop-sk">
                  <div className="shop-sk-shot" />
                  <div className="shop-sk-line" style={{ width: '52%' }} />
                  <div className="shop-sk-line" style={{ width: '30%', height: 9 }} />
                </div>
              ))}
            </div>
          ) : !data?.live ? (
            <p className="notice">{t('shop.unavailable')}</p>
          ) : filteredRows ? (
            !filteredRows.length ? (
              <div className="empty">
                <span className="empty-icon">🛍</span>
                <div>{query.trim() && !activeUseCase && budget === 'all' ? t('shop.noMatch') : t('shop.filterNoMatch')}</div>
                {hasActiveFilter && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ marginTop: 10 }}
                    onClick={resetFilters}
                  >
                    {t('shop.budget.reset')}
                  </button>
                )}
              </div>
            ) : (
              <motion.div className="shop-grid" variants={stagger} initial="hidden" animate="show">
                {filteredRows.map((b) => (
                  <ShopTile
                    key={b.id}
                    brand={b}
                    open={openBrand?.id === b.id}
                    pinned={favSet.has(brandFavoriteKey(b))}
                    onTogglePin={handleTogglePin}
                    onClick={() => setOpenBrand(b)}
                  />
                ))}
              </motion.div>
            )
          ) : !rows.length ? (
            <div className="empty">
              <span className="empty-icon">🛍</span>
              {t('shop.noneHere', { country: countryName })}
              <div className="shop-alt">
                <button type="button" className="btn btn-ghost" onClick={() => navigate('/swap')}>
                  {t('shop.alt.swap')}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => navigate('/earn')}>
                  {t('shop.alt.earn')}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Best-Sellers / Most Popular Brands Rail (shown when 2+ flagship brands exist in catalogue).
                  When the anonymous regional counter has real heat, the SAME rail is
                  re-ranked and re-labelled as «داغ‌ترین‌های این ریجن» — one rail, one
                  mechanism, no second grid competing with the first. */}
              {tab === 'cards' && featuredBrands.length >= 2 && (
                <section className="shop-featured-section" aria-label={t(trendingHot ? 'shop.trending.title' : 'shop.featured.title')}>
                  <div className="shop-cat-row shop-cat-row--tight">
                    <h2 className="shop-cat-title">
                      {trendingHot && <IconFlame width={15} height={15} className="shop-cat-flame" />}
                      {t(trendingHot ? 'shop.trending.title' : 'shop.featured.title')}
                      <span className="shop-cat-badge" data-hot={trendingHot ? 'true' : 'false'}>
                        {t(trendingHot ? 'shop.trending.badge' : 'shop.featured.badge')}
                      </span>
                    </h2>
                  </div>
                  <motion.div className="shop-rail" variants={stagger} initial="hidden" animate="show">
                    {featuredBrands.map((b) => (
                      <ShopTile
                        key={`feat-${b.id}`}
                        brand={b}
                        open={openBrand?.id === b.id}
                        pinned={favSet.has(brandFavoriteKey(b))}
                        onTogglePin={handleTogglePin}
                        onClick={() => setOpenBrand(b)}
                      />
                    ))}
                  </motion.div>
                </section>
              )}

              {/* Category Previews */}
              {categories.map((c) => {
                const list = rows.filter((r) => inCat(r, c.id));
                if (!list.length) return null;
                return (
                  <section key={c.id}>
                    <div className="shop-cat-row">
                      <h2 className="shop-cat-title">
                        {catLabel(t, c.id)}
                        <span className="shop-cat-count">{list.length}</span>
                      </h2>
                      {list.length > PREVIEW && (
                        <button type="button" className="shop-more" onClick={() => setOpenCat(c.id)}>
                          {t('shop.seeAll', { n: list.length })} <span aria-hidden="true">›</span>
                        </button>
                      )}
                    </div>
                    <motion.div className="shop-rail" variants={stagger} initial="hidden" animate="show">
                      {list.slice(0, PREVIEW).map((b) => (
                        <ShopTile
                          key={b.id}
                          brand={b}
                          open={openBrand?.id === b.id}
                          pinned={favSet.has(brandFavoriteKey(b))}
                          onTogglePin={handleTogglePin}
                          onClick={() => setOpenBrand(b)}
                        />
                      ))}
                    </motion.div>
                  </section>
                );
              })}
            </>
          )}
        </>
      ) : tab === 'topup' ? (
        <>
          <motion.section className="shop-hero" variants={riseIn} initial="hidden" animate="show">
            <div className="shop-hero-title">{t('shop.topup.title')}</div>
            <p className="shop-hero-sub">{t('shop.topup.body')}</p>
            <div className="shop-quick">
              <button type="button" onClick={() => open(topUpUrl(country))}>
                <IconTopUp width={18} height={18} />
                {t('shop.topup.go')}
              </button>
              <button type="button" onClick={() => open(esimUrl())}>
                <IconSim width={18} height={18} />
                {t('shop.esim.name')}
              </button>
            </div>
          </motion.section>

          {(() => {
            const tel = allRows.filter((r) => r.kind === 'mobile_recharge');
            if (!tel.length) return null;
            return (
              <section>
                <div className="shop-cat-row">
                  <h2 className="shop-cat-title">
                    {t('shop.cat.mobile_credits')}
                    <span className="shop-cat-count">{tel.length}</span>
                  </h2>
                </div>
                <motion.div className="shop-grid" variants={stagger} initial="hidden" animate="show">
                  {tel.map((b) => (
                    <ShopTile
                      key={b.id}
                      brand={b}
                      open={openBrand?.id === b.id}
                      pinned={favSet.has(brandFavoriteKey(b))}
                      onTogglePin={handleTogglePin}
                      onClick={() => setOpenBrand(b)}
                    />
                  ))}
                </motion.div>
              </section>
            );
          })()}

          <motion.button
            type="button"
            className="shop-promo shop-glow"
            variants={riseIn}
            initial="hidden"
            animate="show"
            onClick={() => open(esimUrl())}
          >
            <img src={PROMO_IMAGES.persepolis.src} alt="" loading="lazy" />
            <span className="shop-promo-txt">
              <span className="shop-promo-kicker">{t('shop.promo.kicker')}</span>
              <span className="shop-promo-title">{t('shop.esim.desc')}</span>
            </span>
            <span className="shop-promo-credit">
              © {PROMO_IMAGES.persepolis.credit} · {PROMO_IMAGES.persepolis.licence}
            </span>
          </motion.button>
        </>
      ) : tab === 'flights' ? (
        <>
          <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
            <div className="sheen" />
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t('shop.flight.title')}</div>
            <p className="prose-sm" style={{ margin: 0 }}>{t('shop.flight.body')}</p>
          </motion.section>

          <TravelCompanionCard
            t={t}
            open={open}
            onOpenCards={() => {
              haptic?.('select');
              if (country) setTab('money');
              else setPickerOpen(true);
            }}
          />

          <p className="section-label">{t('shop.flight.popular')}</p>
          <motion.div
            className="shop-dest-grid"
            variants={stagger}
            initial="hidden"
            animate="show"
          >
            {FLIGHT_ROUTES.map((r) => (
              <motion.button
                key={r.id}
                type="button"
                className="shop-dest"
                variants={riseIn}
                onClick={() => open(flightUrl(r.slug))}
              >
                <img src={r.img} alt="" loading="lazy" />
                <span className="shop-dest-veil" />
                <span className="shop-dest-txt">
                  <span className="shop-dest-city">
                    {t(`shop.dest.city.${destKey(r.city)}`, { defaultValue: r.city })}
                  </span>
                  <span className="shop-dest-country">
                    {t(`shop.dest.country.${destKey(r.country)}`, { defaultValue: r.country })}
                  </span>
                  <span className="shop-dest-route" dir="ltr">
                    {r.from} <span aria-hidden="true">→</span> {r.to}
                  </span>
                </span>
              </motion.button>
            ))}
          </motion.div>

          <button type="button" className="btn btn-ghost" onClick={() => open(flightUrl(null))}>
            {t('shop.flight.other')}
          </button>
        </>
      ) : tab === 'stays' ? (
        <>
          <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
            <div className="sheen" />
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t('shop.stay.title')}</div>
            <p className="prose-sm" style={{ margin: 0 }}>{t('shop.stay.body')}</p>
          </motion.section>

          <TravelCompanionCard
            t={t}
            open={open}
            onOpenCards={() => {
              haptic?.('select');
              if (country) setTab('money');
              else setPickerOpen(true);
            }}
          />

          <p className="section-label">{t('shop.stay.popular')}</p>
          <motion.div
            className="shop-dest-grid"
            variants={stagger}
            initial="hidden"
            animate="show"
          >
            {STAY_CITIES.map((c) => (
              <motion.button
                key={c.id}
                type="button"
                className="shop-dest"
                variants={riseIn}
                onClick={() => open(stayCityUrl(c.cc, c.slug))}
              >
                <img src={c.img} alt="" loading="lazy" />
                <span className="shop-dest-veil" />
                <span className="shop-dest-txt">
                  <span className="shop-dest-city">
                    {t(`shop.dest.city.${destKey(c.city)}`, { defaultValue: c.city })}
                  </span>
                  <span className="shop-dest-country">
                    {t(`shop.dest.country.${destKey(c.country)}`, { defaultValue: c.country })}
                  </span>
                </span>
              </motion.button>
            ))}
          </motion.div>

          <button type="button" className="btn btn-ghost" onClick={() => open(stayCityUrl(null, null))}>
            {t('shop.stay.other')}
          </button>

          <motion.button
            type="button"
            className="shop-promo shop-glow"
            variants={riseIn}
            initial="hidden"
            animate="show"
            onClick={() => open(esimUrl())}
          >
            <img src={PROMO_IMAGES.persepolis.src} alt="" loading="lazy" />
            <span className="shop-promo-txt">
              <span className="shop-promo-kicker">{t('shop.promo.kicker')}</span>
              <span className="shop-promo-title">{t('shop.esim.name')}</span>
            </span>
            <span className="shop-promo-credit">
              © {PROMO_IMAGES.persepolis.credit} · {PROMO_IMAGES.persepolis.licence}
            </span>
          </motion.button>
        </>
      ) : (
        /* ── TAB 6: FBT Pay Merchant Payment Gateway ── */
        <div className="shop-pay-wrap">
          <motion.section className="shop-hero shop-pay-hero" variants={riseIn} initial="hidden" animate="show">
            <span className="shop-hero-kicker">{t('shop.pay.kicker')}</span>
            <div className="shop-hero-title">{t('shop.pay.heroTitle')}</div>
            <p className="shop-hero-sub">{t('shop.pay.heroSub')}</p>
            <div className="shop-trust-row">
              <span className="shop-trust-pill">◈ {t('shop.pay.badgeDirect')}</span>
              <span className="shop-trust-pill">▣ {t('shop.pay.badgeQr')}</span>
              <span className="shop-trust-pill">⚡ {t('shop.pay.badgeMultiChain')}</span>
            </div>
          </motion.section>

          {/*
            ─── IN-PERSON: THE COUNTER MODE, ONE TAP AWAY ────────────────────
            The invoice link answers "a customer is paying me REMOTELY". The
            shop with a customer standing in front of it needs the other half:
            a code on the counter and the payer's own camera. TapToPay is the
            only component in the app whose QR decodability is pinned by a
            rasterised real-decoder test, it already carries the EIP-681
            amount logic and the arrival watcher, so the gateway's job here is
            the DOOR, not a second invention of the same room.
          */}
          <div className="shop-pay-counter">
            <div className="shop-pay-counter-copy">
              <strong>{t('shop.pay.counterTitle')}</strong>
              <p>{t('shop.pay.counterBody')}</p>
            </div>
            <button
              type="button"
              className="btn btn-primary shop-pay-counter-btn"
              onClick={() => { haptic?.('select'); setCounterOpen(true); }}
            >
              <IconQr width={16} height={16} />
              <span>{t('shop.pay.counterCta')}</span>
            </button>
          </div>

          <Suspense fallback={null}>
            <Sheet open={counterOpen} onClose={() => setCounterOpen(false)} title={t('shop.pay.counterTitle')}>
              <TapToPay />
            </Sheet>
          </Suspense>

          {/*
            WHITELABEL READINESS — renders ONLY when the server says the
            in-app order path is actually configured. Until then this is
            literally nothing on screen (not a disabled button, not a
            "coming soon" strip): every sale goes through the partner link
            with our id, which works TODAY. The moment the key is set, this
            sentence appears with no redeploy, because the endpoint is the
            switch.
          */}
          {readiness?.whitelabelConfigured === true && (
            <p className="shop-pay-ready" data-testid="shop-whitelabel-ready">✓ {t('shop.pay.wlReady')}</p>
          )}

          <div className="shop-pay-panel-host">
            <Suspense fallback={<div className="skel" style={{ height: 220, borderRadius: 20 }} />}>
              <PayGatewayPanel />
            </Suspense>
          </div>
        </div>
      )}

      {brandSheet}

      <ShareSheet {...shareSheet} />

      <ShopWeb3IdCard />

      <HardwareWalletCard />

      <ShopCountrySheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        countries={countries}
        value={country}
        onPick={pickCountry}
      />

      <LimitsBox />

      <p className="faint" style={{ marginTop: 4, lineHeight: 1.75 }}>
        {shopEarns() ? t('shop.earning') : t('shop.noEarn')}
      </p>
    </PageTransition>
  );
}
