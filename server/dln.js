/**
 * deBridge DLN — a second bridge, at more than twice the fee LI.FI pays us.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS WAS WORTH ADDING WHEN A BRIDGE ALREADY EXISTS ─────────────────
 * Asked which platforms had been missed. This one had, and it is the largest
 * free upgrade found in the whole audit — not because it does something new,
 * but because it pays us 70 bps for the operation LI.FI pays us 30 bps for.
 *
 * Measured today against our own payout address, 10 USDC Base -> Arbitrum:
 *
 *   {"type":"AffiliateFee","payload":{"feeAmount":"69972","feeBps":"70"}}
 *
 * Asking for 0.3 returns feeBps 30, 0.4 returns 40, 0.5 returns 50. The number
 * is genuinely honoured rather than silently clamped or ignored, which is the
 * failure mode Jupiter has and the reason every fee claim in this repo is now
 * decoded from a real response before it is believed.
 *
 * ⚠️ We ask for 0.4%, NOT the 70 bps above. The 70 bps probe is what proved
 * the mechanism works; `dlnFeePercent()` explains, with measurements, why
 * charging that much would make this route worse for the user than the one we
 * already have.
 *
 * ─── NO KEY, NO SIGNUP, NO COUNTERPARTY ─────────────────────────────────────
 * There is no registration step and no account that a compliance team can
 * close. The affiliate address is a query parameter validated on-chain, the
 * same structural property that makes THORChain's affiliate safe and makes
 * SimpleSwap's and StealthEX's useless to us.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── THE FIXED FEE, WHICH IS THE ONE THING THAT CAN MAKE THIS THE WRONG
 *     CHOICE, AND WHY WE THEREFORE DO NOT AUTO-PICK A WINNER ────────────────
 * ═══════════════════════════════════════════════════════════════════════════
 * DLN charges a FIXED protocol fee in the origin chain's native coin on top of
 * the percentage. On Base that is 0.001 ETH — around $1.90 at today's price.
 *
 * On a $1,000 bridge that is 0.19% and irrelevant. On a $10 bridge it is
 * NINETEEN PERCENT and catastrophic. Measured, same pair, same minute:
 *
 *   $10    in -> 9.68 USDC out, plus 0.001 ETH fixed   ->  ~21% all-in
 *   $1,000 in -> 991.97 USDC out, plus 0.001 ETH fixed ->  ~1.0% all-in
 *
 * This is the same shape as the EVM->Tron activation trap already documented
 * in server/xchain.js: a near-flat cost that is invisible in percentage terms
 * until the amount is small.
 *
 * So this module reports `fixFee` as a first-class field and REFUSES to
 * collapse the two providers into a single "best" number. Converting the fixed
 * fee to USD here would need a native-coin price from a third source, and a
 * stale or missing price would silently pick the worse route — earning us more
 * while costing the user more, which is the one trade this app must never make
 * on the user's behalf without showing it.
 *
 * The client shows both routes with the fixed fee itemised. The user chooses.
 */

const DLN_BASE = 'https://dln.debridge.finance/v1.0';
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 20000);

/**
 * Our cut, as a PERCENT — deBridge wants 0.4 for 0.4%, not 40 and not 0.004.
 *
 * Three different providers in this repo now use three different units for
 * the same idea (LI.FI wants 0.003, 0x wants 70, deBridge wants 0.4), which is
 * exactly how a fee ends up a hundred times too big or too small. The unit is
 * named in the code, checked against a live response, and clamped.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ─── WHY 0.4% AND NOT THE 0.7% THIS WAS FIRST WRITTEN WITH ──────────────────
 * ═══════════════════════════════════════════════════════════════════════════
 * This module was built to charge 0.7%, on the reasoning that deBridge pays
 * more than twice the 0.3% LI.FI pays and the higher number is therefore
 * strictly better. Quoting both providers side by side at the same amount, in
 * the same minute, showed that reasoning was WRONG.
 *
 * $10,000 USDC, Base -> Arbitrum, measured. LI.FI leaves the user 9,945.00
 * after our 0.3% and their own 0.25%. DLN, after subtracting its $1.90 fixed
 * fee, leaves:
 *
 *   DLN @ 0.3%  ->  9,959.73   (+14.73 for the user)   we earn $30
 *   DLN @ 0.4%  ->  9,949.74   ( +4.74 for the user)   we earn $40
 *   DLN @ 0.5%  ->  9,939.74   ( -5.26 for the user)   we earn $50
 *   DLN @ 0.7%  ->  9,919.76   (-25.24 for the user)   we earn $70
 *
 * The break-even is just above 0.4%. At 0.7% we would have been offering a
 * route that pays us more AND costs the user $25 more on a $10k transfer —
 * while the screen presented it as an alternative worth considering. That is
 * precisely the conflict of interest this app is not allowed to resolve in its
 * own favour, and it would have shipped invisibly, because the output amount
 * alone does not reveal it.
 *
 * 0.4% is the largest rate at which the user is still better off than the
 * existing route. It is +33% revenue against LI.FI's 0.3% and the transfer is
 * cheaper for them, so nobody has to be talked into it.
 *
 * ⚠️ THIS NUMBER IS TIED TO A GAS PRICE. The break-even moves with the cost of
 * the origin chain's native coin: if ETH doubles, the fixed fee doubles and
 * 0.4% stops winning. That is why the UI compares the two routes live on every
 * quote instead of trusting this constant — the constant sets what we ASK for,
 * the comparison decides what is actually better today.
 *
 * Clamped to 1% because deBridge accepts far more and a typo that took 7% of
 * somebody's bridge would be unrecoverable and unforgivable.
 */
export function dlnFeePercent() {
  const raw = Number(process.env.DLN_FEE_PERCENT ?? 0.4);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return 0.4;
  return raw;
}

/**
 * Where the fee lands.
 *
 * ⚠️ THE ORIGIN CHAIN DECIDES THE ADDRESS FORMAT. deBridge takes the affiliate
 * fee on the SOURCE chain — visible in the cost breakdown, where the
 * AffiliateFee row carries the source chain's id. So a Solana-origin order
 * needs a Solana address and a Tron-origin order needs a Tron one. Sending our
 * EVM address for a Solana origin is not a rejected request; it is a burn.
 *
 * Today only EVM origins are offered by the bridge screen, so only the EVM
 * address is ever used. The other two are wired now so that enabling a
 * Solana or Tron origin later is a UI change and not a money-losing surprise.
 */
export function dlnFeeRecipient(srcChainId) {
  const id = String(srcChainId);
  if (id === String(SOLANA_CHAIN)) {
    return process.env.DLN_FEE_SOLANA || 'B6gysn5JGQQnJmyzjj6ZJiNECjDYYyJ5LrXvr61BFLv4';
  }
  if (id === String(TRON_CHAIN)) {
    return process.env.DLN_FEE_TRON || 'TJNNUB2zStAvm1wHci5vf9gBGFzbBKjBJZ';
  }
  return process.env.DLN_FEE_EVM
    || process.env.VITE_FEE_RECIPIENT
    || '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';
}

/**
 * deBridge's OWN chain ids, which are not always the real ones.
 *
 * Solana is 7565164 and Tron is 100000026 — internal identifiers, not the
 * networks' actual chain ids (Tron's is 728126428, which deBridge reports
 * separately as `originalChainId`). Read from their live
 * /supported-chains-info rather than guessed, because using the real Tron id
 * here would simply 400 and the reason would not be obvious.
 */
export const SOLANA_CHAIN = 7565164;
export const TRON_CHAIN = 100000026;

/**
 * EVM chains we allow, matching the bridge screen's own list.
 *
 * An allow-list rather than a pass-through: an unsupported id produces an
 * upstream error the user cannot act on, and every id here has been confirmed
 * present in deBridge's supported-chains response.
 */
export const DLN_EVM_CHAINS = new Set([1, 10, 56, 137, 8453, 42161, 43114, 59144]);

export const dlnSupports = (chainId) => DLN_EVM_CHAINS.has(Number(chainId));

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

async function dlnFetch(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${DLN_BASE}${path}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { message: text.slice(0, 300) };
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull our fee out of the cost breakdown.
 *
 * ─── WHY THIS IS READ BACK INSTEAD OF ASSUMED ───────────────────────────────
 * We asked for 0.4%. Whether we GOT 0.4% is a different question, and this
 * repo has shipped three integrations that looked configured and earned
 * nothing. The AffiliateFee row is the provider's own statement of what it
 * will pay us, so it is the only number worth reporting.
 *
 * Returns null when the row is absent, which the status route surfaces as
 * "not earning" rather than quietly showing the requested figure.
 */
export function affiliateFeeFrom(estimation) {
  const rows = Array.isArray(estimation?.costsDetails) ? estimation.costsDetails : [];
  const row = rows.find((r) => r?.type === 'AffiliateFee');
  if (!row) return null;
  const bps = Number(row.payload?.feeBps);
  const amount = row.payload?.feeAmount ?? null;
  if (!Number.isFinite(bps)) return null;
  return { bps, amount };
}

/**
 * Build the parameter set shared by /quote and /create-tx.
 *
 * `affiliateFeePercent` and `affiliateFeeRecipient` are set HERE and are never
 * read from the caller, the same boundary as server/bridge.js. A caller who
 * could set them would redirect our commission by editing a query string.
 */
function baseParams(q) {
  const srcChainId = Number(q?.srcChainId);
  const dstChainId = Number(q?.dstChainId);

  if (!dlnSupports(srcChainId) || !dlnSupports(dstChainId)) {
    return { error: 'UNSUPPORTED_CHAIN' };
  }
  if (srcChainId === dstChainId) return { error: 'SAME_CHAIN' };

  const amount = String(q?.srcChainTokenInAmount ?? '');
  if (!/^\d{1,32}$/.test(amount) || amount === '0') return { error: 'BAD_AMOUNT' };

  const tokenIn = String(q?.srcChainTokenIn ?? '');
  const tokenOut = String(q?.dstChainTokenOut ?? '');
  if (!EVM_ADDRESS.test(tokenIn) || !EVM_ADDRESS.test(tokenOut)) {
    return { error: 'BAD_TOKEN' };
  }

  const params = new URLSearchParams({
    srcChainId: String(srcChainId),
    srcChainTokenIn: tokenIn,
    srcChainTokenInAmount: amount,
    dstChainId: String(dstChainId),
    dstChainTokenOut: tokenOut,
    /*
     * `prependOperatingExpenses=false` keeps the quoted input equal to what the
     * user typed. With it true, deBridge inflates the amount taken from the
     * wallet to cover the destination gas — so someone bridging "10 USDC"
     * would be asked to approve more than 10, which reads as the app taking
     * extra without saying so.
     */
    prependOperatingExpenses: 'false',
    affiliateFeePercent: String(dlnFeePercent()),
    affiliateFeeRecipient: dlnFeeRecipient(srcChainId)
  });

  return { params, srcChainId };
}

/**
 * A price only — no transaction, no addresses required.
 *
 * Used for the side-by-side comparison, so the screen can show what deBridge
 * would give before the user has committed to anything.
 */
export async function dlnQuote(query) {
  const built = baseParams(query);
  if (built.error) return { ok: false, status: 400, body: { error: built.error } };

  const res = await dlnFetch(`/dln/order/quote?${built.params}`);
  if (!res.ok) return res;

  const est = res.body?.estimation;
  return {
    ok: true,
    status: 200,
    body: {
      toAmount: est?.dstChainTokenOut?.amount ?? null,
      toAmountUsd: Number(est?.dstChainTokenOut?.approximateUsdValue) || null,
      fromAmountUsd: Number(est?.srcChainTokenIn?.originApproximateUsdValue) || null,
      /*
       * The fixed fee, in the ORIGIN chain's native coin, in wei. Passed
       * through raw and unconverted — see the header. This is the field that
       * decides whether deBridge is a bargain or a disaster, and it is
       * reported at the top level rather than buried so the UI cannot forget
       * to show it.
       */
      fixFee: res.body?.fixFee ?? null,
      /* Their own statement of what they will pay us. Never our own guess. */
      affiliateFee: affiliateFeeFrom(est),
      /* Seconds. Their estimate of how long fulfilment takes. */
      delaySec: Number(res.body?.order?.approximateFulfillmentDelay) || null,
      allowanceTarget: res.body?.tx?.allowanceTarget ?? null,
      recommendedSlippage: est?.recommendedSlippage ?? null
    }
  };
}

/**
 * The signable order.
 *
 * ─── WHY THE THREE AUTHORITY ADDRESSES ARE ALL THE USER'S ───────────────────
 * DLN is an order book, not a lock-and-mint bridge. `srcChainOrderAuthority`
 * can cancel an unfilled order and reclaim the funds; `dstChainOrderAuthority`
 * controls it on the far side. Both are set to the USER, never to us. If we
 * put our own address there we would be able to cancel and redirect a
 * stranger's bridge, which would make this a custodial product wearing a
 * non-custodial label.
 */
export async function dlnCreateTx(query) {
  const built = baseParams(query);
  if (built.error) return { ok: false, status: 400, body: { error: built.error } };

  const sender = String(query?.senderAddress ?? '');
  if (!EVM_ADDRESS.test(sender)) return { ok: false, status: 400, body: { error: 'BAD_ADDRESS' } };

  /*
   * An explicitly supplied recipient is honoured — bridging to an exchange
   * deposit address is a normal thing to want — but it must be a well-formed
   * address. Anything malformed falls back to the sender rather than being
   * passed upstream, because "funds sent somewhere unparseable" has no remedy.
   */
  const wanted = String(query?.dstChainTokenOutRecipient ?? '');
  const recipient = EVM_ADDRESS.test(wanted) ? wanted : sender;

  const params = built.params;
  params.set('dstChainTokenOutRecipient', recipient);
  params.set('senderAddress', sender);
  params.set('srcChainOrderAuthorityAddress', sender);
  params.set('dstChainOrderAuthorityAddress', recipient);

  const res = await dlnFetch(`/dln/order/create-tx?${params}`);
  if (!res.ok) return res;

  const est = res.body?.estimation;
  return {
    ok: true,
    status: 200,
    body: {
      tx: res.body?.tx ?? null,
      orderId: res.body?.orderId ?? null,
      toAmount: est?.dstChainTokenOut?.amount ?? null,
      toAmountUsd: Number(est?.dstChainTokenOut?.approximateUsdValue) || null,
      fixFee: res.body?.fixFee ?? null,
      affiliateFee: affiliateFeeFrom(est),
      delaySec: Number(res.body?.order?.approximateFulfillmentDelay) || null
    }
  };
}

/**
 * Config sanity, checkable from a phone.
 *
 * Deliberately reports the RECIPIENT as well as the percentage: a fee going to
 * the right size and the wrong address is the failure this app has actually
 * had, twice. The address is public by construction so echoing it leaks
 * nothing.
 */
export function dlnStatus() {
  return {
    provider: 'debridge-dln',
    keyRequired: false,
    feePercent: dlnFeePercent(),
    feeRecipientEvm: dlnFeeRecipient(1),
    chains: [...DLN_EVM_CHAINS],
    note: 'Fixed protocol fee is charged in the origin chain native coin on top of the percentage'
  };
}
