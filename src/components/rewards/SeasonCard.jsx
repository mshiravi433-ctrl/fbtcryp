import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { SEASON, seasonIsLive } from '../../lib/rewards/season';
import { useRewardsHub } from '../../lib/rewards/wheel';
import { IconShield, IconSparkle } from '../Icons';

/**
 * AIRDROP SEASON — honest by construction.
 *
 * `seasonIsLive()` requires BOTH a funded flag and a pool description supplied
 * by the operator. Without them this card states that entries are being
 * collected and that nothing is promised; it never shows a token amount, a USD
 * value or a date. There is deliberately no "enter" button: entries accrue
 * automatically from wheel/referral/focus/tier-box events on this device.
 */
export default function SeasonCard() {
  const { t } = useTranslation();
  const hub = useRewardsHub();
  const live = seasonIsLive();

  const sources = [
    t('rewards.v2.season.source.wheel'),
    t('rewards.v2.season.source.referral'),
    t('rewards.v2.season.source.focus'),
    t('rewards.v2.season.source.box')
  ];

  return (
    <section
      className={`rwd-card rwd-season-card${live ? ' live' : ''}`}
      id="rwd-season"
      style={{ '--season-tone': live ? 'var(--rgb-4)' : 'var(--rgb-5)' }}
    >
      <div className="rwd-season-aura" aria-hidden="true" />
      <header className="rwd-sec-head">
        <div>
          <div className="rwd-kicker">{t('rewards.v2.season.kicker')}</div>
          <h3 className="rwd-sec-title">
            <IconShield width={17} height={17} style={{ color: 'var(--season-tone)' }} />
            {t('rewards.v2.season.title')}
          </h3>
        </div>
        <span className={`rwd-chip${live ? ' up' : ' amber'}`}>
          {live ? t('rewards.v2.season.fundedChip') : t('rewards.v2.season.notFundedChip')}
        </span>
      </header>

      <div className="rwd-season-body">
        <div className="rwd-season-count">
          <motion.div
            className="rwd-season-count-val"
            key={hub.entries}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {hub.entries}
          </motion.div>
          <div className="rwd-season-count-key">{t('rewards.v2.season.entries')}</div>
          <div className="rwd-season-orbit" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, index) => (
              <i key={index} style={{ transform: `rotate(${index * 60}deg) translateY(-34px)`, animationDelay: `${index * -0.4}s` }} />
            ))}
          </div>
        </div>

        <div className="rwd-season-copy">
          {live ? (
            <>
              <div className="rwd-season-status up">{t('rewards.v2.season.fundedTitle')}</div>
              <p className="rwd-prose">
                {t('rewards.v2.season.fundedBody', { pool: SEASON.pool ?? '' })}
                {SEASON.tokenSymbol ? ` ${t('rewards.v2.season.tokenNote', { token: SEASON.tokenSymbol })}` : ''}
              </p>
            </>
          ) : (
            <>
              <div className="rwd-season-status">{t('rewards.v2.season.notFundedTitle')}</div>
              <p className="rwd-prose">{t('rewards.v2.season.notFundedBody')}</p>
            </>
          )}
          <ul className="rwd-season-sources">
            {sources.map((source) => (
              <li key={source}>
                <IconSparkle width={11} height={11} /> {source}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="rwd-fine">{t('rewards.v2.season.note')}</p>
    </section>
  );
}
