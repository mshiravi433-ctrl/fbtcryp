/**
 * FBT AI / Intent OS — UPGRADE 6
 * Thinking Orb — Replaces "دارم فکر می‌کنم..." text
 * Spec §27, §28
 * 
 * States: listening, searching, connecting, solving, composing, working
 */

import { useEffect, useState, useMemo } from 'react';

const STATE_CONFIG = {
  idle: { color: '#6366f1', pulse: 0.8, labelFa: 'آماده', labelEn: 'Ready', speed: 2 },
  listening: { color: '#22d3ee', pulse: 1.2, labelFa: 'در حال گوش دادن...', labelEn: 'Listening...', speed: 1.2 },
  searching: { color: '#a5b4fc', pulse: 1.0, labelFa: 'در حال جستجوی بازار...', labelEn: 'Searching market...', speed: 1 },
  connecting: { color: '#fbbf24', pulse: 1.5, labelFa: 'در حال اتصال به Agent...', labelEn: 'Calling agent...', speed: 0.8 },
  solving: { color: '#c4b5fd', pulse: 1.3, labelFa: 'در حال تحلیل...', labelEn: 'Analyzing...', speed: 0.9 },
  composing: { color: '#6ee7b7', pulse: 1.0, labelFa: 'در حال تولید پاسخ...', labelEn: 'Generating response...', speed: 1.1 },
  working: { color: '#f472b6', pulse: 1.4, labelFa: 'در حال اجرا...', labelEn: 'Executing...', speed: 0.7 },
  verifying: { color: '#34d399', pulse: 0.9, labelFa: 'در حال تأیید...', labelEn: 'Verifying...', speed: 1.3 }
};

export function ThinkingOrb({ state = 'solving', size = 20, showLabel = false, locale = 'fa', className = '' }) {
  const config = STATE_CONFIG[state] || STATE_CONFIG.solving;
  const fa = locale.startsWith('fa');

  const orbStyle = useMemo(() => ({
    width: size,
    height: size,
    background: `radial-gradient(circle at 30% 30%, ${config.color}, ${config.color}88)`,
    boxShadow: `0 0 ${size * 0.8}px ${config.color}66, inset 0 0 ${size * 0.3}px rgba(255,255,255,0.8)`,
    animationDuration: `${config.speed}s`
  }), [size, config]);

  return (
    <div className={`thinking-orb-wrapper ${className}`} data-state={state} style={{ display: 'inline-flex', alignItems: 'center', gap: showLabel ? 8 : 0 }}>
      <div
        className="thinking-orb"
        style={orbStyle}
        aria-label={fa ? config.labelFa : config.labelEn}
        role="status"
      >
        <span className="thinking-orb-inner" />
        <span className="thinking-orb-pulse" style={{ borderColor: config.color }} />
      </div>
      {showLabel ? (
        <span className="thinking-orb-label" style={{ color: config.color, fontSize: size > 30 ? 14 : 12 }}>
          {fa ? config.labelFa : config.labelEn}
        </span>
      ) : null}
      <style>{`
        .thinking-orb {
          position: relative;
          border-radius: 50%;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          animation: orbFloat var(--orb-speed, 2s) ease-in-out infinite, orbGlow var(--orb-speed, 2s) ease-in-out infinite alternate;
          --orb-speed: ${config.speed}s;
        }
        .thinking-orb-inner {
          width: 35%;
          height: 35%;
          background: rgba(255,255,255,0.9);
          border-radius: 50%;
          box-shadow: 0 0 10px rgba(255,255,255,0.8);
          animation: orbInnerPulse ${config.speed * 0.7}s ease-in-out infinite alternate;
        }
        .thinking-orb-pulse {
          position: absolute;
          inset: -4px;
          border-radius: 50%;
          border: 1.5px solid;
          opacity: 0.6;
          animation: orbPulse ${config.speed}s ease-out infinite;
        }
        @keyframes orbFloat {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-2px) scale(1.05); }
        }
        @keyframes orbGlow {
          0% { filter: brightness(0.9) saturate(1); }
          100% { filter: brightness(1.2) saturate(1.3); }
        }
        @keyframes orbInnerPulse {
          0% { transform: scale(0.8); opacity: 0.7; }
          100% { transform: scale(1.2); opacity: 1; }
        }
        @keyframes orbPulse {
          0% { transform: scale(0.8); opacity: 0.8; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        .thinking-orb-wrapper[data-state="working"] .thinking-orb {
          animation: orbFloat 0.7s ease-in-out infinite, orbGlow 0.7s ease-in-out infinite alternate, orbSpin 1.5s linear infinite;
        }
        @keyframes orbSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .thinking-orb-label {
          font-weight: 600;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}

export function ThinkingOrbLarge({ state = 'solving', size = 64, locale = 'fa', message = null }) {
  const config = STATE_CONFIG[state] || STATE_CONFIG.solving;
  const fa = locale.startsWith('fa');

  return (
    <div className="thinking-orb-large" data-state={state} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 16 }}>
      <ThinkingOrb state={state} size={size} locale={locale} />
      <span style={{ color: config.color, fontSize: 13, fontWeight: 600, textAlign: 'center' }}>
        {message || (fa ? config.labelFa : config.labelEn)}
      </span>
      <style>{`
        .thinking-orb-large {
          animation: fadeIn 0.3s ease-out;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/**
 * AI Activity Timeline — Spec §29
 * Shows operation status, not internal chain-of-thought
 * Example:
 * ● Understanding request
 * ✓ Wallet checked
 * ✓ Market data retrieved
 * ● Risk analysis
 * ○ Strategy
 * ○ Execution
 */
export function AIActivityTimeline({ steps = [], locale = 'fa', className = '', defaultOpen = false }) {
  const fa = locale.startsWith('fa');
  /*
   * The eight status lines used to be printed one under the other on every
   * single answer, which ate most of the screen on a phone. They now live
   * inside one collapsed summary row: a compact progress line the user can
   * open when they actually want the breakdown. Nothing is removed — the same
   * steps render, just behind a disclosure.
   */
  const [open, setOpen] = useState(Boolean(defaultOpen));

  const total = steps?.length || 0;
  const doneCount = useMemo(
    () => (steps || []).filter((s) => ['completed', 'done', 'ok', 'success'].includes(String(s?.status || ''))).length,
    [steps]
  );
  const activeStep = useMemo(
    () => (steps || []).find((s) => ['active', 'working', 'in_progress'].includes(String(s?.status || ''))),
    [steps]
  );
  const failed = useMemo(
    () => (steps || []).some((s) => ['failed', 'error'].includes(String(s?.status || ''))),
    [steps]
  );

  if (!steps || steps.length === 0) return null;

  const stepLabel = (s) => (fa ? (s?.labelFa || s?.label) : (s?.labelEn || s?.label)) || '';
  const headLabel = activeStep
    ? stepLabel(activeStep)
    : doneCount >= total
      ? (fa ? 'همه مراحل انجام شد' : 'All steps done')
      : stepLabel(steps[Math.min(doneCount, total - 1)]);
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div
      className={`ai-activity-timeline ${open ? 'is-open' : 'is-collapsed'} ${className}`}
      data-testid="ai-activity-timeline"
      data-open={open ? 'true' : 'false'}
    >
      <button
        type="button"
        className="ai-timeline-summary"
        data-testid="ai-activity-timeline-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ai-timeline-summary-dot" data-tone={failed ? 'bad' : activeStep ? 'busy' : doneCount >= total ? 'ok' : 'idle'} aria-hidden="true" />
        <span className="ai-timeline-summary-text">{headLabel}</span>
        <span className="ai-timeline-summary-count">{doneCount}/{total}</span>
        <span className="ai-timeline-summary-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
        <span className="ai-timeline-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>
      <div className="ai-timeline-steps" hidden={!open}>
      {steps.map((step, idx) => {
        const status = String(step.status || 'pending').toLowerCase();
        /* Done = green filled circle, in-progress = pulsing cyan, failed or
           blocked = red, not-done-yet = red hollow ring (the user asked that
           an incomplete step read red, not grey), skipped = neutral grey. */
        const tone = ['completed', 'done', 'ok', 'success'].includes(status)
          ? 'ok'
          : ['active', 'working', 'in_progress', 'running'].includes(status)
            ? 'busy'
            : ['failed', 'error', 'blocked'].includes(status)
              ? 'bad'
              : status === 'skipped'
                ? 'skip'
                : 'todo';
        const labelColor = tone === 'ok' ? '#cbd5e1'
          : tone === 'busy' ? '#e2e8f0'
            : tone === 'bad' || tone === 'todo' ? '#fca5a5'
              : 'rgba(148,163,184,0.7)';

        return (
          <div key={`${step.id || idx}-${step.label}`} className="ai-timeline-step" data-status={status} data-tone={tone} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12 }}>
            <span className="ai-tl-dot" data-tone={tone} aria-hidden="true">
              {tone === 'bad' ? <i>✕</i> : tone === 'ok' ? <i>✓</i> : null}
            </span>
            <span className="ai-timeline-label" style={{ color: labelColor }}>
              {fa ? (step.labelFa || step.label) : (step.labelEn || step.label)}
            </span>
            {tone === 'busy' ? <ThinkingOrb state={step.orbState || 'working'} size={12} locale={locale} /> : null}
          </div>
        );
      })}
      </div>
      <style>{`
        .ai-activity-timeline {
          background: rgba(13, 20, 36, 0.5);
          border: 1px solid rgba(148, 163, 184, 0.12);
          border-radius: 12px;
          padding: 4px 6px;
          margin: 6px 0;
          backdrop-filter: blur(8px);
        }
        .ai-activity-timeline.is-open { padding: 4px 8px 8px; }
        .ai-timeline-summary {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          border: 0;
          background: transparent;
          color: inherit;
          padding: 5px 6px;
          cursor: pointer;
          font: inherit;
          text-align: start;
        }
        .ai-timeline-summary-dot {
          width: 7px; height: 7px; border-radius: 50%;
          flex: 0 0 auto; background: rgba(148,163,184,.7);
        }
        .ai-timeline-summary-dot[data-tone="busy"] { background: #22d3ee; animation: tlPulse 1.2s ease-in-out infinite; }
        .ai-timeline-summary-dot[data-tone="ok"]   { background: #34d399; }
        .ai-timeline-summary-dot[data-tone="bad"]  { background: #f87171; }
        @keyframes tlPulse { 0%,100% { opacity: .45; } 50% { opacity: 1; } }
        .ai-timeline-summary-text {
          flex: 1 1 auto; min-width: 0;
          font-size: 11.5px; font-weight: 600; color: #cbd5e1;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ai-timeline-summary-count {
          flex: 0 0 auto; font-size: 10.5px; font-weight: 700;
          color: rgba(148,163,184,.9); font-variant-numeric: tabular-nums;
        }
        .ai-timeline-summary-bar {
          flex: 0 0 44px; height: 3px; border-radius: 999px;
          background: rgba(148,163,184,.2); overflow: hidden;
        }
        .ai-timeline-summary-bar i {
          display: block; height: 100%; border-radius: 999px;
          background: linear-gradient(90deg, #6366f1, #22d3ee);
          transition: width .3s ease;
        }
        .ai-timeline-chevron { flex: 0 0 auto; font-size: 11px; color: rgba(148,163,184,.8); }
        .ai-timeline-steps { padding: 2px 6px 0; }
        .ai-tl-dot {
          width: 15px; height: 15px; border-radius: 50%;
          flex: 0 0 auto; display: inline-grid; place-items: center;
          font-size: 9px; font-style: normal; line-height: 1;
        }
        .ai-tl-dot i { font-style: normal; font-weight: 800; }
        .ai-tl-dot[data-tone="ok"] {
          background: #10b981;
          box-shadow: 0 0 8px rgba(16,185,129,.65), inset 0 0 3px rgba(255,255,255,.5);
          color: #fff;
        }
        .ai-tl-dot[data-tone="busy"] {
          background: #22d3ee;
          box-shadow: 0 0 8px rgba(34,211,238,.65);
          animation: tlPulse 1.1s ease-in-out infinite;
        }
        .ai-tl-dot[data-tone="bad"] {
          background: #ef4444;
          box-shadow: 0 0 8px rgba(239,68,68,.6);
          color: #fff;
        }
        .ai-tl-dot[data-tone="todo"] {
          background: transparent;
          border: 2px solid rgba(248,113,113,.75);
        }
        .ai-tl-dot[data-tone="skip"] {
          background: transparent;
          border: 2px solid rgba(148,163,184,.45);
        }
        .ai-timeline-step {
          transition: all 0.2s ease;
        }
        .ai-timeline-step[data-status="active"] {
          background: rgba(34, 211, 238, 0.06);
          border-radius: 6px;
          padding: 3px 8px !important;
          margin: 1px -4px;
        }
      `}</style>
    </div>
  );
}

export default ThinkingOrb;
