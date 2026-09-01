/**
 * Strategy Lab — build a rule-based strategy, backtest it.
 *
 * ─── WHAT A "STRATEGY" IS HERE ─────────────────────────────────────────────
 * The user defines a few rules in plain text and the engine tests them over
 * a synthetic price series. This is not a full IDE — it is a *thinking aid*.
 * The rules cover the two signals the spec calls out (RSI threshold, MA
 * trend filter), the position size, and the exit (stop + target). Anything
 * more elaborate would belong in a code editor, not a phone app.
 *
 * ─── THE BACKTEST ─────────────────────────────────────────────────────────
 * The engine is in `lib/lab/engine.js`:
 *   • Generate a 1-year price series with a seeded random walk.
 *   • Walk forward day by day; whenever the rules say "buy", enter with
 *     `sizePct` of cash; exit when stop or target is hit.
 *   • Report return, win rate, drawdown, Sharpe, trade count.
 *
 * It is deterministic: the same rules over the same seed give the same
 * numbers. So if a user shares a strategy, the recipient sees the same
 * backtest.
 */

import { useState } from 'react';
import { LabBack, AICoach, Panel, Row, Notice, ResultCard, Sparkline } from './Shared';
import { runBacktest, generatePriceSeries } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const PRESETS = [
  {
    name: 'RSI Reversal',
    rules: { rsiBelow: 30, sizePct: 10, stopLoss: 5, takeProfit: 15 }
  },
  {
    name: 'Trend Following',
    rules: { priceAboveMa: true, sizePct: 20, stopLoss: 8, takeProfit: 25 }
  },
  {
    name: 'Dip Buyer',
    rules: { rsiBelow: 35, priceAboveMa: true, sizePct: 15, stopLoss: 7, takeProfit: 20 }
  }
];

export default function StrategyLab({ onBack }) {
  const { haptic } = useTelegram();
  const saveStrategy = useLabStore((s) => s.saveStrategy);
  const strategies = useLabStore((s) => s.strategies);

  const [rsiBelow, setRsiBelow] = useState(30);
  const [priceAboveMa, setPriceAboveMa] = useState(true);
  const [sizePct, setSizePct] = useState(10);
  const [stopLoss, setStopLoss] = useState(5);
  const [takeProfit, setTakeProfit] = useState(15);
  const [result, setResult] = useState(null);
  const [series, setSeries] = useState(null);
  const [name, setName] = useState('My Strategy');

  const run = () => {
    haptic?.('success');
    const rules = {
      rsiBelow: rsiBelow > 0 ? rsiBelow : null,
      priceAboveMa,
      sizePct,
      stopLoss,
      takeProfit
    };
    const r = runBacktest(rules, { days: 365, seed: 42, initialCash: 10000 });
    const s = generatePriceSeries(365, 100, 42);
    setSeries(s.map((p) => p.price));
    setResult(r);
    saveStrategy({ name, rules, backtest: r });
  };

  const applyPreset = (p) => {
    setRsiBelow(p.rules.rsiBelow ?? 0);
    setPriceAboveMa(!!p.rules.priceAboveMa);
    setSizePct(p.rules.sizePct);
    setStopLoss(p.rules.stopLoss);
    setTakeProfit(p.rules.takeProfit);
    setName(p.name);
  };

  const coachMsg = result
    ? result.sharpe > 1.5
      ? 'Sharpe above 1.5 is excellent. Real markets rarely give you this — forward-test before trusting it.'
      : result.maxDrawdown > 30
      ? 'Drawdown above 30% is hard to stomach live. Either cut the position size or tighten the stop.'
      : result.winRate < 40
      ? 'Win rate below 40% means R:R is doing the heavy lifting. Make sure the reward justifies the misses.'
      : 'Setup looks balanced. Try changing one rule at a time to see which matters most.'
    : 'A strategy without an entry AND exit rule is a hope, not a plan. Define both before backtesting.';

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title="🧪 Strategy Lab" sub="Build a rule, backtest it, see what the math says." />

      <Panel title="Strategy">
        <input
          className="lab2-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Strategy name"
        />
        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, marginTop: 6 }}>
          <strong>IF</strong> RSI &lt; {rsiBelow || '—'}
          {priceAboveMa && ' AND price &gt; MA200'}
          <br />
          <strong>THEN</strong> BUY {sizePct}% · SL {stopLoss}% · TP {takeProfit}%
        </div>
      </Panel>

      <Panel title="Presets">
        <div className="lab2-defi-tabs">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              className="lab2-defi-tab"
              onClick={() => applyPreset(p)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Entry rules">
        <SliderField label="Buy when RSI below" value={rsiBelow} onChange={setRsiBelow} min={0} max={50} step={1} suffix="" display={rsiBelow > 0 ? String(rsiBelow) : 'off'} />
        <ToggleField label="Only buy above 200-day MA" value={priceAboveMa} onChange={setPriceAboveMa} />
      </Panel>

      <Panel title="Position">
        <SliderField label="Position size (% of cash)" value={sizePct} onChange={setSizePct} min={1} max={50} step={1} display={`${sizePct}%`} />
      </Panel>

      <Panel title="Exit">
        <SliderField label="Stop loss" value={stopLoss} onChange={setStopLoss} min={1} max={20} step={0.5} display={`${stopLoss}%`} />
        <SliderField label="Take profit" value={takeProfit} onChange={setTakeProfit} min={1} max={50} step={0.5} display={`${takeProfit}%`} />
      </Panel>

      <button className="lab2-btn primary full" onClick={run}>
        ▶ Run Backtest
      </button>

      {result && (
        <>
          <ResultCard
            kind={result.returnPct > 0 ? 'win' : 'loss'}
            emoji={result.returnPct > 0 ? '📈' : '📉'}
            title={`Return: ${result.returnPct >= 0 ? '+' : ''}${result.returnPct}%`}
            sub={`Over ${result.periodDays} days · ${result.trades} trades`}
          >
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              <Row label="Win rate" value={`${result.winRate}%`} />
              <Row label="Max drawdown" value={`-${result.maxDrawdown}%`} valueClass="neg" />
              <Row label="Sharpe ratio" value={result.sharpe.toFixed(2)} valueClass={result.sharpe >= 1 ? 'pos' : ''} />
              <Row label="Final cash" value={`$${result.finalCash.toLocaleString()}`} />
            </div>
          </ResultCard>
          {series && <Panel title="Equity curve"><Sparkline data={series} /></Panel>}
        </>
      )}

      <AICoach message={coachMsg} />

      {strategies.length > 0 && (
        <Panel title="Saved strategies">
          {strategies.slice(0, 5).map((s) => (
            <div key={s.id} className="lab2-row">
              <span>{s.name}</span>
              <strong className={s.backtest?.returnPct >= 0 ? 'pos' : 'neg'}>
                {s.backtest?.returnPct >= 0 ? '+' : ''}{s.backtest?.returnPct}%
              </strong>
            </div>
          ))}
        </Panel>
      )}

      <Notice icon="⚠️">
        Backtests run on synthetic data. The numbers are reproducible but they
        do NOT include slippage, fees, funding rates, or the fact that a
        crowded trade moves the market against you. Use this to compare ideas,
        not to pick a winner.
      </Notice>
    </div>
  );
}

function SliderField({ label, value, onChange, min, max, step, display, suffix = '' }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div className="lab2-row" style={{ paddingTop: 0, border: 'none' }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
        <strong style={{ color: 'var(--text-1)' }}>{display}{suffix}</strong>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="lab2-slider"
      />
    </div>
  );
}

function ToggleField({ label, value, onChange }) {
  return (
    <div className="lab2-row" style={{ paddingTop: 0, border: 'none' }}>
      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
      <button
        className={`lab2-btn ${value ? 'primary' : 'ghost'}`}
        onClick={() => onChange(!value)}
        style={{ minWidth: 60 }}
      >
        {value ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}
