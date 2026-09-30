import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import TokenIcon from '../lib/tokenIcon';
import { fmtPct, fmtUsd } from '../lib/format';
import { swapTargetFor, swapUrlFor } from '../lib/coinToSwap';
import { cachedCoinVenue } from '../lib/coinVenues';
import { venueRoute } from '../lib/coinVenue';
import { useSwapDockStore } from '../store/useSwapDockStore';
import '../styles/swap-dock.css';

/**
 * THE STICKY SWAP DOCK — a coin's trade button, pinned to the bottom edge.
 * ---------------------------------------------------------------------------
 * Asked for: «در صفحه هر توکن میایی منو پایین صفحه محو و دکمه زیبا و ندرن
 * سواپ ظاهر شود و دکمه داخل صففحه بیاد پایین صفحه مثل یونی سواپ».
 *
 * ─── WHY IT APPEARS ON SCROLL, NOT ON LOAD ──────────────────────────────────
 * The page ALREADY has a Buy/Sell pair mid-screen, right under the history
 * panel — where a leveraged reader expects it. A dock sitting under the hero
 * from the first frame would be the same button twice, one of them covering
 * the chart.
 *
 * So the dock is the SECOND copy, and it earns its place by arriving when the
 * first one has scrolled away: the user has read the price, the range and the
 * history, and has reached the bottom of the decision. That is exactly the
 * moment Uniswap shows its own, and the moment the bottom nav has stopped
 * being what this page is for.
 *
 * ─── IT TAKES THE NAV'S PLACE, IT DOES NOT COVER IT ────────────────────────
 * The store in `useSwapDockStore` is what makes the bottom nav fade: two
 * fixed, blurred, overlapping bars at the bottom of a phone is a layout
 * accident, not a design. The dock and the nav are never both on screen.
 *
 * ─── THE SAME RESOLUTION THE PAGE USES, NEVER A NEW ONE ───────────────────
 * Curated contract first (hand-verified, offline, cheapest chain), the
 * resolved venue second, and NOTHING when neither answers. A dock that
 * appeared over every token and led to a swap screen which then refused the
 * route would be worse than no dock: it converts a clear dead end into a
 * misleading button.
 */

/** How far down the page the dock waits before it takes over. */
const REVEAL_AFTER_PX = 420;

/** How close to the bottom the page has to be for the dock to be worth pinning. */
const HIDE_FROM_BOTTOM_PX = 160;

export default function SwapDock({ coin, route, side = 'buy' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const acquire = useSwapDockStore((s) => s.acquire);
  const release = useSwapDockStore((s) => s.release);
  const [shown, setShown] = useState(false);
  /* The scroll listener is passive and fires on every frame of a fling; the
     decision must not re-render the tree 60 times a second, so the boolean
     only changes when it actually flips. */
  const shownRef = useRef(false);

  const swapUrl = useCallback(() => {
    if (!coin?.id) return null;
    /* 1. curated — instant, offline, hand-verified. */
    if (swapTargetFor(coin.id)) return swapUrlFor(coin.id, side);
    /* 2. resolved — the market list may already have asked and cached it, in
          which case this is free; otherwise the coin page's own lookup will
          have filled the same cache by the time anyone scrolls this far. */
    const venue = cachedCoinVenue(coin.id);
    if (venue?.tradeable) return venueRoute(venue, { side })?.href ?? null;
    /* 3. honestly absent. */
    return null;
  }, [coin?.id, side]);

  const href = swapUrl();

  useEffect(() => {
    if (!href) return undefined;
    let alive = true;
    const decide = () => {
      const y = window.scrollY || window.pageYOffset || 0;
      const doc = document.documentElement;
      const max = Math.max(0, (doc.scrollHeight || 0) - (window.innerHeight || 0));
      /* Show once the in-page buttons are out of sight, hide again near the
         very bottom where the page's own footer content is being read. */
      const next = y > REVEAL_AFTER_PX && (max === 0 || y < max - HIDE_FROM_BOTTOM_PX);
      if (next === shownRef.current) return;
      shownRef.current = next;
      setShown(next);
    };
    decide();
    window.addEventListener('scroll', decide, { passive: true });
    window.addEventListener('resize', decide, { passive: true });
    return () => {
      alive = false;
      window.removeEventListener('scroll', decide);
      window.removeEventListener('resize', decide);
      void alive;
    };
  }, [href]);

  /* The nav yields the edge only while the dock is actually painted — a bar
     that fades in over 250ms and the nav that fades out over the same should
     hand over at the same moment, not 250ms apart. */
  useEffect(() => {
    if (!shown) return undefined;
    acquire();
    return () => release();
  }, [shown, acquire, release]);

  if (!href || !coin) return null;

  const up = (coin.change24h ?? 0) >= 0;

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          className="swap-dock"
          data-testid="swap-dock"
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.7 }}
          role="region"
          aria-label={t('coin.swapDockAria', { symbol: coin.symbol })}
        >
          <div className="swap-dock-glow" aria-hidden="true" />
          <div className="swap-dock-row">
            <div className="swap-dock-coin">
              <TokenIcon token={{ symbol: coin.symbol, image: coin.image }} size={30} />
              <div className="swap-dock-meta">
                <span className="swap-dock-sym">{coin.symbol}</span>
                <span className="swap-dock-price mono">
                  {coin.price > 0 ? fmtUsd(coin.price) : '—'}
                  {Number.isFinite(Number(coin.change24h)) && (
                    <i className={up ? 'up' : 'down'}>{fmtPct(coin.change24h)}</i>
                  )}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="swap-dock-btn"
              onClick={() => navigate(href)}
              data-testid="swap-dock-buy"
            >
              <span className="swap-dock-btn-ico" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 16 3 12l4-4" /><path d="M3 12h11a5 5 0 0 1 5 5v1" /><path d="m17 8 4 4-4 4" />
                </svg>
              </span>
              {t('trade.buy')} {coin.symbol}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { REVEAL_AFTER_PX, HIDE_FROM_BOTTOM_PX };
