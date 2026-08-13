import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AnimatedSettings, useStill } from './AnimatedIcon';
import { IconBuilding, IconClock, IconTrend } from './Icons';
import { usePoints } from '../hooks/usePoints';
import { usePoll } from '../hooks/useMarket';
import { getMarkets } from '../lib/api';
import { vsOf } from '../lib/currency';
import { fmtPct } from '../lib/format';
import { cachedHeadlines } from '../lib/news';
import { deriveMarketInsights, headerInsightItems } from '../lib/marketInsights';
import { useInsightEquities } from '../lib/insightSession';
import { useSettingsStore } from '../store/useSettingsStore';

const BRAND_MS = 2 * 60 * 1000;
const SPOTLIGHT_MS = 60 * 1000;

function BrandMark({ still = false }) {
  return (
    <div className="brand-mark">
      <motion.svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        animate={still ? { rotateY: 0 } : { rotateY: [0, 360] }}
        transition={still ? { duration: 0 } : { duration: 7, repeat: Infinity, ease: 'easeInOut' }}
        style={{ position: 'relative', zIndex: 2 }}
      >
        <defs>
          <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00e5ff" />
            <stop offset="50%" stopColor="#7c4dff" />
            <stop offset="100%" stopColor="#ff2d95" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="9.2" stroke="url(#brandGrad)" strokeWidth="2.1" />
        <path d="M8.4 10.6a3.8 3.8 0 0 1 6.5-1.4" stroke="url(#brandGrad)" />
        <path d="M15.6 13.4a3.8 3.8 0 0 1-6.5 1.4" stroke="url(#brandGrad)" />
        <path d="M14.6 6.6v2.9h-2.9" stroke="url(#brandGrad)" />
        <path d="M9.4 17.4v-2.9h2.9" stroke="url(#brandGrad)" />
      </motion.svg>
    </div>
  );
}

function SpotlightMark({ spotlight }) {
  const src = spotlight?.item?.image || spotlight?.item?.icon;
  const Fallback = spotlight?.kind === 'event' ? IconClock : spotlight?.kind === 'company' ? IconBuilding : IconTrend;
  return (
    <span className="header-spotlight-mark" aria-hidden="true">
      <Fallback width={17} height={17} />
      {src && (
        <img
          src={src}
          alt=""
          decoding="async"
          referrerPolicy="no-referrer"
          onError={(event) => { event.currentTarget.hidden = true; }}
        />
      )}
    </span>
  );
}

/**
 * Fixed-size header brand/market stage.
 *
 * The two layers are absolutely overlaid and only opacity/transform changes.
 * Neither content can participate in layout, so a long event title cannot
 * move the rank/settings controls or alter the header's width/height.
 */
export default function Header() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const still = useStill();
  const [cogSpin, setCogSpin] = useState(false);
  const [news, setNews] = useState(() => cachedHeadlines());
  const [showSpotlight, setShowSpotlight] = useState(false);
  const [spotlightIndex, setSpotlightIndex] = useState(0);
  const { tier } = usePoints();

  const currency = useSettingsStore((state) => state.currency);
  const vs = vsOf(currency);
  // Header data changes on the scale of minutes, not seconds. A three-minute
  // poll is enough for the one-minute spotlight while avoiding a global
  // 30-second request on every route.
  const { data: markets } = usePoll(
    () => getMarkets({ perPage: 60, vs }),
    [vs],
    3 * 60 * 1000
  );
  const equities = useInsightEquities();

  // App.jsx already refreshes this cache in the background. Re-read it rather
  // than launching another news request from the global header.
  useEffect(() => {
    const sync = () => setNews(cachedHeadlines());
    const soon = setTimeout(sync, 4500);
    const timer = setInterval(sync, 60 * 1000);
    return () => {
      clearTimeout(soon);
      clearInterval(timer);
    };
  }, []);

  const spotlights = useMemo(
    () => headerInsightItems(deriveMarketInsights({ markets: markets ?? [], equities, news })),
    [markets, equities, news]
  );
  const spotlight = spotlights.length ? spotlights[spotlightIndex % spotlights.length] : null;
  const visibleSpotlight = Boolean(!still && showSpotlight && spotlight);

  // The brand gets two minutes, one insight gets one minute, then the brand
  // returns before the next insight. Reduced-motion users keep the static
  // brand: no periodic peripheral-motion surprise and no transition at all.
  useEffect(() => {
    if (still || !spotlights.length) {
      setShowSpotlight(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      if (showSpotlight) {
        setShowSpotlight(false);
        setSpotlightIndex((index) => (index + 1) % spotlights.length);
      } else {
        setShowSpotlight(true);
      }
    }, showSpotlight ? SPOTLIGHT_MS : BRAND_MS);
    return () => clearTimeout(timer);
  }, [showSpotlight, spotlightIndex, spotlights.length, still]);

  const spotlightLabel = spotlight ? t(`insights.header.${spotlight.kind}`) : '';
  const spotlightTitle = spotlight?.item?.title || spotlight?.item?.name || '';

  return (
    <header className="top-bar">
      <motion.div
        className="header-brand-stage"
        initial={{ opacity: 0, x: -14 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: still ? 0 : 0.45 }}
        data-spotlight={visibleSpotlight ? 'true' : 'false'}
      >
        <div className="brand header-brand-layer" aria-hidden={visibleSpotlight}>
          <BrandMark still={still} />
          <div className="brand-text">
            <span className="brand-name gradient-text">FBT Swap</span>
            <span className="brand-sub">decentralized exchange</span>
          </div>
        </div>

        <button
          type="button"
          className="header-spotlight-layer"
          tabIndex={visibleSpotlight ? 0 : -1}
          aria-hidden={!visibleSpotlight}
          aria-label={`${spotlightLabel}: ${spotlightTitle}`}
          title={spotlightTitle}
          onClick={() => navigate('/news')}
        >
          {spotlight && <SpotlightMark spotlight={spotlight} />}
          <span className="header-spotlight-copy">
            <small>{spotlightLabel}</small>
            <strong>{spotlightTitle}</strong>
          </span>
          {spotlight?.change24h != null && (
            <span className={spotlight.change24h >= 0 ? 'up header-spotlight-change' : 'down header-spotlight-change'}>
              {fmtPct(spotlight.change24h, 1)}
            </span>
          )}
        </button>
      </motion.div>

      <div className="row" style={{ gap: 8 }}>
        {/* Medal only: a points number beside the brand would look like a
            custodial balance. The points screen explains the tier on tap. */}
        <motion.button
          className="rank-chip"
          onClick={() => navigate('/rewards')}
          whileTap={{ scale: 0.9 }}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          aria-label={t(`rank.tier.${tier.id}`)}
          title={t(`rank.tier.${tier.id}`)}
          style={{ '--rank-glow': tier.glow, borderColor: tier.color }}
        >
          <span aria-hidden="true">{tier.icon}</span>
        </motion.button>

        <motion.button
          className="icon-btn"
          onClick={() => {
            setCogSpin(true);
            navigate('/settings');
          }}
          onHoverStart={() => setCogSpin(true)}
          onHoverEnd={() => setCogSpin(false)}
          whileTap={{ scale: 0.9 }}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14 }}
          aria-label={t('nav.settings')}
        >
          <AnimatedSettings active={cogSpin} still={still} width={17} height={17} />
        </motion.button>
      </div>
    </header>
  );
}
