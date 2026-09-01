/**
 * What-If — "if this happens, what happens to my portfolio?"
 *
 * Pick 1-3 shocks (price moves, depegs, gas spikes, regulation) and the
 * screen applies them to your saved portfolio and shows the net effect.
 *
 * It is intentionally simple: a list of well-known events, an input for
 * the magnitude, and an output. The math is in `lib/lab/engine.js` under
 * `applyWhatIf`.
 */

import { useState } from 'react';
import { LabBack, AICoach, Panel, Row, Notice, ResultCard } from './Shared';
import { applyWhatIf } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const EVENTS = [
  { id: 'btc-crash', label: 'BTC crash', coin: 'BTC', defaultPct: -30 },
  { id: 'eth-drop', label: 'ETH drop', coin: 'ETH', defaultPct: -25 },
  { id: 'btc-rally', label: 'BTC rally', coin: 'BTC', defaultPct: 30 },
  { id: 'stable-depeg', label: 'Stablecoin depeg', coin: 'USDC', defaultPct: -5 },
  { id: 'gold-up', label: 'Gold surge', coin: 'GOLD', defaultPct: 10 },
  { id: 'stocks-down', label: 'Stock market down', coin: 'STOCKS', defaultPct: -15 },
  { id: 'sol-explode', label: 'SOL +60%', coin: 'SOL', defaultPct: 60 }
];

const DEFAULT_PORTFOLIO = { BTC: 40, ETH: 25, USDC: 15, GOLD: 10, STOCKS: 10 };

export default function WhatIf({ onBack }) {
  const { haptic } = useTelegram();
  const recordWhatif = useLabStore((s) => s.recordWhatif);
  const history = useLabStore((s) => s.whatifs);

  const [shocks, setShocks] = useState([{ id: 'btc-crash', pct: -30 }]);
  const [portfolio, setPortfolio] = useState(DEFAULT_PORTFOLIO);
  const [result, setResult] = useState(null);

  const setShockPct = (idx, pct) => {
    setShocks((s) => s.map((sh, i) => (i === idx ? { ...sh, pct: Number(pct) } : sh)));
  };

  const removeShock = (idx) => {
    setShocks((s) => s.filter((_, i) => i !== idx));
  };

  const addShock = (eventId) => {
    const ev = EVENTS.find((e) => e.id === eventId);
    if (!ev) return;
    if (shocks.find((s) => s.coin === ev.coin)) return; // one per coin for simplicity
    setShocks((s) => [...s, { id: ev.id, coin: ev.coin, pct: ev.defaultPct }]);
  };

  const run = () => {
    haptic?.('success');
    const r = applyWhatIf({ allocations: portfolio }, shocks);
    setResult(r);
    recordWhatif({ shocks, portfolio, impact: r.totalImpact });
  };

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title="🧩 What-If?" sub="If this happens, what happens to your portfolio?" />

      <Panel title="Your portfolio (default mix)">
        {Object.entries(portfolio).map(([coin, pct]) => (
          <div key={coin} className="lab2-row">
            <span>{coin}</span>
            <strong>{pct}%</strong>
          </div>
        ))}
      </Panel>

      <Panel title="Shocks applied">
        {shocks.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', padding: 12 }}>
            No shocks yet. Add one below.
          </div>
        ) : (
          shocks.map((sh, idx) => {
            const ev = EVENTS.find((e) => e.id === sh.id) ?? { label: sh.coin };
            return (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, fontSize: 12 }}>{ev.label}</div>
                <input
                  type="number"
                  value={sh.pct}
                  onChange={(e) => setShockPct(idx, e.target.value)}
                  className="lab2-input"
                  style={{ width: 80, padding: 6 }}
                />
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>%</span>
                <button
                  onClick={() => removeShock(idx)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--down)', cursor: 'pointer', fontSize: 16 }}
                  aria-label="remove"
                >
                  ×
                </button>
              </div>
            );
          })
        )}
        <div className="lab2-defi-tabs">
          {EVENTS.filter((e) => !shocks.find((s) => s.coin === e.coin)).map((e) => (
            <button key={e.id} className="lab2-defi-tab" onClick={() => addShock(e.id)}>
              + {e.label}
            </button>
          ))}
        </div>
      </Panel>

      <button className="lab2-btn primary full" onClick={run} disabled={shocks.length === 0}>
        ▶ Run Scenario
      </button>

      {result && (
        <ResultCard
          kind={result.totalImpact > 0 ? 'win' : result.totalImpact < 0 ? 'loss' : 'neutral'}
          emoji={result.totalImpact > 0 ? '📈' : result.totalImpact < 0 ? '📉' : '➖'}
          title={`Portfolio impact: ${result.totalImpact > 0 ? '+' : ''}${result.totalImpact}%`}
          sub="Net effect of all shocks combined"
        >
          <div style={{ width: '100%', marginTop: 8 }}>
            {result.details.map((d) => (
              <div key={d.coin} className="lab2-row">
                <span>{d.coin} · {d.allocPct}%</span>
                <strong className={d.impact > 0 ? 'pos' : d.impact < 0 ? 'neg' : ''}>
                  {d.impact > 0 ? '+' : ''}{d.impact.toFixed(2)}%
                </strong>
              </div>
            ))}
          </div>
        </ResultCard>
      )}

      <AICoach
        message={
          result && result.totalImpact < -15
            ? 'A 15%+ drawdown is where most people panic. Plan in advance so you act from rules, not fear.'
            : result && result.totalImpact < 0
            ? 'Down but survivable. This is where a stop loss or hedge matters most.'
            : 'Plan for these in advance — the worst decisions are the ones made in the moment.'
        }
      />

      {history.length > 0 && (
        <Panel title="Past scenarios">
          {history.slice(0, 5).map((h) => (
            <div key={h.id} className="lab2-row">
              <span>{h.shocks.length} shock{h.shocks.length > 1 ? 's' : ''}</span>
              <strong className={h.impact > 0 ? 'pos' : h.impact < 0 ? 'neg' : ''}>
                {h.impact > 0 ? '+' : ''}{h.impact.toFixed(1)}%
              </strong>
            </div>
          ))}
        </Panel>
      )}

      <Notice icon="🎯">
        The best time to decide what to do in a crash is BEFORE the crash.
        Run a few of these. Notice which mix holds up. Then you know what
        to actually own.
      </Notice>
    </div>
  );
}
