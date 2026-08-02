import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import PageTransition, { riseIn } from '../components/PageTransition';
import AnimatedNumber from '../components/AnimatedNumber';
import Sheet from '../components/Sheet';
import CrashGame from '../games/CrashGame';
import DiceGame from '../games/DiceGame';
import WheelGame from '../games/WheelGame';
import MinesGame from '../games/MinesGame';
import CoinFlipGame from '../games/CoinFlipGame';
import { useFairSession } from '../hooks/useFairSession';
import { fmtNum } from '../lib/format';
import { useAppStore } from '../store/useAppStore';
import SegIndicator from '../components/SegIndicator';

const GAMES = [
  { id: 'crash', emoji: '🚀', color: 'var(--rgb-1)' },
  { id: 'dice', emoji: '🎲', color: 'var(--rgb-3)' },
  { id: 'wheel', emoji: '🎡', color: 'var(--rgb-2)' },
  { id: 'mines', emoji: '💣', color: 'var(--rgb-5)' },
  { id: 'coinflip', emoji: '🪙', color: 'var(--rgb-4)' }
];

export default function Play() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fair = useFairSession();
  const balance = useAppStore((s) => s.balance);
  const bets = useAppStore((s) => s.bets);

  const [tab, setTab] = useState('crash');
  const [fairOpen, setFairOpen] = useState(false);
  const [seedDraft, setSeedDraft] = useState('');

  const wagered = bets.reduce((s, b) => s + (b.stake || 0), 0);

  return (
    <PageTransition>
      <motion.div className="row-between" variants={riseIn} initial="hidden" animate="show">
        <div>
          <h1 className="h1">{t('game.title')}</h1>
          <p className="muted">{t('game.subtitle')}</p>
        </div>
        <button className="icon-btn" onClick={() => setFairOpen(true)} title={t('game.fairness')}>
          🔐
        </button>
      </motion.div>

      <p className="notice notice-danger">{t('game.riskNotice')}</p>

      <motion.div className="card card-tight row-between" variants={riseIn} initial="hidden" animate="show">
        <div>
          <div className="faint">{t('common.balance')}</div>
          <div className="stat-mini">
            <AnimatedNumber value={balance} format={(v) => `${fmtNum(v, 2)} NX`} />
          </div>
        </div>
        <div style={{ textAlign: 'end' }}>
          <div className="faint">{t('game.totalWagered')}</div>
          <div className="mono" style={{ fontSize: 13 }}>{fmtNum(wagered, 0)} NX</div>
        </div>
      </motion.div>

      <div className="segmented">
        {GAMES.map((g) => (
          <button key={g.id} className={tab === g.id ? 'active' : ''} onClick={() => setTab(g.id)} style={{ isolation: 'isolate' }}>
            {tab === g.id && (
              <SegIndicator id="game-ind" />
            )}
            {g.emoji} {t(`game.${g.id}.name`)}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -18 }}
          transition={{ duration: 0.24 }}
        >
          {tab === 'crash' && <CrashGame fair={fair} />}
          {tab === 'dice' && <DiceGame fair={fair} />}
          {tab === 'wheel' && <WheelGame fair={fair} />}
          {tab === 'mines' && <MinesGame fair={fair} />}
          {tab === 'coinflip' && <CoinFlipGame fair={fair} />}
        </motion.div>
      </AnimatePresence>

      <motion.button
        className="card card-rgb"
        variants={riseIn}
        initial="hidden"
        animate="show"
        whileTap={{ scale: 0.985 }}
        onClick={() => navigate('/predict')}
        style={{ textAlign: 'start', cursor: 'pointer' }}
      >
        <div className="sheen" />
        <div className="row-between">
          <div>
            <div style={{ fontWeight: 700 }}>📈 {t('predict.title')}</div>
            <div className="faint">{t('predict.teaser')}</div>
          </div>
          <span style={{ fontSize: 20 }}>›</span>
        </div>
      </motion.button>

      {/* ---------- provably fair panel ---------- */}
      <Sheet open={fairOpen} onClose={() => setFairOpen(false)}>
        <h2 className="h2" style={{ marginBottom: 8 }}>🔐 {t('game.fairness')}</h2>
        <p className="muted">{t('game.fairnessExplain')}</p>

        <div className="card card-tight stack" style={{ gap: 10, marginTop: 12 }}>
          <div>
            <div className="field-label">{t('game.serverSeedHash')}</div>
            <div className="mono" style={{ fontSize: 10, wordBreak: 'break-all', color: 'var(--rgb-1)' }}>
              {fair.session?.hash ?? '…'}
            </div>
          </div>
          <div>
            <div className="field-label">{t('game.clientSeed')}</div>
            <input
              type="text"
              value={seedDraft || fair.session?.clientSeed || ''}
              onChange={(e) => setSeedDraft(e.target.value)}
              style={{ fontSize: 12 }}
            />
          </div>
          <div className="row-between">
            <span className="faint">{t('game.nonce')}</span>
            <span className="mono">{fair.session?.nonce ?? 0}</span>
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (seedDraft.trim()) fair.setClientSeed(seedDraft.trim());
              setSeedDraft('');
            }}
          >
            {t('game.applySeed')}
          </button>
          <button className="btn btn-ghost" onClick={() => fair.rotate()}>
            {t('game.revealRotate')}
          </button>
        </div>

        {fair.revealed && (
          <div className="card card-tight" style={{ marginTop: 12 }}>
            <div className="field-label">{t('game.revealedSeed')}</div>
            <div className="mono" style={{ fontSize: 10, wordBreak: 'break-all', color: 'var(--up)' }}>
              {fair.revealed.serverSeed}
            </div>
            <div className="faint" style={{ marginTop: 6 }}>
              {t('game.verifyHint', { rounds: fair.revealed.rounds })}
            </div>
          </div>
        )}

        <p className="notice notice-danger" style={{ marginTop: 12 }}>{t('game.fairnessLimitation')}</p>
      </Sheet>
    </PageTransition>
  );
}
