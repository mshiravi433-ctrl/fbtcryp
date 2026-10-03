import { memo, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useStill } from './AnimatedIcon';
import { IconShield, IconSwap } from './Icons';

/**
 * COMPACT BRIDGE ROUTE CAROUSEL
 * ---------------------------------------------------------------------------
 * One focused route at a time keeps the bridge screen from opening with a tall
 * stack of promotional cards. The two routes remain reachable from labelled
 * slide controls, and the small auto-advance pauses while the user points at
 * the banner or tabs into it. `useStill()` also stops autoplay for reduced
 * motion and the in-app motion setting.
 */
const ROUTE_IDS = ['tron', 'solana'];

const ChainMark = ({ chain }) => {
  if (chain === 'tron') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <path d="M2.6 3.2 21.4 6l-6.1 12.6L2.6 3.2Z" fill="currentColor" opacity="0.18" />
        <path
          d="M2.6 3.2 21.4 6m0 0-6.1 12.6M21.4 6 9.1 9.4m0 0 6.2 9.2m-6.2-9.2-6.5-6.2m12.7 15.4L2.6 3.2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M6 5.4 9 3l3 2.4v3.1L9 10.9 6 8.5V5.4Z" fill="currentColor" />
      <path d="M12 13.2 15 11l3 2.2v3.2L15 18.6l-3-2.2v-3.2Z" fill="currentColor" opacity="0.75" />
      <path d="M6 18.6 9 16.4l3 2.2v3.2L9 24l-3-2.2v-3.2Z" fill="currentColor" opacity="0.5" />
    </svg>
  );
};

function RouteArtwork({ still }) {
  return (
    <motion.svg className="brg-hero-flow" viewBox="0 0 108 48" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 24h92" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" />
      <motion.path
        d="M8 24h92"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3 7"
        initial={false}
        animate={still ? { strokeDashoffset: 0, opacity: 0.45 } : { strokeDashoffset: [0, -20], opacity: [0.35, 0.9, 0.35] }}
        transition={still ? { duration: 0 } : { duration: 2.5, repeat: Infinity, ease: 'linear' }}
      />
      <circle cx="9" cy="24" r="5.5" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="99" cy="24" r="5.5" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.5" />
      <motion.circle
        cx="54"
        cy="24"
        r="3.5"
        fill="currentColor"
        initial={false}
        animate={still ? { opacity: 0.7, scale: 1 } : { opacity: [0.35, 1, 0.35], scale: [0.85, 1.2, 0.85] }}
        transition={still ? { duration: 0 } : { duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '54px 24px' }}
      />
    </motion.svg>
  );
}

const BridgeHero = memo(function BridgeHero({ onSelectMode }) {
  const { t } = useTranslation();
  const still = useStill();
  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  const cards = [
    {
      id: 'tron',
      chain: 'tron',
      network: 'TRON NETWORK',
      title: t('bridge.hero.tron.title'),
      note: t('bridge.hero.tron.note'),
      cta: t('bridge.hero.tron.cta'),
      tone: 'tron'
    },
    {
      id: 'solana',
      chain: 'solana',
      network: 'SOLANA NETWORK',
      title: t('bridge.hero.solana.title'),
      note: t('bridge.hero.solana.note'),
      cta: t('bridge.hero.solana.cta'),
      tone: 'solana'
    }
  ];
  const activeCard = cards[activeIndex];

  useEffect(() => {
    if (still || paused) return undefined;
    const timer = window.setTimeout(() => {
      setDirection(1);
      setActiveIndex((current) => (current + 1) % ROUTE_IDS.length);
    }, 7600);
    return () => window.clearTimeout(timer);
  }, [activeIndex, paused, still]);

  const selectCard = (index) => {
    if (index === activeIndex) return;
    setDirection(index > activeIndex ? 1 : -1);
    setActiveIndex(index);
  };

  return (
    <motion.section
      className="brg-hero"
      variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { duration: 0.26 } } }}
      initial={still ? false : 'hidden'}
      animate="show"
      aria-label={t('bridge.hero.title')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <span className="brg-hero-aurora" aria-hidden="true" />
      <span className="brg-hero-grid" aria-hidden="true" />

      <div className="brg-hero-top">
        <span className="brg-hero-badge">
          <IconShield width={13} height={13} />
          <span>{t('bridge.hero.badge')}</span>
        </span>
        <span className="brg-hero-count mono" aria-hidden="true">
          {String(activeIndex + 1).padStart(2, '0')} <i /> {String(cards.length).padStart(2, '0')}
        </span>
      </div>

      <div
        className="brg-hero-stage"
        role="region"
        aria-roledescription={t('bridge.hero.carousel')}
        aria-live={paused ? 'polite' : 'off'}
      >
        <AnimatePresence initial={false} mode="wait">
          <motion.article
            key={activeCard.id}
            id="brg-hero-active-slide"
            className={`brg-hero-card is-${activeCard.tone}`}
            role="group"
            aria-roledescription={t('bridge.hero.slide')}
            aria-label={t('bridge.hero.slideLabel', { current: activeIndex + 1, total: cards.length, route: activeCard.title })}
            initial={still ? { opacity: 0 } : { opacity: 0, x: direction * 18, rotateY: direction * 4 }}
            animate={{ opacity: 1, x: 0, rotateY: 0 }}
            exit={still ? { opacity: 0 } : { opacity: 0, x: direction * -18, rotateY: direction * -4 }}
            transition={still ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="brg-hero-card-mark" aria-hidden="true">
              <ChainMark chain={activeCard.chain} />
            </span>
            <div className="brg-hero-card-copy">
              <span className="brg-hero-card-network" dir="ltr">{activeCard.network}</span>
              <h2 className="brg-hero-card-title" id="brg-hero-route-title" dir="auto">{activeCard.title}</h2>
              <p className="brg-hero-card-note" dir="auto">{activeCard.note}</p>
            </div>
            <RouteArtwork still={still} />
            <button
              type="button"
              className="brg-hero-card-cta"
              onClick={() => onSelectMode?.(activeCard.id)}
            >
              <IconSwap width={15} height={15} />
              <span>{activeCard.cta}</span>
            </button>
          </motion.article>
        </AnimatePresence>
      </div>

      <div className="brg-hero-dots" role="group" aria-label={t('bridge.hero.chooseRoute')}>
        {cards.map((card, index) => (
          <button
            key={card.id}
            type="button"
            className={`brg-hero-dot${index === activeIndex ? ' active' : ''}`}
            aria-pressed={index === activeIndex}
            aria-controls="brg-hero-active-slide"
            aria-label={t('bridge.hero.goTo', { route: card.title })}
            onClick={() => selectCard(index)}
          />
        ))}
      </div>
    </motion.section>
  );
});

export default BridgeHero;
