/**
 * CROSS-CHAIN BRIDGE — the /api/bridge/* compatibility surface.
 * ---------------------------------------------------------------------------
 * ─── WHAT CHANGED, AND WHY THIS FILE IS NOW THIN ────────────────────────────
 * This file used to BE the LI.FI client: its own fetch, its own timeout, its
 * own key handling, its own fee retry. Meanwhile Intent OS answered
 * /api/intents/v1/bridge-quote from a hard-coded object. Two cross-chain
 * systems, one of them fictional.
 *
 * The client now lives in server/lifi.js and the engine (normalisation,
 * ranking, status, persistence) in server/crossChain.js, so the bridge page,
 * the Intent OS cross-chain desk and the AI all reach ONE implementation. What
 * remains here is the public /api/bridge/* contract — documented in
 * src/pages/Developers.jsx and consumed by src/lib/bridge.js — which keeps
 * returning LI.FI's response unchanged for callers that already parse it.
 *
 * New code should use /api/cross-chain/* (normalised, expiring, ranked).
 *
 * ─── WHY THE FEE PARAMETERS ARE STILL NOT CALLER-SETTABLE ───────────────────
 * `integrator` and `fee` decide where our revenue goes. Accepting them from a
 * query string would let anyone redirect our commission to their own wallet.
 * The allow-list below is a security boundary, not tidiness.
 */

import {
  bridgeFee,
  bridgeFeeReady,
  integratorId,
  integratorStatus,
  lifiFetch
} from './lifi.js';
import { isWalletSupportedChain } from './crossChain.js';

export { integratorId, bridgeFee, bridgeFeeReady };

/*
 * Parameters we forward. Everything else is dropped — see the header.
 */
const ALLOWED = [
  'fromChain',
  'toChain',
  'fromToken',
  'toToken',
  'fromAddress',
  'toAddress',
  'fromAmount',
  'slippage'
];

/**
 * GET /api/bridge/quote
 *
 * Returns LI.FI's quote unchanged. Deliberately not reshaped: existing callers
 * read the documented fields, and a translation layer here would be one more
 * place for the two to drift apart. The reshaped, expiring, ranked version is
 * /api/cross-chain/quote.
 */
export async function bridgeQuote(query) {
  const params = new URLSearchParams();

  for (const key of ALLOWED) {
    const v = query?.[key];
    if (v == null || v === '') continue;
    params.set(key, String(v).slice(0, 120));
  }

  const fromChain = params.get('fromChain');
  const toChain = params.get('toChain');
  /*
   * The supported set is no longer a private constant here: it is the one
   * list of chains the WALLET can actually sign for, shared with the
   * cross-chain engine. A chain offered on one surface and refused on the
   * other is exactly the drift this refactor removes.
   */
  if (!isWalletSupportedChain(fromChain) || !isWalletSupportedChain(toChain)) {
    return { ok: false, status: 400, body: { error: 'UNSUPPORTED_CHAIN' } };
  }
  if (String(fromChain) === String(toChain)) {
    /* Same-chain belongs on the swap screen, which quotes two aggregators and
       charges our full 0.7%. Routing it through a bridge would be a worse
       price AND a smaller fee. */
    return { ok: false, status: 400, body: { error: 'SAME_CHAIN' } };
  }

  const amount = params.get('fromAmount');
  if (!/^\d+$/.test(amount || '') || amount === '0') {
    return { ok: false, status: 400, body: { error: 'BAD_AMOUNT' } };
  }
  const from = params.get('fromAddress');
  if (!from || !/^0x[a-fA-F0-9]{40}$/.test(from)) {
    return { ok: false, status: 400, body: { error: 'BAD_ADDRESS' } };
  }

  params.set('integrator', integratorId());

  /*
   * Ask for the fee, then fall back without it. LI.FI rejects the WHOLE
   * request with error 1011 when the integrator is not configured for fees,
   * and blaming the user for our portal setup is not an option.
   */
  const fee = bridgeFee();
  if (fee > 0) {
    const withFee = new URLSearchParams(params);
    withFee.set('fee', String(fee));
    const attempt = await lifiFetch(`/quote?${withFee}`);
    if (attempt.ok) return attempt;
    if (attempt.body?.code !== 1011) return attempt;
  }

  return lifiFetch(`/quote?${params}`);
}

/**
 * Is fee collection live?
 *
 * Asks LI.FI directly rather than trusting an env var: the env var records
 * what we INTENDED and the API records what is true.
 */
export async function bridgeStatus() {
  const status = await integratorStatus();
  return {
    integrator: status.integrator,
    keySet: status.keySet,
    feeReady: bridgeFeeReady(),
    feePercent: status.feePercent,
    registered: status.registered,
    detail: status.detail
  };
}
