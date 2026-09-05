import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { openUrl } from '../lib/browser';
import { IconInstagram, IconLinkedin, IconMail, IconXLogo } from '../components/Icons';
import { SUPPORT_MAILTO } from '../lib/contact';
import GalaxyBackdrop from '../components/GalaxyBackdrop';
import FluidBackdrop, { fluidSupported } from '../components/FluidBackdrop';

/*
 * The same accounts Contact links to — deliberately not a second, invented
 * list. Two sources of truth for "where to find us" is how one of them ends
 * up pointing at a dead handle.
 */
const SOCIALS = [
  { id: 'x', url: 'https://x.com/CompanyFbt', Icon: IconXLogo, label: 'X' },
  { id: 'linkedin', url: 'https://www.linkedin.com/in/mohammad-shiravi-a8891321b', Icon: IconLinkedin, label: 'LinkedIn' },
  { id: 'instagram', url: 'https://www.instagram.com/fbt_company_', Icon: IconInstagram, label: 'Instagram' },
  { id: 'email', url: SUPPORT_MAILTO, Icon: IconMail, label: 'Email' }
];

/**
 * SPLASH — the first thing anyone sees.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The old first-run flow asked for a language twice: once on Welcome, then
 * again as step 0 of Onboarding. Two consecutive screens asking the same
 * question reads as a bug, and it is the worst possible first impression —
 * before the user has seen anything the product does, they have already been
 * made to repeat themselves.
 *
 * So the duplicate is gone and this takes its place: one branded moment, then
 * straight into the app. Language and name stay together on Welcome, which is
 * where they belong — the name field's own label is unreadable until the
 * language is right.
 *
 * ─── THE BACKDROP ───────────────────────────────────────────────────────────
 * Requested: the starfield behind this screen should become an interactive
 * fluid — colours that swirl and change as the hand moves across the screen —
 * with no foreign branding, and without slowing the app down.
 *
 * So the backdrop is a WebGL2 fluid (FluidBackdrop.jsx) whenever the device
 * can run one, and the galaxy starfield otherwise. The fluid is shown ONLY
 * here, never behind Welcome/Onboarding/the Guide, and it is destroyed the
 * moment the user taps Start — the whole engine (context, loop, listeners)
 * unmounts with the screen, so the seconds it costs are the seconds the user
 * is actually looking at it. Devices without WebGL2 float targets, or with
 * reduced motion requested (Android battery saver forces it), get the galaxy
 * — which renders static in that case.
 *
 * Everything else here is a one-shot entrance: the only looping DOM element
 * is the slow ring rotation, and it stops mattering when the screen unmounts.
 * `useReducedMotion` is honoured for the same reason it always was — a
 * spinning, pulsing first screen is a genuine accessibility problem, and this
 * is the one screen nobody can skip.
 */
export default function Splash({ onStart, hideGalaxy }) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();

  // Decided once, before first paint, so the screen never flashes one backdrop
  // and then swaps to the other. `fluidSupported()` is a cheap one-off probe
  // that also bails out for reduced-motion users.
  const [fluid] = useState(() => fluidSupported());

  // With reduced motion the mark simply appears; nothing rotates or breathes.
  const ringSpin = reduce
    ? {}
    : { rotate: 360, transition: { duration: 18, repeat: Infinity, ease: 'linear' } };

  return (
    <div className="splash">
      {/* The backdrop: an interactive WebGL fluid when the device can run one,
          the drawn galaxy otherwise (see FluidBackdrop.jsx for why a video was
          the wrong build — the same reasoning that originally kept the galaxy
          drawn still holds). */}
      {!hideGalaxy && (fluid ? <FluidBackdrop /> : <GalaxyBackdrop />)}

      {/* Soft colour wash over the backdrop, tying it to the brand hues. */}
      <div className="splash-glow" aria-hidden="true" />

      <div className="splash-center">
        <motion.div
          className="splash-mark"
          initial={reduce ? { opacity: 0 } : { scale: 0.72, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 16 }}
        >
          {/* Orbiting ring — the only looping element on the screen. */}
          <motion.span className="splash-ring" animate={ringSpin} aria-hidden="true" />

          <svg viewBox="0 0 24 24" width="46" height="46" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="splashGrad" x1="0" y1="0" x2="24" y2="24">
                <stop offset="0%" stopColor="#00e5ff" />
                <stop offset="55%" stopColor="#7c4dff" />
                <stop offset="100%" stopColor="#ff2d95" />
              </linearGradient>
            </defs>
            <motion.circle
              cx="12" cy="12" r="9"
              stroke="url(#splashGrad)" strokeWidth="1.8"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
            {/*
              An "F" for FBT. This was a "B" — the glyph was drawn with two
              stacked bowls, which is the wrong initial for the product.
              Three strokes: the stem, the top arm, the middle arm.
            */}
            <motion.path
              d="M9.6 7.2v9.6M9.6 7.2h5.2M9.6 11.6h4.2"
              stroke="url(#splashGrad)" strokeWidth="1.9"
              strokeLinecap="round" strokeLinejoin="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.35, ease: 'easeOut' }}
            />
          </svg>
        </motion.div>

        <motion.h1
          className="splash-name"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          FBT&nbsp;Swap
        </motion.h1>

        <motion.p
          className="splash-tag"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.58, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          {t('splash.tagline')}
        </motion.p>
      </div>

      <motion.div
        className="splash-foot"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.75, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.button
          type="button"
          className="btn btn-primary splash-btn"
          whileTap={{ scale: 0.97 }}
          onClick={onStart}
          autoFocus
        >
          {t('splash.start')}
        </motion.button>

        {/*
          Social links under Start.
          
          openUrl (Custom Tabs) rather than window.open: inside the packaged
          app a bare WebView hides the address bar, so the user cannot see
          which domain they landed on — and a wallet vouching for an
          unverifiable page is a phishing surface. mailto: falls through to the
          OS handler, which openUrl already accounts for.
        */}
        <div className="splash-socials">
          {SOCIALS.map(({ id, url, Icon, label }) => (
            <button
              key={id}
              type="button"
              className="splash-social"
              onClick={() => {
                /*
                 * openUrl only accepts https - by design, so no caller can
                 * introduce a javascript: or data: link. mailto: is therefore
                 * REJECTED by it and the button would have looked live and
                 * done nothing. Hand mail to the OS handler directly.
                 */
                if (url.startsWith('mailto:')) window.location.href = url;
                else openUrl(url);
              }}
              aria-label={label}
            >
              <Icon width={18} height={18} />
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
