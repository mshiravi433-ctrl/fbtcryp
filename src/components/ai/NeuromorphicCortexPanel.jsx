/**
 * FBT NEUROMORPHIC CORTEX 2050 — PHASE 6: INTERACTIVE CONSOLE & MODAL
 * ===========================================================================
 * Displays ONLY real, measured neuromorphic telemetry from the user's own
 * WebGPU / CPU worker and the Byzantine-resilient Swarm Coordinator:
 *   · Unmeasured values render `—` (never pre-filled fake percentages)
 *   · Live Spike Raster reflects actual excitatory/inhibitory neuron indices
 *   · Liquid ODE bars reflect actual 32-D continuous-time state amplitudes
 *   · Interactive Walk-Forward Evolution runs on real live market candles
 *   · Phase 6 brain-inspired telemetry: measured variational free energy and its
 *     trend, the four neuromodulators, basal-ganglia action selection,
 *     prefrontal working-memory load, cerebellar forward error, theta plasticity
 *     window and an event-driven energy estimate — all from the running circuits.
 *   · Phase 7 universal scientific memory: pre-registered hypotheses, the BH-FDR
 *     discovery budget, the best posterior with its credible interval, the
 *     memory's own prequential calibration, the random-effects meta-analysis and
 *     the world-registry consensus. Every value comes from the device report.
 *
 * This file previously contained literal `\n` escape sequences inside its JSX
 * (an editor artefact), which made the whole module unparsable: any page that
 * imported it — AiControlCenter, IntentOpsPanels, the `/intent` header chip —
 * failed to build. It is rewritten here from the same design, with the same
 * `data-testid` contract, plus the Phase-6 block.
 */

import { memo } from 'react';
import { useNeuromorphicCortex } from '../../lib/neuromorphic/useNeuromorphicCortex.js';
import ParallelUniversesPanel from './ParallelUniversesPanel.jsx';
import { BASE_RESERVOIR_SIZE, LIQUID_SIZE } from '../../lib/neuromorphic/cortexCore.js';
import './neuromorphic-cortex.css';

const REGIME_LABELS = Object.freeze({
  trendUp: { fa: 'روند صعودی', en: 'Trend Up' },
  trendDown: { fa: 'روند نزولی', en: 'Trend Down' },
  meanRevert: { fa: 'بازگشت به میانگین', en: 'Mean Revert' },
  shock: { fa: 'شوک / جهش نوسان', en: 'Volatility Shock' }
});

const MODE_LABELS = Object.freeze({
  TURBO_SWARM: { fa: 'توربو کلونی (GPU/CPU کامل)', en: 'TURBO SWARM' },
  BALANCED_EDGE: { fa: 'لبه‌ای متعادل', en: 'BALANCED EDGE' },
  ECO_SPARSE: { fa: 'کم‌مصرف رویدادمحور (محافظ باتری)', en: 'ECO SPARSE' },
  PAUSED: { fa: 'متوقف توسط کاربر', en: 'PAUSED' }
});

const PROFILE_LABELS = Object.freeze({
  EXPLOIT_FULL: {
    fa: 'بهره‌برداری کامل (داده ساختار دارد)',
    en: 'EXPLOIT FULL'
  },
  CONSOLIDATE: {
    fa: 'تثبیت (ساختار نسبی)',
    en: 'CONSOLIDATE'
  },
  HOLD_SPARSE: {
    fa: 'نگه‌داشت کم‌مصرف (چیزی برای یادگیری نیست)',
    en: 'HOLD SPARSE'
  }
});

const ADAPTIVE_REASON_LABELS = Object.freeze({
  NO_OBSERVATION_YET: { fa: 'بدون مشاهده', en: 'No observation yet' },
  SURPRISE_ABOVE_CEILING: { fa: 'شگفتی بالاتر از سقف', en: 'Surprise above ceiling' },
  DECISION_UNDECIDED: { fa: 'تصمیم حل‌نشده', en: 'Decision undecided' },
  DECIDED_AND_PREDICTABLE: { fa: 'قابل پیش‌بینی و مصمم', en: 'Decided & predictable' },
  STRUCTURE_PARTIAL: { fa: 'ساختار نسبی', en: 'Structure partial' },
  NO_DECISION_TELEMETRY: { fa: 'بدون تل‌متری تصمیم', en: 'No decision telemetry' }
});

const CORTEX_CONDITION_LABELS = Object.freeze({
  volatility: { fa: 'نوسان جریان مشاهده', en: 'Stream volatility' },
  surprise: { fa: 'شگفتی (خطای پیش‌بینی)', en: 'Surprise (prediction error)' },
  regimeEntropy: { fa: 'آنتروپی رژیم', en: 'Regime entropy' },
  decisionMargin: { fa: 'حاشیهٔ تصمیم', en: 'Decision margin' },
  signalToNoise: { fa: 'نسبت سیگنال به نویز', en: 'Signal / noise' }
});

const ACTION_LABELS = Object.freeze({
  LONG: { fa: 'خرید / LONG', en: 'LONG' },
  FLAT: { fa: 'بی‌طرف / FLAT', en: 'FLAT' },
  SHORT: { fa: 'فروش / SHORT', en: 'SHORT' }
});

const NEUROMODULATORS = Object.freeze([
  { key: 'dopamine', fa: 'دوپامین (پاداش)', en: 'Dopamine (reward)' },
  { key: 'acetylcholine', fa: 'استیل‌کولین (دقت)', en: 'Acetylcholine (precision)' },
  { key: 'norepinephrine', fa: 'نوراپی‌نفرین (هشیاری)', en: 'Norepinephrine (arousal)' },
  { key: 'serotonin', fa: 'سروتونین (افق)', en: 'Serotonin (horizon)' }
]);

function fmtPct(val, digits = 1) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  return `${(Number(val) * 100).toFixed(digits)}%`;
}

function fmtSigned(val, digits = 3) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  const n = Number(val);
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
}

function fmtNum(val, digits = 4) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return '—';
  return Number(val).toFixed(digits);
}

const NeuromorphicCortexPanel = memo(function NeuromorphicCortexPanel({ locale = 'fa' }) {
  const isFa = !String(locale || 'fa').toLowerCase().startsWith('en');
  const nm = useNeuromorphicCortex({ autoSync: true });

  const readout = nm.readout;
  const brain = readout?.brain || null;
  const gov = nm.governor;
  const swarm = nm.swarmStatus;
  const neuronsTotal = readout?.topology?.reservoirNeurons ?? nm.reservoirNeurons ?? BASE_RESERVOIR_SIZE;
  const grownCount = Math.max(0, neuronsTotal - BASE_RESERVOIR_SIZE);

  const excSet = new Set(readout?.spikes?.excitatoryIndices || []);
  const inhSet = new Set(readout?.spikes?.inhibitoryIndices || []);

  const liquidPreview = Array.isArray(readout?.liquidPreview) && readout.liquidPreview.length
    ? readout.liquidPreview
    : new Array(Math.min(12, LIQUID_SIZE)).fill(0);

  const backendLabel = nm.backend === 'webgpu'
    ? `WebGPU WGSL${nm.adapterLabel ? ` · ${nm.adapterLabel}` : ''}`
    : nm.backend === 'cpu-float32'
      ? (isFa ? 'CPU Float32 (Web Worker)' : 'CPU Float32 (Web Worker)')
      : '—';

  const govLabel = gov?.mode
    ? (isFa ? MODE_LABELS[gov.mode]?.fa : MODE_LABELS[gov.mode]?.en) || gov.mode
    : '—';

  const globalGen = nm.globalGeneration ?? swarm?.globalGeneration ?? null;
  const callerXp = swarm?.callerNode?.neuralXp ?? 0;
  const brainOn = nm.brainEnabled !== false;

  const consolidation = nm.consolidationLast;

  /* ── Phase 9 — Adaptive Intelligence Ecosystem ────────────────────────── */
  const adaptive = nm.adaptive || null;
  const adScores = adaptive?.scores || null;
  const adCond = adaptive?.condition || null;
  const adServo = adaptive?.servo || null;
  const adAct = adaptive?.actuators || null;
  const adBudget = adaptive?.budget || null;
  const adLearn = adaptive?.learning || null;
  const adRate = adaptive?.rateCode || null;
  const adOn = nm.adaptiveEnabled !== false;
  const adaptiveProfileLabel = adaptive?.profile
    ? (isFa ? PROFILE_LABELS[adaptive.profile]?.fa : PROFILE_LABELS[adaptive.profile]?.en) || adaptive.profile
    : '—';
  const adaptiveReasonLabel = adaptive?.reason
    ? (isFa ? ADAPTIVE_REASON_LABELS[adaptive.reason]?.fa : ADAPTIVE_REASON_LABELS[adaptive.reason]?.en) || adaptive.reason
    : '—';

  /* ── Phase 7 — Universal Scientific Memory ─────────────────────────────── */
  const science = nm.science || null;
  const sciTotals = science?.totals || null;
  const sciFdr = science?.fdr || null;
  const sciBest = science?.best || null;
  const sciConfirmed = science?.bestConfirmed || null;
  const sciCal = science?.calibration || null;
  const sciMeta = science?.meta || null;
  const sciWorld = nm.scienceWorld || null;
  const sciPrior = nm.sciencePrior || null;
  const sciSensitivity = science?.sensitivity || null;
  const sciStatusLabel = science
    ? (sciFdr?.confirmed > 0
        ? (isFa ? `${sciFdr.confirmed} باور تأییدشده` : `${sciFdr.confirmed} confirmed belief(s)`)
        : (isFa ? 'پیش‌ثبت فعال · بدون تأیید' : 'Pre-registration active · none confirmed'))
    : (isFa ? 'در انتظار اولین شاهد' : 'Awaiting first evidence');

  return (
    <section
      className="nmc-root"
      dir={isFa ? 'rtl' : 'ltr'}
      data-testid="neuromorphic-cortex-panel"
    >
      {/* Hero Header */}
      <div className="nmc-hero">
        <div className="nmc-hero-title">
          <div className="nmc-orb" data-active={Boolean(readout && !nm.paused)} aria-hidden="true">
            ⚡
          </div>
          <div className="nmc-hero-copy">
            <h3>
              {isFa
                ? 'کورتکس نورومورفیک FBT · معماری ۲۰۵۰ + هستهٔ الهام‌گرفته از مغز'
                : 'FBT Neuromorphic Cortex · 2050 + Brain-Inspired Core'}
            </h3>
            <p>
              {isFa
                ? 'شبکهٔ پالس‌محور LIF + مایعات ۳۲ بعدی + کدگذاری پیش‌بین + دوپامین/استیل‌کولین/نوراپی‌نفرین/سروتونین + عقده‌های قاعده‌ای + حافظهٔ کاری پیش‌پیشانی، روی GPU/CPU دستگاه شما · هزینهٔ سرور GPU: صفر'
                : 'Spiking LIF + 32-D liquid ODE + predictive coding + dopamine/acetylcholine/norepinephrine/serotonin + basal ganglia + prefrontal working memory, on your own GPU/CPU · $0 server GPU'}
            </p>
          </div>
        </div>

        <div className="nmc-badges">
          <span className="nmc-pill nmc-pill-cyan" data-testid="nmc-backend-pill">
            {backendLabel}
          </span>
          <span className="nmc-pill nmc-pill-violet" data-testid="nmc-gen-pill">
            {isFa
              ? `نسل جهانی: ${globalGen !== null ? `#${globalGen}` : `#${nm.localGeneration}`}`
              : `Global Gen: ${globalGen !== null ? `#${globalGen}` : `#${nm.localGeneration}`}`}
          </span>
          <span className="nmc-pill nmc-pill-mint" data-testid="nmc-xp-pill">
            {isFa ? `امتیاز محاسباتی: ${callerXp} XP` : `Compute XP: ${callerXp}`}
          </span>
          <span className="nmc-pill nmc-pill-violet" data-testid="nmc-science-pill">
            {isFa ? 'حافظهٔ علمی جهانی' : 'Scientific Memory'}: {sciStatusLabel}
          </span>
          <span
            className={`nmc-pill ${brainOn ? 'nmc-pill-amber' : ''}`}
            data-testid="nmc-brain-pill"
          >
            {brainOn
              ? (isFa ? 'هستهٔ مغزمحور: روشن' : 'Brain core: ON')
              : (isFa ? 'هستهٔ مغزمحور: خاموش (فاز ۵)' : 'Brain core: OFF (Phase 5)')}
          </span>
        </div>
      </div>

      {/* Live Cortical Spike Raster & Liquid State */}
      <div className="nmc-raster-card">
        <div className="nmc-section-head">
          <strong>
            {isFa
              ? `ماتریس زندهٔ پالس‌های سیناپسی (${neuronsTotal} نورون LIF + ۳۲ نورون مایع)`
              : `Live Synaptic Spike Raster (${neuronsTotal} LIF + 32 Liquid ODE Neurons)`}
          </strong>
          <small data-testid="nmc-firing-rate">
            {readout
              ? (isFa
                  ? `نرخ شلیک: ${readout.spikes.firingRateHz} Hz · تأخیر دستگاه: ${readout.latencyMs} ms`
                  : `Firing: ${readout.spikes.firingRateHz} Hz · Device latency: ${readout.latencyMs} ms`)
              : (isFa ? 'در انتظار اولین دادهٔ واقعی بازار…' : 'Waiting for first live market observation…')}
          </small>
        </div>

        <div className="nmc-neuron-grid" aria-label={isFa ? 'شبکه نورون‌ها' : 'Neuron grid'}>
          {Array.from({ length: Math.min(96, neuronsTotal) }, (_, idx) => {
            const neuronIndex = grownCount > 0 && idx >= 72
              ? BASE_RESERVOIR_SIZE + ((idx - 72) % grownCount)
              : idx;
            const spikeKind = excSet.has(neuronIndex)
              ? 'exc'
              : inhSet.has(neuronIndex)
                ? 'inh'
                : 'idle';
            const isGrown = neuronIndex >= BASE_RESERVOIR_SIZE;
            return (
              <span
                key={idx}
                className="nmc-neuron-cell"
                data-spike={spikeKind}
                data-grown={isGrown ? 'true' : 'false'}
                title={`Neuron #${neuronIndex} (${spikeKind})`}
              />
            );
          })}
        </div>

        <div className="nmc-liquid-bars" aria-label={isFa ? 'حالت معادلات دیفرانسیل مایع' : 'Liquid ODE state'}>
          {liquidPreview.map((val, i) => {
            const pct = Math.max(10, Math.min(100, Math.round(Math.abs(Number(val) || 0) * 100)));
            return (
              <div key={i} className="nmc-liquid-col" title={`Liquid x[${i}] = ${val}`}>
                <div className="nmc-liquid-fill" style={{ height: `${pct}%` }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Telemetry */}
      <div className="nmc-grid-4">
        <div className="nmc-stat">
          <span>{isFa ? 'فرماندار سخت‌افزار کاربر' : 'Hardware Governor'}</span>
          <strong data-testid="nmc-governor-mode">{govLabel}</strong>
          <small>
            {gov?.hardware?.cpuCores
              ? (isFa
                  ? `${gov.hardware.cpuCores} هسته پردازشی${gov.hardware.batteryPct != null ? ` · باتری ${gov.hardware.batteryPct}%` : ''}`
                  : `${gov.hardware.cpuCores} CPU cores${gov.hardware.batteryPct != null ? ` · Battery ${gov.hardware.batteryPct}%` : ''}`)
              : (isFa ? 'محافظ خودکار باتری و دما' : 'Auto thermal & battery guard')}
          </small>
        </div>

        <div className="nmc-stat">
          <span>{isFa ? 'خودارتقایی ساختاری' : 'Structural Topology'}</span>
          <strong data-testid="nmc-topology-neurons">
            {isFa ? `${neuronsTotal} نورون` : `${neuronsTotal} Neurons`}
            {grownCount > 0 ? ` (+${grownCount})` : ''}
          </strong>
          <small>
            {readout?.topology
              ? (isFa
                  ? `${readout.topology.activeSynapses.toLocaleString()} سیناپس · خلوت‌سازی ${fmtPct(readout.topology.sparsity, 0)}`
                  : `${readout.topology.activeSynapses.toLocaleString()} synapses · ${fmtPct(readout.topology.sparsity, 0)} sparse`)
              : (isFa ? 'رشد و هرس خودکار سیناپس‌ها' : 'Dynamic neurogenesis & pruning')}
          </small>
        </div>

        <div className="nmc-stat">
          <span>{isFa ? 'یادگیری لحظه‌ای R-STDP' : 'Online R-STDP Plasticity'}</span>
          <strong data-testid="nmc-hit-rate">
            {readout?.learning?.hitRate != null ? fmtPct(readout.learning.hitRate, 1) : '—'}
          </strong>
          <small>
            {readout?.learning
              ? (isFa
                  ? `${readout.learning.resolvedPredictions} پیش‌بینی سنجیده‌شده · خطای Brier: ${readout.learning.meanBrier ?? '—'}`
                  : `${readout.learning.resolvedPredictions} resolved · Brier: ${readout.learning.meanBrier ?? '—'}`)
              : (isFa ? 'بدون دادهٔ ساختگی پیش از سنجش' : 'Honest — fills as ticks resolve')}
          </small>
        </div>

        <div className="nmc-stat">
          <span>{isFa ? 'کلونی ضدتقلب' : 'Byzantine Swarm'}</span>
          <strong data-testid="nmc-swarm-nodes">
            {swarm
              ? (isFa ? `${swarm.activeNodes24h} گره فعال` : `${swarm.activeNodes24h} Active Nodes`)
              : '—'}
          </strong>
          <small>
            {swarm
              ? (isFa
                  ? `${swarm.totalAcceptedDeltas} دلتای تأییدشده · حدنصاب: ${swarm.effectiveQuorum}`
                  : `${swarm.totalAcceptedDeltas} verified deltas · Quorum: ${swarm.effectiveQuorum}`)
              : (isFa ? 'تجمیع Trimmed-Mean بدون سرور GPU' : 'Trimmed-Mean zero-GPU sync')}
          </small>
        </div>
      </div>

      {/* ── Phase 6 — Brain-Inspired Core ─────────────────────────────────── */}
      <div className="nmc-raster-card nmc-brain-card">
        <div className="nmc-section-head">
          <strong>
            {isFa
              ? 'هستهٔ شناختی الهام‌گرفته از مغز (Brain-Inspired)'
              : 'Brain-Inspired Cognitive Core'}
          </strong>
          <small data-testid="nmc-free-energy">
            {brain
              ? (isFa
                  ? `انرژی آزاد: ${fmtNum(brain.prediction.freeEnergy)} · روند: ${fmtSigned(brain.prediction.trend, 4)}`
                  : `Free energy: ${fmtNum(brain.prediction.freeEnergy)} · trend: ${fmtSigned(brain.prediction.trend, 4)}`)
              : (isFa ? 'در انتظار تکمیل اولین چرخهٔ شناختی…' : 'Waiting for the first cognitive cycle…')}
          </small>
        </div>

        <div className="nmc-grid-4">
          <div className="nmc-stat">
            <span>{isFa ? 'تصمیم عقده‌های قاعده‌ای' : 'Basal-ganglia decision'}</span>
            <strong data-testid="nmc-brain-action">
              {brain
                ? (isFa ? ACTION_LABELS[brain.basalGanglia.action]?.fa : ACTION_LABELS[brain.basalGanglia.action]?.en)
                : '—'}
            </strong>
            <small>
              {brain
                ? (isFa
                    ? `اطمینان ${fmtPct(brain.basalGanglia.confidence, 1)} · تفاوت Go/NoGo ${fmtNum(brain.basalGanglia.margin, 3)}`
                    : `Confidence ${fmtPct(brain.basalGanglia.confidence, 1)} · Go/NoGo margin ${fmtNum(brain.basalGanglia.margin, 3)}`)
                : (isFa ? 'انتخاب عمل فقط پس از دادهٔ واقعی' : 'Action only from real observations')}
            </small>
          </div>

          <div className="nmc-stat">
            <span>{isFa ? 'حافظهٔ کاری پیش‌پیشانی' : 'Prefrontal working memory'}</span>
            <strong data-testid="nmc-wm-load">{brain ? fmtPct(brain.workingMemory.load, 0) : '—'}</strong>
            <small>
              {brain
                ? (isFa
                    ? `${brain.workingMemory.filled} از ${brain.workingMemory.slots} اسلات · شباهت بازخوانی ${fmtNum(brain.workingMemory.recallSimilarity, 3)}`
                    : `${brain.workingMemory.filled} of ${brain.workingMemory.slots} slots · recall similarity ${fmtNum(brain.workingMemory.recallSimilarity, 3)}`)
                : (isFa ? 'نوشتن با هشیاری، خواندن با شباهت' : 'Gated write, similarity read')}
            </small>
          </div>

          <div className="nmc-stat">
            <span>{isFa ? 'مدل پیش‌روی مخچه' : 'Cerebellar forward model'}</span>
            <strong data-testid="nmc-forward-error">
              {brain ? fmtNum(brain.cerebellum.forwardErrorEma, 4) : '—'}
            </strong>
            <small>
              {brain
                ? (isFa
                    ? `اصلاح Smith ${fmtNum(brain.cerebellum.correctionGain, 3)} · ${brain.cerebellum.updates} به‌روزرسانی`
                    : `Smith correction ${fmtNum(brain.cerebellum.correctionGain, 3)} · ${brain.cerebellum.updates} updates`)
                : (isFa ? 'خطای پیش‌بینی حالت بعدی' : 'Next-state prediction error')}
            </small>
          </div>

          <div className="nmc-stat">
            <span>{isFa ? 'پنجرهٔ پلاستیسیتی تتا-گاما' : 'Theta–gamma plasticity'}</span>
            <strong data-testid="nmc-plasticity-window">
              {brain
                ? (brain.oscillation.plasticityWindowOpen
                    ? (isFa ? 'باز' : 'OPEN')
                    : (isFa ? 'بسته' : 'CLOSED'))
                : '—'}
            </strong>
            <small>
              {brain
                ? (isFa
                    ? `فاز ${brain.oscillation.thetaPhase} · ${brain.oscillation.gammaBursts} انفجار گاما · بهره ${fmtNum(brain.influence.plasticityGain, 3)}`
                    : `Phase ${brain.oscillation.thetaPhase} · ${brain.oscillation.gammaBursts} gamma bursts · gain ${fmtNum(brain.influence.plasticityGain, 3)}`)
                : (isFa ? 'قفل زمانی یادگیری سیناپس' : 'Synaptic learning time-lock')}
            </small>
          </div>
        </div>

        {/* Neuromodulators */}
        <div className="nmc-neuromod-grid" aria-label={isFa ? 'نورومدولاتورها' : 'Neuromodulators'}>
          {NEUROMODULATORS.map(({ key, fa, en }) => {
            const val = brain?.neuromodulators?.[key];
            const pct = val != null && Number.isFinite(Number(val))
              ? Math.round(Number(val) * 100)
              : 0;
            return (
              <div key={key} className="nmc-neuromod" data-testid={`nmc-neuromod-${key}`}>
                <div className="nmc-regime-top">
                  <span>{isFa ? fa : en}</span>
                  <strong>{brain ? fmtPct(val, 0) : '—'}</strong>
                </div>
                <div className="nmc-bar-track">
                  <div className="nmc-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="nmc-section-head nmc-section-head-tight">
          <strong>{isFa ? 'پیش‌بینی سلسله‌مراتبی (Predictive Coding)' : 'Hierarchical prediction'}</strong>
          <small>
            {brain
              ? (isFa
                  ? `پیچیدگی ${fmtNum(brain.prediction.complexity, 4)} · ارزیابی ${fmtNum(brain.prediction.freeEnergyEma)} · رانش از چرخهٔ اول ${fmtSigned(
                      brain.prediction.freeEnergyTick1 != null && brain.prediction.freeEnergy
                        ? brain.prediction.freeEnergy - brain.prediction.freeEnergyTick1
                        : null,
                      4
                    )}`
                  : `Complexity ${fmtNum(brain.prediction.complexity, 4)} · EMA ${fmtNum(brain.prediction.freeEnergyEma)} · drift from first cycle ${fmtSigned(
                      brain.prediction.freeEnergyTick1 != null && brain.prediction.freeEnergy
                        ? brain.prediction.freeEnergy - brain.prediction.freeEnergyTick1
                        : null,
                      4
                    )}`)
              : (isFa ? 'دو سطح خطای پیش‌بینی با دقت یادگیرنده' : 'Two error levels with learned precision')}
          </small>
        </div>

        <div className="nmc-neuromod-grid">
          {(brain?.prediction?.levels || []).map((level) => (
            <div key={level.name} className="nmc-neuromod" data-testid={`nmc-pc-${level.name}`}>
              <div className="nmc-regime-top">
                <span>
                  {level.name === 'sensory'
                    ? (isFa ? 'سطح حسی (ε₁)' : 'Sensory (ε₁)')
                    : (isFa ? 'سطح انجمنی (ε₂)' : 'Associative (ε₂)')}
                </span>
                <strong>{fmtNum(level.error, 4)}</strong>
              </div>
              <div className="nmc-bar-track">
                <div
                  className="nmc-bar-fill"
                  style={{ width: `${Math.min(100, Math.round(Number(level.error) * 100))}%` }}
                />
              </div>
              <small className="nmc-dim">
                {isFa
                  ? `دقت π=${fmtNum(level.precision, 2)} · انرژی ${fmtNum(level.energy, 5)}`
                  : `precision π=${fmtNum(level.precision, 2)} · energy ${fmtNum(level.energy, 5)}`}
              </small>
            </div>
          ))}
          {!brain ? (
            <p className="nmc-note">
              {isFa
                ? 'هیچ عددی از پیش نوشته نشده؛ این بخش با اولین مشاهدهٔ واقعی بازار پر می‌شود.'
                : 'Nothing is pre-filled — this block fills on the first real market observation.'}
            </p>
          ) : null}
        </div>
      </div>


      {/* ── Phase 9 — Adaptive Intelligence Ecosystem ─────────────────────── */}
      <div className="nmc-raster-card nmc-adaptive-card" data-testid="nmc-adaptive-card">
        <div className="nmc-section-head">
          <strong>
            {isFa
              ? 'اکوسیستم هوش تطبیقی — تطبیق کورتکس با شرایط داده و توان دستگاه'
              : 'Adaptive Intelligence Ecosystem — cortex adapts to the data and to the device'}
          </strong>
          <small data-testid="nmc-adaptive-profile">
            {adaptive
              ? (isFa
                  ? `پروفایل: ${adaptiveProfileLabel} · دلیل: ${adaptiveReasonLabel}`
                  : `Profile: ${adaptiveProfileLabel} · ${adaptiveReasonLabel}`)
              : (isFa
                  ? 'در انتظار اولین مشاهده — هیچ پروفایلی پیش از داده انتخاب نمی‌شود'
                  : 'Awaiting the first observation — no profile is chosen before data')}
          </small>
        </div>

        <div className="nmc-grid-4">
          <div className="nmc-stat">
            <span>{isFa ? 'اثربخشی سیناپسی هموستاتیک (سرور نرخ شلیک)' : 'Homeostatic synaptic efficacy (rate servo)'}</span>
            <strong data-testid="nmc-adaptive-efficacy">{fmtNum(adAct?.synapticEfficacy, 3)}</strong>
            <small>
              {adServo
                ? (isFa
                    ? `نرخ ${fmtPct(adServo.rate, 1)} از هدف ${fmtPct(adServo.targetRate, 0)} · خطای میانگین ${fmtNum(adServo.stats?.meanAbsError, 3)}`
                    : `rate ${fmtPct(adServo.rate, 1)} of target ${fmtPct(adServo.targetRate, 0)} · mean |error| ${fmtNum(adServo.stats?.meanAbsError, 3)}`)
                : (isFa ? 'کنترل بازخوردی روی نرخ شلیک اندازه‌گیری‌شده' : 'Closed loop on the measured firing rate')}
            </small>
          </div>

          <div className="nmc-stat">
            <span>{isFa ? 'نرخ شلیک واقعی / بدون سرور' : 'Measured rate / without servo'}</span>
            <strong data-testid="nmc-adaptive-rate">{fmtPct(adRate?.rate, 1)}</strong>
            <small>
              {adRate
                ? (isFa
                    ? `${adRate.spikes} از ${adRate.neurons} نورون · بدون سرور ${adRate.spikesWithoutServo} · آنتروپی کد نرخ ${fmtNum(adRate.firingRateEntropy, 3)}`
                    : `${adRate.spikes} of ${adRate.neurons} neurons · without servo ${adRate.spikesWithoutServo} · rate-code entropy ${fmtNum(adRate.firingRateEntropy, 3)}`)
                : (isFa ? 'شمارش واقعی پالس‌ها، نه تخمین' : 'Counted spikes, not a model')}
            </small>
          </div>

          <div className="nmc-stat">
            <span>{isFa ? 'تخصیص بودجهٔ دستگاه' : 'Device budget allocation'}</span>
            <strong data-testid="nmc-adaptive-budget">
              {adBudget
                ? (isFa
                    ? `${adBudget.spentReservoirNeurons} از ${adBudget.governorReservoirCeiling ?? '—'} نورون`
                    : `${adBudget.spentReservoirNeurons} of ${adBudget.governorReservoirCeiling ?? '—'} neurons`)
                : '—'}
            </strong>
            <small>
              {adBudget
                ? (isFa
                    ? `استفاده ${fmtPct((adBudget.utilisationPct ?? 0) / 100, 0)} از سقف سخت‌افزار · سقف داده‌محور ${adAct?.reservoirCap ?? '—'}`
                    : `${fmtPct((adBudget.utilisationPct ?? 0) / 100, 0)} of the hardware ceiling · data-shaped cap ${adAct?.reservoirCap ?? '—'}`)
                : (isFa ? 'سقف سخت‌افزار × آنچه داده توجیه می‌کند' : 'Hardware ceiling ∩ what the data justifies')}
            </small>
          </div>

          <div className="nmc-stat">
            <span>{isFa ? 'چرخهٔ وظیفهٔ یادگیری R-STDP' : 'R-STDP learning duty cycle'}</span>
            <strong data-testid="nmc-adaptive-duty">{adLearn ? fmtPct((adLearn.dutyCyclePct ?? 0) / 100, 0) : '—'}</strong>
            <small>
              {adLearn
                ? (isFa
                    ? `${adLearn.ticksSpent} تیک یادگیری واقعی از ${adaptive?.ticks ?? '—'} · رضایت یادگیری: ${adLearn.optIn ? 'آری' : 'خیر'}`
                    : `${adLearn.ticksSpent} real learning ticks of ${adaptive?.ticks ?? '—'} · consent: ${adLearn.optIn ? 'yes' : 'no'}`)
                : (isFa ? 'یادگیری بدون رضایت خرج نمی‌شود' : 'Learning is never spent without consent')}
            </small>
          </div>
        </div>

        {/* Measured conditions — the inputs the profile is computed from */}
        <div className="nmc-adaptive-conditions">
          {Object.entries(CORTEX_CONDITION_LABELS).map(([key, label]) => {
            const value = adCond ? adCond[key] : null;
            const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, Math.round(Number(value) * 100)));
            return (
              <div key={key} className="nmc-regime-row" data-testid={`nmc-adaptive-cond-${key}`}>
                <div className="nmc-regime-top">
                  <span>{isFa ? label.fa : label.en}</span>
                  <strong>{fmtNum(value, 3)}</strong>
                </div>
                <div className="nmc-bar-track">
                  <div className="nmc-bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Decision confidence — the distance to the nearest cut point, not a slogan */}
        <p className="nmc-note" data-testid="nmc-adaptive-scores">
          {adScores
            ? (isFa
                ? `امتیاز تصمیم: پیش‌بینی‌پذیری ${fmtNum(adScores.predictability, 3)} · فاصله تا «نگه‌داشت» ${fmtSigned(adScores.distanceToHold, 3)} · فاصله تا «بهره‌برداری کامل» ${fmtSigned(adScores.distanceToExploit, 3)} — هر سه از تل‌متری خود کورتکس، با هیسترزیس ${adaptive?.rules?.hysteresis ?? '—'}`
                : `Decision scores: predictability ${fmtNum(adScores.predictability, 3)} · distance to HOLD ${fmtSigned(adScores.distanceToHold, 3)} · distance to EXPLOIT ${fmtSigned(adScores.distanceToExploit, 3)} — all from the cortex's own telemetry, hysteresis ${adaptive?.rules?.hysteresis ?? '—'}`)
            : (isFa
                ? 'هیچ عددی از پیش نوشته نشده؛ این بلوک با اولین مشاهدهٔ واقعی بازار پر می‌شود.'
                : 'Nothing is pre-filled — this block fills on the first real market observation.')}
        </p>

        {adServo?.stats ? (
          <p className="nmc-note" data-testid="nmc-adaptive-saturation">
            {isFa
              ? `پالس‌های اشباع (نرخ ≥ ۹۵٪): ${adServo.stats.saturationTicks} از ${adServo.stats.ticks} تیک · تیک‌های سکوت: ${adServo.stats.silentTicks} · بازده صرفه‌جویی‌شدهٔ اندازه‌گیری‌شده: ${adaptive?.efficiency?.spikeSavingPct != null ? fmtPct(adaptive.efficiency.spikeSavingPct / 100, 1) : '—'} (${adaptive?.efficiency?.statement || '—'})`
              : `Saturated ticks (rate ≥ 95%): ${adServo.stats.saturationTicks} of ${adServo.stats.ticks} · silent ticks: ${adServo.stats.silentTicks} · measured spike saving: ${adaptive?.efficiency?.spikeSavingPct != null ? fmtPct(adaptive.efficiency.spikeSavingPct / 100, 1) : '—'} (${adaptive?.efficiency?.statement || '—'})`}
          </p>
        ) : null}

        <div className="nmc-controls">
          <button
            type="button"
            className={`nmc-btn ${adOn ? 'nmc-btn-on' : ''}`}
            data-testid="nmc-adaptive-toggle"
            onClick={() => nm.setAdaptiveEnabled(!adOn)}
          >
            {adOn
              ? (isFa ? 'تطبیق داده‌محور: روشن' : 'Data adaptation: ON')
              : (isFa ? 'تطبیق داده‌محور: خاموش (فاز ۶ خالص)' : 'Data adaptation: OFF (pure Phase 6)')}
          </button>
          <button
            type="button"
            className={`nmc-btn ${adLearn?.optIn ? 'nmc-btn-on' : ''}`}
            data-testid="nmc-adaptive-learn-toggle"
            onClick={() => nm.setLearningOptIn(!(adLearn?.optIn !== false))}
          >
            {adLearn?.optIn !== false
              ? (isFa ? 'رضایت یادگیری روی دستگاه: آری' : 'On-device learning consent: YES')
              : (isFa ? 'رضایت یادگیری روی دستگاه: خیر' : 'On-device learning consent: NO')}
          </button>
          <button
            type="button"
            className="nmc-btn"
            data-testid="nmc-adaptive-refresh-btn"
            onClick={() => nm.refreshAdaptive()}
          >
            {isFa ? 'خوانش تازهٔ شرایط' : 'Re-read conditions'}
          </button>
        </div>

        <p className="nmc-note" data-testid="nmc-adaptive-honesty">
          {isFa
            ? 'قاعدهٔ صداقت: پروفایل فقط از دو سنجهٔ خودِ کورتکس (شگفتی پیش‌بینی و حاشیهٔ تصمیم عقده‌های قاعده‌ای) ساخته می‌شود؛ بقیهٔ شرایط فقط گزارش می‌شوند چون در اندازه‌گیری از هم جدا نشدند. اثربخشی سیناپسی همان یادگیری R-STDP را کند یا تند می‌کند و هرگز جایگزین آن نمی‌شود. هیچ ادعای دقت یا سوددهی در این بلوک نیست و هیچ داده‌ای از دستگاه خارج نمی‌شود.'
            : 'Honesty rule: the profile is computed from exactly two of the cortex\u2019s own measurements — predictive surprise and the basal-ganglia decision margin. The rest of the conditions are reported but do not switch the profile, because on the probe they did not separate. Synaptic efficacy paces R-STDP; it never replaces it. No accuracy or profitability is claimed here, and no data leaves the device.'}
        </p>
      </div>

      {/* ── Phase 7 — Universal Scientific Memory ─────────────────────────── */}
      <div className="nmc-raster-card nmc-science-card">
        <div className="nmc-section-head">
          <strong>
            {isFa
              ? 'حافظهٔ علمی جهانی — مکمل حافظهٔ محلی کورتکس (Universal Scientific Memory)'
              : 'Universal Scientific Memory — the epistemic complement to local engrams'}
          </strong>
          <small data-testid="nmc-science-hypotheses">
            {science
              ? (isFa
                  ? `${sciTotals.hypotheses} فرضیهٔ پیش‌ثبت‌شده · ${sciTotals.observations} شاهد · ${sciTotals.prospective} آینده‌نگر (پس از ثبت) / ${sciTotals.retrospective} پس‌نگر`
                  : `${sciTotals.hypotheses} pre-registered hypotheses · ${sciTotals.observations} observations · ${sciTotals.prospective} post-registration / ${sciTotals.retrospective} retrospective`)
              : (isFa ? 'بدون شاهد ساختگی — با اولین خاطرهٔ واقعی پر می‌شود' : 'No invented evidence — fills from real resolved engrams')}
          </small>
        </div>

        <div className="nmc-grid-4">
          <div className="nmc-stat">
            <span>{isFa ? 'تأییدشده پس از FDR' : 'Confirmed after FDR'}</span>
            <strong data-testid="nmc-science-confirmed">
              {science ? `${sciFdr.confirmed} / ${sciFdr.m}` : '—'}
            </strong>
            <small>
              {science
                ? (isFa
                    ? `${sciFdr.supported} باور با فاکتور بیز قاطع · ${sciFdr.supportedButCorrected} با تأیید چندگانه رد شد · q=${sciFdr.q}`
                    : `${sciFdr.supported} decisive-BF beliefs · ${sciFdr.supportedButCorrected} rejected by correction · q=${sciFdr.q}`)
                : (isFa ? 'کنترل کشف کاذب بنجامینی-هوخبرگ' : 'Benjamini–Hochberg FDR control')}
            </small>
          </div>

          <div className="nmc-stat">
            <span>{isFa ? 'بهترین باور (میانگین پسین)' : 'Best belief (posterior)'}</span>
            <strong data-testid="nmc-science-best">
              {sciBest ? fmtPct(sciBest.posteriorMean, 1) : '—'}
            </strong>
            <small>
              {sciBest
                ? (isFa
                    ? `فاصلهٔ باورمند ۹۵٪: ${fmtPct(sciBest.credibleInterval.low, 0)} – ${fmtPct(sciBest.credibleInterval.high, 0)} · ${sciBest.symbol || 'همهٔ بازارها'} · ${REGIME_LABELS[sciBest.regime]?.[isFa ? 'fa' : 'en'] || sciBest.regime}`
                    : `95% credible: ${fmtPct(sciBest.credibleInterval.low, 0)} – ${fmtPct(sciBest.credibleInterval.high, 0)} · ${sciBest.symbol || 'all markets'} · ${sciBest.regime}`)
                : (isFa ? 'اگر شاهدی نباشد «—» می‌ماند' : 'Stays — until evidence exists')}
            </small>
          </div>

          <div className="nmc-stat">
            <span>{isFa ? 'فاکتور بیز (log₁₀)' : 'Bayes factor (log₁₀)'}</span>
            <strong data-testid="nmc-science-bf">
              {sciBest ? fmtSigned(sciBest.log10BayesFactor, 2) : '—'}
            </strong>
            <small data-testid="nmc-science-sensitivity">
              {sciBest
                ? (isFa
                    ? `دسته: ${sciBest.band}${sciSensitivity ? ` · ${sciSensitivity.flipsAtAdditionalMisses} شکست اضافه آن را برمی‌گرداند` : ''}`
                    : `band: ${sciBest.band}${sciSensitivity ? ` · ${sciSensitivity.flipsAtAdditionalMisses} extra misses would erase it` : ''}`)
                : (isFa ? 'شاهدِ قطعی: log₁₀ ≥ ۱ و بقا در FDR' : 'Decisive: log₁₀ ≥ 1 and surviving FDR')}
            </small>
          </div>

          <div className="nmc-stat">
            <span>{isFa ? 'کالیبراسیون پیش‌رو خودِ حافظه' : 'Prequential self-calibration'}</span>
            <strong data-testid="nmc-science-calibration">
              {sciCal?.brier != null ? fmtNum(sciCal.brier, 3) : '—'}
            </strong>
            <small>
              {sciCal?.brier != null
                ? (isFa
                    ? `Brier روی ${sciCal.samples} پیش‌بینی · ECE ${fmtNum(sciCal.ece, 3)} · هر شاهد با باورِ پیش از خودش سنجیده شد`
                    : `Brier over ${sciCal.samples} predictions · ECE ${fmtNum(sciCal.ece, 3)} · scored against the belief held before it`)
                : (isFa ? `${sciCal?.samples ?? 0} شاهد؛ برای کالیبراسیون دست‌کم ۱۲ لازم است` : `${sciCal?.samples ?? 0} scored; 12 needed before reporting`)}
            </small>
          </div>
        </div>

        <div className="nmc-section-head nmc-section-head-tight">
          <strong>{isFa ? 'هم‌ارزی جهانی: متاآنالیز اثرات تصادفی' : 'Universality: random-effects meta-analysis'}</strong>
          <small data-testid="nmc-science-meta">
            {sciMeta && sciMeta.k > 0
              ? (isFa
                  ? `${sciMeta.k} بازار · ${sciMeta.totalN} شاهد · نرخ هم‌ارزی‌شده ${fmtPct(sciMeta.pooled, 1)} · τ²=${fmtNum(sciMeta.tau2, 4)} · ناهمگونی I²=${fmtPct(sciMeta.i2, 0)}`
                  : `${sciMeta.k} markets · ${sciMeta.totalN} observations · pooled ${fmtPct(sciMeta.pooled, 1)} · τ²=${fmtNum(sciMeta.tau2, 4)} · heterogeneity I²=${fmtPct(sciMeta.i2, 0)}`)
              : (isFa ? 'بدون دادهٔ چندبازاری پس از ثبت' : 'No post-registration multi-market evidence yet')}
          </small>
        </div>

        <div className="nmc-neuromod-grid">
          <div className="nmc-neuromod" data-testid="nmc-science-evidence">
            <div className="nmc-regime-top">
              <span>{isFa ? 'شواهد پس از ثبت' : 'Post-registration'}</span>
              <strong>{science ? sciTotals.prospective : '—'}</strong>
            </div>
            <div className="nmc-bar-track">
              <div
                className="nmc-bar-fill"
                style={{
                  width: `${science && sciTotals.observations > 0
                    ? Math.round((sciTotals.prospective / sciTotals.observations) * 100)
                    : 0}%`
                }}
              />
            </div>
            <small className="nmc-dim">
              {isFa
                ? 'تنها این بخش می‌تواند فرضیه را تأیید کند؛ شواهد پیش از ثبت با ضریب ۰٫۳۵ تخفیف می‌خورد.'
                : 'Only this class can confirm; pre-registration evidence is discounted 0.35×.'}
            </small>
          </div>

          <div className="nmc-neuromod" data-testid="nmc-science-prior">
            <div className="nmc-regime-top">
              <span>{isFa ? 'پیشین مشورتی کورتکس' : 'Advisory cortex prior'}</span>
              <strong>{sciPrior?.validated ? fmtSigned(sciPrior.bias, 3) : (isFa ? 'خنثی' : 'neutral')}</strong>
            </div>
            <div className="nmc-bar-track">
              <div
                className="nmc-bar-fill"
                style={{ width: `${sciPrior?.validated ? Math.round(Math.abs(sciPrior.confidence) * 100) : 0}%` }}
              />
            </div>
            <small className="nmc-dim">
              {sciPrior?.validated
                ? (isFa
                    ? `باور ${fmtPct(sciPrior.posteriorMean, 0)} · اطمینان ${fmtPct(sciPrior.confidence, 0)} · میرایی ${fmtNum(sciPrior.damping, 2)} (فقط مشورتی، هرگز به خوانش تزریق نمی‌شود)`
                    : `belief ${fmtPct(sciPrior.posteriorMean, 0)} · confidence ${fmtPct(sciPrior.confidence, 0)} · damping ${fmtNum(sciPrior.damping, 2)} (advisory only, never injected into the readout)`)
                : (isFa ? 'بی‌اثر تا وقتی فرضیه‌ای تأیید نشود' : 'Inert until a hypothesis is confirmed')}
            </small>
          </div>

          <div className="nmc-neuromod" data-testid="nmc-science-world">
            <div className="nmc-regime-top">
              <span>{isFa ? 'اجماع جهانی دستگاه‌ها' : 'World consensus'}</span>
              <strong>{sciWorld ? `${sciWorld.totals?.consensusKeys ?? 0}/${sciWorld.totals?.keys ?? 0}` : '—'}</strong>
            </div>
            <div className="nmc-bar-track">
              <div
                className="nmc-bar-fill"
                style={{ width: `${sciWorld ? Math.round((sciWorld.consensusShare || 0) * 100) : 0}%` }}
              />
            </div>
            <small className="nmc-dim">
              {sciWorld
                ? (isFa
                    ? `${sciWorld.totals.packets} بستهٔ پیشین · ${sciWorld.totals.owners} مشارکت‌کننده · ذخیره‌سازی ${sciWorld.storageMode === 'blob' ? 'پایدار' : 'موقت (per-instance)'} · اجماع فقط با ≥۲ مشارکت‌کننده`
                    : `${sciWorld.totals.packets} prior packets · ${sciWorld.totals.owners} contributors · storage ${sciWorld.storageMode} · consensus needs ≥2 contributors`)
                : (isFa ? 'فقط پیشین قابل‌حمل، بدون دادهٔ خام' : 'Portable priors only — no raw data')}
            </small>
          </div>
        </div>

        {Array.isArray(science?.recent) && science.recent.length > 0 ? (
          <div className="nmc-regimes">
            {science.recent.slice(0, 4).map((row) => (
              <div key={row.key} className="nmc-regime-row">
                <div className="nmc-regime-top">
                  <span>
                    {`${REGIME_LABELS[row.regime]?.[isFa ? 'fa' : 'en'] || row.regime} · ${row.symbol || (isFa ? 'همهٔ بازارها' : 'all markets')}`}
                  </span>
                  <strong>
                    {`${fmtPct(row.posteriorMean, 0)} · ${row.status}`}
                  </strong>
                </div>
                <div className="nmc-bar-track">
                  <div className="nmc-bar-fill" style={{ width: `${Math.round((row.posteriorMean || 0) * 100)}%` }} />
                </div>
                <small className="nmc-dim">
                  {isFa
                    ? `log₁₀BF ${fmtSigned(row.log10BayesFactor, 2)} · شاهد مؤثر ${fmtNum(row.nEff, 1)} · بازه ${fmtPct(row.credibleInterval?.low, 0)}–${fmtPct(row.credibleInterval?.high, 0)}`
                    : `log₁₀BF ${fmtSigned(row.log10BayesFactor, 2)} · effective n ${fmtNum(row.nEff, 1)} · CI ${fmtPct(row.credibleInterval?.low, 0)}–${fmtPct(row.credibleInterval?.high, 0)}`}
                </small>
              </div>
            ))}
          </div>
        ) : null}

        <p className="nmc-note" data-testid="nmc-science-honesty">
          {isFa
            ? `قاعدهٔ صداقت: فرضیه‌ها پیش از دیدن داده در کد ثبت شده‌اند (${sciTotals?.prespecifiedFamilies ?? 1} خانواده)، هر شاهد تکراری با اثرانگشت منبع رد می‌شود، «تأیید» فقط با فاکتور بیز قاطع + بقا در FDR، و دانش کهنه با نیمه‌عمر ${science ? Math.round(science.halfLifeMs / 86400000) : 45} روز فرسوده می‌شود. هیچ دادهٔ خامی از دستگاه خارج نمی‌شود.`
            : `Honesty rule: hypotheses were fixed in code (${sciTotals?.prespecifiedFamilies ?? 1} family) before any data was seen, duplicate observations are rejected by provenance hash, "confirmed" needs a decisive Bayes factor AND FDR survival, and evidence decays with a ${science ? Math.round(science.halfLifeMs / 86400000) : 45}-day half-life. No raw data leaves the device.`}
        </p>
      </div>

      {/* ── Phase 8 — Parallel Research Universes ─────────────────────────── */}
      <ParallelUniversesPanel locale={locale} />

      {/* Cognitive Readout & Market Regime */}
      <div className="nmc-raster-card">
        <div className="nmc-section-head">
          <strong>
            {isFa ? 'خوانش شناختی و رژیم لحظه‌ای بازار (۱۲ سر خوانش)' : 'Cognitive Readout & Live Market Regime (12 Heads)'}
          </strong>
          <small>
            {readout
              ? (isFa
                  ? `جهش شگفتی (Free Energy): ${fmtPct(readout.anomalySurprise, 0)} · ثابت زمانی مایع τ: ${readout.meanLiquidTau}`
                  : `Surprise: ${fmtPct(readout.anomalySurprise, 0)} · Liquid τ: ${readout.meanLiquidTau}`)
              : (isFa ? 'دکمهٔ تکامل زنده را بزنید تا کورتکس روی کندل‌های واقعی اجرا شود' : 'Run a live pulse below to feed real market candles')}
          </small>
        </div>

        <div className="nmc-grid-4" style={{ marginBottom: readout ? 8 : 0 }}>
          <div className="nmc-stat">
            <span>{isFa ? 'کشش جهتی سیناپسی' : 'Directional Drive'}</span>
            <strong data-testid="nmc-directional-drive">
              {readout ? fmtSigned(readout.directionalDrive, 3) : '—'}
            </strong>
            <small>{isFa ? 'بازه ۱- (فروش) تا ۱+ (خرید)' : 'Range -1 (bear) to +1 (bull)'}</small>
          </div>
          <div className="nmc-stat">
            <span>{isFa ? 'پیش‌بینی تلاطم (نوسان)' : 'Volatility Forecast'}</span>
            <strong data-testid="nmc-volatility">{readout ? fmtPct(readout.volatilityForecast, 1) : '—'}</strong>
            <small>{isFa ? 'تعدیل خودکار ریسک ژنوم' : 'Modulated by Intent Genome'}</small>
          </div>
          <div className="nmc-stat">
            <span>{isFa ? 'حافظهٔ اپیزودیک (Engrams)' : 'Episodic Engrams'}</span>
            <strong data-testid="nmc-engram-count">{nm.engramCount}</strong>
            <small>
              {nm.engramRecall?.expectedReturn != null
                ? (isFa
                    ? `بازده مشابه گذشته: ${fmtSigned(nm.engramRecall.expectedReturn * 100, 2)}%`
                    : `Past analog return: ${fmtSigned(nm.engramRecall.expectedReturn * 100, 2)}%`)
                : (isFa ? 'ذخیرهٔ الگوهای واقعی در دستگاه' : 'Stored locally in IndexedDB')}
            </small>
          </div>
          <div className="nmc-stat">
            <span>{isFa ? 'مصرف محاسباتی اندازه‌گیری‌شده' : 'Measured compute'}</span>
            <strong data-testid="nmc-energy">
              {brain ? `${brain.energy.synapticOps.toLocaleString()}` : '—'}
            </strong>
            <small>
              {brain
                ? (isFa
                    ? `رویداد سیناپسی · ≈${brain.energy.estimatedFemtoJoules} fJ (تخمین)`
                    : `synaptic events · ≈${brain.energy.estimatedFemtoJoules} fJ (estimate)`)
                : (isFa ? 'شمارش واقعی رویدادها، نه تخمین مدل' : 'Counted events, not a model guess')}
            </small>
          </div>
        </div>

        {readout?.regimeProbs ? (
          <div className="nmc-regimes">
            {Object.entries(readout.regimeProbs).map(([key, prob]) => (
              <div key={key} className="nmc-regime-row">
                <div className="nmc-regime-top">
                  <span>{isFa ? REGIME_LABELS[key]?.fa : REGIME_LABELS[key]?.en}</span>
                  <strong>{fmtPct(prob, 0)}</strong>
                </div>
                <div className="nmc-bar-track">
                  <div className="nmc-bar-fill" style={{ width: `${Math.round((prob || 0) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Consolidation banner (measured) */}
      {consolidation ? (
        <p className="nmc-note nmc-note-strong" data-testid="nmc-consolidation-summary">
          {isFa
            ? `☾ تثبیت موج‌تیز-ریپل: ${consolidation.replayed} خاطره بازپخش شد · انرژی آزاد ${consolidation.freeEnergyBefore} → ${consolidation.freeEnergyAfter} (${consolidation.freeEnergyDropPct}%) · خطای مخچه ${consolidation.forwardErrorBefore ?? '—'} → ${consolidation.forwardErrorAfter ?? '—'} · توافق تصمیم ${fmtPct(consolidation.bgAgreementBefore, 0)} → ${fmtPct(consolidation.bgAgreementAfter, 0)}`
            : `☾ Sharp-wave-ripple consolidation: ${consolidation.replayed} engrams replayed · free energy ${consolidation.freeEnergyBefore} → ${consolidation.freeEnergyAfter} (${consolidation.freeEnergyDropPct}%) · cerebellar error ${consolidation.forwardErrorBefore ?? '—'} → ${consolidation.forwardErrorAfter ?? '—'} · decision agreement ${fmtPct(consolidation.bgAgreementBefore, 0)} → ${fmtPct(consolidation.bgAgreementAfter, 0)}`}
        </p>
      ) : null}

      {/* Evolution Feedback Banner */}
      {nm.evolutionLast ? (
        <p className="nmc-note" data-testid="nmc-evolution-summary">
          {isFa
            ? `✦ آخرین چرخهٔ خودتکاملی (${nm.evolutionLast.symbol}): ${nm.evolutionLast.resolvedSteps} کندل واقعی سنجیده شد · نرخ اصابت برنده: ${fmtPct(nm.evolutionLast.winnerHitRate, 1)} · ${
                nm.evolutionLast.swarmUpload?.crystallized
                  ? `نسل جهانی جدید #${nm.evolutionLast.swarmUpload.globalGeneration} متبلور شد!`
                  : nm.evolutionLast.improved
                    ? 'وزن‌های کورتکس دستگاه شما ارتقا یافت.'
                    : 'نسخهٔ فعلی از جهش‌های جدید دقیق‌تر بود و حفظ شد.'
              }`
            : `✦ Last self-evolution pulse (${nm.evolutionLast.symbol}): ${nm.evolutionLast.resolvedSteps} real candles scored · Winner hit rate: ${fmtPct(nm.evolutionLast.winnerHitRate, 1)} · ${
                nm.evolutionLast.swarmUpload?.crystallized
                  ? `Global Generation #${nm.evolutionLast.swarmUpload.globalGeneration} crystallized!`
                  : nm.evolutionLast.improved
                    ? 'Local cortex synapses upgraded.'
                    : 'Current cortex outperformed mutations and was retained.'
              }`}
        </p>
      ) : null}

      {nm.scienceAction || nm.scienceError ? (
        <p className="nmc-note" data-testid="nmc-science-status">
          {nm.scienceError
            ? (isFa ? `حافظهٔ علمی: ${nm.scienceError}` : `Scientific memory: ${nm.scienceError}`)
            : nm.scienceAction.action === 'ingest'
              ? (isFa
                  ? `🔬 ${nm.scienceAction.ingest?.ingested ?? 0} شاهد تازه (${nm.scienceAction.ingest?.duplicates ?? 0} تکراری رد شد)`
                  : `🔬 ${nm.scienceAction.ingest?.ingested ?? 0} new observations (${nm.scienceAction.ingest?.duplicates ?? 0} duplicates rejected)`)
              : nm.scienceAction.action === 'share'
                ? (nm.scienceAction.accepted
                    ? (isFa
                        ? `🌐 ${nm.scienceAction.records} رکورد پیشین منتشر شد (${nm.scienceAction.code})`
                        : `🌐 ${nm.scienceAction.records} prior records published (${nm.scienceAction.code})`)
                    : (isFa
                        ? `🌐 انتشار انجام نشد: ${nm.scienceAction.code}`
                        : `🌐 Publish refused: ${nm.scienceAction.code}`))
                : nm.scienceAction.action === 'retire'
                  ? (isFa
                      ? `☑ ${nm.scienceAction.retired} فرضیهٔ منقضی بازنشسته شد`
                      : `☑ ${nm.scienceAction.retired} expired hypotheses retired`)
                  : (isFa ? 'همگام‌سازی پیشین' : 'Prior merge')}
        </p>
      ) : null}

      {nm.lastError ? (
        <p className="nmc-note" role="alert" data-testid="nmc-error">
          {isFa ? `وضعیت: ${nm.lastError}` : `Status: ${nm.lastError}`}
        </p>
      ) : null}

      {/* Interactive Controls */}
      <div className="nmc-actions">
        <button
          type="button"
          className="nmc-btn nmc-btn-primary"
          data-testid="nmc-evolve-btn"
          disabled={nm.evolving || nm.paused}
          onClick={() => { void nm.evolveOnLiveCandles({ symbol: 'BTC' }); }}
        >
          {nm.evolving
            ? (isFa ? '⚡ در حال تکامل روی GPU/CPU شما…' : '⚡ Evolving on your GPU/CPU…')
            : (isFa ? '⚡ اجرای تکامل زنده روی کندل‌های واقعی بازار' : '⚡ Evolve Now on Live Market Candles')}
        </button>

        <button
          type="button"
          className="nmc-btn"
          data-testid="nmc-consolidate-btn"
          disabled={Boolean(nm.paused) || Number(nm.engramCount) <= 0}
          onClick={() => { void nm.consolidateBrain({ iterations: 6 }); }}
          title={
            isFa
              ? 'بازپخش خاطره‌های واقعی دستگاه و تثبیت آن‌ها (خواب موج‌تیز-ریپل)'
              : 'Replay this device’s real engrams (sharp-wave-ripple sleep)'
          }
        >
          {isFa ? '☾ تثبیت حافظه (خواب)' : '☾ Consolidate memory (sleep)'}
        </button>

        <button
          type="button"
          className="nmc-btn"
          data-testid="nmc-science-ingest-btn"
          disabled={Boolean(nm.paused) || Number(nm.engramCount) <= 0}
          onClick={() => { void nm.ingestScience(); }}
          title={
            isFa
              ? 'استخراج شواهد از خاطرات واقعی دستگاه و سنجش آن‌ها با خانوادهٔ فرضیهٔ پیش‌ثبت‌شده'
              : 'Score this device’s real engrams against the pre-registered family'
          }
        >
          {isFa ? '🔬 استخراج شواهد علمی' : '🔬 Extract scientific evidence'}
        </button>

        <button
          type="button"
          className="nmc-btn"
          data-testid="nmc-science-share-btn"
          disabled={Boolean(nm.paused) || !nm.swarmOptIn}
          onClick={() => { void nm.shareSciencePrior(); }}
          title={
            isFa
              ? 'ارسال فقط فاکتور بیز و شمارش مؤثر — بدون قیمت، بردار یا شناسهٔ دستگاه'
              : 'Upload only log Bayes factors and effective counts — no prices, vectors or device ids'
          }
        >
          {isFa ? '🌐 انتشار پیشین علمی (بدون دادهٔ خام)' : '🌐 Publish prior (no raw data)'}
        </button>

        <button
          type="button"
          className="nmc-btn"
          data-testid="nmc-brain-toggle"
          onClick={() => { void nm.setBrainEnabled(!brainOn); }}
        >
          {brainOn
            ? (isFa ? '✓ هستهٔ مغزمحور: روشن' : '✓ Brain core: ON')
            : (isFa ? '○ هستهٔ مغزمحور: خاموش (فاز ۵)' : '○ Brain core: OFF (Phase 5)')}
        </button>

        <button
          type="button"
          className="nmc-btn"
          data-testid="nmc-swarm-toggle"
          onClick={nm.toggleSwarmOptIn}
        >
          {nm.swarmOptIn
            ? (isFa ? '✓ مشارکت کلونی: روشن' : '✓ Swarm Sync: ON')
            : (isFa ? '○ مشارکت کلونی: خاموش (فقط محلی)' : '○ Swarm Sync: OFF (Local Only)')}
        </button>

        <button
          type="button"
          className="nmc-btn"
          data-testid="nmc-pause-toggle"
          onClick={nm.togglePaused}
        >
          {nm.paused
            ? (isFa ? '▶ ادامه پردازش محلی' : '▶ Resume Local Cortex')
            : (isFa ? '⏸ توقف پردازش محلی' : '⏸ Pause Local Cortex')}
        </button>

        <button
          type="button"
          className="nmc-btn"
          data-testid="nmc-reset-btn"
          onClick={() => { void nm.resetLocalCortex(); }}
        >
          {isFa ? 'بازنشانی سیناپس‌های دستگاه' : 'Reset Device Synapses'}
        </button>
      </div>

      <p className="nmc-note">
        {isFa
          ? 'مرز امنیتی سخت: کورتکس نورومورفیک هیچ دسترسی به کلید خصوصی ندارد، هیچ تراکنشی را امضا یا اجرا نمی‌کند (canExecute: false)، و صرفاً تحلیل و تکامل هوش را روی سخت‌افزار خود شما انجام می‌دهد. خروجی این پنل تحلیل اطلاعاتی است، نه توصیهٔ مالی.'
          : 'Hard security boundary: the neuromorphic cortex never accesses private keys and never signs or executes transactions (canExecute: false). Informational intelligence only, not financial advice.'}
      </p>
    </section>
  );
});

export function NeuromorphicModal({ open, onClose, locale = 'fa' }) {
  if (!open) return null;
  const isFa = !String(locale || 'fa').toLowerCase().startsWith('en');
  return (
    <div
      className="iaos-panel-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isFa ? 'کورتکس نورومورفیک ۲۰۵۰' : 'Neuromorphic Cortex 2050'}
    >
      <div className="iaos-panel" data-testid="intent-ai-neuromorphic-modal">
        <div className="iaos-panel-head">
          <div>
            <h2>{isFa ? 'کورتکس نورومورفیک FBT · ۲۰۵۰ + مغزمحور' : 'FBT Neuromorphic Cortex · 2050 + Brain-Inspired'}</h2>
            <small>
              {isFa
                ? 'پردازش و خودتکاملی زنده روی GPU و CPU دستگاه شما با کدگذاری پیش‌بین و نورومدولاتورها — بدون سرور GPU'
                : 'Self-evolving spiking + liquid + predictive-coding intelligence on your device GPU & CPU'}
            </small>
          </div>
          <button type="button" className="iaos-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="iaos-panel-scroll">
          <NeuromorphicCortexPanel locale={locale} />
        </div>
      </div>
    </div>
  );
}

export default NeuromorphicCortexPanel;
