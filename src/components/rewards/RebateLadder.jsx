import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import TierTotem from './TierTotem';
import { FBT_TIERS, fbtFromPoints, fbtTier } from '../../lib/fbt';
import { perksFor } from '../../lib/perks';
import { fmtNum } from '../../lib/format';
import { copyText } from '../../lib/share';
import { useAppStore } from '../../store/useAppStore';
import { useTelegram } from '../../context/TelegramContext';
import { IconCopy, IconLock, IconShield } from '../Icons';

/**
 * FBT LADDER + VENUE PERKS.
 *
 * Two real tables, no invented numbers:
 *   · FBT_TIERS.feeBps — the fee-discount ladder from lib/fbt.js, including
 *     its own honest status: defined, exported, NOT yet wired into the live
 *     swap router. The card says "planned", because claiming it was live would
 *     be the precise lie that module warns about.
 *   · perksFor(points) — venue codes that are only rendered when the code is
 *     actually configured. Points are never spent, so using a perk cannot
 *     demote the rank that unlocked it.
 *
 * No outbound venue links are rendered here (the page brief forbids them);
 * the action is copying the real code, which the user can use wherever they
 * already trade.
 */
export default function RebateLadder({ points }) {
  const { t } = useTranslation();
  const { haptic } = useTelegram();
  const perks = useMemo(() => perksFor(points), [points]);
  const fbt = fbtFromPoints(points);
  const balance = useMemo(() => fbtTier(fbt), [fbt]);
  const currentId = balance.tier.id;

  const copy = async (code) => {
    const ok = await copyText(code);
    useAppStore.getState().notify(ok ? 'linkCopied' : 'copyFailed', ok ? 'success' : 'error');
    haptic?.(ok ? 'success' : 'error');
  };

  return (
    <section className="rwd-card rwd-rebate-card" id="rwd-perks">
      <header className="rwd-sec-head">
        <div>
          <div className="rwd-kicker">{t('rewards.v2.rebate.kicker')}</div>
          <h3 className="rwd-sec-title">
            <IconShield width={17} height={17} style={{ color: 'var(--rgb-2)' }} />
            {t('rewards.v2.rebate.title')}
          </h3>
        </div>
        <span className="rwd-chip">{t('rewards.v2.rebate.levelChip', { tier: t(`fbt.tier.${currentId}`) })}</span>
      </header>

      <p className="rwd-prose">{t('rewards.v2.rebate.sub')}</p>

      <div className="rwd-ladder">
        {FBT_TIERS.map((row) => {
          const active = row.id === currentId;
          const reached = fbt >= row.min;
          return (
            <div key={row.id} className={`rwd-ladder-row${active ? ' active' : ''}${reached ? ' reached' : ''}`}>
              <span className="rwd-ladder-dot" />
              <div className="rwd-ladder-tier">
                <span className="rwd-ladder-name">{t(`fbt.tier.${row.id}`)}</span>
                <span className="rwd-ladder-min">{fmtNum(row.min, 0)} FBT</span>
              </div>
              <span className="rwd-ladder-bps">−{row.feeBps} bps</span>
              {active && <span className="rwd-ladder-now">{t('rewards.v2.rebate.youAreHere')}</span>}
            </div>
          );
        })}
      </div>

      {balance.next && (
        <div className="rwd-ladder-progress">
          <div className="rwd-referral-progress-head">
            <span>{t('rewards.v2.rebate.toNext', { n: fmtNum(balance.toNext, 0), tier: t(`fbt.tier.${balance.next.id}`) })}</span>
            <span className="mono">{Math.round(balance.progress * 100)}%</span>
          </div>
          <div className="rwd-bar">
            <motion.span
              className="rwd-bar-fill"
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(balance.progress * 100)}%` }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </div>
      )}

      <p className="rwd-fine">{t('rewards.v2.rebate.planned')}</p>

      <div className="rwd-perks-head">
        <h4>{t('perks.title')}</h4>
        <span className="rwd-pill">{t('rewards.v2.rebate.perksAvailable', { n: perks.filter((p) => p.available).length })}</span>
      </div>
      <p className="rwd-prose">{t('rewards.v2.rebate.perksSub')}</p>

      <div className="rwd-perks">
        {perks.map((pk) => (
          <div
            key={pk.id}
            className={`rwd-perk${pk.available ? ' unlocked' : ''}`}
            style={{ '--pk': pk.tierColor }}
          >
            <div className="rwd-perk-medal">
              <TierTotem tier={pk.tier} size={44} idle={pk.available} interactive={false} locked={!pk.available} />
            </div>
            <div className="rwd-perk-title">{t(`perks.item.${pk.id}.title`)}</div>
            <div className="rwd-perk-desc">{t(`perks.item.${pk.id}.desc`)}</div>

            {pk.available ? (
              <button type="button" className="btn btn-ghost btn-sm rwd-perk-copy" onClick={() => void copy(pk.code)}>
                <IconCopy width={13} height={13} /> {t('perks.copyCode', { code: pk.code })}
              </button>
            ) : !pk.unlocked ? (
              <p className="rwd-perk-lock">
                <IconLock width={11} height={11} /> {t('perks.locked', { n: fmtNum(pk.pointsToGo, 0), tier: t(`rank.tier.${pk.tier}`) })}
              </p>
            ) : (
              <p className="rwd-perk-lock">{t('perks.notReady')}</p>
            )}
          </div>
        ))}
      </div>

      <p className="rwd-fine">{t('rewards.v2.rebate.perksNote')}</p>
    </section>
  );
}
