/**
 * DeFi Lab — interactive simulator for the most common DeFi primitives:
 * lending, borrowing, LP (with impermanent loss), farming, staking.
 *
 * VISUAL PASS: the primitive picker is a sliding-pill chip strip with one SVG
 * per primitive (banknote / card / droplet / sprout / lock), and every panel
 * uses `LabSlider` so the APY, LTV and duration tracks show how far they are
 * along their own range — which is the whole point of a simulator.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { LAB_EASE, LabBack, LabChips, LabSlider, Panel, ResultCard, Row } from './Shared';
import { LabIcon } from './LabIcons';
import { calcLendingEarnings, calcLpImpermanentLoss, calcLpNetReturn } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';
import { useStill } from '../AnimatedIcon';

const TABS = [
  { id: 'lend', icon: 'banknote', accent: 'mint' },
  { id: 'borrow', icon: 'card', accent: 'rose' },
  { id: 'lp', icon: 'droplet', accent: 'cyan' },
  { id: 'farm', icon: 'sprout', accent: 'amber' },
  { id: 'stake', icon: 'lock', accent: 'violet' }
];

export default function DeFiSim({ onBack }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const still = useStill();
  const balance = useLabStore((s) => s.balance);
  const runDefi = useLabStore((s) => s.runDefi);
  const history = useLabStore((s) => s.defi);

  const [tab, setTab] = useState('lend');
  const active = TABS.find((x) => x.id === tab) ?? TABS[0];

  const chips = TABS.map((tb) => ({
    id: tb.id,
    label: t(`lab2.defi.${tb.id}`),
    icon: tb.icon
  }));

  const panels = {
    lend: <LendPanel onRun={runDefi} haptic={haptic} />,
    borrow: <BorrowPanel onRun={runDefi} haptic={haptic} />,
    lp: <LpPanel onRun={runDefi} haptic={haptic} />,
    farm: <FarmPanel onRun={runDefi} haptic={haptic} />,
    stake: <StakePanel onRun={runDefi} haptic={haptic} />
  };

  return (
    <div className="lab2-screen">
      <LabBack
        onBack={onBack}
        icon="bank"
        accent="mint"
        title={t('lab2.screens.defi.title')}
        sub={t('lab2.screens.defi.sub')}
      />

      <Panel title={t('lab2.defi.choosePrimitive')} icon="layers" accent={active.accent}>
        <LabChips
          items={chips}
          value={tab}
          layoutId="defi-primitive"
          accent={active.accent}
          onChange={setTab}
        />
      </Panel>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={still ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={still ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: LAB_EASE }}
        >
          {panels[tab]}
        </motion.div>
      </AnimatePresence>

      {history.length > 0 && (
        <Panel title={t('lab2.defi.yourHistory')} icon="clock" accent="cyan">
          {history.slice(0, 5).map((h) => {
            const meta = TABS.find((x) => x.id === h.kind);
            return (
              <div key={h.id} className="lab2-row">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <LabIcon name={meta?.icon ?? 'bank'} width={14} height={14} />
                  {t(`lab2.defi.${h.kind}`)} · <span className="lab2-num">${h.principal}</span>
                </span>
                <strong className={h.result >= 0 ? 'pos' : 'neg'}>
                  <span className="lab2-num">{h.result >= 0 ? '+' : ''}${h.result.toFixed(2)}</span>
                </strong>
              </div>
            );
          })}
        </Panel>
      )}
    </div>
  );
}

/* ─── Lend: supply USDC, earn APY ─────────────────────────────────────────── */

function LendPanel({ onRun, haptic }) {
  const { t } = useTranslation();
  const [principal, setPrincipal] = useState(1000);
  const [apy, setApy] = useState(8);
  const [days, setDays] = useState(180);
  const result = useMemo(() => calcLendingEarnings(principal, apy, days), [principal, apy, days]);
  const run = () => { onRun({ kind: 'lend', principal, apy, days, result }); haptic?.('success'); };

  return (
    <Panel title={t('lab2.defi.supplyUsdc')} icon="banknote" accent="mint">
      <InputRow label={t('lab2.defi.amount')} value={principal} onChange={setPrincipal} />
      <SliderRow label={t('lab2.defi.apy')} value={apy} onChange={setApy} min={0.1} max={30} step={0.1} accent="mint" display={<span className="lab2-num">{apy.toFixed(1)}%</span>} />
      <SliderRow label={t('lab2.defi.duration')} value={days} onChange={setDays} min={7} max={730} step={1} accent="cyan" display={<span className="lab2-num">{t('lab2.defi.days', { n: days })}</span>} />
      <ResultCard
        kind="win"
        icon="banknote"
        figure={`+$${result.toFixed(2)}`}
        sub={<span className="lab2-num">{t('lab2.defi.apyForDays', { apy: apy.toFixed(1), days })}</span>}
      />
      <button className="lab2-btn primary full" type="button" onClick={run}>
        <LabIcon name="play" width={15} height={15} />
        {t('lab2.defi.supplyVirtual')}
      </button>
    </Panel>
  );
}

/* ─── Borrow: collateral, LTV, liquidation price ─────────────────────────── */

function BorrowPanel({ onRun, haptic }) {
  const { t } = useTranslation();
  const [collateral, setCollateral] = useState(10000);
  const [ltv, setLtv] = useState(60);
  const [liqThreshold, setLiqThreshold] = useState(80);
  const debt = (collateral * ltv) / 100;
  const liqPrice = (debt * 100) / collateral; // simplified
  const collateralRatio = (collateral / debt) * 100;
  const health = Math.max(0, Math.min(100, ((liqThreshold - ltv) / liqThreshold) * 100));

  const run = () => {
    onRun({ kind: 'borrow', principal: debt, ltv, liqThreshold, result: 0 });
    haptic?.('success');
  };

  return (
    <Panel title={t('lab2.defi.borrowAgainst')} icon="card" accent="rose">
      <InputRow label={t('lab2.defi.collateral')} value={collateral} onChange={setCollateral} />
      <SliderRow label={t('lab2.defi.ltv')} value={ltv} onChange={setLtv} min={10} max={85} step={1} accent={ltv > 75 ? 'rose' : 'amber'} display={<span className="lab2-num">{ltv}%</span>} />
      <SliderRow label={t('lab2.defi.liqThreshold')} value={liqThreshold} onChange={setLiqThreshold} min={50} max={95} step={1} accent="rose" display={<span className="lab2-num">{liqThreshold}%</span>} />
      <Row label={t('lab2.defi.youCanBorrow')} value={<span className="lab2-num">${debt.toFixed(2)}</span>} valueClass="pos" />
      <Row label={t('lab2.defi.liqPrice')} value={<span className="lab2-num">${liqPrice.toFixed(2)}</span>} valueClass="neg" />
      <Row label={t('lab2.defi.collateralRatio')} value={<span className="lab2-num">{collateralRatio.toFixed(0)}%</span>} />
      {/* Headroom before liquidation — the number that decides whether this
          position survives a red day. */}
      <div className="lab2-stack" style={{ gap: 5 }}>
        <div className={`lab2-shock ${health > 40 ? 'up' : health > 18 ? 'flat' : 'down'}`} style={{ alignSelf: 'flex-start' }}>
          <LabIcon name="gauge" width={12} height={12} />
          <span className="lab2-num">{health.toFixed(0)}%</span>
        </div>
        <div className="lab2-meter">
          <div
            className="lab2-meter-fill"
            style={{
              width: `${health}%`,
              background: health > 40 ? 'linear-gradient(90deg, var(--up), #5ff0bb)' : health > 18 ? 'linear-gradient(90deg, var(--rgb-5), #ffd166)' : 'linear-gradient(90deg, var(--down), #ff8fa8)'
            }}
          />
        </div>
      </div>
      <button className="lab2-btn primary full" type="button" onClick={run}>
        <LabIcon name="play" width={15} height={15} />
        {t('lab2.defi.openVirtualPosition')}
      </button>
    </Panel>
  );
}

/* ─── LP: impermanent loss demo ──────────────────────────────────────────── */

function LpPanel({ onRun, haptic }) {
  const { t } = useTranslation();
  const [principal, setPrincipal] = useState(10000);
  const [apy, setApy] = useState(24);
  const [days, setDays] = useState(365);
  const [priceChange, setPriceChange] = useState(50);
  const il = useMemo(() => calcLpImpermanentLoss(priceChange), [priceChange]);
  const earnings = useMemo(() => calcLendingEarnings(principal, apy, days), [principal, apy, days]);
  const net = useMemo(() => calcLpNetReturn(principal, apy, days, priceChange), [principal, apy, days, priceChange]);
  const run = () => { onRun({ kind: 'lp', principal, apy, days, priceChange, result: net }); haptic?.('success'); };

  return (
    <Panel title={t('lab2.defi.addLiquidity')} icon="droplet" accent="cyan">
      <InputRow label={t('lab2.defi.deposit')} value={principal} onChange={setPrincipal} />
      <SliderRow label={t('lab2.defi.poolApr')} value={apy} onChange={setApy} min={1} max={100} step={1} accent="mint" display={<span className="lab2-num">{apy}%</span>} />
      <SliderRow label={t('lab2.defi.duration')} value={days} onChange={setDays} min={7} max={730} step={1} accent="cyan" display={<span className="lab2-num">{t('lab2.defi.days', { n: days })}</span>} />
      <SliderRow
        label={t('lab2.defi.priceChangeEth')}
        value={priceChange}
        onChange={setPriceChange}
        min={-90}
        max={300}
        step={5}
        accent={priceChange >= 0 ? 'mint' : 'rose'}
        display={<span className="lab2-num">{priceChange > 0 ? '+' : ''}{priceChange}%</span>}
      />
      <Row label={t('lab2.defi.impermanentLoss')} value={<span className="lab2-num">{il.toFixed(2)}%</span>} valueClass="neg" />
      <Row label={t('lab2.defi.feesEarned')} value={<span className="lab2-num">+${earnings.toFixed(2)}</span>} valueClass="pos" />
      <Row
        label={t('lab2.defi.netReturn')}
        value={<span className="lab2-num">{net >= 0 ? '+' : ''}${net.toFixed(2)}</span>}
        valueClass={net >= 0 ? 'pos' : 'neg'}
      />
      <button className="lab2-btn primary full" type="button" onClick={run}>
        <LabIcon name="play" width={15} height={15} />
        {t('lab2.defi.addVirtualLiquidity')}
      </button>
    </Panel>
  );
}

/* ─── Farm: deposit LP token, earn extra rewards ─────────────────────────── */

function FarmPanel({ onRun, haptic }) {
  const { t } = useTranslation();
  const [principal, setPrincipal] = useState(5000);
  const [baseApy, setBaseApy] = useState(15);
  const [rewardApy, setRewardApy] = useState(20);
  const [days, setDays] = useState(90);
  const totalApy = baseApy + rewardApy;
  const result = useMemo(() => calcLendingEarnings(principal, totalApy, days), [principal, totalApy, days]);
  const run = () => { onRun({ kind: 'farm', principal, totalApy, days, result }); haptic?.('success'); };

  return (
    <Panel title={t('lab2.defi.farmTitle')} icon="sprout" accent="amber">
      <InputRow label={t('lab2.defi.lpTokenValue')} value={principal} onChange={setPrincipal} />
      <SliderRow label={t('lab2.defi.baseApr')} value={baseApy} onChange={setBaseApy} min={0} max={50} step={1} accent="mint" display={<span className="lab2-num">{baseApy}%</span>} />
      <SliderRow label={t('lab2.defi.rewardApr')} value={rewardApy} onChange={setRewardApy} min={0} max={100} step={1} accent="amber" display={<span className="lab2-num">{rewardApy}%</span>} />
      <SliderRow label={t('lab2.defi.duration')} value={days} onChange={setDays} min={7} max={365} step={1} accent="cyan" display={<span className="lab2-num">{t('lab2.defi.days', { n: days })}</span>} />
      <Row label={t('lab2.defi.totalApr')} value={<span className="lab2-num">{totalApy}%</span>} valueClass="pos" />
      <ResultCard kind="win" icon="sprout" figure={`+$${result.toFixed(2)}`} sub={t('lab2.defi.afterDays', { days })} />
      <button className="lab2-btn primary full" type="button" onClick={run}>
        <LabIcon name="play" width={15} height={15} />
        {t('lab2.defi.startVirtualFarm')}
      </button>
    </Panel>
  );
}

/* ─── Stake: simple lock-up ──────────────────────────────────────────────── */

function StakePanel({ onRun, haptic }) {
  const { t } = useTranslation();
  const [principal, setPrincipal] = useState(2000);
  const [apy, setApy] = useState(7);
  const [days, setDays] = useState(180);
  const result = useMemo(() => calcLendingEarnings(principal, apy, days), [principal, apy, days]);
  const run = () => { onRun({ kind: 'stake', principal, apy, days, result }); haptic?.('success'); };

  return (
    <Panel title={t('lab2.defi.stakeTitle')} icon="lock" accent="violet">
      <InputRow label={t('lab2.defi.stakeAmount')} value={principal} onChange={setPrincipal} />
      <SliderRow label={t('lab2.defi.apy')} value={apy} onChange={setApy} min={1} max={20} step={0.5} accent="mint" display={<span className="lab2-num">{apy.toFixed(1)}%</span>} />
      <SliderRow label={t('lab2.defi.lockDuration')} value={days} onChange={setDays} min={7} max={730} step={1} accent="violet" display={<span className="lab2-num">{t('lab2.defi.days', { n: days })}</span>} />
      <ResultCard kind="win" icon="lock" figure={`+$${result.toFixed(2)}`} sub={t('lab2.defi.afterDays', { days })} />
      <button className="lab2-btn primary full" type="button" onClick={run}>
        <LabIcon name="play" width={15} height={15} />
        {t('lab2.defi.stakeVirtual')}
      </button>
    </Panel>
  );
}

/* ─── shared bits ─────────────────────────────────────────────────────────── */

function InputRow({ label, value, onChange }) {
  return (
    <div>
      <label className="lab2-input-label">{label}</label>
      <input
        className="lab2-input lab2-num"
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        aria-label={label}
      />
    </div>
  );
}

function SliderRow({ label, value, onChange, min, max, step, display, accent }) {
  return (
    <LabSlider
      label={label}
      value={value}
      onChange={onChange}
      min={min}
      max={max}
      step={step}
      display={display}
      accent={accent}
    />
  );
}
