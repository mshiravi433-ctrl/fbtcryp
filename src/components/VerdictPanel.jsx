import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { CONFIDENCE_CEILING, verdict } from '../lib/verdict';
import { fmtPrice } from '../lib/format';
import {
  layerTune,
  loadLearningParams,
  telemetryResolve,
  telemetrySignal
} from '../lib/learning';

/**
 * THE VERDICT PANEL — the readable half of lib/verdict.js.
 *
 * ─── THE DESIGN BRIEF, VERBATIM ─────────────────────────────────────────────
 * «میخام قویترین سیگنال‌دهی را داشته باشیم که هر کسی با هر سوادی بفهمه چخبره»
 * — the strongest signalling we can build, understandable by anyone regardless
 * of their level of knowledge.
 *
 * That second half is the hard constraint and it drove every decision here.
 *
 * ─── WHY THERE IS NO GAUGE AND NO SCORE OUT OF 100 ──────────────────────────
 * The existing Signals screen already has a needle gauge showing -100..+100.
 * It looks impressive and it communicates almost nothing to someone who has
 * not traded before: "+43" is not a fact anybody can act on, and worse, a
 * number that precise implies a precision the underlying data does not have.
 *
 * So the headline of this panel is a SENTENCE IN ORDINARY LANGUAGE — "the wind
 * is behind this one", "we genuinely do not know" — and the numbers live
 * underneath it as evidence for anyone who wants them. Someone who reads only
 * the first line still leaves with the correct impression, and someone who
 * reads all of it can check our working.
 *
 * ─── WHY TWO HORIZONS SIT SIDE BY SIDE ──────────────────────────────────────
 * Requested: «در کوتاه مدت و بلند مدت چی میشه». They are computed differently
 * (see lib/verdict.js — the long view drops the oscillators entirely and lets
 * the market regime dominate), so they can and often do disagree.
 *
 * That disagreement is the most valuable thing on the screen: "weak this week,
 * constructive over a month" is a completely different situation from
 * "negative on both". A user cannot be expected to derive that by comparing
 * two gauges, so we compute it and state it in a sentence.
 *
 * ─── WHY NOTHING HERE IS GREEN OR RED BY DEFAULT ────────────────────────────
 * Same reasoning as HistoryPanel. Colouring a stance green makes it a
 * recommendation. The accent follows the stance only faintly, and `unclear`
 * — the most common and most useful answer — gets neutral ink rather than
 * looking like a failure state.
 */

/** Stance → accent variable. Deliberately muted; see the note above. */
const ACCENT = {
  tailwind: 'var(--up)',
  mildUp: 'var(--up)',
  unclear: 'var(--text-3)',
  mildDown: 'var(--down)',
  headwind: 'var(--down)'
};

/**
 * How full the confidence bar is drawn.
 *
 * NOT a straight percentage of 100. The engine's ceiling is 75 (65 for the
 * monthly view) — imported rather than copied, because a duplicated constant
 * in a component drifts from the engine silently — and drawing 75 as
 * three-quarters of a bar invites the reading
 * "there is 25% more certainty available if things line up better", which is
 * false — 75 IS the maximum this engine will ever emit. So the bar is scaled
 * against the real ceiling and the number beside it is the honest raw value.
 */
const barPct = (confidence, horizon) =>
  Math.round((confidence / CONFIDENCE_CEILING[horizon]) * 100);

function ConfidenceBar({ value, horizon }) {
  const pct = Math.min(100, barPct(value, horizon));
  return (
    <div className="verd-conf">
      <div className="verd-conf-track">
        <motion.div
          className="verd-conf-fill"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="verd-conf-num mono">{value}%</span>
    </div>
  );
}

/** One horizon card: the plain-language line, then the evidence. */
function HorizonCard({ read, t, formatReason }) {
  const accent = ACCENT[read.stance] ?? 'var(--text-3)';

  return (
    <div className="verd-card" style={{ '--verd-accent': accent }}>
      <div className="verd-card-head">
        <div>
          <div className="verd-card-when">
            {t(read.horizon === 'long' ? 'verdict.long' : 'verdict.short')}
          </div>
          <div className="verd-card-sub faint">
            {t(read.horizon === 'long' ? 'verdict.longSub' : 'verdict.shortSub', { d: read.days })}
          </div>
        </div>
        <span className="verd-stance">{t(`verdict.stance.${read.stance}`)}</span>
      </div>

      {/* The line that has to work for someone who has never traded. */}
      <p className="verd-plain">{t(`verdict.plain.${read.stance}`)}</p>

      <div className="verd-conf-row">
        <span className="faint">{t('verdict.confidence')}</span>
        <ConfidenceBar value={read.confidence} horizon={read.horizon} />
      </div>

      {read.reasons.length > 0 && (
        <ul className="verd-reasons">
          {read.reasons.map((r) => (
            <li key={r.id} className={`verd-reason verd-${r.kind}`}>
              <span className="verd-dot" aria-hidden="true" />
              <span>{formatReason(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function VerdictPanel({ analysis, series, btcSeries, coin, global, compact = false }) {
  const { t } = useTranslation();
  const [showLayers, setShowLayers] = useState(false);
  /*
   * The learning core's published params, fetched once per session. While it
   * is null (not yet loaded, or no model published) the verdict below uses
   * today's hardcoded weights — identical behaviour to before.
   */
  const [learn, setLearn] = useState(null);
  useEffect(() => {
    let alive = true;
    loadLearningParams().then((d) => alive && setLearn(d));
    return () => {
      alive = false;
    };
  }, []);

  const tune = useMemo(() => layerTune(learn), [learn]);

  const v = useMemo(
    () => verdict({ analysis, series, btcSeries, coin, global, tune }),
    [analysis, series, btcSeries, coin, global, tune]
  );

  /*
   * TELEMETRY — strictly opt-in (lib/learning.js checks the setting and the
   * consent token). Fire-and-forget; it can never block or change the UI.
   */
  useEffect(() => {
    if (!v || !coin) return;
    /*
     * Resolve BEFORE signalling: a pending record from a previous visit is
     * replaced by today's signal below, so its outcome must be submitted
     * first or it would be lost.
     */
    telemetryResolve({ coin, series });
    telemetrySignal({
      coin,
      horizon: 'short',
      stance: v.short.stance,
      confidence: v.short.confidence,
      regime: v.macro?.regime?.regime,
      series,
      data: learn
    });
    telemetrySignal({
      coin,
      horizon: 'long',
      stance: v.long.stance,
      confidence: v.long.confidence,
      regime: v.macro?.regime?.regime,
      series,
      data: learn
    });
  }, [v, learn, coin, series]);

  /*
   * Nothing rather than a placeholder, exactly like HistoryPanel. A spinner
   * implies data is coming that never will for a coin with no history, and
   * filler would be worse than silence.
   */
  if (!v) return null;
  const bothBlank = v.short.stance === 'unclear' && v.short.confidence === 0 && v.long.confidence === 0;
  if (bothBlank) {
    return (
      <section className="verd-panel">
        <p className="section-label" style={{ margin: 0 }}>{t('verdict.title')}</p>
        <p className="notice" style={{ marginTop: 10 }}>{t('verdict.notEnough')}</p>
      </section>
    );
  }

  /*
   * Reason rendering.
   *
   * The engine returns `{ id, values }` and never a sentence — so a claim can
   * never be machine-translated into something we did not say, and the maths
   * stays unit-testable without a DOM. The only work here is formatting:
   * prices through the app's own formatter (a $0.0000041 coin must not render
   * as "0.0000041000000001"), and one derived value.
   */
  const formatReason = (r) => {
    const vals = { ...r.values };
    for (const key of ['price', 'low', 'high']) {
      if (vals[key] != null) vals[key] = fmtPrice(vals[key]);
    }
    /*
     * "A 10% Bitcoin day has meant roughly X% here." Computed rather than
     * written into the string, because the earlier version built it by
     * appending a "0" to the beta ("2.4" → "2.40%"), which is only correct
     * when beta happens to have one decimal — 1.05 became "1.050%".
     */
    if (vals.beta != null) vals.tenPct = Math.round(vals.beta * 10 * 10) / 10;
    return t(`verdict.reason.${r.id}`, vals);
  };

  const layerRows = ['technical', 'historical', 'structural', 'macro'];
  const totalWeight = layerRows.reduce((a, k) => a + (v.short.layers[k]?.weight ?? 0), 0);

  return (
    <section className="verd-panel">
      <div className="verd-head">
        <p className="section-label" style={{ margin: 0 }}>{t('verdict.title')}</p>
      </div>

      {!compact && <p className="verd-sub faint">{t('verdict.subtitle')}</p>}

      <div className="verd-grid">
        <HorizonCard read={v.short} t={t} formatReason={formatReason} />
        <HorizonCard read={v.long} t={t} formatReason={formatReason} />
      </div>

      {/*
        Transparency footnote — only when the learning core's tuned weights
        are actually in effect. The wording is a measurement statement, never
        a promise: how many outcomes were calibrated on, and which model
        version (the date it was trained) is doing the tuning.
      */}
      {learn?.model && learn?.params && (
        <p className="faint verd-calib">
          {t('verdict.calibrated', {
            n: learn.manifest?.recordCount ?? learn.params.records ?? 0,
            date: String(learn.params.trainedAt ?? '').slice(0, 10)
          })}
        </p>
      )}

      {/* The sentence a user cannot derive by looking at two cards. */}
      <p className={`verd-agree verd-agree-${v.agree}`}>{t(`verdict.agree.${v.agree}`)}</p>

      {/*
        The full stance explanation, for the short horizon. Longer and more
        careful than the plain line — this is where "conditions favour it" gets
        unpacked into "this is not a promise".
      */}
      <p className="verd-explain muted">{t(`verdict.stanceExplain.${v.short.stance}`)}</p>

      {/*
        Where the read came from, collapsed by default.

        Showing the weights matters more than it looks: it is the difference
        between "the app thinks X" and "here is what the app looked at and how
        much each part counted". A user who sees that the historical layer
        contributed nothing because the setup only fired 5 times understands
        the uncertainty in a way no confidence percentage conveys.
      */}
      <button
        type="button"
        className="verd-toggle"
        onClick={() => setShowLayers((s) => !s)}
        aria-expanded={showLayers}
      >
        <span>{t('verdict.layers')}</span>
        <span aria-hidden="true">{showLayers ? '−' : '+'}</span>
      </button>

      <motion.div
        initial={false}
        animate={{ height: showLayers ? 'auto' : 0, opacity: showLayers ? 1 : 0 }}
        style={{ overflow: 'hidden' }}
      >
        <div className="verd-layers">
          {layerRows.map((key) => {
            const l = v.short.layers[key];
            const pct = totalWeight > 0 ? Math.round(((l?.weight ?? 0) / totalWeight) * 100) : 0;
            return (
              <div key={key} className="verd-layer">
                <span className="verd-layer-name">{t(`verdict.layerName.${key}`)}</span>
                <span className="verd-layer-weight faint">
                  {l?.weight ? t('verdict.layerWeight', { pct }) : t('verdict.layerNoData')}
                </span>
              </div>
            );
          })}
        </div>
        <p className="faint verd-nomodel">{t('verdict.noModel')}</p>
      </motion.div>

      {/*
        Non-negotiable and deliberately last. Everything above is a
        measurement, but a page of measurements about price reads as advice
        unless it is explicitly told not to.
      */}
      <p className="notice notice-danger verd-disclaimer">{t('verdict.notPrediction')}</p>
    </section>
  );
}
