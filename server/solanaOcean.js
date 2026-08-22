/**
 * SOLANA SWAP VIA OPENOCEAN — the fee-earning path that costs us nothing
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS ALONGSIDE server/solana.js ─────────────────────────────
 * Jupiter earns us nothing today and CANNOT be made to without spending money.
 * Its fee mechanism needs a `referralAccount` plus a `referralTokenAccount`
 * per fee mint, all created by on-chain transactions. The Solana payout wallet
 * holds 0 SOL (checked live), so those transactions cannot be sent at all.
 *
 * Worse, Jupiter's own documentation describes the failure as silent:
 *
 *   "If the referralTokenAccount for the feeMint is not initialised, the order
 *    still returns but executes WITHOUT your fees (the user still gets their
 *    swap)"
 *
 * So the Jupiter path is not "nearly earning". It is structurally earning zero
 * and looks identical to a working integration from the outside.
 *
 * OpenOcean takes a plain wallet address as `referrer` and splits the fee
 * inside the swap transaction itself. No account creation, no rent.
 * OpenOcean v4 Solana is open and fee-earning keylessly (verified on-chain).
 *
 * ─── THE FEE IS VERIFIED, NOT ASSUMED ───────────────────────────────────────
 * A field echoed back in JSON proves nothing — the KyberSwap fee bug in this
 * repo's history was exactly that. So the transaction was decoded.
 *
 * A live SOL->USDC call for 1 SOL, with `account` set to a DIFFERENT wallet
 * than `referrer` (so a match cannot be the taker's own address), produced two
 * lamport transfers in the instruction data:
 *
 *     0073550000000000  ->  5,600,000 lamports   to our payout wallet
 *     c05c150000000000  ->  1,400,000 lamports   to OpenOcean
 *                           ─────────
 *                           7,000,000 lamports = 0.70000% of 1 SOL exactly
 *
 * 5.6M / 7.0M = 80%. That matches their documented "OpenOcean shares 20% of
 * the fee" precisely, and it matches Jupiter's own 20% cut — so we lose
 * nothing by taking this route instead.
 *
 * Our payout wallet base58-decodes to
 * 9609fac2821a67ab58b4717e7d68d79652cc3bd51bd3d595fd485966dd173541, which is
 * present in the transaction's account table. The fee is real.
 *
 * ─── WHY THE PROXY, GIVEN THERE IS NO KEY TO HIDE ───────────────────────────
 * Not for secrecy. For CONTROL OF THE FEE FIELDS.
 *
 * If the browser called OpenOcean directly, `referrer` and `referrerFee` would
 * be attacker-editable: anyone could point our revenue at their own wallet, or
 * set the fee to 5% and make our app look predatory. Sending them from the
 * server means the only values that can ever reach OpenOcean are ours. That is
 * the same reason server/solana.js uses an allow-list, and it is a security
 * boundary rather than a tidiness preference.
 *
 * ─── WHAT THIS MODULE DOES NOT DO ───────────────────────────────────────────
 * It does not broadcast. It returns an unsigned transaction; the user's wallet
 * signs and the client sends it to an RPC. We never hold a Solana key, and
 * nothing here can move funds on its own.
 */

const OO_BASE = 'https://open-api.openocean.finance/v4/solana';
const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);

/*
 * ─── OPENOCEAN SOLANA IS KEYLESS & FEE-EARNING OUT OF THE BOX ───────────────
 * OpenOcean v4 Solana accepts `referrer` and `referrerFee` keylessly,
 * splitting 80% (56 bps net) to our Solana payout wallet inside the swap
 * transaction itself (verified on-chain with 1 SOL -> USDC).
 *
 * No whitelist form, no API key, and no 0.02 SOL referral account rent
 * required.
 *
 * An optional API key (OPENOCEAN_API_KEY) is attached server-side if present
 * in environment variables. If OpenOcean is unreachable or rate-limited, the
 * client falls back to Jupiter as insurance.
 */
const apiKey = () => String(process.env.OPENOCEAN_API_KEY || '').trim();

/** Wrapped SOL. OpenOcean uses the same mint Jupiter does. */
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Where our cut lands.
 *
 * Falls back to the published FBT Solana wallet, matching src/lib/payout.js.
 * A wrong address here does not fail loudly — it pays a stranger — so it is
 * validated as base58 before ever being sent, and an invalid value disables
 * the fee entirely rather than being passed through.
 */
export function feeReceiver() {
  const addr =
    process.env.SOLANA_FEE_RECIPIENT ||
    process.env.VITE_PAYOUT_SOLANA ||
    'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4';
  return BASE58.test(addr) ? addr : '';
}

/**
 * Our fee in basis points.
 *
 * Matches the 70 bps charged on EVM so a user never meets two house rates for
 * what looks to them like the same action.
 *
 * Clamped to 0-100. OpenOcean accepts up to 5% and expresses the value as a
 * PERCENT, so a bps-shaped typo is genuinely dangerous: passing `70` where a
 * percent is expected would request 70% of somebody's swap. The conversion
 * happens in exactly one place, below, and the clamp is applied before it.
 */
export function feeBps() {
  const raw = Number(process.env.SOLANA_FEE_BPS ?? process.env.FEE_BPS ?? 70);
  if (!Number.isFinite(raw)) return 70;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/**
 * bps -> percent for OpenOcean's `referrerFee`. 70 -> 0.7
 *
 * Their documented range is 0.01 to 5. Below 0.01 the parameter is meaningless
 * and we simply omit the fee rather than send a value they may reject or
 * silently floor.
 */
export const bpsToPercent = (bps) => Number(bps) / 100;

async function ooFetch(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const headers = { accept: 'application/json' };
    /*
     * Solana requires the whitelist key (see the note at the top). EVM never
     * does — attaching it there would be harmless but would make the header
     * look load-bearing where it is not, so it goes on only when present.
     * OpenOcean's documented header is x-api-key, the same one Jupiter uses.
     */
    const key = apiKey();
    if (key) headers['x-api-key'] = key;
    const res = await fetch(`${OO_BASE}${path}`, {
      signal: ctrl.signal,
      headers
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: text.slice(0, 300) };
    }
    /*
     * OpenOcean answers HTTP 200 with its own `code` field, so res.ok alone is
     * not success. A `code` of 200 with `data.code` of 0 is the good case.
     */
    if (!res.ok || !body || body.code !== 200) {
      const detail = body?.error || body?.message || null;
      const isBadAmount =
        res.status === 400 ||
        body?.code === 400 ||
        /amount|too small|lamport|minimum|below/i.test(String(detail || ''));
      return {
        ok: false,
        status: isBadAmount ? 400 : (res.ok ? 502 : res.status),
        body: { error: isBadAmount ? 'BAD_AMOUNT' : 'UPSTREAM_FAILED', detail }
      };
    }
    return { ok: true, status: 200, body: body.data };
  } catch (err) {
    // AbortError included: a timeout is an upstream failure, not a 500 of ours.
    return { ok: false, status: 504, body: { error: 'UPSTREAM_FAILED', detail: String(err?.name || err) } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Validate the parts of a request that come from the browser.
 *
 * Returns an error body, or null when everything is acceptable. Split out so
 * quote and swap cannot drift apart on what they consider valid — a swap that
 * accepts input the quote rejected is how a user ends up signing something
 * they were never shown.
 */
function validate({ inputMint, outputMint, amount }) {
  if (!BASE58.test(inputMint || '') || !BASE58.test(outputMint || '')) {
    return { error: 'BAD_MINT' };
  }
  if (inputMint === outputMint) return { error: 'SAME_TOKEN' };
  // Integer base units only. A decimal point produces an opaque upstream
  // error, so it is caught here where the message can be useful.
  if (!/^\d+$/.test(String(amount || '')) || String(amount) === '0') {
    return { error: 'BAD_AMOUNT' };
  }
  return null;
}

/**
 * Slippage as a percent, matching OpenOcean's documented 0.05-50 range.
 *
 * Note this is a PERCENT, not bps — the client speaks bps everywhere else, so
 * the conversion is done here rather than asking every caller to remember.
 */
function slippagePercent(bps) {
  const n = Number(bps);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(50, Math.max(0.05, n / 100));
}

/**
 * True when a swap through here will actually pay us. Reported by /status.
 *
 * OpenOcean accepts our `referrer` and `referrerFee` keylessly on Solana,
 * splitting 80% of the 70 bps fee directly to our fee wallet inside the
 * transaction. An API key is optional and attached if configured.
 */
export const feeReady = () => Boolean(feeReceiver()) && feeBps() > 0;

/** True when the optional whitelist key is present. */
export const keyConfigured = () => Boolean(apiKey());

/**
 * Attach the fee. The single place `referrer` and `referrerFee` are ever set.
 *
 * Both are omitted together when unconfigured. Sending a `referrer` with no
 * fee would still work but would make logs read as configured while earning
 * nothing — the exact ambiguity the Jupiter path suffers from.
 */
function attachFee(params) {
  const receiver = feeReceiver();
  const bps = feeBps();
  if (!receiver || bps <= 0) return;
  params.set('referrer', receiver);
  params.set('referrerFee', String(bpsToPercent(bps)));
}

/**
 * GET /api/solana/oo/quote — price only, no wallet needed.
 *
 * `account` is deliberately NOT forwarded here. Without it OpenOcean returns a
 * quote and no transaction, which is exactly what a price display should ask
 * for: there is nothing signable in the response to be misused.
 */
export async function oceanQuote(query) {
  const inputMint = String(query?.inputMint || '');
  const outputMint = String(query?.outputMint || '');
  const amount = String(query?.amount || '');

  const bad = validate({ inputMint, outputMint, amount });
  if (bad) return { ok: false, status: 400, body: bad };

  const params = new URLSearchParams({
    inTokenAddress: inputMint,
    outTokenAddress: outputMint,
    amountDecimals: amount,
    // Solana has no gwei. This is a lamport-denominated hint used only for
    // OpenOcean's own route weighting; the wallet sets the real priority fee.
    gasPriceDecimals: '5000',
    slippage: String(slippagePercent(query?.slippageBps))
  });
  attachFee(params);

  const r = await ooFetch(`/quote?${params}`);
  if (!r.ok) return r;

  return {
    ok: true,
    status: 200,
    body: {
      inAmount: r.body?.inAmount ?? null,
      outAmount: r.body?.outAmount ?? null,
      minOutAmount: r.body?.minOutAmount ?? null,
      priceImpact: r.body?.price_impact ?? null,
      inUsd: Number(r.body?.inToken?.volume) || null,
      outUsd: Number(r.body?.outToken?.volume) || null,
      feeBps: feeBps(),
      feeReceiver: feeReceiver() || null
    }
  };
}

/**
 * GET /api/solana/oo/swap — an unsigned transaction for the user to sign.
 *
 * ─── THE ECHO CHECK ─────────────────────────────────────────────────────────
 * OpenOcean returns `feeRatio`. We assert it matches what we asked for before
 * handing the transaction to a user.
 *
 * This is not defensive paranoia; it is the lesson from this repo's own
 * history, where a fee was requested, accepted, and quietly not applied. If
 * the upstream ever stops honouring `referrerFee` — a silent pricing change on
 * their side, or a parameter rename — we would otherwise carry on serving
 * swaps that earn nothing and never notice. Here it becomes a visible error.
 *
 * A mismatch does NOT block the user's swap: the transaction is still
 * returned, with `feeApplied: false` alongside it. Refusing to swap because
 * WE are not being paid would be punishing the customer for our problem.
 */
export async function oceanSwap(query) {
  const inputMint = String(query?.inputMint || '');
  const outputMint = String(query?.outputMint || '');
  const amount = String(query?.amount || '');
  const account = String(query?.account || '');

  const bad = validate({ inputMint, outputMint, amount });
  if (bad) return { ok: false, status: 400, body: bad };
  if (!BASE58.test(account)) return { ok: false, status: 400, body: { error: 'BAD_TAKER' } };

  const params = new URLSearchParams({
    inTokenAddress: inputMint,
    outTokenAddress: outputMint,
    amountDecimals: amount,
    gasPriceDecimals: '5000',
    slippage: String(slippagePercent(query?.slippageBps)),
    account
  });
  attachFee(params);

  const r = await ooFetch(`/swap?${params}`);
  if (!r.ok) return r;

  const data = r.body || {};
  if (typeof data.data !== 'string' || !data.data) {
    return { ok: false, status: 502, body: { error: 'NO_TRANSACTION' } };
  }

  /*
   * Compare with a tolerance. `feeRatio` comes back as 0.006999999999999999
   * for 0.7% — an exact === against 0.007 would fail on every single swap,
   * which is precisely the kind of check that gets deleted rather than fixed.
   */
  const asked = feeBps() / 10000;
  const got = Number(data.feeRatio);
  const feeApplied = feeBps() === 0 ? true : Number.isFinite(got) && Math.abs(got - asked) < 1e-6;

  if (!feeApplied) {
    // eslint-disable-next-line no-console
    console.warn(`[solanaOcean] fee not honoured: asked ${asked}, got ${data.feeRatio}`);
  }

  return {
    ok: true,
    status: 200,
    body: {
      transaction: data.data,
      inAmount: data.inAmount ?? null,
      outAmount: data.outAmount ?? null,
      minOutAmount: data.minOutAmount ?? null,
      // `isVersioned` decides which deserialiser the client must use. Getting
      // it wrong throws at signing time, so it is passed through explicitly
      // rather than guessed.
      versioned: data.isVersioned !== false,
      feeBps: feeBps(),
      feeReceiver: feeReceiver() || null,
      feeApplied
    }
  };
}

/**
 * Honest status, for the UI and for anyone debugging a silent zero.
 *
 * OpenOcean works keylessly on Solana while earning our 70 bps fee.
 * `keyConfigured` reports whether an optional OPENOCEAN_API_KEY is present,
 * and `solanaKeyRequired` is false.
 */
export function oceanStatus() {
  return {
    provider: 'openocean',
    keyConfigured: keyConfigured(),
    // Solana key is optional; OpenOcean Solana works keylessly.
    solanaKeyRequired: false,
    feeReady: feeReady(),
    feeBps: feeBps(),
    feeReceiver: feeReceiver() || null,
    // OpenOcean's documented share of our fee.
    providerCutPercent: 20
  };
}
