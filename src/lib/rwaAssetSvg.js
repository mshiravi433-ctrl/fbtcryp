/*
 * High-fidelity, local-first vector artwork for vetted Real-World Assets (RWA).
 * Provides authentic, beautifully rendered SVG marks and emblems so no RWA token
 * or tokenized asset ever appears blank or with a broken placeholder.
 */

const RWA_GLYPHS = {
  PAXG: {
    bg: ['#fbbf24', '#b45309'],
    glyph: `
      <polygon points="5,17 9,13 19,13 15,17" fill="#fef08a" />
      <polygon points="15,17 19,13 21,15 17,19" fill="#d97706" />
      <polygon points="5,17 15,17 17,19 7,19" fill="#b45309" />
      <polygon points="7,12 11,8 19,8 15,12" fill="#fff" />
      <polygon points="15,12 19,8 21,10 17,14" fill="#fde047" />
      <path d="M19 4 L20 6 L22 7 L20 8 L19 10 L18 8 L16 7 L18 6 Z" fill="#fff" />
    `
  },
  XAUT: {
    bg: ['#f59e0b', '#78350f'],
    glyph: `
      <polygon points="12,3 20,7.5 20,16.5 12,21 4,16.5 4,7.5" fill="none" stroke="#fef08a" stroke-width="1.4" />
      <path d="M7 8 H17 M12 8 V17" stroke="#fff" stroke-width="2.2" stroke-linecap="round" />
      <ellipse cx="12" cy="12" rx="4" ry="1.8" fill="none" stroke="#fde047" stroke-width="1" />
    `
  },
  USDY: {
    bg: ['#06b6d4', '#1e3a8a'],
    glyph: `
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="#67e8f9" stroke-width="1.2" stroke-dasharray="2 2" />
      <path d="M7 14 C9 9 15 9 17 14" stroke="#a5f3fc" stroke-width="1.8" fill="none" stroke-linecap="round" />
      <path d="M12 6.5 V17.5 M9.5 9 H14.5 M9.5 14 H14.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
    `
  },
  USDG: {
    bg: ['#10b981', '#064e3b'],
    glyph: `
      <circle cx="12" cy="12" r="8.5" fill="none" stroke="#34d399" stroke-width="1.2" />
      <ellipse cx="12" cy="12" rx="4" ry="8.5" fill="none" stroke="#34d399" stroke-width="0.9" opacity="0.6" />
      <path d="M12 6 V18 M10 8.5 H14 M10 12 H14 M10 15.5 H14" stroke="#fff" stroke-width="1.4" stroke-linecap="round" />
    `
  },
  ONDO: {
    bg: ['#0284c7', '#0f172a'],
    glyph: `
      <path d="M5 12 A7 7 0 0 1 19 12 A7 7 0 0 1 5 12" fill="none" stroke="#38bdf8" stroke-width="1.8" />
      <circle cx="12" cy="12" r="4" fill="#0284c7" stroke="#fff" stroke-width="1.5" />
      <path d="M12 5 A7 7 0 0 1 19 12" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" />
    `
  },
  MKR: {
    bg: ['#14b8a6', '#042f2e'],
    glyph: `
      <path d="M6 17 V7 L12 12.5 L18 7 V17" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="12" cy="12.5" r="1.5" fill="#2dd4bf" />
    `
  },
  CFG: {
    bg: ['#22c55e', '#14532d'],
    glyph: `
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="#86efac" stroke-width="1.2" stroke-dasharray="3 2" />
      <circle cx="12" cy="5.5" r="2" fill="#fff" />
      <circle cx="17.6" cy="15.2" r="2" fill="#fff" />
      <circle cx="6.4" cy="15.2" r="2" fill="#fff" />
      <circle cx="12" cy="12" r="2.2" fill="#4ade80" />
    `
  },
  PENDLE: {
    bg: ['#84cc16', '#1a2e05'],
    glyph: `
      <path d="M7 12 C7 9.5 9.5 9.5 12 12 C14.5 14.5 17 14.5 17 12 C17 9.5 14.5 9.5 12 12 C9.5 14.5 7 14.5 7 12 Z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />
      <circle cx="12" cy="12" r="1.6" fill="#bef264" />
    `
  },
  MPL: {
    bg: ['#10b981', '#1e293b'],
    glyph: `
      <path d="M12 4 L14 8 L17 7 L16 11 L19 13 L15 15 L16 19 L12 17 L8 19 L9 15 L5 13 L8 11 L7 7 L10 8 Z" fill="#6ee7b7" stroke="#fff" stroke-width="0.8" />
      <line x1="12" y1="11" x2="12" y2="20" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
    `
  },
  CPOOL: {
    bg: ['#38bdf8', '#0c4a6e'],
    glyph: `
      <path d="M12 5 C12 5 7 11 7 14.5 A5 5 0 0 0 17 14.5 C17 11 12 5 12 5 Z" fill="#0284c7" stroke="#e0f2fe" stroke-width="1.2" />
      <path d="M12 9 C11 11.5 9.5 13 9.5 14.5 A2.5 2.5 0 0 0 14.5 14.5" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" />
    `
  },
  USYC: {
    bg: ['#059669', '#064e3b'],
    glyph: `
      <rect x="5" y="8" width="14" height="12" rx="3" fill="none" stroke="#6ee7b7" stroke-width="1.4" />
      <path d="M8 8 V6 A4 4 0 0 1 16 6 V8" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" />
      <circle cx="12" cy="14" r="2" fill="#fff" />
      <line x1="12" y1="16" x2="12" y2="18" stroke="#fff" stroke-width="1.4" />
    `
  },
  THBILL: {
    bg: ['#2563eb', '#1e1b4b'],
    glyph: `
      <polygon points="12,4 4,8 20,8" fill="#93c5fd" />
      <line x1="6" y1="9" x2="6" y2="16" stroke="#fff" stroke-width="1.2" />
      <line x1="10" y1="9" x2="10" y2="16" stroke="#fff" stroke-width="1.2" />
      <line x1="14" y1="9" x2="14" y2="16" stroke="#fff" stroke-width="1.2" />
      <line x1="18" y1="9" x2="18" y2="16" stroke="#fff" stroke-width="1.2" />
      <rect x="4" y="16" width="16" height="3" fill="#93c5fd" rx="0.5" />
    `
  },
  VBILL: {
    bg: ['#3b82f6', '#172554'],
    glyph: `
      <path d="M12 4 L19 7 V13 C19 17.5 12 20.5 12 20.5 C12 20.5 5 17.5 5 13 V7 Z" fill="#1d4ed8" stroke="#93c5fd" stroke-width="1.2" />
      <path d="M8 11 L12 15 L16 11" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      <line x1="12" y1="8" x2="12" y2="14" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />
    `
  },
  JTRSY: {
    bg: ['#6366f1', '#1e1b4b'],
    glyph: `
      <rect x="4" y="18" width="16" height="2" fill="#a5b4fc" rx="0.5" />
      <rect x="5" y="4" width="14" height="2" fill="#a5b4fc" rx="0.5" />
      <path d="M8 6 V18 M12 6 V18 M16 6 V18" stroke="#fff" stroke-width="1.4" stroke-linecap="round" />
    `
  },
  POLYX: {
    bg: ['#ec4899', '#4c0519'],
    glyph: `
      <polygon points="12,4 19,8 19,16 12,20 5,16 5,8" fill="none" stroke="#f472b6" stroke-width="1.4" />
      <circle cx="12" cy="12" r="3" fill="#fff" />
    `
  },
  GFI: {
    bg: ['#f59e0b', '#451a03'],
    glyph: `
      <circle cx="12" cy="12" r="8" fill="none" stroke="#fde047" stroke-width="1.2" />
      <path d="M6 13 C9 9 15 9 18 13 C15 15 9 15 6 13 Z" fill="#fbbf24" />
      <circle cx="14" cy="10.5" r="1" fill="#fff" />
    `
  },
  TRUF: {
    bg: ['#84cc16', '#365314'],
    glyph: `
      <rect x="5" y="14" width="2.8" height="6" fill="#bef264" rx="0.5" />
      <rect x="9.2" y="10" width="2.8" height="10" fill="#a3e635" rx="0.5" />
      <rect x="13.4" y="7" width="2.8" height="13" fill="#84cc16" rx="0.5" />
      <rect x="17.6" y="4" width="2.8" height="16" fill="#fff" rx="0.5" />
    `
  },
  FACTR: {
    bg: ['#f97316', '#7c2d12'],
    glyph: `
      <polygon points="12,4 19,8 12,12 5,8" fill="#fdba74" />
      <polygon points="19,8 19,16 12,20 12,12" fill="#ea580c" />
      <polygon points="5,8 12,12 12,20 5,16" fill="#c2410c" />
    `
  },
  RGTI: {
    bg: ['#06b6d4', '#164e63'],
    glyph: `
      <circle cx="12" cy="12" r="3.2" fill="#22d3ee" stroke="#fff" stroke-width="1" />
      <ellipse cx="12" cy="12" rx="8" ry="3.5" fill="none" stroke="#67e8f9" stroke-width="1.2" transform="rotate(30 12 12)" />
      <ellipse cx="12" cy="12" rx="8" ry="3.5" fill="none" stroke="#67e8f9" stroke-width="1.2" transform="rotate(-30 12 12)" />
    `
  },
  JOBY: {
    bg: ['#14b8a6', '#134e4a'],
    glyph: `
      <path d="M12 5 L13.5 10 L20 11 L14 13.5 L15 19 L12 15 L9 19 L10 13.5 L4 11 L10.5 10 Z" fill="#2dd4bf" stroke="#fff" stroke-width="0.8" />
      <circle cx="12" cy="12" r="1.5" fill="#fff" />
    `
  },
  SOFI: {
    bg: ['#3b82f6', '#1e3a8a'],
    glyph: `
      <circle cx="12" cy="6" r="2.2" fill="#93c5fd" />
      <circle cx="6" cy="12" r="2.2" fill="#93c5fd" />
      <circle cx="18" cy="12" r="2.2" fill="#93c5fd" />
      <circle cx="12" cy="18" r="2.2" fill="#fff" />
    `
  }
};

const RWA_MARKS = {
  ONDO: ['OND', '#64e4bf', '#1769cf'], USDY: ['USD', '#65b9ef', '#2455a5'], USDG: ['USD', '#4bd59a', '#176342'],
  PAXG: ['Au', '#f4d06b', '#9a6814'], XAUT: ['XAU', '#d8c184', '#725522'],
  MKR: ['MKR', '#5fbf9a', '#19593b'], PENDLE: ['PEN', '#91e47b', '#36764d'],
  POLYX: ['POL', '#6da7ff', '#3444a5'], CFG: ['CFG', '#6de4bc', '#08785a'],
  XDC: ['XDC', '#77b2f3', '#16406e'], INJ: ['INJ', '#bb8cff', '#5632bd'],
  CPOOL: ['CPL', '#70c8ff', '#22519a'], MPL: ['MPL', '#7ad0b0', '#205e50'],
  GFI: ['GFI', '#ffda7a', '#a56e18'], REAL: ['REA', '#b9c6d8', '#53667f'],
  REALT: ['RWA', '#b9c6d8', '#53667f'], TRUF: ['TRU', '#c1dc69', '#4d7a35'],
  FACTR: ['FAC', '#ffb073', '#984e2d'], USYC: ['USY', '#7adbb5', '#205846'],
  JTRSY: ['JTR', '#6da7ff', '#255491'], VBILL: ['VBI', '#6da7ff', '#255491'],
  THBILL: ['THB', '#6da7ff', '#255491'], RGTI: ['RGT', '#56c7ed', '#3156a8'],
  JOBY: ['JOB', '#64d1c7', '#197179'], SOFI: ['SOF', '#56a9f6', '#284c9a']
};

export function rwaSymbolSvg(rawSymbol) {
  const symbol = String(rawSymbol || '').toUpperCase().replace(/[^A-Z0-9&.]/g, '');
  if (!symbol) return null;

  /* High-fidelity vector artwork if defined */
  const custom = RWA_GLYPHS[symbol];
  if (custom) {
    const [a, b] = custom.bg;
    const gradId = `rwa-g-${symbol}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/></linearGradient></defs><circle cx="12" cy="12" r="12" fill="url(#${gradId})"/><g>${custom.glyph}</g></svg>`;
  }

  /* Fallback labelled coin tile */
  const mark = RWA_MARKS[symbol];
  if (!mark) return null;
  const [label, a, b] = mark;
  const safeLabel = String(label).slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="rwa-${symbol}-${a.slice(1)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/></linearGradient></defs><circle cx="12" cy="12" r="12" fill="url(#rwa-${symbol}-${a.slice(1)})"/><text x="12" y="12.6" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace,JetBrains Mono,monospace" font-weight="800" font-size="8.5" fill="#fff">${safeLabel}</text></svg>`;
}
