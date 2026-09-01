/**
 * Investment Simulator — pick a portfolio mix, watch it run for 1d / 1w / 1m / 3m / 1y.
 *
 * ─── WHY IT'S DIFFERENT FROM THE EXISTING Invest.jsx ───────────────────────
 * The main `Invest.jsx` is a *yield-product* simulator: fixed APRs, fixed
 * durations, the virtual NX balance is debited and grows. It's a "what does
 * 14% APR over 30 days look like" tool.
 *
 * Lab's investment simulator is a *market-portfolio* tool. The user picks
 * BTC/ETH/USDC/Gold/Stocks allocations, then the price engine walks each
 * coin's synthetic series for the chosen horizon and reports the actual
 * portfolio value. It teaches diversification and asset allocation, not
 * yield products.
 *
 * ─── HORIZON TOGGLE ───────────────────────────────────────────────────────
 * 1D / 1W / 1M / 3M / 1Y maps to {1, 7, 30, 90, 365} day windows. The
 * results are deterministic — same mix, same horizon, same answer every
 * time. That is the point: the user can A/B test portfolios without
 * "luck" creeping in.
 */

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { LabBack, AICoach, Panel, Row, Notice, Sparkline } from './Shared';
import { comparePortfolios, runBacktest } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const HORIZONS = [
  { key: '1d', label: '1 Day', days: 1 },
  { key: '1w', label: '1 Week', days: 7 },
  { key: '1m', label: '1 Month', days: 30 },
  { key: '3m', label: '3 Months', days: 90 },
  { key: '1y', label: '1 Year', days: 365 }
];

const ASSETS = [
  { key: 'BTC', name: 'Bitcoin', color: '#f7931a' },
  { key: 'ETH', name: 'Ethereum', color: '#627eea' },
  { key: 'SOL', name: 'Solana', color: '#14f195' },
  { key: 'USDC', name: 'USDC (stable)', color: '#2775ca' },
  { key: 'GOLD', name: 'Gold', color: '#d4af37' },
  { key: 'STOCKS', name: 'S&P 500', color: '#00ff9d' }
];

export default function InvestmentSim({ onBack }) {
  const { haptic } = useTelegram();
  const balance = useLabStore((s) => s.balance);
  const openPortfolio = useLabStore((s) => s.openPortfolio);
  const portfolios = useLabStore((s) => s.portfolios);

  const [horizon, setHorizon] = useState(HORIZONS[2]); // 1m default
  const [allocations, setAllocations] = useState({
    BTC: 40,
    ETH: 25,
    USDC: 15,
    GOLD: 10,
    STOCKS: 10
  });
  const [result, setResult] = useState(null);
  const [name, setName] = useState('My Portfolio');

  const total = Object.values(allocations).reduce((s, v) => s + v, 0);

  const updateAlloc = (key, val) => {
    const v = Math.max(0, Math.min(100, Number(val) || 0));
    setAllocations((a) => ({ ...a, [key]: v }));
  };

  const normalize = () => {
    if (total === 0) return;
    const factor = 100 / total;
    const next = {};
    for (const k of Object.keys(allocations)) next[k] = +(allocations[k] * factor).toFixed(1);
    setAllocations(next);
  };

  const run = () => {
    if (total === 0) return;
    haptic?.('success');
    openPortfolio({ name, allocations: { ...allocations }, seed: Date.now() % 1000 });
    // Build the same view result locally
    const r = runBacktest(
      { rsiBelow: 30, sizePct: 10, stopLoss: 5, takeProfit: 15 },
      { days: horizon.days, seed: 42, initialCash: 10000 }
    );
    // Use comparePortfolios so the result has the "Portfolio value" line.
    const cp = comparePortfolios(allocations, { BTC: 100 }, horizon.days, 7);
    setResult({
      returnPct: cp.a.returnPct,
      drawdown: cp.a.drawdown,
      finalValue: (10000 * (1 + cp.a.returnPct / 100)).toFixed(2),
      series: cp.series.map((p) => p.price),
      bench: cp.b.returnPct
    });
  };

  const allocationsList = useMemo(
    () => ASSETS.map((a) => ({ ...a, pct: allocations[a.key] || 0 })).filter((a) => a.pct > 0),
    [allocations]
  );

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title="💰 Investment Simulator" sub="Build a portfolio. Run it over time. Compare." />

      <Panel title="Capital">
        <Row label="Available virtual balance" value={`$${balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="lab2-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Portfolio name"
            style={{ flex: 1 }}
          />
        </div>
      </Panel>

      <Panel title="Allocation">
        {ASSETS.map((a) => (
          <div key={a.key} className="lab2-alloc">
            <div className="lab2-alloc-icon" style={{ background: a.color }}>{a.key.slice(0, 2)}</div>
            <div className="lab2-alloc-name">{a.name}</div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={allocations[a.key] || 0}
              onChange={(e) => updateAlloc(a.key, e.target.value)}
              className="lab2-slider"
              style={{ width: 100 }}
            />
            <div className="lab2-alloc-pct">{(allocations[a.key] || 0).toFixed(0)}%</div>
          </div>
        ))}
        <div className="lab2-row">
          <span>Total</span>
          <strong style={{ color: total === 100 ? 'var(--up)' : 'var(--rgb-5)' }}>
            {total.toFixed(0)}% {total !== 100 && '(tap Run to normalise)'}
          </strong>
        </div>
        {total !== 100 && (
          <button className="lab2-btn ghost full" onClick={normalize}>
            Normalise to 100%
          </button>
        )}
      </Panel>

      <Panel title="Time horizon">
        <div className="lab2-defi-tabs">
          {HORIZONS.map((h) => (
            <button
              key={h.key}
              className={`lab2-defi-tab ${horizon.key === h.key ? 'active' : ''}`}
              onClick={() => setHorizon(h)}
            >
              {h.label}
            </button>
          ))}
        </div>
      </Panel>

      <button className="lab2-btn primary full" onClick={run} disabled={total === 0}>
        ▶ Run Simulation
      </button>

      {result && (
        <>
          <Panel title={`Result over ${horizon.label.toLowerCase()}`}>
            <Row label="Final value" value={`$${Number(result.finalValue).toLocaleString('en-US', { maximumFractionDigits: 2 })}`} />
            <Row label="Return" value={`${result.returnPct >= 0 ? '+' : ''}${result.returnPct}%`} valueClass={result.returnPct >= 0 ? 'pos' : 'neg'} />
            <Row label="Max drawdown" value={`${result.drawdown}%`} valueClass="neg" />
            <Row label="vs 100% BTC" value={`${result.bench >= 0 ? '+' : ''}${result.bench}%`} />
            <Sparkline data={result.series} />
          </Panel>
          <AICoach
            message={
              result.returnPct > result.bench
                ? 'Your mix beat 100% BTC. Diversification paid off.'
                : result.returnPct > 0
                ? 'Positive, but BTC would have done better. Sometimes concentration wins.'
                : 'Down period. If your drawdown stayed under 30%, the strategy held up.'
            }
          />
        </>
      )}

      {portfolios.length > 0 && (
        <Panel title="Saved portfolios">
          {portfolios.slice(0, 5).map((p) => (
            <div key={p.id} className="lab2-row">
              <span>{p.name}</span>
              <strong>{new Date(p.startedAt).toLocaleDateString()}</strong>
            </div>
          ))}
        </Panel>
      )}

      <Notice icon="📊">
        Diversification does not promise higher returns — it promises lower drawdowns.
        A 60/40 BTC/ETH mix often beats 100% BTC on a risk-adjusted basis even when
        it lags on raw return.
      </Notice>
    </div>
  );
}
