import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { riseIn, stagger } from '../PageTransition';
import { useAppStore } from '../../store/useAppStore';
import { useTelegram } from '../../context/TelegramContext';
import { POINT_VALUES } from '../../lib/ranks';
import {
  IconWallet, IconSwap, IconKey, IconShield, IconUser, IconCheck,
  IconTrophy, IconChevronRight
} from '../Icons';

/* The same five real quests Earn.jsx and Leaderboard.jsx use. */
const QUESTS = [
  { id: 'connectWallet', to: '/wallet', pts: POINT_VALUES.connectWallet, Icon: IconWallet, tone: 'var(--rgb-1)' },
  { id: 'firstSwap', to: '/swap', pts: POINT_VALUES.firstSwap, Icon: IconSwap, tone: 'var(--rgb-2)' },
  { id: 'backupWallet', to: '/wallet', pts: POINT_VALUES.backupWallet, Icon: IconKey, tone: 'var(--rgb-5)' },
  { id: 'enable2fa', to: '/settings', pts: POINT_VALUES.enable2fa, Icon: IconShield, tone: 'var(--rgb-4)' },
  { id: 'inviteFriend', to: null, pts: POINT_VALUES.referral, Icon: IconUser, tone: 'var(--rgb-3)' }
];

/**
 * MISSIONS — the real, server-scored quests.
 *
 * Every row is wired to an action the app already performs (connect a wallet,
 * make a first real swap, back up the key, turn on 2FA, bring a friend). The
 * points are the same POINT_VALUES the rest of the app pays, so nothing here
 * is a separate currency or a promise.
 */
export default function RewardsMissions({ onOpenReferral }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { haptic } = useTelegram();
  const quests = useAppStore((s) => s.quests);

  const openQuest = (quest) => {
    haptic?.('select');
    if (quest.id === 'inviteFriend') {
      onOpenReferral?.();
      return;
    }
    if (quest.to) navigate(quest.to);
  };

  const doneCount = QUESTS.filter((quest) => Boolean(quests?.[quest.id]?.done)).length;

  return (
    <section className="rwd-card rwd-missions-card" id="rwd-missions">
      <header className="rwd-sec-head">
        <div>
          <div className="rwd-kicker">{t('rewards.v2.missions.kicker')}</div>
          <h3 className="rwd-sec-title">
            <IconTrophy width={17} height={17} style={{ color: 'var(--rgb-5)' }} />
            {t('rewards.v2.missions.title')}
          </h3>
        </div>
        <span className="rwd-chip up">{doneCount}/{QUESTS.length}</span>
      </header>
      <p className="rwd-prose">{t('rewards.v2.missions.sub')}</p>

      <motion.div className="rwd-list rwd-missions-list" variants={stagger} initial="hidden" animate="show">
        {QUESTS.map((quest) => {
          const done = Boolean(quests?.[quest.id]?.done);
          return (
            <motion.button
              key={quest.id}
              type="button"
              className={`rwd-quest${done ? ' done' : ''}`}
              variants={riseIn}
              onClick={() => openQuest(quest)}
              disabled={done}
            >
              <span
                className="rwd-quest-ico"
                style={{
                  color: quest.tone,
                  borderColor: done ? 'transparent' : quest.tone,
                  background: done ? 'rgba(0,255,157,.12)' : `color-mix(in srgb, ${quest.tone} 12%, transparent)`
                }}
              >
                {done ? <IconCheck width={16} height={16} /> : <quest.Icon width={16} height={16} />}
              </span>
              <span className="rwd-quest-meta">
                <span className="rwd-quest-title">{t(`earn.quest.${quest.id}`)}</span>
                <span className="rwd-quest-pts">+{quest.pts} {t('rank.pts')}</span>
              </span>
              <span className={`rwd-pill${done ? ' up' : ''}`}>
                {done ? '✓' : <IconChevronRight width={13} height={13} />}
              </span>
            </motion.button>
          );
        })}
      </motion.div>

      <p className="rwd-fine">{t('rewards.v2.missions.note')}</p>
    </section>
  );
}
