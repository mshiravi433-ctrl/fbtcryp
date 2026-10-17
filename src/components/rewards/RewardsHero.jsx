import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AnimatedNumber from '../AnimatedNumber';
import { useAppStore } from '../../store/useAppStore';
import { useWallet, shortAddress } from '../../context/WalletContext';
import { useSolanaWallet } from '../../hooks/useSolanaWallet';
import { useTelegram } from '../../context/TelegramContext';
import { tierFor, nextTier, tierProgress } from '../../lib/ranks';
import { fbtFromPoints, fbtTier } from '../../lib/fbt';
import { fmtNum } from '../../lib/format';
import { IconWallet, IconGift, IconTrophy, IconChevronLeft } from '../Icons';

const R = 58; // ring radius
const C = 2 * Math.PI * R;

/**
 * The score "hero" at the top of the Points & Rewards page: one cohesive
 * glass card holding the user's points, tier progress ring, streak, FBT
 * balance and wallet state. All values are real (store / wallet contexts) —
 * nothing here is invented.
 */
export default function RewardsHero() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();

  const points = useAppStore((s) => s.points);
  const streak = useAppStore((s) => s.streak);

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
    <section className="rwd-card rwd-hero" style={{ '--accent': tier.color }}>
      <div className="rwd-ring-wrap">
        <svg viewBox="0 0 132 132" aria-hidden="true">
          <circle className="rwd-ring-track" cx="66" cy="66" r={R} fill="none" strokeWidth="9" />
          <motion.circle
            className="rwd-ring-fill"
            cx="66" cy="66" r={R} fill="none"
            stroke={tier.color} strokeWidth="9"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: ringOffset }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          />
        </svg>
        <div className="rwd-ring-core">
          <div className="rwd-ring-tier">{tier.icon}</div>
          <div className="rwd-ring-label">{t(`rank.tier.${tier.id}`)}</div>
        </div>
      </div>

      <div className="rwd-hero-main">
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

        <div className="rwd-stats">
          <div className="rwd-stat">
            <div className="rwd-stat-ico">🔥</div>
            <div className="rwd-stat-val">{fmtNum(streak || 0, 0)}</div>
            <div className="rwd-stat-key">{t('rewards.streakTitle')}</div>
          </div>
          <div className="rwd-stat">
            <div className="rwd-stat-ico"><IconGift width={16} height={16} /></div>
            <div className="rwd-stat-val">{fmtNum(fbt, 0)}</div>
            <div className="rwd-stat-key">{t('rewards.fbtBalance')}</div>
          </div>
          <div className="rwd-stat">
            <div className="rwd-stat-ico"><IconTrophy width={16} height={16} /></div>
            <div className="rwd-stat-val" style={{ fontSize: 13 }}>{t(`fbt.tier.${fbtInfo.tier.id}`)}</div>
            <div className="rwd-stat-key">{t('rewards.level')}</div>
          </div>
        </div>

        {!primaryAddress ? (
          <div className="rwd-wallet">
            <span className="rwd-stat-ico" style={{ color: 'var(--rgb-1)' }}><IconWallet width={18} height={18} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>{t('rewards.wallet.title')}</div>
              <div className="rwd-wsub">{t('rewards.wallet.sub')}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {sol.available && (
                <button className="btn btn-ghost btn-sm" onClick={() => void connectSol()}>Solana</button>
              )}
              <button className="btn btn-primary btn-sm" onClick={openWallet}>{t('rewards.wallet.connect')}</button>
            </div>
          </div>
        ) : (
          <button className="rwd-wallet" onClick={openWallet} style={{ width: '100%', textAlign: 'start' }}>
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
      </div>
    </section>
  );
}
