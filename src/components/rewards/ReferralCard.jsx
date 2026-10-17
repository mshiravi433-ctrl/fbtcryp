import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useTelegram } from '../../context/TelegramContext';
import { useAppStore } from '../../store/useAppStore';
import { POINT_VALUES, tierFor } from '../../lib/ranks';
import { referredBy, siteInviteUrl } from '../../lib/referral';
import { copyText } from '../../lib/share';
import { useShare } from '../../hooks/useShare';
import ShareSheet from '../ShareSheet';
import TierTotem from './TierTotem';
import { grantInviteeBonus, syncConfirmedReferrals, useRewardsHub } from '../../lib/rewards/wheel';
import { IconCopy, IconLink, IconUser } from '../Icons';

/**
 * REFERRAL — two-sided, server-confirmed, no leaderboard.
 *
 * The count is the server's (`GET /v1/rewards/referral` → total), not a local
 * guess. The first time this device sees a higher confirmed total it converts
 * each new friend into one airdrop entry + one bonus spin, and every third
 * cumulative friend into the current tier's soulbound animal badge. All of
 * that is device-local bookkeeping in lib/rewards/wheel.js; the qualification
 * itself is still decided by the rewards engine from a real invitee activity.
 */
export default function ReferralCard({ summary = null, online = false }) {
  const { t } = useTranslation();
  const { haptic, user } = useTelegram();
  const [share, shareSheet] = useShare();
  const hub = useRewardsHub();
  const points = useAppStore((s) => s.points);
  const referralsLocal = useAppStore((s) => s.referrals);
  const ensureRefCode = useAppStore((s) => s.ensureRefCode);
  const tier = tierFor(points);

  const refCode = useMemo(() => ensureRefCode(user?.id), [ensureRefCode, user?.id]);
  const inviteUrl = useMemo(() => siteInviteUrl(refCode), [refCode]);
  const code = summary?.code || refCode;

  const serverTotal = Number(summary?.referrals?.total);
  const confirmed = Math.max(
    Number.isFinite(serverTotal) ? serverTotal : 0,
    Number(referralsLocal) || 0,
    hub.refsSeen
  );

  const [justSynced, setJustSynced] = useState(null);
  const [joinedVia, setJoinedVia] = useState(false);

  /* Two-sided: if THIS install arrived through a friend's link, the invited
     side gets one airdrop entry, once. Device-local and clearly labelled. */
  useEffect(() => {
    const inviter = referredBy();
    if (inviter && grantInviteeBonus(inviter)) setJoinedVia(true);
  }, []);

  useEffect(() => {
    if (!online || !Number.isFinite(serverTotal)) return;
    if (serverTotal <= hub.refsSeen) return;
    const gained = syncConfirmedReferrals(serverTotal, tier.id);
    if (gained?.newRefs > 0) {
      setJustSynced(gained);
      if (gained.nftAdded) haptic?.('success');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, serverTotal, hub.refsSeen, tier.id]);

  const shareInvite = async () => {
    haptic?.('light');
    const result = await share({ url: inviteUrl, text: t('earn.shareText'), title: t('rewards.v2.referral.title') });
    if (!result?.ok) return;
    const state = useAppStore.getState();
    state.awardPoints('shareApp', POINT_VALUES.shareApp, { via: result.via });
    state.notify('pointsEarned', 'success');
    haptic?.('success');
  };

  const copy = async (value) => {
    const ok = await copyText(value);
    useAppStore.getState().notify(ok ? 'linkCopied' : 'copyFailed', ok ? 'success' : 'error');
    haptic?.(ok ? 'success' : 'error');
  };

  const toNextBadge = 3 - (confirmed % 3);
  const nextBadgeAt = confirmed + toNextBadge;

  return (
    <section className="rwd-card rwd-referral-card" id="rwd-referral">
      <header className="rwd-sec-head">
        <div>
          <div className="rwd-kicker">{t('rewards.v2.referral.kicker')}</div>
          <h3 className="rwd-sec-title">
            <IconUser width={17} height={17} style={{ color: 'var(--rgb-3)' }} />
            {t('rewards.v2.referral.title')}
          </h3>
        </div>
        <span className={`rwd-chip${online ? ' up' : ''}`}>
          {online ? t('rewards.v2.referral.confirmedChip', { n: confirmed }) : t('rewards.v2.referral.deviceChip')}
        </span>
      </header>

      <p className="rwd-prose">{t('rewards.v2.referral.sub')}</p>

      <div className="rwd-referral-stats">
        <div className="rwd-referral-stat">
          <div className="rwd-referral-stat-val">{confirmed}</div>
          <div className="rwd-referral-stat-key">{t('rewards.v2.referral.confirmed')}</div>
        </div>
        <div className="rwd-referral-stat">
          <div className="rwd-referral-stat-val">{hub.entries}</div>
          <div className="rwd-referral-stat-key">{t('rewards.v2.referral.entries')}</div>
        </div>
        <div className="rwd-referral-stat">
          <div className="rwd-referral-stat-val">{hub.bonusSpins}</div>
          <div className="rwd-referral-stat-key">{t('rewards.v2.referral.bonusSpins')}</div>
        </div>
      </div>

      <div className="rwd-referral-perks">
        <span className="rwd-pill rgb">✧ {t('rewards.v2.referral.perkEntry')}</span>
        <span className="rwd-pill amber">↻ {t('rewards.v2.referral.perkSpin')}</span>
        <span className="rwd-pill up">◈ {t('rewards.v2.referral.perkNft', { n: 3 })}</span>
      </div>

      <div className="rwd-referral-progress">
        <div className="rwd-referral-progress-head">
          <span>{t('rewards.v2.referral.nextBadge', { n: nextBadgeAt })}</span>
          <span className="mono">{toNextBadge}</span>
        </div>
        <div className="rwd-bar">
          <motion.span
            className="rwd-bar-fill"
            initial={{ width: 0 }}
            animate={{ width: `${Math.round(((3 - toNextBadge) / 3) * 100)}%` }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </div>

      <div className="rwd-refer-code">
        <span className="mono" dir="ltr">{inviteUrl}</span>
        <button type="button" className="rwd-icon-btn" onClick={() => void copy(inviteUrl)} aria-label={t('common.copy')}>
          <IconCopy width={14} height={14} />
        </button>
      </div>

      <div className="rwd-refer-actions">
        <button type="button" className="btn btn-primary" onClick={() => void shareInvite()}>
          <IconLink width={14} height={14} /> {t('earn.shareInvite')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void copy(code)}>
          <IconCopy width={14} height={14} /> {t('rewards.v2.referral.copyCode')}
        </button>
      </div>

      <div className="rwd-referral-owner">
        <TierTotem tier={tier.id} size={34} interactive={false} />
        <span>{t('rewards.v2.referral.tierNote', { tier: t(`rank.tier.${tier.id}`) })}</span>
      </div>

      {justSynced?.newRefs > 0 && (
        <motion.p
          className="rwd-referral-synced"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          ✓ {t('rewards.v2.referral.synced', { n: justSynced.newRefs })}
          {justSynced.nftAdded ? ` · ${t('rewards.v2.referral.syncedNft')}` : ''}
        </motion.p>
      )}

      {joinedVia && (
        <p className="rwd-referral-synced">
          ✧ {t('rewards.v2.referral.invitedBonus')}
        </p>
      )}

      <p className="rwd-fine">{t('rewards.v2.referral.note')}</p>
      <ShareSheet {...shareSheet} />
    </section>
  );
}
