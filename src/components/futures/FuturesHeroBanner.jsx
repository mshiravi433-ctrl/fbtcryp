import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStill } from '../AnimatedIcon';
import { IconTrend } from '../Icons';
import { fmtPrice, fmtPct } from '../../lib/format';
import '../../styles/futures-hero-banner.css';

const MODE = { spot: 'modeSpot', overview: 'modeFutures', dydx: 'modeDydx', onchain: 'modeOnchain' };

export default function FuturesHeroBanner({ activeTab, marketCount, btcPrice, btcChange, ethPrice, ethChange, liveReady }) {
  const { t } = useTranslation();
  const still = useStill();
  const [slot, setSlot] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (still || paused) return;
    const timer = setInterval(() => { if (!document.hidden) setSlot((n) => (n + 1) % 3); }, 5200);
    return () => clearInterval(timer);
  }, [still, paused]);
  const metrics = [
    <>{t('futures.banner.statMarkets', { defaultValue: 'Markets' })} <b>{marketCount || '—'}</b></>,
    ...[['BTC', btcPrice, btcChange], ['ETH', ethPrice, ethChange]].map(([name, price, change]) => (
      <span dir="ltr">{name} <b>{price == null ? '—' : `$${fmtPrice(price)}`}</b>{change != null && ` · ${fmtPct(change)}`}</span>
    ))
  ];
  return (
    <section className={`futures-ticker${still ? ' is-still' : ''}`} data-testid="futures-hero-banner" data-mode={activeTab}>
      <IconTrend width={16} height={16} aria-hidden="true" />
      <h1 className="derivatives-title">{activeTab === 'onchain' ? t('futures.onchainTitle', { defaultValue: 'فیوچرز آن‌چین' }) : t('futures.banner.wordmark')}</h1>
      <span className="futures-ticker-mode">{t(`futures.banner.${MODE[activeTab] || MODE.overview}`)}</span>
      <button type="button" className="futures-ticker-slide" onClick={() => { setPaused(true); setSlot((n) => (n + 1) % 3); }}
        aria-label={t('futures.banner.nextMetric', { defaultValue: 'Next market metric' })}>
        <span key={slot}>{metrics[slot]}</span>
      </button>
      <span className={`futures-ticker-status${liveReady ? ' is-live' : ''}`} role="img" title={t(`futures.banner.${liveReady ? 'liveFeed' : 'syncingFeed'}`)} aria-label={t(`futures.banner.${liveReady ? 'liveFeed' : 'syncingFeed'}`)} />
    </section>
  );
}
