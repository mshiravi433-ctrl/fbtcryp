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
export function AIActivityTimeline({ steps = [], locale = 'fa', className = '' }) {
  const fa = locale.startsWith('fa');

  if (!steps || steps.length === 0) return null;

  return (
    <div className={`ai-activity-timeline ${className}`} data-testid="ai-activity-timeline">
      {steps.map((step, idx) => {
        const status = step.status || 'pending';
        let icon = '○';
        let color = 'rgba(148, 163, 184, 0.6)';
        if (status === 'completed' || status === 'done' || status === 'ok' || status === 'success') {
          icon = '✓';
          color = '#34d399';
        } else if (status === 'active' || status === 'working' || status === 'in_progress') {
          icon = '●';
          color = '#22d3ee';
        } else if (status === 'failed' || status === 'error') {
          icon = '✕';
          color = '#f87171';
        }

        return (
          <div key={`${step.id || idx}-${step.label}`} className="ai-timeline-step" data-status={status} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12.5 }}>
            <span className="ai-timeline-icon" style={{ color, fontWeight: 700, minWidth: 16, textAlign: 'center' }}>{icon}</span>
            <span className="ai-timeline-label" style={{ color: status === 'completed' ? '#cbd5e1' : status === 'active' ? '#e2e8f0' : 'rgba(148,163,184,0.7)' }}>
              {fa ? (step.labelFa || step.label) : (step.labelEn || step.label)}
            </span>
            {status === 'active' ? <ThinkingOrb state={step.orbState || 'working'} size={14} locale={locale} /> : null}
          </div>
        );
      })}
      <style>{`
        .ai-activity-timeline {
          background: rgba(13, 20, 36, 0.6);
          border: 1px solid rgba(148, 163, 184, 0.12);
          border-radius: 12px;
          padding: 10px 12px;
          margin: 8px 0;
          backdrop-filter: blur(8px);
        }
        .ai-timeline-step {
          transition: all 0.2s ease;
        }
        .ai-timeline-step[data-status="active"] {
          background: rgba(34, 211, 238, 0.06);
          border-radius: 6px;
          padding: 4px 8px !important;
          margin: 2px -4px;
        }
      `}</style>
    </div>
  );
}

export default ThinkingOrb;
