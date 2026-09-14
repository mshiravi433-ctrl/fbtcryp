/**
 * Strategy Lab — build a rule-based strategy, backtest it.
 *
 * VISUAL PASS: the strategy is summarised as an IF/THEN chip recipe that
 * updates live while you drag, the on/off rule is a real switch, the exit rules
 * are colour-coded (stop-loss rose, take-profit mint) and the backtest result
 * leads with the signed return as a huge gradient figure over the equity curve.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AICoach,
  LAB_EASE,
  LabBack,
  LabSlider,
  LabToggle,
  Notice,
  Panel,
  ResultCard,
  Row,
  Sparkline
} from './Shared';
import { LabIcon } from './LabIcons';
import { runBacktest, generatePriceSeries } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';
import { useStill } from '../AnimatedIcon';

const PRESETS = [
  {
    name: 'presetRsiReversal',
    icon: 'refresh',
    rules: { rsiBelow: 30, sizePct: 10, stopLoss: 5, takeProfit: 15 }
  },
  {
    name: 'presetTrendFollowing',
    icon: 'trend',
    rules: { priceAboveMa: true, sizePct: 20, stopLoss: 8, takeProfit: 25 }
  },
  {
    name: 'presetDipBuyer',
    icon: 'droplet',
    rules: { rsiBelow: 35, priceAboveMa: true, sizePct: 15, stopLoss: 7, takeProfit: 20 }
  }
];

export default function StrategyLab({ onBack }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const still = useStill();
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
  const [running, setRunning] = useState(false);

  const run = () => {
    haptic?.('success');
    setRunning(true);
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
    setRunning(false);
  };

  const applyPreset = (p) => {
    setRsiBelow(p.rules.rsiBelow ?? 0);
    setPriceAboveMa(!!p.rules.priceAboveMa);
    setSizePct(p.rules.sizePct);
    setStopLoss(p.rules.stopLoss);
    setTakeProfit(p.rules.takeProfit);
    setName(t(`lab2.strategy.${p.name}`));
    haptic?.('select');
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

  const coachTone = !result
    ? 'neutral'
    : result.sharpe > 1.5
    ? 'good'
    : result.maxDrawdown > 30 || result.winRate < 40
    ? 'warn'
    : 'neutral';

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        icon="atom"
        accent="violet"
        title={t('lab2.screens.strategy.title')}
        sub={t('lab2.screens.strategy.sub')}
      />

      <Panel title={t('lab2.strategy.strategy')} icon="flask" accent="violet">
        <div>
          <label className="lab2-input-label" htmlFor="strategy-name">{t('lab2.strategy.strategyName')}</label>
          <input
            id="strategy-name"
            className="lab2-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('lab2.strategy.strategyName')}
          />
        </div>

        {/* The recipe: what the strategy does, restated as chips that update
            while the sliders move. */}
        <div className="lab2-rule">
          <span className="lab2-rule-key">{t('lab2.strategy.ruleIf')}</span>
          <span className={`lab2-rule-chip lab2-num ${rsiBelow > 0 ? '' : 'off'}`}>
            <LabIcon name="gauge" width={13} height={13} />
            RSI &lt; {rsiBelow > 0 ? rsiBelow : '—'}
          </span>
          {priceAboveMa && (
            <span className="lab2-rule-chip lab2-num">
              <LabIcon name="trend" width={13} height={13} />
              {t('lab2.strategy.andMa')}
            </span>
          )}
        </div>
        <div className="lab2-rule">
          <span className="lab2-rule-key">{t('lab2.strategy.ruleThen')}</span>
          <span className="lab2-rule-chip lab2-num">
            <LabIcon name="wallet" width={13} height={13} />
            {t('lab2.paper.buy')} {sizePct}%
          </span>
          <span className="lab2-rule-chip down lab2-num">
            <LabIcon name="shield" width={13} height={13} />
            {t('lab2.strategy.stopLoss')} {stopLoss}%
          </span>
          <span className="lab2-rule-chip up lab2-num">
            <LabIcon name="target" width={13} height={13} />
            {t('lab2.strategy.takeProfit')} {takeProfit}%
          </span>
        </div>
      </Panel>

      <Panel title={t('lab2.strategy.presets')} icon="layers" accent="cyan">
        <div className="lab2-chips">
          {PRESETS.map((p) => (
            <button key={p.name} type="button" className="lab2-chip" onClick={() => applyPreset(p)}>
              <LabIcon name={p.icon} width={15} height={15} />
              <span>{t(`lab2.strategy.${p.name}`)}</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={t('lab2.strategy.entryRules')} icon="target" accent="mint">
        <div className="lab2-stack" style={{ gap: 14 }}>
          <LabSlider
            label={t('lab2.strategy.buyWhenRsi')}
            value={rsiBelow}
            onChange={setRsiBelow}
            min={0}
            max={50}
            step={1}
            accent="cyan"
            display={<span className="lab2-num">{rsiBelow > 0 ? String(rsiBelow) : t('lab2.off')}</span>}
          />
          <LabToggle
            label={t('lab2.strategy.onlyAboveMa')}
            checked={priceAboveMa}
            onChange={setPriceAboveMa}
          />
        </div>
      </Panel>

      <Panel title={t('lab2.strategy.position')} icon="pie" accent="amber">
        <LabSlider
          label={t('lab2.strategy.positionSize')}
          value={sizePct}
          onChange={setSizePct}
          min={1}
          max={50}
          step={1}
          accent="amber"
          display={<span className="lab2-num">{sizePct}%</span>}
        />
      </Panel>

      <Panel title={t('lab2.strategy.exit')} icon="shield" accent="rose">
        <div className="lab2-stack" style={{ gap: 14 }}>
          <LabSlider
            label={t('lab2.strategy.stopLoss')}
            value={stopLoss}
            onChange={setStopLoss}
            min={1}
            max={20}
            step={0.5}
            accent="rose"
            display={<span className="lab2-num">−{stopLoss}%</span>}
          />
          <LabSlider
            label={t('lab2.strategy.takeProfit')}
            value={takeProfit}
            onChange={setTakeProfit}
            min={1}
            max={50}
            step={0.5}
            accent="mint"
            display={<span className="lab2-num">+{takeProfit}%</span>}
          />
        </div>
      </Panel>

      <motion.button
        className="lab2-btn primary full"
        type="button"
        onClick={run}
        whileTap={still ? undefined : { scale: 0.975 }}
      >
        <LabIcon name={running ? 'refresh' : 'play'} width={15} height={15} />
        {t('lab2.strategy.runBacktest')}
      </motion.button>

      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={`backtest-${result.returnPct}-${result.trades}`}
            initial={still ? false : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={still ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.45, ease: LAB_EASE }}
            className="lab2-stack"
          >
            <ResultCard
              kind={result.returnPct > 0 ? 'win' : 'loss'}
              icon={result.returnPct > 0 ? 'trend' : 'alert'}
              figure={`${result.returnPct >= 0 ? '+' : ''}${result.returnPct}%`}
              title={t('lab2.strategy.return')}
              sub={<span className="lab2-num">{t('lab2.strategy.overDays', { days: result.periodDays, trades: result.trades })}</span>}
            >
              <div className="lab2-stack" style={{ width: '100%', marginTop: 8 }}>
                <Row label={t('lab2.strategy.winRate')} value={<span className="lab2-num">{result.winRate}%</span>} valueClass={result.winRate >= 50 ? 'pos' : 'neg'} />
                <Row label={t('lab2.strategy.maxDrawdown')} value={<span className="lab2-num">-{result.maxDrawdown}%</span>} valueClass="neg" />
                <Row label={t('lab2.strategy.sharpe')} value={<span className="lab2-num">{result.sharpe.toFixed(2)}</span>} valueClass={result.sharpe >= 1 ? 'pos' : ''} />
                <Row label={t('lab2.strategy.finalCash')} value={<span className="lab2-num">${result.finalCash.toLocaleString()}</span>} />
              </div>
            </ResultCard>

            {series && (
              <Panel title={t('lab2.strategy.equityCurve')} icon="activity" accent={result.returnPct > 0 ? 'mint' : 'rose'}>
                <Sparkline data={series} tag={`${result.returnPct >= 0 ? '+' : ''}${result.returnPct}%`} />
              </Panel>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AICoach tone={coachTone} message={coachMsg} />

      {strategies.length > 0 && (
        <Panel title={t('lab2.strategy.savedStrategies')} icon="layers" accent="cyan">
          {strategies.slice(0, 5).map((s) => (
            <div key={s.id} className="lab2-row">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <LabIcon name="flask" width={14} height={14} />
                {s.name}
              </span>
              <strong className={s.backtest?.returnPct >= 0 ? 'pos' : 'neg'}>
                <span className="lab2-num">{s.backtest?.returnPct >= 0 ? '+' : ''}{s.backtest?.returnPct}%</span>
              </strong>
            </div>
          ))}
        </Panel>
      )}

      <Notice variant="warn" icon="alert">
        {t('lab2.strategy.notice')}
      </Notice>
    </div>
  );
}
