import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { fmtPct, fmtPrice } from '../lib/format';
import { currencyOf } from '../lib/currency';
import CoinLogo from './CoinLogo';

/**
 * THE MARKET RAIL
 * ---------------------------------------------------------------------------
 * Reported (twice, the second time as «داخل باکس قرار دادی کشیده شود … انگار
 * ریلی هست و مدرن باشد»): the top box should read as ONE rail, not as a row of
 * cards that were stretched to fill one.
 *
 * ─── WHAT IS DIFFERENT IN THIS PASS ────────────────────────────────────────
 * 1. NOTHING INSIDE THE BOX IS A BOX. Every coin used to be a bordered,
 *    shadowed pill with its own padding, riding inside a bordered rail — forty
 *    sub-cards inside a card. Items are now full-height SEGMENTS of a single
 *    tape (no radius, no border, no shadow), separated by one hairline. That is
 *    what makes the strip feel like a rail instead of a squeezed grid.
 * 2. NOTHING STRETCHES. The item is `height:100%` with `align-items:center`,
 *    so its contents are centred in the rail rather than sized by it. The
 *    numeric columns are tabular, so the tape does not jitter as prices tick.
 * 3. NO BLINKING LIGHT. A pulsing green dot is alarm vocabulary, not price
 *    vocabulary; it sat there permanently next to numbers that already prove
 *    the feed is alive. A static accent bar + a quiet LIVE label replace it.
 * 4. THE CHANGE IS A PILL. Green/red text at 10px on a moving tape is hard to
 *    read; a tinted pill with a direction glyph survives both a quick glance
 *    and a monochrome screenshot.
 *
 * ─── WHY IT IS ALSO CHEAPER THAN THE OLD ONE ───────────────────────────────
 * The marquee is a single transform-only animation on two tracks (no JS, no
 * rAF, no layout). The edge fades are painted gradients rather than a
 * `mask-image`, because a mask promotes the whole strip to an offscreen buffer
 * that has to be re-composited while the page scrolls — on a phone that is
 * exactly the kind of work that shows up as a black band mid-scroll. Logos are
 * `thumb` (25px) artwork drawn at 18px: the old call asked for 22px, which is
 * not a CoinGecko variant name, so the tape downloaded 250px PNGs for it.
 *
 * Items are real `<button>`s, so the rail is keyboard reachable without a
 * `role="button"` div.
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

  /*
   * ONE PROMO PER FOUR COINS, and at most 24 segments per track. The parent
   * already slices the feed, but this component is mounted with whatever it is
   * given — a 250-row list would otherwise become a 500-node marquee that is
   * wider than the page and slower than the list it advertises.
   */
  const sequence = useMemo(() => {
    if (!coins || coins.length === 0) return [];

    const promoKinds = ['rwa', 'gold', 'ai', 'yield', 'p2p'];
    const source = coins.slice(0, 20);
    const chunkSize = 4;
    const items = [];

    let promoIndex = 0;
    for (let i = 0; i < source.length; i += chunkSize) {
      source.slice(i, i + chunkSize).forEach((coin) => items.push({ type: 'coin', coin }));
      items.push({ type: 'promo', kind: promoKinds[promoIndex % promoKinds.length] });
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
        <CoinLogo coin={item.coin} size="thumb" px={18} />
        <span className="ticker-sym">{item.coin.symbol}</span>
        {/* `fmtPrice` is deliberately NOT `fmtUsd`: a market price is public
            data and must not be masked by the hide-balances switch. The
            symbol still comes from the currency module so it cannot drift. */}
        <span className="ticker-price mono">{`${currencyOf().symbol}${fmtPrice(item.coin.price)}`}</span>
        <span className={`ticker-change mono ${up ? 'is-up' : 'is-down'}`}>
          <span className="ticker-change-arrow" aria-hidden="true">{up ? '▲' : '▼'}</span>
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
