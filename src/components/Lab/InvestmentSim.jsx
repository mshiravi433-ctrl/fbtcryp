/**
 * Investment Simulator — pick a portfolio mix, watch it run for 1d / 1w / 1m / 3m / 1y.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LabBack, AICoach, Panel, Row, Notice, Sparkline } from './Shared';
import { comparePortfolios } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const HORIZONS = [
  { key: '1d', days: 1 },
  { key: '1w', days: 7 },
  { key: '1m', days: 30 },
  { key: '3m', days: 90 },
  { key: '1y', days: 365 }
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

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title={`💰 ${t('lab2.screens.invest.title')}`} sub={t('lab2.screens.invest.sub')} />

      <Panel title={t('lab2.invest.capital')}>
        <Row label={t('lab2.invest.availableBalance')} value={<span className="lab2-num">${balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="lab2-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('lab2.invest.portfolioName')}
            style={{ flex: 1 }}
          />
        </div>
      </Panel>

      <Panel title={t('lab2.invest.allocation')}>
        {ASSETS.map((a) => (
          <div key={a.key} className="lab2-alloc">
            <div className="lab2-alloc-icon" style={{ background: a.color }}>{a.key.slice(0, 2)}</div>
            <div className="lab2-alloc-name">{t(`lab2.assets.${a.key}`)}</div>
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
            <div className="lab2-alloc-pct lab2-num">{(allocations[a.key] || 0).toFixed(0)}%</div>
          </div>
        ))}
        <div className="lab2-row">
          <span>{t('lab2.invest.total')}</span>
          <strong style={{ color: total === 100 ? 'var(--up)' : 'var(--rgb-5)' }}>
            <span className="lab2-num">{total.toFixed(0)}%</span> {total !== 100 && `(${t('lab2.invest.tapRunToNormalise')})`}
          </strong>
        </div>
        {total !== 100 && (
          <button className="lab2-btn ghost full" onClick={normalize}>
            {t('lab2.invest.normalise')}
          </button>
        )}
      </Panel>

      <Panel title={t('lab2.invest.timeHorizon')}>
        <div className="lab2-defi-tabs">
          {HORIZONS.map((h) => (
            <button
              key={h.key}
              className={`lab2-defi-tab ${horizon.key === h.key ? 'active' : ''}`}
              onClick={() => setHorizon(h)}
            >
              {t(`lab2.invest.horizons.${h.key}`)}
            </button>
          ))}
        </div>
      </Panel>

      <button className="lab2-btn primary full" onClick={run} disabled={total === 0}>
        ▶ {t('lab2.invest.runSimulation')}
      </button>

      {result && (
        <>
          <Panel title={`${t('lab2.invest.resultOver', { horizon: t(`lab2.invest.horizons.${horizon.key}`).toLowerCase() })}`}>
            <Row label={t('lab2.invest.finalValue')} value={<span className="lab2-num">${Number(result.finalValue).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>} />
            <Row label={t('lab2.invest.return')} value={<span className="lab2-num">{result.returnPct >= 0 ? '+' : ''}{result.returnPct}%</span>} valueClass={result.returnPct >= 0 ? 'pos' : 'neg'} />
            <Row label={t('lab2.invest.maxDrawdown')} value={<span className="lab2-num">{result.drawdown}%</span>} valueClass="neg" />
            <Row label={t('lab2.invest.vsBtc')} value={<span className="lab2-num">{result.bench >= 0 ? '+' : ''}{result.bench}%</span>} />
            <Sparkline data={result.series} />
          </Panel>
          <AICoach
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
        <Panel title={t('lab2.invest.savedPortfolios')}>
          {portfolios.slice(0, 5).map((p) => (
            <div key={p.id} className="lab2-row">
              <span>{p.name}</span>
              <strong className="lab2-num">{new Date(p.startedAt).toLocaleDateString()}</strong>
            </div>
          ))}
        </Panel>
      )}

      <Notice icon="📊">
        {t('lab2.invest.notice')}
      </Notice>
    </div>
  );
}
