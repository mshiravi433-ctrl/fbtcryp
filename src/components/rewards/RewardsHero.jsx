import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AnimatedNumber from '../AnimatedNumber';
import FlameIcon from '../FlameIcon';
import TierTotem from './TierTotem';
import { useAppStore } from '../../store/useAppStore';
import { useWallet, shortAddress } from '../../context/WalletContext';
import { useSolanaWallet } from '../../hooks/useSolanaWallet';
import { useTelegram } from '../../context/TelegramContext';
import { TIERS, tierFor, nextTier, tierProgress } from '../../lib/ranks';
import { fbtFromPoints, fbtTier } from '../../lib/fbt';
import { fmtNum } from '../../lib/format';
import { useRewardsHub } from '../../lib/rewards/wheel';
import { IconWallet, IconGift, IconSparkle, IconChevronLeft } from '../Icons';

const R = 74;
const C = 2 * Math.PI * R;

/**
 * THE SCORE HERO — a medallion, not a widget.
 * ---------------------------------------------------------------------------
 * The banner is the first thing the user sees, so it is built like a badge:
 *
 *   · THE MEDALLION — the tier animal sits inside a tier-coloured rim with a
 *     slow orbital sweep and a progress arc. The arc IS the tier progress, so
 *     the picture and the number can never disagree.
 *   · THE LADDER — all six animals are visible at once, in a rail under the
 *     score. The user can see the whole climb, not just the rung they stand
 *     on. Reached rungs are lit; the rest are dimmed, never hidden.
 *   · ONE HONEST BLOCK — points, streak, FBT balance and badge count, each
 *     from a real store value. The FBT line states plainly that FBT has no
 *     price today and becomes tradable once the token is issued.
 *
 * Every value is real (zustand store, wallet contexts, device badge ledger).
 * The tier's emoji/text was replaced by the 3D animal from TierTotem; the tier
 * name survives only as a small caption, because an animal alone is beautiful
 * but not a label.
 */
export default function RewardsHero() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();

  const points = useAppStore((s) => s.points);
  const streak = useAppStore((s) => s.streak);
  const hub = useRewardsHub();

  const wallet = useWallet();
  const sol = useSolanaWallet();

  const tier = tierFor(points);
  const next = nextTier(points);
  const progress = tierProgress(points);

  const fbt = useMemo(() => fbtFromPoints(points), [points]);
  const fbtInfo = useMemo(() => fbtTier(fbt), [fbt]);

  const evmConnected = Boolean(wallet.isConnected && wallet.address);
  const solConnected = Boolean(sol.isConnected && sol.address);
  const primaryAddress = evmConnected ? wallet.address : sol.address || null;
  const walletLabel = evmConnected
    ? `${t('rewards.wallet.evm')}${wallet.chain?.short ? ` · ${wallet.chain.short}` : ''}`
    : solConnected
      ? `${t('rewards.wallet.solana')}${sol.walletName ? ` · ${sol.walletName}` : ''}`
      : '';

  const ringOffset = C * (1 - Math.max(0, Math.min(1, progress)));

  const openWallet = () => {
    haptic?.('select');
    navigate('/wallet');
  };
  const connectSol = async () => {
    haptic?.('light');
    try { await sol.connect(); } catch { /* handled in sheet */ }
  };

  return (
    <section className={`rwd-card rwd-hero rwd-hero-${tier.id}`} style={{ '--accent': tier.color, '--accent-glow': tier.glow }}>
      <div className="rwd-hero-aura" aria-hidden="true" />
      <div className="rwd-hero-grid" aria-hidden="true" />
      <div className="rwd-hero-sweep" aria-hidden="true" />

      <div className="rwd-hero-top">
        <div className="rwd-ring-wrap">
          <svg viewBox="0 0 160 160" aria-hidden="true">
            <defs>
              <linearGradient id="rwd-hero-arc" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0" stopColor={tier.color} />
                <stop offset="1" stopColor="#ffffff" stopOpacity=".85" />
              </linearGradient>
            </defs>
            <circle className="rwd-ring-track" cx="80" cy="80" r={R} fill="none" strokeWidth="5" />
            <circle className="rwd-ring-track-inner" cx="80" cy="80" r={R - 11} fill="none" strokeWidth="1.2" strokeDasharray="1 7" />
            <motion.circle
              className="rwd-ring-fill"
              cx="80" cy="80" r={R} fill="none"
              stroke="url(#rwd-hero-arc)" strokeWidth="5"
              strokeDasharray={C}
              initial={{ strokeDashoffset: C }}
              animate={{ strokeDashoffset: ringOffset }}
              transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
          <span className="rwd-ring-orbit" aria-hidden="true">
            <i /><i /><i />
          </span>
          <div className="rwd-ring-core">
            <TierTotem tier={tier.id} size={112} />
          </div>
          <span className="rwd-ring-tier">{t(`rank.tier.${tier.id}`)}</span>
        </div>

        <div className="rwd-hero-main">
          <div className="rwd-hero-kicker">
            <IconSparkle width={12} height={12} /> {t('rewards.v2.hero.kicker')}
          </div>
          <div className="rwd-points-row">
            <span className="rwd-points">
              <AnimatedNumber value={points} format={(v) => fmtNum(v, 0)} />
            </span>
            <span className="rwd-points-unit">{t('rewards.points')}</span>
          </div>
          <div className="rwd-points-sub">
            {next
              ? t('rewards.levelTo', { n: fmtNum(next.min - points, 0), tier: t(`rank.tier.${next.id}`) })
              : t('rewards.levelMax')}
          </div>

          <div className="rwd-hero-bar">
            <span className="rwd-bar rwd-hero-track">
              <motion.span
                className="rwd-bar-fill"
                initial={{ width: 0 }}
                animate={{ width: `${Math.round(progress * 100)}%` }}
                transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
              />
            </span>
            <span className="rwd-hero-pct mono">{Math.round(progress * 100)}%</span>
          </div>

          <div className="rwd-stats">
            <div className="rwd-stat">
              <div className="rwd-stat-ico" aria-hidden="true"><FlameIcon size={15} /></div>
              <div className="rwd-stat-val">{fmtNum(streak || 0, 0)}</div>
              <div className="rwd-stat-key">{t('rewards.streakTitle')}</div>
            </div>
            <div className="rwd-stat" title={t('rewards.v2.hero.fbtHint')}>
              <div className="rwd-stat-ico"><IconGift width={15} height={15} /></div>
              <div className="rwd-stat-val">{fmtNum(fbt, 0)}</div>
              <div className="rwd-stat-key">{t('rewards.fbtBalance')}</div>
            </div>
            <div className="rwd-stat">
              <div className="rwd-stat-ico"><IconSparkle width={15} height={15} /></div>
              <div className="rwd-stat-val">{hub.nfts.length}<small>/{TIERS.length}</small></div>
              <div className="rwd-stat-key">{t('rewards.v2.hero.badges')}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="rwd-hero-ladder" aria-label={t('rewards.v2.hero.ladder')}>
        {TIERS.map((row) => {
          const reached = points >= row.min;
          const current = row.id === tier.id;
          return (
            <div
              key={row.id}
              className={`rwd-ladder-step${reached ? ' reached' : ''}${current ? ' current' : ''}`}
              style={{ '--step': row.color }}
            >
              <TierTotem tier={row.id} size={30} idle={current} interactive={false} locked={!reached} />
              <span className="rwd-ladder-step-label">{t(`rank.tier.${row.id}`)}</span>
            </div>
          );
        })}
      </div>

      <div className="rwd-hero-meta">
        <span className="rwd-pill" style={{ '--pill': tier.color }}>
          {t('rewards.v2.hero.entries', { n: hub.entries })}
        </span>
        <span className="rwd-pill">{t('fbt.tier.' + fbtInfo.tier.id)}</span>
        <span className="rwd-pill rgb">{t('rewards.v2.hero.noPrice')}</span>
      </div>

      {!primaryAddress ? (
        <div className="rwd-wallet">
          <span className="rwd-stat-ico" style={{ color: 'var(--rgb-1)' }}><IconWallet width={18} height={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 12.5 }}>{t('rewards.wallet.title')}</div>
            <div className="rwd-wsub">{t('rewards.wallet.sub')}</div>
          </div>
          <div className="rwd-wallet-actions">
            {sol.available && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void connectSol()}>Solana</button>
            )}
            <button type="button" className="btn btn-primary btn-sm" onClick={openWallet}>{t('rewards.wallet.connect')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="rwd-wallet" onClick={openWallet}>
          <span className="rwd-stat-ico" style={{ color: 'var(--rgb-1)' }}><IconWallet width={18} height={18} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="mono" dir="ltr" style={{ fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {shortAddress(primaryAddress)}
            </div>
            <div className="rwd-wsub">{walletLabel}</div>
          </div>
          <IconChevronLeft width={16} height={16} style={{ opacity: 0.5, transform: 'scaleX(-1)' }} />
        </button>
      )}
    </section>
  );
}
