import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { openUrl, isSafeUrl } from '../lib/browser';
import { IconInstagram, IconLinkedin, IconBriefcase, IconMail, IconXLogo } from '../components/Icons';
import { SOCIAL_CHANNELS, isMailChannel } from '../lib/socials';
import GalaxyBackdrop from '../components/GalaxyBackdrop';
import FluidBackdrop, { fluidSupported } from '../components/FluidBackdrop';

/*
 * The same accounts Contact links to — imported, not copied. The copy had
 * already drifted (no Crunchbase, and English `label` strings on a screen that
 * renders in twelve languages), which is exactly how a duplicated list rots.
 */
const SOCIALS = SOCIAL_CHANNELS;

/* The glyph lives with the screen, the channel list does not: lib/socials.js is
 * plain data so a server-side render or a test can import it without React. */
const SOCIAL_MARKS = {
  x: IconXLogo,
  linkedin: IconLinkedin,
  instagram: IconInstagram,
  crunchbase: IconBriefcase,
  email: IconMail
};

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
          {SOCIALS.map(({ id, url, mark }) => {
            const Icon = SOCIAL_MARKS[id] ?? IconMail;
            return (
              /*
               * An <a href>, not a button with an onClick: on the launch screen
               * there is no page to come back to, so a refused opener used to
               * leave the user on a screen with a dead icon. The href is the
               * floor; openUrl is the improvement that puts the link in a Custom
               * Tab (visible address bar) when the shell can provide one.
               *
               * openUrl only accepts https - by design, so no caller can
               * introduce a javascript: or data: link. mailto: is REJECTED by
               * it, so mail is left to the anchor itself.
               */
              <a
                key={id}
                href={url}
                className="splash-social"
                {...(isMailChannel({ url }) || !isSafeUrl(url) ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                aria-label={t(`contact.social.${id}`)}
                title={t(`contact.social.${id}`)}
                onClick={(event) => {
                  if (isMailChannel({ url })) return;
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  if (!isSafeUrl(url)) return;
                  event.preventDefault();
                  openUrl(url);
                }}
              >
                <Icon width={18} height={18} />
              </a>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
