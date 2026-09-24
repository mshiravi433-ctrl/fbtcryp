import { useId } from 'react';

/*
 * SmartWalletIcons — gradient, lightly-animated SVG icons for the Smart Wallet
 * «Intent OS rules» box and the session-key card. They replace the emoji
 * (⚡ ⛓ 📊 🛡 🔒 🧾 ⏱) that rendered differently on every OS and looked flat.
 *
 * Every gradient id is namespaced with useId() so icons can repeat on a page
 * without stealing each other's paint. Animations live in smart-wallet-icons.css
 * and are switched off by prefers-reduced-motion.
 */

function useGid(prefix) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (n) => `${prefix}${raw}${n}`;
}

function Tile({ tone = 'cyan', size = 30, children, className = '' }) {
  return (
    <span className={`swi-tile swi-${tone} ${className}`} style={{ width: size, height: size, minWidth: size }} aria-hidden="true">
      {children}
    </span>
  );
}

/* Intent OS — brain/spark node graph with a travelling pulse */
export function IconIntentOS({ size = 40 }) {
  const g = useGid('swio');
  return (
    <Tile tone="hero" size={size} className="swi-hero">
      <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 32 32" fill="none">
        <defs>
          <linearGradient id={g('a')} x1="3" y1="3" x2="29" y2="29" gradientUnits="userSpaceOnUse">
            <stop stopColor="#5EF6FF" />
            <stop offset="0.55" stopColor="#8B7CFF" />
            <stop offset="1" stopColor="#FF5EA8" />
          </linearGradient>
        </defs>
        <g className="swi-spin" style={{ transformOrigin: '16px 16px' }}>
          <circle cx="16" cy="16" r="13" stroke={`url(#${g('a')})`} strokeWidth="1.2" strokeDasharray="3 3.8" opacity="0.7" />
        </g>
        <path d="M9 11.5 16 7l7 4.5v9L16 25l-7-4.5z" stroke={`url(#${g('a')})`} strokeWidth="1.6" strokeLinejoin="round" fill="rgba(139,124,255,0.14)" />
        <path d="M9 11.5 16 16l7-4.5M16 16v9" stroke={`url(#${g('a')})`} strokeWidth="1.3" strokeLinejoin="round" opacity="0.85" />
        <path className="swi-bolt" d="M17.2 9.6 13.6 16h3l-.8 5.2 3.8-6.6h-3.1z" fill="#FFE66B" stroke="#1A1033" strokeWidth="0.5" strokeLinejoin="round" />
        <circle r="1.4" fill="#5EF6FF">
          <animateMotion dur="3.2s" repeatCount="indefinite" path="M9 11.5 16 7l7 4.5v9L16 25l-7-4.5z" />
        </circle>
      </svg>
    </Tile>
  );
}

/* Preferred chain — two interlocking links with a moving highlight */
export function IconChain({ size = 30 }) {
  const g = useGid('swch');
  return (
    <Tile tone="cyan" size={size}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id={g('a')} x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor="#5EF6FF" />
            <stop offset="1" stopColor="#3A8BFF" />
          </linearGradient>
        </defs>
        <rect x="2.5" y="8.2" width="11" height="7.6" rx="3.8" stroke={`url(#${g('a')})`} strokeWidth="2" transform="rotate(-35 8 12)" />
        <rect x="10.5" y="8.2" width="11" height="7.6" rx="3.8" stroke={`url(#${g('a')})`} strokeWidth="2" transform="rotate(-35 16 12)" />
        <circle className="swi-blink" cx="12" cy="12" r="1.5" fill="#E4FF6B" />
      </svg>
    </Tile>
  );
}

/* Max slippage — gauge with a swinging needle */
export function IconSlippage({ size = 30 }) {
  const g = useGid('swsl');
  return (
    <Tile tone="violet" size={size}>
      <svg width={size * 0.64} height={size * 0.64} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id={g('a')} x1="3" y1="18" x2="21" y2="18" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3AE8B0" />
            <stop offset="0.55" stopColor="#FFD66B" />
            <stop offset="1" stopColor="#FF5E7E" />
          </linearGradient>
        </defs>
        <path d="M3.5 17a8.5 8.5 0 0 1 17 0" stroke={`url(#${g('a')})`} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M6 17h.01M12 8.5v.01M18 17h.01" stroke="#fff" strokeOpacity="0.5" strokeWidth="1.6" strokeLinecap="round" />
        <g className="swi-needle" style={{ transformOrigin: '12px 17px' }}>
          <path d="M12 17 15.6 11" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </g>
        <circle cx="12" cy="17" r="1.8" fill="#fff" />
      </svg>
    </Tile>
  );
}

/* Per-intent ceiling — shield with a cap line */
export function IconCeiling({ size = 30 }) {
  const g = useGid('swce');
  return (
    <Tile tone="green" size={size}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id={g('a')} x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor="#3AE8B0" />
            <stop offset="1" stopColor="#0FB5FF" />
          </linearGradient>
        </defs>
        <path d="M12 21.5s7.5-3.6 7.5-9.4V5.3L12 2.5 4.5 5.3v6.8c0 5.8 7.5 9.4 7.5 9.4z" fill="rgba(58,232,176,0.14)" stroke={`url(#${g('a')})`} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 9.5h8" stroke="#E4FF6B" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 1.6" />
        <path className="swi-rise" d="M9.2 15.5 12 12.6l2.8 2.9" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Tile>
  );
}

/* Private route — lock with a shimmer */
export function IconPrivate({ size = 30 }) {
  const g = useGid('swpr');
  return (
    <Tile tone="pink" size={size}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id={g('a')} x1="4" y1="3" x2="20" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FF8AD8" />
            <stop offset="1" stopColor="#8B7CFF" />
          </linearGradient>
        </defs>
        <path className="swi-shackle" d="M7.5 10.5V7.8a4.5 4.5 0 0 1 9 0v2.7" stroke={`url(#${g('a')})`} strokeWidth="2" strokeLinecap="round" />
        <rect x="4.5" y="10.5" width="15" height="10.5" rx="3" fill="rgba(255,138,216,0.16)" stroke={`url(#${g('a')})`} strokeWidth="1.8" />
        <circle cx="12" cy="15.2" r="1.6" fill="#fff" />
        <path d="M12 16.6v1.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </Tile>
  );
}

/* Execution proof — receipt with a check that draws itself */
export function IconProof({ size = 34 }) {
  const g = useGid('swpf');
  return (
    <Tile tone="amber" size={size}>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id={g('a')} x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFE08A" />
            <stop offset="1" stopColor="#FF8A3D" />
          </linearGradient>
        </defs>
        <path d="M5.5 2.8h13v18.4l-2.2-1.4-2.2 1.4-2.1-1.4-2.1 1.4-2.2-1.4-2.2 1.4z" fill="rgba(255,200,74,0.14)" stroke={`url(#${g('a')})`} strokeWidth="1.7" strokeLinejoin="round" />
        <path d="M8.5 7h7M8.5 10h4.5" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.5" strokeLinecap="round" />
        <path className="swi-check" d="m8.8 14.2 2.2 2.2 4.4-4.4" stroke="#3AE8B0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength="100" />
      </svg>
    </Tile>
  );
}

/* Session key — key + countdown ring (ring driven by `pct`, 0..1) */
export function IconSession({ size = 36, pct = null, active = false }) {
  const g = useGid('swse');
  const r = 15;
  const c = 2 * Math.PI * r;
  const p = pct == null ? 0 : Math.max(0, Math.min(1, pct));
  return (
    <Tile tone={active ? 'green' : 'cyan'} size={size} className={active ? 'swi-live' : ''}>
      <svg width={size * 0.86} height={size * 0.86} viewBox="0 0 36 36" fill="none">
        <defs>
          <linearGradient id={g('a')} x1="3" y1="3" x2="33" y2="33" gradientUnits="userSpaceOnUse">
            <stop stopColor={active ? '#3AE8B0' : '#5EF6FF'} />
            <stop offset="1" stopColor={active ? '#E4FF6B' : '#8B7CFF'} />
          </linearGradient>
        </defs>
        <circle cx="18" cy="18" r={r} stroke="rgba(255,255,255,0.12)" strokeWidth="2.2" />
        {active ? (
          <circle
            cx="18" cy="18" r={r}
            stroke={`url(#${g('a')})`} strokeWidth="2.6" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - p)}
            transform="rotate(-90 18 18)"
            style={{ transition: 'stroke-dashoffset 1s linear' }}
          />
        ) : (
          <g className="swi-spin" style={{ transformOrigin: '18px 18px' }}>
            <circle cx="18" cy="18" r={r} stroke={`url(#${g('a')})`} strokeWidth="2.2" strokeDasharray="6 8" strokeLinecap="round" />
          </g>
        )}
        <circle cx="14.5" cy="15.5" r="3.6" stroke={`url(#${g('a')})`} strokeWidth="2" />
        <path d="m17.2 18.2 6 6M21 22l1.8-1.8M23.2 24.2l1.6-1.6" stroke={`url(#${g('a')})`} strokeWidth="2" strokeLinecap="round" />
      </svg>
    </Tile>
  );
}
