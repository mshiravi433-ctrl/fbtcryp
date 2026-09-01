/**
 * DeFi Lab — interactive simulator for the most common DeFi primitives:
 * lending, borrowing, LP (with impermanent loss), farming, staking.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LabBack, Panel, Row, ResultCard } from './Shared';
import { calcLendingEarnings, calcLpImpermanentLoss, calcLpNetReturn } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const TABS = [
  { id: 'lend', emoji: '💵' },
  { id: 'borrow', emoji: '💳' },
  { id: 'lp', emoji: '💧' },
  { id: 'farm', emoji: '🌾' },
  { id: 'stake', emoji: '🔒' }
];

export default function DeFiSim({ onBack }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const balance = useLabStore((s) => s.balance);
  const runDefi = useLabStore((s) => s.runDefi);
  const history = useLabStore((s) => s.defi);

  const [tab, setTab] = useState('lend');

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title={`🏦 ${t('lab2.screens.defi.title')}`} sub={t('lab2.screens.defi.sub')} />

      <Panel title={t('lab2.defi.choosePrimitive')}>
        <div className="lab2-defi-tabs">
          {TABS.map((tb) => (
            <button
              key={tb.id}
              className={`lab2-defi-tab ${tab === tb.id ? 'active' : ''}`}
              onClick={() => setTab(tb.id)}
            >
              {tb.emoji} {t(`lab2.defi.${tb.id}`)}
            </button>
          ))}
        </div>
      </Panel>

      {tab === 'lend' && <LendPanel balance={balance} onRun={runDefi} haptic={haptic} />}
      {tab === 'borrow' && <BorrowPanel balance={balance} onRun={runDefi} haptic={haptic} />}
      {tab === 'lp' && <LpPanel balance={balance} onRun={runDefi} haptic={haptic} />}
      {tab === 'farm' && <FarmPanel balance={balance} onRun={runDefi} haptic={haptic} />}
      {tab === 'stake' && <StakePanel balance={balance} onRun={runDefi} haptic={haptic} />}

      {history.length > 0 && (
        <Panel title={t('lab2.defi.yourHistory')}>
          {history.slice(0, 5).map((h) => (
            <div key={h.id} className="lab2-row">
              <span>{t(`lab2.defi.${h.kind}`)} · <span className="lab2-num">${h.principal}</span></span>
              <strong className={h.result >= 0 ? 'pos' : 'neg'}>
                <span className="lab2-num">{h.result >= 0 ? '+' : ''}${h.result.toFixed(2)}</span>
              </strong>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}

/* ─── Lend: supply USDC, earn APY ─────────────────────────────────────────── */

function LendPanel({ balance, onRun, haptic }) {
  const { t } = useTranslation();
  const [principal, setPrincipal] = useState(1000);
  const [apy, setApy] = useState(8);
  const [days, setDays] = useState(180);
  const result = useMemo(() => calcLendingEarnings(principal, apy, days), [principal, apy, days]);
  const run = () => { onRun({ kind: 'lend', principal, apy, days, result }); haptic?.('success'); };

  return (
    <Panel title={t('lab2.defi.supplyUsdc')}>
      <InputRow label={t('lab2.defi.amount')} value={principal} onChange={setPrincipal} prefix="$" />
      <SliderRow label={t('lab2.defi.apy')} value={apy} onChange={setApy} min={0.1} max={30} step={0.1} suffix="%" display={apy.toFixed(1)} />
      <SliderRow label={t('lab2.defi.duration')} value={days} onChange={setDays} min={7} max={730} step={1} display={t('lab2.defi.days', { n: days })} />
      <ResultCard kind="win" emoji="💵" title={<span className="lab2-num">+${result.toFixed(2)}</span>} sub={<span className="lab2-num">{t('lab2.defi.apyForDays', { apy: apy.toFixed(1), days })}</span>} />
      <button className="lab2-btn primary full" onClick={run}>{t('lab2.defi.supplyVirtual')}</button>
    </Panel>
  );
}

/* ─── Borrow: collateral, LTV, liquidation price ─────────────────────────── */

function BorrowPanel({ balance, onRun, haptic }) {
  const { t } = useTranslation();
  const [collateral, setCollateral] = useState(10000);
  const [ltv, setLtv] = useState(60);
  const [liqThreshold, setLiqThreshold] = useState(80);
  const debt = (collateral * ltv) / 100;
  const liqPrice = (debt * 100) / collateral; // simplified
  const collateralRatio = (collateral / debt) * 100;

  const run = () => {
    onRun({ kind: 'borrow', principal: debt, ltv, liqThreshold, result: 0 });
    haptic?.('success');
  };

  return (
    <Panel title={t('lab2.defi.borrowAgainst')}>
      <InputRow label={t('lab2.defi.collateral')} value={collateral} onChange={setCollateral} prefix="$" />
      <SliderRow label={t('lab2.defi.ltv')} value={ltv} onChange={setLtv} min={10} max={85} step={1} suffix="%" display={String(ltv)} />
      <SliderRow label={t('lab2.defi.liqThreshold')} value={liqThreshold} onChange={setLiqThreshold} min={50} max={95} step={1} suffix="%" display={String(liqThreshold)} />
      <Row label={t('lab2.defi.youCanBorrow')} value={<span className="lab2-num">${debt.toFixed(2)}</span>} valueClass="pos" />
      <Row label={t('lab2.defi.liqPrice')} value={<span className="lab2-num">${liqPrice.toFixed(2)}</span>} valueClass="neg" />
      <Row label={t('lab2.defi.collateralRatio')} value={<span className="lab2-num">{collateralRatio.toFixed(0)}%</span>} />
      <button className="lab2-btn primary full" onClick={run}>{t('lab2.defi.openVirtualPosition')}</button>
    </Panel>
  );
}

/* ─── LP: impermanent loss demo ──────────────────────────────────────────── */

function LpPanel({ balance, onRun, haptic }) {
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
    <Panel title={t('lab2.defi.addLiquidity')}>
      <InputRow label={t('lab2.defi.deposit')} value={principal} onChange={setPrincipal} prefix="$" />
      <SliderRow label={t('lab2.defi.poolApr')} value={apy} onChange={setApy} min={1} max={100} step={1} suffix="%" display={String(apy)} />
      <SliderRow label={t('lab2.defi.duration')} value={days} onChange={setDays} min={7} max={730} step={1} display={t('lab2.defi.days', { n: days })} />
      <SliderRow label={t('lab2.defi.priceChangeEth')} value={priceChange} onChange={setPriceChange} min={-90} max={300} step={5} display={<span className="lab2-num">{priceChange > 0 ? '+' : ''}{priceChange}%</span>} />
      <Row label={t('lab2.defi.impermanentLoss')} value={<span className="lab2-num">{il.toFixed(2)}%</span>} valueClass="neg" />
      <Row label={t('lab2.defi.feesEarned')} value={<span className="lab2-num">+${earnings.toFixed(2)}</span>} valueClass="pos" />
      <Row label={t('lab2.defi.netReturn')} value={<span className="lab2-num">{net >= 0 ? '+' : ''}${net.toFixed(2)}</span>} valueClass={net >= 0 ? 'pos' : 'neg'} />
      <button className="lab2-btn primary full" onClick={run}>{t('lab2.defi.addVirtualLiquidity')}</button>
    </Panel>
  );
}

/* ─── Farm: deposit LP token, earn extra rewards ─────────────────────────── */

function FarmPanel({ balance, onRun, haptic }) {
  const { t } = useTranslation();
  const [principal, setPrincipal] = useState(5000);
  const [baseApy, setBaseApy] = useState(15);
  const [rewardApy, setRewardApy] = useState(20);
  const [days, setDays] = useState(90);
  const totalApy = baseApy + rewardApy;
  const result = useMemo(() => calcLendingEarnings(principal, totalApy, days), [principal, totalApy, days]);
  const run = () => { onRun({ kind: 'farm', principal, totalApy, days, result }); haptic?.('success'); };

  return (
    <Panel title={t('lab2.defi.farmTitle')}>
      <InputRow label={t('lab2.defi.lpTokenValue')} value={principal} onChange={setPrincipal} prefix="$" />
      <SliderRow label={t('lab2.defi.baseApr')} value={baseApy} onChange={setBaseApy} min={0} max={50} step={1} suffix="%" display={String(baseApy)} />
      <SliderRow label={t('lab2.defi.rewardApr')} value={rewardApy} onChange={setRewardApy} min={0} max={100} step={1} suffix="%" display={String(rewardApy)} />
      <SliderRow label={t('lab2.defi.duration')} value={days} onChange={setDays} min={7} max={365} step={1} display={t('lab2.defi.days', { n: days })} />
      <Row label={t('lab2.defi.totalApr')} value={<span className="lab2-num">{totalApy}%</span>} valueClass="pos" />
      <ResultCard kind="win" emoji="🌾" title={<span className="lab2-num">+${result.toFixed(2)}</span>} sub={t('lab2.defi.afterDays', { days })} />
      <button className="lab2-btn primary full" onClick={run}>{t('lab2.defi.startVirtualFarm')}</button>
    </Panel>
  );
}

/* ─── Stake: simple lock-up ───────────────────────────────────────────────── */

function StakePanel({ balance, onRun, haptic }) {
  const { t } = useTranslation();
  const [principal, setPrincipal] = useState(2000);
  const [apy, setApy] = useState(7);
  const [days, setDays] = useState(180);
  const result = useMemo(() => calcLendingEarnings(principal, apy, days), [principal, apy, days]);
  const run = () => { onRun({ kind: 'stake', principal, apy, days, result }); haptic?.('success'); };

  return (
    <Panel title={t('lab2.defi.stakeTitle')}>
      <InputRow label={t('lab2.defi.stakeAmount')} value={principal} onChange={setPrincipal} prefix="$" />
      <SliderRow label={t('lab2.defi.apy')} value={apy} onChange={setApy} min={1} max={20} step={0.5} suffix="%" display={apy.toFixed(1)} />
      <SliderRow label={t('lab2.defi.lockDuration')} value={days} onChange={setDays} min={7} max={730} step={1} display={t('lab2.defi.days', { n: days })} />
      <ResultCard kind="win" emoji="🔒" title={<span className="lab2-num">+${result.toFixed(2)}</span>} sub={t('lab2.defi.afterDays', { days })} />
      <button className="lab2-btn primary full" onClick={run}>{t('lab2.defi.stakeVirtual')}</button>
    </Panel>
  );
}

/* ─── shared bits ─────────────────────────────────────────────────────────── */

function InputRow({ label, value, onChange, prefix }) {
  return (
    <div>
      <div className="lab2-input-label">{label}</div>
      <input
        className="lab2-input lab2-num"
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}

function SliderRow({ label, value, onChange, min, max, step, display, suffix = '' }) {
  return (
    <div>
      <div className="lab2-row" style={{ paddingTop: 0, border: 'none' }}>
        <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{label}</span>
        <strong style={{ color: 'var(--text-1)' }}>{display}{suffix}</strong>
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
