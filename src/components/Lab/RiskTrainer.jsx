/**
 * Risk Trainer — interactive R:R + position size calculator.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LabBack, AICoach, Panel, Row, Notice } from './Shared';
import { calcPositionSize } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';

export default function RiskTrainer({ onBack }) {
  const { t } = useTranslation();
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
      ? t('lab2.risk.coachAggressive')
      : rr < 1.5
      ? t('lab2.risk.coachBadRr')
      : rr >= 3
      ? t('lab2.risk.coachGood')
      : t('lab2.risk.coachNeutral');

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title={`🛡️ ${t('lab2.screens.risk.title')}`} sub={t('lab2.screens.risk.sub')} />

      <Panel title={t('lab2.risk.inputs')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SliderField
            label={t('lab2.risk.capital')}
            value={capital}
            onChange={setCapital}
            min={100}
            max={1000000}
            step={100}
            display={<span className="lab2-num">${capital.toLocaleString()}</span>}
          />
          <SliderField
            label={t('lab2.risk.entryPrice')}
            value={entry}
            onChange={setEntry}
            min={1}
            max={100000}
            step={1}
            display={<span className="lab2-num">${entry.toLocaleString()}</span>}
          />
          <SliderField
            label={t('lab2.risk.riskPerTrade')}
            value={riskPct}
            onChange={setRiskPct}
            min={0.1}
            max={10}
            step={0.1}
            display={<span className="lab2-num">{riskPct.toFixed(1)}%</span>}
          />
          <SliderField
            label={t('lab2.risk.stopLoss')}
            value={stopLossPct}
            onChange={setStopLossPct}
            min={0.5}
            max={20}
            step={0.5}
            display={<span className="lab2-num">{stopLossPct.toFixed(1)}%</span>}
          />
          <SliderField
            label={t('lab2.risk.takeProfit')}
            value={takeProfitPct}
            onChange={setTakeProfitPct}
            min={0.5}
            max={50}
            step={0.5}
            display={<span className="lab2-num">{takeProfitPct.toFixed(1)}%</span>}
          />
        </div>
      </Panel>

      <Panel title={t('lab2.risk.positionSizing')}>
        <Row label={t('lab2.risk.positionSizeUnits')} value={<span className="lab2-num">{sizing.qty}</span>} />
        <Row label={t('lab2.risk.positionValue')} value={<span className="lab2-num">${sizing.positionValue.toFixed(2)}</span>} />
        <Row label={t('lab2.risk.potentialLoss')} value={<span className="lab2-num">${sizing.potentialLoss.toFixed(2)}</span>} valueClass="neg" />
        <Row label={t('lab2.risk.potentialProfit')} value={<span className="lab2-num">${(sizing.positionValue * takeProfitPct / stopLossPct).toFixed(2)}</span>} valueClass="pos" />
      </Panel>

      <Panel title={t('lab2.risk.rrAnalysis')}>
        <Row label={t('lab2.risk.rr')} value={<span className="lab2-num">1 : {rr.toFixed(2)}</span>} valueClass={rr >= 3 ? 'pos' : rr >= 1.5 ? '' : 'neg'} />
        <Row label={t('lab2.risk.winRateBreakEven')} value={<span className="lab2-num">{winRateNeeded.toFixed(1)}%</span>} />
        <Row label={t('lab2.risk.winRate2x')} value={<span className="lab2-num">{Math.max(winRateNeeded, 0).toFixed(1)}% + 5%</span>} />
      </Panel>

      <AICoach message={coachMsg} />

      <Notice icon="⚖️">
        {t('lab2.risk.notice')}
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
