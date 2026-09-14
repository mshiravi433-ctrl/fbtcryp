/**
 * Compare Portfolios — Portfolio A vs Portfolio B.
 *
 * VISUAL PASS: the two editors were duplicated markup with different state
 * setters; they are now one `PortfolioEditor` rendered twice with a different
 * accent, each with a donut that rebuilds as you drag. The verdict gives the
 * winner a crown and a lit rim, so the answer is visible without reading a
 * single digit.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AICoach,
  Donut,
  LAB_EASE,
  LabBack,
  LabChips,
  Legend,
  Notice,
  Panel,
  Sparkline
} from './Shared';
import { IconCrown, LabIcon } from './LabIcons';
import { comparePortfolios } from '../../lib/lab/engine';
import { useTelegram } from '../../context/TelegramContext';
import { useStill } from '../AnimatedIcon';

const HORIZONS = [
  { key: '1m', days: 30, icon: 'clock' },
  { key: '3m', days: 90, icon: 'hourglass' },
  { key: '1y', days: 365, icon: 'layers' }
];

const PRESET_A = { BTC: 100 };
const PRESET_B = { BTC: 50, ETH: 30, USDC: 20 };
const PRESET_C = { BTC: 30, ETH: 30, USDC: 20, GOLD: 10, STOCKS: 10 };

const ALL_ASSETS = ['BTC', 'ETH', 'USDC', 'GOLD', 'STOCKS'];

const ASSET_COLOR = {
  BTC: '#f7931a',
  ETH: '#627eea',
  USDC: '#2775ca',
  GOLD: '#d4af37',
  STOCKS: '#00ff9d'
};

export default function ComparePortfolios({ onBack }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const still = useStill();
  const [horizon, setHorizon] = useState(HORIZONS[2]);
  const [a, setA] = useState(PRESET_A);
  const [b, setB] = useState(PRESET_B);
  const [result, setResult] = useState(null);

  const totalA = Object.values(a).reduce((s, v) => s + v, 0);
  const totalB = Object.values(b).reduce((s, v) => s + v, 0);

  const run = () => {
    haptic?.('success');
    setResult(comparePortfolios(a, b, horizon.days, 7));
  };

  const horizonChips = HORIZONS.map((h) => ({
    id: h.key,
    label: t(`lab2.compare.horizons.${h.key}`),
    icon: h.icon
  }));

  const aWins = result && result.a.returnPct > result.b.returnPct;
  const bWins = result && result.b.returnPct > result.a.returnPct;

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        icon="scale"
        accent="cyan"
        title={t('lab2.screens.compare.title')}
        sub={t('lab2.screens.compare.sub')}
      />

      <Panel title={t('lab2.compare.horizon')} icon="clock" accent="amber">
        <LabChips
          items={horizonChips}
          value={horizon.key}
          layoutId="compare-horizon"
          accent="amber"
          onChange={(id) => setHorizon(HORIZONS.find((h) => h.key === id) ?? HORIZONS[0])}
        />
      </Panel>

      <PortfolioEditor
        title={t('lab2.compare.portfolioA')}
        accent="cyan"
        side="a"
        alloc={a}
        onAlloc={setA}
      />

      <PortfolioEditor
        title={t('lab2.compare.portfolioB')}
        accent="magenta"
        side="b"
        alloc={b}
        onAlloc={setB}
      />

      <button
        className="lab2-btn primary full"
        type="button"
        onClick={run}
        disabled={totalA === 0 || totalB === 0}
      >
        <LabIcon name="scale" width={16} height={16} />
        {t('lab2.compare.compare')}
      </button>

      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={`compare-${result.a.returnPct}-${result.b.returnPct}`}
            className="lab2-stack"
            initial={still ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={still ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.42, ease: LAB_EASE }}
          >
            <div className="lab2-compare">
              <Side
                label={t('lab2.compare.portfolioA')}
                data={result.a}
                winner={aWins}
                drawdownFinal={t('lab2.compare.drawdownFinal', { dd: result.a.drawdown, final: result.a.final.toLocaleString() })}
              />
              <Side
                label={t('lab2.compare.portfolioB')}
                data={result.b}
                winner={bWins}
                drawdownFinal={t('lab2.compare.drawdownFinal', { dd: result.b.drawdown, final: result.b.final.toLocaleString() })}
              />
            </div>

            <Panel title={t('lab2.compare.equityCurves')} icon="activity" accent="violet">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="lab2-stack" style={{ gap: 5 }}>
                  <span className="lab2-curve-tag a">A</span>
                  <Sparkline data={result.series.map((s) => s.price * (1 + result.a.returnPct / 100))} compact />
                </div>
                <div className="lab2-stack" style={{ gap: 5 }}>
                  <span className="lab2-curve-tag b">B</span>
                  <Sparkline data={result.series.map((s) => s.price * (1 + result.b.returnPct / 100))} compact />
                </div>
              </div>
            </Panel>

            <AICoach
              tone={aWins || bWins ? 'good' : 'neutral'}
              message={
                aWins
                  ? t('lab2.compare.coachA')
                  : bWins
                  ? t('lab2.compare.coachB')
                  : t('lab2.compare.coachTie')
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      <Notice variant="info" icon="brain">
        {t('lab2.compare.notice')}
      </Notice>
    </div>
  );
}

/** One side of the verdict. */
function Side({ label, data, winner, drawdownFinal }) {
  const up = data.returnPct >= 0;
  return (
    <div className={`lab2-compare-side ${winner ? 'winner' : ''}`}>
      {winner && (
        <motion.span
          className="lab2-compare-crown"
          initial={{ opacity: 0, scale: 0.4, rotate: -25 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 16, delay: 0.15 }}
        >
          <IconCrown width={19} height={19} />
        </motion.span>
      )}
      <div className="lab2-compare-title">{label}</div>
      <div className="lab2-compare-value lab2-num" style={{ color: up ? 'var(--up)' : 'var(--down)' }}>
        {up ? '+' : ''}{data.returnPct}%
      </div>
      <div className="lab2-compare-note lab2-num">{drawdownFinal}</div>
    </div>
  );
}

/** Allocation editor: presets, donut, sliders, total. */
function PortfolioEditor({ title, accent, side, alloc, onAlloc }) {
  const { t } = useTranslation();
  const total = Object.values(alloc).reduce((s, v) => s + v, 0);

  const update = (key, val) => {
    onAlloc({ ...alloc, [key]: Math.max(0, Math.min(100, Number(val) || 0)) });
  };

  const slices = ALL_ASSETS.filter((c) => (alloc[c] || 0) > 0).map((c) => ({
    label: t(`lab2.assets.${c}`),
    value: alloc[c] || 0,
    color: ASSET_COLOR[c] ?? 'var(--acc)'
  }));

  const presets = [
    { id: 'btc', label: t('lab2.compare.presetBtc'), next: PRESET_A, icon: 'coins' },
    { id: 'mix', label: t('lab2.compare.presetMix'), next: PRESET_B, icon: 'pie' },
    { id: 'div', label: t('lab2.compare.presetDiversified'), next: PRESET_C, icon: 'layers' }
  ];

  return (
    <Panel title={title} icon={side === 'a' ? 'wallet' : 'pie'} accent={accent}>
      <LabChips items={presets} layoutId={`compare-presets-${side}`} accent={accent} onChange={(id, it) => onAlloc(it.next)} />

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Donut slices={slices} centerValue={`${total}%`} centerLabel={t('lab2.compare.total')} />
        <Legend items={slices.map((s) => ({ label: s.label, value: `${s.value}%`, color: s.color }))} />
      </div>

      {ALL_ASSETS.map((coin) => {
        const pct = alloc[coin] || 0;
        return (
          <div key={coin} className="lab2-alloc" style={{ '--acc': ASSET_COLOR[coin], '--acc-2': ASSET_COLOR[coin] }}>
            <div
              className="lab2-alloc-icon"
              style={{ background: `linear-gradient(140deg, ${ASSET_COLOR[coin]}, ${ASSET_COLOR[coin]}bb)`, color: '#06121a' }}
            >
              {coin.slice(0, 2)}
            </div>
            <div className="lab2-alloc-name">{t(`lab2.assets.${coin}`)}</div>
            <input
              type="range"
              min="0"
              max="100"
              value={pct}
              onChange={(e) => update(coin, e.target.value)}
              className="lab2-slider"
              style={{ '--fill': `${pct}%` }}
              aria-label={t(`lab2.assets.${coin}`)}
            />
            <div className="lab2-alloc-pct lab2-num">{pct.toFixed(0)}%</div>
          </div>
        );
      })}

      <div className="lab2-row">
        <span>{t('lab2.compare.total')}</span>
        <strong style={{ color: total === 100 ? 'var(--up)' : 'var(--rgb-5)' }} className="lab2-num">{total}%</strong>
      </div>
    </Panel>
  );
}
