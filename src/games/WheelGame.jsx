import { useRef, useState } from 'react';
import { motion, useAnimation } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { rollIndex } from '../lib/fairness';
import { fmtNum } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';

/** 8 equal segments. Expected value ≈ 0.97 stake (3% house edge). */
const SEGMENTS = [
  { x: 0, color: 'var(--rgb-1)' },
  { x: 1.5, color: 'var(--rgb-2)' },
  { x: 0, color: 'var(--rgb-3)' },
  { x: 2, color: 'var(--rgb-4)' },
  { x: 0.5, color: 'var(--rgb-5)' },
  { x: 3, color: 'var(--rgb-1)' },
  { x: 0, color: 'var(--rgb-2)' },
  { x: 0.76, color: 'var(--rgb-3)' }
];

const SEG_DEG = 360 / SEGMENTS.length;

export default function WheelGame({ fair }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const controls = useAnimation();
  const balance = useAppStore((s) => s.balance);
  const debit = useAppStore((s) => s.debit);
  const credit = useAppStore((s) => s.credit);
  const recordBet = useAppStore((s) => s.recordBet);
  const settleBet = useAppStore((s) => s.settleBet);

  const [bet, setBet] = useState('50');
  const [spinning, setSpinning] = useState(false);
  const [last, setLast] = useState(null);
  const rotationRef = useRef(0);

  const stake = Number(bet) || 0;

  const spin = async () => {
    if (!fair?.session || spinning || stake <= 0) return;
    if (!debit(stake)) return;

    setSpinning(true);
    setLast(null);
    haptic?.('medium');

    const nonce = fair.nextNonce();
    const idx = await rollIndex(fair.session.serverSeed, fair.session.clientSeed, nonce, SEGMENTS.length);
    const betId = recordBet({ game: 'wheel', stake });

    // land the pointer (top, 0°) in the middle of segment `idx`
    const target = 360 * 6 + (360 - (idx * SEG_DEG + SEG_DEG / 2));
    rotationRef.current += target;

    await controls.start({
      rotate: rotationRef.current,
      transition: { duration: 3.4, ease: [0.15, 0.9, 0.15, 1] }
    });

    const seg = SEGMENTS[idx];
    const payout = stake * seg.x;
    if (payout > 0) {
      credit(payout);
      haptic?.('success');
    } else {
      haptic?.('error');
    }
    settleBet(betId, { won: payout > stake, payout, result: { multiplier: seg.x }, alreadyCredited: true });
    setLast({ idx, x: seg.x, payout });
    setSpinning(false);
  };

  return (
    <div className="stack">
      <div style={{ position: 'relative', padding: '10px 0 4px' }}>
        <div className="wheel-pointer" style={{ top: 4 }} />
        <motion.div className="wheel" animate={controls} style={{ willChange: 'transform' }}>
          {SEGMENTS.map((s, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'start center',
                transform: `rotate(${i * SEG_DEG + SEG_DEG / 2}deg)`,
                pointerEvents: 'none'
              }}
            >
              <span
                className="mono"
                style={{ marginTop: 16, fontSize: 12, fontWeight: 700, color: '#000', textShadow: '0 1px 2px rgba(255,255,255,.4)' }}
              >
                {s.x}×
              </span>
            </div>
          ))}
        </motion.div>
      </div>

      {last && (
        <motion.div
          className={`pill ${last.x > 1 ? 'pill-up' : last.x > 0 ? 'pill-rgb' : 'pill-down'}`}
          style={{ alignSelf: 'center' }}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          {last.x}× → {last.payout > 0 ? `+${fmtNum(last.payout - stake, 2)}` : `-${fmtNum(stake, 2)}`} NX
        </motion.div>
      )}

      <div>
        <label className="field-label">{t('game.stake')}</label>
        <input type="number" value={bet} min="1" onChange={(e) => setBet(e.target.value)} disabled={spinning} />
      </div>

      <div className="row" style={{ gap: 6 }}>
        {[10, 50, 100, 500].map((v) => (
          <button key={v} className="tag" style={{ flex: 1, textAlign: 'center' }} onClick={() => setBet(String(v))} disabled={spinning}>
            {v}
          </button>
        ))}
      </div>

      <button className="btn btn-primary" onClick={spin} disabled={spinning || stake <= 0 || stake > balance}>
        {spinning ? t('game.spinning') : t('game.wheel.spin')}
      </button>

      <p className="faint" style={{ textAlign: 'center' }}>{t('game.wheel.segments')}</p>
    </div>
  );
}
