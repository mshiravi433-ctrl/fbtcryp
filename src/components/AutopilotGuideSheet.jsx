import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { useStill } from './AnimatedIcon';
import { fmtQty } from '../lib/format';
import { GOALS, buildAutopilot } from '../lib/autopilot';
import { loadLearningParams, orderTune } from '../lib/learning';

/**
 * AUTOPILOT GUIDE — a bottom sheet that explains the goals AND every order
 * option on the Orders screen.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS IS NOT THE PANEL ──────────────────────────────────────────────
 * `AutopilotPanel` is a PICKER. It sits inside the order form, it needs the
 * pair and the amount you are already typing, and the moment you choose a goal
 * it builds that order. That is the right job for the form and the wrong job
 * for someone who has not decided yet.
 *
 * This is the other half: the three autopilot goals, each openable to read
 * what it does, what we get to control, and what the measurement actually
 * tells us — and below them, ALL SEVEN order types (limit, trailing, bracket,
 * ladder, DCA, TWAP, rebalance) with a plain-language "how it builds the
 * order" card, because the previous version explained only the three goals
 * and left five options undocumented. Reported: «برای همه اپشن ها بنویس با
 * اندازه درست الان فقط سه اپشن اولیه را نوشته».
 *
 * Nothing is selected, nothing is built, and there is no submit — see the
 * boundary note at the bottom.
 *
 * ─── WHY A SHEET, AND WHY IT STARTS CLOSED ──────────────────────────────────
 * Asked for directly: «یک پاپ‌آپ پایین صفحه، پیش‌فرض بسته، بازشونده». Seven
 * always-open explanations are a wall of text on a 360px screen, and a wall
 * of text on the way to the button you actually wanted is how features get
 * ignored. So: one button at the foot of the Orders screen, a sheet anchored
 * to the bottom, and each card folded until it is asked about.
 *
 * ─── EVERY NUMBER HERE IS MEASURED ──────────────────────────────────────────
 * The "what we learn" row is not marketing copy. It prints the counts
 * `buildAutopilot` derived from the real price series — how many times a level
 * held versus how many times it was tested, the typical daily move, the worst
 * fall in the window, and how many days that was measured over. When there is
 * not enough history the row says so and offers no numbers at all, which is
 * the same refusal the panel makes.
 */

/**
 * The amount passed to the engine so it will run at all.
 *
 * `buildAutopilot` refuses a non-positive amount before it measures anything,
 * but nothing it returns here depends on the size of the order: the trailing
 * distance, the rung spacing and the held/tested counts all come from the
 * price series alone. One unit gets past the guard without letting a made-up
 * amount into a single displayed figure.
 */
const MEASUREMENT_AMOUNT = 1;

/** The three tuning defaults, so an untrained session still shows real values. */
const DEFAULT_TUNE = { trailMult: 1, stopBufferMult: 1, ladderStepDiv: 3 };

/**
 * ALL order options on the Orders screen, in the same order the rail shows
 * them. Each card says how the autopilot would build that order — plain
 * language, no jargon — and which knobs are ours to turn. The trailing and
 * ladder rows reuse the measured numbers from the goals above them.
 */
const ORDER_OPTIONS = [
  { id: 'limit', emoji: '🎯', tone: '#00e5ff' },
  { id: 'trailing', emoji: '🛰️', tone: '#ff8a00', measured: 'protect' },
  { id: 'bracket', emoji: '🛡️', tone: '#ff3b6b' },
  { id: 'ladder', emoji: '🪜', tone: '#a78bfa', measured: 'takeProfit' },
  { id: 'dca', emoji: '⏰', tone: '#4ade80' },
  { id: 'twap', emoji: '🧩', tone: '#fbbf24' },
  { id: 'rebalance', emoji: '⚖️', tone: '#f472b6' }
];

export default function AutopilotGuideSheet({ open, onClose, series, fromToken, toToken, chainId }) {
  const { t } = useTranslation();
  const still = useStill();
  /*
   * Which card is open. ONE at a time, and none by default: the ask was
   * "closed by default, expandable", and a wall of open cards at once is the
   * always-open panel with extra steps.
   */
  const [expanded, setExpanded] = useState(null);

  /*
   * Learning-core order tune (trailing distance / stop buffer / ladder step
   * divisor). Same source the form and the panel read, so the multipliers
   * printed here are the ones that would actually be applied.
   */
  const [learn, setLearn] = useState(null);
  useEffect(() => {
    let alive = true;
    loadLearningParams().then((d) => alive && setLearn(d)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const tune = useMemo(() => orderTune(learn) ?? DEFAULT_TUNE, [learn]);

  /*
   * One engine run per goal, from the same series the form would use. Memoised
   * on the series identity so opening and closing a card does not re-measure.
   */
  const results = useMemo(() => {
    const rows = series ?? [];
    return GOALS.map((goal) => ({
      goal,
      result: buildAutopilot({
        goal,
        series: rows,
        fromToken,
        toToken,
        amountIn: MEASUREMENT_AMOUNT,
        chainId,
        tune
      })
    }));
  }, [series, fromToken, toToken, chainId, tune]);

  const num = (v, digits = 2) => (Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '—');

  /**
   * The interpolation values for one goal's three rows.
   *
   * Everything here is either a tuning multiplier read from the learning core
   * or a measurement returned by the engine. When the engine refused, the
   * measured fields fall back to an em dash rather than to zero — a zero that
   * means "we do not know" is the exact lie this screen exists to avoid.
   */
  const valuesFor = (result) => {
    const v = result?.why?.values ?? {};
    return {
      trailMult: num(tune.trailMult),
      stopBufferMult: num(tune.stopBufferMult),
      ladderStepDiv: num(tune.ladderStepDiv, 1),
      trail: Number.isFinite(v.trailPct) ? `${num(v.trailPct)}%` : '—',
      typical: num(v.typicalMovePct),
      maxDd: num(v.maxDrawdownPct, 1),
      held: v.held ?? '—',
      tested: v.tested ?? '—',
      steps: v.steps ?? '—',
      start: Number.isFinite(v.start) ? fmtQty(v.start) : '—',
      end: Number.isFinite(v.end) ? fmtQty(v.end) : '—',
      samples: v.samples ?? 0
    };
  };

  /* What the pair is called, so the numbers are never orphaned from their data. */
  const pairLabel = fromToken?.symbol && toToken?.symbol
    ? `${fromToken.symbol}/${toToken.symbol}`
    : null;

  const measuredFor = (optionId) => {
    if (!optionId) return null;
    const found = results.find((r) => r.goal === optionId);
    return found ? valuesFor(found.result) : null;
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('autopilot.sheet.title')} anchor="bottom">
      <div className="ap-sheet">
        <p className="ap-sheet-intro">{t('autopilot.sheet.intro')}</p>

        {results.map(({ goal, result }) => {
          const isOpen = expanded === goal;
          const vals = valuesFor(result);
          return (
            <div key={goal} className={`ap-opt ${isOpen ? 'ap-opt-open' : ''}`}>
              <button
                type="button"
                className="ap-opt-head"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : goal)}
              >
                <span className="ap-opt-copy">
                  <span className="ap-opt-title">{t(`autopilot.goal.${goal}.title`)}</span>
                  <span className="ap-opt-sub">{t(`autopilot.goal.${goal}.sub`)}</span>
                </span>
                {/* +/− rather than a chevron: it says which way it will move. */}
                <span className="ap-opt-mark" aria-hidden="true">{isOpen ? '−' : '+'}</span>
              </button>

              {/* Height animation, not display:none. A card that snaps open
               * looks like it jumped; one that grows is readable while it
               * arrives. `useStill` collapses it to nothing for anyone who has
               * asked the app to stop animating. */}
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    className="ap-opt-body"
                    initial={still ? { opacity: 0 } : { height: 0, opacity: 0 }}
                    animate={still ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                    exit={still ? { opacity: 0 } : { height: 0, opacity: 0 }}
                    transition={still ? { duration: 0 } : { duration: 0.22, ease: 'easeOut' }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="ap-fact">
                      <span className="ap-fact-label">{t('autopilot.sheet.howLabel')}</span>
                      <span className="ap-fact-text">{t(`autopilot.goal.${goal}.how`)}</span>
                    </div>

                    <div className="ap-fact">
                      <span className="ap-fact-label">{t('autopilot.sheet.controlLabel')}</span>
                      <span className="ap-fact-text">
                        {t(`autopilot.goal.${goal}.control`, vals)}
                      </span>
                    </div>

                    <div className="ap-fact">
                      <span className="ap-fact-label">{t('autopilot.sheet.learnLabel')}</span>
                      {/* Measured, or honestly absent. The refusal names how
                       * many days it did have and how many it needs, which
                       * teaches more than a blank row. */}
                      <span className="ap-fact-text">
                        {result?.refused
                          ? t(`autopilot.refused.${result.refused}`, {
                            samples: result.detail?.samples ?? (series?.length ?? 0),
                            need: result.detail?.need ?? 30,
                            defaultValue: t('autopilot.refused.NO_LEVEL')
                          })
                          : t(`autopilot.goal.${goal}.learn`, vals)}
                      </span>
                    </div>

                    {pairLabel && !result?.refused && (
                      <p className="ap-opt-foot">
                        {t('autopilot.evidenceNote', { samples: vals.samples })}
                        {' · '}
                        {t('autopilot.sheet.measuredOn', { pair: pairLabel })}
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {/* ── ALL SEVEN ORDER OPTIONS ──────────────────────────────────── */}
        <p className="ap-sheet-divider">{t('autopilot.sheet.optionsTitle', { defaultValue: 'همهٔ گزینه‌های سفارش' })}</p>
        <p className="ap-sheet-intro">{t('autopilot.sheet.optionsIntro', { defaultValue: 'هر نوع سفارش در صفحهٔ سفارش‌ها چه می‌کند و چطور ساخته می‌شود — به زبان ساده.' })}</p>

        {ORDER_OPTIONS.map((opt) => {
          const isOpen = expanded === `opt:${opt.id}`;
          const vals = measuredFor(opt.measured);
          return (
            <div key={opt.id} className={`ap-opt ap-opt-sm ${isOpen ? 'ap-opt-open' : ''}`}>
              <button
                type="button"
                className="ap-opt-head"
                aria-expanded={isOpen}
                onClick={() => setExpanded(isOpen ? null : `opt:${opt.id}`)}
              >
                <span className="ap-opt-copy" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                      display: 'grid', placeItems: 'center', fontSize: 14,
                      background: `linear-gradient(135deg, ${opt.tone}22, ${opt.tone}08)`,
                      border: `1px solid ${opt.tone}40`,
                    }}
                  >
                    {opt.emoji}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="ap-opt-title">{t(`orders.new.${opt.id}`)}</span>
                    <span className="ap-opt-sub">{t(`autopilot.option.${opt.id}.sub`)}</span>
                  </span>
                </span>
                <span className="ap-opt-mark" aria-hidden="true">{isOpen ? '−' : '+'}</span>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    className="ap-opt-body"
                    initial={still ? { opacity: 0 } : { height: 0, opacity: 0 }}
                    animate={still ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                    exit={still ? { opacity: 0 } : { height: 0, opacity: 0 }}
                    transition={still ? { duration: 0 } : { duration: 0.22, ease: 'easeOut' }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div className="ap-fact">
                      <span className="ap-fact-label">{t('autopilot.sheet.howLabel')}</span>
                      <span className="ap-fact-text">{t(`autopilot.option.${opt.id}.how`)}</span>
                    </div>
                    <div className="ap-fact">
                      <span className="ap-fact-label">{t('autopilot.sheet.controlLabel')}</span>
                      <span className="ap-fact-text">{t(`autopilot.option.${opt.id}.control`, vals)}</span>
                    </div>
                    {opt.measured && vals && (
                      <div className="ap-fact">
                        <span className="ap-fact-label">{t('autopilot.sheet.learnLabel')}</span>
                        <span className="ap-fact-text">
                          {t(`autopilot.option.${opt.id}.learn`, vals)}
                        </span>
                      </div>
                    )}
                    {pairLabel && (
                      <p className="ap-opt-foot">
                        {t('autopilot.sheet.measuredOn', { pair: pairLabel })}
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {/*
         * ─── THE BOUNDARY, STATED WHERE IT CAN BE MISSED BY NOBODY ─────────
         * This sheet can be read, expanded and closed. It cannot place an
         * order, because it has no order to place — building one is the
         * panel's job, inside the form, and even there the last action is the
         * user's. Printing that here is what keeps "guidance" from slowly
         * becoming "automation" over three releases.
         */}
        <p className="notice" style={{ marginTop: 3 }}>{t('autopilot.sheet.boundary')}</p>
      </div>
    </Sheet>
  );
}
