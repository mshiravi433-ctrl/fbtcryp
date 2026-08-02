import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { HOUSE_EDGE, rollFloat } from '../lib/fairness';
import { fmtNum } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';
import SegIndicator from '../components/SegIndicator';

/** Coin flip. Payout 1.94x on a 50% chance = the same 3% edge as the others. */
const PAYOUT = 2 * (1 - HOUSE_EDGE);

export default function CoinFlipGame({ fair }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const balance = useAppStore((s) => s.balance);
  const debit = useAppStore((s) => s.debit);
  const credit = useAppStore((s) => s.credit);
  const recordBet = useAppStore((s) => s.recordBet);
  const settleBet = useAppStore((s) => s.settleBet);

  const [bet, setBet] = useState('50');
  const [side, setSide] = useState('heads');
  const [flipping, setFlipping] = useState(false);
  const [last, setLast] = useState(null);
  const [history, setHistory] = useState([]);

  const stake = Number(bet) || 0;

  const flip = async () => {
    if (!fair?.session || flipping || stake <= 0) return;
    if (!debit(stake)) return;

    setFlipping(true);
    setLast(null);
    haptic?.('medium');

    const nonce = fair.nextNonce();
    const r = await rollFloat(fair.session.serverSeed, fair.session.clientSeed, nonce);
    const result = r < 0.5 ? 'heads' : 'tails';
    const won = result === side;
    const betId = recordBet({ game: 'coinflip', stake, side });

    await new Promise((res) => setTimeout(res, 1500));

    const payout = won ? stake * PAYOUT : 0;
    if (won) {
      credit(payout);
      haptic?.('success');
    } else {
      haptic?.('error');
    }
    settleBet(betId, { won, payout, result: { side: result }, alreadyCredited: true });

    setLast({ result, won, payout });
    setHistory((h) => [{ result, won }, ...h].slice(0, 14));
    setFlipping(false);
  };

  return (
    <div className="stack">
      <div className="card card-tight" style={{ display: 'grid', placeItems: 'center', padding: 26 }}>
        <motion.div
          animate={
            flipping
              ? { rotateY: [0, 900, 1800], scale: [1, 1.15, 1] }
              : { rotateY: last?.result === 'tails' ? 180 : 0, scale: 1 }
          }
          transition={flipping ? { duration: 1.5, ease: 'easeOut' } : { type: 'spring', stiffness: 200, damping: 16 }}
          style={{
            width: 92,
            height: 92,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: 36,
            transformStyle: 'preserve-3d',
            background: 'linear-gradient(145deg,#ffd76e,#c9962a)',
            boxShadow: last
              ? `0 0 34px -6px ${last.won ? 'rgba(0,255,157,.8)' : 'rgba(255,59,107,.8)'}`
              : '0 8px 26px -8px rgba(255,201,60,.7)',
            border: '3px solid rgba(255,255,255,.25)'
          }}
        >
          {flipping ? '🪙' : last ? (last.result === 'heads' ? '🦅' : '🌙') : '🪙'}
        </motion.div>

        {last && !flipping && (
          <motion.div
            className={`pill ${last.won ? 'pill-up' : 'pill-down'}`}
            style={{ marginTop: 14 }}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            {t(`game.coinflip.${last.result}`)} · {last.won ? `+${fmtNum(last.payout - stake, 2)}` : `-${fmtNum(stake, 2)}`}
          </motion.div>
        )}
      </div>

      {history.length > 0 && (
        <div className="tag-scroll">
          {history.map((h, i) => (
            <motion.span key={i} className={`pill ${h.won ? 'pill-up' : 'pill-down'}`} initial={{ scale: 0.6 }} animate={{ scale: 1 }}>
              {h.result === 'heads' ? '🦅' : '🌙'}
            </motion.span>
          ))}
        </div>
      )}

      <div className="segmented">
        {['heads', 'tails'].map((sd) => (
          <button key={sd} className={side === sd ? 'active' : ''} onClick={() => setSide(sd)} disabled={flipping} style={{ isolation: 'isolate' }}>
            {side === sd && <SegIndicator id="cf-ind" />}
            {sd === 'heads' ? '🦅' : '🌙'} {t(`game.coinflip.${sd}`)}
          </button>
        ))}
      </div>

      <div className="card card-tight row-between">
        <span className="faint">{t('game.dice.multiplier')}</span>
        <span className="mono up">{PAYOUT.toFixed(2)}×</span>
      </div>

      <div>
        <label className="field-label">{t('game.stake')}</label>
        <input type="number" value={bet} min="1" onChange={(e) => setBet(e.target.value)} disabled={flipping} />
      </div>

      <div className="row" style={{ gap: 6 }}>
        {[10, 50, 100, 500].map((v) => (
          <button key={v} className="tag" style={{ flex: 1, textAlign: 'center' }} onClick={() => setBet(String(v))} disabled={flipping}>
            {v}
          </button>
        ))}
      </div>

      <button className="btn btn-primary" onClick={flip} disabled={flipping || stake <= 0 || stake > balance}>
        {flipping ? t('game.coinflip.flipping') : t('game.coinflip.flip')}
      </button>
    </div>
  );
}
