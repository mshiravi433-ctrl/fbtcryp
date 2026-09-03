/**
 * GUIDED HANDOFF — the no-registration Buy / Sell rail.
 * ---------------------------------------------------------------------------
 * ─── WHAT WAS ASKED ─────────────────────────────────────────────────────────
 *   «یک مدل طراحی کنیم که اطلاعات وارد شده کاربر داخل سایت مقصد جایگذاری
 *    شود و کاربر فقط تایید نهایی و پرداخت را در سایت مقصد انجام دهد —
 *    بدون نیاز به ثبت‌نام ما.»
 *
 * The user fills the form HERE (amount → wallet → asset, one step at a
 * time), and this module composes the official public checkout URL of the
 * destination provider with those values prefilled, using ONLY the query
 * parameters the provider itself documents for its hosted widget. The user
 * lands on the provider's own site with everything already typed in and
 * performs the single remaining action there: confirm and pay.
 *
 * ─── WHY THIS NEEDS NO API KEY, AND WHAT THAT HONESTLY MEANS ────────────────
 * The provider's hosted widget is a public web page. Prefill parameters
 * (asset code, fiat amount, destination wallet) are part of its public URL
 * contract; opening it is exactly what a bookmark or a printed link would
 * do. No credential of ours is involved, therefore:
 *
 * ─── WHICH PUBLIC PAGE, AND WHY (the «Integration issue detected» fix) ─────
 * The PARTNER widget host, app.rampnetwork.com, hard-requires a valid
 * `hostApiKey`: opened without one it renders Ramp's own error page —
 * «Integration issue detected. The application isn't properly connected to
 * Ramp Network. You can visit Ramp Network directly to buy or sell crypto.»
 * (Ramp support: «The most common case for this issue is the wrong
 * hostApiKey value used in the widget configuration code or lack thereof.»)
 * A keyless rail can therefore NEVER point at that host — and the correct
 * keyless destination is the very one that error page itself offers: Ramp's
 * own public consumer pages, where Ramp runs the same widget with Ramp's
 * OWN integration, so no partner key is involved at all:
 *
 *     BUY  → https://buy.ramp.network/
 *     SELL → https://ramp.network/sell   (docs.rampnetwork.com support:
 *            «How to sell crypto? → Head to https://ramp.network/sell»)
 *
 * The pages run the same widget, so the same documented search parameters
 * apply; Ramp's migration guide (docs.rampnetwork.com/search-params-migration)
 * states the widget auto-converts the legacy prefill keys we send. Worst
 * case an unrecognised parameter is ignored and the user picks by hand —
 * degradation is an extra tap, never an error page, and NEVER a fabricated
 * credential shoved into the URL to make the partner host load.
 *
 *   • the provider performs its OWN checks (KYC, card 3-DS, region rules)
 *     on its own site — nothing here can or does bypass any of them;
 *   • we receive no webhook and no order id — so this flow NEVER claims
 *     "payment confirmed". The only truthful post-handoff signal available
 *     is the public blockchain itself, which lib/buySellWatch.js reads:
 *     "a deposit matching your order was detected in your wallet" — and it
 *     is worded exactly that way, never as a payment status;
 *   • prefill is best-effort by design: if the provider does not recognise
 *     a parameter it simply shows its normal selector and the user picks by
 *     hand. Degradation is a extra tap on their site, never a wrong value.
 *
 * ─── WHY THE CATALOG IS CURATED AND NOT FETCHED ─────────────────────────────
 * Without a key there is no authenticated catalog endpoint to trust, and
 * guessing codes at runtime would put unverifiable strings in a money URL.
 * Every row below pairs a provider asset code from the provider's public
 * documentation with the on-chain contract metadata ALREADY pinned in
 * lib/chains.js — the same addresses the wallet and swap screens use. The
 * watcher therefore watches the exact token the handoff named.
 */

import { TOKENS, EVM_CHAINS } from './chains';

/* The one destination this rail currently composes URLs for: Ramp Network's
   PUBLIC CONSUMER pages — not the partner widget host. app.rampnetwork.com
   refuses keyless visitors with «Integration issue detected»; these pages
   are the keyless entry points Ramp itself publishes for direct buyers and
   sellers. Per-side hosts as data, so a second keyless destination is an
   append, not a rewrite. */
export const GUIDED_PROVIDER = {
  id: 'ramp',
  name: 'Ramp Network',
  hosts: {
    BUY: 'https://buy.ramp.network/',
    SELL: 'https://ramp.network/sell'
  },
  enabled: true
};

/* network code used across this app → { chainId, ramp: provider chain prefix } */
export const GUIDED_NETWORKS = {
  ethereum: { chainId: 1, ramp: 'ETH', label: 'Ethereum' },
  arbitrum: { chainId: 42161, ramp: 'ARBITRUM', label: 'Arbitrum' },
  base: { chainId: 8453, ramp: 'BASE', label: 'Base' },
  optimism: { chainId: 10, ramp: 'OPTIMISM', label: 'Optimism' },
  polygon: { chainId: 137, ramp: 'MATIC', label: 'Polygon' },
  bsc: { chainId: 56, ramp: 'BSC', label: 'BNB Chain' }
};

/* Which asset symbols we prefill per network. Only pairs that exist BOTH in
   the provider's public asset list AND in lib/chains.js TOKENS (so the
   on-chain watcher has a verified contract address + decimals to poll). */
export const GUIDED_CATALOG = [
  { asset: 'USDT', network: 'ethereum' },
  { asset: 'USDC', network: 'ethereum' },
  { asset: 'ETH', network: 'ethereum' },
  { asset: 'DAI', network: 'ethereum' },
  { asset: 'USDT', network: 'arbitrum' },
  { asset: 'USDC', network: 'arbitrum' },
  { asset: 'ETH', network: 'arbitrum' },
  { asset: 'USDC', network: 'base' },
  { asset: 'ETH', network: 'base' },
  { asset: 'USDT', network: 'optimism' },
  { asset: 'USDC', network: 'optimism' },
  { asset: 'ETH', network: 'optimism' },
  { asset: 'USDT', network: 'polygon' },
  { asset: 'USDC', network: 'polygon' },
  { asset: 'USDT', network: 'bsc' },
  { asset: 'BNB', network: 'bsc' }
];

/* Fiat currencies the provider's public widget accepts for prefill. The
   final currency decision is always the provider's own. */
export const GUIDED_FIAT = ['USD', 'EUR', 'GBP', 'CHF', 'PLN', 'TRY', 'AED', 'BRL'];

export const isEvmAddress = (a) => typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a.trim());

/* ─── INPUT NORMALISATION ────────────────────────────────────────────────────
 * «پس از زدن قیمت گزینه بعد نمیاد» — the wizard's Next button never enabled
 * for users typing on a Persian/Arabic keyboard: the amount arrived as
 * «۱۰۰» (Eastern digits), Number('۱۰۰') is NaN, and the amount gate stayed
 * shut with no path to the destination site. The same keyboards produce the
 * Arabic decimal separator «٫» and zero-width joiners inside pasted wallet
 * addresses. Everything the wizard validates goes through these first. */

/** Convert Persian (۰-۹) and Arabic-Indic (٠-٩) digits to ASCII 0-9. */
export function normalizeDigits(text) {
  return String(text ?? '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Normalise a human-typed amount to `1234.56` form (digits + one dot). */
export function normalizeAmountInput(text) {
  const ascii = normalizeDigits(text)
    .replace(/[٫،,]/g, '.')      /* Arabic decimal sep / comma → dot */
    .replace(/[^\d.]/g, '');     /* strip currency signs, spaces, letters */
  /* keep only the first dot so '1.2.3' cannot silently mean anything */
  const first = ascii.indexOf('.');
  if (first === -1) return ascii;
  return ascii.slice(0, first + 1) + ascii.slice(first + 1).replace(/\./g, '');
}

/** Normalise a pasted wallet address: digits, whitespace, ZWNJ/LRM/RLM,
 *  and EIP-681 `ethereum:0x…@1` wrappers. Never invents characters. */
export function normalizeWalletInput(text) {
  let cleaned = normalizeDigits(text).replace(/[\s\u200c\u200e\u200f\u2066-\u2069]/g, '');
  cleaned = cleaned.replace(/^ethereum:/i, '');
  const at = cleaned.indexOf('@');
  if (at !== -1 && /^0x[a-fA-F0-9]{40}$/.test(cleaned.slice(0, at))) cleaned = cleaned.slice(0, at);
  return cleaned;
}

/**
 * On-chain metadata for one catalog row, straight from lib/chains.js — the
 * single source of truth the rest of the app already trusts for contract
 * addresses. Returns null when the pair is not in the curated catalog.
 */
export function guidedTokenMeta(network, symbol) {
  const net = GUIDED_NETWORKS[network];
  if (!net) return null;
  const inCatalog = GUIDED_CATALOG.some((row) => row.network === network && row.asset === symbol);
  if (!inCatalog) return null;
  const token = (TOKENS[net.chainId] || []).find((row) => row.symbol === symbol);
  if (!token) return null;
  return {
    chainId: net.chainId,
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    decimals: token.decimals,
    native: Boolean(token.native),
    explorer: EVM_CHAINS[net.chainId]?.explorer || null
  };
}

/** Provider asset code, e.g. ('arbitrum','USDT') → 'ARBITRUM_USDT'. */
export function guidedAssetCode(network, symbol) {
  const net = GUIDED_NETWORKS[network];
  if (!net || !guidedTokenMeta(network, symbol)) return null;
  return `${net.ramp}_${symbol}`;
}

/**
 * Decimal string → integer base-units string, exactly. String math only:
 * '2.5' @ 6 → '2500000'. Floats would corrupt an 18-decimal amount long
 * before it reached a URL that a user will act on.
 */
export function toBaseUnits(value, decimals) {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  if (frac.length > decimals) return null; /* sub-unit dust cannot exist on-chain */
  const joined = `${whole}${frac.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  return joined;
}

/**
 * Compose the official public checkout URL with the user's values prefilled.
 * Documented widget parameters only — nothing invented, nothing signed,
 * nothing that impersonates a partner integration.
 *
 * BUY  → swapAsset + fiatCurrency + fiatValue + userAddress
 * SELL → offrampAsset + swapAmount (base units) + fiatCurrency + userAddress
 *
 * Returns { url, provider } or throws Error with a stable .code the UI maps
 * to a translated message.
 */
export function buildGuidedCheckoutUrl({
  side,
  asset,
  network,
  walletAddress,
  fiatCurrency,
  fiatAmount,
  cryptoAmount,
  finalUrl
}) {
  const fail = (code) => { const e = new Error(code); e.code = code; throw e; };
  if (!GUIDED_PROVIDER.enabled) fail('GUIDED_PROVIDER_DISABLED');
  if (side !== 'BUY' && side !== 'SELL') fail('GUIDED_SIDE_INVALID');
  const meta = guidedTokenMeta(network, asset);
  const code = guidedAssetCode(network, asset);
  if (!meta || !code) fail('GUIDED_ASSET_UNSUPPORTED');
  const wallet = String(walletAddress || '').trim();
  if (!isEvmAddress(wallet)) fail('GUIDED_WALLET_INVALID');
  const fiat = GUIDED_FIAT.includes(fiatCurrency) ? fiatCurrency : null;
  if (!fiat) fail('GUIDED_FIAT_INVALID');

  const params = new URLSearchParams();
  params.set('userAddress', wallet);
  params.set('fiatCurrency', fiat);
  if (side === 'BUY') {
    const amount = Number(fiatAmount);
    if (!Number.isFinite(amount) || amount <= 0) fail('GUIDED_AMOUNT_INVALID');
    params.set('swapAsset', code);
    params.set('fiatValue', String(amount));
    params.set('enabledFlows', 'ONRAMP');
    params.set('defaultFlow', 'ONRAMP');
  } else {
    const units = toBaseUnits(cryptoAmount, meta.decimals);
    if (!units || units === '0') fail('GUIDED_AMOUNT_INVALID');
    params.set('offrampAsset', code);
    params.set('swapAmount', units);
    params.set('enabledFlows', 'OFFRAMP');
    params.set('defaultFlow', 'OFFRAMP');
  }
  if (typeof finalUrl === 'string' && /^https?:\/\//.test(finalUrl)) params.set('finalUrl', finalUrl);

  /* The side-specific public consumer page — see GUIDED_PROVIDER above for
     why the partner widget host must never be used here. */
  const host = GUIDED_PROVIDER.hosts[side];
  if (!host) fail('GUIDED_SIDE_INVALID');

  return { url: `${host}?${params.toString()}`, provider: GUIDED_PROVIDER.id, assetCode: code, meta };
}
