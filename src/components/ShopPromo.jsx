import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft, IconChevronRight } from './Icons';
import { IconArrowUpRight, IconSpark } from './ShopIcons';
import { useStill } from './AnimatedIcon';

const AUTOPLAY_MS = 6000;

/**
 * The shop's editorial promo carousel.
 *
 * The photograph is the hero, not a dark background for a paragraph. A quiet
 * glass information layer keeps the copy readable while leaving the landmark
 * visible, and the controls make the four-slide story discoverable without
 * requiring the reader to wait for the timer.
 *
 * There is deliberately ONE autoplay timer. It is cleaned up on unmount,
 * paused while the carousel is being inspected, and disabled by useStill()
 * for reduced-motion users and native shells. Manual controls remain usable
 * in every mode.
 */
export default function ShopPromo({ slides, onSlide }) {
  const { t } = useTranslation();
  const still = useStill();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = slides?.length ?? 0;

  useEffect(() => {
    if (still || paused || !slides?.length || slides.length < 2) return undefined;
    const id = setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [paused, slides, still]);

  if (!count) return null;

  /* A changed slide list should never leave the active counter out of range. */
  const activeIndex = Math.min(index, count - 1);
  const s = slides[activeIndex];
  const number = String(activeIndex + 1).padStart(2, '0');
  const total = String(count).padStart(2, '0');

  const move = (delta) => {
    setIndex((current) => (current + delta + count) % count);
  };

  const resumeIfLeaving = (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
  };

  return (
    <section
      className="shop-promo shop-promo--cinema shop-glow"
      data-accent={s.accent || 'cyan'}
      role="region"
      aria-roledescription="carousel"
      aria-label={t('shop.promo.ariaLabel', { defaultValue: 'Featured shop offers' })}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={resumeIfLeaving}
    >
      <div className="shop-promo-media" aria-hidden="true">
        {/* Overlapping opacity transitions avoid an empty frame between photos. */}
        <AnimatePresence initial={false}>
          <motion.img
            key={s.id}
            className="shop-promo-image"
            src={s.img.src}
            alt=""
            loading={activeIndex === 0 ? 'eager' : 'lazy'}
            fetchpriority={activeIndex === 0 ? 'high' : 'auto'}
            decoding="async"
            draggable="false"
            style={{ objectPosition: s.img.position || 'center' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: still ? 0 : 0.8, ease: 'easeInOut' }}
          />
        </AnimatePresence>
      </div>
      <span className="shop-promo-veil" aria-hidden="true" />
      <span className="shop-promo-ambient" aria-hidden="true" />
      <span className="shop-promo-grain" aria-hidden="true" />

      <div className="shop-promo-head">
        <span className="shop-promo-kicker">
          <span className="shop-promo-kicker-mark" aria-hidden="true">
            <IconSpark width={13} height={13} />
          </span>
          <span>{t('shop.promo.kicker')}</span>
        </span>
        <span className="shop-promo-counter" dir="ltr" aria-label={`${number} / ${total}`}>
          <strong>{number}</strong>
          <span>/</span>
          <span>{total}</span>
        </span>
      </div>

      <button
        type="button"
        className="shop-promo-txt"
        onClick={() => onSlide?.(s)}
        aria-label={`${t(s.title)} — ${t('shop.promo.explore')}`}
      >
        {s.location && (
          <span className="shop-promo-location">
            <span className="shop-promo-location-dot" aria-hidden="true" />
            <span>{t(s.location)}</span>
          </span>
        )}
        <motion.span
          key={`${s.id}-title`}
          className="shop-promo-title"
          initial={{ opacity: 0, y: still ? 0 : 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: still ? 0 : 0.45, delay: still ? 0 : 0.08 }}
        >
          {t(s.title)}
        </motion.span>
        {s.subtitle && (
          <motion.span
            key={`${s.id}-subtitle`}
            className="shop-promo-subtitle"
            initial={{ opacity: 0, y: still ? 0 : 7 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: still ? 0 : 0.4, delay: still ? 0 : 0.15 }}
          >
            {t(s.subtitle)}
          </motion.span>
        )}
        <span className="shop-promo-cta">
          <span>{t('shop.promo.explore')}</span>
          <IconArrowUpRight width={15} height={15} aria-hidden="true" />
        </span>
      </button>

      <div className="shop-promo-controls">
        {count > 1 && (
          <div className="shop-promo-dots" role="group" aria-label={t('shop.promo.slideNavigation', { defaultValue: 'Choose a slide' })}>
            {slides.map((slide, n) => (
              <button
                key={slide.id}
                type="button"
                className="shop-promo-dot"
                data-on={n === activeIndex ? 'true' : 'false'}
                aria-pressed={n === activeIndex}
                aria-label={t('shop.promo.goToSlide', { number: n + 1, defaultValue: `Go to slide ${n + 1}` })}
                onClick={() => setIndex(n)}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        {count > 1 && (
          <div className="shop-promo-arrows">
            <button
              type="button"
              className="shop-promo-arrow"
              onClick={() => move(-1)}
              aria-label={t('shop.promo.previous', { defaultValue: 'Previous slide' })}
            >
              <IconChevronLeft width={17} height={17} />
            </button>
            <button
              type="button"
              className="shop-promo-arrow"
              onClick={() => move(1)}
              aria-label={t('shop.promo.next', { defaultValue: 'Next slide' })}
            >
              <IconChevronRight width={17} height={17} />
            </button>
          </div>
        )}
      </div>

      {/* CC-BY / CC-BY-SA attribution stays attached to the visible artwork. */}
      <span className="shop-promo-credit">
        © {s.img.credit} · {s.img.licence}
      </span>
    </section>
  );
}
