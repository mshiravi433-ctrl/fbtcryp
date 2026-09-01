/**
 * Compare Portfolios — Portfolio A vs Portfolio B.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LabBack, AICoach, Panel, Notice, Sparkline } from './Shared';
import { comparePortfolios } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const HORIZONS = [
  { key: '1m', days: 30 },
  { key: '3m', days: 90 },
  { key: '1y', days: 365 }
];

const PRESET_A = { BTC: 100 };
const PRESET_B = { BTC: 50, ETH: 30, USDC: 20 };
const PRESET_C = { BTC: 30, ETH: 30, USDC: 20, GOLD: 10, STOCKS: 10 };

export default function ComparePortfolios({ onBack }) {
  const { t } = useTranslation();
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
      <LabBack onBack={onBack} title={`⚖️ ${t('lab2.screens.compare.title')}`} sub={t('lab2.screens.compare.sub')} />

      <Panel title={t('lab2.compare.horizon')}>
        <div className="lab2-defi-tabs">
          {HORIZONS.map((h) => (
            <button
              key={h.key}
              className={`lab2-defi-tab ${horizon.key === h.key ? 'active' : ''}`}
              onClick={() => setHorizon(h)}
            >
              {t(`lab2.compare.horizons.${h.key}`)}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={t('lab2.compare.portfolioA')}>
        <div className="lab2-defi-tabs" style={{ marginBottom: 8 }}>
          <button className="lab2-defi-tab" onClick={() => setA(PRESET_A)}>{t('lab2.compare.presetBtc')}</button>
          <button className="lab2-defi-tab" onClick={() => setA(PRESET_B)}>{t('lab2.compare.presetMix')}</button>
          <button className="lab2-defi-tab" onClick={() => setA(PRESET_C)}>{t('lab2.compare.presetDiversified')}</button>
        </div>
        {allAssets.map((coin) => (
          <div key={coin} className="lab2-alloc">
            <div className="lab2-alloc-name">{t(`lab2.assets.${coin}`)}</div>
            <input
              type="range"
              min="0"
              max="100"
              value={a[coin] || 0}
              onChange={(e) => updateAlloc('a', coin, e.target.value)}
              className="lab2-slider"
              style={{ width: 100 }}
            />
            <div className="lab2-alloc-pct lab2-num">{(a[coin] || 0).toFixed(0)}%</div>
          </div>
        ))}
        <div className="lab2-row">
          <span>{t('lab2.compare.total')}</span>
          <strong style={{ color: totalA === 100 ? 'var(--up)' : 'var(--rgb-5)' }} className="lab2-num">{totalA}%</strong>
        </div>
      </Panel>

      <Panel title={t('lab2.compare.portfolioB')}>
        <div className="lab2-defi-tabs" style={{ marginBottom: 8 }}>
          <button className="lab2-defi-tab" onClick={() => setB(PRESET_A)}>{t('lab2.compare.presetBtc')}</button>
          <button className="lab2-defi-tab" onClick={() => setB(PRESET_B)}>{t('lab2.compare.presetMix')}</button>
          <button className="lab2-defi-tab" onClick={() => setB(PRESET_C)}>{t('lab2.compare.presetDiversified')}</button>
        </div>
        {allAssets.map((coin) => (
          <div key={coin} className="lab2-alloc">
            <div className="lab2-alloc-name">{t(`lab2.assets.${coin}`)}</div>
            <input
              type="range"
              min="0"
              max="100"
              value={b[coin] || 0}
              onChange={(e) => updateAlloc('b', coin, e.target.value)}
              className="lab2-slider"
              style={{ width: 100 }}
            />
            <div className="lab2-alloc-pct lab2-num">{(b[coin] || 0).toFixed(0)}%</div>
          </div>
        ))}
        <div className="lab2-row">
          <span>{t('lab2.compare.total')}</span>
          <strong style={{ color: totalB === 100 ? 'var(--up)' : 'var(--rgb-5)' }} className="lab2-num">{totalB}%</strong>
        </div>
      </Panel>

      <button className="lab2-btn primary full" onClick={run} disabled={totalA === 0 || totalB === 0}>
        ▶ {t('lab2.compare.compare')}
      </button>

      {result && (
        <>
          <div className="lab2-compare">
            <div className="lab2-compare-side a">
              <div className="lab2-compare-title">{t('lab2.compare.portfolioA')}</div>
              <div className="lab2-compare-value lab2-num" style={{ color: result.a.returnPct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                {result.a.returnPct >= 0 ? '+' : ''}{result.a.returnPct}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {t('lab2.compare.drawdownFinal', { dd: result.a.drawdown, final: result.a.final.toLocaleString() })}
              </div>
            </div>
            <div className="lab2-compare-side b">
              <div className="lab2-compare-title">{t('lab2.compare.portfolioB')}</div>
              <div className="lab2-compare-value lab2-num" style={{ color: result.b.returnPct >= 0 ? 'var(--up)' : 'var(--down)' }}>
                {result.b.returnPct >= 0 ? '+' : ''}{result.b.returnPct}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {t('lab2.compare.drawdownFinal', { dd: result.b.drawdown, final: result.b.final.toLocaleString() })}
              </div>
            </div>
          </div>
          <Panel title={t('lab2.compare.equityCurves')}>
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
                ? t('lab2.compare.coachA')
                : result.b.returnPct > result.a.returnPct
                ? t('lab2.compare.coachB')
                : t('lab2.compare.coachTie')
            }
          />
        </>
      )}

      <Notice icon="🧠">
        {t('lab2.compare.notice')}
      </Notice>
    </div>
  );
}
