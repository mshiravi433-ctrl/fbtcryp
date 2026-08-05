import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { riseIn } from './PageTransition';
import { fmtQty } from '../lib/format';
import { GOALS, buildAutopilot } from '../lib/autopilot';
import { ladderRungs } from '../lib/orders';

/**
 * AUTOPILOT — pick a goal, get a finished order.
 *
 * ─── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 * The ordinary form asks four questions before it can produce anything: which
 * of five order types, priced in which token, in which direction, at what
 * number. Every one of those is a place to be wrong, and two of them
 * (direction and priced-in) cause the worst mistake on the screen — an order
 * that fires at the exact opposite of the intent.
 *
 * Here the user answers one question in their own words — protect what I
 * have, sell into strength, buy the dip — and everything else is derived from
 * measured history.
 *
 * ─── WHY THE EVIDENCE IS SHOWN, NOT JUST THE ANSWER ─────────────────────────
 * A suggestion with no reasoning is an instruction, and an app that instructs
 * people about money has to be right every time. Showing "this level held 3 of
 * 4 tests" lets the user judge the evidence and disagree — which is the only
 * honest way to offer this at all, and it is also what makes the feature
 * teach rather than replace thinking.
 *
 * ─── AND WHY IT REFUSES OUT LOUD ────────────────────────────────────────────
 * When there is not enough history, or no level with a real record, this says
 * so and offers nothing. A confident-looking order built on twelve days of
 * data would be worse than no feature. The refusal names the reason so the
 * user learns what was missing rather than assuming the app is broken.
 */
export default function AutopilotPanel({ series, fromToken, toToken, amountIn, chainId, onApply }) {
  const { t } = useTranslation();
  const [goal, setGoal] = useState('protect');

  const result = useMemo(
    () => buildAutopilot({ goal, series, fromToken, toToken, amountIn, chainId }),
    [goal, series, fromToken, toToken, amountIn, chainId]
  );

  const rungs = useMemo(
    () => (result?.draft && result.draft.type === 'ladder' ? ladderRungs(result.draft) : []),
    [result]
  );

  return (
    <motion.section className="card" variants={riseIn} initial="hidden" animate="show">
      <p className="section-label" style={{ marginBottom: 6 }}>{t('autopilot.title')}</p>
      <p className="muted" style={{ fontSize: 12.2, margin: '0 0 10px', lineHeight: 1.8 }}>
        {t('autopilot.intro')}
      </p>

      {/* One question. Three answers. */}
      <div className="stack" style={{ gap: 7 }}>
        {GOALS.map((g) => (
          <button
            key={g}
            type="button"
            className={`ap-goal ${goal === g ? 'ap-goal-on' : ''}`}
            onClick={() => setGoal(g)}
            aria-pressed={goal === g}
          >
            <span className="ap-goal-title">{t(`autopilot.goal.${g}.title`)}</span>
            <span className="ap-goal-sub">{t(`autopilot.goal.${g}.sub`)}</span>
          </button>
        ))}
      </div>

      {result?.refused ? (
        /*
         * A refusal is a real answer and gets the same visual weight as a
         * result. Rendered as a plain notice rather than an error colour: the
         * app has not failed, there is simply not enough evidence, and
         * painting it red would teach users to distrust the screen.
         */
        <p className="notice" style={{ marginTop: 12 }}>
          {t(`autopilot.refused.${result.refused}`, {
            samples: result.detail?.samples ?? 0,
            need: result.detail?.need ?? 30,
            defaultValue: t('autopilot.refused.NO_LEVEL')
          })}
        </p>
      ) : result?.draft ? (
        <div style={{ marginTop: 12 }}>
          {/* What it will do, in one sentence, with the counts inline. */}
          <p className="muted" style={{ fontSize: 12.4, margin: '0 0 10px', lineHeight: 1.85 }}>
            {t(`autopilot.summary.${result.why.headline}`, {
              ...result.why.values,
              trailPct: result.why.values.trailPct,
              typical: (result.why.values.typicalMovePct ?? 0).toFixed(2),
              maxDd: (result.why.values.maxDrawdownPct ?? 0).toFixed(1),
              start: fmtQty(result.why.values.start ?? 0),
              end: fmtQty(result.why.values.end ?? 0),
              from: fromToken?.symbol,
              to: toToken?.symbol
            })}
          </p>

          {/* The concrete steps, when it is a ladder. A range plus a count is
              abstract; the actual prices are the thing being agreed to. */}
          {rungs.length > 0 && (
            <div className="ap-rungs">
              {rungs.map((r, i) => (
                <div className="row-between" key={r}>
                  <span className="faint">{t('orders.rungN', { n: i + 1 })}</span>
                  <span className="mono" style={{ fontSize: 12 }}>{fmtQty(r)}</span>
                </div>
              ))}
            </div>
          )}

          <p className="faint" style={{ fontSize: 11.3, marginTop: 9, lineHeight: 1.7 }}>
            {t('autopilot.evidenceNote', { samples: result.why.values.samples })}
          </p>

          {/*
            REVIEW, NOT SUBMIT. This hands the draft to the ordinary form with
            every field filled, so the last action is always the user's. An app
            that places an order on its own has made a trade for somebody.
          */}
          <button
            className="btn btn-primary"
            style={{ marginTop: 11 }}
            onClick={() => onApply?.(result.draft)}
          >
            {t('autopilot.review')}
          </button>
        </div>
      ) : null}
    </motion.section>
  );
}
