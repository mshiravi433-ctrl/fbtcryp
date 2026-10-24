import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { IconStar } from './ShopIcons';

/**
 * ONE BRAND, AS A LUXURY DIGITAL CARD WITH REAL ARTWORK.
 * ---------------------------------------------------------------------------
 * The brand's validated `bg` colour frames the 16:9 / 4:3 stage so transparent
 * PNG logos (like white-on-transparent Steam) always remain legible across
 * both dark and light themes.
 *
 * When `onTogglePin` is passed, the favorite star sits as a sibling `<button>`
 * inside `.shop-tile-wrap` so HTML5 button nesting rules hold and tapping the
 * star never triggers `onClick` on `.shop-tile`.
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
          <span className="shop-digital-badge">{t('shop.digital')}</span>
          {showImg ? (
            <img src={brand.logo} alt="" loading="lazy" onError={() => setBroken(true)} />
          ) : (
            <span className="shop-shot-fb">{brand.name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="shop-tile-body">
          <div style={{ minWidth: 0, flex: 1 }}>
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
            <span className="pill pill-down" style={{ fontSize: 10, flexShrink: 0 }}>
              {t('shop.outOfStock')}
            </span>
          ) : (
            <span className="shop-tile-go" aria-hidden="true">›</span>
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
