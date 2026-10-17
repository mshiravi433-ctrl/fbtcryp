import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useTelegram } from '../../context/TelegramContext';
import { completeFocus, focusAvailable, useRewardsHub } from '../../lib/rewards/wheel';
import { IconPlay, IconSparkle, IconRefresh } from '../Icons';

const TOTAL = 8;
const HIT_WINDOW = 950;
const RUNES = [
  { id: 0, glyph: '◈', color: '#00e5ff' },
  { id: 1, glyph: '✦', color: '#00ff9d' },
  { id: 2, glyph: '✧', color: '#ff2d95' },
  { id: 3, glyph: '⟡', color: '#ffb300' }
];

/** Eight shards that fly out of the tile on a correct hit. */
const SHARDS = Array.from({ length: 8 }, (_, i) => ({
  x: Math.cos((i * Math.PI) / 4) * 62,
  y: Math.sin((i * Math.PI) / 4) * 62,
  d: (i % 2 ? 1 : -1) * 12
}));

/**
 * FOCUS ROUND — the light mini-game.
 * ---------------------------------------------------------------------------
 * Eight prompts, under a minute, one daily airdrop entry for a good score.
 *
 * Deliberately NOT a points faucet: the repository already removed a play-money
 * arcade that minted reputation for fake trades. A reflex game is even easier
 * to script, so its only reward is a device-local season entry (once/day) and
 * a badge. There is no timer that keeps a user here past the round.
 *
 * THE FEEL — the round is a reflex test, so the interface is a reflex test:
 * two big tiles per row, a draining ring on the lit rune, a live combo meter
 * and a shard burst on every correct answer. Motion is transform/opacity
 * only, and every timer is cleared on unmount.
 */
export default function FocusGame() {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const hub = useRewardsHub();
  const [phase, setPhase] = useState('idle'); // idle | show | feedback | done
  const [round, setRound] = useState(0);
  const [lit, setLit] = useState(0);
  const [hits, setHits] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [picked, setPicked] = useState(null);
  const [result, setResult] = useState(null);
  const [burst, setBurst] = useState(0);

  const resolved = useRef(false);
  const litRef = useRef(0);
  const hitsRef = useRef(0);
  const comboRef = useRef(0);
  const roundRef = useRef(0);
  const timers = useRef([]);

  const clearTimers = () => {
    for (const id of timers.current) clearTimeout(id);
    timers.current = [];
  };

  useEffect(() => () => clearTimers(), []);

  const finish = useCallback((finalHits, finalCombo) => {
    setPhase('done');
    const won = finalHits >= 6;
    const entry = won ? completeFocus() : false;
    setResult({ hits: finalHits, combo: finalCombo, won, entry });
    if (won) haptic?.('success');
  }, [haptic]);

  const nextRound = useCallback(() => {
    clearTimers();
    const next = roundRef.current + 1;
    if (next >= TOTAL) {
      finish(hitsRef.current, comboRef.current);
      return;
    }
    roundRef.current = next;
    setRound(next);
    const target = Math.floor(Math.random() * RUNES.length);
    litRef.current = target;
    setLit(target);
    setPicked(null);
    setPhase('show');
    resolved.current = false;

    timers.current.push(setTimeout(() => {
      if (resolved.current) return;
      resolved.current = true;
      setPhase('feedback');
      setPicked(null);
      setCombo(0);
      comboRef.current = 0;
      haptic?.('error');
      timers.current.push(setTimeout(nextRound, 320));
    }, HIT_WINDOW));
  }, [finish, haptic]);

  const start = () => {
    clearTimers();
    setHits(0);
    hitsRef.current = 0;
    setCombo(0);
    comboRef.current = 0;
    setBestCombo(0);
    setRound(0);
    setResult(null);
    setPicked(null);
    const target = Math.floor(Math.random() * RUNES.length);
    litRef.current = target;
    setLit(target);
    setPhase('show');
    resolved.current = false;
    haptic?.('light');
    timers.current.push(setTimeout(() => {
      if (resolved.current) return;
      resolved.current = true;
      setPhase('feedback');
      setCombo(0);
      comboRef.current = 0;
      timers.current.push(setTimeout(nextRound, 320));
    }, HIT_WINDOW));
  };

  const tap = (index) => {
    if (phase !== 'show' || resolved.current) return;
    resolved.current = true;
    clearTimers();
    const good = index === litRef.current;
    setPicked(index);
    setPhase('feedback');
    if (good) {
      hitsRef.current += 1;
      setHits(hitsRef.current);
      comboRef.current += 1;
      setCombo(comboRef.current);
      setBestCombo((best) => Math.max(best, comboRef.current));
      setBurst((n) => n + 1);
      haptic?.('select');
    } else {
      comboRef.current = 0;
      setCombo(0);
      haptic?.('error');
    }
    timers.current.push(setTimeout(nextRound, 320));
  };

  const available = focusAvailable();
  const progress = phase === 'idle' ? 0 : Math.min((round + (phase === 'done' ? 1 : 0)) / TOTAL, 1);

  return (
    <section className="rwd-card rwd-focus-card" id="rwd-focus">
      <header className="rwd-sec-head">
        <div>
          <div className="rwd-kicker">{t('rewards.v2.focus.kicker')}</div>
          <h3 className="rwd-sec-title">
            <IconSparkle width={17} height={17} style={{ color: 'var(--rgb-4)' }} />
            {t('rewards.v2.focus.title')}
          </h3>
        </div>
        <span className={`rwd-chip${available ? '' : ' up'}`}>
          {available ? t('rewards.v2.focus.available') : t('rewards.v2.focus.doneToday')}
        </span>
      </header>

      <p className="rwd-prose">{t('rewards.v2.focus.sub')}</p>

      <div className="rwd-focus-stage">
        <div className="rwd-focus-runes">
          {RUNES.map((rune) => {
            const isLit = phase === 'show' && lit === rune.id;
            const isPicked = phase === 'feedback' && picked === rune.id;
            const isRight = phase === 'feedback' && picked == null && lit === rune.id;
            const good = phase === 'feedback' && picked === rune.id && picked === lit;
            return (
              <button
                key={rune.id}
                type="button"
                className={`rwd-rune${isLit ? ' lit' : ''}${isPicked ? ' picked' : ''}${isRight ? ' missed' : ''}${good ? ' good' : ''}`}
                style={{ '--rune': rune.color }}
                onClick={() => tap(rune.id)}
                disabled={phase !== 'show'}
                aria-label={t('rewards.v2.focus.rune', { n: rune.id + 1 })}
              >
                <span className="rwd-rune-face">
                  <span className="rwd-rune-glyph" aria-hidden="true">{rune.glyph}</span>
                  <span className="rwd-rune-sweep" aria-hidden="true" />
                </span>

                {good && (
                  <span className="rwd-rune-burst" key={`burst-${burst}-${rune.id}`} aria-hidden="true">
                    {SHARDS.map((shard, index) => (
                      <motion.i
                        key={index}
                        initial={{ x: 0, y: 0, opacity: 0.9, scale: 1 }}
                        animate={{ x: shard.x, y: shard.y, opacity: 0, scale: 0.2, rotate: shard.d }}
                        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="rwd-focus-hud">
          <div className="rwd-focus-hud-item">
            <span className="rwd-focus-hud-val">{phase === 'idle' ? '—' : `${Math.min(round + 1, TOTAL)}/${TOTAL}`}</span>
            <span className="rwd-focus-hud-key">{t('rewards.v2.focus.round')}</span>
          </div>
          <div className="rwd-focus-hud-item">
            <span className="rwd-focus-hud-val">{hits}</span>
            <span className="rwd-focus-hud-key">{t('rewards.v2.focus.hits')}</span>
          </div>
          <div className="rwd-focus-hud-item">
            <span className="rwd-focus-hud-val">×{combo}</span>
            <span className="rwd-focus-hud-key">{t('rewards.v2.focus.combo')}</span>
          </div>
        </div>

        <div className="rwd-focus-track" aria-hidden="true">
          {Array.from({ length: TOTAL }).map((_, index) => (
            <i key={index} className={index < round ? 'done' : index === round && phase !== 'idle' ? 'active' : ''} />
          ))}
        </div>

        <span className="rwd-focus-progress" style={{ '--p': progress }} aria-hidden="true" />
      </div>

      <AnimatePresence mode="wait">
        {phase === 'idle' && (
          <motion.button
            key="start"
            type="button"
            className="btn btn-primary rwd-focus-start"
            onClick={start}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <IconPlay width={14} height={14} /> {t('rewards.v2.focus.start')}
          </motion.button>
        )}

        {phase === 'show' && (
          <motion.p
            key="show"
            className="rwd-focus-prompt"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {t('rewards.v2.focus.prompt')}
          </motion.p>
        )}

        {phase === 'done' && result && (
          <motion.div
            key="done"
            className={`rwd-focus-result${result.won ? ' won' : ''}`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="rwd-focus-score">
              <span className="rwd-focus-score-val">{result.hits}</span>
              <span className="rwd-focus-score-key">/{TOTAL}</span>
            </div>
            <div className="rwd-focus-result-title">
              {result.won ? t('rewards.v2.focus.won', { n: result.hits }) : t('rewards.v2.focus.lost', { n: result.hits })}
            </div>
            <p className="rwd-prose">
              {result.entry
                ? t('rewards.v2.focus.earnedEntry')
                : result.won
                  ? t('rewards.v2.focus.alreadyEarned')
                  : t('rewards.v2.focus.tryAgain')}
            </p>
            <div className="rwd-focus-result-foot">
              <span className="rwd-pill">{t('rewards.v2.focus.combo')}: ×{result.combo}</span>
              <span className="rwd-pill">{t('rewards.v2.focus.bestCombo')}: ×{Math.max(result.combo, bestCombo)}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={start}>
                <IconRefresh width={13} height={13} /> {t('rewards.v2.focus.again')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="rwd-fine">{t('rewards.v2.focus.note')}</p>
    </section>
  );
}
