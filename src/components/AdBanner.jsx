import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useStill } from './AnimatedIcon';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useTelegram } from '../context/TelegramContext';
import { IconChevronRight, IconExternal } from './Icons';

/**
 * Promo banner.
 *
 * These are HOUSE ADS — they point at our own screens, which is the honest
 * thing to run before any ad network is integrated. Every slot drives users
 * toward the parts of the app that actually generate the 0.5% fee, so the
 * banner earns its screen space rather than just filling it.
 *
 * If you later sell placements to third parties, label them as sponsored.
 * An unlabelled paid ad inside a finance app is a regulatory problem in most
 * markets, and users who feel tricked don't come back.
 */

/*
 * Each slot carries TWO palettes.
 *
 * `hues` is the neon pair, which is built to glow against black. On a white
 * card those same colours measure 1.3-1.8:1 against their own background —
 * WCAG AA wants 4.5:1 for text — so the CTA label and border were effectively
 * invisible in light theme. That is the "banners are washed out" bug.
 *
 * `inks` are the same hues with the lightness lowered until each measures at
 * least 4.5:1 on white. They are only used for things that must be READ.
 *
 * This has to live here rather than in a CSS override because the component
 * sets `--ad-a` as an inline style, and an inline custom property beats any
 * stylesheet rule — a `:root[data-theme='light']` block could never win.
 */
const SLOTS = {
  swap: { to: '/swap', hues: ['#00e5ff', '#7c4dff'], inks: ['#008392', '#6a3ae0'], icon: '⇄' },
  farm: { to: '/farm', hues: ['#00ff9d', '#00e5ff'], inks: ['#008854', '#008392'], icon: '◈' },
  signals: { to: '/signals', hues: ['#7c4dff', '#ff2d95'], inks: ['#6a3ae0', '#e70073'], icon: '✦' },
  p2p: { to: '/p2p', hues: ['#ffb300', '#ff6d00'], inks: ['#9d6e00', '#c55400'], icon: '⇅' },
  referral: { to: '/earn', hues: ['#ff2d95', '#d500f9'], inks: ['#e70073', '#c800ea'], icon: '★' }
};

export default function AdBanner({ slot = 'swap', compact = false, external = null }) {
  /*
   * FREEZE THE BANNER ON NATIVE AND UNDER REDUCED MOTION.
   *
   * This component ran EIGHT `repeat: Infinity` animations - a pulsing glow, a
   * floating SVG, and six looping details - and it is rendered on nine pages
   * including Market, Swap and Wallet. Every one of those screens therefore
   * carried eight permanent animation timers on top of the three blurred
   * background orbs.
   *
   * `useStill()` already existed for exactly this and the banner simply never
   * called it. That is the whole bug: not a missing feature, an unused one.
   */
  const still = useStill() || (typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.()));
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic, tg } = useTelegram();

  const cfg = SLOTS[slot] ?? SLOTS.swap;

  // Deterministic shimmer offset so multiple banners on one screen aren't
  // animating in lockstep — that reads as a glitch rather than a design.
  const delay = useMemo(() => (slot.charCodeAt(0) % 5) * 0.4, [slot]);

  const go = () => {
    haptic?.('light');
    if (external) {
      if (tg?.openLink) tg.openLink(external);
      else window.open(external, '_blank', 'noopener,noreferrer');
    } else {
      navigate(cfg.to);
    }
  };

  return (
    <motion.button
      className="ad-banner"
      onClick={go}
      whileTap={{ scale: 0.985 }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{
        '--ad-a': cfg.hues[0],
        '--ad-b': cfg.hues[1],
        /*
         * The ARTWORK colours, seeded to the neon pair. Dark theme uses them
         * as-is; the light-theme block in index.css redefines these two to
         * the readable inks. Kept separate from --ad-a/--ad-b so the glow and
         * the tint can stay neon-derived while the drawn strokes go dark —
         * a soft 35%-opacity glow is fine on white, a 1.3:1 stroke is not.
         */
        '--ad-art-a': cfg.hues[0],
        '--ad-art-b': cfg.hues[1],
        // Readable variants for text/borders; the stylesheet picks these up
        // in light theme only. See SLOTS.
        '--ad-ink': cfg.inks[0],
        '--ad-ink-b': cfg.inks[1],
        padding: compact ? '11px 13px' : '14px 15px'
      }}
    >
      <span className="ad-shine" style={{ animationDelay: `${delay}s` }} />

      {/* Animated illustration. Inline SVG keeps it on-theme and weightless —
          a raster image would clash with the RGB palette and bloat the APK. */}
      <span className="ad-art" aria-hidden="true">
        <motion.span
          className="ad-art-glow"
          animate={still ? { scale: 1, opacity: 0.45 } : { scale: [1, 1.25, 1], opacity: [0.35, 0.6, 0.35] }}
          transition={still ? { duration: 0 } : { duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.svg
          viewBox="0 0 40 40"
          width="40"
          height="40"
          fill="none"
          animate={still ? { y: 0, rotate: 0 } : { y: [0, -3, 0], rotate: [0, 4, 0] }}
          transition={still ? { duration: 0 } : { duration: 4, repeat: Infinity, ease: 'easeInOut', delay }}
          style={{ position: 'relative', zIndex: 1 }}
        >
          <defs>
            {/*
              ─── THE ICON GRADIENT READS A CSS VARIABLE, NOT A HUE ────────
              Reported: «در پایین صفحه فارم یک بنر تبلیغاتی هست که ایکون و
              رنگ‌بندی در تم سفید اشتباهه».

              The banner's TEXT and border were already fixed for light theme
              by swapping in the darker `inks`. The ARTWORK was not, and the
              reason is structural: these two stops hard-coded `cfg.hues` —
              the neon pair — straight into the DOM from JSX. No stylesheet
              rule can reach an SVG stop attribute, so the
              `:root[data-theme='light']` block a few lines away in index.css
              was powerless over the one part of the banner made entirely of
              colour.

              Measured, which is why this is a bug and not a taste argument:
              farm's neon pair is #00ff9d and #00e5ff, which come out at
              1.30:1 and 1.42:1 against white. WCAG AA wants 4.5:1. The
              stroked icon was very nearly invisible — worst on Farm, because
              mint-on-white is the weakest pair in the set, which is exactly
              the screen the report names.

              Pointing the stops at a custom property fixes it with no theme
              detection in JavaScript: the component already sets these
              inline, and index.css already knows what they should be per
              theme. SVG `stop-color` resolves CSS variables, so the artwork
              now follows the theme the same way the text does — one source
              of truth instead of two that drift apart.

              The fallback chain matters: if `--ad-art-a` is somehow not set,
              it falls back to `--ad-a`, which is always set inline. A stop
              that fails to resolve renders BLACK, so a missing variable here
              would be a very visible regression.
            */}
            <linearGradient id={`adg-${slot}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--ad-art-a, var(--ad-a))" />
              <stop offset="100%" stopColor="var(--ad-art-b, var(--ad-b))" />
            </linearGradient>
          </defs>

          {slot === 'swap' && (
            <>
              <circle cx="20" cy="20" r="14" stroke={`url(#adg-${slot})`} strokeWidth="2.2" />
              <motion.path
                d="M13 17h12l-3.5-3.5M27 23H15l3.5 3.5"
                stroke={`url(#adg-${slot})`}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                animate={{ pathLength: [0.3, 1, 0.3] }}
                transition={still ? { duration: 0 } : { duration: 3, repeat: Infinity }}
              />
            </>
          )}

          {slot === 'farm' && (
            <>
              <ellipse cx="20" cy="12" rx="11" ry="4" stroke={`url(#adg-${slot})`} strokeWidth="2.2" />
              <motion.path
                d="M9 12v8c0 2.2 4.9 4 11 4s11-1.8 11-4v-8"
                stroke={`url(#adg-${slot})`}
                strokeWidth="2.2"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={still ? { duration: 0 } : { duration: 2.6, repeat: Infinity }}
              />
              <motion.path
                d="M9 20v8c0 2.2 4.9 4 11 4s11-1.8 11-4v-8"
                stroke={`url(#adg-${slot})`}
                strokeWidth="2.2"
                animate={{ opacity: [1, 0.5, 1] }}
                transition={still ? { duration: 0 } : { duration: 2.6, repeat: Infinity }}
              />
            </>
          )}

          {slot === 'signals' && (
            <motion.path
              d="M5 27l7-8 6 5 9-12 8 7"
              stroke={`url(#adg-${slot})`}
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              animate={{ pathLength: [0, 1] }}
              transition={still ? { duration: 0 } : { duration: 2.4, repeat: Infinity, repeatType: 'reverse' }}
            />
          )}

          {slot === 'p2p' && (
            <>
              <circle cx="12" cy="14" r="5" stroke={`url(#adg-${slot})`} strokeWidth="2.2" />
              <circle cx="28" cy="26" r="5" stroke={`url(#adg-${slot})`} strokeWidth="2.2" />
              <motion.path
                d="M16 18l8 4"
                stroke={`url(#adg-${slot})`}
                strokeWidth="2.2"
                strokeLinecap="round"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={still ? { duration: 0 } : { duration: 1.8, repeat: Infinity }}
              />
            </>
          )}

          {slot === 'referral' && (
            <motion.path
              d="M20 6l4.2 8.6 9.5 1.4-6.9 6.7 1.7 9.4L20 27.6l-8.5 4.5 1.7-9.4-6.9-6.7 9.5-1.4z"
              stroke={`url(#adg-${slot})`}
              strokeWidth="2.2"
              strokeLinejoin="round"
              animate={{ rotate: [0, 12, 0], scale: [1, 1.08, 1] }}
              transition={still ? { duration: 0 } : { duration: 4.5, repeat: Infinity }}
              style={{ transformOrigin: '20px 20px' }}
            />
          )}
        </motion.svg>
      </span>

      <span style={{ flex: 1, minWidth: 0, textAlign: 'start' }}>
        <span style={{ display: 'block', fontWeight: 700, fontSize: compact ? 12.5 : 13.5 }}>
          {t(`ads.${slot}.title`)}
        </span>
        {!compact && (
          <span className="set-row-sub" style={{ marginTop: 2 }}>
            {t(`ads.${slot}.body`)}
          </span>
        )}
      </span>

      <span className="ad-cta">
        {t(`ads.${slot}.cta`)}
        {external ? <IconExternal width={13} height={13} /> : <IconChevronRight width={14} height={14} />}
      </span>
    </motion.button>
  );
}
