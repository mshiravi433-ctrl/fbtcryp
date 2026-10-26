/**
 * Offline, zero-latency full-bleed vector brand marks for all 53 protocols in
 * the Discovery Center (`DISCOVERY_PROTOCOLS`).
 *
 * Why this exists:
 *   Previously, `Discover.jsx` fetched `google.com/s2/favicons` at 62% scale —
 *   which fails or stalls behind restricted networks, returns tiny 16×16
 *   favicons on app subdomains, and leaves cards showing plain 2-letter text.
 *   Every protocol here resolves synchronously at frame 0 to a crisp 24×24
 *   full-bleed vector emblem in its authentic brand palette.
 */
import { TOKEN_SVG } from './assetIconData.js';

const TOKEN_LOGO_KEY = Object.freeze({
  uniswap: 'UNI',
  pancakeswap: 'CAKE',
  sushiswap: 'SUSHI',
  aave: 'AAVE',
  compound: 'COMP',
  venus: 'XVS',
  yearn: 'YFI',
  pendle: 'PENDLE',
  lido: 'LDO',
  blur: 'BLUR',
  chainlink: 'LINK',
  thegraph: 'GRT'
});

/**
 * 41 bespoke full-bleed `viewBox="0 0 24 24"` brand emblems for protocols not
 * already covered by `TOKEN_SVG`.
 */
export const PROTOCOL_SVG = Object.freeze({
  // Curve — multi-spectrum liquidity rings on deep navy
  curve: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#121833"/><circle cx="10.2" cy="12.2" r="5.5" stroke="#FF4B4B" stroke-width="2.2"/><circle cx="13.8" cy="11.8" r="5.2" stroke="#34D399" stroke-width="2.1" stroke-opacity=".92"/><path d="M7.2 14.8c1.6-4.4 6.8-6.4 10.2-3.4" stroke="#FBBF24" stroke-width="2.1" stroke-linecap="round"/><path d="M7.8 9.6c3.2-2.2 7.8-.8 9.2 3.2" stroke="#38BDF8" stroke-width="1.9" stroke-linecap="round"/></svg>',

  // Balancer — three stacked weighted balance ovals
  balancer: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#171923"/><ellipse cx="12" cy="7.3" rx="4.2" ry="1.8" fill="#fff"/><ellipse cx="12" cy="11.8" rx="5.8" ry="2" fill="#CBD5E1"/><ellipse cx="12" cy="16.6" rx="7.4" ry="2.2" fill="#94A3B8"/></svg>',

  // Aerodrome — Base royal-blue aerodynamic delta wing
  aerodrome: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#0052FF"/><path d="M12 4.5 19.2 18h-3.4l-1.5-3H9.7l-1.5 3H4.8L12 4.5Zm0 5.1-1.35 2.8h2.7L12 9.6Z" fill="#fff"/><path d="M5.5 15.2c4.1-1.8 8.9-1.8 13 0" stroke="#93C5FD" stroke-width="1.5" stroke-linecap="round"/></svg>',

  // KyberSwap — emerald 4-facet crystal prism
  kyberswap: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#0B2922"/><path d="M11.3 4.2 6.2 12l5.1 7.8V4.2Z" fill="#31CB9E"/><path d="m12.7 4.2 5.1 4.1-5.1 3.1V4.2Zm0 8.4 5.1 3.1-5.1 4.1v-7.2Z" fill="#6EE7B7"/><path d="m12.7 11.9 5.3-2.5-2.6 2.6 2.6 2.6-5.3-2.7Z" fill="#A7F3D0"/></svg>',

  // 1inch — crimson-indigo aggregator crest with bold numeral 1 & ring
  oneinch: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#131B2E"/><circle cx="12" cy="12" r="7.4" stroke="#EF4444" stroke-width="2"/><path d="M7.2 8.8A7.4 7.4 0 0 1 18.4 8.4" stroke="#38BDF8" stroke-width="2" stroke-linecap="round"/><path d="M12.9 7.5v9h-2.1v-6.7l-1.7 1v-1.9l2-1.4h1.8Z" fill="#fff"/></svg>',

  // Morpho — cobalt geometric butterfly
  morpho: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#1738B8"/><path d="M5.2 7.2c0-1 .9-1.6 1.8-1.1L12 9.4l5-3.3c.9-.5 1.8.1 1.8 1.1v5.2c0 .7-.4 1.3-1 1.6l-2.8 1.4 2.2 2c.6.6.2 1.6-.7 1.6h-2.1L12 16.2 9.6 19H7.5c-.9 0-1.3-1-.7-1.6l2.2-2-2.8-1.4a1.8 1.8 0 0 1-1-1.6V7.2Z" fill="#fff"/></svg>',

  // Spark — warm amber-orange 8-point starburst
  spark: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#1F1308"/><path d="m12 3.8 1.9 5.1 4.3-2.7-2.7 4.3 5.1 1.5-5.1 1.5 2.7 4.3-4.3-2.7L12 20.2l-1.9-5.1-4.3 2.7 2.7-4.3L3.4 12l5.1-1.5-2.7-4.3 4.3 2.7L12 3.8Z" fill="#FA7A18"/><circle cx="12" cy="12" r="2.2" fill="#FEF3C7"/></svg>',

  // Kamino — Solana teal-indigo geometric K vault
  kamino: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#0D192B"/><path d="M6.5 5.5h3.1v13H6.5v-13Zm3.6 6.3L16 5.5h3.4l-5.8 6.1 6 6.9H16l-5.9-6.7Z" fill="#38BDF8"/><path d="M13.6 11.6 19.4 5.5H16l-4.2 4.5 1.8 1.6Z" fill="#5EEAD4"/></svg>',

  // Beefy — emerald yield shield with stylized bull horns
  beefy: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#143322"/><path d="M5 7.2c1.8-.2 3.1.8 3.7 2.1h6.6c.6-1.3 1.9-2.3 3.7-2.1-.2 2.3-1.5 3.7-3.1 4.1l-.7 5.2c-.3 1.4-1.6 2.5-3.2 2.5s-2.9-1.1-3.2-2.5l-.7-5.2C6.5 10.9 5.2 9.5 5 7.2Z" fill="#4ADE80"/><circle cx="10.2" cy="12.6" r="1" fill="#0B2216"/><circle cx="13.8" cy="12.6" r="1" fill="#0B2216"/></svg>',

  // Convex — interlocking multi-color hex prisms
  convex: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#161822"/><path d="M12 4.6 18 8v8l-6 3.4L6 16V8l6-3.4Z" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M12 8.2 15.2 10v4L12 15.8 8.8 14v-4L12 8.2Z" fill="#38BDF8"/><path d="M12 4.6V8.2M18 8l-2.8 2M18 16l-2.8-2M12 19.4v-3.6" stroke="#F87171" stroke-width="1.8" stroke-linecap="round"/></svg>',

  // Jito — Solana emerald-mint lightning J emblem
  jito: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#0B1F1B"/><path d="M14.2 5h3.2v9.2a4.8 4.8 0 0 1-9.6 0h3.1a1.7 1.7 0 0 0 3.3 0V5Z" fill="#34D399"/><path d="m7.2 9.8 4.4-4.8v3.3h2.3l-4.4 4.8V9.8H7.2Z" fill="#A7F3D0"/></svg>',

  // Stargate — cosmic portal ring + star bridge
  stargate: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#0F111A"/><circle cx="12" cy="12" r="7" stroke="#E2E8F0" stroke-width="2"/><path d="M6.8 15.5h10.4L12 6.8l-5.2 8.7Z" stroke="#94A3B8" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12.5" r="1.8" fill="#fff"/></svg>',

  // Across — mint-emerald fast cross-chain arch
  across: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#132924"/><path d="M5.5 17.5 12 5.5l6.5 12h-2.9L12 10.6l-3.6 6.9H5.5Z" fill="#6EE7B7"/><path d="M4.8 13.4c4.5-2.4 9.9-2.4 14.4 0" stroke="#34D399" stroke-width="2.1" stroke-linecap="round"/></svg>',

  // Wormhole — concentric violet-white vortex W
  wormhole: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#120E24"/><circle cx="12" cy="12" r="7.4" stroke="#C4B5FD" stroke-width="1.8"/><circle cx="12" cy="12" r="4.6" stroke="#8B5CF6" stroke-width="1.8"/><circle cx="12" cy="12" r="2" fill="#fff"/></svg>',

  // Synapse — neon magenta-violet interconnected 4-node bridge
  synapse: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#210E29"/><path d="M8 8h8l-8 8h8" stroke="#E879F9" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="2.2" fill="#F0ABFC"/><circle cx="16" cy="8" r="2.2" fill="#C084FC"/><circle cx="8" cy="16" r="2.2" fill="#C084FC"/><circle cx="16" cy="16" r="2.2" fill="#F0ABFC"/></svg>',

  // Hop — magenta-violet twin interlocking hop rings
  hop: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#241029"/><circle cx="9.6" cy="12" r="4.6" stroke="#F472B6" stroke-width="2.2"/><circle cx="14.4" cy="12" r="4.6" stroke="#C084FC" stroke-width="2.2"/></svg>',

  // LayerZero — monochrome omnichain `0` with diagonal slash
  layerzero: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#0B0D13"/><rect x="6.5" y="5" width="11" height="14" rx="5.5" stroke="#fff" stroke-width="2.2"/><path d="m8.2 16.5 7.6-9" stroke="#94A3B8" stroke-width="2" stroke-linecap="round"/></svg>',

  // DefiLlama — signature indigo-blue background with crisp white llama silhouette
  defillama: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#1D3557"/><path d="M8.5 5.2c0-.7.8-1 1.3-.4l1.2 1.5h1.2l1.2-1.5c.5-.6 1.3-.3 1.3.4v6.1l2.3 1.5c.7.4 1 1.2 1 2V19H7.2v-7.8l1.3-1V5.2Z" fill="#F1FAEE"/><circle cx="10.6" cy="9.2" r=".9" fill="#1D3557"/><path d="M10.2 11.4h2" stroke="#1D3557" stroke-width="1.2" stroke-linecap="round"/></svg>',

  // Dune — split terracotta/cobalt desert sun disc
  dune: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#171426"/><circle cx="12" cy="12" r="7.2" fill="#F97316"/><path d="M4.9 13.2c2.2-1.6 4.7-1.7 7.1-.3 2.4 1.3 4.8 1.2 7.1-.3A7.2 7.2 0 0 1 12 19.2a7.2 7.2 0 0 1-7.1-6Z" fill="#3B82F6"/></svg>',

  // Nansen — emerald-teal four-point analytics compass
  nansen: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#062229"/><path d="M12 4.2 15 12l-3 7.8L9 12l3-7.8Z" fill="#2DD4BF"/><path d="M4.2 12 12 9l7.8 3-7.8 3-7.8-3Z" fill="#38BDF8" fill-opacity=".85"/><circle cx="12" cy="12" r="2" fill="#fff"/></svg>',

  // DEX Screener — charcoal badge with sharp white falcon/candlestick wings
  dexscreener: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#111318"/><path d="M12 5 5.2 9.4l2.4 3.4L12 10l4.4 2.8 2.4-3.4L12 5Zm0 6.8-4.4 2.8L12 19l4.4-4.4-4.4-2.8Z" fill="#fff"/></svg>',

  // CoinGecko — signature lime-green badge with friendly gecko head
  coingecko: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#1E3A1A"/><circle cx="12" cy="12" r="7.5" fill="#8DC63F"/><path d="M8.2 14.8c1.2-4 5.4-6.2 8.8-4.2-.8 3.6-3.8 6.4-8.8 4.2Z" fill="#FDE68A"/><circle cx="13.8" cy="9.8" r="1.4" fill="#fff"/><circle cx="14.1" cy="9.8" r=".7" fill="#142611"/></svg>',

  // Arkham — slate-navy intelligence triangle with radar eye
  arkham: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#0B1221"/><path d="M12 4.8 19.2 18H4.8L12 4.8Z" stroke="#60A5FA" stroke-width="2" stroke-linejoin="round"/><path d="M8.8 14.5h6.4" stroke="#93C5FD" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="11.6" r="1.6" fill="#fff"/></svg>',

  // GeckoTerminal — dark emerald terminal candlesticks
  geckoterminal: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#0A2419"/><path d="M7.5 6.5v11M12 5v14M16.5 7.5v9" stroke="#34D399" stroke-width="1.5" stroke-linecap="round"/><rect x="6.1" y="9" width="2.8" height="5.2" rx="1" fill="#4ADE80"/><rect x="10.6" y="7.4" width="2.8" height="6.8" rx="1" fill="#86EFAC"/><rect x="15.1" y="10.2" width="2.8" height="4.4" rx="1" fill="#22C55E"/></svg>',

  // Ondo — institutional black/indigo with clean concentric wave O
  ondo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#101526"/><circle cx="12" cy="12" r="6.8" stroke="#fff" stroke-width="2.3"/><path d="M7.4 13.2c1.6-2 3.2-2 4.6 0 1.4 2 3 2 4.6 0" stroke="#60A5FA" stroke-width="2" stroke-linecap="round"/></svg>',

  // Centrifuge — royal blue radial turbine C
  centrifuge: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#122759"/><path d="M16.8 8.2a6.5 6.5 0 1 0 0 7.6" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M14.6 10.1a3.4 3.4 0 1 0 0 3.8" stroke="#60A5FA" stroke-width="2" stroke-linecap="round"/></svg>',

  // Maple — warm amber-orange institutional geometric leaf/arch
  maple: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#241409"/><path d="m12 4.6 2.3 3.9 3.9-1.1-1.6 3.8 2.8 2.4-3.8.9-.6 3.9-3-2.6-3 2.6-.6-3.9-3.8-.9 2.8-2.4-1.6-3.8 3.9 1.1L12 4.6Z" fill="#FB923C"/></svg>',

  // Goldfinch — rich gold geometric finch wing
  goldfinch: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#231B0A"/><path d="M5.5 15.8c1.2-5.6 5.6-9.2 12.8-9.2-1.2 4.2-3.9 7.2-8.2 8.1l4.7 2.8H8.4c-1.5 0-2.6-.7-2.9-1.7Z" fill="#FBBF24"/></svg>',

  // Backed — Swiss crimson-navy regulated treasury shield
  backed: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#141C2E"/><path d="M12 4.6 18.2 7v5.1c0 3.9-2.6 6.4-6.2 7.5-3.6-1.1-6.2-3.6-6.2-7.5V7L12 4.6Z" fill="#2563EB"/><path d="M12 8.8v6.4M8.8 12h6.4" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',

  // OpenSea — iconic ocean-blue circle with crisp white sailboat
  opensea: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#2081E2"/><path d="M11.6 5.4v8.2H6.7c.7-3.2 2.4-5.9 4.9-8.2Zm1.3 1.2c2.6 1.8 4.1 4.2 4.4 7h-4.4v-7ZM5.6 15h12.8c-.5 2.1-2.3 3.6-4.7 3.6H10c-2.3 0-4-1.5-4.4-3.6Z" fill="#fff"/></svg>',

  // Magic Eden — vibrant magenta-pink ME prism
  magiceden: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#E42575"/><path d="M5 16.8V7.2l3.8 4.2 3.2-3.6 3.2 3.6L19 7.2v9.6h-2.5v-4.3l-1.5 1.7-3-3.3-3 3.3-1.5-1.7v4.3H5Z" fill="#fff"/></svg>',

  // Tensor — high-contrast neon cyan-lime T cube on jet black
  tensor: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#0B0F17"/><path d="M5.5 6.5h13v3H13.6V18h-3.2V9.5H5.5v-3Z" fill="#22D3EE"/><path d="m6.5 14.5 3.9 3.5M17.5 14.5 13.6 18" stroke="#A3E635" stroke-width="2" stroke-linecap="round"/></svg>',

  // Element — layered cyan-emerald isometric diamond stack
  element: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#0D2129"/><path d="m12 5 6.8 3.8L12 12.6 5.2 8.8 12 5Z" fill="#34D399"/><path d="m5.2 12.2 6.8 3.8 6.8-3.8" stroke="#38BDF8" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/><path d="m5.2 15.6 6.8 3.8 6.8-3.8" stroke="#A7F3D0" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  // LooksRare — bright emerald diamond with central eye
  looksrare: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#0B2417"/><path d="M12 5.2 19.2 12 12 18.8 4.8 12 12 5.2Z" fill="#2DE370"/><circle cx="12" cy="12" r="2.8" fill="#0B2417"/><circle cx="12" cy="12" r="1.2" fill="#fff"/></svg>',

  // Etherscan — signature navy explorer badge with 3 rising bars & sweeping arc
  etherscan: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#21325B"/><rect x="6.5" y="11" width="2.3" height="5.5" rx="1" fill="#fff"/><rect x="10.4" y="8.6" width="2.3" height="7.9" rx="1" fill="#fff"/><rect x="14.3" y="6.4" width="2.3" height="10.1" rx="1" fill="#fff"/><path d="M5.4 17.6c4.5 1.8 9.9.9 13.4-2.8" stroke="#60A5FA" stroke-width="2" stroke-linecap="round"/></svg>',

  // BscScan — BNB gold-charcoal explorer badge with 3 rising bars & golden arc
  bscscan: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#1E2026"/><rect x="6.5" y="11" width="2.3" height="5.5" rx="1" fill="#F0B90B"/><rect x="10.4" y="8.6" width="2.3" height="7.9" rx="1" fill="#F0B90B"/><rect x="14.3" y="6.4" width="2.3" height="10.1" rx="1" fill="#F0B90B"/><path d="M5.4 17.6c4.5 1.8 9.9.9 13.4-2.8" stroke="#FDE68A" stroke-width="2" stroke-linecap="round"/></svg>',

  // Arbiscan — Arbitrum navy-cyan explorer badge with 3 rising bars & cyan arc
  arbiscan: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#1B293E"/><rect x="6.5" y="11" width="2.3" height="5.5" rx="1" fill="#28A0F0"/><rect x="10.4" y="8.6" width="2.3" height="7.9" rx="1" fill="#28A0F0"/><rect x="14.3" y="6.4" width="2.3" height="10.1" rx="1" fill="#fff"/><path d="M5.4 17.6c4.5 1.8 9.9.9 13.4-2.8" stroke="#38BDF8" stroke-width="2" stroke-linecap="round"/></svg>',

  // Alchemy — electric cobalt-blue alchemical prism A
  alchemy: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#162A6E"/><path d="M12 4.5 19 18.2h-3.1l-1.5-3H9.6l-1.5 3H5L12 4.5Zm0 5.3-1.4 2.9h2.8L12 9.8Z" fill="#60A5FA"/><path d="M12 4.5v5.3l1.4 2.9h2.5L19 18.2 12 4.5Z" fill="#fff"/></svg>',

  // Tenderly — violet-indigo debugger cube & pulse
  tenderly: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#1D1338"/><path d="m12 4.8 6.4 3.6v7.2L12 19.2l-6.4-3.6V8.4L12 4.8Z" stroke="#A78BFA" stroke-width="2" stroke-linejoin="round"/><path d="M8.2 12h2.2l1.3-2.6 1.8 5.2 1.3-2.6h1.8" stroke="#F472B6" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',

  // thirdweb — signaturemagenta-violet triple diagonal bars
  thirdweb: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#1C0F2B"/><path d="m6.2 16.8 3-9.6h2.5l-3 9.6H6.2Zm4.6 0 3-9.6h2.5l-3 9.6h-2.5Zm4.6 0 2.2-7h2.4l-2.2 7h-2.4Z" fill="#F43F5E"/><path d="m10.8 16.8 3-9.6h2.5l-3 9.6h-2.5Z" fill="#C084FC"/></svg>',

  // L2BEAT — crimson-rose pulse beat on dark slate
  l2beat: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" fill="#1C1018"/><path d="M4.5 12.5h3.6l2.1-4.8 3.2 8.6 2.3-5.6 1.4 1.8h2.4" stroke="#FB7185" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
});

function scopeSvg(svg, scope) {
  if (!svg || !scope || !svg.includes('id="')) return svg;
  return svg
    .replace(/\bid="([^"]+)"/g, `id="${scope}_$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${scope}_$1)`);
}

/**
 * Return a full-bleed 24×24 SVG string for any Discovery protocol id (or null
 * if unknown). Scopes internal `<defs>` IDs when `scope` is passed so multiple
 * instances on the same screen never collide.
 */
export function discoveryProtocolSvg(protoId, scope = '') {
  const id = String(protoId || '').trim().toLowerCase();
  if (!id) return null;
  const tokKey = TOKEN_LOGO_KEY[id];
  const raw = (tokKey && TOKEN_SVG[tokKey]) || PROTOCOL_SVG[id] || null;
  return raw ? scopeSvg(raw, scope) : null;
}
