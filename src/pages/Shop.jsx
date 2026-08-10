import { useCallback, useEffect, useMemo, useState } from 'react';
/* The shop is a lazy route; keep its visual layer out of the first paint. */
import '../styles/shop-modern.css';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Sheet from '../components/Sheet';
import ShopCountrySheet from '../components/ShopCountrySheet';
import ShopTile from '../components/ShopTile';
import ShopPromo from '../components/ShopPromo';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronLeft, IconSearch } from '../components/Icons';
import {
  fetchShopCatalogue,
  fetchShopCountries,
  fetchShopProducts,
  getShopCountry,
  setShopCountry
} from '../lib/shop';
import { brandUrl, countryUrl, esimUrl, flightUrl, shopEarns, stayCityUrl, topUpUrl } from '../lib/shopLinks';
import { IconBed, IconCard, IconMoney, IconPlane, IconSim, IconTopUp } from '../components/ShopIcons';
import { openUrl } from '../lib/browser';
import { FLIGHT_ROUTES, STAY_CITIES, flagOf } from '../lib/shopDestinations';
import { PROMO_IMAGES, PROMO_SLIDES } from '../lib/shopImages';

/**
 * SHOP — spend crypto on real things.
 * ---------------------------------------------------------------------------
 * Second version. The first shipped as a list of 34px logos with 12px labels,
 * a native <select> holding 233 countries, and a flat row of category tags.
 * The owner's review was blunt and every point of it was right:
 *
 *   «خیلی کوچیکه عکس ها را بگتر کن»            — everything too small
 *   «انتخاب کشورها حالت کشویی زشته»            — the dropdown is ugly
 *   «هر کتگوری چندتا ... و بیشتر بره به صفحه ان دسته»  — category previews
 *   «هر خط یک عکس و زیرش خیلی کوچک نباشه»      — one image per row
 *   «تبلیغات ... با عکس نه اینکه فقط نوشتاری باشه»     — picture adverts
 *   «برای هتل و بلیط ... وارد صفحه سایت میشه که همون ها را انتخاب کنی»
 *
 * ─── THE FLIGHT FORM WAS THE WORST OF IT, AND HE DIAGNOSED IT EXACTLY ───────
 * You filled in origin, destination and dates here, and then landed on their
 * site and had to fill in the same thing again. I built that, and it deserved
 * the criticism.
 *
 * The cause is real: flights and stays are NOT in the REST API — their own
 * developer reference says "Not covered here: Flights, Stays" — and their date
 * pickers are React components that do not hydrate from query parameters, so
 * `?departure_date=` genuinely does nothing.
 *
 * His own alternative is the right answer: «اگر نمیتونی بیاری بهترین های مقصد
 * و مبدا را بزار». Real routes and cities, real photographs, one tap. What
 * DOES survive into their page is the PATH — verified live that
 * /en/flights/new_york-to-london opens with JFK and LHR already selected, and
 * /en/stays/ae/dubai opens on Dubai. So a tap lands somewhere already
 * narrowed, with nothing to retype.
 */

/*
 * Five tabs, each with an icon. `topup` and `esim` were buried — top-up was
 * reachable only if a country happened to list a telecom brand, and eSIM was
 * a single row at the bottom of Stays. Both are their own product on the
 * provider's site and both are things a crypto holder actually buys.
 */
const TABS = [
  { id: 'cards', Icon: IconCard },
  { id: 'money', Icon: IconMoney },
  { id: 'topup', Icon: IconTopUp },
  { id: 'flights', Icon: IconPlane },
  { id: 'stays', Icon: IconBed }
];

/*
 * Category order. The API sorts by count, which buries the interesting ones —
 * `e-money` (PayPal, Visa, Payz top-ups) is the single most useful category
 * for someone holding crypto and no bank, and by raw count it sits near the
 * bottom.
 */
const PRIORITY = ['e-money', 'e-commerce', 'games', 'streaming', 'food', 'groceries', 'retail', 'entertainment'];

/** How many brands a category shows before "see all". */
const PREVIEW = 4;

/*
 * Promo slides now live in lib/shopImages.js with their photographer credits.
 * The provider's own destination pictures are only 200px wide — there is no
 * larger variant, I checked — so on a full-width banner they were upscaled
 * roughly six times, which is what made them look washed out. These are
 * 1280px Iranian landmarks from Wikimedia instead.
 */

function catLabel(t, id) {
  const key = `shop.cat.${id}`;
  const s = t(key);
  return s === key ? String(id).replace(/[_-]/g, ' ') : s;
}

/**
 * The restrictions, as a folded list rather than one long paragraph.
 *
 * Asked for: «محدودیت ها را با باز شونده بنویس کاملتر کن» — fuller, and in a
 * collapsible. Five separate facts read far better than one block: the
 * country list, the region lock, refunds, delivery, and who actually takes
 * the money. Each is one line, which is the only way anybody reads them.
 */
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

export default function Shop() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();

  const [tab, setTab] = useState('cards');
  const [country, setCountry] = useState(() => getShopCountry());
  const [countries, setCountries] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  /* null = the category overview; a string = that category's own page. */
  const [openCat, setOpenCat] = useState(null);
  const [query, setQuery] = useState('');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const [openBrand, setOpenBrand] = useState(null);
  const [products, setProducts] = useState(null);
  const [productsLoading, setProductsLoading] = useState(false);

  /*
   * ─── OPEN INSIDE THE APP ────────────────────────────────────────────────
   * Asked for: «امکان داره در خود اپ باز شه بهتره بخصوص در اپ».
   *
   * `openUrl` was already in the codebase and this screen simply was not
   * using it — every shop link went out through window.open and kicked the
   * user into Chrome, losing the app. It opens an Android Custom Tab instead:
   * the system browser rendering inside our task, so the back gesture returns
   * here and the toolbar picks up our colour.
   *
   * Deliberately NOT an embedded WebView. See lib/browser.js — a window we
   * draw ourselves means we choose what the URL bar says, and on a checkout
   * page that is exactly the guarantee the user needs us not to control.
   */
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

  /* Ask on first visit rather than defaulting to a country that is probably
     wrong — a card bought for the wrong one is usually unrefundable. */
  useEffect(() => {
    if (!country) setPickerOpen(true);
  }, [country]);

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

  useEffect(() => {
    if (!openBrand || !country) return undefined;
    let alive = true;
    setProducts(null);
    setProductsLoading(true);
    fetchShopProducts(country, openBrand.family)
      .then((d) => alive && setProducts(d))
      .finally(() => alive && setProductsLoading(false));
    return () => {
      alive = false;
    };
  }, [openBrand, country]);

  /*
   * The `money` tab is the same catalogue narrowed to PayPal, Visa and Payz
   * top-ups. It is a TAB rather than one category among thirty because for
   * somebody holding crypto and no bank account it is the single most useful
   * thing here, and buried in a rail it was invisible.
   */
  const allRows = data?.rows ?? [];
  const rows = useMemo(
    () => (tab === 'money'
      ? allRows.filter((r) => r.category === 'e-money' || r.tags.includes('e-money'))
      : allRows),
    [allRows, tab]
  );

  const categories = useMemo(() => {
    const cs = data?.categories ?? [];
    const first = PRIORITY.map((id) => cs.find((c) => c.id === id)).filter(Boolean);
    return [...first, ...cs.filter((c) => !PRIORITY.includes(c.id))];
  }, [data]);

  const inCat = useCallback(
    (r, id) => r.category === id || r.tags.includes(id),
    []
  );

  /* Search matches name AND tags, so "paypal" finds the Rewarble cards and
     "gaming" finds Steam even though neither word is in the other's name. */
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return rows.filter((r) => `${r.name} ${r.category} ${r.tags.join(' ')}`.toLowerCase().includes(q));
  }, [rows, query]);

  const catRows = useMemo(
    () => (openCat ? rows.filter((r) => inCat(r, openCat)) : []),
    [rows, openCat, inCat]
  );

  const pickCountry = (cc) => {
    haptic?.('select');
    setShopCountry(cc);
    setCountry(cc);
    setOpenBrand(null);
    setQuery('');
    setPickerOpen(false);
  };

  const countryName = countries.find((c) => c.code === country)?.name ?? country;

  const header = (
    <motion.div className="row-between" variants={riseIn} initial="hidden" animate="show">
      <div className="row" style={{ gap: 10 }}>
        <button
          className="icon-btn"
          onClick={() => {
            /* Inside a category, back means "back to the shop", not "leave". */
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
          <p className="prose-sm">{openCat ? countryName : t('shop.subtitle')}</p>
        </div>
      </div>
      {country && (
        <button className="chip" onClick={() => setPickerOpen(true)}>
          <span aria-hidden="true">{flagOf(country)}</span> {country}
        </button>
      )}
    </motion.div>
  );

  const brandSheet = (
    <Sheet open={Boolean(openBrand)} onClose={() => setOpenBrand(null)} title={openBrand?.name ?? ''}>
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
            {products.rows.map((p) => (
              <div key={p.id} className="shop-denom">
                <div className="shop-denom-face">{p.label}</div>
                <div className="shop-denom-coin">
                  {p.coinAmount ? `${p.coinAmount} ${p.coin}` : '—'}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/*
        The issuer's own words, in two boxes.

        `whiteSpace: 'pre-line'` is load-bearing: the server turns their HTML
        into text with real line breaks, and without this React collapses them
        and the redemption steps run into one paragraph. That was the shape of
        the reported bug — the tags were visible AND the structure was lost.

        Redemption steps are collapsed by default because they matter after
        you buy; the warning note is not, because it changes whether you buy
        at all.
      */}
      {products?.note && (
        <p className="notice" style={{ marginTop: 12, whiteSpace: 'pre-line' }}>{products.note}</p>
      )}

      {products?.howTo && (
        <div style={{ marginTop: 10 }}>
          <InfoBox title={t('shop.howTo')} tone="info" id="shop-howto">
            <p style={{ whiteSpace: 'pre-line' }}>{products.howTo}</p>
          </InfoBox>
        </div>
      )}

      {openBrand && (
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={() => open(brandUrl(country, openBrand.family))}
        >
          {t('shop.buyAt', { brand: openBrand.name })}
        </button>
      )}
    </Sheet>
  );

  /* ── no country yet: the picker is the screen ───────────────────────────── */
  if (!country) {
    return (
      <PageTransition>
        {header}
        <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
          <div className="sheen" />
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 5 }}>{t('shop.pickCountry')}</div>
          <p className="prose-sm" style={{ margin: 0 }}>{t('shop.pickCountryWhy')}</p>
        </motion.section>
        <button className="btn btn-primary" onClick={() => setPickerOpen(true)}>
          {t('shop.chooseOne')}
        </button>
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

  /* ── one category, full page ────────────────────────────────────────────── */
  if (openCat) {
    return (
      <PageTransition>
        {header}
        <p className="faint" style={{ fontSize: 11.5 }}>
          {t('shop.count', { n: catRows.length, country: countryName })}
        </p>
        <motion.div className="shop-grid" variants={stagger} initial="hidden" animate="show">
          {catRows.map((b) => (
            <ShopTile key={b.id} brand={b} open={openBrand?.id === b.id} onClick={() => setOpenBrand(b)} />
          ))}
        </motion.div>
        {brandSheet}
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      {header}

      {/* A modern storefront opens with merchandise, not navigation chrome.
          The visual campaign sits above categories like current mobile retail
          apps; the first useful product is visible before any explanatory
          card. */}
      {(tab === 'cards' || tab === 'money') && (
        <ShopPromo slides={PROMO_SLIDES} onSlide={(sl) => setTab(sl.go)} />
      )}

      <div className="shop-tabs" role="tablist" aria-label={t('shop.title')}>
        {TABS.map(({ id, Icon }) => (
          <button
            key={id}
            className="shop-tab"
            data-on={tab === id}
            onClick={() => {
              haptic?.('select');
              setTab(id);
              setOpenBrand(null);
              setOpenCat(null);
            }}
          >
            <Icon width={17} height={17} />
            {t(`shop.tab.${id}`)}
          </button>
        ))}
      </div>

      {tab === 'cards' || tab === 'money' ? (
        <>
          {/*
            A storefront needs a front. The two shortcuts here are the things
            that are NOT gift-card categories — the provider's full catalogue
            for this country, and mobile top-up, which is a sibling section on
            their site rather than a category inside gift cards.
          */}
          <motion.section className="shop-hero" variants={riseIn} initial="hidden" animate="show">
            <span className="shop-hero-kicker">{t('shop.heroKicker')}</span>
            <div className="shop-hero-title">{t('shop.heroTitle', { country: countryName })}</div>
            <p className="shop-hero-sub">{t('shop.heroSub')}</p>
            <div className="shop-trust-row">
              <span>⚡ {t('shop.trust.fast')}</span>
              <span>◈ {t('shop.trust.crypto')}</span>
              <span>✉ {t('shop.trust.email')}</span>
            </div>
            <div className="shop-quick">
              <button onClick={() => open(countryUrl(country))}>
                <IconCard width={18} height={18} />
                {t('shop.quickAll')}
              </button>
              <button onClick={() => open(topUpUrl(country))}>
                <IconTopUp width={18} height={18} />
                {t('shop.quickTopUp')}
              </button>
            </div>
          </motion.section>

          <label className="shop-search">
            <IconSearch width={18} height={18} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('shop.search', { country: countryName })}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label={t('shop.clear')}>×</button>
            )}
          </label>

          {loading && !data ? (
            /* A skeleton shaped like the tile it becomes, so the page does
               not jump when the catalogue lands. */
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
          ) : searched ? (
            /* Searching flattens the categories — someone typing wants the
               match, not a tour of the sections it might be in. */
            !searched.length ? (
              <div className="empty">
                <span className="empty-icon">🛍</span>
                {t('shop.noMatch')}
              </div>
            ) : (
              <motion.div className="shop-grid" variants={stagger} initial="hidden" animate="show">
                {searched.map((b) => (
                  <ShopTile key={b.id} brand={b} open={openBrand?.id === b.id} onClick={() => setOpenBrand(b)} />
                ))}
              </motion.div>
            )
          ) : !rows.length ? (
            <div className="empty">
              <span className="empty-icon">🛍</span>
              {t('shop.noneHere', { country: countryName })}
            </div>
          ) : (
            <>
              {/*
                ─── CATEGORY PREVIEWS ───────────────────────────────────────
                «هر کتگوری چندتا به صورت ورتیکال باشد و بیشتر بره به صفحه ان
                دسته» — a few per category, and "more" opens that category.
              */}
              {categories.map((c) => {
                const list = rows.filter((r) => inCat(r, c.id));
                if (!list.length) return null;
                return (
                  <section key={c.id}>
                    {/*
                      «برای هر کتگوری پر رنگ تر باشه عنوانش» — these were 11px
                      grey uppercase labels that disappeared between the rails.
                      Now 16px at full contrast with an accent bar, so the eye
                      finds the section boundary while scrolling past.
                    */}
                    <div className="shop-cat-row">
                      <h2 className="shop-cat-title">
                        {catLabel(t, c.id)}
                        <span className="shop-cat-count">{list.length}</span>
                      </h2>
                      {list.length > PREVIEW && (
                        <button className="shop-more" onClick={() => setOpenCat(c.id)}>
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
          {/*
            Mobile top-up and eSIM. Both are separate products on the
            provider's site, not gift-card categories, so neither could be
            reached from the catalogue rails — top-up only appeared if a
            country happened to list a telecom brand, and eSIM was one row at
            the bottom of Stays.
          */}
          <motion.section className="shop-hero" variants={riseIn} initial="hidden" animate="show">
            <div className="shop-hero-title">{t('shop.topup.title')}</div>
            <p className="shop-hero-sub">{t('shop.topup.body')}</p>
            <div className="shop-quick">
              <button onClick={() => open(topUpUrl(country))}>
                <IconTopUp width={18} height={18} />
                {t('shop.topup.go')}
              </button>
              <button onClick={() => open(esimUrl())}>
                <IconSim width={18} height={18} />
                {t('shop.esim.name')}
              </button>
            </div>
          </motion.section>

          {/* Any telecom brands the country's own catalogue carries. */}
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
                <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
                  {tel.map((b) => (
                    <ShopTile key={b.id} brand={b} open={openBrand?.id === b.id} onClick={() => setOpenBrand(b)} />
                  ))}
                </motion.div>
              </section>
            );
          })()}

          <motion.button
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

          <p className="section-label">{t('shop.flight.popular')}</p>
          {/*
            Two columns of photographs instead of a form. Each one lands on a
            page where the route is already chosen — the thing the form failed
            to do.
          */}
          <motion.div
            className="stack"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}
            variants={stagger}
            initial="hidden"
            animate="show"
          >
            {FLIGHT_ROUTES.map((r) => (
              <motion.button
                key={r.id}
                className="shop-dest"
                variants={riseIn}
                onClick={() => open(flightUrl(r.slug))}
              >
                <img src={r.img} alt="" loading="lazy" />
                <span className="shop-dest-veil" />
                <span className="shop-dest-txt">
                  <span className="shop-dest-city">{r.city}</span>
                  <span className="shop-dest-country">{r.country}</span>
                  <span className="shop-dest-route">
                    {r.from} <span aria-hidden="true">→</span> {r.to}
                  </span>
                </span>
              </motion.button>
            ))}
          </motion.div>

          <button className="btn btn-ghost" onClick={() => open(flightUrl(null))}>
            {t('shop.flight.other')}
          </button>
        </>
      ) : (
        <>
          <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
            <div className="sheen" />
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t('shop.stay.title')}</div>
            <p className="prose-sm" style={{ margin: 0 }}>{t('shop.stay.body')}</p>
          </motion.section>

          <p className="section-label">{t('shop.stay.popular')}</p>
          <motion.div
            className="stack"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}
            variants={stagger}
            initial="hidden"
            animate="show"
          >
            {STAY_CITIES.map((c) => (
              <motion.button
                key={c.id}
                className="shop-dest"
                variants={riseIn}
                onClick={() => open(stayCityUrl(c.cc, c.slug))}
              >
                <img src={c.img} alt="" loading="lazy" />
                <span className="shop-dest-veil" />
                <span className="shop-dest-txt">
                  <span className="shop-dest-city">{c.city}</span>
                  <span className="shop-dest-country">{c.country}</span>
                </span>
              </motion.button>
            ))}
          </motion.div>

          <button className="btn btn-ghost" onClick={() => open(stayCityUrl(null, null))}>
            {t('shop.stay.other')}
          </button>

          <motion.button
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
      )}

      {brandSheet}

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
