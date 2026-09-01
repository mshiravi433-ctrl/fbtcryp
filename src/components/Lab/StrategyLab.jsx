/**
 * Strategy Lab — build a rule-based strategy, backtest it.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LabBack, AICoach, Panel, Row, Notice, ResultCard, Sparkline } from './Shared';
import { runBacktest, generatePriceSeries } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const PRESETS = [
  {
    name: 'presetRsiReversal',
    rules: { rsiBelow: 30, sizePct: 10, stopLoss: 5, takeProfit: 15 }
  },
  {
    name: 'presetTrendFollowing',
    rules: { priceAboveMa: true, sizePct: 20, stopLoss: 8, takeProfit: 25 }
  },
  {
    name: 'presetDipBuyer',
    rules: { rsiBelow: 35, priceAboveMa: true, sizePct: 15, stopLoss: 7, takeProfit: 20 }
  }
];

export default function StrategyLab({ onBack }) {
  const { t } = useTranslation();
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
    setName(t(`lab2.strategy.${p.name}`));
  };

  const coachMsg = result
    ? result.sharpe > 1.5
      ? t('lab2.strategy.coachSharpe')
      : result.maxDrawdown > 30
      ? t('lab2.strategy.coachDrawdown')
      : result.winRate < 40
      ? t('lab2.strategy.coachWinRate')
      : t('lab2.strategy.coachBalanced')
    : t('lab2.strategy.coachNoRules');

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title={`🧪 ${t('lab2.screens.strategy.title')}`} sub={t('lab2.screens.strategy.sub')} />

      <Panel title={t('lab2.strategy.strategy')}>
        <input
          className="lab2-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('lab2.strategy.strategyName')}
        />
        <div style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5, marginTop: 6 }}>
          <strong>{t('lab2.strategy.ruleIf')}</strong> RSI &lt; <span className="lab2-num">{rsiBelow || '—'}</span>
          {priceAboveMa && ` ${t('lab2.strategy.andMa')}`}
          <br />
          <strong>{t('lab2.strategy.ruleThen')}</strong> {t('lab2.paper.buy')} <span className="lab2-num">{sizePct}%</span> · {t('lab2.strategy.stopLoss')} <span className="lab2-num">{stopLoss}%</span> · {t('lab2.strategy.takeProfit')} <span className="lab2-num">{takeProfit}%</span>
        </div>
      </Panel>

      <Panel title={t('lab2.strategy.presets')}>
        <div className="lab2-defi-tabs">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              className="lab2-defi-tab"
              onClick={() => applyPreset(p)}
            >
              {t(`lab2.strategy.${p.name}`)}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={t('lab2.strategy.entryRules')}>
        <SliderField label={t('lab2.strategy.buyWhenRsi')} value={rsiBelow} onChange={setRsiBelow} min={0} max={50} step={1} display={<span className="lab2-num">{rsiBelow > 0 ? String(rsiBelow) : t('lab2.off')}</span>} />
        <ToggleField label={t('lab2.strategy.onlyAboveMa')} value={priceAboveMa} onChange={setPriceAboveMa} />
      </Panel>

      <Panel title={t('lab2.strategy.position')}>
        <SliderField label={t('lab2.strategy.positionSize')} value={sizePct} onChange={setSizePct} min={1} max={50} step={1} display={<span className="lab2-num">{sizePct}%</span>} />
      </Panel>

      <Panel title={t('lab2.strategy.exit')}>
        <SliderField label={t('lab2.strategy.stopLoss')} value={stopLoss} onChange={setStopLoss} min={1} max={20} step={0.5} display={<span className="lab2-num">{stopLoss}%</span>} />
        <SliderField label={t('lab2.strategy.takeProfit')} value={takeProfit} onChange={setTakeProfit} min={1} max={50} step={0.5} display={<span className="lab2-num">{takeProfit}%</span>} />
      </Panel>

      <button className="lab2-btn primary full" onClick={run}>
        ▶ {t('lab2.strategy.runBacktest')}
      </button>

      {result && (
        <>
          <ResultCard
            kind={result.returnPct > 0 ? 'win' : 'loss'}
            emoji={result.returnPct > 0 ? '📈' : '📉'}
            title={<span className="lab2-num">{t('lab2.strategy.return')}: {result.returnPct >= 0 ? '+' : ''}{result.returnPct}%</span>}
            sub={<span className="lab2-num">{t('lab2.strategy.overDays', { days: result.periodDays, trades: result.trades })}</span>}
          >
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              <Row label={t('lab2.strategy.winRate')} value={<span className="lab2-num">{result.winRate}%</span>} />
              <Row label={t('lab2.strategy.maxDrawdown')} value={<span className="lab2-num">-{result.maxDrawdown}%</span>} valueClass="neg" />
              <Row label={t('lab2.strategy.sharpe')} value={<span className="lab2-num">{result.sharpe.toFixed(2)}</span>} valueClass={result.sharpe >= 1 ? 'pos' : ''} />
              <Row label={t('lab2.strategy.finalCash')} value={<span className="lab2-num">${result.finalCash.toLocaleString()}</span>} />
            </div>
          </ResultCard>
          {series && <Panel title={t('lab2.strategy.equityCurve')}><Sparkline data={series} /></Panel>}
        </>
      )}

      <AICoach message={coachMsg} />

      {strategies.length > 0 && (
        <Panel title={t('lab2.strategy.savedStrategies')}>
          {strategies.slice(0, 5).map((s) => (
            <div key={s.id} className="lab2-row">
              <span>{s.name}</span>
              <strong className={s.backtest?.returnPct >= 0 ? 'pos' : 'neg'}>
                <span className="lab2-num">{s.backtest?.returnPct >= 0 ? '+' : ''}{s.backtest?.returnPct}%</span>
              </strong>
            </div>
          ))}
        </Panel>
      )}

      <Notice icon="⚠️">
        {t('lab2.strategy.notice')}
      </Notice>
    </div>
  );
}

function SliderField({ label, value, onChange, min, max, step, display }) {
  return (
    <div style={{ marginBottom: 8 }}>
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

function ToggleField({ label, value, onChange }) {
  const { t } = useTranslation();
  return (
    <div className="lab2-row" style={{ paddingTop: 0, border: 'none' }}>
      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
      <button
        className={`lab2-btn ${value ? 'primary' : 'ghost'}`}
        onClick={() => onChange(!value)}
        style={{ minWidth: 60 }}
      >
        {value ? t('lab2.on') : t('lab2.off')}
      </button>
    </div>
  );
}
