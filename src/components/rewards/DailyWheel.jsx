import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import TierTotem from './TierTotem';
import { useTelegram } from '../../context/TelegramContext';
import { useAppStore } from '../../store/useAppStore';
import { tierFor } from '../../lib/ranks';
import { WHEEL_POINT_VALUE } from '../../lib/rewards/economy';
import {
  BONUS_SEGMENTS, DAILY_SEGMENTS, applySpin, drawSpin, useRewardsHub, wheelStatus
} from '../../lib/rewards/wheel';

const CENTER = 120;
const RADIUS = 96;

const polar = (radius, degrees) => {
  const rad = ((degrees - 90) * Math.PI) / 180;
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
};

function sectorPath(index, count) {
  const step = 360 / count;
  const start = index * step;
  const end = start + step;
  const [x1, y1] = polar(RADIUS, start);
  const [x2, y2] = polar(RADIUS, end);
  const large = step > 180 ? 1 : 0;
  return `M${CENTER} ${CENTER} L${x1.toFixed(2)} ${y1.toFixed(2)} A${RADIUS} ${RADIUS} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

/**
 * DAILY WHEEL — one point-bearing spin per local day, plus referral bonus spins.
 *
 * The sector is drawn BEFORE the animation and applied immediately, so closing
 * the tab mid-spin cannot lose a prize. The wheel then animates to that sector
 * and the result panel is revealed when it stops. Point credit goes through the
 * store/server (see lib/rewards/wheel.js), never through this component.
 */
export default function DailyWheel() {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const points = useAppStore((s) => s.points);
  const hub = useRewardsHub();
  const tier = tierFor(points);

  const [now, setNow] = useState(() => Date.now());
  const [mode, setMode] = useState('daily');
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [spinMode, setSpinMode] = useState(null);
  const [result, setResult] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 60_000);
    window.addEventListener('focus', tick);
    return () => { clearInterval(id); window.removeEventListener('focus', tick); };
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const status = wheelStatus(now);
  const dailyReady = status.canSpin;
  const bonusReady = hub.bonusSpins > 0;

  /* If today's free spin is gone, a bonus spin is the natural next action. */
  useEffect(() => {
    if (spinning) return;
    if (!dailyReady && bonusReady) setMode('bonus');
    else if (dailyReady) setMode('daily');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyReady, bonusReady, spinning]);

  /* Freeze the sector set while the disc is in motion: applying a prize updates
     the hub (and may flip the default mode), which must not redraw the wheel
     underneath a running animation. */
  const activeMode = spinMode || mode;
  const pool = activeMode === 'bonus' ? BONUS_SEGMENTS : DAILY_SEGMENTS;
  const step = 360 / pool.length;
  const canSpin = spinning
    ? false
    : mode === 'bonus'
      ? bonusReady
      : dailyReady;

  const legend = useMemo(() => ([
    { id: 'points', glyph: '✦', tone: '#00ff9d', label: t('rewards.v2.wheel.legend.points', { n: WHEEL_POINT_VALUE }) },
    { id: 'nft', glyph: '◈', tone: '#00e5ff', label: t('rewards.v2.wheel.legend.nft') },
    { id: 'entries', glyph: '✧', tone: '#7c4dff', label: t('rewards.v2.wheel.legend.entries') },
    { id: 'bonus', glyph: '↻', tone: '#ffb300', label: t('rewards.v2.wheel.legend.bonus') }
  ]), [t]);

  const spin = () => {
    if (!canSpin) return;
    haptic?.('light');
    const draw = drawSpin({ bonus: mode === 'bonus' });
    const applied = applySpin(draw, { tierId: tier.id });
    if (!applied) {
      setNow(Date.now());
      return;
    }

    const center = draw.index * step + step / 2;
    const jitter = (Math.random() - 0.5) * step * 0.54;
    const base = Math.ceil((angle + 1440) / 360) * 360;
    const desired = ((360 - center) % 360 + 360) % 360;
    let target = base + desired + jitter;
    if (target < angle + 1440) target += 360;

    setResult(null);
    setSpinMode(mode);
    setAngle(target);
    setSpinning(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSpinning(false);
      setSpinMode(null);
      setResult(applied);
      haptic?.('success');
    }, 4300);
  };

  const resultText = () => {
    if (!result) return null;
    const { segment } = result;
    if (segment.kind === 'points') {
      if (result.pointsCredited) {
        return t('rewards.v2.wheel.result.points', { n: segment.pts });
      }
      return t('rewards.v2.wheel.result.alreadyCredited');
    }
    if (segment.kind === 'nft') {
      if (result.nftAdded) {
        return t('rewards.v2.wheel.result.nft', { tier: t(`rank.tier.${result.nftTier}`) });
      }
      return t('rewards.v2.wheel.result.nftDup');
    }
    if (segment.kind === 'entries') {
      return result.entryAdded === 1
        ? t('rewards.v2.wheel.result.entryOne')
        : t('rewards.v2.wheel.result.entryMany', { n: result.entryAdded });
    }
    return t('rewards.v2.wheel.result.bonus');
  };

  const remainingLabel = spinning
    ? t('rewards.v2.wheel.spinning')
    : mode === 'bonus'
      ? t('rewards.v2.wheel.bonusLeft', { n: hub.bonusSpins })
      : dailyReady
        ? t('rewards.v2.wheel.onePerDay')
        : t('rewards.v2.wheel.comeBack', { h: status.hoursLeft });

  return (
    <section className="rwd-card rwd-wheel-card" id="rwd-wheel">
      <header className="rwd-sec-head">
        <div>
          <div className="rwd-kicker">{t('rewards.v2.wheel.kicker')}</div>
          <h3 className="rwd-sec-title">{t('rewards.v2.wheel.title')}</h3>
        </div>
        <span className="rwd-chip">
          <span className="rwd-chip-dot" style={{ background: tier.color }} />
          {t('rewards.v2.wheel.spinsToday', { n: dailyReady ? 1 : 0 })}
        </span>
      </header>

      <p className="rwd-prose rwd-wheel-sub">{t('rewards.v2.wheel.sub')}</p>

      <div className="rwd-wheel-stage">
        <div className="rwd-wheel-glow" aria-hidden="true" style={{ '--tone': tier.color }} />
        <div className="rwd-wheel-pointer" aria-hidden="true">
          <svg viewBox="0 0 24 30" width="24" height="30">
            <defs>
              <linearGradient id="rwd-wheel-pin" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffe9a8" />
                <stop offset=".45" stopColor="var(--rgb-5)" />
                <stop offset="1" stopColor="#b26a00" />
              </linearGradient>
            </defs>
            <path d="M12 29 C12 29 21 15 21 8 A9 9 0 0 0 3 8 C3 15 12 29 12 29 Z" fill="url(#rwd-wheel-pin)" stroke="rgba(0,0,0,.35)" strokeWidth="1" />
            <circle cx="12" cy="8" r="3.4" fill="#0a0f16" opacity=".55" />
          </svg>
        </div>
        <motion.div
          className="rwd-wheel-disc"
          animate={{ rotate: angle }}
          transition={spinning
            ? { duration: 4.2, ease: [0.12, 0.78, 0.12, 1] }
            : { duration: 0 }}
          style={{ '--wheel-tone': tier.color }}
        >
          <svg viewBox="0 0 240 240" role="img" aria-label={t('rewards.v2.wheel.title')}>
            <defs>
              <radialGradient id="rwd-wheel-sheen" cx="50%" cy="38%" r="64%">
                <stop offset="0" stopColor="#fff" stopOpacity=".3" />
                <stop offset=".5" stopColor="#fff" stopOpacity=".05" />
                <stop offset="1" stopColor="#000" stopOpacity=".3" />
              </radialGradient>
              <linearGradient id="rwd-wheel-rim" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0" stopColor="#e9f2ff" stopOpacity=".55" />
                <stop offset=".35" stopColor="#5d6a86" stopOpacity=".35" />
                <stop offset=".6" stopColor="#e9f2ff" stopOpacity=".2" />
                <stop offset="1" stopColor="#2a3348" stopOpacity=".5" />
              </linearGradient>
              <radialGradient id="rwd-wheel-plate" cx="50%" cy="36%" r="70%">
                <stop offset="0" stopColor="#131a28" />
                <stop offset="1" stopColor="#05070d" />
              </radialGradient>
            </defs>

            {/* metal rim + inner plate */}
            <circle cx="120" cy="120" r="117" fill="#000" opacity=".42" />
            <circle cx="120" cy="120" r="113" fill="url(#rwd-wheel-rim)" />
            <circle cx="120" cy="120" r="105" fill="url(#rwd-wheel-plate)" />

            {/* sectors */}
            {pool.map((segment, index) => {
              const mid = index * step + step / 2;
              const [lx, ly] = polar(73, mid);
              const [ex, ey] = polar(96, mid);
              return (
                <g key={`${segment.id}-${index}`}>
                  <path
                    d={sectorPath(index, pool.length)}
                    fill={segment.color}
                    fillOpacity={index % 2 === 0 ? 0.2 : 0.1}
                    stroke="rgba(255,255,255,.12)"
                    strokeWidth="1"
                  />
                  <line x1="120" y1="120" x2={ex} y2={ey} stroke={segment.color} strokeOpacity=".28" strokeWidth="1" />
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={segment.color}
                    fontSize="18"
                    style={{ filter: `drop-shadow(0 0 6px ${segment.color})` }}
                  >
                    {segment.glyph}
                  </text>
                </g>
              );
            })}

            {/* glass sheen + inner rings */}
            <circle cx="120" cy="120" r="96" fill="url(#rwd-wheel-sheen)" pointerEvents="none" />
            <circle cx="120" cy="120" r="97" fill="none" stroke={tier.color} strokeOpacity=".38" strokeWidth="1.6" />
            <circle cx="120" cy="120" r="101" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="1" />

            {/* notch ring */}
            {Array.from({ length: 24 }).map((_, i) => {
              const [x, y] = polar(107, i * 15);
              return <circle key={i} cx={x} cy={y} r={i % 2 ? 1.1 : 1.9} fill={i % 2 ? 'rgba(255,255,255,.35)' : tier.color} opacity={i % 2 ? 0.7 : 1} />;
            })}

            {/* hub */}
            <circle cx="120" cy="120" r="38" fill="rgba(4,8,14,.92)" stroke={tier.color} strokeOpacity=".45" strokeWidth="1.4" />
            <circle cx="120" cy="120" r="43" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="1" strokeDasharray="2 6" />
          </svg>
        </motion.div>
        {/* The animal sits ABOVE the rotating disc, not inside it: otherwise it
            would come to rest at a random angle after every spin. */}
        <span className="rwd-wheel-core">
          <TierTotem tier={tier.id} size={58} idle={!spinning} interactive={!spinning} />
        </span>
      </div>

      <div className="rwd-wheel-actions">
        {hub.bonusSpins > 0 && (
          <div className="rwd-seg" role="group" aria-label={t('rewards.v2.wheel.mode')}>
            <button
              type="button"
              className={`rwd-seg-btn${mode === 'daily' ? ' active' : ''}`}
              onClick={() => { setMode('daily'); setResult(null); haptic?.('select'); }}
              disabled={spinning}
            >
              {t('rewards.v2.wheel.dailyMode')}
            </button>
            <button
              type="button"
              className={`rwd-seg-btn${mode === 'bonus' ? ' active' : ''}`}
              onClick={() => { setMode('bonus'); setResult(null); haptic?.('select'); }}
              disabled={spinning}
            >
              {t('rewards.v2.wheel.bonusMode', { n: hub.bonusSpins })}
            </button>
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary rwd-spin-btn"
          onClick={spin}
          disabled={!canSpin}
        >
          <span className="rwd-spin-ico" aria-hidden="true">✦</span>
          {remainingLabel}
        </button>
      </div>

      <AnimatePresence>
        {result && !spinning && (
          <motion.div
            className={`rwd-wheel-result kind-${result.segment.kind}`}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <span className="rwd-wheel-result-glyph" aria-hidden="true">{result.segment.glyph}</span>
            <div>
              <div className="rwd-wheel-result-title">{resultText()}</div>
              <div className="rwd-wheel-result-sub">
                {result.fallbackEntry
                  ? t('rewards.v2.wheel.result.fallbackNote')
                  : result.segment.kind === 'nft' && !result.nftAdded
                    ? t('rewards.v2.wheel.result.dupNote')
                    : t('rewards.v2.wheel.result.note')}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="rwd-wheel-legend">
        {legend.map((row) => (
          <span key={row.id} className="rwd-wheel-legend-item">
            <span className="rwd-wheel-legend-glyph" style={{ color: row.tone }}>{row.glyph}</span>
            {row.label}
          </span>
        ))}
      </div>

      <p className="rwd-fine">{t('rewards.v2.wheel.note')}</p>
    </section>
  );
}
