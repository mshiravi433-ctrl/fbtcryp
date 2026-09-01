/**
 * Compare Portfolios — Portfolio A vs Portfolio B.
 *
 * Two mixes, the same horizon, the same random seed. The screen prints
 * the resulting return + drawdown + final value side by side. The intent
 * is to make "diversification is a free lunch" visible in numbers.
 */

import { useMemo, useState } from 'react';
import { LabBack, AICoach, Panel, Notice, Sparkline } from './Shared';
import { comparePortfolios } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const HORIZONS = [
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 90 },
  { key: '1y', label: '1Y', days: 365 }
];

const PRESET_A = { BTC: 100 };
const PRESET_B = { BTC: 50, ETH: 30, USDC: 20 };
const PRESET_C = { BTC: 30, ETH: 30, USDC: 20, GOLD: 10, STOCKS: 10 };

export default function ComparePortfolios({ onBack }) {
  const { haptic } = useTelegram();
  const [horizon, setHorizon] = useState(HORIZONS[2]);
  const [a, setA] = useState(PRESET_A);
  const [b, setB] = useState(PRESET_B);
  const [result, setResult] = useState(null);

  const totalA = Object.values(a).reduce((s, v) => s + v, 0);
  const totalB = Object.values(b).reduce((s, v) => s + v, 0);

  const updateAlloc = (side, key, val) => {
    const upd = { ...(side === 'a' ? a : b), [key]: Math.max(0, Math.min(100, Number(val) || 0)) };
    if (side === 'a') setA(upd); else setB(upd);
  };

  const run = () => {
    haptic?.('success');
    setResult(comparePortfolios(a, b, horizon.days, 7));
  };

  const allAssets = ['BTC', 'ETH', 'USDC', 'GOLD', 'STOCKS'];

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title="⚖️ Compare Portfolios" sub="Same horizon, different mix. Which wins?" />

      <Panel title="Horizon">
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

      <Panel title="Portfolio A">
        <div className="lab2-defi-tabs" style={{ marginBottom: 8 }}>
          <button className="lab2-defi-tab" onClick={() => setA(PRESET_A)}>100% BTC</button>
          <button className="lab2-defi-tab" onClick={() => setA(PRESET_B)}>BTC/ETH/USDC</button>
          <button className="lab2-defi-tab" onClick={() => setA(PRESET_C)}>Diversified</button>
        </div>
        {allAssets.map((coin) => (
          <div key={coin} className="lab2-alloc">
            <div className="lab2-alloc-name">{coin}</div>
            <input
              type="range"
              min="0"
              max="100"
              value={a[coin] || 0}
              onChange={(e) => updateAlloc('a', coin, e.target.value)}
              className="lab2-slider"
              style={{ width: 100 }}
            />
            <div className="lab2-alloc-pct">{(a[coin] || 0).toFixed(0)}%</div>
          </div>
        ))}
        <div className="lab2-row">
          <span>Total</span>
          <strong style={{ color: totalA === 100 ? 'var(--up)' : 'var(--rgb-5)' }}>{totalA}%</strong>
        </div>
      </Panel>

      <Panel title="Portfolio B">
        <div className="lab2-defi-tabs" style={{ marginBottom: 8 }}>
          <button className="lab2-defi-tab" onClick={() => setB(PRESET_A)}>100% BTC</button>
          <button className="lab2-defi-tab" onClick={() => setB(PRESET_B)}>BTC/ETH/USDC</button>
          <button className="lab2-defi-tab" onClick={() => setB(PRESET_C)}>Diversified</button>
        </div>
        {allAssets.map((coin) => (
          <div key={coin} className="lab2-alloc">
            <div className="lab2-alloc-name">{coin}</div>
            <input
              type="range"
              min="0"
              max="100"
              value={b[coin] || 0}
              onChange={(e) => updateAlloc('b', coin, e.target.value)}
              className="lab2-slider"
              style={{ width: 100 }}
            />
            <div className="lab2-alloc-pct">{(b[coin] || 0).toFixed(0)}%</div>
          </div>
        ))}
        <div className="lab2-row">
          <span>Total</span>
          <strong style={{ color: totalB === 100 ? 'var(--up)' : 'var(--rgb-5)' }}>{totalB}%</strong>
        </div>
      </Panel>

      <button className="lab2-btn primary full" onClick={run} disabled={totalA === 0 || totalB === 0}>
        ▶ Compare
      </button>

      {result && (
        <>
          <div className="lab2-compare">
            <div className="lab2-compare-side a">
              <div className="lab2-compare-title">Portfolio A</div>
              <div className="lab2-compare-value" style={{ color: result.a.returnPct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                {result.a.returnPct >= 0 ? '+' : ''}{result.a.returnPct}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                Drawdown {result.a.drawdown}% · Final ${result.a.final.toLocaleString()}
              </div>
            </div>
            <div className="lab2-compare-side b">
              <div className="lab2-compare-title">Portfolio B</div>
              <div className="lab2-compare-value" style={{ color: result.b.returnPct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                {result.b.returnPct >= 0 ? '+' : ''}{result.b.returnPct}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                Drawdown {result.b.drawdown}% · Final ${result.b.final.toLocaleString()}
              </div>
            </div>
          </div>
          <Panel title="Equity curves">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 10, color: 'var(--rgb-1)', marginBottom: 4 }}>A</div>
                <Sparkline data={result.series.map((s) => s.price * (1 + result.a.returnPct / 100))} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--rgb-3)', marginBottom: 4 }}>B</div>
                <Sparkline data={result.series.map((s) => s.price * (1 + result.b.returnPct / 100))} />
              </div>
            </div>
          </Panel>
          <AICoach
            message={
              result.a.returnPct > result.b.returnPct
                ? 'A beat B on raw return. But check the drawdown — that is what hurts in real life.'
                : result.b.returnPct > result.a.returnPct
                ? 'B won. Diversification can outperform even against concentrated bets over short horizons.'
                : 'A wash. Same return, different risk. That is the diversification trade.'
            }
          />
        </>
      )}

      <Notice icon="🧠">
        Two portfolios with the same return can have wildly different drawdowns.
        The one that lets you sleep at night is usually the better one.
      </Notice>
    </div>
  );
}
