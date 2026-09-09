import AssetIcon from '../AssetIcon.jsx';
import { KIND_ACCENTS, poolLegs, protocolMark } from '../../lib/protocolMarks.js';

/**
 * PoolGlyph — the protocol's own tile in front of a pool's name.
 * ---------------------------------------------------------------------------
 * Deterministic (see lib/protocolMarks.js for why nothing is fetched): the same
 * protocol gets the same colours, letter and accent on every render, online or
 * not, and never an empty box.
 *
 * `chainKey` puts a network coin on the corner of the tile — the one piece of
 * information that was being used as the whole icon before. `poolLegs` is the
 * fallback badge: a two-token pool shows its second asset instead, because
 * "which chain" is already written in the row's meta line.
 */
export default function PoolGlyph({ pool, size = 34, chainKey = null, showBadge = true, className = '', style }) {
  const mark = protocolMark(pool?.project);
  const accent = KIND_ACCENTS[mark.accent] || KIND_ACCENTS.pool;
  const legs = poolLegs(pool, 2);
  const radius = Math.max(6, Math.round(size * 0.3));
  const badgeSize = Math.max(12, Math.round(size * 0.46));
  const badge = !showBadge ? null : chainKey ? <AssetIcon chain={chainKey} size={badgeSize} className="farm-glyph-coin" />
    : legs.length > 1 ? <AssetIcon symbol={legs[1]} size={badgeSize} className="farm-glyph-coin" /> : null;

  return (
    <span
      className={`farm-glyph${mark.known ? ' farm-glyph-known' : ''}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundImage: `linear-gradient(150deg, ${mark.from}, ${mark.to})`,
        ...style
      }}
    >
      {/* One SVG for both layers: the accent is the watermark, the letter is the
          mark. A <text> is used rather than a stacked DOM node so the whole tile
          scales as a unit inside the 34px slot the row already reserves. */}
      <svg viewBox="0 0 32 32" className="farm-glyph-art" focusable="false">
        <path className="farm-glyph-accent" d={accent} />
        <text className="farm-glyph-letter" x="16" y="17" style={{ fontSize: Math.round(size * 0.46) }}>
          {mark.letter}
        </text>
      </svg>
      {badge ? <span className="farm-glyph-badge" style={{ width: badgeSize, height: badgeSize }}>{badge}</span> : null}
    </span>
  );
}
