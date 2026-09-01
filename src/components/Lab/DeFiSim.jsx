/**
 * DeFi Lab — interactive simulator for the most common DeFi primitives:
 * lending, borrowing, LP (with impermanent loss), farming, staking.
 *
 * Why each as a tab: each one has its own math and its own mental model.
 * A user coming to "LP" should not have to scroll past "Lending" controls
 * to find what they came for.
 *
 * ─── IMPERMANENT LOSS ─────────────────────────────────────────────────────
 * The LP tab shows IL for a 50/50 pool as the relative price of the two
 * assets diverges. The classic formula:
 *   IL = 2 * sqrt(k) / (1 + k) - 1  where k = 1 + priceChange
 * A +50% move costs ~2% IL; +100% costs ~5.7%. The screen prints this so
 * the user sees the trade-off between fees earned and divergence suffered.
 */

import { useMemo, useState } from 'react';
import { LabBack, AICoach, Panel, Row, Notice, ResultCard } from './Shared';
import { calcLendingEarnings, calcLpImpermanentLoss, calcLpNetReturn } from '../../lib/lab/engine';
import { useLabStore } from '../../store/useLabStore';
import { useTelegram } from '../../context/TelegramContext';

const TABS = [
  { id: 'lend', label: '💵 Lend' },
  { id: 'borrow', label: '💳 Borrow' },
  { id: 'lp', label: '💧 LP' },
  { id: 'farm', label: '🌾 Farm' },
  { id: 'stake', label: '🔒 Stake' }
];

export default function DeFiSim({ onBack }) {
  const { haptic } = useTelegram();
  const balance = useLabStore((s) => s.balance);
  const runDefi = useLabStore((s) => s.runDefi);
  const history = useLabStore((s) => s.defi);

  const [tab, setTab] = useState('lend');

  return (
    <div className="lab2-screen">
      <LabBack onBack={onBack} title="🏦 DeFi Lab" sub="Lend, borrow, LP, farm, stake. All with virtual money." />

      <Panel title="Choose primitive">
        <div className="lab2-defi-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`lab2-defi-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
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
        <Panel title="Your DeFi history">
          {history.slice(0, 5).map((h) => (
            <div key={h.id} className="lab2-row">
              <span>{h.kind} · ${h.principal}</span>
              <strong className={h.result >= 0 ? 'pos' : 'neg'}>
                {h.result >= 0 ? '+' : ''}${h.result.toFixed(2)}
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
  const [principal, setPrincipal] = useState(1000);
  const [apy, setApy] = useState(8);
  const [days, setDays] = useState(180);
  const result = useMemo(() => calcLendingEarnings(principal, apy, days), [principal, apy, days]);
  const run = () => { onRun({ kind: 'lend', principal, apy, days, result }); haptic?.('success'); };

  return (
    <Panel title="Supply USDC, earn APY">
      <InputRow label="Amount" value={principal} onChange={setPrincipal} prefix="$" />
      <SliderRow label="APY" value={apy} onChange={setApy} min={0.1} max={30} step={0.1} suffix="%" display={apy.toFixed(1)} />
      <SliderRow label="Duration" value={days} onChange={setDays} min={7} max={730} step={1} display={`${days}d`} />
      <ResultCard kind="win" emoji="💵" title={`+$${result.toFixed(2)}`} sub={`${apy.toFixed(1)}% APY for ${days} days`} />
      <button className="lab2-btn primary full" onClick={run}>Supply virtual</button>
    </Panel>
  );
}

/* ─── Borrow: collateral, LTV, liquidation price ─────────────────────────── */

function BorrowPanel({ balance, onRun, haptic }) {
  const [collateral, setCollateral] = useState(10000);
  const [ltv, setLtv] = useState(60);
  const [liqThreshold, setLiqThreshold] = useState(80);
  const ethPrice = 3000;
  const debt = (collateral * ltv) / 100;
  const liqPrice = (debt * 100) / collateral; // simplified: ETH price that hits liq threshold
  const collateralRatio = (collateral / debt) * 100;

  const run = () => {
    onRun({ kind: 'borrow', principal: debt, ltv, liqThreshold, result: 0 });
    haptic?.('success');
  };

  return (
    <Panel title="Borrow against collateral">
      <InputRow label="Collateral (USD)" value={collateral} onChange={setCollateral} prefix="$" />
      <SliderRow label="Loan-to-Value" value={ltv} onChange={setLtv} min={10} max={85} step={1} suffix="%" display={String(ltv)} />
      <SliderRow label="Liquidation threshold" value={liqThreshold} onChange={setLiqThreshold} min={50} max={95} step={1} suffix="%" display={String(liqThreshold)} />
      <Row label="You can borrow" value={`$${debt.toFixed(2)}`} valueClass="pos" />
      <Row label="Liquidation price" value={`$${liqPrice.toFixed(2)}`} valueClass="neg" />
      <Row label="Current collateral ratio" value={`${collateralRatio.toFixed(0)}%`} />
      <button className="lab2-btn primary full" onClick={run}>Open virtual position</button>
    </Panel>
  );
}

/* ─── LP: impermanent loss demo ──────────────────────────────────────────── */

function LpPanel({ balance, onRun, haptic }) {
  const [principal, setPrincipal] = useState(10000);
  const [apy, setApy] = useState(24);
  const [days, setDays] = useState(365);
  const [priceChange, setPriceChange] = useState(50);
  const il = useMemo(() => calcLpImpermanentLoss(priceChange), [priceChange]);
  const earnings = useMemo(() => calcLendingEarnings(principal, apy, days), [principal, apy, days]);
  const net = useMemo(() => calcLpNetReturn(principal, apy, days, priceChange), [principal, apy, days, priceChange]);
  const run = () => { onRun({ kind: 'lp', principal, apy, days, priceChange, result: net }); haptic?.('success'); };

  return (
    <Panel title="Add liquidity to ETH/USDC">
      <InputRow label="Deposit" value={principal} onChange={setPrincipal} prefix="$" />
      <SliderRow label="Pool APR" value={apy} onChange={setApy} min={1} max={100} step={1} suffix="%" display={String(apy)} />
      <SliderRow label="Duration" value={days} onChange={setDays} min={7} max={730} step={1} display={`${days}d`} />
      <SliderRow label="Price change of ETH" value={priceChange} onChange={setPriceChange} min={-90} max={300} step={5} display={`${priceChange > 0 ? '+' : ''}${priceChange}%`} />
      <Row label="Impermanent loss" value={`${il.toFixed(2)}%`} valueClass="neg" />
      <Row label="Fees earned" value={`+$${earnings.toFixed(2)}`} valueClass="pos" />
      <Row label="Net return" value={`${net >= 0 ? '+' : ''}$${net.toFixed(2)}`} valueClass={net >= 0 ? 'pos' : 'neg'} />
      <button className="lab2-btn primary full" onClick={run}>Add virtual liquidity</button>
    </Panel>
  );
}

/* ─── Farm: deposit LP token, earn extra rewards ─────────────────────────── */

function FarmPanel({ balance, onRun, haptic }) {
  const [principal, setPrincipal] = useState(5000);
  const [baseApy, setBaseApy] = useState(15);
  const [rewardApy, setRewardApy] = useState(20);
  const [days, setDays] = useState(90);
  const totalApy = baseApy + rewardApy;
  const result = useMemo(() => calcLendingEarnings(principal, totalApy, days), [principal, totalApy, days]);
  const run = () => { onRun({ kind: 'farm', principal, totalApy, days, result }); haptic?.('success'); };

  return (
    <Panel title="Farm — stake LP, earn extra">
      <InputRow label="LP token value" value={principal} onChange={setPrincipal} prefix="$" />
      <SliderRow label="Base APR" value={baseApy} onChange={setBaseApy} min={0} max={50} step={1} suffix="%" display={String(baseApy)} />
      <SliderRow label="Reward APR (extra token)" value={rewardApy} onChange={setRewardApy} min={0} max={100} step={1} suffix="%" display={String(rewardApy)} />
      <SliderRow label="Duration" value={days} onChange={setDays} min={7} max={365} step={1} display={`${days}d`} />
      <Row label="Total APR" value={`${totalApy}%`} valueClass="pos" />
      <ResultCard kind="win" emoji="🌾" title={`+$${result.toFixed(2)}`} sub={`After ${days} days`} />
      <button className="lab2-btn primary full" onClick={run}>Start virtual farm</button>
    </Panel>
  );
}

/* ─── Stake: simple lock-up ───────────────────────────────────────────────── */

function StakePanel({ balance, onRun, haptic }) {
  const [principal, setPrincipal] = useState(2000);
  const [apy, setApy] = useState(7);
  const [days, setDays] = useState(180);
  const result = useMemo(() => calcLendingEarnings(principal, apy, days), [principal, apy, days]);
  const run = () => { onRun({ kind: 'stake', principal, apy, days, result }); haptic?.('success'); };

  return (
    <Panel title="Stake — lock and earn">
      <InputRow label="Stake amount" value={principal} onChange={setPrincipal} prefix="$" />
      <SliderRow label="APY" value={apy} onChange={setApy} min={1} max={20} step={0.5} suffix="%" display={apy.toFixed(1)} />
      <SliderRow label="Lock duration" value={days} onChange={setDays} min={7} max={730} step={1} display={`${days}d`} />
      <ResultCard kind="win" emoji="🔒" title={`+$${result.toFixed(2)}`} sub={`After ${days} days`} />
      <button className="lab2-btn primary full" onClick={run}>Stake virtual</button>
    </Panel>
  );
}

/* ─── shared bits ─────────────────────────────────────────────────────────── */

function InputRow({ label, value, onChange, prefix }) {
  return (
    <div>
      <div className="lab2-input-label">{label}</div>
      <input
        className="lab2-input"
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
