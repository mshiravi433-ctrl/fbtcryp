/**
 * Risk Trainer — interactive R:R + position size calculator.
 *
 * The user moves three sliders (risk %, stop loss %, take profit %) and the
 * screen prints position size, potential loss, potential profit, and the
 * resulting R:R. The point is to make the math FEEL mechanical, not
 * abstract: change a number, see the answer.
 *
 * There is no trade to execute here. It is a calculator, but presented as
 * a tool that makes risk discipline cheap to practice.
 */

import { useMemo, useState } from 'react';
import { LabBack, AICoach, Panel, Row, Notice } from './Shared';
import { calcPositionSize } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';

export default function RiskTrainer({ onBack }) {
  const balance = useLabStore((s) => s.balance);
  const [capital, setCapital] = useState(balance);
  const [riskPct, setRiskPct] = useState(1);
  const [stopLossPct, setStopLossPct] = useState(3);
  const [takeProfitPct, setTakeProfitPct] = useState(9);
  const [entry, setEntry] = useState(100);

  const sizing = useMemo(
    () => calcPositionSize({ capital, riskPct, stopLossPct, entryPrice: entry }),
    [capital, riskPct, stopLossPct, entry]
  );

  const rr = stopLossPct > 0 ? takeProfitPct / stopLossPct : 0;
  const winRateNeeded = rr > 0 ? 1 / (1 + rr) * 100 : 100;

  const coachMsg =
    riskPct > 2
      ? 'Risk above 2% per trade is aggressive. 1% is the floor most professionals stick to.'
      : rr < 1.5
      ? 'R:R below 1.5 means you need a 70%+ win rate. Wait for better setups.'
      : rr >= 3
      ? '3:1 R:R is the sweet spot. Even a 40% win rate is profitable here.'
      : 'Setup looks reasonable. Now the question is whether you would actually pull the trigger.';

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title="🛡️ Risk Trainer" sub="Change a number. See the answer. Build the instinct." />

      <Panel title="Inputs">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SliderField
            label="Capital ($)"
            value={capital}
            onChange={setCapital}
            min={100}
            max={1000000}
            step={100}
            display={`$${capital.toLocaleString()}`}
          />
          <SliderField
            label="Entry price"
            value={entry}
            onChange={setEntry}
            min={1}
            max={100000}
            step={1}
            display={`$${entry.toLocaleString()}`}
          />
          <SliderField
            label="Risk per trade (%)"
            value={riskPct}
            onChange={setRiskPct}
            min={0.1}
            max={10}
            step={0.1}
            display={`${riskPct.toFixed(1)}%`}
          />
          <SliderField
            label="Stop loss (%)"
            value={stopLossPct}
            onChange={setStopLossPct}
            min={0.5}
            max={20}
            step={0.5}
            display={`${stopLossPct.toFixed(1)}%`}
          />
          <SliderField
            label="Take profit (%)"
            value={takeProfitPct}
            onChange={setTakeProfitPct}
            min={0.5}
            max={50}
            step={0.5}
            display={`${takeProfitPct.toFixed(1)}%`}
          />
        </div>
      </Panel>

      <Panel title="Position sizing">
        <Row label="Position size (units)" value={sizing.qty} />
        <Row label="Position value" value={`$${sizing.positionValue.toFixed(2)}`} />
        <Row label="Potential loss" value={`$${sizing.potentialLoss.toFixed(2)}`} valueClass="neg" />
        <Row label="Potential profit" value={`$${(sizing.positionValue * takeProfitPct / stopLossPct).toFixed(2)}`} valueClass="pos" />
      </Panel>

      <Panel title="R:R analysis">
        <Row label="R:R" value={`1 : ${rr.toFixed(2)}`} valueClass={rr >= 3 ? 'pos' : rr >= 1.5 ? '' : 'neg'} />
        <Row label="Win rate needed to break even" value={`${winRateNeeded.toFixed(1)}%`} />
        <Row label="Win rate needed for 2× growth (over 100 trades)" value={`${Math.max(winRateNeeded, 0).toFixed(1)}% + 5%`} />
      </Panel>

      <AICoach message={coachMsg} />

      <Notice icon="⚖️">
        The 1% rule (risk &lt;1% of capital per trade) means ten losses in a row
        only cost you 10%. This is how professionals survive bad streaks without
        blowing the account.
      </Notice>
    </div>
  );
}

function SliderField({ label, value, onChange, min, max, step, display }) {
  return (
    <div>
      <div className="lab2-row" style={{ paddingTop: 0, border: 'none' }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
        <strong style={{ color: 'var(--text-1)' }}>{display}</strong>
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
