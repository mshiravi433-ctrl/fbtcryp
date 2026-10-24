import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { riseIn } from './PageTransition';
import { usePoints } from '../hooks/usePoints';
import { nextTier, tierFor, tierProgress } from '../lib/ranks';
import { perksFor } from '../lib/perks';

/**
 * RANK, IN THE SHOP — AN HONEST LOYALTY CHIP, NOT A POINTS SHOP.
 * ---------------------------------------------------------------------------
 * Phase 3 asked for the loyalty ladder to be visible where spending happens.
 * What it must NOT become is the part this repo already refused, twice:
 *
 *   · `src/lib/perks.js` — points are a RANK, never a currency. They are
 *     never spent, never deducted, never shown beside a money symbol, and no
 *     gift-card code is promised for them here or anywhere.
 *   · `src/lib/ranks.js` — there is no leaderboard to climb against; the
 *     comparison is with your own next tier only.
 *
 * So this card shows three true things: the tier you are on, the real perks
 * your rank unlocks (the venue's OWN referral discounts, same rows as
 * /rewards — computed by the same `perksFor()` the rewards screen reads), and
 * the distance to the next tier. One tap opens /rewards. It mints nothing,
 * deducts nothing, and disappears gracefully if the store has no points.
 */
export default function ShopLoyaltyCard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { points: rawPoints } = usePoints();
  const points = Number.isFinite(Number(rawPoints)) ? Math.max(0, Number(rawPoints)) : 0;

  const tier = tierFor(points);
  const next = nextTier(points);
  const progress = tierProgress(points);
  const perks = perksFor(points);
  const activePerks = perks.filter((p) => p.available);
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const locale = String(i18n?.resolvedLanguage || i18n?.language || 'en');
  const formattedPoints = useMemo(() => {
    try { return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(points); }
    catch { return String(Math.round(points)); }
  }, [locale, points]);

  return (
    <motion.section
      className="card shop-loyalty-card"
      variants={riseIn}
      initial="hidden"
      animate="show"
      aria-label={t('shop.loyalty.title')}
      data-testid="shop-loyalty-card"
    >
      <div className="shop-loyalty-topline">
        <div className="shop-loyalty-eyebrow">{t('shop.loyalty.title')}</div>
        <span className="shop-loyalty-points">{t('shop.loyalty.points', { n: formattedPoints })}</span>
      </div>

      <div className="shop-loyalty-head">
        <span className="shop-loyalty-medal" aria-hidden="true" style={{ borderColor: tier.color }}>
          {tier.icon}
        </span>
        <div className="shop-loyalty-title">
          <div className="shop-loyalty-name">
            {t(`rank.tier.${tier.id}`, { defaultValue: tier.id })}
          </div>
          <div className="shop-loyalty-sub">
            {next
              ? t('rank.toNext', { n: next.min - points, tier: t(`rank.tier.${next.id}`, { defaultValue: next.id }) })
              : t('rank.topTier')}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost shop-loyalty-btn"
          onClick={() => navigate('/rewards')}
        >
          {t('shop.loyalty.cta')}
        </button>
      </div>

      <div className="shop-loyalty-progress" role="img" aria-label={`${pct}%`}>
        <span className="shop-loyalty-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="shop-loyalty-perks">
        {activePerks.length > 0 ? (
          activePerks.slice(0, 2).map((p) => (
            <span key={p.id} className="shop-loyalty-perk">
              <IconTick />
              {t(`perks.item.${p.id}.title`)}
            </span>
          ))
        ) : (
          <span className="shop-loyalty-perk">{t('shop.loyalty.noPerkYet')}</span>
        )}
      </div>

      <p className="shop-loyalty-note faint">{t('shop.loyalty.note')}</p>
    </motion.section>
  );
}

function IconTick() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
