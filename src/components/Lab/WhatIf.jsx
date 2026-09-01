/**
 * What-If — "if this happens, what happens to my portfolio?"
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LabBack, AICoach, Panel, Row, Notice, ResultCard } from './Shared';
import { applyWhatIf } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const EVENTS = [
  { id: 'btc-crash', coin: 'BTC', defaultPct: -30 },
  { id: 'eth-drop', coin: 'ETH', defaultPct: -25 },
  { id: 'btc-rally', coin: 'BTC', defaultPct: 30 },
  { id: 'stable-depeg', coin: 'USDC', defaultPct: -5 },
  { id: 'gold-up', coin: 'GOLD', defaultPct: 10 },
  { id: 'stocks-down', coin: 'STOCKS', defaultPct: -15 },
  { id: 'sol-explode', coin: 'SOL', defaultPct: 60 }
];

const DEFAULT_PORTFOLIO = { BTC: 40, ETH: 25, USDC: 15, GOLD: 10, STOCKS: 10 };

export default function WhatIf({ onBack }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const recordWhatif = useLabStore((s) => s.recordWhatif);
  const history = useLabStore((s) => s.whatifs);

  const [shocks, setShocks] = useState([{ id: 'btc-crash', pct: -30 }]);
  const [portfolio, setPortfolio] = useState(DEFAULT_PORTFOLIO);
  const [result, setResult] = useState(null);

  const setShockPct = (idx, pct) => {
    setShocks((s) => s.map((sh, i) => (i === idx ? { ...sh, pct: Number(pct) } : sh)));
  };

  const removeShock = (idx) => {
    setShocks((s) => s.filter((_, i) => i !== idx));
  };

  const addShock = (eventId) => {
    const ev = EVENTS.find((e) => e.id === eventId);
    if (!ev) return;
    if (shocks.find((s) => s.coin === ev.coin)) return; // one per coin for simplicity
    setShocks((s) => [...s, { id: ev.id, coin: ev.coin, pct: ev.defaultPct }]);
  };

  const run = () => {
    haptic?.('success');
    const r = applyWhatIf({ allocations: portfolio }, shocks);
    setResult(r);
    recordWhatif({ shocks, portfolio, impact: r.totalImpact });
  };

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title={`🧩 ${t('lab2.screens.whatif.title')}`} sub={t('lab2.screens.whatif.sub')} />

      <Panel title={t('lab2.whatif.yourPortfolio')}>
        {Object.entries(portfolio).map(([coin, pct]) => (
          <div key={coin} className="lab2-row">
            <span>{t(`lab2.assets.${coin}`)}</span>
            <strong className="lab2-num">{pct}%</strong>
          </div>
        ))}
      </Panel>

      <Panel title={t('lab2.whatif.shocksApplied')}>
        {shocks.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', padding: 12 }}>
            {t('lab2.whatif.noShocks')}
          </div>
        ) : (
          shocks.map((sh, idx) => {
            const ev = EVENTS.find((e) => e.id === sh.id) ?? { id: sh.coin };
            const label = EVENTS.some((e) => e.id === sh.id)
              ? t(`lab2.whatif.events.${sh.id}`)
              : sh.coin;
            return (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, fontSize: 12 }}>{label}</div>
                <input
                  type="number"
                  value={sh.pct}
                  onChange={(e) => setShockPct(idx, e.target.value)}
                  className="lab2-input lab2-num"
                  style={{ width: 80, padding: 6 }}
                />
                <span style={{ fontSize: 10, color: 'var(--text-3)' }}>%</span>
                <button
                  onClick={() => removeShock(idx)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--down)', cursor: 'pointer', fontSize: 16 }}
                  aria-label="remove"
                >
                  ×
                </button>
              </div>
            );
          })
        )}
        <div className="lab2-defi-tabs">
          {EVENTS.filter((e) => !shocks.find((s) => s.coin === e.coin)).map((e) => (
            <button key={e.id} className="lab2-defi-tab" onClick={() => addShock(e.id)}>
              + {t(`lab2.whatif.events.${e.id}`)}
            </button>
          ))}
        </div>
      </Panel>

      <button className="lab2-btn primary full" onClick={run} disabled={shocks.length === 0}>
        ▶ {t('lab2.whatif.runScenario')}
      </button>

      {result && (
        <ResultCard
          kind={result.totalImpact > 0 ? 'win' : result.totalImpact < 0 ? 'loss' : 'neutral'}
          emoji={result.totalImpact > 0 ? '📈' : result.totalImpact < 0 ? '📉' : '➖'}
          title={<span className="lab2-num">{t('lab2.whatif.portfolioImpact')}: {result.totalImpact > 0 ? '+' : ''}{result.totalImpact}%</span>}
          sub={t('lab2.whatif.netEffect')}
        >
          <div style={{ width: '100%', marginTop: 8 }}>
            {result.details.map((d) => (
              <div key={d.coin} className="lab2-row">
                <span>{d.coin} · <span className="lab2-num">{d.allocPct}%</span></span>
                <strong className={d.impact > 0 ? 'pos' : d.impact < 0 ? 'neg' : ''}>
                  <span className="lab2-num">{d.impact > 0 ? '+' : ''}{d.impact.toFixed(2)}%</span>
                </strong>
              </div>
            ))}
          </div>
        </ResultCard>
      )}

      <AICoach
        message={
          result && result.totalImpact < -15
            ? t('lab2.whatif.coachPanic')
            : result && result.totalImpact < 0
            ? t('lab2.whatif.coachDown')
            : t('lab2.whatif.coachNeutral')
        }
      />

      {history.length > 0 && (
        <Panel title={t('lab2.whatif.pastScenarios')}>
          {history.slice(0, 5).map((h) => (
            <div key={h.id} className="lab2-row">
              <span>{t('lab2.whatif.shocksCount', { n: h.shocks.length })}</span>
              <strong className={h.impact > 0 ? 'pos' : h.impact < 0 ? 'neg' : ''}>
                <span className="lab2-num">{h.impact > 0 ? '+' : ''}{h.impact.toFixed(1)}%</span>
              </strong>
            </div>
          ))}
        </Panel>
      )}

      <Notice icon="🎯">
        {t('lab2.whatif.notice')}
      </Notice>
    </div>
  );
}
