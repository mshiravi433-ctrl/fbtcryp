import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { IconArrowUpRight, IconStar } from './ShopIcons';

/**
 * ONE BRAND, AS A POSTER — the shelf's smallest unit of desire.
 * ---------------------------------------------------------------------------
 * Three layers do the work, and none of them is a new image request:
 *
 *   1. The brand's own `bg` colour is the stage. Transparent PNG logos (the
 *      white-on-transparent Steam wordmark, for instance) stay legible on
 *      both themes because the stage is their colour, not ours.
 *   2. A faint monogram of the brand's initials sits BEHIND the logo like a
 *      watermark on a printed card. When a logo file is missing the monogram
 *      simply becomes the artwork, so a 404 never leaves a grey hole.
 *   3. A one-pixel sheen sweeps across the stage on hover — pure CSS, opacity
 *      and transform only, switched off under `prefers-reduced-motion` (see
 *      `.shop-tile-shine` in shop-modern.css). It costs the compositor
 *      nothing when idle and never runs while the card is off-screen.
 *
 * When `onTogglePin` is passed, the favourite star sits as a sibling
 * `<button>` inside `.shop-tile-wrap` so HTML5 button nesting rules hold and
 * tapping the star never triggers `onClick` on `.shop-tile`.
 */
export default function ShopTile({
  brand,
  open,
  onClick,
  pinned = false,
  onTogglePin = null
}) {
  const { t } = useTranslation();
  const [broken, setBroken] = useState(false);
  const showImg = brand.logo && !broken;
  const monogram = brand.name.slice(0, 2).toUpperCase();

  return (
    <div className="shop-tile-wrap" data-pinned={pinned ? 'true' : 'false'}>
      <motion.button
        type="button"
        className="shop-tile"
        data-open={open ? 'true' : 'false'}
        data-stock={brand.outOfStock ? 'false' : 'true'}
        variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
        onClick={onClick}
      >
        <div
          className="shop-shot"
          style={{
            '--shop-brand': brand.bg || 'var(--bg-raised)',
            background: brand.bg || 'var(--bg-raised)'
          }}
        >
          <span className="shop-shot-mark" aria-hidden="true">{monogram}</span>
          <span className="shop-digital-badge">
            <i aria-hidden="true" />
            {t('shop.digital')}
          </span>
          {showImg ? (
            <img src={brand.logo} alt="" loading="lazy" onError={() => setBroken(true)} />
          ) : (
            <span className="shop-shot-fb">{monogram}</span>
          )}
          <span className="shop-tile-shine" aria-hidden="true" />
        </div>
        <div className="shop-tile-body">
          <div className="shop-tile-copy">
            <div className="shop-tile-name">{brand.name}</div>
            {brand.min && brand.max ? (
              <div className="shop-tile-sub" dir="ltr">
                {brand.min} – {brand.max}
              </div>
            ) : brand.min ? (
              <div className="shop-tile-sub" dir="ltr">
                {brand.min}
              </div>
            ) : null}
          </div>
          {brand.outOfStock ? (
            <span className="pill pill-down shop-tile-stock" style={{ fontSize: 10, flexShrink: 0 }}>
              {t('shop.outOfStock')}
            </span>
          ) : (
            <span className="shop-tile-go" aria-hidden="true">
              <IconArrowUpRight width={13} height={13} />
            </span>
          )}
        </div>
      </motion.button>
      {typeof onTogglePin === 'function' && (
        <button
          type="button"
          className="shop-pin-btn"
          data-pinned={pinned ? 'true' : 'false'}
          aria-pressed={Boolean(pinned)}
          aria-label={t(pinned ? 'shop.fav.remove' : 'shop.fav.add', { brand: brand.name })}
          title={t(pinned ? 'shop.fav.remove' : 'shop.fav.add', { brand: brand.name })}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(brand);
          }}
        >
          <IconStar width={14} height={14} filled={pinned} />
        </button>
      )}
    </div>
  );
}
