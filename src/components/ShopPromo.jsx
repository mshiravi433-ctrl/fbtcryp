import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useStill } from './AnimatedIcon';

/**
 * ROTATING PROMO BANNER.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS REPLACED THE OLD ONE ──────────────────────────────────────────
 * Reported: «عکس پشت با کریپتو خرید کنید خیلی کم رنگ و زشته عوضش کن یا چندتا
 * عکس بزار چند ثانیه یکبار با عنوان جدید عوض بشه اسلایدی باشه».
 *
 * The old banner was one destination photograph under a black gradient with
 * a small caption on top. Two things were wrong with it. The gradient ran to
 * 80% black across the whole frame so the photo was a dark smear rather than
 * an image, and a single static slide on a shop front does the job of a shelf
 * label rather than a window display.
 *
 * So: several slides, each with its own headline, cross-fading on a timer.
 *
 * ─── HOW IT AVOIDS THE OBVIOUS PERFORMANCE MISTAKES ─────────────────────────
 * A carousel is where apps usually start burning battery. This one:
 *
 *   • runs ONE `setInterval`, not one per slide, and clears it on unmount;
 *   • cross-fades with opacity only — no layout, no blur, no filter;
 *   • preloads nothing eagerly except the first slide, so a five-slide banner
 *     costs one image on first paint;
 *   • STOPS COMPLETELY under `prefers-reduced-motion` and on native, via the
 *     existing `useStill()` hook — the same guard AdBanner uses. A moving
 *     banner is a vestibular trigger and a permanent timer on a phone.
 *
 * The gradient is also rebuilt: it now covers the lower half only and tops out
 * at 72%, so the photograph is visible as a photograph.
 */
export default function ShopPromo({ slides, onSlide }) {
  const { t } = useTranslation();
  const still = useStill();
  const [i, setI] = useState(0);
  /* Which images have been mounted at least once, so later slides are only
     fetched when they are first shown. */
  const seen = useRef(new Set([0]));
  seen.current.add(i);

  useEffect(() => {
    if (still || !slides?.length || slides.length < 2) return undefined;
    const id = setInterval(() => setI((n) => (n + 1) % slides.length), 5200);
    return () => clearInterval(id);
  }, [still, slides]);

  if (!slides?.length) return null;
  const s = slides[i];

  return (
    <div className="shop-promo shop-glow">
      {/*
        `mode="wait"` would leave a blank frame between slides. The default
        overlaps them, which is what a cross-fade needs.
      */}
      <AnimatePresence initial={false}>
        <motion.img
          key={s.id}
          src={s.img.src}
          alt=""
          loading={i === 0 ? 'eager' : 'lazy'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: still ? 0 : 0.7, ease: 'easeInOut' }}
        />
      </AnimatePresence>

      <button
        type="button"
        className="shop-promo-txt"
        onClick={() => onSlide?.(s)}
      >
        <span className="shop-promo-kicker">{t('shop.promo.kicker')}</span>
        <motion.span
          key={s.id}
          className="shop-promo-title"
          initial={{ opacity: 0, y: still ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: still ? 0 : 0.45, delay: still ? 0 : 0.12 }}
        >
          {t(s.title)}
        </motion.span>
        <span className="shop-promo-cta">{t('shop.promo.explore')} <b aria-hidden="true">›</b></span>

        {/* Position dots. Also the only affordance telling the reader there is
            more than one slide, which a silent cross-fade does not. */}
        {slides.length > 1 && (
          <span className="shop-promo-dots" aria-hidden="true">
            {slides.map((x, n) => (
              <i key={x.id} data-on={n === i} />
            ))}
          </span>
        )}
      </button>

      {/*
        ─── THE CREDIT IS A LICENCE OBLIGATION, NOT A CAPTION ────────────────
        Every one of these photographs is Creative Commons with
        `AttributionRequired: true` — read from the Commons API, not assumed.
        CC-BY and CC-BY-SA both require naming the author wherever the work
        appears. Omitting it because it is small print would be a copyright
        violation, so it renders on the banner itself rather than in a
        credits page nobody opens.
      */}
      <span className="shop-promo-credit">
        © {s.img.credit} · {s.img.licence}
      </span>
    </div>
  );
}
