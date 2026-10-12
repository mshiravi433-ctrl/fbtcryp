/*
 * Small, local-only logo fallbacks for vetted real-world asset symbols.
 * These are labelled artwork tiles rather than copies of issuer trademarks.
 * Kept separate from the full AssetIcon registry so token lists can use the
 * fallback without pulling every network, flag and stock mark into their
 * chunk.
 */
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
  const mark = RWA_MARKS[symbol];
  if (!mark) return null;
  const [label, a, b] = mark;
  const safeLabel = String(label).slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="rwa-${symbol}-${a.slice(1)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="24" height="24" fill="url(#rwa-${symbol}-${a.slice(1)})"/><text x="12" y="12.6" text-anchor="middle" dominant-baseline="middle" font-family="ui-monospace,JetBrains Mono,monospace" font-weight="800" font-size="8.5" fill="#fff">${safeLabel}</text></svg>`;
}
