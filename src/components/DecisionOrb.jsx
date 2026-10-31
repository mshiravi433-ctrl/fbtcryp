import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { isRtl } from '../i18n/languages';
import { marketDecision } from '../lib/marketDecision';
import { GlyphRisk, GlyphTrendUp, GlyphTrendDown, GlyphInfo } from './market/MarketGlyphs.jsx';
import '../styles/decision-orb.css';

/**
 * MARKET PULSE — the edge instrument on the market screen.
 * ---------------------------------------------------------------------------
 * «دایره که روش می‌زنی بعد از ۲۰ ثانیه ناپدید شود، یا دست را می‌زنی در قسمت‌های
 *  دیگر صفحه ناپدید شود، و با توجه به زبان تغییر کند»
 *
 * Three separate complaints, three separate fixes:
 *
 * ─── 1. IT LINGERED ────────────────────────────────────────────────────────
 * The old timeout closed the RAIL after 20 seconds and left the toggle on the
 * edge for the rest of the session. On a phone that is a permanent circle over
 * the market list — an instrument nobody asked for, drawing the eye away from
 * prices and eating a slice of every tap near the left edge.
 *
 * Now the 20 s budget belongs to the WHOLE instrument: when it expires the rail
 * closes AND the toggle fades out and unmounts. The same happens for a tap
 * anywhere outside it — that is the gesture the owner described («دست را می‌زنی
 * در قسمت‌های دیگر صفحه»), and it is how every transient surface in this app
 * already behaves. Once dismissed it stays gone for this visit; opening the
 * market screen again brings it back, so it is still discoverable.
 *
 * Tapping the circle ITSELF while open only folds the rail, which is the
 * convention a disclosure toggle implies — a tap on the control must not make
 * the control vanish under your finger.
 *
 * ─── 2. IT WAS GLUED TO ONE EDGE, IN EVERY LANGUAGE ────────────────────────
 * It was `left: 0` in Farsi, where the reading column starts on the RIGHT: the
 * instrument sat in the gutter past the end of every line, on the far side from
 * the thumb, and its chevron pointed at nothing. It now follows the document
 * direction (`dir` from i18n) through logical properties: right edge in Farsi
 * and Arabic, left edge in English and the rest, with the rail's rounded side,
 * border and chevron all mirrored — and it re-mirrors live if the language is
 * switched while the screen is open, because `dir` is read from the document
 * and re-read on every language change.
 *
 * ─── 3. NO CLOSE-FEEDBACK ──────────────────────────────────────────────────
 * Everything is one CSS transition on the wrapper (`transform` + `opacity`,
 * compositor-only), so dismissing costs no frames and leaves no timer behind:
 * one timeout, cleared on every state change and on unmount.
 *
 * The metrics themselves are unchanged — see lib/marketDecision for what the
 * three rings measure and why they are honest about not being a prediction.
 *
 * ─── 4. ITS THREE MARKS WERE TYPED GLYPHS (2026-10-31) ──────────────────────
 * The diamond, the two diagonals and the information mark all arrived as text
 * artwork: a different weight and a different baseline on every platform, and a
 * colour that could not follow the ring they sit in. They are drawn now, from
 * the same market sheet as the rest of the screen, and each one takes
 * `currentColor` so the glyph wears its own metric's hue.
 */

/** One drawn mark per ring, keyed the way lib/marketDecision keys the metrics. */
const PULSE_MARKS = { risk: GlyphRisk, buy: GlyphTrendUp, sell: GlyphTrendDown };

/** How long the instrument may stay open before it takes itself off the edge. */
const AUTO_DISMISS_MS = 20_000;

/** Matches the fade in decision-orb.css; the unmount waits for it. */
const EXIT_MS = 320;

export default function DecisionOrb({ coins = [], updatedAt = 0, unavailable = false, onOpenChange }) {
  const { t, i18n } = useTranslation();

  /* The document direction is the single source of truth (i18n/index.js sets
     it on <html>); reading the language is what makes this component re-render
     — and therefore re-mirror — the moment it changes. */
  const lang = String(i18n.resolvedLanguage || i18n.language || 'fa').split('-')[0];
  const rtl = isRtl(lang);

  const [open, setOpen] = useState(false);
  /* 'live' to 'leaving' (fade out) to 'gone' (unmounted). */
  const [phase, setPhase] = useState('live');
  const [now, setNow] = useState(() => Date.now());
  const toggleRef = useRef(null);
  const exitTimer = useRef(null);

  const metrics = useMemo(() => marketDecision(coins), [coins]);
  const stale = unavailable || !updatedAt || now - updatedAt > 120000;
  const gone = phase !== 'live';

  /* One 15 s clock for freshness only — it never touches the layout. */
  useEffect(() => {
    if (gone) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [gone]);

  /* Report the open state so the page can reserve room beside the rail. */
  useEffect(() => {
    onOpenChange?.(open && !gone);
  }, [open, gone, onOpenChange]);

  useEffect(() => () => {
    if (exitTimer.current) window.clearTimeout(exitTimer.current);
  }, []);

  /**
   * Dismiss the whole instrument. `restoreFocus` is true only for the Escape
   * key, because a pointer dismissal has already moved focus somewhere else
   * and yanking it back to a button that no longer exists would strand it.
   */
  const dismiss = useCallback(({ restoreFocus = false } = {}) => {
    setOpen(false);
    setPhase((p) => (p === 'live' ? 'leaving' : p));
    if (exitTimer.current) window.clearTimeout(exitTimer.current);
    exitTimer.current = window.setTimeout(() => setPhase('gone'), EXIT_MS);
    if (restoreFocus) toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open || gone) return undefined;

    /* ── the 20-second budget ───────────────────────────────────────────── */
    const budget = window.setTimeout(() => dismiss(), AUTO_DISMISS_MS);

    /* ── a tap anywhere else ───────────────────────────────────────────── */
    const onPointerDown = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.dor')) return;
      dismiss();
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      dismiss({ restoreFocus: true });
    };

    /*
     * `capture` so the dismissal wins before the tapped row's own handler
     * navigates: the instrument goes away AND the tap still does what it
     * looked like it would do. Nothing is swallowed.
     */
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(budget);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, gone, dismiss]);

  /* Re-opening after a language change must start from the mirrored side, so
     a fresh mount is never needed. */
  useEffect(() => { setPhase('live'); }, [lang]);

  /**
   * The circle's own tap. While it is fading out, a tap CANCELS the dismissal
   * instead of being swallowed: the instrument is still on screen (pointer
   * events stay live until the fade ends), and a control that ignores a tap
   * delivered to it is the exact "the button does nothing" bug this app has
   * fixed before. A tap on an OPEN circle only folds the rail — it must not
   * make the control vanish under the finger.
   */
  const onToggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    if (exitTimer.current) {
      window.clearTimeout(exitTimer.current);
      exitTimer.current = null;
    }
    setPhase('live');
    setOpen(true);
  }, [open]);

  if (phase === 'gone' || typeof document === 'undefined') return null;

  const value = (metric) => (stale ? null : metric.value);

  return createPortal(
    <aside
      className={`dor${open ? ' is-open' : ''}${phase === 'leaving' ? ' is-leaving' : ''}`}
      data-side={rtl ? 'end' : 'start'}
      dir={rtl ? 'rtl' : 'ltr'}
      aria-label={t('market.pulse.title')}
    >
      <button
        ref={toggleRef}
        className="dor-toggle"
        type="button"
        aria-label={open ? t('market.pulse.close') : t('market.pulse.open')}
        aria-expanded={open}
        aria-controls="market-decision-rail"
        onClick={onToggle}
      >
        {/*
          The chevron is drawn, not typed: a text «‹/›» is at the mercy of the
          font's bidi mirroring, which flipped it twice in Farsi. One path,
          rotated by CSS for the open state and by direction for the side.
        */}
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
          <path d="M9 5.5 15.5 12 9 18.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div id="market-decision-rail" className="dor-rail" hidden={!open}>
        <span className="dor-caption">{t('market.pulse.caption')}</span>
        {metrics.map((metric) => {
          const v = value(metric);
          const label = t(`market.pulse.metric.${metric.key}`);
          return (
            <div className="dor-metric" key={metric.key} title={t('market.pulse.metricTitle', { label, count: metric.count })}>
              <span
                className="dor-ring"
                style={{ '--ring-color': metric.color, '--ring-value': `${v === null ? 0 : Math.min(100, v)}%` }}
                aria-hidden="true"
              >
                {(() => {
                  const Mark = PULSE_MARKS[metric.key] || GlyphRisk;
                  return <Mark width={15} height={15} />;
                })()}
              </span>
              <strong dir="ltr">{v === null ? '—' : `${v.toFixed(1)}%`}</strong>
              <span className="dor-label">{label}</span>
            </div>
          );
        })}
        <span className="dor-status" role="status">{stale ? t('market.pulse.stale') : t('market.pulse.live')}</span>
        <details className="dor-info">
          <summary aria-label={t('market.pulse.method')}>
            <GlyphInfo width={13} height={13} />
          </summary>
          <p>{t('market.pulse.explanation', { moves: metrics[1].count, ranges: metrics[0].count })}</p>
        </details>
      </div>
    </aside>,
    document.body
  );
}
