/**
 * FBT REWARDS — browser client for /api/v1/rewards.
 * ---------------------------------------------------------------------------
 * Same discipline as src/lib/financialGoals.js:
 *   1. SCOPE, NOT SECRETS — only `x-fbt-device` is sent (a per-install random
 *      label). No key, no seed, no wallet credential ever travels here.
 *   2. API-FIRST — the dashboard reads everything from these calls; the local
 *      store is only the instant ledger while the network is away.
 *   3. Every failure is a { code } the UI can render, never a crash.
 */
import { apiBase } from '../apiBase.js';
import { deviceScope } from '../financialGoals.js';

const BASE = '/v1/rewards';

async function call(path, { method = 'GET', body = null } = {}) {
  let response = null;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        'x-fbt-device': deviceScope()
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    return { ok: false, code: 'NETWORK_UNREACHABLE', data: null, meta: null };
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, code: `HTTP_${response.status}`, data: null, meta: null };
  }
  if (!response.ok || payload?.ok === false) {
    return { ok: false, code: payload?.error || `HTTP_${response.status}`, data: null, meta: payload?.meta ?? null };
  }
  return { ok: true, code: null, data: payload?.data ?? null, meta: payload?.meta ?? null };
}

export const rewardsSummary = () => call(BASE + '/summary');
export const rewardsMissions = () => call(BASE + '/missions');
export const rewardsLevel = () => call(BASE + '/level');
export const rewardsReferral = () => call(BASE + '/referral');
export const rewardsEligibility = () => call(BASE + '/eligibility');

/** Ingest real activity; the engine credits each event at most once. */
export const reportRewardEvents = (events) => call(BASE + '/events', { method: 'POST', body: { events } });

/** Bind this account's referral code (EVM wallet signature or telegram). */
export const bindRewardCode = ({ code, wallet, signature, message }) =>
  call(BASE + '/referral/bind', {
    method: 'POST',
    body: { code, wallet, signature, message }
  });

export const prepareRewardClaim = (wallet) =>
  call(BASE + '/claim/prepare', { method: 'POST', body: { wallet } });

export const simulateRewardClaim = ({ wallet, nonce }) =>
  call(BASE + '/claim/simulate', { method: 'POST', body: { wallet, nonce } });
