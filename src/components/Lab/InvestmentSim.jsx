/**
 * Investment Simulator — pick a portfolio mix, watch it run for 1d / 1w / 1m / 3m / 1y.
 *
 * VISUAL PASS: the mix is now a DONUT that rebuilds itself as you drag, with a
 * legend beside it, instead of six rows of identical grey sliders. Each slider
 * takes the asset's own colour (`--acc` is set inline per row), so the row, its
 * tile and its filled track all agree with the slice they control.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AICoach,
  AnimatedNumber,
  Donut,
  LabBack,
  LabChips,
  Legend,
  Notice,
  Panel,
  ResultCard,
  Row,
  Sparkline
} from './Shared';
import { LabIcon } from './LabIcons';
import { comparePortfolios } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const HORIZONS = [
  { key: '1d', days: 1, icon: 'bolt' },
  { key: '1w', days: 7, icon: 'clock' },
  { key: '1m', days: 30, icon: 'activity' },
  { key: '3m', days: 90, icon: 'hourglass' },
  { key: '1y', days: 365, icon: 'layers' }
];

const ASSETS = [
  { key: 'BTC', color: '#f7931a' },
  { key: 'ETH', color: '#627eea' },
  { key: 'SOL', color: '#14f195' },
  { key: 'USDC', color: '#2775ca' },
  { key: 'GOLD', color: '#d4af37' },
  { key: 'STOCKS', color: '#00ff9d' }
];

export default function InvestmentSim({ onBack }) {
  const { t } = useTranslation();
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
    haptic?.('select');
  };

  const run = () => {
    if (total === 0) return;
    haptic?.('success');
    openPortfolio({ name, allocations: { ...allocations }, seed: Date.now() % 1000 });
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

  const horizonChips = HORIZONS.map((h) => ({
    id: h.key,
    label: t(`lab2.invest.horizons.${h.key}`),
    icon: h.icon
  }));

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        icon="wallet"
        accent="mint"
        title={t('lab2.screens.invest.title')}
        sub={t('lab2.screens.invest.sub')}
      />

      <Panel title={t('lab2.invest.capital')} icon="coins" accent="amber">
        <Row label={t('lab2.invest.availableBalance')} value={<AnimatedNumber value={balance} prefix="$" />} />
        <div>
          <label className="lab2-input-label" htmlFor="invest-name">{t('lab2.invest.portfolioName')}</label>
          <input
            id="invest-name"
            className="lab2-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('lab2.invest.portfolioName')}
          />
        </div>
      </Panel>

      <Panel title={t('lab2.invest.allocation')} icon="pie" accent="mint">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <Donut
            slices={allocationsList.map((a) => ({
              label: t(`lab2.assets.${a.key}`),
              value: a.pct,
              color: a.color
            }))}
            centerValue={`${total.toFixed(0)}%`}
            centerLabel={t('lab2.invest.total')}
          />
          <Legend
            items={allocationsList.map((a) => ({
              label: t(`lab2.assets.${a.key}`),
              value: `${a.pct.toFixed(0)}%`,
              color: a.color
            }))}
          />
        </div>

        {ASSETS.map((a) => {
          const pct = allocations[a.key] || 0;
          return (
            <div key={a.key} className="lab2-alloc" style={{ '--acc': a.color, '--acc-2': a.color }}>
              <div
                className="lab2-alloc-icon"
                style={{ background: `linear-gradient(140deg, ${a.color}, ${a.color}bb)`, color: '#06121a' }}
              >
                {a.key.slice(0, 2)}
              </div>
              <div className="lab2-alloc-name">{t(`lab2.assets.${a.key}`)}</div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={pct}
                onChange={(e) => updateAlloc(a.key, e.target.value)}
                className="lab2-slider"
                style={{ '--fill': `${pct}%` }}
                aria-label={t(`lab2.assets.${a.key}`)}
              />
              <div className="lab2-alloc-pct lab2-num">{pct.toFixed(0)}%</div>
            </div>
          );
        })}

        <div className="lab2-row">
          <span>{t('lab2.invest.total')}</span>
          <strong style={{ color: total === 100 ? 'var(--up)' : 'var(--rgb-5)' }}>
            <span className="lab2-num">{total.toFixed(0)}%</span>{' '}
            {total !== 100 && `(${t('lab2.invest.tapRunToNormalise')})`}
          </strong>
        </div>
        {total !== 100 && (
          <button className="lab2-btn ghost full" type="button" onClick={normalize}>
            <LabIcon name="refresh" width={15} height={15} />
            {t('lab2.invest.normalise')}
          </button>
        )}
      </Panel>

      <Panel title={t('lab2.invest.timeHorizon')} icon="clock" accent="cyan">
        <LabChips
          items={horizonChips}
          value={horizon.key}
          layoutId="invest-horizon"
          accent="cyan"
          onChange={(id) => setHorizon(HORIZONS.find((h) => h.key === id) ?? HORIZONS[0])}
        />
      </Panel>

      <button className="lab2-btn primary full" type="button" onClick={run} disabled={total === 0}>
        <LabIcon name="play" width={15} height={15} />
        {t('lab2.invest.runSimulation')}
      </button>

      {result && (
        <>
          <ResultCard
            kind={result.returnPct >= 0 ? 'win' : 'loss'}
            icon={result.returnPct >= 0 ? 'trend' : 'shield'}
            figure={`${result.returnPct >= 0 ? '+' : ''}${result.returnPct}%`}
            title={t('lab2.invest.resultOver', { horizon: t(`lab2.invest.horizons.${horizon.key}`) })}
          >
            <div className="lab2-stack" style={{ width: '100%', marginTop: 8 }}>
              <Row label={t('lab2.invest.finalValue')} value={<span className="lab2-num">${Number(result.finalValue).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>} />
              <Row label={t('lab2.invest.maxDrawdown')} value={<span className="lab2-num">{result.drawdown}%</span>} valueClass="neg" />
              <Row label={t('lab2.invest.vsBtc')} value={<span className="lab2-num">{result.bench >= 0 ? '+' : ''}{result.bench}%</span>} valueClass={result.returnPct > result.bench ? 'pos' : 'neg'} />
              <Sparkline data={result.series} />
            </div>
          </ResultCard>
          <AICoach
            tone={result.returnPct > result.bench ? 'good' : result.returnPct > 0 ? 'neutral' : 'warn'}
            message={
              result.returnPct > result.bench
                ? t('lab2.invest.coachBeatBtc')
                : result.returnPct > 0
                ? t('lab2.invest.coachPositive')
                : t('lab2.invest.coachDown')
            }
          />
        </>
      )}

      {portfolios.length > 0 && (
        <Panel title={t('lab2.invest.savedPortfolios')} icon="layers" accent="violet">
          {portfolios.slice(0, 5).map((p) => (
            <div key={p.id} className="lab2-row">
              <span>{p.name}</span>
              <strong className="lab2-num">{new Date(p.startedAt).toLocaleDateString()}</strong>
            </div>
          ))}
        </Panel>
      )}

      <Notice variant="info" icon="pie">
        {t('lab2.invest.notice')}
      </Notice>
    </div>
  );
}
