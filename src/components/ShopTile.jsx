import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

/**
 * ONE BRAND, AS A CARD WITH REAL ARTWORK.
 * ---------------------------------------------------------------------------
 * Replaces a 34px logo beside 12px text. The instruction was
 * «هر خط یک عکس و زیرش خیلی کوچک نباشه» — one image per row with a label
 * under it that is not tiny — so the logo now gets a 16:9 stage on the
 * brand's own background colour and the name is 14px.
 *
 * ─── WHY THE BRAND'S OWN COLOUR IS USED AS THE BACKDROP ─────────────────────
 * Gift-card logos are supplied as transparent PNGs designed against the
 * brand's colour. Steam's is white-on-transparent: on our dark card it is
 * invisible, and on a white card it disappears too. `bg_color` comes from the
 * same API record and is validated server-side to a hex literal before it is
 * ever inlined here, so the artwork is shown the way it was drawn.
 */
export default function ShopTile({ brand, open, onClick }) {
  const { t } = useTranslation();
  /*
   * Logo failures are handled in state rather than by hiding the <img>.
   * Setting `display:none` in an onError leaves an empty coloured box, which
   * reads as a rendering bug; swapping to a monogram reads as a placeholder.
   */
  const [broken, setBroken] = useState(false);
  const showImg = brand.logo && !broken;

  return (
    <motion.button
      className="shop-tile"
      data-open={open ? 'true' : 'false'}
      data-stock={brand.outOfStock ? 'false' : 'true'}
      variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
      onClick={onClick}
    >
      <div className="shop-shot" style={{ '--shop-brand': brand.bg || 'var(--bg-raised)', background: brand.bg || 'var(--bg-raised)' }}>
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
          {brand.min && brand.max && (
            <div className="shop-tile-sub">
              {brand.min} – {brand.max}
            </div>
          )}
        </div>
        {/*
          Greying the artwork is not enough on its own — a dimmed logo can read
          as a slow image load. The word has to be there, so somebody hunting a
          brand learns it is unavailable rather than assuming we never had it.
        */}
        {brand.outOfStock ? (
          <span className="pill pill-down" style={{ fontSize: 10, flexShrink: 0 }}>
            {t('shop.outOfStock')}
          </span>
        ) : (
          <span className="shop-tile-go" aria-hidden="true">›</span>
        )}
      </div>
    </motion.button>
  );
}
