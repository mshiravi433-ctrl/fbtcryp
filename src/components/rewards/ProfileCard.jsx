import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TierTotem, { TIER_ANIMALS } from './TierTotem';
import { useAppStore } from '../../store/useAppStore';
import { useTelegram } from '../../context/TelegramContext';
import { TIERS, tierFor } from '../../lib/ranks';
import { useRewardsHub } from '../../lib/rewards/wheel';
import { siteInviteUrl } from '../../lib/referral';
import { copyText } from '../../lib/share';
import { IconCopy, IconLink, IconSparkle } from '../Icons';

/**
 * POINTS PROFILE — the shareable card.
 *
 * Everything printed on it is real: points, tier, streak, badge count, entry
 * count and the referral link. It never carries a fiat value, a token price or
 * a "cashable" promise, and the FBT line at the bottom states the loyalty
 * boundary even in a screenshot shared outside the app.
 *
 * The image path is lazy: `lib/screenShare` imports html-to-image only on tap,
 * so the 7 kB renderer is not in the entry chunk for users who never share.
 */
export default function ProfileCard({ referrals = 0 }) {
  const { t } = useTranslation();
  const { haptic, user } = useTelegram();
  const cardRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(null);

  const points = useAppStore((s) => s.points);
  const streak = useAppStore((s) => s.streak);
  const ensureRefCode = useAppStore((s) => s.ensureRefCode);
  const hub = useRewardsHub();
  const tier = tierFor(points);
  const refCode = useMemo(() => ensureRefCode(user?.id), [ensureRefCode, user?.id]);
  const inviteUrl = useMemo(() => siteInviteUrl(refCode), [refCode]);

  const notify = (key, kind) => useAppStore.getState().notify(key, kind);

  const shareImage = async () => {
    if (busy) return;
    setBusy(true);
    haptic?.('light');
    try {
      const { captureScreen, shareScreenshot } = await import('../../lib/screenShare');
      const shot = await captureScreen({ node: cardRef.current, maxWidth: 1080 });
      if (!shot.ok) {
        notify('rewards.v2.profile.shareFailed', 'error');
        return;
      }
      const result = await shareScreenshot({
        blob: shot.blob,
        title: t('rewards.v2.profile.title'),
        text: t('rewards.v2.profile.shareText', { points, tier: t(`rank.tier.${tier.id}`) }),
        url: inviteUrl,
        filename: 'fbt-points-profile.png'
      });
      if (result.ok) {
        setShared(result.via);
        haptic?.('success');
        if (result.via === 'download') notify('rewards.v2.profile.saved', 'success');
      } else if (result.reason !== 'DISMISSED') {
        notify('rewards.v2.profile.shareFailed', 'error');
      }
    } catch {
      notify('rewards.v2.profile.shareFailed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const ok = await copyText(inviteUrl);
    notify(ok ? 'linkCopied' : 'copyFailed', ok ? 'success' : 'error');
    haptic?.(ok ? 'success' : 'error');
  };

  return (
    <section className="rwd-card rwd-profile-card" id="rwd-profile">
      <header className="rwd-sec-head">
        <div>
          <div className="rwd-kicker">{t('rewards.v2.profile.kicker')}</div>
          <h3 className="rwd-sec-title">
            <IconSparkle width={17} height={17} style={{ color: 'var(--rgb-3)' }} />
            {t('rewards.v2.profile.title')}
          </h3>
        </div>
        <span className="rwd-chip">{t('rewards.v2.profile.chip')}</span>
      </header>

      <p className="rwd-prose">{t('rewards.v2.profile.sub')}</p>

      <div className="rwd-profile-frame" ref={cardRef} style={{ '--tier': tier.color }}>
        <div className="rwd-profile-noise" aria-hidden="true" />
        <div className="rwd-profile-holo" aria-hidden="true" />
        <div className="rwd-profile-top">
          <span className="rwd-profile-brand">FBT · POINTS</span>
          <span className="rwd-profile-tier">{t(`rank.tier.${tier.id}`)}</span>
        </div>
        <div className="rwd-profile-main">
          <TierTotem tier={tier.id} size={104} />
          <div className="rwd-profile-stats">
            <div className="rwd-profile-points">{points}</div>
            <div className="rwd-profile-points-key">{t('rewards.v2.profile.points')}</div>
            <div className="rwd-profile-mini">
              <span>🔥 {streak}</span>
              <span>◈ {hub.nfts.length}/{TIERS.length}</span>
              <span>✧ {hub.entries}</span>
              <span>☍ {referrals}</span>
            </div>
          </div>
        </div>
        <div className="rwd-profile-bottom">
          <span className="mono" dir="ltr">{inviteUrl}</span>
          <span className="rwd-profile-animal">{t(`rewards.v2.animals.${TIER_ANIMALS[tier.id]}`)}</span>
        </div>
        <div className="rwd-profile-legal">{t('rewards.v2.profile.legal')}</div>
      </div>

      <div className="rwd-profile-actions" data-screenshot-ignore>
        <button type="button" className="btn btn-primary" onClick={() => void shareImage()} disabled={busy}>
          <IconLink width={14} height={14} /> {busy ? t('rewards.v2.profile.rendering') : t('rewards.v2.profile.share')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void copy()}>
          <IconCopy width={14} height={14} /> {t('common.copy')}
        </button>
      </div>

      {shared === 'download' && <p className="rwd-fine">{t('rewards.v2.profile.savedHint')}</p>}
      <p className="rwd-fine">{t('rewards.v2.profile.note')}</p>
    </section>
  );
}
