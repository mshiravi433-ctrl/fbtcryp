import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { fmtPct, fmtPrice } from '../lib/format';
import { currencyOf } from '../lib/currency';
import CoinLogo from './CoinLogo';

/**
 * THE MARKET RAIL
 * ---------------------------------------------------------------------------
 * Reported: «باکس بالایی سرعتش خوب شده اما داخل باکس قرار دادی کشیده شود بدون
 * چراغ چشمک زن سبز و انگار ریلی هست و مدرن باشد».
 *
 * Three things were wrong with the old tape, and each one is structural rather
 * than a matter of taste:
 *
 *   1. A BOX INSIDE A BOX. Every coin was a bordered, shadowed pill riding
 *      inside a bordered, shadowed rail — 40 sub-cards in a card, which is what
 *      made the strip feel "کشیده" (stretched) and cramped at the same time.
 *      The rail is now ONE surface: items are plain typographic segments
 *      separated by a hairline, so the eye reads a continuous tape rather than
 *      a row of chips.
 *   2. THE BLINKING GREEN LIGHT. A pulsing green dot is the visual vocabulary
 *      of an alarm, not of a live price. It sat there permanently, blinking,
 *      next to numbers that are already the evidence that the feed is alive.
 *      Replaced by a static accent bar + a quiet LIVE label: the rail says what
 *      it is without moving at the viewer.
 *   3. PROMOS AS SUB-BANNERS. Each promo carried a badge, two lines of copy, a
 *      chart glyph and a growth figure — a poster inside a tape. They are now
 *      single-line accent tags: dot, name, move. A promo earns attention by
 *      colour, not by volume.
 *
 * Motion: the marquee is the SAME transform-only animation (96s, paused on
 * hover, 180s under reduced motion) — the speed was already right, so nothing
 * here changes the cost of the frame. Items are real `<button>`s now, so the
 * rail is keyboard reachable without a `role="button"` div.
 */

const PROMO_DATA = {
  gold: {
    titleFa: 'توکن طلا',
    titleEn: 'Gold Token',
    growth: '+8.4%',
    path: '/trade'
  },
  rwa: {
    titleFa: 'دارایی واقعی RWA',
    titleEn: 'Real World Assets',
    growth: '+12.6%',
    path: '/stocks'
  },
  ai: {
    titleFa: 'هوش مصنوعی Intent',
    titleEn: 'Intent AI',
    growth: '+24.8%',
    path: '/intent'
  },
  yield: {
    titleFa: 'فارم و استیکینگ',
    titleEn: 'DeFi Yield',
    growth: '+18.2%',
    path: '/farm'
  },
  p2p: {
    titleFa: 'معاملهٔ مستقیم P2P',
    titleEn: 'P2P Market',
    growth: '0% FEE',
    path: '/p2p'
  }
};

function Promo({ kind, isFa, onNavigate }) {
  const p = PROMO_DATA[kind] || PROMO_DATA.rwa;
  return (
    <button
      type="button"
      className={`ticker-promo ticker-promo-${kind}`}
      onClick={() => onNavigate(p.path)}
    >
      <span className="ticker-promo-dot" aria-hidden="true" />
      <span className="ticker-promo-title">{isFa ? p.titleFa : p.titleEn}</span>
      <span className="ticker-promo-growth mono">{p.growth}</span>
    </button>
  );
}

export default function Ticker({ coins = [] }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isFa = !i18n.language?.startsWith('en');

  // Build a rich, repeating sequence of live assets interspersed with varied promos
  const sequence = useMemo(() => {
    if (!coins || coins.length === 0) return [];

    const promoKinds = ['rwa', 'gold', 'ai', 'yield', 'p2p'];
    const chunkSize = 3;
    const items = [];

    let promoIndex = 0;
    for (let i = 0; i < coins.length; i += chunkSize) {
      const chunk = coins.slice(i, i + chunkSize);
      chunk.forEach((coin) => {
        items.push({ type: 'coin', coin });
      });
      const promoKind = promoKinds[promoIndex % promoKinds.length];
      items.push({ type: 'promo', kind: promoKind });
      promoIndex += 1;
    }

    return items;
  }, [coins]);

  if (!sequence.length) return <div className="skel ticker-skel" />;

  const renderItem = (item, key) => {
    if (item.type === 'promo') {
      return (
        <Promo
          key={key}
          kind={item.kind}
          isFa={isFa}
          onNavigate={(url) => navigate(url)}
        />
      );
    }
    const up = item.coin.change24h >= 0;
    return (
      <button
        type="button"
        className="ticker-item"
        key={key}
        onClick={() => navigate(`/coin/${item.coin.id}`)}
      >
        {/* `thumb` (25px) is the honest size for a 19px mark; the old call
            passed `22`, which is not a CoinGecko variant name, so the URL was
            left untouched and the tape fetched 250px artwork. */}
        <CoinLogo coin={item.coin} size="thumb" px={19} />
        <span className="ticker-sym">{item.coin.symbol}</span>
        {/* `fmtPrice` is deliberately NOT `fmtUsd`: a market price is public
            data and must not be masked by the hide-balances switch. The
            symbol still comes from the currency module so it cannot drift. */}
        <span className="ticker-price mono">{`${currencyOf().symbol}${fmtPrice(item.coin.price)}`}</span>
        <span className={`ticker-change mono ${up ? 'is-up' : 'is-down'}`}>
          {fmtPct(item.coin.change24h, 1)}
        </span>
      </button>
    );
  };

  return (
    <div className="ticker" aria-label={t('market.livePrices', { defaultValue: 'قیمت‌های زنده بازار' })} dir="ltr">
      {/*
        A STATIC marker, not a heartbeat. The bar is the rail's own accent; the
        LIVE word is quiet enough to sit in a price strip without shouting over
        the numbers it introduces.
      */}
      <span className="ticker-mark" aria-hidden="true">
        <span className="ticker-mark-bar" />
        <span className="ticker-live-text mono">LIVE</span>
      </span>
      <div className="ticker-viewport">
        <div className="ticker-track">
          {sequence.map((item, i) => renderItem(item, `t1-${i}`))}
        </div>
        <div className="ticker-track" aria-hidden="true">
          {sequence.map((item, i) => renderItem(item, `t2-${i}`))}
        </div>
      </div>
    </div>
  );
}
