#!/usr/bin/env node
/**
 * VENDOR THE OFFLINE ASSET-ICON SET → src/lib/assetIconData.js
 * ---------------------------------------------------------------------------
 * Why vendored SVG strings and not a CDN: the token pickers (Bridge, Thor,
 * Tron, dYdX, Futures Engine, Global-Horizon) resolved artwork from
 * TrustWallet / CoinGecko hosts. Those hosts are geo-blocked for a large share
 * of our users, so every list showed coloured monograms — «توکن عکس نداره».
 * Inline SVG needs no network, renders identically in both themes and costs
 * one small chunk.
 *
 * Sources (all permissive):
 *   @web3icons/core  (MIT)   token + network marks, "background" variant
 *   flag-icons       (MIT)   1x1 country flags for the forex legs
 *   simple-icons     (CC0)   company marks for the tokenized-stock legs
 *
 * Usage:  ICON_SRC=/path/with/node_modules node scripts/gen-asset-icons.mjs
 * The output file is committed; this script only needs to run when the set
 * changes. Only the symbols listed below are vendored, on purpose — the whole
 * @web3icons set is 40 MB.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.env.ICON_SRC || process.cwd();
const nm = (p) => join(SRC, 'node_modules', p);

const TOKENS = ['USDT','USDC','DAI','BTC','ETH','BNB','POL','MATIC','AVAX','ARB','OP','SOL','TRX','ATOM','DOGE','LTC','BCH','XRP','RUNE','WBTC','LINK','UNI','AAVE','ADA','DOT','SUI','APT','NEAR','PEPE','SHIB','JUP','PYTH','TIA','SEI','FET','LDO','MKR','CRV','DYDX','GMX','PENDLE','XLM','HBAR','ALGO','KAS','TAO','FIL','ICP','VET','ETC','XMR','MNT','CRO','IMX','STX','GRT','THETA','FTM','KUJI','DASH','ZEC','ORDI','RNDR','BLUR','STRK','POPCAT','CAKE','TWT','XVS','JST','SUN','USDD','FDUSD','PYUSD','TUSD','FRAX','LUSD','GHO','SNX','COMP','YFI','SUSHI','1INCH','LRC','ENS','APE','SAND','MANA','AXS','GALA','CHZ','ENJ','FLOW','EGLD','XTZ','NEO','EOS','IOTA','ZIL','ONE','ROSE','KAVA','CELO','MINA','AR','RSR','OCEAN','AGIX','RLC','UMA','TRB','SKL','CTSI','DODO','REEF','SFP','LINA','LIT','DEXE','ALICE','TLM','GAL','ATM','LAZIO','PAXG','XAUT','OM','ZK','MANTA','DYM','ALT','JASMY','WOO','MASK','RPL','FXS','CFX','AXL','GAS','MEME','BIGTIME','SUPER','PIXEL','PORTAL','ACE','NTRN','KSM','ASTR','OSMO','INJ','WLD','ARKM','BONK','WIF','JTO','ENA','ETHFI','EIGEN','ZRO','ONDO','TON','FLOKI','NOT','AERO','BRETT','TRUMP'];
const NETWORKS = { 1: 'ethereum', 56: 'binance-smart-chain', 137: 'polygon', 42161: 'arbitrum-one', 8453: 'base', 10: 'optimism', 43114: 'avalanche', 59144: 'linea', 146: 'sonic', 5000: 'mantle', 80094: 'berachain', 130: 'unichain', 143: 'monad', tron: 'tron', solana: 'solana', bitcoin: 'bitcoin', cosmos: 'cosmos', litecoin: 'litecoin', ton: 'ton', xrp: 'xrp' };
const FLAGS = { USD: 'us', EUR: 'eu', GBP: 'gb', JPY: 'jp', CHF: 'ch', CAD: 'ca', AUD: 'au', NZD: 'nz', CNH: 'cn', CNY: 'cn', SEK: 'se', NOK: 'no', SGD: 'sg', HKD: 'hk', TRY: 'tr', ZAR: 'za', INR: 'in', KRW: 'kr', PLN: 'pl', DKK: 'dk', CZK: 'cz', HUF: 'hu', ILS: 'il', AED: 'ae', THB: 'th', IDR: 'id', MYR: 'my', PHP: 'ph', VND: 'vn', TWD: 'tw', CLP: 'cl', COP: 'co', RUB: 'ru', BRL: 'br', ARS: 'ar', DEU: 'de', FRA: 'fr', ITA: 'it', NLD: 'nl', ESP: 'es', MXN: 'mx', SAR: 'sa' };
/* simple-icons slug + tile colour. Marks are single-colour paths drawn white on the brand tile. */
const STOCKS = { AAPL: ['apple', '#1d1d1f'], TSLA: ['tesla', '#cc0000'], NVDA: ['nvidia', '#76b900'], GOOG: ['google', '#4285f4'], GOOGL: ['google', '#4285f4'], META: ['meta', '#0866ff'], NFLX: ['netflix', '#e50914'], AMD: ['amd', '#111111'], COIN: ['coinbase', '#0052ff'], INTC: ['intel', '#0071c5'], PLTR: ['palantir', '#101113'], HOOD: ['robinhood', '#00c805'], MSTR: ['microstrategy', '#d9232e'], V: ['visa', '#1a1f71'], MA: ['mastercard', '#eb001b'], NKE: ['nike', '#111111'], MCD: ['mcdonalds', '#ffc72c'], KO: ['cocacola', '#f40009'], BA: ['boeing', '#0039a6'], F: ['ford', '#00274e'], GM: ['generalmotors', '#0170ce'], UBER: ['uber', '#000000'], ABNB: ['airbnb', '#ff5a5f'], PYPL: ['paypal', '#003087'], SHOP: ['shopify', '#7ab55c'], CSCO: ['cisco', '#1ba0d7'], QCOM: ['qualcomm', '#3253dc'], AVGO: ['broadcom', '#cc092f'], ARM: ['arm', '#0091bd'], BIDU: ['baidu', '#2932e1'], SONY: ['sony', '#000000'], TM: ['toyota', '#eb0a1e'], SPOT: ['spotify', '#1db954'], SNAP: ['snapchat', '#fffc00'], PINS: ['pinterest', '#bd081c'], RDDT: ['reddit', '#ff4500'], RBLX: ['roblox', '#000000'], LCID: ['lucid', '#000000'], CRCL: ['circle', '#00d395'] };

const out = { tokens: {}, networks: {}, flags: {}, stocks: {} };
const strip = (svg) => svg
  .replace(/\s(width|height)="[^"]*"/g, '')
  .replace(/\sclass="[^"]*"/g, '')
  .replace(/<title>.*?<\/title>/g, '')
  .replace(/\n\s*/g, '');

function readModule(p) {
  if (!existsSync(p)) return null;
  const m = readFileSync(p, 'utf8').match(/'([\s\S]*?)'\n\nexport/);
  return m ? m[1].replace(/\\n/g, '\n').replace(/\\'/g, "'") : null;
}
for (const s of TOKENS) {
  const svg = readModule(nm(`@web3icons/core/dist/svgs/tokens/background/${s}.svg.js`));
  /* A handful of marks are traced photos (APE 63 KB, DOGE 25 KB). The monogram
     is the better trade for those than shipping them to every phone. */
  if (svg && strip(svg).length <= 6000) out.tokens[s] = strip(svg);
}
for (const [k, slug] of Object.entries(NETWORKS)) {
  const svg = readModule(nm(`@web3icons/core/dist/svgs/networks/background/${slug}.svg.js`));
  if (svg) out.networks[k] = strip(svg);
}
for (const [cur, cc] of Object.entries(FLAGS)) {
  const p = nm(`flag-icons/flags/1x1/${cc}.svg`);
  if (!existsSync(p)) continue;
  let svg = readFileSync(p, 'utf8');
  if (svg.length > 7000) continue; /* mx/es/sa/br carry huge coats of arms — monogram instead */
  /* namespace ids: flag-icons reuses `a`, `b`… across files, and two flags on one page would clip each other */
  svg = svg.replace(/id="([^"]+)"/g, `id="fi-${cc}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#fi-${cc}-$1)`).replace(/href="#([^"]+)"/g, `href="#fi-${cc}-$1"`);
  out.flags[cur] = strip(svg);
}
for (const [sym, [slug, color]] of Object.entries(STOCKS)) {
  const p = nm(`simple-icons/icons/${slug}.svg`);
  if (!existsSync(p)) continue;
  const path = readFileSync(p, 'utf8').match(/<path d="([^"]+)"/)?.[1];
  if (path) out.stocks[sym] = { d: path, bg: color, fg: color === '#ffc72c' || color === '#fffc00' ? '#111' : '#fff' };
}

const header = `/* AUTO-GENERATED by scripts/gen-asset-icons.mjs — do not edit by hand.
 * Vendored marks: @web3icons/core (MIT), flag-icons (MIT), simple-icons (CC0).
 * Symbol-keyed and therefore ONLY for venue-curated lists (bridge stablecoins,
 * THORChain pools, dYdX/Drift/Ostium markets). Never use it for a token a user
 * imported by address — see lib/tokenIcon.jsx for why symbols can be spoofed. */
`;
writeFileSync(join(process.cwd(), 'src/lib/assetIconData.js'),
  `${header}export const TOKEN_SVG = ${JSON.stringify(out.tokens)};\nexport const NETWORK_SVG = ${JSON.stringify(out.networks)};\nexport const FLAG_SVG = ${JSON.stringify(out.flags)};\nexport const STOCK_MARK = ${JSON.stringify(out.stocks)};\n`);
console.log('tokens', Object.keys(out.tokens).length, 'networks', Object.keys(out.networks).length, 'flags', Object.keys(out.flags).length, 'stocks', Object.keys(out.stocks).length);
