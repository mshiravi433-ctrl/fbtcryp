import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { HOUSE_EDGE, rollDice } from '../lib/fairness';
import { fmtNum } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import SegIndicator from '../components/SegIndicator';

export default function DiceGame({ fair }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const balance = useAppStore((s) => s.balance);
  const debit = useAppStore((s) => s.debit);
  const credit = useAppStore((s) => s.credit);
  const recordBet = useAppStore((s) => s.recordBet);
  const settleBet = useAppStore((s) => s.settleBet);

  const [bet, setBet] = useState('50');
  const [target, setTarget] = useState(50);
  const [over, setOver] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [last, setLast] = useState(null);
  const [history, setHistory] = useState([]);

  const stake = Number(bet) || 0;
  const winChance = over ? 100 - target : target;
  const payoutX = winChance > 0 ? ((100 - HOUSE_EDGE * 100) / winChance) : 0;
  const profit = stake * payoutX - stake;

  const roll = async () => {
    if (!fair?.session || stake <= 0 || rolling) return;
    if (!debit(stake)) return;

    setRolling(true);
    haptic?.('medium');

    const nonce = fair.nextNonce();
    const value = await rollDice(fair.session.serverSeed, fair.session.clientSeed, nonce);
    const won = over ? value > target : value < target;

    const betId = recordBet({ game: 'dice', stake, target, over });

    // brief spin animation before revealing
    await new Promise((r) => setTimeout(r, 620));

    const payout = won ? stake * payoutX : 0;
    if (won) {
      credit(payout);
      haptic?.('success');
    } else {
      haptic?.('error');
    }
    settleBet(betId, { won, payout, result: { value }, alreadyCredited: true });

    setLast({ value, won, payout });
    setHistory((h) => [{ value, won }, ...h].slice(0, 12));
    setRolling(false);
  };

  return (
    <div className="stack">
      <div className="card card-tight" style={{ display: 'grid', placeItems: 'center', padding: 22 }}>
        <motion.div
          className="dice-face"
          animate={
            rolling
              ? { rotate: [0, 180, 360, 540, 720], scale: [1, 1.14, 0.94, 1.08, 1] }
              : { rotate: 0, scale: 1 }
          }
          transition={rolling ? { duration: 0.62, ease: 'easeInOut' } : { type: 'spring', stiffness: 320, damping: 16 }}
          style={{
            color: last ? (last.won ? 'var(--up)' : 'var(--down)') : 'var(--text-1)',
            boxShadow: last ? `0 0 30px -6px ${last.won ? 'rgba(0,255,157,.7)' : 'rgba(255,59,107,.7)'}` : 'none'
          }}
        >
          {rolling ? '…' : last ? last.value.toFixed(2) : '—'}
        </motion.div>

        {last && !rolling && (
          <motion.div
            className={`pill ${last.won ? 'pill-up' : 'pill-down'}`}
            style={{ marginTop: 12 }}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            {last.won ? `+${fmtNum(last.payout - stake, 2)} NX` : `-${fmtNum(stake, 2)} NX`}
          </motion.div>
        )}
      </div>

      {history.length > 0 && (
        <div className="tag-scroll">
          {history.map((h, i) => (
            <motion.span key={i} className={`pill ${h.won ? 'pill-up' : 'pill-down'}`} initial={{ scale: 0.6 }} animate={{ scale: 1 }}>
              {h.value.toFixed(2)}
            </motion.span>
          ))}
        </div>
      )}

      <div className="segmented">
        {[
          { k: false, label: t('game.dice.under', { n: target }) },
          { k: true, label: t('game.dice.over', { n: target }) }
        ].map((o) => (
          <button
            key={String(o.k)}
            className={over === o.k ? 'active' : ''}
            onClick={() => {
              haptic?.('select');
              setOver(o.k);
            }}
            style={{ isolation: 'isolate' }}
          >
            {over === o.k && (
              <SegIndicator id="dice-ind" />
            )}
            {o.label}
          </button>
        ))}
      </div>

      <div>
        <div className="row-between" style={{ marginBottom: 6 }}>
          <span className="field-label" style={{ margin: 0 }}>{t('game.dice.target')}</span>
          <span className="mono" style={{ fontSize: 13, color: 'var(--rgb-1)' }}>{target.toFixed(0)}</span>
        </div>
        <input
          type="range"
          min="2"
          max="98"
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          disabled={rolling}
          style={{
            width: '100%',
            padding: 0,
            background: 'transparent',
            border: 'none',
            accentColor: '#00e5ff'
          }}
        />
      </div>

      <div className="grid-3">
        <div className="card card-tight">
          <div className="faint">{t('game.dice.chance')}</div>
          <div className="mono" style={{ fontSize: 13 }}>{winChance.toFixed(1)}%</div>
        </div>
        <div className="card card-tight">
          <div className="faint">{t('game.dice.multiplier')}</div>
          <div className="mono" style={{ fontSize: 13, color: 'var(--rgb-1)' }}>{payoutX.toFixed(3)}×</div>
        </div>
        <div className="card card-tight">
          <div className="faint">{t('game.dice.profit')}</div>
          <div className="mono up" style={{ fontSize: 13 }}>+{fmtNum(profit, 2)}</div>
        </div>
      </div>

      <div>
        <label className="field-label">{t('game.stake')}</label>
        <input type="number" value={bet} min="1" onChange={(e) => setBet(e.target.value)} disabled={rolling} />
      </div>

      <div className="row" style={{ gap: 6 }}>
        {[10, 50, 100, 500].map((v) => (
          <button key={v} className="tag" style={{ flex: 1, textAlign: 'center' }} onClick={() => setBet(String(v))} disabled={rolling}>
            {v}
          </button>
        ))}
      </div>

      <button className="btn btn-primary" onClick={roll} disabled={rolling || stake <= 0 || stake > balance}>
        {rolling ? t('game.rolling') : t('game.dice.roll')}
      </button>
    </div>
  );
}
