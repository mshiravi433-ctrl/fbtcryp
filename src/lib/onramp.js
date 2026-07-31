/**
 * FIAT ON-RAMP — buying crypto with a card, and the revenue it earns.
 *
 * ─── WHY THIS IS THE HIGHEST-VALUE ADDITION ─────────────────────────────────
 * 2026 wallet monetisation, measured rather than assumed:
 *
 *   swap fees          0.4–1.0% of swap volume   (we already take this)
 *   fiat on-ramp       ~0.3–1% of purchase value, paid by the provider
 *   affiliate/referral one-off bounties, needs an audience we do not have
 *
 * The on-ramp matters because of WHO uses it and HOW MUCH they move. Someone
 * buying their first crypto with a card moves far more per transaction than
 * the same person swapping later, and it is the one moment where a user with
 * no crypto at all becomes a user with a funded wallet — every future swap fee
 * depends on that step happening. A swap-only app can only earn from people
 * who already hold tokens.
 *
 * It also costs nothing to build: the provider handles KYC, payments, fraud
 * and compliance. We hand off a URL and receive a share.
 *
 * ─── WHY THIS FILE HOLDS NO KEY AND TAKES NO MONEY ──────────────────────────
 * The user buys FROM THE PROVIDER, and the coins land in THEIR OWN wallet
 * address. We never take custody, never touch the card, and never see the
 * payment. That is the whole reason a non-custodial app may legally do this:
 * we are an introducer, not a money transmitter.
 *
 * A partner/affiliate id is a PUBLIC identifier, exactly like the
 * WalletConnect project id — it identifies who gets the commission, it does
 * not authorise anything. So it is safe in the client bundle. There is no
 * secret here to leak.
 *
 * ─── HONESTY REQUIREMENTS THE UI MUST KEEP ──────────────────────────────────
 *  1. Say that a third party runs the purchase, BEFORE leaving the app.
 *  2. Never imply we can refund, cancel or support the payment. We cannot.
 *  3. The destination address must be the user's own, shown to them first —
 *     a prefilled wrong address means money sent to a stranger, permanently.
 */

/** Providers, in the order shown. Availability differs per country. */
const PROVIDERS = [
  {
    id: 'moonpay',
    /*
     * MoonPay: widest card coverage and the largest network of local payment
     * methods, which is why it is first.
     */
    build: ({ apiKey, address, coin, fiat, amount }) => {
      const u = new URL('https://buy.moonpay.com');
      if (apiKey) u.searchParams.set('apiKey', apiKey);
      if (address) u.searchParams.set('walletAddress', address);
      if (coin) u.searchParams.set('currencyCode', coin.toLowerCase());
      if (fiat) u.searchParams.set('baseCurrencyCode', fiat.toLowerCase());
      if (amount) u.searchParams.set('baseCurrencyAmount', String(amount));
      return u.toString();
    }
  },
  {
    id: 'transak',
    build: ({ apiKey, address, coin, fiat, amount, network }) => {
      const u = new URL('https://global.transak.com');
      if (apiKey) u.searchParams.set('apiKey', apiKey);
      if (address) u.searchParams.set('walletAddress', address);
      if (coin) u.searchParams.set('cryptoCurrencyCode', coin.toUpperCase());
      if (network) u.searchParams.set('network', network);
      if (fiat) u.searchParams.set('fiatCurrency', fiat.toUpperCase());
      if (amount) u.searchParams.set('fiatAmount', String(amount));
      return u.toString();
    }
  },
  {
    id: 'ramp',
    build: ({ apiKey, address, coin, fiat, amount }) => {
      const u = new URL('https://app.ramp.network');
      if (apiKey) u.searchParams.set('hostApiKey', apiKey);
      u.searchParams.set('hostAppName', 'FBT Swap');
      if (address) u.searchParams.set('userAddress', address);
      if (coin) u.searchParams.set('swapAsset', coin.toUpperCase());
      if (fiat) u.searchParams.set('fiatCurrency', fiat.toUpperCase());
      if (amount) u.searchParams.set('fiatValue', String(amount));
      return u.toString();
    }
  }
];

const envKey = (name) =>
  (typeof import.meta !== 'undefined' && import.meta.env?.[name]) || '';

/**
 * Which providers are usable.
 *
 * A provider with no partner id still WORKS for the user — the widget opens
 * and they can buy — we simply earn nothing. That is a deliberate choice:
 * a user who cannot fund their wallet is worth less than an unattributed
 * purchase, and hiding the feature until the paperwork clears would block the
 * whole funnel.
 */
export function onrampProviders() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    key: envKey(`VITE_${p.id.toUpperCase()}_KEY`)
  }));
}

/** True when at least one provider will attribute purchases to us. */
export const onrampMonetised = () => onrampProviders().some((p) => Boolean(p.key));

/**
 * Chain id → the network slug providers expect. Only chains where a provider
 * can actually deliver are listed; offering a chain they cannot settle on
 * produces a failed purchase after the user has already paid.
 */
const NETWORKS = {
  1: 'ethereum',
  56: 'bsc',
  137: 'polygon',
  42161: 'arbitrum',
  8453: 'base',
  10: 'optimism'
};

export const onrampNetwork = (chainId) => NETWORKS[Number(chainId)] ?? null;
export const onrampSupportsChain = (chainId) => Boolean(NETWORKS[Number(chainId)]);

/**
 * Build the checkout URL.
 *
 * Returns null rather than a half-built URL when the address is missing or
 * malformed. A widget opened with no destination silently defaults to letting
 * the provider pick one, and the user would be buying coins into an address
 * they do not control — unrecoverable, and our fault.
 */
export function buildOnrampUrl({
  provider = 'moonpay',
  address,
  coin = 'usdt',
  fiat = 'usd',
  amount,
  chainId
} = {}) {
  const p = PROVIDERS.find((x) => x.id === provider);
  if (!p) return null;

  const addr = String(address ?? '').trim();
  // EVM only for now; a Solana/Tron address in an EVM widget is a lost payment.
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return null;

  const n = Number(amount);
  const safeAmount = Number.isFinite(n) && n > 0 ? Math.min(n, 20000) : undefined;

  return p.build({
    apiKey: envKey(`VITE_${provider.toUpperCase()}_KEY`),
    address: addr,
    coin,
    fiat,
    amount: safeAmount,
    network: onrampNetwork(chainId)
  });
}
