import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  historyFacts, historyOverview, levelLadder, rangePosition, dailyMoves
} from '../lib/history';
import { fmtPrice } from '../lib/format';

/**
 * "WHAT THE PAST SAYS" — the readable half of lib/history.js.
 *
 * ─── WHY THE NUMBERS ARE FORMATTED HERE AND NOT IN THE ENGINE ───────────────
 * `historyFacts()` returns raw numbers and a translation key. It never builds
 * a sentence, because a module that formats its own strings cannot be
 * translated, and this app ships in twelve languages with two of them
 * right-to-left.
 *
 * So the engine measures and this component renders. It also means the maths
 * can be unit-tested without a DOM.
 *
 * ─── WHAT CHANGED IN THIS REVISION, AND WHY ─────────────────────────────────
 * Asked for: «گذشته چه میگوید را باکس را مدرن‌تر و اطلاعات را بهتر و باهوش‌تر
 * و درست‌تر کن و با تحلیل‌های به‌روز و درست‌تر» — a more modern box, with
 * better, smarter, more accurate analysis.
 *
 * The old panel was a flat bullet list of six sentences. Three things were
 * wrong with that beyond the styling:
 *
 *   1. IT NEVER SAID HOW MUCH EVIDENCE SAT UNDER THE SENTENCES. Every figure
 *      is measured from a window, and a reader who cannot see the sample size
 *      has to guess. The header now states the sample count and how many
 *      repeated levels the market actually produced, both from `historyOverview`.
 *   2. IT COULD NOT SHOW WHERE THE PRICE IS. "Trading at 33% of its range" is a
 *      sentence; the same measurement as a bar with the current price marked
 *      on it is read in a glance. Nothing is added to the measurement — only
 *      to how it is presented.
 *   3. IT NAMED ONE LEVEL AND NO DISTANCE. `levelLadder()` now reports the
 *      nearest levels with their distance from the current price and their own
 *      held/tested record, so the panel can show "support 3.1% below, held 3
 *      of 4" instead of leaving the reader to subtract two numbers.
 *
 * Every value on this panel is a count, a frequency, a distance or a share
 * measured from prices that already printed. There is still no forecast, and
 * `kind` still has no bullish/bearish value — see the header of lib/history.js
 * for why that rule is not cosmetic.
 *
 * ─── WHY IT RENDERS NOTHING RATHER THAN A PLACEHOLDER ───────────────────────
 * A new or thinly-traded coin genuinely has nothing to say. Showing an empty
 * panel with a spinner implies data is coming that never will; showing
 * invented filler would be worse. When there are no facts, there is no panel.
 */

/** The icon per fact family — a glyph, never a colour that means "buy". */
const FACT_ICONS = {
  levelSupport: 'level',
  levelResistance: 'level',
  levelDistance: 'ruler',
  rangePosition: 'range',
  maxDrawdown: 'drawdown',
  drawdownRecovered: 'recovery',
  volatility: 'wave',
  streak: 'streak',
  aboveAverage: 'average',
  volumeHigh: 'volume',
  volumeLow: 'volume',
  baseRate: 'sample'
};

function FactIcon({ id }) {
  const kind = FACT_ICONS[id] ?? 'sample';
  const common = {
    width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': true
  };
  if (kind === 'level') {
    return (
      <svg {...common}>
        <path d="M3 8h11M3 16h7" />
        <path d="M18 5v14" />
        <path d="M15 12h6" />
      </svg>
    );
  }
  if (kind === 'ruler') {
    return (
      <svg {...common}>
        <path d="M4 14 14 4l6 6L10 20z" />
        <path d="M8.5 9.5l1.6 1.6M11.5 6.5l1.6 1.6M5.5 12.5l1.6 1.6" />
      </svg>
    );
  }
  if (kind === 'range') {
    return (
      <svg {...common}>
        <path d="M4 12h16" />
        <path d="M7 9v6M17 9v6" />
        <circle cx="11" cy="12" r="2.2" />
      </svg>
    );
  }
  if (kind === 'drawdown') {
    return (
      <svg {...common}>
        <path d="M3 6l5 6 4-3 4 7 5-4" />
        <path d="M17 19h4v-4" />
      </svg>
    );
  }
  if (kind === 'recovery') {
    return (
      <svg {...common}>
        <path d="M3 18l5-6 4 3 4-7 5 4" />
        <path d="M17 5h4v4" />
      </svg>
    );
  }
  if (kind === 'wave') {
    return (
      <svg {...common}>
        <path d="M2 12c2.5-5 5-5 7.5 0s5 5 7.5 0 5-5 5-5" />
        <path d="M2 17c2.5-5 5-5 7.5 0s5 5 7.5 0 5-5 5-5" opacity="0.45" />
      </svg>
    );
  }
  if (kind === 'streak') {
    return (
      <svg {...common}>
        <path d="M12 3v18" />
        <path d="M12 8l4-4M12 8L8 4" />
        <path d="M12 16l4 4M12 16l-4 4" />
      </svg>
    );
  }
  if (kind === 'average') {
    return (
      <svg {...common}>
        <path d="M3 17c3 0 4-11 9-11s6 11 9 11" />
        <path d="M3 12h18" strokeDasharray="2 3" opacity="0.6" />
      </svg>
    );
  }
  if (kind === 'volume') {
    return (
      <svg {...common}>
        <path d="M5 20V10M11 20V5M17 20v-7M3 20h18" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </svg>
  );
}

/** A small always-visible stat pill for the header. */
function Chip({ label, value }) {
  return (
    <span className="hist-chip">
      <span className="hist-chip-label">{label}</span>
      <span className="hist-chip-value">{value}</span>
    </span>
  );
}

export default function HistoryPanel({ series, days = 90, volume, volumeHistory, compact = false, collapsible = true, emptyMessage = '' }) {
  const { t } = useTranslation();
  /* Open by default on the full-size panel so nothing that used to be visible
     becomes hidden; `compact` rows (the watchlist) start closed because they
     are one line inside a list of many. */
  const [openState, setOpenState] = useState(!compact);
  const open = collapsible ? openState : true;
  const Head = collapsible ? 'button' : 'div';

  const facts = useMemo(
    () => historyFacts(series, { days, volume, volumeHistory }),
    [series, days, volume, volumeHistory]
  );
  const overview = useMemo(() => historyOverview(series), [series]);
  const ladder = useMemo(() => levelLadder(series, { limit: 3 }), [series]);
  const position = useMemo(() => rangePosition(series), [series]);
  const moves = useMemo(() => dailyMoves(series), [series]);

  if (!facts.length) {
    if (!emptyMessage) return null;
    return (
      <section className={`hist-panel hist-card is-open ${compact ? 'is-compact' : ''}`} data-testid="history-panel" data-open="true" data-facts="0">
        <div className="hist-head hist-static">
          <span className="hist-glyph" aria-hidden="true">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 15.5 8 10l4 3.5L21 5" /><path d="M21 5h-4.5M21 5v4.5" /><path d="M3 20h18" opacity="0.5" />
            </svg>
          </span>
          <span className="hist-head-text"><span className="hist-title">{t('history.title')}</span></span>
        </div>
        <div className="hist-body"><p className="hist-empty-state">{emptyMessage}</p></div>
      </section>
    );
  }

  /*
   * Prices are formatted with the app's own price formatter, so a $68,000
   * coin and a $0.0000041 coin both read correctly. Passing a raw number
   * into the translation would render "0.0000041000000001" on the second.
   */
  const format = (id, values) => {
    const v = { ...values };
    for (const key of ['price', 'low', 'high']) {
      if (v[key] != null) v[key] = fmtPrice(v[key]);
    }
    /*
     * Two facts carry an ENUM, not a number: which side of the price a level
     * sits on, and which way a streak runs. Interpolating the raw 'above' /
     * 'down' would print English inside a Persian sentence — the exact defect
     * the loan screen was reported for. They are translated here, before they
     * ever reach the sentence.
     */
    if (v.side === 'above' || v.side === 'below') {
      v.side = t(`history.side${v.side === 'above' ? 'Above' : 'Below'}`);
    }
    if (v.dir === 'up' || v.dir === 'down') {
      v.dir = t(`history.dir${v.dir === 'up' ? 'Up' : 'Down'}`);
    }
    return t(`history.${id}`, v);
  };

  const dirOf = (fact) => (fact.values?.side === 'above' ? 'up' : 'down');

  return (
    <section
      className={`hist-panel hist-card ${open ? 'is-open' : ''} ${compact ? 'is-compact' : ''}`}
      data-testid="history-panel"
      data-open={open}
      data-facts={facts.length}
    >
      <Head
        type={collapsible ? 'button' : undefined}
        className={`hist-head${collapsible ? '' : ' hist-static'}`}
        aria-expanded={collapsible ? open : undefined}
        onClick={collapsible ? () => setOpenState((v) => !v) : undefined}
      >
        <span className="hist-glyph" aria-hidden="true">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 15.5 8 10l4 3.5L21 5" />
            <path d="M21 5h-4.5M21 5v4.5" />
            <path d="M3 20h18" opacity="0.5" />
          </svg>
          <span className="hist-glyph-ring" />
        </span>

        <span className="hist-head-text">
          <span className="hist-title">{t('history.title')}</span>
          {!compact && (
            <span className="hist-sub">{t('history.subtitle', { days })}</span>
          )}
        </span>

        {collapsible && <motion.span
          className="hist-chev"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          aria-hidden="true"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </motion.span>}
      </Head>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="hist-body">
              {/* ── the sample, stated before anything measured from it ──── */}
              {overview && (
                <div className="hist-chips">
                  <Chip label={t('history.chipSample')} value={t('history.chipSampleValue', { n: overview.samples })} />
                  <Chip label={t('history.chipLevels')} value={t('history.chipLevelsValue', { n: overview.levels })} />
                  {moves && (
                    <Chip label={t('history.chipTypicalDay')} value={t('history.chipTypicalDayValue', { pct: Math.round(moves.medianAbsPct * 100) / 100 })} />
                  )}
                </div>
              )}

              {/* ── where the price sits in the window, as a bar ─────────── */}
              {position && (
                <div className="hist-gauge" data-testid="history-range-gauge" data-pct={Math.round(position.pct)}>
                  <div className="hist-gauge-track" aria-hidden="true">
                    <div className="hist-gauge-fill" style={{ width: `${position.pct}%` }} />
                    <motion.span
                      className="hist-gauge-pin"
                      initial={{ left: 0, opacity: 0 }}
                      animate={{ left: `${position.pct}%`, opacity: 1 }}
                      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                  <div className="hist-gauge-legend">
                    <span className="mono">{fmtPrice(position.low)}</span>
                    <span className="hist-gauge-now">
                      {t('history.gaugeNow', { pct: Math.round(position.pct) })}
                    </span>
                    <span className="mono">{fmtPrice(position.high)}</span>
                  </div>
                </div>
              )}

              {/* ── the levels within reach of this price ─────────────────── */}
              {ladder.length > 0 && (
                <div className="hist-ladder" data-testid="history-level-ladder">
                  <div className="hist-section-title">{t('history.levelsTitle')}</div>
                  {ladder.map((level) => (
                    <div key={`${level.price}-${level.side}`} className={`hist-ladder-row is-${level.side}`}>
                      <span className={`hist-ladder-arrow ${dirOf({ values: level })}`} aria-hidden="true">
                        {level.side === 'above' ? '▲' : '▼'}
                      </span>
                      <span className="hist-ladder-price mono">{fmtPrice(level.price)}</span>
                      <span className="hist-ladder-track" aria-hidden="true">
                        {/* The bar is the DISTANCE, capped at 25% — the same
                            horizon above which the level stops being near. */}
                        <span style={{ width: `${Math.min(100, (level.distancePct / 25) * 100)}%` }} />
                      </span>
                      <span className="hist-ladder-meta">
                        {t('history.levelDistanceChip', {
                          pct: Math.round(level.distancePct * 10) / 10,
                          held: level.held,
                          tested: level.tested
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── the facts, each one an icon plus a measured sentence ─── */}
              <ul className="hist-list hist-grid">
                {facts.map((f, index) => (
                  <motion.li
                    key={f.id}
                    className={`hist-item hist-${f.kind}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.18) }}
                  >
                    <span className="hist-item-icon" aria-hidden="true"><FactIcon id={f.id} /></span>
                    <span className="hist-item-text">{format(f.id, f.values)}</span>
                  </motion.li>
                ))}
              </ul>

              {overview && (
                <div className="hist-foot-meta">
                  {t('history.footSample', { points: overview.samples, days })}
                </div>
              )}

              {/*
                Non-negotiable, and deliberately the last thing read.

                Everything above is a measurement, but a list of measurements
                about price reads as advice unless it is told not to. "A level
                that held four times can break on the fifth" is the single most
                important sentence on this panel.
              */}
              <p className="hist-notadvice">{t('history.notAdvice')}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
