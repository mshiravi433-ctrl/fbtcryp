import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn, stagger } from '../components/PageTransition';
import InfoBox from '../components/InfoBox';
import AdBanner from '../components/AdBanner';
import SegIndicator from '../components/SegIndicator';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronLeft, IconExternal, IconSearch } from '../components/Icons';
import {
  fetchShopCatalogue,
  fetchShopCountries,
  fetchShopProducts,
  getShopCountry,
  setShopCountry
} from '../lib/shop';
import { brandUrl, esimUrl, flightUrl, shopEarns, stayUrl } from '../lib/shopLinks';

/**
 * SHOP — spend crypto on real things.
 * ---------------------------------------------------------------------------
 * Gift cards, PayPal and Visa top-ups, mobile credit, eSIMs, flights and
 * stays. Paid in stablecoins, delivered by Cryptorefills.
 *
 * ─── THE ONE DECISION EVERYTHING ELSE FOLLOWS: COUNTRY FIRST ────────────────
 * The catalogue is completely different per country — Turkey has Getir and
 * Hepsiburada, the UAE has Noon and Lulu — and a gift card bought for the
 * wrong country is often unredeemable with NO REFUND. Steam say so in their
 * own product note: region-locked, VPN will not help.
 *
 * So the screen asks once and remembers. It does not guess from the browser
 * locale (a Persian phone in Dubai wants the UAE catalogue) and it does not
 * guess from IP (most of this audience is on a VPN). Getting this wrong costs
 * the user real money, which is why it is a question and not an inference.
 *
 * ─── WHY THE FLIGHT FORM DOES NOT SHOW FARES ────────────────────────────────
 * Checked before building: the provider's developer reference lists what the
 * REST API covers — gift cards, top-ups, eSIMs — and then says plainly "Not
 * covered here: Flights, Stays". There is no endpoint that returns fares.
 *
 * Inventing a results list would be the worst possible version of this
 * feature. What their site DOES accept is a route in the URL path — verified
 * live, /en/flights/new_york-to-london opens with JFK and LHR already
 * selected — so the form collects the tedious part and hands over a prefilled
 * search. That is honest and it is genuinely faster than starting cold.
 */

/*
 * Tabs. Gift cards first because it is the deepest catalogue and the thing
 * most people came for; travel second because it is the highest value per
 * order; eSIM last because it is narrow.
 */
const TABS = ['cards', 'flights', 'stays'];

/*
 * ─── A CURATED CATEGORY ORDER, ON TOP OF WHATEVER THE COUNTRY RETURNS ───────
 * The API's own category ordering is by count, which buries the interesting
 * ones. `e-money` — PayPal, Visa, Payz top-ups — is the single most useful
 * category for someone holding crypto and no bank, and by raw count it sits
 * near the bottom. These are pulled to the front when present; everything
 * else keeps the data-driven order behind them.
 */
const PRIORITY = ['e-money', 'e-commerce', 'games', 'streaming', 'food', 'groceries', 'retail'];

/** Localised label if we have one, otherwise the raw id, tidied. */
function catLabel(t, id) {
  const key = `shop.cat.${id}`;
  const s = t(key);
  return s === key ? id.replace(/[_-]/g, ' ') : s;
}

/** yyyy-mm-dd for an <input type="date">, n days from today. */
function isoDay(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export default function Shop() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();

  const [tab, setTab] = useState('cards');
  const [country, setCountry] = useState(() => getShopCountry());
  const [countries, setCountries] = useState([]);

  const [cat, setCat] = useState(null);
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  /* The opened brand, and its denominations. */
  const [openBrand, setOpenBrand] = useState(null);
  const [products, setProducts] = useState(null);
  const [productsLoading, setProductsLoading] = useState(false);

  /* Flight form. Defaults a week out so the date is never in the past. */
  const [trip, setTrip] = useState({
    from: '',
    to: '',
    depart: isoDay(7),
    ret: isoDay(14),
    adults: 1,
    cabin: 'economy',
    round: true,
    direct: false
  });
  /* Stay form. */
  const [stay, setStay] = useState({ city: '', checkIn: isoDay(7), checkOut: isoDay(10), guests: 2 });

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

  useEffect(() => {
    if (!country) return undefined;
    let alive = true;
    setLoading(true);
    setCat(null);
    fetchShopCatalogue(country)
      .then((d) => alive && setData(d))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [country]);

  /* Load denominations when a brand is opened. */
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
   * Categories, priority ones first. Built from what the country actually
   * returned — a hard-coded menu would offer "groceries" in a country with no
   * grocery brand and render an empty filter.
   */
  const categories = useMemo(() => {
    const rows = data?.categories ?? [];
    const inPriority = PRIORITY.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
    const rest = rows.filter((r) => !PRIORITY.includes(r.id));
    return [...inPriority, ...rest];
  }, [data]);

  /*
   * Search and filter.
   *
   * Matches the brand name AND its category tags, so "paypal" finds the
   * Rewarble PayPal cards and "gaming" finds Steam even though neither word is
   * in the other's name. Case- and space-insensitive because people type
   * "app store" for "App Store & iTunes".
   */
  const shown = useMemo(() => {
    let rows = data?.rows ?? [];
    if (cat) rows = rows.filter((r) => r.category === cat || r.tags.includes(cat));
    const q = query.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const hay = `${r.name} ${r.category} ${r.tags.join(' ')}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return rows;
  }, [data, cat, query]);

  const pickCountry = (cc) => {
    haptic?.('select');
    setShopCountry(cc);
    setCountry(cc);
    setOpenBrand(null);
  };

  /* ─── COUNTRY PICKER — the whole screen until it is answered ───────────── */
  if (!country) {
    return (
      <PageTransition>
        <motion.div className="row-between" variants={riseIn} initial="hidden" animate="show">
          <div className="row" style={{ gap: 10 }}>
            <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
              <IconChevronLeft width={18} height={18} />
            </button>
            <div>
              <h1 className="h1" style={{ fontSize: 19 }}>{t('shop.title')}</h1>
              <p className="prose-sm">{t('shop.subtitle')}</p>
            </div>
          </div>
        </motion.div>

        <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
          <div className="sheen" />
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 5 }}>{t('shop.pickCountry')}</div>
          <p className="prose-sm" style={{ margin: 0 }}>{t('shop.pickCountryWhy')}</p>
        </motion.section>

        {/*
          A plain <select>. `select` is styled globally in index.css, and a
          custom dropdown for 233 options on a phone would be worse than the
          native one in every way that matters — search, scroll momentum,
          accessibility.
        */}
        <div className="stack" style={{ gap: 9 }}>
          <select
            defaultValue=""
            onChange={(e) => e.target.value && pickCountry(e.target.value)}
            aria-label={t('shop.pickCountry')}
          >
            <option value="" disabled>{t('shop.chooseOne')}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
          {!countries.length && <div className="skel" style={{ height: 44 }} />}
        </div>

        {/*
          ─── WHERE THIS DOES NOT WORK, IN A BOX ─────────────────────────────
          Asked for: «یک صفحه باز شونده بزار برای محدودیت های کاربران زیاد
          توضیحات ننویس و هشدار ننویس» — a collapsible for the restrictions,
          and do not write a lot of explanation or warnings.

          So it is one folded box with a short factual list, not a wall of
          text. It exists because Iran genuinely is absent from the provider's
          233-country list, and an Iranian user who taps through to an empty
          catalogue would reasonably think the app is broken.
        */}
        <InfoBox title={t('shop.limits.title')} tone="info" id="shop-limits">
          <p>{t('shop.limits.body')}</p>
        </InfoBox>
      </PageTransition>
    );
  }

  const countryName = countries.find((c) => c.code === country)?.name ?? country;

  return (
    <PageTransition>
      <motion.div className="row-between" variants={riseIn} initial="hidden" animate="show">
        <div className="row" style={{ gap: 10 }}>
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <IconChevronLeft width={18} height={18} />
          </button>
          <div>
            <h1 className="h1" style={{ fontSize: 19 }}>{t('shop.title')}</h1>
            <p className="prose-sm">{t('shop.subtitle')}</p>
          </div>
        </div>
        {/* Country is always visible and always one tap from changing, because
            it silently determines everything below it. */}
        <button
          className="chip"
          onClick={() => {
            haptic?.('select');
            setCountry(null);
            setOpenBrand(null);
          }}
        >
          {country}
        </button>
      </motion.div>

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
          {/* ── search ── */}
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

          {/* ── category filter ── */}
          {categories.length > 0 && (
            <div className="tag-scroll">
              <button className={`tag ${cat === null ? 'active' : ''}`} onClick={() => setCat(null)}>
                {t('shop.all')}
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  className={`tag ${cat === c.id ? 'active' : ''}`}
                  onClick={() => setCat(cat === c.id ? null : c.id)}
                >
                  {catLabel(t, c.id)}
                </button>
              ))}
            </div>
          )}

          {loading && !data ? (
            <div className="stack" style={{ gap: 9 }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="skel" style={{ height: 58 }} />
              ))}
            </div>
          ) : !data?.live ? (
            <p className="notice">{t('shop.unavailable')}</p>
          ) : !shown.length ? (
            <div className="empty">
              <span className="empty-icon">🛍</span>
              {query || cat ? t('shop.noMatch') : t('shop.noneHere', { country: countryName })}
            </div>
          ) : (
            <>
              <p className="faint" style={{ fontSize: 11.5 }}>
                {t('shop.count', { n: shown.length, country: countryName })}
              </p>
              <motion.div
                className="stack"
                style={{ gap: 8 }}
                variants={stagger}
                initial="hidden"
                animate="show"
              >
                {shown.map((b) => (
                  <motion.button
                    key={b.id}
                    className="coin-row"
                    variants={riseIn}
                    onClick={() => {
                      haptic?.('select');
                      setOpenBrand(openBrand?.id === b.id ? null : b);
                    }}
                    style={{ width: '100%', textAlign: 'start', opacity: b.outOfStock ? 0.55 : 1 }}
                  >
                    {/*
                      Brand logos come from the provider's CDN and are
                      validated server-side to that host. `onError` hides a
                      broken image rather than leaving the browser's grey
                      placeholder, which reads as an app bug.
                    */}
                    {b.logo ? (
                      <img
                        src={b.logo}
                        alt=""
                        width={34}
                        height={34}
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                        style={{
                          borderRadius: 9,
                          objectFit: 'contain',
                          background: b.bg || 'var(--bg-raised)',
                          flexShrink: 0
                        }}
                      />
                    ) : (
                      <span className="wallet-badge" style={{ fontSize: 12, flexShrink: 0 }}>
                        {b.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <div className="coin-meta">
                      <div className="coin-sym">{b.name}</div>
                      <div className="coin-name">
                        {b.min && b.max ? `${b.min} – ${b.max}` : catLabel(t, b.category)}
                      </div>
                    </div>
                    <div className="coin-right">
                      {b.outOfStock ? (
                        <span className="pill pill-down" style={{ fontSize: 10 }}>{t('shop.outOfStock')}</span>
                      ) : (
                        <span className="pill pill-neutral" style={{ fontSize: 10 }}>
                          {catLabel(t, b.category)}
                        </span>
                      )}
                    </div>
                  </motion.button>
                ))}
              </motion.div>
            </>
          )}

          {/*
            ─── THE OPENED BRAND ────────────────────────────────────────────
            Denominations with the REAL stablecoin cost next to the face
            value. A $50 Steam card costs $53.86 in USDC — that spread is how
            the provider and we get paid, and hiding it until checkout would
            be the dishonest choice.
          */}
          {openBrand && (
            <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
              <div className="row-between" style={{ marginBottom: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 13.5 }}>{openBrand.name}</span>
                <button className="btn btn-sm btn-ghost" style={{ width: 'auto' }} onClick={() => setOpenBrand(null)}>
                  {t('common.close')}
                </button>
              </div>

              {productsLoading ? (
                <div className="stack" style={{ gap: 8 }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="skel" style={{ height: 38 }} />
                  ))}
                </div>
              ) : !products?.rows?.length ? (
                <p className="faint">{t('shop.noDenoms')}</p>
              ) : (
                <div className="stack" style={{ gap: 7 }}>
                  {products.rows.map((p) => (
                    <div key={p.id} className="row-between farm-calc">
                      <span style={{ fontWeight: 700, fontSize: 12.8 }}>{p.label}</span>
                      <span className="mono faint" style={{ fontSize: 11.5 }}>
                        {p.coinAmount ? `${p.coinAmount} ${p.coin}` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/*
                The issuer's own redemption note. Steam's says region-locked,
                VPN will not work, no refunds — the single most useful
                sentence on the page, so it is passed through verbatim rather
                than summarised by us.
              */}
              {products?.note && (
                <p className="notice" style={{ marginTop: 10 }}>{products.note}</p>
              )}

              <button
                className="btn btn-primary"
                style={{ marginTop: 11 }}
                onClick={() => open(brandUrl(country, openBrand.family))}
              >
                {t('shop.buyAt', { brand: openBrand.name })}
              </button>
            </motion.section>
          )}

          <AdBanner slot="swap" />
        </>
      ) : tab === 'flights' ? (
        <>
          {/*
            ─── ORIGIN, DESTINATION, DATE — the form that was asked for ─────
            «برای بلیط ها امکان مبدا و مقصد و تاریخ باشد».

            City names rather than IATA codes, because that is what the
            provider's own URLs use (`new_york-to-london`) and what people
            know. The route is what survives reliably into their search page;
            the dates are passed too and are a bonus if their picker reads
            them.
          */}
          <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
            <div className="sheen" />
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t('shop.flight.title')}</div>
            <p className="prose-sm" style={{ margin: 0 }}>{t('shop.flight.body')}</p>
          </motion.section>

          <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
            <div className="stack" style={{ gap: 9 }}>
              <div>
                <p className="section-label">{t('shop.flight.from')}</p>
                <input
                  type="text"
                  value={trip.from}
                  onChange={(e) => setTrip({ ...trip, from: e.target.value })}
                  placeholder={t('shop.flight.fromHint')}
                />
              </div>
              <div>
                <p className="section-label">{t('shop.flight.to')}</p>
                <input
                  type="text"
                  value={trip.to}
                  onChange={(e) => setTrip({ ...trip, to: e.target.value })}
                  placeholder={t('shop.flight.toHint')}
                />
              </div>

              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <p className="section-label">{t('shop.flight.depart')}</p>
                  <input
                    type="date"
                    value={trip.depart}
                    min={isoDay(0)}
                    onChange={(e) => setTrip({ ...trip, depart: e.target.value })}
                  />
                </div>
                {trip.round && (
                  <div style={{ flex: 1 }}>
                    <p className="section-label">{t('shop.flight.return')}</p>
                    <input
                      type="date"
                      value={trip.ret}
                      /* Cannot return before departing. Enforced rather than
                         validated after the fact. */
                      min={trip.depart || isoDay(0)}
                      onChange={(e) => setTrip({ ...trip, ret: e.target.value })}
                    />
                  </div>
                )}
              </div>

              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <p className="section-label">{t('shop.flight.passengers')}</p>
                  <select
                    value={trip.adults}
                    onChange={(e) => setTrip({ ...trip, adults: Number(e.target.value) })}
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <p className="section-label">{t('shop.flight.cabin')}</p>
                  <select value={trip.cabin} onChange={(e) => setTrip({ ...trip, cabin: e.target.value })}>
                    {['economy', 'premium_economy', 'business', 'first'].map((c) => (
                      <option key={c} value={c}>{t(`shop.flight.cabinOpt.${c}`)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button
                  className={`tag ${trip.round ? 'active' : ''}`}
                  onClick={() => setTrip({ ...trip, round: !trip.round })}
                >
                  {t('shop.flight.roundTrip')}
                </button>
                <button
                  className={`tag ${trip.direct ? 'active' : ''}`}
                  onClick={() => setTrip({ ...trip, direct: !trip.direct })}
                >
                  {t('shop.flight.directOnly')}
                </button>
              </div>

              <button
                className="btn btn-primary"
                disabled={!trip.from.trim() || !trip.to.trim()}
                onClick={() =>
                  open(
                    flightUrl({
                      from: trip.from,
                      to: trip.to,
                      depart: trip.depart,
                      ret: trip.round ? trip.ret : null,
                      adults: trip.adults,
                      cabin: trip.cabin,
                      direct: trip.direct
                    })
                  )
                }
              >
                {t('shop.flight.search')}
              </button>
            </div>
          </motion.section>

          <AdBanner slot="p2p" />
        </>
      ) : (
        <>
          <motion.section className="card card-rgb" variants={riseIn} initial="hidden" animate="show">
            <div className="sheen" />
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{t('shop.stay.title')}</div>
            <p className="prose-sm" style={{ margin: 0 }}>{t('shop.stay.body')}</p>
          </motion.section>

          <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
            <div className="stack" style={{ gap: 9 }}>
              <div>
                <p className="section-label">{t('shop.stay.where')}</p>
                <input
                  type="text"
                  value={stay.city}
                  onChange={(e) => setStay({ ...stay, city: e.target.value })}
                  placeholder={t('shop.stay.whereHint')}
                />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <p className="section-label">{t('shop.stay.checkIn')}</p>
                  <input
                    type="date"
                    value={stay.checkIn}
                    min={isoDay(0)}
                    onChange={(e) => setStay({ ...stay, checkIn: e.target.value })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <p className="section-label">{t('shop.stay.checkOut')}</p>
                  <input
                    type="date"
                    value={stay.checkOut}
                    min={stay.checkIn || isoDay(0)}
                    onChange={(e) => setStay({ ...stay, checkOut: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <p className="section-label">{t('shop.stay.guests')}</p>
                <select value={stay.guests} onChange={(e) => setStay({ ...stay, guests: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <button
                className="btn btn-primary"
                disabled={!stay.city.trim()}
                onClick={() => open(stayUrl(stay))}
              >
                {t('shop.stay.search')}
              </button>
            </div>
          </motion.section>

          {/* eSIM lives here rather than as a fourth tab: it is a travel
              purchase, and it is one link with no search of its own. */}
          <motion.button
            className="wallet-option"
            variants={riseIn}
            initial="hidden"
            animate="show"
            whileTap={{ scale: 0.985 }}
            onClick={() => open(esimUrl())}
          >
            <span className="wallet-badge" style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>eSIM</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5 }}>{t('shop.esim.name')}</span>
              <span className="set-row-sub">{t('shop.esim.desc')}</span>
            </span>
            <IconExternal width={17} height={17} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
          </motion.button>

          <AdBanner slot="signals" />
        </>
      )}

      {/*
        ─── RESTRICTIONS, FOLDED ─────────────────────────────────────────────
        Asked for exactly this shape: a collapsible for the limits, and NOT a
        lot of explanation or warnings. One box, short factual list, closed.
      */}
      <InfoBox title={t('shop.limits.title')} tone="info" id="shop-limits">
        <p>{t('shop.limits.body')}</p>
      </InfoBox>

      {/*
        Whether we earn, derived from the configured partner id rather than
        hard-coded — the bug caught on Perp and again on Avantis, where the
        code earned while the copy denied it.
      */}
      <p className="faint" style={{ marginTop: 4, lineHeight: 1.75 }}>
        {shopEarns() ? t('shop.earning') : t('shop.noEarn')}
      </p>
    </PageTransition>
  );
}
