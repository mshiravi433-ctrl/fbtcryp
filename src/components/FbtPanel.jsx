import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import InfoBox from './InfoBox';
import { useAppStore } from '../store/useAppStore';
import { FBT_TIERS, fbtFromPoints, fbtTier } from '../lib/fbt';
import { fmtNum } from '../lib/format';

/**
 * THE FBT BALANCE.
 * ---------------------------------------------------------------------------
 * Shows the loyalty balance that `points` has been accruing all along, with
 * the benefits it unlocks and — prominently, not in a footnote — the fact that
 * it is not a tradable coin.
 *
 * ─── WHY THE DISCLAIMER IS NOT COLLAPSED ────────────────────────────────────
 * Every other explainer on these screens folds into an InfoBox, and the rule
 * from InfoBox's own header is that anything describing what a control will DO
 * stays visible while explanations collapse.
 *
 * "This is not a tradable coin" is the first kind. A balance with a symbol and
 * a tier ladder looks exactly like a token; if a user concludes they own
 * something sellable, that misunderstanding survives until it costs them, and
 * it is the one claim that would turn a discount scheme into an unregistered
 * offering. So it is one short line, always on screen, directly under the
 * number.
 */
export default function FbtPanel() {
  const { t } = useTranslation();
  const points = useAppStore((s) => s.points);

  const balance = fbtFromPoints(points);
  const { tier, next, toNext, progress } = useMemo(() => fbtTier(balance), [balance]);

  return (
    <motion.section
      className="fbt-card"
      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
      initial="hidden"
      animate="show"
    >
      <div className="fbt-glow" aria-hidden="true" />

      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div>
          <p className="fbt-label">{t('fbt.title')}</p>
          <div className="fbt-amount">
            <span className="fbt-num">{fmtNum(balance, 0)}</span>
            <span className="fbt-sym">FBT</span>
          </div>
        </div>
        <span className="fbt-tier" data-tier={tier.id}>{t(`fbt.tier.${tier.id}`)}</span>
      </div>

      {/*
        The one sentence that must never be behind a tap. See the note above.
      */}
      <p className="fbt-note">{t('fbt.notCoin')}</p>

      {/* Progress through the CURRENT band — a bar measured against the final
          tier barely moves and reads as broken. */}
      {next && (
        <>
          <div className="fbt-bar">
            <motion.i
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(progress * 100)}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            />
          </div>
          <p className="fbt-next">
            {t('fbt.toNext', { n: fmtNum(toNext, 0), tier: t(`fbt.tier.${next.id}`) })}
          </p>
        </>
      )}

      <div className="fbt-perks">
        {/*
          Only benefits we can deliver alone. Anything needing a third party's
          permission would be one more promise that depends on somebody else's
          API staying up.
        */}
        <div className="fbt-perk" data-on={tier.feeBps > 0}>
          <span className="fbt-perk-v">−{tier.feeBps} bps</span>
          <span className="fbt-perk-k">{t('fbt.perkFee')}</span>
        </div>
        <div className="fbt-perk" data-on={tier.adDays > 0}>
          <span className="fbt-perk-v">{tier.adDays > 0 ? `${tier.adDays}d` : '—'}</span>
          <span className="fbt-perk-k">{t('fbt.perkAd')}</span>
        </div>
      </div>

      <InfoBox title={t('fbt.howTitle')} tone="info" id="fbt-how">
        <ul className="shop-limits">
          {['h1', 'h2', 'h3', 'h4'].map((k) => (
            <li key={k}>{t(`fbt.how.${k}`)}</li>
          ))}
        </ul>
        <p className="section-label" style={{ marginTop: 12 }}>{t('fbt.ladder')}</p>
        <ul className="shop-limits">
          {FBT_TIERS.filter((x) => x.min > 0).map((x) => (
            <li key={x.id}>
              {t('fbt.ladderRow', {
                tier: t(`fbt.tier.${x.id}`),
                n: fmtNum(x.min, 0),
                bps: x.feeBps
              })}
            </li>
          ))}
        </ul>
      </InfoBox>
    </motion.section>
  );
}
