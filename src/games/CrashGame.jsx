import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { rollCrashPoint, HOUSE_EDGE } from '../lib/fairness';
import { fmtNum } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';

const TICK_MS = 60;
const GROWTH = 0.00007; // multiplier growth per ms

export default function CrashGame({ fair }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const balance = useAppStore((s) => s.balance);
  const debit = useAppStore((s) => s.debit);
  const credit = useAppStore((s) => s.credit);
  const recordBet = useAppStore((s) => s.recordBet);
  const settleBet = useAppStore((s) => s.settleBet);

  const [bet, setBet] = useState('50');
  const [autoCashout, setAutoCashout] = useState('2.00');
  const [phase, setPhase] = useState('idle'); // idle | running | cashed | crashed
  const [multiplier, setMultiplier] = useState(1);
  const [crashAt, setCrashAt] = useState(null);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const timerRef = useRef(null);
  const startRef = useRef(0);
  const stateRef = useRef({ crashAt: 0, stake: 0, auto: 0, cashed: false });

  useEffect(() => () => clearInterval(timerRef.current), []);

  const stake = Number(bet) || 0;

  const finish = (kind, payload) => {
    clearInterval(timerRef.current);
    setPhase(kind);
    setResult(payload);
    setHistory((h) => [{ x: stateRef.current.crashAt, won: kind === 'cashed' }, ...h].slice(0, 12));
  };

  const cashOut = (atMultiplier) => {
    if (stateRef.current.cashed) return;
    stateRef.current.cashed = true;
    const payout = stateRef.current.stake * atMultiplier;
    credit(payout);
    settleBet(stateRef.current.betId, { won: true, payout, result: { at: atMultiplier }, alreadyCredited: true });
    haptic?.('success');
    finish('cashed', { payout, at: atMultiplier });
  };

  const start = async () => {
    if (!fair?.session || stake <= 0 || phase === 'running') return;
    if (!debit(stake)) return;

    const nonce = fair.nextNonce();
    const point = await rollCrashPoint(fair.session.serverSeed, fair.session.clientSeed, nonce, HOUSE_EDGE);

    stateRef.current = {
      crashAt: point,
      stake,
      auto: Number(autoCashout) || 0,
      cashed: false
    };
    setCrashAt(point);
    setResult(null);
    setMultiplier(1);
    setPhase('running');
    haptic?.('medium');
    const betId = recordBet({ game: 'crash', stake, target: Number(autoCashout) || null });
    stateRef.current.betId = betId;

    startRef.current = performance.now();
    timerRef.current = setInterval(() => {
      const elapsed = performance.now() - startRef.current;
      const m = Math.exp(GROWTH * elapsed);
      const st = stateRef.current;

      if (m >= st.crashAt) {
        setMultiplier(st.crashAt);
        if (!st.cashed) {
          st.cashed = true;
          settleBet(st.betId, { won: false, payout: 0, result: { at: st.crashAt }, alreadyCredited: true });
          haptic?.('error');
          finish('crashed', { lost: st.stake, at: st.crashAt });
        }
        return;
      }

      setMultiplier(m);
      if (st.auto >= 1.01 && m >= st.auto && !st.cashed) cashOut(st.auto);
    }, TICK_MS);
  };

  const running = phase === 'running';
  const color = phase === 'crashed' ? 'var(--down)' : phase === 'cashed' ? 'var(--up)' : 'var(--rgb-1)';

  return (
    <div className="stack">
      <div className="crash-stage">
        <div className="crash-grid" />
        <AnimatePresence mode="wait">
          <motion.div
            key={phase + (running ? '' : String(result?.at ?? ''))}
            className="crash-multiplier"
            style={{ color, textShadow: `0 0 28px ${color}` }}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{
              scale: running ? [1, 1.045, 1] : 1,
              opacity: 1
            }}
            transition={running ? { duration: 0.55, repeat: Infinity } : { type: 'spring', stiffness: 300, damping: 18 }}
          >
            {multiplier.toFixed(2)}×
          </motion.div>
        </AnimatePresence>

        {phase === 'crashed' && (
          <motion.div
            className="pill pill-down"
            style={{ position: 'absolute', bottom: 14 }}
            initial={{ y: 14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            💥 {t('game.crash.busted', { x: crashAt?.toFixed(2) })}
          </motion.div>
        )}
        {phase === 'cashed' && (
          <motion.div
            className="pill pill-up"
            style={{ position: 'absolute', bottom: 14 }}
            initial={{ y: 14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            ✅ +{fmtNum(result?.payout ?? 0, 2)} NX @ {result?.at?.toFixed(2)}×
          </motion.div>
        )}
      </div>

      {history.length > 0 && (
        <div className="tag-scroll">
          {history.map((h, i) => (
            <motion.span
              key={i}
              className={`pill ${h.x >= 2 ? 'pill-up' : 'pill-down'}`}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
            >
              {h.x.toFixed(2)}×
            </motion.span>
          ))}
        </div>
      )}

      <div className="grid-2">
        <div>
          <label className="field-label">{t('game.stake')}</label>
          <input type="number" value={bet} onChange={(e) => setBet(e.target.value)} disabled={running} min="1" />
        </div>
        <div>
          <label className="field-label">{t('game.crash.autoCashout')}</label>
          <input
            type="number"
            step="0.1"
            min="1.01"
            value={autoCashout}
            onChange={(e) => setAutoCashout(e.target.value)}
            disabled={running}
          />
        </div>
      </div>

      <div className="row" style={{ gap: 6 }}>
        {[10, 50, 100, 500].map((v) => (
          <button key={v} className="tag" style={{ flex: 1, textAlign: 'center' }} onClick={() => setBet(String(v))} disabled={running}>
            {v}
          </button>
        ))}
      </div>

      {running ? (
        <button className="btn btn-success" onClick={() => cashOut(multiplier)}>
          {t('game.crash.cashOut')} · {fmtNum(stateRef.current.stake * multiplier, 2)} NX
        </button>
      ) : (
        <button className="btn btn-primary" onClick={start} disabled={stake <= 0 || stake > balance}>
          {t('game.crash.launch')}
        </button>
      )}
    </div>
  );
}
