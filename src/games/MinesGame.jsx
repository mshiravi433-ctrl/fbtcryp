import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { HOUSE_EDGE, rollFloat } from '../lib/fairness';
import { fmtNum } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import { useTelegram } from '../context/TelegramContext';

const GRID = 25;

/**
 * Mines. Reveal safe tiles; each one raises the multiplier. Hit a mine and the
 * round is lost.
 *
 * The multiplier is the fair odds of having survived N picks, reduced by the
 * same 3% house edge as the other games — so the maths is consistent across
 * the arcade rather than being tuned per game.
 */
function multiplierFor(mines, revealed) {
  if (revealed === 0) return 1;
  let p = 1;
  for (let i = 0; i < revealed; i++) p *= (GRID - mines - i) / (GRID - i);
  return (1 / p) * (1 - HOUSE_EDGE);
}

export default function MinesGame({ fair }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const balance = useAppStore((s) => s.balance);
  const debit = useAppStore((s) => s.debit);
  const credit = useAppStore((s) => s.credit);
  const recordBet = useAppStore((s) => s.recordBet);
  const settleBet = useAppStore((s) => s.settleBet);

  const [bet, setBet] = useState('50');
  const [mineCount, setMineCount] = useState(3);
  const [active, setActive] = useState(false);
  const [mines, setMines] = useState([]);
  const [opened, setOpened] = useState([]);
  const [dead, setDead] = useState(false);
  const [betId, setBetId] = useState(null);

  const stake = Number(bet) || 0;
  const mult = multiplierFor(mineCount, opened.length);
  const cashValue = stake * mult;
  const nextMult = multiplierFor(mineCount, opened.length + 1);

  const start = async () => {
    if (!fair?.session || stake <= 0) return;
    if (!debit(stake)) return;

    // Derive mine positions from the commit-reveal seed, same as every other
    // game — so the board is provably fixed before the first click.
    const chosen = new Set();
    let n = 0;
    while (chosen.size < mineCount) {
      const r = await rollFloat(fair.session.serverSeed, fair.session.clientSeed, fair.nextNonce() + n);
      chosen.add(Math.floor(r * GRID) % GRID);
      n++;
    }

    setMines([...chosen]);
    setOpened([]);
    setDead(false);
    setActive(true);
    setBetId(recordBet({ game: 'mines', stake, mines: mineCount }));
    haptic?.('medium');
  };

  const pick = (i) => {
    if (!active || dead || opened.includes(i)) return;

    if (mines.includes(i)) {
      setDead(true);
      setActive(false);
      settleBet(betId, { won: false, payout: 0, result: { hit: i }, alreadyCredited: true });
      haptic?.('error');
      return;
    }

    const next = [...opened, i];
    setOpened(next);
    haptic?.('light');

    // Cleared every safe tile — auto cash out.
    if (next.length === GRID - mineCount) cashOut(next.length);
  };

  const cashOut = (count = opened.length) => {
    if (!active || dead || count === 0) return;
    const payout = stake * multiplierFor(mineCount, count);
    credit(payout);
    settleBet(betId, { won: true, payout, result: { revealed: count }, alreadyCredited: true });
    setActive(false);
    haptic?.('success');
  };

  return (
    <div className="stack">
      <div className="row-between">
        <div className="card card-tight" style={{ flex: 1 }}>
          <div className="faint">{t('game.mines.multiplier')}</div>
          <div className="mono up" style={{ fontSize: 15 }}>{mult.toFixed(2)}×</div>
        </div>
        <div className="card card-tight" style={{ flex: 1 }}>
          <div className="faint">{t('game.mines.cashValue')}</div>
          <div className="mono" style={{ fontSize: 15 }}>{fmtNum(cashValue, 2)}</div>
        </div>
        <div className="card card-tight" style={{ flex: 1 }}>
          <div className="faint">{t('game.mines.next')}</div>
          <div className="mono" style={{ fontSize: 15, color: 'var(--rgb-1)' }}>{nextMult.toFixed(2)}×</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 7 }}>
        {Array.from({ length: GRID }).map((_, i) => {
          const isOpen = opened.includes(i);
          const isMine = mines.includes(i);
          const show = isOpen || (dead && isMine);
          return (
            <motion.button
              key={i}
              onClick={() => pick(i)}
              disabled={!active || dead}
              whileTap={active && !isOpen ? { scale: 0.88 } : undefined}
              animate={
                show
                  ? { rotateY: [0, 180, 360], scale: [1, 1.08, 1] }
                  : { rotateY: 0, scale: 1 }
              }
              transition={{ duration: 0.4 }}
              style={{
                aspectRatio: '1',
                borderRadius: 12,
                fontSize: 18,
                display: 'grid',
                placeItems: 'center',
                cursor: active && !isOpen ? 'pointer' : 'default',
                border: '1px solid var(--line)',
                background: show
                  ? isMine
                    ? 'rgba(255,59,107,.24)'
                    : 'rgba(0,255,157,.18)'
                  : 'rgba(127,127,127,.09)',
                borderColor: show ? (isMine ? 'var(--down)' : 'var(--up)') : 'var(--line)'
              }}
            >
              <AnimatePresence>
                {show && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}>
                    {isMine ? '💣' : '💎'}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>

      {dead && (
        <motion.div className="pill pill-down" style={{ alignSelf: 'center' }} initial={{ scale: 0.7 }} animate={{ scale: 1 }}>
          💥 {t('game.mines.boom', { n: fmtNum(stake, 2) })}
        </motion.div>
      )}

      {!active && (
        <>
          <div>
            <div className="row-between" style={{ marginBottom: 6 }}>
              <span className="field-label" style={{ margin: 0 }}>{t('game.mines.count')}</span>
              <span className="mono" style={{ fontSize: 13, color: 'var(--rgb-5)' }}>{mineCount}</span>
            </div>
            <input
              type="range"
              min="1"
              max="15"
              value={mineCount}
              onChange={(e) => setMineCount(Number(e.target.value))}
              style={{ width: '100%', padding: 0, background: 'transparent', border: 'none', accentColor: '#ffb300' }}
            />
          </div>

          <div>
            <label className="field-label">{t('game.stake')}</label>
            <input type="number" value={bet} min="1" onChange={(e) => setBet(e.target.value)} />
          </div>

          <div className="row" style={{ gap: 6 }}>
            {[10, 50, 100, 500].map((v) => (
              <button key={v} className="tag" style={{ flex: 1, textAlign: 'center' }} onClick={() => setBet(String(v))}>
                {v}
              </button>
            ))}
          </div>
        </>
      )}

      {active ? (
        <button className="btn btn-success" onClick={() => cashOut()} disabled={opened.length === 0}>
          {t('game.mines.cashOut')} · {fmtNum(cashValue, 2)}
        </button>
      ) : (
        <button className="btn btn-primary" onClick={start} disabled={stake <= 0 || stake > balance}>
          {t('game.mines.start')}
        </button>
      )}
    </div>
  );
}
