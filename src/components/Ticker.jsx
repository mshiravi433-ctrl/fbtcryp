import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { fmtPct, fmtPrice } from '../lib/format';
import CoinLogo from './CoinLogo';

const PROMO_DATA = {
  gold: {
    badge: 'Au',
    titleFa: 'توکن طلا',
    titleEn: 'Gold Token',
    subFa: 'دارایی امن دیجیتال',
    subEn: 'Secure on-chain gold',
    growth: '+8.4%',
    path: '/trade'
  },
  rwa: {
    badge: 'R',
    titleFa: 'دارایی واقعی RWA',
    titleEn: 'Real World Assets',
    subFa: 'توکنایز روی بلاکچین',
    subEn: 'Tokenized on-chain',
    growth: '+12.6%',
    path: '/stocks'
  },
  ai: {
    badge: 'AI',
    titleFa: 'هوش مصنوعی Intent',
    titleEn: 'Intent AI Engine',
    subFa: 'دستیار هوشمند مالی',
    subEn: 'Autonomous financial agent',
    growth: '+24.8%',
    path: '/intent'
  },
  yield: {
    badge: 'APY',
    titleFa: 'فارم و استیکینگ',
    titleEn: 'DeFi Staking',
    subFa: 'سود غیرفعال کریپتو',
    subEn: 'Passive DeFi yield',
    growth: '+18.2%',
    path: '/farm'
  },
  p2p: {
    badge: 'P2P',
    titleFa: 'معاملات مستقیم P2P',
    titleEn: 'P2P Market',
    subFa: 'تسویه امن بدون واسطه',
    subEn: 'Direct escrow trading',
    growth: '0% FEE',
    path: '/p2p'
  }
};

/** Compact market rail promo banner */
function Promo({ kind, isFa, onNavigate }) {
  const p = PROMO_DATA[kind] || PROMO_DATA.rwa;
  return (
    <div
      className={`ticker-promo ticker-promo-${kind}`}
      onClick={() => onNavigate(p.path)}
      role="button"
      tabIndex={0}
      title={isFa ? p.titleFa : p.titleEn}
    >
      <span className="ticker-promo-logo">{p.badge}</span>
      <span className="ticker-promo-copy">
        <b>{isFa ? p.titleFa : p.titleEn}</b>
        <small>{isFa ? p.subFa : p.subEn}</small>
      </span>
      <span className="ticker-promo-growth">{p.growth}</span>
      <svg className="ticker-promo-chart" viewBox="0 0 34 22" aria-hidden="true">
        <path d="M2 19 L10 14 L15 16 L23 7 L31 3" />
        <path d="M25 3h6v6" />
      </svg>
    </div>
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

    // Ensure we have at least a solid set of items
    return items;
  }, [coins]);

  if (!sequence.length) return <div className="skel" style={{ height: 42 }} />;

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
    return (
      <div
        className="ticker-item"
        key={key}
        onClick={() => navigate(`/coin/${item.coin.id}`)}
        role="button"
        tabIndex={0}
      >
        <CoinLogo coin={item.coin} size={22} />
        <span className="ticker-sym">{item.coin.symbol}</span>
        <span className="mono">${fmtPrice(item.coin.price)}</span>
        <span className={item.coin.change24h >= 0 ? 'up mono' : 'down mono'}>
          {fmtPct(item.coin.change24h, 1)}
        </span>
      </div>
    );
  };

  return (
    <div className="ticker" aria-label={t('market.livePrices', { defaultValue: 'قیمت‌های زنده بازار' })} dir="ltr">
      <div className="ticker-track">
        {sequence.map((item, i) => renderItem(item, `t1-${i}`))}
      </div>
      <div className="ticker-track" aria-hidden="true">
        {sequence.map((item, i) => renderItem(item, `t2-${i}`))}
      </div>
    </div>
  );
}
