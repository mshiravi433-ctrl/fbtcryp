/**
 * GuideArt — the step illustrations for the Lab "App guide".
 *
 * Twelve tiny scenes, one per kind of step the app's flows share (connect a
 * wallet, pick a network, read a quote, sign, wait for delivery…). They are
 * pure inline SVG drawn with the Lab's accent tokens (`--acc`, `--acc-2`) so
 * every area recolours the same scene, they weigh nothing, and they sit in
 * both themes. `currentColor` is the ink; the accent paints the glow.
 *
 * Every scene is `aria-hidden`: the step's title and body already say what
 * the picture shows.
 */

const base = {
  viewBox: '0 0 120 84',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false'
};

const ACC = 'var(--acc)';
const ACC2 = 'var(--acc-2)';

/* Soft glow blob every scene sits on. */
function Glow() {
  return (
    <ellipse cx="60" cy="72" rx="42" ry="7" fill={ACC} opacity="0.14" stroke="none" />
  );
}

function Wallet() {
  return (
    <svg {...base}>
      <Glow />
      <rect x="22" y="22" width="76" height="46" rx="9" fill={ACC} fillOpacity="0.10" stroke={ACC} />
      <path d="M22 34h76" stroke={ACC} opacity="0.6" />
      <rect x="70" y="40" width="28" height="16" rx="5" fill={ACC2} fillOpacity="0.25" stroke={ACC2} />
      <circle cx="84" cy="48" r="2.6" fill={ACC2} stroke="none" />
      <circle cx="40" cy="14" r="7" stroke={ACC2} />
      <path d="M36.5 14l2.5 2.5 4.5-5" stroke={ACC2} />
      <path d="M30 52h20" opacity="0.5" />
      <path d="M30 58h12" opacity="0.35" />
    </svg>
  );
}

function Network() {
  return (
    <svg {...base}>
      <Glow />
      <circle cx="60" cy="42" r="12" fill={ACC} fillOpacity="0.16" stroke={ACC} />
      <circle cx="24" cy="24" r="7" stroke={ACC2} />
      <circle cx="96" cy="24" r="7" stroke={ACC2} />
      <circle cx="26" cy="62" r="7" stroke={ACC2} />
      <circle cx="94" cy="62" r="7" stroke={ACC2} />
      <path d="M30 28l19 9M90 28l-19 9M31 58l19-9M89 58l-19-9" opacity="0.55" />
      <circle cx="60" cy="42" r="3" fill={ACC} stroke="none" />
      <path d="M96 17l0 -5M99 20h5" stroke={ACC2} opacity="0.7" />
    </svg>
  );
}

function Tokens() {
  return (
    <svg {...base}>
      <Glow />
      <circle cx="44" cy="40" r="17" fill={ACC} fillOpacity="0.14" stroke={ACC} />
      <circle cx="76" cy="44" r="17" fill={ACC2} fillOpacity="0.16" stroke={ACC2} />
      <path d="M44 31v18M38 36h9a3.5 3.5 0 010 7h-7M38 43h9" stroke={ACC} />
      <path d="M76 35l8 9-8 9-8-9z" stroke={ACC2} />
      <path d="M56 16l6-6 6 6M62 10v12" opacity="0.7" />
      <path d="M62 62v10M56 68l6 6 6-6" opacity="0.7" />
    </svg>
  );
}

function Quote() {
  return (
    <svg {...base}>
      <Glow />
      <rect x="18" y="14" width="84" height="54" rx="9" fill={ACC} fillOpacity="0.08" stroke={ACC} />
      <path d="M26 26h32" />
      <path d="M26 36h48" opacity="0.5" />
      <path d="M26 46h40" opacity="0.5" />
      <path d="M26 56h28" opacity="0.5" />
      <rect x="74" y="24" width="20" height="9" rx="4.5" fill={ACC2} fillOpacity="0.35" stroke={ACC2} />
      <path d="M78 46l4 4 8-9" stroke={ACC2} />
      <path d="M88 60l6-6M94 60l-6-6" stroke={ACC2} opacity="0.7" />
    </svg>
  );
}

function Shield() {
  return (
    <svg {...base}>
      <Glow />
      <path d="M60 12l30 10v20c0 15-12 26-30 32C42 68 30 57 30 42V22z" fill={ACC} fillOpacity="0.14" stroke={ACC} />
      <path d="M60 22l18 6v13c0 10-7.5 17-18 21-10.5-4-18-11-18-21V28z" stroke={ACC2} opacity="0.7" />
      <path d="M50 42l7 7 13-14" stroke={ACC2} strokeWidth="2.2" />
    </svg>
  );
}

function Sign() {
  return (
    <svg {...base}>
      <Glow />
      <rect x="40" y="8" width="40" height="66" rx="8" fill={ACC} fillOpacity="0.10" stroke={ACC} />
      <path d="M54 14h12" opacity="0.6" />
      <rect x="47" y="24" width="26" height="22" rx="5" stroke={ACC2} fill={ACC2} fillOpacity="0.16" />
      <path d="M52 40c3-6 6-9 10-9s6 3 6 6-4 3-5-1 2-5 5-5" stroke={ACC2} />
      <rect x="47" y="52" width="26" height="9" rx="4.5" fill={ACC} stroke="none" />
      <path d="M16 30l8 6-8 6" opacity="0.5" />
      <path d="M104 30l-8 6 8 6" opacity="0.5" />
    </svg>
  );
}

function Done() {
  return (
    <svg {...base}>
      <Glow />
      <circle cx="60" cy="42" r="24" fill={ACC} fillOpacity="0.14" stroke={ACC} />
      <circle cx="60" cy="42" r="16" stroke={ACC2} opacity="0.6" />
      <path d="M50 42l7 7 14-15" stroke={ACC2} strokeWidth="2.4" />
      <path d="M22 20l3-3M98 20l-3-3M20 60l3 3M100 60l-3 3" stroke={ACC2} opacity="0.6" />
    </svg>
  );
}

function Health() {
  return (
    <svg {...base}>
      <Glow />
      <path d="M22 60a38 38 0 0176 0" stroke={ACC} opacity="0.35" strokeWidth="8" />
      <path d="M22 60a38 38 0 0122-33" stroke="#ff5c8a" strokeWidth="8" opacity="0.75" />
      <path d="M44 27a38 38 0 0134 0" stroke={ACC2} strokeWidth="8" opacity="0.85" />
      <path d="M78 27a38 38 0 0120 33" stroke={ACC} strokeWidth="8" opacity="0.85" />
      <path d="M60 60L74 36" strokeWidth="2.2" />
      <circle cx="60" cy="60" r="4" fill="currentColor" stroke="none" />
      <path d="M50 74h20" opacity="0.5" />
    </svg>
  );
}

function Chart() {
  return (
    <svg {...base}>
      <Glow />
      <rect x="16" y="12" width="88" height="58" rx="9" fill={ACC} fillOpacity="0.08" stroke={ACC} />
      <path d="M24 56l14-12 12 8 14-20 12 6 14-16" stroke={ACC2} strokeWidth="2.2" />
      <path d="M24 56l14-12 12 8 14-20 12 6 14-16V62H24z" fill={ACC2} fillOpacity="0.14" stroke="none" />
      <circle cx="78" cy="38" r="3" fill={ACC2} stroke="none" />
      <path d="M24 62h72" opacity="0.4" />
    </svg>
  );
}

function Doc() {
  return (
    <svg {...base}>
      <Glow />
      <path d="M34 10h36l16 16v46a4 4 0 01-4 4H34a4 4 0 01-4-4V14a4 4 0 014-4z" fill={ACC} fillOpacity="0.10" stroke={ACC} />
      <path d="M70 10v16h16" stroke={ACC} />
      <path d="M40 36h32M40 46h32M40 56h20" opacity="0.5" />
      <circle cx="76" cy="60" r="9" fill={ACC2} fillOpacity="0.25" stroke={ACC2} />
      <path d="M72 60h8M76 56v8" stroke={ACC2} />
    </svg>
  );
}

function Track() {
  return (
    <svg {...base}>
      <Glow />
      <circle cx="24" cy="44" r="9" fill={ACC} fillOpacity="0.16" stroke={ACC} />
      <circle cx="96" cy="44" r="9" fill={ACC2} fillOpacity="0.16" stroke={ACC2} />
      <path d="M33 44h54" strokeDasharray="4 4" opacity="0.6" />
      <circle cx="60" cy="44" r="6" fill={ACC2} stroke="none" />
      <path d="M60 20a8 8 0 100 .01" stroke={ACC2} opacity="0.7" />
      <path d="M60 14v6l4 3" stroke={ACC2} />
      <path d="M22 44l2 2 4-4" stroke={ACC} />
    </svg>
  );
}

function Gauge() {
  return (
    <svg {...base}>
      <Glow />
      <rect x="18" y="18" width="84" height="48" rx="10" fill={ACC} fillOpacity="0.08" stroke={ACC} />
      <rect x="28" y="36" width="64" height="8" rx="4" fill={ACC} fillOpacity="0.25" stroke="none" />
      <rect x="28" y="36" width="40" height="8" rx="4" fill={ACC2} stroke="none" />
      <circle cx="68" cy="40" r="7" fill="currentColor" stroke={ACC2} />
      <path d="M30 28h14M52 28h14M74 28h14" opacity="0.45" />
      <path d="M30 56h10M62 56h28" opacity="0.4" />
    </svg>
  );
}

function Tabs() {
  return (
    <svg {...base}>
      <Glow />
      <rect x="16" y="16" width="88" height="54" rx="9" fill={ACC} fillOpacity="0.08" stroke={ACC} />
      <rect x="22" y="22" width="24" height="10" rx="5" fill={ACC2} stroke="none" />
      <rect x="50" y="22" width="22" height="10" rx="5" stroke={ACC2} opacity="0.5" />
      <rect x="76" y="22" width="22" height="10" rx="5" stroke={ACC2} opacity="0.5" />
      <path d="M24 44h60M24 52h44M24 60h30" opacity="0.5" />
    </svg>
  );
}

const ART = {
  wallet: Wallet,
  network: Network,
  tokens: Tokens,
  quote: Quote,
  shield: Shield,
  sign: Sign,
  done: Done,
  health: Health,
  chart: Chart,
  doc: Doc,
  track: Track,
  gauge: Gauge,
  tabs: Tabs
};

export const GUIDE_ART_NAMES = Object.keys(ART);

export default function GuideArt({ name, className = '' }) {
  const Scene = ART[name] || Doc;
  return (
    <span className={`lab2-guide-art ${className}`.trim()}>
      <Scene />
    </span>
  );
}
