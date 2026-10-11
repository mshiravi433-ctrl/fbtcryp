/**
 * RAMP DIRECTORY — every keyless way in and out, ranked for where the user is.
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS IS ─────────────────────────────────────────────────────────
 * One curated list of fiat on/off-ramps that a user can reach WITHOUT us
 * holding a partner contract, plus the peer-to-peer rails that need no
 * counterparty at all. Given a country and a side (buy/sell) it answers one
 * question: «which doors are actually open to this person, and which are
 * closed — and why».
 *
 * ─── THE THREE RULES THIS MODULE CANNOT BREAK ──────────────────────────────
 *  1. NO INVENTED COVERAGE. A row either carries a per-country list the
 *     provider itself publishes (`coverage.mode: 'exclusion'`, with the source
 *     URL and the date it was read) or it admits it does not know
 *     (`mode: 'unknown'`), and then the UI says «the provider decides» instead
 *     of promising anything. No row is ever filled in from memory, from a
 *     third-party blog, or by extrapolation.
 *  2. NO CREDENTIAL OF OURS. Every row works with the provider's own public
 *     page. The only values we may add come from `VITE_*` env vars and are
 *     PUBLIC attribution ids (a widget id, a referral code) — never a secret
 *     and never something that makes the page load: without them the link is
 *     still valid, it just credits nobody.
 *  3. NOTHING IS BYPASSED. A country the provider excludes is reported as
 *     excluded and the row is dropped from the open list. We never hide a
 *     rejection, never reorder around it, never suggest a VPN. When every
 *     on-ramp is closed for a country, the peer-to-peer rails are what the
 *     user is offered — not a workaround.
 *
 * ─── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 * MoonPay, Transak, Coinbase (CDP Onramp), Stripe/Bridge, Sardine, Zerohash:
 * all of them are better products than several rows below, and all of them
 * require a signed partner agreement and KYB of OUR entity before their widget
 * will load at all. A link to them without that is a page that says
 * «Integration issue detected» — the exact dead tap this directory exists to
 * avoid. They belong in the tracked flow (`server/buySell.js`), which already
 * has a provider registry waiting for them.
 *
 * ─── WHY THE P2P ROWS ARE ALWAYS RETURNED ──────────────────────────────────
 * «همه کشورها» includes the places every card processor refuses: Iran, and
 * about a hundred more. For those users the honest door is a peer-to-peer
 * market with escrow and no KYC at the door. It is slower and it is largely
 * bitcoin-only, so it is presented as a fallback, never as the same thing.
 */

import { GUIDED_FIAT, buildGuidedCheckoutUrl } from './guidedCheckout.js';

export const RAMP_DIRECTORY_SCHEMA = 'fbt.ramp-directory.v1';

/* Env access. `VITE_*` values are PUBLIC by construction — they end up in the
   bundle and in URLs. Nothing secret may ever be read through this. */
const env = (key) => (typeof import.meta !== 'undefined' ? import.meta.env?.[key] : undefined) || '';

/* ─────────────────────────────────────────────────────────────────────────────
 * RAMP NETWORK — the provider's own published list of unsupported countries.
 * Transcribed from <https://support.rampnetwork.com/en/articles/433-which-
 * countries-and-us-states-are-unsupported-for-buying-and-selling-crypto> on
 * 2026-10-11, mapped to ISO 3166-1 alpha-2. It is data, dated and sourced:
 * when Ramp changes its list this array must be re-read, not edited from
 * memory. `verifiedAt` Below is what the UI shows next to the claim.
 * ────────────────────────────────────────────────────────────────────────── */
export const RAMP_COVERAGE_SOURCE =
  'https://support.rampnetwork.com/en/articles/433-which-countries-and-us-states-are-unsupported-for-buying-and-selling-crypto';
export const RAMP_COVERAGE_VERIFIED_AT = '2026-10-11';

export const RAMP_EXCLUDED_COUNTRIES = Object.freeze([
  'AF', 'DZ', 'AO', 'AI', 'AG', 'AM', 'AW', 'AZ', 'BS', 'BH', 'BD', 'BB', 'BY', 'BZ', 'BJ', 'BO',
  'BA', 'VG', 'BF', 'BI', 'KH', 'CM', 'CF', 'TD', 'CN', 'KM', 'CG', 'CI', 'CU', 'CW', 'DJ', 'DM',
  'EC', 'EG', 'GQ', 'ER', 'SZ', 'ET', 'FJ', 'GA', 'GM', 'GH', 'GD', 'GT', 'GN', 'GW', 'GY', 'HT',
  'ID', 'IR', 'IQ', 'JM', 'JP', 'JO', 'KE', 'KI', 'XK', 'KG', 'LA', 'LB', 'LS', 'LR', 'LY', 'MO',
  'MG', 'MW', 'MV', 'ML', 'MR', 'MU', 'FM', 'MN', 'ME', 'MS', 'MA', 'MZ', 'MM', 'NA', 'NP', 'NI',
  'NE', 'NG', 'NU', 'KP', 'OM', 'PK', 'PW', 'PS', 'PA', 'PG', 'PN', 'PR', 'QA', 'RU', 'RW', 'KN',
  'LC', 'VC', 'WS', 'SA', 'SN', 'SC', 'SL', 'SB', 'SO', 'KR', 'SS', 'LK', 'SD', 'SR', 'SY', 'TW',
  'TJ', 'TZ', 'TH', 'TL', 'TG', 'TO', 'TT', 'TN', 'TM', 'TC', 'TV', 'VI', 'UG', 'UA', 'UZ', 'VU',
  'VE', 'VN', 'YE', 'ZW'
]);

/* ─────────────────────────────────────────────────────────────────────────────
 * THE DIRECTORY
 *
 * kind      'fiat' (a card/bank rail) or 'p2p' (peer to peer, no counterparty)
 * access    'public'   — works with nothing from us at all
 *           'attribution' — works without it, earns with it (public id in env)
 * coverage  see rule 1 above
 * fiat      the currencies the row documents, or 'unknown' (never guessed)
 * prefill   which of the user's answers we can carry into the URL
 * ────────────────────────────────────────────────────────────────────────── */
export const RAMP_DIRECTORY = Object.freeze([
  {
    id: 'ramp',
    kind: 'fiat',
    name: 'Ramp Network',
    origin: 'https://app.rampnetwork.com',
    sides: ['BUY', 'SELL'],
    access: 'public',
    enabled: true,
    prefill: ['asset', 'fiat', 'amount', 'wallet'],
    coverage: {
      mode: 'exclusion',
      excluded: RAMP_EXCLUDED_COUNTRIES,
      source: RAMP_COVERAGE_SOURCE,
      verifiedAt: RAMP_COVERAGE_VERIFIED_AT
    },
    fiat: GUIDED_FIAT,
    docs: 'https://docs.rampnetwork.com/',
    /* The curated asset/network catalog the URL composer validates against is
       the one already pinned in guidedCheckout.js — the same addresses the
       on-chain watcher polls, so the report watches the token named here. */
    note: 'kycOnProvider'
  },
  {
    id: 'mercuryo',
    kind: 'fiat',
    name: 'Mercuryo',
    origin: 'https://exchange.mercuryo.io',
    sides: ['BUY', 'SELL'],
    access: 'attribution',
    enabled: true,
    /* Parameters read from <https://widget.docs.mercuryo.io/guide/integration/
       widget-parameters> (2026-10-11): widget_id, type, currency (CRYPTO
       ticker), amount (CRYPTO amount), fiat_currency, fiat_amount (FIAT
       amount), payment_method, redirect_url.
       Note the trap the docs settle: `amount` is the crypto amount and
       `fiat_amount` is the fiat one — they are not interchangeable, and
       sending a fiat number as `amount` would ask Mercuryo for 100 COINS.
       The destination WALLET is deliberately NOT pre-filled even though
       `address` is documented: without a verified mapping from our network
       slugs to Mercuryo's network codes, an address sent alone can be paid on
       a different chain than the one this order and its on-chain watch are
       built around. The user picks the network and pastes the address on
       Mercuryo's own page, where both are visible in the same step. */
    prefill: ['asset', 'fiat', 'amount'],
    requires: { env: 'VITE_MERCURYO_WIDGET_ID', pattern: /^[A-Za-z0-9_-]{4,64}$/ },
    coverage: { mode: 'unknown', source: 'https://mercuryo.io/' },
    fiat: 'unknown',
    docs: 'https://widget.docs.mercuryo.io/',
    note: 'kycOnProvider'
  },
  {
    id: 'swapzone',
    kind: 'fiat',
    name: 'Swapzone',
    origin: 'https://swapzone.io',
    sides: ['BUY', 'SELL'],
    access: 'public',
    enabled: true,
    /* Documented by the pages themselves: /buy/{fiat}/{crypto} and
       /sell/{crypto}/{fiat} both render a live offer list for the pair. The
       pair is carried in the PATH, so it survives without a session. The
       wallet address is filled on their page, not here. */
    prefill: ['asset', 'fiat'],
    coverage: { mode: 'unknown', source: 'https://swapzone.io/' },
    fiat: 'unknown',
    docs: 'https://swapzone.io/',
    note: 'kycOnProvider'
  },
  {
    id: 'guardarian',
    kind: 'fiat',
    name: 'Guardarian',
    origin: 'https://guardarian.com',
    sides: ['BUY', 'SELL'],
    access: 'public',
    enabled: true,
    /* Their public page is a working buy/sell calculator with 170+ countries
       and 30+ fiat listed on it — but no per-country list we could transcribe,
       so this row claims nothing and pre-fills nothing. */
    prefill: [],
    coverage: { mode: 'unknown', source: 'https://guardarian.com/' },
    fiat: 'unknown',
    docs: 'https://guardarian.com/',
    note: 'kycOnProvider'
  }
]);

/* ─────────────────────────────────────────────────────────────────────────────
 * THE PEER-TO-PEER RAILS — returned for every country on earth.
 * `internal: true` means the door is inside this app (the Hodl Hodl market the
 * server already proxies, with escrow on their side and our referral attached
 * server-side where it cannot be swapped). The others are external apps, so
 * the user is told they are leaving before the tap.
 * ────────────────────────────────────────────────────────────────────────── */
export const P2P_RAILS = Object.freeze([
  { id: 'hodlhodl', name: 'Hodl Hodl', url: '/p2p', internal: true, assets: 'BTC', note: 'p2pInApp' },
  { id: 'bisq', name: 'Bisq', url: 'https://bisq.network/', internal: false, assets: 'BTC', note: 'p2pDesktop' },
  { id: 'robosats', name: 'RoboSats', url: 'https://robosats.com/', internal: false, assets: 'BTC', note: 'p2pLightning' },
  { id: 'peach', name: 'Peach Bitcoin', url: 'https://peachbitcoin.com/', internal: false, assets: 'BTC', note: 'p2pMobile' }
]);

/* ─── URL COMPOSERS ─────────────────────────────────────────────────────────
 * One per row. Each returns { url, prefill } or null when the row cannot
 * produce a usable link right now (unconfigured, unsupported asset…). None of
 * them may invent a parameter, and none of them may build a URL whose host is
 * not the row's own origin — asserted by test/units.mjs. */

const positiveAmount = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/* Path segments for providers that carry the pair in the URL path. Anything
   that is not a plain ticker is dropped rather than escaped into a guess. */
const slug = (value) => {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-z0-9-]{1,20}$/.test(text) ? text : null;
};

const BUILDERS = {
  /* Ramp: delegate to the composer that already exists. It validates the
     asset against the curated catalog, the wallet against 0x+40hex, and the
     amount with exact string math — and it throws stable codes we map below. */
  ramp: (input) => {
    const built = buildGuidedCheckoutUrl(input);
    return { url: built.url, prefill: ['asset', 'fiat', 'amount', 'wallet'] };
  },

  /* Mercuryo: documented params only. Requires the public widget id; without
     it the row is UNCONFIGURED, never a link with someone else's id in it.
     `fiat_amount` carries the fiat figure on BUY and `amount` the crypto
     figure on SELL — per their parameter reference those are different
     fields, and mixing them up asks for the wrong quantity. */
  mercuryo: (input) => {
    const id = env('VITE_MERCURYO_WIDGET_ID');
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return null;
    const params = new URLSearchParams();
    params.set('widget_id', id);
    params.set('type', input.side === 'SELL' ? 'sell' : 'buy');
    const ticker = slug(input.asset);
    if (ticker) params.set('currency', ticker.toUpperCase());
    if (input.fiatCurrency) params.set('fiat_currency', input.fiatCurrency);
    const prefill = ['asset', 'fiat'];
    if (input.side === 'SELL') {
      const units = positiveAmount(input.cryptoAmount);
      if (units) { params.set('amount', String(units)); prefill.push('amount'); }
    } else {
      const fiat = positiveAmount(input.fiatAmount);
      if (fiat) { params.set('fiat_amount', String(fiat)); prefill.push('amount'); }
    }
    if (typeof input.finalUrl === 'string' && /^https?:\/\//.test(input.finalUrl)) params.set('redirect_url', input.finalUrl);
    return { url: `https://exchange.mercuryo.io/?${params.toString()}`, prefill };
  },

  /* Swapzone: the pair travels in the path. Verified pages:
     /buy/usd/usdt and /sell/usdt/usd. */
  swapzone: (input) => {
    const fiat = slug(input.fiatCurrency);
    const crypto = slug(input.asset);
    if (!fiat || !crypto) return null;
    const path = input.side === 'SELL' ? `/sell/${crypto}/${fiat}` : `/buy/${fiat}/${crypto}`;
    return { url: `https://swapzone.io${path}`, prefill: ['asset', 'fiat'] };
  },

  /* Guardarian: their own public calculator. Nothing pre-filled, nothing
     assumed about the pair — the user picks on a page that works everywhere. */
  guardarian: () => ({ url: 'https://guardarian.com/', prefill: [] })
};

/* Stable reason codes the UI translates. A rejection is always named. */
const BUILD_REASONS = Object.freeze({
  GUIDED_ASSET_UNSUPPORTED: 'ASSET_UNSUPPORTED',
  GUIDED_FIAT_INVALID: 'FIAT_UNSUPPORTED',
  GUIDED_AMOUNT_INVALID: 'AMOUNT_REQUIRED',
  GUIDED_WALLET_INVALID: 'WALLET_REQUIRED',
  GUIDED_SIDE_INVALID: 'SIDE_UNSUPPORTED',
  GUIDED_PROVIDER_DISABLED: 'PROVIDER_DISABLED'
});

export function normalizeCountry(value) {
  const text = String(value ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : null;
}

/** Where does this row stand for this country? Never guesses. */
export function coverageState(row, country) {
  if (!country) return { state: 'unknown-country', source: row.coverage?.source || null };
  if (row.coverage?.mode === 'exclusion' && Array.isArray(row.coverage.excluded)) {
    return row.coverage.excluded.includes(country)
      ? { state: 'excluded', source: row.coverage.source, verifiedAt: row.coverage.verifiedAt }
      : { state: 'listed', source: row.coverage.source, verifiedAt: row.coverage.verifiedAt };
  }
  /* No published per-country list → we know nothing, and we say so. */
  return { state: 'unknown', source: row.coverage?.source || null };
}

/**
 * The ranked answer to «what can this person use right now».
 *
 * @returns {{
 *   ok: true, schema: string, country: string|null, countryKnown: boolean,
 *   side: 'BUY'|'SELL',
 *   options: Array<{id,name,url,tier,prefill:string[],coverage:string,fiat:string[]|'unknown',docs:string}>,
 *   unavailable: Array<{id,name,reason:string,source?:string}>,
 *   p2p: Array<{id,name,url,internal:boolean,assets:string,note:string}>,
 *   recommended: string|null
 * }}
 */
export function rampOptions({
  country = null,
  side = 'BUY',
  asset = null,
  network = null,
  walletAddress = null,
  fiatCurrency = null,
  fiatAmount = null,
  cryptoAmount = null,
  finalUrl = null
} = {}) {
  const normSide = side === 'SELL' ? 'SELL' : 'BUY';
  const normCountry = normalizeCountry(country);
  const input = {
    side: normSide, asset, network, walletAddress, fiatCurrency, fiatAmount, cryptoAmount, finalUrl
  };
  const options = [];
  const unavailable = [];

  for (const row of RAMP_DIRECTORY) {
    if (!row.enabled) { unavailable.push({ id: row.id, name: row.name, reason: 'PROVIDER_DISABLED' }); continue; }
    if (!row.sides.includes(normSide)) { unavailable.push({ id: row.id, name: row.name, reason: 'SIDE_UNSUPPORTED' }); continue; }

    const cov = coverageState(row, normCountry);
    if (cov.state === 'excluded') {
      /* Named, sourced, and never reordered around. */
      unavailable.push({ id: row.id, name: row.name, reason: 'COUNTRY_EXCLUDED', source: cov.source, verifiedAt: cov.verifiedAt });
      continue;
    }

    let built = null;
    try {
      built = (BUILDERS[row.id] || (() => null))(input);
    } catch (error) {
      unavailable.push({ id: row.id, name: row.name, reason: BUILD_REASONS[error?.code] || 'BUILD_FAILED' });
      continue;
    }
    if (!built) {
      unavailable.push({ id: row.id, name: row.name, reason: row.requires ? 'NOT_CONFIGURED' : 'UNAVAILABLE' });
      continue;
    }

    const prefill = Array.isArray(built.prefill) ? built.prefill : [];
    options.push({
      id: row.id,
      name: row.name,
      kind: row.kind,
      url: built.url,
      /* tier drives the order: everything filled in first, the page-only
         doors last. It is a statement about how much typing the user has
         left, never about which provider is better. */
      /* "full" means the destination is typed too, not merely the numbers: a
         row that pre-fills amounts but leaves the wallet address (and the
         network it belongs to) to the provider's page is a different amount
         of work AND a different certainty about where the coins land. Ranking
         it as "full" would tell the user something untrue about both. */
      tier: prefill.includes('wallet') ? 'full' : (prefill.length ? 'partial' : 'page'),
      prefill,
      coverage: cov.state,
      coverageSource: cov.source || null,
      fiat: row.fiat,
      docs: row.docs,
      note: row.note
    });
  }

  const rank = { full: 0, partial: 1, page: 2 };
  options.sort((a, b) => rank[a.tier] - rank[b.tier]);

  /* Did ANY open row actually verify this country? When none did, the UI must
     say the quiet part out loud: these doors are open as far as we know, and
     each provider may still turn the user away on its own page. */
  const coverageVerified = options.some((option) => option.coverage === 'listed');

  return {
    ok: true,
    schema: RAMP_DIRECTORY_SCHEMA,
    country: normCountry,
    countryKnown: Boolean(normCountry),
    side: normSide,
    options,
    unavailable,
    p2p: P2P_RAILS.map((rail) => ({ ...rail })),
    coverageVerified,
    recommended: options.length ? options[0].id : null
  };
}

/** Compose one row's handoff URL directly (used by the UI's per-row button). */
export function buildRampHandoffUrl(providerId, input) {
  const row = RAMP_DIRECTORY.find((entry) => entry.id === providerId);
  if (!row || !row.enabled) return null;
  const built = (BUILDERS[row.id] || (() => null))(input);
  return built ? { url: built.url, prefill: built.prefill, provider: row.id, name: row.name } : null;
}
