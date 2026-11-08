/**
 * FBT NEUROMORPHIC 2050 — PHASE 8: PARALLEL RESEARCH UNIVERSES CONSOLE
 * ===========================================================================
 * Renders ONLY measured telemetry from the device research engine:
 *   · population / generation / resolved observations / dispersion
 *   · the consensus (Hedge-weighted) universe: probability, direction, Brier,
 *     log loss, hit rate over committed decisions, ECE, the out-of-sample
 *     window, and the equal-weight control arm
 *   · the best single universe and the hindsight oracle (explicitly labelled)
 *   · every universe with its genome-derived hypothesis, weight, score and
 *     its own skill trace
 *   · the last selection round (who was culled, who was born from whom)
 *
 * Honesty rules enforced here, not just described:
 *   · A value that has not been measured renders `—`, never a plausible number.
 *   · Nothing is pre-filled before the first real candle pulse.
 *   · A probability is only shown while a prediction is actually pending; after
 *     a pulse it is `—` because the next bar does not exist yet.
 *   · The hindsight oracle is visually separated and labelled as future-aware.
 *
 * Hard security boundary (unchanged): read & analyse only.
 */

import { memo } from 'react';
import { useResearchUniverses } from '../../lib/neuromorphic/useResearchUniverses.js';
import { GENE_KEYS } from '../../lib/neuromorphic/researchUniverses.js';
import './neuromorphic-cortex.css';

const HYPOTHESIS_LABELS = Object.freeze({
  momentum: { fa: 'مومنتوم', en: 'Momentum' },
  reversion: { fa: 'بازگشت', en: 'Reversion' },
  volatility: { fa: 'نوسان', en: 'Volatility' },
  breadth: { fa: 'عرض بازار', en: 'Breadth' },
  structural: { fa: 'ریزساختار', en: 'Microstructure' },
  balanced: { fa: 'متعادل', en: 'Balanced' },
  explorer: { fa: 'کاوشگر', en: 'Explorer' }
});

const GENE_LABELS = Object.freeze({
  precision: { fa: 'دقت', en: 'precision' },
  plasticity: { fa: 'یادگیری', en: 'plasticity' },
  momentum: { fa: 'مومنتوم', en: 'momentum' },
  contrarian: { fa: 'ضد‌روند', en: 'contrarian' },
  volatility: { fa: 'نوسان', en: 'volatility' },
  temperature: { fa: 'دما', en: 'temperature' },
  memory: { fa: 'حافظه', en: 'memory' },
  breadth: { fa: 'عرض', en: 'breadth' }
});

const fmtPct = (value, digits = 1) => {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
};

const fmtSignedPct = (value, digits = 1) => {
  if (value === null || value === undefined) return '—';
  const raw = Number(value);
  if (!Number.isFinite(raw)) return '—';
  const n = Math.abs(raw) < 0.5 * 10 ** -(digits + 2) ? 0 : raw;
  return `${n > 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
};

const fmtNum = (value, digits = 4) => {
  if (value === null || value === undefined) return '—';
  const raw = Number(value);
  if (!Number.isFinite(raw)) return '—';
  // Never render a negative zero: it reads like a real (tiny) loss.
  const n = Math.abs(raw) < 0.5 * 10 ** -digits ? 0 : raw;
  return n.toFixed(digits);
};

const fmtInt = (value) => {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return String(Math.round(n));
};

function sparkPoints(trace) {
  const values = Array.isArray(trace) ? trace.filter((v) => Number.isFinite(Number(v))).map(Number) : [];
  if (values.length < 2) return '';
  const width = 132;
  const height = 20;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const clamped = Math.max(-1, Math.min(1, v));
      const y = height / 2 - clamped * (height / 2 - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const ParallelUniversesPanel = memo(function ParallelUniversesPanel({ locale = 'fa', compact = false }) {
  const isFa = !String(locale || 'fa').toLowerCase().startsWith('en');
  const pru = useResearchUniverses();
  const report = pru.report;

  const consensus = report?.consensus || null;
  const control = consensus?.control || null;
  const holdout = consensus?.holdout || null;
  const diversity = report?.diversity || null;
  const selection = report?.selection || null;
  const universes = report?.universes || [];
  const ranked = universes.slice(0, compact ? 6 : 12);
  const resolved = report?.resolved ?? 0;
  const hasEvidence = resolved > 0;
  const pending = Boolean(report?.pending);

  const directionLabel = !consensus || consensus.direction === null
    ? null
    : consensus.direction === 'UP'
      ? (isFa ? 'صعودی (بالاتر از سکهٔ منصف)' : 'Up (above fair coin)')
      : consensus.direction === 'DOWN'
        ? (isFa ? 'نزولی (زیر سکهٔ منصف)' : 'Down (below fair coin)')
        : (isFa ? 'بی‌طرف (بدون تعهد)' : 'Flat (no commitment)');

  const evidenceClass = report?.evidence?.class || null;
  const lastSelection = selection?.last || null;

  const geneSummary = (universe) => {
    const genome = universe?.genome || {};
    const rankedGenes = [...GENE_KEYS]
      .map((key) => ({ key, value: Number(genome[key]) }))
      .filter((row) => Number.isFinite(row.value))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 2);
    return rankedGenes
      .map((row) => `${GENE_LABELS[row.key]?.[isFa ? 'fa' : 'en'] || row.key} ${row.value.toFixed(2)}`)
      .join(' · ');
  };

  return (
    <section
      className="nmc-root nmc-pru-root"
      dir={isFa ? 'rtl' : 'ltr'}
      data-testid="pru-panel"
    >
      <div className="nmc-hero">
        <div className="nmc-hero-title">
          <div className="nmc-orb nmc-pru-orb" data-active={pending} aria-hidden="true">🌌</div>
          <div className="nmc-hero-copy">
            <h3>
              {isFa
                ? 'جهان‌های تحقیقاتی موازی · Parallel Research Universes'
                : 'Parallel Research Universes · World Population'}
            </h3>
            <p>
              {isFa
                ? 'هر جهان یک یادگیرندهٔ مستقل با ژنوم، حافظه و سابقهٔ خودش است؛ همه دقیقاً یک جریان دادهٔ واقعی بازار را می‌بینند و باید پیش از تولد کندل بعدی احتمال بدهند. برنده‌ها با قاعدهٔ Hedge ترکیب و با انتخاب/جهش زادآوری می‌شوند.'
                : 'Each universe is an independent learner with its own genome, memory and track record. All of them see the exact same real market stream and must commit before the next bar exists. Survivors are fused by a Hedge rule and bred by selection + mutation.'}
            </p>
          </div>
        </div>
        <div className="nmc-badges">
          <span className="nmc-pill nmc-pill-cyan" data-testid="pru-population">
            {isFa
              ? `جهان‌های زنده: ${fmtInt(report?.population)}`
              : `Living universes: ${fmtInt(report?.population)}`}
          </span>
          <span className="nmc-pill nmc-pill-violet" data-testid="pru-generation">
            {isFa
              ? `نسل انتخاب: #${fmtInt(report?.generation)}`
              : `Selection gen: #${fmtInt(report?.generation)}`}
          </span>
          <span className="nmc-pill nmc-pill-mint" data-testid="pru-resolved">
            {isFa
              ? `مشاهدات حل‌شده: ${fmtInt(resolved)}`
              : `Resolved observations: ${fmtInt(resolved)}`}
          </span>
          <span className="nmc-pill nmc-pill-amber" data-testid="pru-evidence">
            {!evidenceClass
              ? (isFa ? 'شاهد: —' : 'Evidence: —')
              : evidenceClass === 'mixed'
                ? (isFa ? 'شاهد: آینده‌نگر + پس‌نگر' : 'Evidence: prospective + retrospective')
                : evidenceClass === 'retrospective'
                  ? (isFa ? 'شاهد: پس‌نگر (کندل‌های گذشته)' : 'Evidence: retrospective (past bars)')
                  : (isFa ? 'شاهد: آینده‌نگر' : 'Evidence: prospective')}
          </span>
        </div>
      </div>

      <div className="nmc-grid-4">
        <div className="nmc-stat">
          <span>{isFa ? 'تعداد پیش‌بینی معطل' : 'Pending prediction'}</span>
          <strong data-testid="pru-pending-state">
            {pending
              ? (isFa ? 'در انتظار کندل بعدی' : 'Waiting for next bar')
              : (isFa ? 'بدون پیش‌بینی باز' : 'None open')}
          </strong>
          <small>
            {isFa
              ? 'یک پیش‌بینی تا حل‌نشدن با واقعیت، قابل جایگزینی نیست.'
              : 'A prediction can never be replaced before it is resolved.'}
          </small>
        </div>

        <div className="nmc-stat">
          <span>{isFa ? 'پراکندگی شناختی جهان‌ها' : 'Epistemic dispersion'}</span>
          <strong data-testid="pru-diversity">{fmtPct(diversity?.meanDisagreement, 1)}</strong>
          <small>
            {isFa
              ? `میانگین اختلاف جفتی · توافق: ${fmtPct(diversity?.agreement, 0)}`
              : `Mean pairwise disagreement · agreement ${fmtPct(diversity?.agreement, 0)}`}
          </small>
        </div>

        <div className="nmc-stat">
          <span>{isFa ? 'آنتروپی وزن اجماع' : 'Consensus weight entropy'}</span>
          <strong data-testid="pru-weight-entropy">{fmtPct(diversity?.weightEntropy, 0)}</strong>
          <small>
            {isFa
              ? `${fmtInt(diversity?.distinctGenomes)} ژنوم متمایز · ${fmtInt(diversity?.explorers)} کاوشگر`
              : `${fmtInt(diversity?.distinctGenomes)} distinct genomes · ${fmtInt(diversity?.explorers)} explorers`}
          </small>
        </div>

        <div className="nmc-stat">
          <span>{isFa ? 'چرخه‌های انتخاب' : 'Selection rounds'}</span>
          <strong data-testid="pru-selection-rounds">{fmtInt(selection?.rounds)}</strong>
          <small>
            {isFa
              ? `${fmtInt(selection?.culled)} جهان حذف · ${fmtInt(selection?.born)} جهان زاده‌شده`
              : `${fmtInt(selection?.culled)} culled · ${fmtInt(selection?.born)} born`}
          </small>
        </div>
      </div>

      {!hasEvidence ? (
        <p className="nmc-note nmc-pru-empty" data-testid="pru-empty">
          {isFa
            ? 'هیچ مشاهدهٔ واقعی هنوز حل نشده است. یک «پالس تحقیقاتی» روی کندل‌های واقعی بازار اجرا کنید؛ تا آن زمان هر عدد این پنل «—» است و چیزی از پیش پر نمی‌شود.'
            : 'No real observation has been resolved yet. Run a research pulse on real market candles; until then every number here is “—” and nothing is pre-filled.'}
        </p>
      ) : null}

      {/* Consensus universe */}
      <div className="nmc-raster-card nmc-pru-card">
        <div className="nmc-section-head">
          <strong>
            {isFa ? 'جهان اجماعی (ترکیب Hedge + انتخاب)' : 'Consensus universe (Hedge fusion + selection)'}
          </strong>
          <small data-testid="pru-consensus-direction">
            {directionLabel
              ? `${isFa ? 'جهت': 'Direction'}: ${directionLabel}`
              : (isFa ? 'بدون پیش‌بینی معطل — جهت: —' : 'No pending prediction — direction: —')}
          </small>
        </div>

        <div className="nmc-pru-prob">
          <strong data-testid="pru-consensus-probability">
            {fmtPct(consensus?.probability, 1)}
          </strong>
          <div className="nmc-bar-track nmc-pru-prob-track" aria-hidden="true">
            <div
              className="nmc-bar-fill"
              style={{ width: `${consensus?.probability != null ? Math.round(consensus.probability * 100) : 0}%` }}
            />
          </div>
          <small data-testid="pru-consensus-confidence">
            {isFa
              ? `اطمینان: ${fmtPct(consensus?.confidence, 1)}`
              : `Confidence: ${fmtPct(consensus?.confidence, 1)}`}
          </small>
        </div>

        <div className="nmc-grid-4 nmc-pru-metrics">
          <div className="nmc-stat">
            <span>{isFa ? 'Brier اجماع (پایین‌تر بهتر)' : 'Consensus Brier (lower is better)'}</span>
            <strong data-testid="pru-consensus-brier">{fmtNum(consensus?.brier)}</strong>
            <small data-testid="pru-consensus-skill">
              {isFa
                ? `مهارت نسبت به ۰٫۲۵: ${fmtSignedPct(consensus?.brierSkill, 1)}`
                : `Skill vs 0.25: ${fmtSignedPct(consensus?.brierSkill, 1)}`}
            </small>
          </div>

          <div className="nmc-stat">
            <span>{isFa ? 'نرخ اصابت (تصمیم‌های متعهد)' : 'Hit rate (committed calls)'}</span>
            <strong data-testid="pru-consensus-hitrate">{fmtPct(consensus?.hitRate, 1)}</strong>
            <small>
              {isFa
                ? `${fmtInt(consensus?.committed)} از ${fmtInt(consensus?.resolved)} تصمیم، متعهد بودند`
                : `${fmtInt(consensus?.committed)} of ${fmtInt(consensus?.resolved)} decisions were committed`}
            </small>
          </div>

          <div className="nmc-stat">
            <span>{isFa ? 'کالیبراسیون (ECE)' : 'Calibration (ECE)'}</span>
            <strong data-testid="pru-consensus-ece">{fmtPct(consensus?.ece, 1)}</strong>
            <small>
              {isFa
                ? `log-loss: ${fmtNum(consensus?.logLoss)}`
                : `log-loss: ${fmtNum(consensus?.logLoss)}`}
            </small>
          </div>

          <div className="nmc-stat">
            <span>{isFa ? 'پنجرهٔ خارج از نمونه' : 'Out-of-sample window'}</span>
            <strong data-testid="pru-holdout">{fmtNum(holdout?.brier)}</strong>
            <small>
              {isFa
                ? `${fmtInt(holdout?.resolved)} پیش‌بینی پس از آخرین انتخاب (هیچ انتخابی آن‌ها را ندیده)`
                : `${fmtInt(holdout?.resolved)} predictions made after the last selection (never used by it)`}
            </small>
          </div>
        </div>

        <p className="nmc-note nmc-pru-compare" data-testid="pru-control">
          {isFa
            ? `کنترل هم‌وزن (بدون Hedge): Brier ${fmtNum(control?.brier)} · تفاوت اجماع: ${fmtNum(report?.gap?.consensusMinusControlBrier)} · بهترین جهان تکی: ${fmtNum(report?.best?.brier)} (${report?.best?.id || '—'}) · اوراکل آینده‌نگر: ${fmtNum(report?.oracle?.brier)}`
            : `Equal-weight control (no Hedge): Brier ${fmtNum(control?.brier)} · consensus delta: ${fmtNum(report?.gap?.consensusMinusControlBrier)} · best single universe: ${fmtNum(report?.best?.brier)} (${report?.best?.id || '—'}) · hindsight oracle: ${fmtNum(report?.oracle?.brier)}`}
        </p>
        <p className="nmc-note nmc-dim" data-testid="pru-oracle-note">
          {isFa
            ? 'اوراکل آینده‌نگر فقط برای سنجش فاصله گزارش می‌شود؛ هیچ تصمیمی بر آن بنا نمی‌شود. عدد مثبت در این فاصله طبیعی است.'
            : 'The oracle is future-aware and reported only as a gap reference; no decision is ever based on it. A positive gap is expected.'}
        </p>
      </div>

      {/* Universe population */}
      <div className="nmc-raster-card nmc-pru-card">
        <div className="nmc-section-head">
          <strong>
            {isFa ? 'جمعیت جهان‌ها · ژنوم، وزن و کارنامه' : 'Universe population · genome, weight, record'}
          </strong>
          <small data-testid="pru-best">
            {report?.best
              ? (isFa
                  ? `بهترین: ${report.best.id} (${HYPOTHESIS_LABELS[report.best.hypothesis]?.fa || report.best.hypothesis}) · Brier ${fmtNum(report.best.brier)}`
                  : `Best: ${report.best.id} (${HYPOTHESIS_LABELS[report.best.hypothesis]?.en || report.best.hypothesis}) · Brier ${fmtNum(report.best.brier)}`)
              : (isFa ? 'بهترین جهان: —' : 'Best universe: —')}
          </small>
        </div>

        <div className="nmc-pru-lanes" aria-label={isFa ? 'ردیابی مهارت جهان‌ها' : 'Universe skill traces'}>
          {ranked.map((u) => {
            const points = sparkPoints(u.trace);
            return (
              <div className="nmc-pru-lane" key={u.id} data-testid={`pru-universe-${u.id}`}>
                <span className="nmc-pru-lane-id">{u.id}</span>
                <span className="nmc-pru-lane-hyp">
                  {HYPOTHESIS_LABELS[u.hypothesis]?.[isFa ? 'fa' : 'en'] || u.hypothesis}
                </span>
                <svg viewBox="0 0 132 20" className="nmc-pru-spark" role="img" aria-hidden="true">
                  {points ? <polyline points={points} fill="none" strokeWidth="1.4" /> : null}
                </svg>
                <span className="nmc-pru-lane-weight" aria-hidden="true">
                  <i style={{ width: `${Math.round(Math.max(0, Math.min(1, Number(u.weight) || 0)) * 100)}%` }} />
                </span>
                <span className="nmc-pru-lane-score" data-testid={`pru-universe-score-${u.id}`}>
                  {fmtSignedPct(u.brierSkill, 1)}
                </span>
              </div>
            );
          })}
          {!ranked.length ? (
            <p className="nmc-note">{isFa ? 'جمعیتی وجود ندارد.' : 'No population.'}</p>
          ) : null}
        </div>

        <div className="nmc-pru-table" role="table" aria-label={isFa ? 'جدول جهان‌ها' : 'Universe table'}>
          <div className="nmc-pru-row nmc-pru-row-head" role="row">
            <span role="columnheader">{isFa ? 'جهان' : 'Universe'}</span>
            <span role="columnheader">{isFa ? 'نسل' : 'Gen'}</span>
            <span role="columnheader">{isFa ? 'وزن' : 'Weight'}</span>
            <span role="columnheader">Brier</span>
            <span role="columnheader">{isFa ? 'مهارت' : 'Skill'}</span>
            <span role="columnheader">{isFa ? 'مشاهده' : 'Resolved'}</span>
            <span role="columnheader">{isFa ? 'احتمال معطل' : 'Pending p'}</span>
          </div>
          {ranked.map((u) => (
            <div className="nmc-pru-row" role="row" key={`row-${u.id}`}>
              <span role="cell" title={geneSummary(u)}>
                <b>{u.id}</b>
                {u.generation > 0 ? <em>g{u.generation}</em> : null}
                {u.explorer ? <em>✦</em> : null}
              </span>
              <span role="cell">{fmtInt(u.generation)}</span>
              <span role="cell">{fmtPct(u.weight, 1)}</span>
              <span role="cell">{fmtNum(u.brier)}</span>
              <span role="cell">{fmtSignedPct(u.brierSkill, 1)}</span>
              <span role="cell">{fmtInt(u.resolved)}</span>
              <span role="cell">{fmtPct(u.pendingProbability, 1)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Selection ledger */}
      <div className="nmc-raster-card nmc-pru-card">
        <div className="nmc-section-head">
          <strong>{isFa ? 'دفتر انتخاب و زادآوری' : 'Selection & breeding ledger'}</strong>
          <small data-testid="pru-selection">
            {lastSelection
              ? (isFa
                  ? `آخرین دور #${fmtInt(lastSelection.generation)} (${lastSelection.reason === 'manual' ? 'دستی' : 'خودکار'}) · σ جهش ${fmtNum(lastSelection.sigma, 3)}`
                  : `Last round #${fmtInt(lastSelection.generation)} (${lastSelection.reason}) · mutation σ ${fmtNum(lastSelection.sigma, 3)}`)
              : (isFa ? 'هنوز انتخاب طبیعی رخ نداده است.' : 'No selection round yet.')}
          </small>
        </div>

        {lastSelection ? (
          <div className="nmc-pru-ledger" data-testid="pru-selection-last">
            <div>
              <strong>{isFa ? 'حذف‌شده‌ها' : 'Culled'}</strong>
              <small>
                {lastSelection.culled
                  .map((c) => `${c.id} (${fmtNum(c.loss, 3)})`)
                  .join(' · ') || '—'}
              </small>
            </div>
            <div>
              <strong>{isFa ? 'زاده‌شده‌ها' : 'Born'}</strong>
              <small>
                {lastSelection.born
                  .map((b) =>
                    b.parents?.length
                      ? `${b.id} ← ${b.parents.join('×')}`
                      : `${b.id} ← ${b.reason === 'explorer' ? (isFa ? 'کاوشگر' : 'explorer') : (isFa ? 'پایه' : 'seed')}`
                  )
                  .join(' · ') || '—'}
              </small>
            </div>
          </div>
        ) : null}
      </div>

      {pru.error ? (
        <p className="nmc-note" role="alert" data-testid="pru-error">
          {isFa ? `وضعیت: ${pru.error}` : `Status: ${pru.error}`}
        </p>
      ) : null}

      {pru.lastPulse ? (
        <p className="nmc-note" data-testid="pru-last-pulse">
          {isFa
            ? `آخرین پالس (${pru.lastPulse.symbol}): ${fmtInt(pru.lastPulse.bars)} کندل واقعی، ${fmtInt(pru.lastPulse.ties)} تساوی · گذشته‌نگر`
            : `Last pulse (${pru.lastPulse.symbol}): ${fmtInt(pru.lastPulse.bars)} real bars, ${fmtInt(pru.lastPulse.ties)} ties · retrospective`}
        </p>
      ) : null}

      <div className="nmc-actions">
        <button
          type="button"
          className="nmc-btn nmc-btn-primary"
          data-testid="pru-run-btn"
          disabled={pru.running || pru.evolving}
          onClick={() => { void pru.runPulse({ symbol: pru.symbol || 'BTC' }); }}
        >
          {pru.running
            ? (isFa ? '⏳ در حال اجرای پالس روی کندل‌های واقعی…' : '⏳ Running pulse over real candles…')
            : (isFa ? '🌌 اجرای پالس تحقیقاتی روی کندل‌های واقعی' : '🌌 Run research pulse on real candles')}
        </button>

        <button
          type="button"
          className="nmc-btn"
          data-testid="pru-evolve-btn"
          disabled={pru.running || pru.evolving || resolved < 3}
          onClick={() => { void pru.evolve(); }}
          title={
            isFa
              ? 'یک دور انتخاب: حذف ضعیف‌ترین‌ها و زادآوری از بازماندگان'
              : 'One selection round: cull the weakest and breed from survivors'
          }
        >
          {pru.evolving
            ? (isFa ? 'در حال انتخاب…' : 'Selecting…')
            : (isFa ? '🧬 دور انتخاب و جهش' : '🧬 Selection + mutation round')}
        </button>

        <button
          type="button"
          className="nmc-btn"
          data-testid="pru-reset-btn"
          disabled={pru.running || pru.evolving}
          onClick={() => { void pru.reset(); }}
        >
          {isFa ? 'بازنشانی جمعیت و کارنامه' : 'Reset population & record'}
        </button>
      </div>

      <p className="nmc-note nmc-note-strong" data-testid="pru-honesty">
        {isFa
          ? 'قاعدهٔ صداقت: هیچ قیمتی ساخته نمی‌شود و هیچ پیش‌بینی پیش از تولد کندل بعدی امتیاز نمی‌گیرد. پالس روی کندل‌های گذشته «پس‌نگر» است و هرگز تأیید یک استراتژی محسوب نمی‌شود؛ انتخاب طبیعی هم روی همان داده انجام می‌شود، پس Brier پایین به‌تنهایی سوددهی نیست. مرز امنیتی: canExecute=false · canSign=false · canMoveFunds=false — فقط تحلیل و پژوهش روی دستگاه شما، بدون GPU سرور.'
          : 'Honesty rule: no price is invented and no prediction is scored before the next bar exists. A pulse over past candles is retrospective and never counts as confirmation; selection also happens on that same data, so a low Brier alone is not profitability. Security boundary: canExecute=false · canSign=false · canMoveFunds=false — research on your device only, zero server GPU.'}
      </p>
    </section>
  );
});

export default ParallelUniversesPanel;
