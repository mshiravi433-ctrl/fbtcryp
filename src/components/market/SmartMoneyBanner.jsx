import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * Compact Smart Money entry point. The artwork is an abstract SVG data field,
 * not a chart: it carries no numbers and cannot be mistaken for live data.
 * Motion is transform/opacity only and stops for reduced-motion/native shells.
 */
function SmartMoneyBanner() {
  const { t } = useTranslation();
  return (
    <section className="mx-smart-banner" aria-labelledby="mx-smart-title" data-testid="market-smart-money-banner">
      <div className="mx-smart-copy">
        <span className="mx-smart-eyebrow mono">FBT SMART MONEY</span>
        <h2 id="mx-smart-title">{t('marketIntel.smartTitle')}</h2>
        <p>{t('marketIntel.smartDesc')}</p>
        <Link className="mx-smart-cta" to="/smart-money">
          <span>{t('marketIntel.smartCta')}</span>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9m-4-4 4 4-4 4" /></svg>
        </Link>
      </div>
      <div className="mx-smart-art" aria-hidden="true">
        <svg viewBox="0 0 360 180" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="mx-smart-plane" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.34" />
              <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.08" />
            </linearGradient>
            <linearGradient id="mx-smart-edge" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.1" />
              <stop offset="50%" stopColor="#93c5fd" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0.2" />
            </linearGradient>
            <radialGradient id="mx-smart-node">
              <stop offset="0%" stopColor="#dbeafe" />
              <stop offset="45%" stopColor="#60a5fa" />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity="0" />
            </radialGradient>
          </defs>
          <g className="mx-smart-planes">
            <path d="M58 118 180 58l122 60-122 60Z" fill="url(#mx-smart-plane)" stroke="url(#mx-smart-edge)" />
            <path d="M58 96 180 36l122 60-122 60Z" fill="none" stroke="url(#mx-smart-edge)" strokeOpacity="0.55" />
            <path d="M58 74 180 14l122 60-122 60Z" fill="none" stroke="url(#mx-smart-edge)" strokeOpacity="0.28" />
          </g>
          <g className="mx-smart-links" fill="none" stroke="url(#mx-smart-edge)" strokeWidth="1.2">
            <path d="M96 96 180 54l84 42M180 54v64M96 96l84 42 84-42" />
            <path d="M138 75v42M222 75v42M138 117l42 21 42-21" strokeOpacity="0.55" />
          </g>
          <g className="mx-smart-nodes">
            {[[96, 96], [180, 54], [264, 96], [180, 138], [138, 75], [222, 117]].map(([cx, cy], index) => (
              <g key={`${cx}-${cy}`} className="mx-smart-node" style={{ animationDelay: `${index * -0.7}s` }}>
                <circle cx={cx} cy={cy} r="10" fill="url(#mx-smart-node)" opacity="0.5" />
                <circle cx={cx} cy={cy} r="2.6" fill="#bfdbfe" />
              </g>
            ))}
          </g>
          <g className="mx-smart-bars" fill="#60a5fa">
            <rect x="160" y="86" width="6" height="24" rx="2" opacity="0.55" />
            <rect x="172" y="72" width="6" height="38" rx="2" opacity="0.8" />
            <rect x="184" y="80" width="6" height="30" rx="2" opacity="0.65" />
            <rect x="196" y="62" width="6" height="48" rx="2" opacity="0.9" />
          </g>
        </svg>
      </div>
    </section>
  );
}

export default memo(SmartMoneyBanner);
