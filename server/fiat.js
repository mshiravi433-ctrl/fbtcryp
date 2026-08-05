/**
 * FIAT BUY & SELL — ChangeNOW's on-ramp, and ONLY the on-ramp.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS WHEN THE SWAP INTEGRATION WAS DELETED ──────────────────
 * A previous version of this integration quoted ChangeNOW's CRYPTO-TO-CRYPTO
 * swap. That was a mistake and the owner caught it: «ما خودمون صرافی هستیم
 * نیاز به سواپ کسی نداریم». We run a swap. Advertising a competitor's swap on
 * our own screens hands over a user who has already arrived and already
 * trusts us, and it earned nothing.
 *
 * Fiat is the opposite case, and the distinction is the whole reason this
 * file exists:
 *
 *   SWAP (crypto → crypto)  — we do this ourselves, at 0.70%, on-chain.
 *                             Never route it elsewhere.
 *   FIAT (money → crypto)   — we do NOT do this and cannot: it needs a
 *                             licensed payment institution, card acquiring,
 *                             and a compliance stack. Sending a user to a
 *                             partner here competes with nothing of ours.
 *
 * So this module is deliberately incapable of quoting a crypto-to-crypto
 * pair. `assertFiatLeg` below enforces that, and a test asserts it, because
 * the easy mistake is to "just add" a crypto pair later and quietly re-create
 * the thing that was deleted.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── WHAT WAS BROKEN BEFORE, AND WHY IT COULD NEVER HAVE WORKED ─────────────
 *
 * The first version of this file called
 *
 *     GET /v2/exchange/estimated-amount?fromCurrency=usd&toCurrency=btc...
 *
 * That is the CRYPTO SWAP endpoint. It has no idea what a fiat currency is.
 * With a live key set in Vercel the route returned `QUOTE_FAILED` on every
 * single request, which is exactly what the owner saw: an API key that was
 * correctly installed, a status endpoint reporting `enabled:true`, and a
 * screen that could not produce one number.
 *
 * ChangeNOW's fiat product is a SEPARATE family of endpoints with a separate
 * naming convention (snake_case, not camelCase) and a separate auth header:
 *
 *     GET  /v2/fiat-status                                 health, keyless
 *     GET  /v2/fiat-currencies/fiat                        fiat list
 *     GET  /v2/fiat-currencies/crypto                      crypto list
 *     GET  /v2/fiat-market-info/min-max-range/{from}_{to}  limits, keyless
 *     GET  /v2/fiat-estimate?from_currency=…               quote, KEY REQUIRED
 *     POST /v2/fiat-transaction                            order, KEY REQUIRED
 *
 * Verified live from this machine while writing it — `min-max-range/usd_btc`
 * answers `{"from":"USD","to":"BTC","min":"19.04…","max":"28859.09…"}`, and
 * `fiat-estimate` without a key answers `{"code":"INVALID_TOKEN"}` rather than
 * the swap endpoint's bare `Unauthorized`. Two different services.
 *
 * The header is `x-api-key` for the fiat family. The swap family uses
 * `x-changenow-api-key`. Sending the wrong one authenticates nothing, and
 * this is the second reason the old code could not have worked even if the
 * path had been right. Both are sent, because they are both ours and the
 * upstream ignores the one it does not recognise.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── HOW WE ACTUALLY GET PAID, WHICH IS NOT WHAT THE OLD CODE CLAIMED ───────
 *
 * The old file read `CHANGENOW_FIAT_FEE`, defaulted it to 1, and displayed
 * "our fee: 1%" on screen. Nothing anywhere deducted that 1%. It was a label
 * with no mechanism behind it — we would have shown users a fee we never
 * charged, and earned nothing from it.
 *
 * The real mechanism: the commission is a property of the PARTNER ACCOUNT,
 * not of the request. Every call carrying our API key is attributed to our
 * account, ChangeNOW applies the partner rate agreed on the dashboard, and
 * the amount lands in the `service_fees` array of the estimate. We do not add
 * a percentage; we are already inside their number.
 *
 * That is why `fiatQuote` returns their `service_fees` verbatim instead of
 * inventing a figure. It is the true, itemised cost, and it is the one the
 * user will actually be charged.
 */

const CN_BASE = 'https://api.changenow.io/v2';
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);

/**
 * The partner key. Server-side only.
 *
 * NOT `VITE_`: unlike a public referral code, this authenticates the account
 * and carries our commission settings. In a client bundle it could be lifted
 * and used to attribute someone else's volume, or exhausted against our rate
 * limit.
 */
const apiKey = () => process.env.CHANGENOW_API_KEY || '';

/** True when a key exists. Necessary for fiat, not sufficient — see below. */
export const fiatConfigured = () => Boolean(apiKey());

/**
 * True only when ChangeNOW have actually enabled fiat on the account.
 *
 * A deliberate second switch. Their fiat product is granted per-partner after
 * a compliance review, so a valid API key with fiat disabled returns errors on
 * every fiat call. Without this flag the screen would render, look ready, and
 * fail for every user — the "wired to nothing" failure this project has
 * already shipped twice.
 */
export const fiatEnabled = () =>
  Boolean(apiKey()) && process.env.CHANGENOW_FIAT_ENABLED === 'true';

/**
 * Fiat currencies we offer, with the deposit rail each one settles on.
 *
 * ─── WHY THE RAIL IS PART OF THE RECORD ─────────────────────────────────────
 * ChangeNOW price fiat per payment method, and the limits differ sharply: EUR
 * over SEPA starts at €16.50, USD over card at $19.05, TRY over card at
 * ₺906. Quoting one and charging the other produces a "minimum not met"
 * rejection AFTER the user has entered their card details, which is the worst
 * possible place to discover it.
 *
 * ─── AND WHY THE RIAL IS NOT HERE, AND CANNOT BE ────────────────────────────
 * IRR is absent because no international payment processor settles it. Visa,
 * Mastercard and Amex have been severed from Iran's banking system at the
 * network level since 2012 and OFAC's Iran program (reviewed January 2026)
 * shows no change. An Iranian bank card cannot authorise a foreign crypto
 * purchase — that is a property of the card networks, not a setting.
 *
 * Listing IRR would produce a button that fails for every user who taps it,
 * which is exactly the class of dead button the Buy screen was rebuilt to
 * remove. The Restrictions sheet says this plainly instead of pretending.
 */
export const FIAT_CURRENCIES = [
  { code: 'usd', symbol: '$', name: 'US Dollar', deposit: 'VISA_MC1' },
  { code: 'eur', symbol: '€', name: 'Euro', deposit: 'SEPA_1' },
  { code: 'gbp', symbol: '£', name: 'British Pound', deposit: 'VISA_MC1' },
  { code: 'try', symbol: '₺', name: 'Turkish Lira', deposit: 'VISA_MC1' },
  { code: 'aed', symbol: 'AED', name: 'UAE Dirham', deposit: 'VISA_MC1' }
];

/**
 * Crypto the user can buy or sell, keyed by ChangeNOW's fiat-side ticker AND
 * network.
 *
 * ─── THE NETWORK IS NOT OPTIONAL AND THIS IS THE SUBTLE PART ────────────────
 * The fiat API identifies an asset as a `(currency, network)` PAIR, not as
 * one fused ticker. The swap API's `usdttrc20` style does not exist here: it
 * is `to_currency=USDT` with `to_network=TRX`. Sending `usdttrc20` gets a
 * currency-not-found error, and sending `USDT` with no network is ambiguous
 * across TRON, BSC and Ethereum — three different chains, three different
 * addresses, and a payout to the wrong one is unrecoverable.
 *
 * `id` is our own stable handle so the UI never has to join two fields.
 * Verified live: `min-max-range/usd_usdt-trx`, `usd_usdt-bsc`, `usd_usdc-bsc`,
 * `usd_bnb-bsc`, `usd_sol-sol`, `usd_btc-btc`, `usd_eth-eth` all answer.
 *
 * Small on purpose. These are the assets our own app can then do something
 * useful with — the point of the on-ramp is to get somebody INTO the app with
 * something swappable, not to be a shop window for a thousand tokens.
 */
export const FIAT_CRYPTO = [
  { id: 'btc', ticker: 'BTC', network: 'BTC', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'eth', ticker: 'ETH', network: 'ETH', symbol: 'ETH', name: 'Ethereum' },
  { id: 'usdt-trx', ticker: 'USDT', network: 'TRX', symbol: 'USDT', name: 'Tether (TRON)' },
  { id: 'usdt-bsc', ticker: 'USDT', network: 'BSC', symbol: 'USDT', name: 'Tether (BNB Chain)' },
  { id: 'usdc-bsc', ticker: 'USDC', network: 'BSC', symbol: 'USDC', name: 'USD Coin (BNB Chain)' },
  { id: 'bnb-bsc', ticker: 'BNB', network: 'BSC', symbol: 'BNB', name: 'BNB' },
  { id: 'sol', ticker: 'SOL', network: 'SOL', symbol: 'SOL', name: 'Solana' }
];

const FIATS = new Map(FIAT_CURRENCIES.map((c) => [c.code, c]));
const CRYPTOS = new Map(FIAT_CRYPTO.map((c) => [c.id, c]));

/**
 * Exactly one side must be fiat. This is the guard that keeps the module
 * honest.
 *
 * ─── THE MISTAKE THIS PREVENTS ──────────────────────────────────────────────
 * Without it, `btc → eth` would be a valid request and this file would
 * silently become the crypto-swap integration that was deleted for competing
 * with our own product. The check is cheap; the mistake is expensive and easy
 * to make by "just adding one pair".
 *
 * Returns the resolved legs too, so no caller has to look them up a second
 * time and risk resolving one side differently from the other.
 */
export function assertFiatLeg(from, to) {
  const fromFiat = FIATS.get(from);
  const toFiat = FIATS.get(to);
  const fromCrypto = CRYPTOS.get(from);
  const toCrypto = CRYPTOS.get(to);

  /* Buy: fiat → crypto. Sell: crypto → fiat. Nothing else. */
  if (fromFiat && toCrypto) {
    return { direction: 'buy', money: fromFiat, asset: toCrypto };
  }
  if (fromCrypto && toFiat) {
    return { direction: 'sell', money: toFiat, asset: fromCrypto };
  }
  return null;
}

/**
 * Build the `{from}_{to}` path segment the min-max endpoint wants.
 *
 * Fiat legs are bare (`usd`); crypto legs carry the network (`usdt-trx`).
 * Verified against the live endpoint in both directions — `usd_usdt-trx` and
 * `usdt-trx_usd` each return a range.
 */
function rangePair({ direction, money, asset }) {
  return direction === 'buy'
    ? `${money.code}_${asset.id}`
    : `${asset.id}_${money.code}`;
}

async function cnFetch(path, { method = 'GET', body = null } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = { accept: 'application/json' };
    const k = apiKey();
    if (k) {
      /*
       * Both spellings, on purpose. The fiat family reads `x-api-key`; the
       * swap family reads `x-changenow-api-key`. Sending only the second is
       * how the previous version authenticated nothing. Sending both is
       * harmless — an upstream ignores a header it does not know — and
       * removes an entire class of silent-401 bug.
       */
      headers['x-api-key'] = k;
      headers['x-changenow-api-key'] = k;
    }
    if (body) headers['content-type'] = 'application/json';

    const res = await fetch(`${CN_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { message: text.slice(0, 200) };
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/** A number, or null. Never 0-as-a-fallback — see the note in fiatQuote. */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/fiat/range — the accepted amounts for this pair.
 *
 * Its own route because it is KEYLESS upstream and can therefore answer even
 * before the owner's fiat access is switched on. That matters: it lets the
 * screen show real limits instead of an empty form, so a user who cannot yet
 * buy still learns what the minimum will be.
 */
export async function fiatRange({ from, to }) {
  const f = String(from || '').trim().toLowerCase();
  const t = String(to || '').trim().toLowerCase();

  const leg = assertFiatLeg(f, t);
  if (!leg) return { ok: false, status: 400, body: { error: 'NOT_A_FIAT_PAIR' } };

  const qs = new URLSearchParams({
    deposit_type: leg.direction === 'buy' ? leg.money.deposit : 'CRYPTO_THROUGH_CN',
    payout_type: leg.direction === 'buy' ? 'CRYPTO_THROUGH_CN' : leg.money.deposit
  });

  const res = await cnFetch(`/fiat-market-info/min-max-range/${rangePair(leg)}?${qs}`);
  if (!res.ok) {
    return { ok: false, status: res.status, body: { error: 'RANGE_FAILED' } };
  }

  return {
    ok: true,
    status: 200,
    body: {
      direction: leg.direction,
      from: f,
      to: t,
      min: num(res.body?.min),
      max: num(res.body?.max)
    }
  };
}

/**
 * GET /api/fiat/quote — what would this money buy?
 *
 * Returns null for the estimate rather than 0 when the pair cannot be priced.
 * Zero would render as a real answer meaning "you get nothing", and on a
 * purchase screen that is the difference between a user waiting and a user
 * concluding the app is broken.
 */
export async function fiatQuote({ from, to, amount }) {
  const f = String(from || '').trim().toLowerCase();
  const t = String(to || '').trim().toLowerCase();

  const leg = assertFiatLeg(f, t);
  if (!leg) return { ok: false, status: 400, body: { error: 'NOT_A_FIAT_PAIR' } };

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, status: 400, body: { error: 'BAD_AMOUNT' } };
  }

  if (!fiatEnabled()) {
    /*
     * Named, not a bare 401 passed through. "FIAT_NOT_ENABLED" tells the UI
     * to show a specific explanation; a raw upstream error would look like a
     * bug in our app rather than a setting on their side.
     */
    return { ok: false, status: 503, body: { error: 'FIAT_NOT_ENABLED' } };
  }

  const { direction, money, asset } = leg;

  /*
   * snake_case, and the network on its own parameter. This is the fiat API's
   * convention; the camelCase `fromCurrency` of the swap API is a different
   * service and was the original bug.
   */
  const qs = new URLSearchParams({
    from_currency: direction === 'buy' ? money.code : asset.ticker,
    from_network: direction === 'buy' ? '' : asset.network,
    from_amount: String(amt),
    to_currency: direction === 'buy' ? asset.ticker : money.code,
    to_network: direction === 'buy' ? asset.network : '',
    deposit_type: direction === 'buy' ? money.deposit : 'CRYPTO_THROUGH_CN',
    payout_type: direction === 'buy' ? 'CRYPTO_THROUGH_CN' : money.deposit
  });

  const res = await cnFetch(`/fiat-estimate?${qs}`);
  if (!res.ok) {
    /*
     * ─── ONE UPSTREAM MESSAGE DESERVES ITS OWN ERROR CODE ───────────────────
     * Verified against the live deployment with the owner's real key set:
     *
     *     GET /api/fiat/quote?from=usd&to=usdt-bsc&amount=200
     *     -> {"error":"QUOTE_FAILED","detail":"token not found for passed api-key"}
     *
     * That message is very specific and it is NOT a broken key. The same key
     * authenticates fine against the swap API; it simply is not registered
     * on the fiat side, because ChangeNOW grant fiat per-partner after a
     * compliance review. Their partner FAQ, verbatim: "Fiat buy and sell
     * functionality is available upon request."
     *
     * Collapsing it into the generic QUOTE_FAILED tells the owner "something
     * went wrong" and sends him hunting through Vercel for a typo that does
     * not exist. Naming it tells him the exact next action — ask their
     * support to enable fiat — which is the only thing that can fix it.
     *
     * Matched on the message text rather than the status code because the
     * upstream returns the same 400 for a genuinely malformed request, and
     * those two need opposite responses from the reader.
     */
    const msg = String(res.body?.message ?? '');
    if (/token not found|api-key/i.test(msg)) {
      return { ok: false, status: 503, body: { error: 'FIAT_KEY_NOT_ENROLLED', detail: msg } };
    }
    return {
      ok: false,
      status: res.status,
      body: { error: 'QUOTE_FAILED', detail: res.body?.message ?? null }
    };
  }

  /*
   * Their field names, read defensively. The documented estimate carries
   * `estimated_exchange_rate`, `converted_amount`, `service_fees` and
   * `network_fee`; some deployments answer with the camelCase
   * `estimate_breakdown` shape used by the transaction endpoint. Reading both
   * costs one `??` and removes a whole failure mode.
   */
  const b = res.body || {};
  const breakdown = b.estimate_breakdown || {};

  const out = num(b.to_amount) ?? num(b.toAmount) ?? num(breakdown.toAmount);
  const rate = num(b.estimated_exchange_rate) ?? num(breakdown.estimatedExchangeRate);

  /*
   * The service fees, ITEMISED AND VERBATIM.
   *
   * This is where our commission actually lives. ChangeNOW apply the partner
   * rate attached to the API key and report it here; we do not add a
   * percentage of our own on top, and the previous version's invented
   * "ourFeePercent: 1" was a label with no mechanism behind it.
   *
   * Passing their own breakdown through means the number on our screen is the
   * number the user is charged. A fee that turns out to be different from the
   * one displayed is the kind that makes someone distrust every other figure
   * in the app.
   */
  const rawFees = Array.isArray(b.service_fees)
    ? b.service_fees
    : Array.isArray(breakdown.serviceFees)
      ? breakdown.serviceFees
      : [];

  const fees = rawFees
    .map((x) => ({
      name: typeof x?.name === 'string' ? x.name : null,
      amount: num(x?.amount),
      currency: typeof x?.currency === 'string' ? x.currency : null
    }))
    .filter((x) => x.amount != null);

  const networkFeeSrc = b.network_fee || breakdown.networkFee || null;

  return {
    ok: true,
    status: 200,
    body: {
      direction,
      from: f,
      to: t,
      amount: amt,
      estimatedAmount: out,
      rate,
      serviceFees: fees,
      networkFee: networkFeeSrc
        ? { amount: num(networkFeeSrc.amount), currency: networkFeeSrc.currency ?? null }
        : null
    }
  };
}

/**
 * POST /api/fiat/order — actually start the purchase.
 *
 * ─── WHY THIS ROUTE HAD TO EXIST FOR ANY OF THIS TO EARN ────────────────────
 * A quote is attributed to nobody. Commission is paid on completed
 * TRANSACTIONS, and a transaction only exists once something POSTs
 * `/v2/fiat-transaction` with our API key. The previous version had no such
 * call anywhere: it could quote (in principle) and could never earn a cent.
 * That is the same "wired to nothing" shape as the bridge and the gasless
 * integration before it.
 *
 * ─── WE STILL NEVER TOUCH THE MONEY ─────────────────────────────────────────
 * The response carries `redirect_url` — a hosted checkout at the licensed
 * payment institution. The user pays there, on their domain, under their
 * licence. We never see a card number, never hold a balance, and the crypto
 * is delivered straight to the address the user gave us. The non-custodial
 * property is unchanged; we are an introducer, and that is precisely why we
 * are allowed to be paid for it.
 *
 * A missing `redirect_url` is treated as failure rather than success-with-no-
 * link. A created order the user cannot reach is money they think they have
 * committed and have not.
 */
export async function fiatOrder({ from, to, amount, address, extraId, email }) {
  const f = String(from || '').trim().toLowerCase();
  const t = String(to || '').trim().toLowerCase();

  const leg = assertFiatLeg(f, t);
  if (!leg) return { ok: false, status: 400, body: { error: 'NOT_A_FIAT_PAIR' } };

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, status: 400, body: { error: 'BAD_AMOUNT' } };
  }

  /*
   * The payout address is checked for PRESENCE and shape here and nothing
   * more. We deliberately do not "clean" it — trimming whitespace is safe,
   * but any transformation beyond that risks silently mutating a destination
   * address, and a payout to a mutated address is unrecoverable.
   */
  const addr = String(address || '').trim();
  if (addr.length < 16 || addr.length > 128 || /\s/.test(addr)) {
    return { ok: false, status: 400, body: { error: 'BAD_ADDRESS' } };
  }

  if (!fiatEnabled()) {
    return { ok: false, status: 503, body: { error: 'FIAT_NOT_ENABLED' } };
  }

  const { direction, money, asset } = leg;

  const payload = {
    from_amount: amt,
    from_currency: direction === 'buy' ? money.code.toUpperCase() : asset.ticker,
    from_network: direction === 'buy' ? null : asset.network,
    to_currency: direction === 'buy' ? asset.ticker : money.code.toUpperCase(),
    to_network: direction === 'buy' ? asset.network : null,
    payout_address: addr,
    payout_extra_id: extraId ? String(extraId).trim().slice(0, 64) : '',
    deposit_type: direction === 'buy' ? money.deposit : 'CRYPTO_THROUGH_CN',
    payout_type: direction === 'buy' ? 'CRYPTO_THROUGH_CN' : money.deposit
  };

  /*
   * Optional and only when the user typed one. The upstream uses it to email
   * them if the order stalls, which on a fiat purchase is genuinely useful —
   * but it is personal data, so it is never invented, defaulted or inferred.
   */
  const mail = String(email || '').trim();
  if (mail && mail.includes('@') && mail.length <= 120) {
    payload.customer = { contact_info: { email: mail } };
  }

  const res = await cnFetch('/fiat-transaction', { method: 'POST', body: payload });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      body: { error: 'ORDER_FAILED', detail: res.body?.message ?? null }
    };
  }

  const redirect = res.body?.redirect_url;
  if (typeof redirect !== 'string' || !redirect.startsWith('https://')) {
    /*
     * Created upstream but unreachable for the user. Reported as a failure,
     * not as a half-success, because a screen that says "order placed" with
     * nowhere to pay is worse than one that says it could not start.
     */
    return { ok: false, status: 502, body: { error: 'NO_CHECKOUT_URL' } };
  }

  return {
    ok: true,
    status: 200,
    body: {
      id: res.body?.id ?? null,
      status: res.body?.status ?? null,
      redirectUrl: redirect,
      expectedFromAmount: num(res.body?.expected_from_amount),
      expectedToAmount: num(res.body?.expected_to_amount)
    }
  };
}

/** GET /api/fiat/status — what this integration can actually do today. */
export function fiatStatus() {
  return {
    keySet: fiatConfigured(),
    /*
     * The honest signal. A key alone does not make fiat work: ChangeNOW
     * enable it per-partner after a compliance review, so this stays false
     * until the owner confirms they have switched it on.
     */
    enabled: fiatEnabled(),
    /* Stated so the UI can never imply we route crypto-to-crypto here. */
    fiatOnly: true,
    currencies: FIAT_CURRENCIES.length,
    assets: FIAT_CRYPTO.length,
    /*
     * Deliberately absent: any "ourFeePercent". Our commission is a property
     * of the partner account and arrives inside ChangeNOW's own
     * `service_fees`. Reporting a separate number here is what produced a
     * displayed fee that nothing charged.
     */
    feeModel: 'partner-rate'
  };
}
