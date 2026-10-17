import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

/**
 * THE DOCK — the rewards tab's sub-navigation.
 * ---------------------------------------------------------------------------
 * The tab used to be one very long page: wheel, streak, missions, referral,
 * badges, lessons, focus, season, ladder, profile and history all stacked on
 * top of each other, with a rail of chips that only scrolled the page. The
 * user had to hunt for the thing they wanted.
 *
 * The dock replaces that rail with a real switcher: a horizontally scrollable
 * glass bar where every chip opens ITS section and nothing else is mounted.
 * One tap, one section, no scroll-hunting.
 *
 * A sticky pill indicator (framer-motion `layoutId`) slides between the chips
 * so the eye always knows where it is, and the active chip lifts its icon
 * into the tier gradient.
 */
export default function RewardsSubNav({ items, active, onSelect, badgeOf }) {
  const { t } = useTranslation();

  return (
    <nav className="rwd-dock" aria-label={t('rewards.v2.quicknav')}>
      <div className="rwd-dock-rail" role="tablist">
        {items.map((item) => {
          const on = item.id === active;
          const count = badgeOf?.(item.id);
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={on}
              className={`rwd-dock-item${on ? ' active' : ''}`}
              onClick={() => onSelect(item.id)}
            >
              {on && (
                <motion.span
                  layoutId="rwd-dock-ind"
                  className="rwd-dock-ind"
                  transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                />
              )}
              <span className="rwd-dock-ico">
                <item.Icon width={15} height={15} aria-hidden="true" />
                {count ? <em className="rwd-dock-dot" aria-hidden="true" /> : null}
              </span>
              <span className="rwd-dock-label">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
