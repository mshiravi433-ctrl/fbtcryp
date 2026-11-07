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
 *
 * This file previously contained literal `\n` escape sequences inside its JSX
 * (an editor artefact), which made the whole module unparsable: any page that
 * imported it — AiControlCenter, IntentOpsPanels, the `/intent` header chip —
 * failed to build. It is rewritten here from the same design, with the same
 * `data-testid` contract, plus the Phase-6 block.
 */

import { memo } from 'react';
import { useNeuromorphicCortex } from '../../lib/neuromorphic/useNeuromorphicCortex.js';
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
