import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import Sheet from '../components/Sheet';
import ShopCountrySheet from '../components/ShopCountrySheet';
import ShopTile from '../components/ShopTile';
import SegIndicator from '../components/SegIndicator';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronLeft, IconSearch } from '../components/Icons';
import {
  fetchShopCatalogue,
  fetchShopCountries,
  fetchShopProducts,
  getShopCountry,
  setShopCountry
} from '../lib/shop';
import { brandUrl, esimUrl, flightUrl, shopEarns, stayCityUrl } from '../lib/shopLinks';
import { FLIGHT_ROUTES, STAY_CITIES, flagOf } from '../lib/shopDestinations';

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

const TABS = ['cards', 'flights', 'stays'];

/*
 * Category order. The API sorts by count, which buries the interesting ones —
 * `e-money` (PayPal, Visa, Payz top-ups) is the single most useful category
 * for someone holding crypto and no bank, and by raw count it sits near the
 * bottom.
 */
const PRIORITY = ['e-money', 'e-commerce', 'games', 'streaming', 'food', 'groceries', 'retail', 'entertainment'];

/** How many brands a category shows before "see all". */
const PREVIEW = 6;

function catLabel(t, id) {
  const key = `shop.cat.${id}`;
  const s = t(key);
  return s === key ? String(id).replace(/[_-]/g, ' ') : s;
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

  const open = useCallback(
    (url) => {
      if (!url) return;
      haptic?.('light');
      if (tg?.openLink) tg.openLink(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
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

  const rows = data?.rows ?? [];

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

      {/* The issuer's own redemption note — Steam's says region-locked, VPN
          will not work, no refunds. Passed through verbatim; it is the single
          most useful sentence available and it is not ours to summarise. */}
      {products?.note && <p className="notice" style={{ marginTop: 12 }}>{products.note}</p>}

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
        <InfoBox title={t('shop.limits.title')} tone="info" id="shop-limits">
          <p>{t('shop.limits.body')}</p>
        </InfoBox>
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
        <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
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

      <div className="segmented">
        {TABS.map((k) => (
          <button
            key={k}
            className={tab === k ? 'active' : ''}
            onClick={() => {
              setTab(k);
              setOpenBrand(null);
            }}
            style={{ isolation: 'isolate' }}
          >
            {tab === k && <SegIndicator id="shoptab" />}
            {t(`shop.tab.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'cards' ? (
        <>
          <div className="row" style={{ gap: 8 }}>
            <span className="icon-btn" style={{ pointerEvents: 'none' }}>
              <IconSearch width={16} height={16} />
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('shop.search', { country: countryName })}
              style={{ flex: 1 }}
            />
          </div>

          {loading && !data ? (
            <div className="stack" style={{ gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skel" style={{ height: 210, borderRadius: 18 }} />
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
              <motion.div className="stack" style={{ gap: 12 }} variants={stagger} initial="hidden" animate="show">
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
                ─── A PICTURE ADVERT, NOT A LINE OF TEXT ───────────────────
                Asked for: «تبلیغات ... با عکس نه اینکه فقط نوشتاری باشه».
                Uses a real destination photograph from the provider's CDN
                rather than an emoji in a gradient box.
              */}
              <motion.button
                className="shop-promo shop-glow"
                variants={riseIn}
                initial="hidden"
                animate="show"
                onClick={() => setTab('flights')}
              >
                <img src={FLIGHT_ROUTES[1].img} alt="" loading="lazy" />
                <span className="shop-promo-txt">
                  <span className="shop-promo-kicker">{t('shop.promo.kicker')}</span>
                  <span className="shop-promo-title">{t('shop.promo.flights')}</span>
                </span>
              </motion.button>

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
                    <div className="shop-cat-row">
                      <p className="section-label" style={{ margin: 0 }}>{catLabel(t, c.id)}</p>
                      {list.length > PREVIEW && (
                        <button className="shop-more" onClick={() => setOpenCat(c.id)}>
                          {t('shop.seeAll', { n: list.length })}
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
            <img src={STAY_CITIES[0].img} alt="" loading="lazy" />
            <span className="shop-promo-txt">
              <span className="shop-promo-kicker">{t('shop.promo.kicker')}</span>
              <span className="shop-promo-title">{t('shop.esim.name')}</span>
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

      <InfoBox title={t('shop.limits.title')} tone="info" id="shop-limits">
        <p>{t('shop.limits.body')}</p>
      </InfoBox>

      <p className="faint" style={{ marginTop: 4, lineHeight: 1.75 }}>
        {shopEarns() ? t('shop.earning') : t('shop.noEarn')}
      </p>
    </PageTransition>
  );
}
