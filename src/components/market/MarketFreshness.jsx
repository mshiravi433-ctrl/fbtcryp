import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { freshness } from '../../lib/marketList';

/**
 * «قیمت‌های زنده» — HOW OLD THE FEED IS, IN ITS OWN COMPONENT.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS IS A COMPONENT AND NOT A `useState` IN Market.jsx ─────────────
 * The market screen re-rendered ITSELF every ten seconds to move one number:
 * a clock lived in the page, and the page's only use for it was the
 * «۱۵ ثانیه پیش» chip in the lens head. Everything else on the screen came
 * along for the ride — the stories reel (a dozen hand-drawn SVG scenes), the
 * search field and its result list, the sector rail, the sort popover, and 60
 * memoised rows each re-compared field by field — six times a minute, forever,
 * on the app's home screen, while the reader was trying to scroll it.
 *
 * A memoised child stops that at the source: the clock ticks HERE, this
 * component re-renders a `<span>`, and the page above it does not re-render at
 * all. The number, its rounding (5s steps), its 90s staleness rule and its
 * markup are byte-identical to what the page used to draw — see
 * lib/marketList.js `freshness()` for the honesty rules (a feed that stopped
 * answering must stop calling itself live).
 */
const TICK_MS = 10_000;

function MarketFreshness({ updatedAt }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    /*
     * A background tab throttles `setInterval` to a minute or pauses it, so the
     * chip would come back to a foregrounded screen still claiming the age it
     * had when the tab was hidden. One read on visibility is enough to correct
     * it, and it costs nothing while the tab is open.
     */
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const fresh = freshness(updatedAt, now);
  if (!fresh) return null;

  return (
    <span
      className="market-fresh mx-fresh mono"
      data-stale={fresh.stale ? 'true' : 'false'}
      data-testid="market-freshness"
      title={t('market.freshTitle')}
    >
      <i aria-hidden="true" />
      {fresh.stale
        ? t('market.updatedStale', { minutes: Math.max(1, fresh.minutes) })
        : t('market.updatedAgo', { seconds: fresh.seconds })}
    </span>
  );
}

export default memo(MarketFreshness);
