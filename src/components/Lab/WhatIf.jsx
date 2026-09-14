/**
 * What-If — "if this happens, what happens to my portfolio?"
 *
 * VISUAL PASS: the portfolio is a donut (so "40% BTC" is a shape, not a row of
 * digits), each shock is an editable pill with a coloured arrow, and the impact
 * breakdown is a list of red/green chips whose width follows the size of the
 * hit — the visual answer arrives before the arithmetic.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AICoach,
  Donut,
  LAB_EASE,
  LabBack,
  Legend,
  Notice,
  Panel,
  ResultCard,
  Row
} from './Shared';
import { IconArrowDown, IconArrowUp, IconClose, IconPlus, LabIcon } from './LabIcons';
import { applyWhatIf } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';
import { useStill } from '../AnimatedIcon';

const ASSET_COLOR = {
  BTC: '#f7931a',
  ETH: '#627eea',
  USDC: '#2775ca',
  GOLD: '#d4af37',
  STOCKS: '#00ff9d'
};

const EVENTS = [
  { id: 'btc-crash', coin: 'BTC', defaultPct: -30, icon: 'flame' },
  { id: 'eth-drop', coin: 'ETH', defaultPct: -25, icon: 'trend' },
  { id: 'btc-rally', coin: 'BTC', defaultPct: 30, icon: 'rocket' },
  { id: 'stable-depeg', coin: 'USDC', defaultPct: -5, icon: 'droplet' },
  { id: 'gold-up', coin: 'GOLD', defaultPct: 10, icon: 'coins' },
  { id: 'stocks-down', coin: 'STOCKS', defaultPct: -15, icon: 'activity' },
  { id: 'sol-explode', coin: 'SOL', defaultPct: 60, icon: 'bolt' }
];

const DEFAULT_PORTFOLIO = { BTC: 40, ETH: 25, USDC: 15, GOLD: 10, STOCKS: 10 };

export default function WhatIf({ onBack }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const still = useStill();
  const recordWhatif = useLabStore((s) => s.recordWhatif);
  const history = useLabStore((s) => s.whatifs);

  const [shocks, setShocks] = useState([{ id: 'btc-crash', coin: 'BTC', pct: -30 }]);
  const [portfolio] = useState(DEFAULT_PORTFOLIO);
  const [result, setResult] = useState(null);

  const setShockPct = (idx, pct) => {
    setShocks((s) => s.map((sh, i) => (i === idx ? { ...sh, pct: Number(pct) } : sh)));
  };

  const removeShock = (idx) => {
    setShocks((s) => s.filter((_, i) => i !== idx));
    haptic?.('select');
  };

  const addShock = (eventId) => {
    const ev = EVENTS.find((e) => e.id === eventId);
    if (!ev) return;
    if (shocks.find((s) => s.coin === ev.coin)) return; // one per coin for simplicity
    setShocks((s) => [...s, { id: ev.id, coin: ev.coin, pct: ev.defaultPct }]);
    haptic?.('select');
  };

  const run = () => {
    haptic?.('success');
    const r = applyWhatIf({ allocations: portfolio }, shocks);
    setResult(r);
    recordWhatif({ shocks, portfolio, impact: r.totalImpact });
  };

  const slices = Object.entries(portfolio)
    .filter(([, pct]) => pct > 0)
    .map(([coin, pct]) => ({
      label: t(`lab2.assets.${coin}`),
      value: pct,
      color: ASSET_COLOR[coin] ?? 'var(--acc)'
    }));

  const worst = result ? Math.max(...result.details.map((d) => Math.abs(d.impact)), 1) : 1;

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        icon="puzzle"
        accent="magenta"
        title={t('lab2.screens.whatif.title')}
        sub={t('lab2.screens.whatif.sub')}
      />

      <Panel title={t('lab2.whatif.yourPortfolio')} icon="pie" accent="cyan">
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <Donut slices={slices} centerValue="100%" centerLabel={t('lab2.invest.total')} />
          <Legend items={slices.map((s) => ({ label: s.label, value: `${s.value}%`, color: s.color }))} />
        </div>
        {Object.entries(portfolio).map(([coin, pct]) => (
          <Row key={coin} label={t(`lab2.assets.${coin}`)} value={<span className="lab2-num">{pct}%</span>} />
        ))}
      </Panel>

      <Panel title={t('lab2.whatif.shocksApplied')} icon="flame" accent="rose">
        {shocks.length === 0 ? (
          <div className="lab2-muted" style={{ textAlign: 'center', padding: 12 }}>
            {t('lab2.whatif.noShocks')}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {shocks.map((sh, idx) => {
              const meta = EVENTS.find((e) => e.id === sh.id) ?? { icon: 'alert' };
              const label = EVENTS.some((e) => e.id === sh.id) ? t(`lab2.whatif.events.${sh.id}`) : sh.coin;
              const up = Number(sh.pct) > 0;
              return (
                <motion.div
                  key={`${sh.id}-${idx}`}
                  className="lab2-shock-row"
                  initial={still ? false : { opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={still ? undefined : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.28, ease: LAB_EASE }}
                >
                  <span className={`lab2-shock-icon ${up ? 'up' : 'down'}`} aria-hidden="true">
                    <LabIcon name={meta.icon} width={15} height={15} />
                  </span>
                  <span className="lab2-shock-label">{label}</span>
                  <input
                    type="number"
                    value={sh.pct}
                    onChange={(e) => setShockPct(idx, e.target.value)}
                    className={`lab2-input lab2-num lab2-shock-input ${up ? 'pos' : 'neg'}`}
                    aria-label={label}
                  />
                  <span className="lab2-muted lab2-num">%</span>
                  <button
                    type="button"
                    className="lab2-shock-remove"
                    onClick={() => removeShock(idx)}
                    aria-label={t('lab2.whatif.noShocks')}
                  >
                    <IconClose width={14} height={14} />
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}

        <div className="lab2-chips">
          {EVENTS.filter((e) => !shocks.find((s) => s.coin === e.coin)).map((e) => (
            <button key={e.id} type="button" className="lab2-chip" onClick={() => addShock(e.id)}>
              <IconPlus width={13} height={13} />
              <span>{t(`lab2.whatif.events.${e.id}`)}</span>
            </button>
          ))}
        </div>
      </Panel>

      <button
        className="lab2-btn primary full"
        type="button"
        onClick={run}
        disabled={shocks.length === 0}
      >
        <LabIcon name="play" width={15} height={15} />
        {t('lab2.whatif.runScenario')}
      </button>

      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={`whatif-${result.totalImpact}`}
            initial={still ? false : { opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={still ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.42, ease: LAB_EASE }}
          >
            <ResultCard
              kind={result.totalImpact > 0 ? 'win' : result.totalImpact < 0 ? 'loss' : 'neutral'}
              icon={result.totalImpact > 0 ? 'trend' : result.totalImpact < 0 ? 'flame' : 'scale'}
              figure={`${result.totalImpact > 0 ? '+' : ''}${result.totalImpact}%`}
              title={t('lab2.whatif.portfolioImpact')}
              sub={t('lab2.whatif.netEffect')}
            >
              <div className="lab2-stack" style={{ width: '100%', marginTop: 10, gap: 8 }}>
                {result.details.map((d) => {
                  const w = Math.min(100, (Math.abs(d.impact) / worst) * 100);
                  const up = d.impact > 0;
                  return (
                    <div key={d.coin} className="lab2-stack" style={{ gap: 5 }}>
                      <div className="lab2-row" style={{ paddingBlock: 0, border: 'none' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                          <span
                            className="lab2-coin-dot"
                            style={{ '--coin': ASSET_COLOR[d.coin] ?? 'var(--acc)' }}
                            aria-hidden="true"
                          >
                            {d.coin.slice(0, 3)}
                          </span>
                          {d.coin} · <span className="lab2-num">{d.allocPct}%</span>
                        </span>
                        <strong className={up ? 'pos' : d.impact < 0 ? 'neg' : ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          {up ? <IconArrowUp width={12} height={12} /> : d.impact < 0 ? <IconArrowDown width={12} height={12} /> : null}
                          <span className="lab2-num">{up ? '+' : ''}{d.impact.toFixed(2)}%</span>
                        </strong>
                      </div>
                      <div className="lab2-meter">
                        <motion.div
                          className="lab2-meter-fill"
                          style={{ background: up ? 'linear-gradient(90deg, var(--up), #5ff0bb)' : 'linear-gradient(90deg, var(--down), #ff8fa8)' }}
                          initial={still ? false : { width: 0 }}
                          animate={{ width: `${w}%` }}
                          transition={{ duration: 0.6, ease: LAB_EASE }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ResultCard>
          </motion.div>
        )}
      </AnimatePresence>

      <AICoach
        tone={!result ? 'neutral' : result.totalImpact < -15 ? 'warn' : result.totalImpact < 0 ? 'neutral' : 'good'}
        message={
          result && result.totalImpact < -15
            ? t('lab2.whatif.coachPanic')
            : result && result.totalImpact < 0
            ? t('lab2.whatif.coachDown')
            : t('lab2.whatif.coachNeutral')
        }
      />

      {history.length > 0 && (
        <Panel title={t('lab2.whatif.pastScenarios')} icon="clock" accent="violet">
          {history.slice(0, 5).map((h) => (
            <div key={h.id} className="lab2-row">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <LabIcon name="puzzle" width={14} height={14} />
                {t('lab2.whatif.shocksCount', { n: h.shocks.length })}
              </span>
              <strong className={h.impact > 0 ? 'pos' : h.impact < 0 ? 'neg' : ''}>
                <span className="lab2-num">{h.impact > 0 ? '+' : ''}{h.impact.toFixed(1)}%</span>
              </strong>
            </div>
          ))}
        </Panel>
      )}

      <Notice variant="tip" icon="target">
        {t('lab2.whatif.notice')}
      </Notice>
    </div>
  );
}
