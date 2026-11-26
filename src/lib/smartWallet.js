/**
 * SMART WALLET POLICIES — local, non-custodial, actually enforced.
 * ---------------------------------------------------------------------------
 * Account abstraction (ERC-4337) needs a bundler we do not run and a smart
 * contract the user does not have. Shipping a "Smart Wallet" badge that
 * signed ordinary EOA transactions would be the same dead-toggle this repo
 * keeps finding.
 *
 * What we CAN honestly deliver on an EOA, today:
 *
 *   · daily spending limits, checked before a swap or send is signed
 *   · per-transaction ceilings
 *   · an allow-list of destinations
 *   · session keys: a time window during which those limits are looser
 *   · social recovery CONTACTS (guardians) stored locally — we cannot move
 *     funds for them; they are people the user named to help restore a seed
 *   · gas sponsorship: the existing 0x gasless path, not a second one
 *
 * Every check fails CLOSED. A corrupt store, a missing clock, or a NaN
 * amount is a refusal, not a pass. The user can always raise the limit —
 * they cannot accidentally turn the policy off by breaking it.
 */

import { btcAddressInfo } from './btcAddress.js';

const STORAGE_KEY = 'fbt-smart-wallet-v1';
const SPEND_KEY = 'fbt-smart-wallet-spend-v1';

export const DEFAULT_POLICY = {
  /* ON by default (owner directive: no feature ships disabled). The spend
     bounds below are what make permissioned autonomy safe — enabled:true is
     what makes them ENFORCED (a disabled policy bypasses the caps entirely). */
  enabled: true,
  dailyLimitUsd: 1000,
  perTxLimitUsd: 500,
  allowlist: [],
  guardians: [],
  session: null,
  requireConfirmAboveUsd: 100,
  recoveryThreshold: 2,
  updatedAt: 0
};

const isAddr = (s) => /^0x[a-fA-F0-9]{40}$/.test(String(s || '').trim());
const isSolanaAddr = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || '').trim());
/* BTC validation costs a pure checksum computation (no network, no key). The
   allowlist is a place where a typo must fail closed, so a regex would not do. */
function isBtcAddr(s) {
  const value = String(s || '').trim();
  if (!/^(bc1[02-9ac-hj-np-z]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(value)) return false;
  try { return btcAddressInfo(value).valid === true; } catch { return false; }
}

/**
 * Destinations are now chain-aware: the same allowlist can hold an EVM
 * address, a Solana public key or a mainnet BTC address, and a send on any of
 * those chains is matched against the exact string the user approved.
 */
export function destinationKind(value) {
  const s = String(value || '').trim();
  if (isAddr(s)) return 'evm';
  if (isSolanaAddr(s)) return 'solana';
  if (isBtcAddr(s)) return 'bitcoin';
  return null;
}

export function validateDestination(value) {
  const kind = destinationKind(value);
  return kind ? { ok: true, kind, value: String(value).trim() } : { ok: false, code: 'BAD_ADDRESS' };
}

const todayUtc = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadPolicy() {
  const raw = readJson(STORAGE_KEY, null);
  if (!raw) return { ...DEFAULT_POLICY };
  return {
    ...DEFAULT_POLICY,
    ...raw,
    allowlist: Array.isArray(raw.allowlist) ? raw.allowlist.filter((a) => destinationKind(a)) : [],
    guardians: Array.isArray(raw.guardians) ? raw.guardians.filter(isAddr).slice(0, 5) : [],
    dailyLimitUsd: clampUsd(raw.dailyLimitUsd, DEFAULT_POLICY.dailyLimitUsd),
    perTxLimitUsd: clampUsd(raw.perTxLimitUsd, DEFAULT_POLICY.perTxLimitUsd),
    requireConfirmAboveUsd: clampUsd(raw.requireConfirmAboveUsd, DEFAULT_POLICY.requireConfirmAboveUsd),
    recoveryThreshold: Math.max(1, Math.min(5, Math.trunc(Number(raw.recoveryThreshold)) || 2))
  };
}

export function savePolicy(patch) {
  const next = { ...loadPolicy(), ...patch, updatedAt: Date.now() };
  next.allowlist = (next.allowlist || []).filter((a) => destinationKind(a)).slice(0, 20);
  next.guardians = (next.guardians || []).filter(isAddr).slice(0, 5);
  next.dailyLimitUsd = clampUsd(next.dailyLimitUsd, DEFAULT_POLICY.dailyLimitUsd);
  next.perTxLimitUsd = clampUsd(next.perTxLimitUsd, DEFAULT_POLICY.perTxLimitUsd);
  writeJson(STORAGE_KEY, next);
  return next;
}

function clampUsd(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(1_000_000, n);
}

export function loadSpend(now = Date.now()) {
  const rec = readJson(SPEND_KEY, { day: todayUtc(now), usd: 0 });
  if (rec.day !== todayUtc(now)) return { day: todayUtc(now), usd: 0 };
  const usd = Number(rec.usd);
  return { day: rec.day, usd: Number.isFinite(usd) && usd >= 0 ? usd : 0 };
}

export function recordSpend(usd, now = Date.now()) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return loadSpend(now);
  const cur = loadSpend(now);
  const next = { day: cur.day, usd: cur.usd + n };
  writeJson(SPEND_KEY, next);
  return next;
}

/**
 * Open a session window. During it, the daily cap is raised by `bonusUsd`
 * and the per-tx cap is the session's own ceiling. Expires automatically.
 */
function newSessionKey(now = Date.now()) {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 12)
    || Math.random().toString(36).slice(2, 14);
  return `sess_${now.toString(36)}_${random}`;
}

/**
 * Open a session AND mint its one-time key. The key is returned to the caller
 * so the Smart Wallet can show it; the policy stores only the key, never a
 * seed or a signing secret. An Intent OS action that wants the session's
 * raised limits must present this exact key.
 */
export function startSession({ minutes = 30, bonusUsd = 0, perTxUsd = null } = {}, now = Date.now()) {
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins < 1 || mins > 24 * 60) return { error: 'BAD_SESSION' };
  const session = {
    startedAt: now,
    expiresAt: now + mins * 60_000,
    bonusUsd: clampUsd(bonusUsd, 0),
    perTxUsd: perTxUsd == null ? null : clampUsd(perTxUsd, 0),
    key: newSessionKey(now),
    requireKey: true
  };
  return { policy: savePolicy({ session }), key: session.key };
}

/**
 * «کلید نشست» — verify a key against the LIVE session, never against a record
 * the user has already ended or that has expired on its own.
 */
export function verifySessionKey(key, now = Date.now(), policy = null) {
  const session = activeSession(policy || loadPolicy(), now);
  if (!session) return { ok: false, code: 'NO_SESSION' };
  if (!session.key) return { ok: false, code: 'SESSION_KEY_REQUIRED' };
  const presented = String(key ?? '').trim();
  if (!presented || presented !== session.key) return { ok: false, code: 'BAD_SESSION_KEY' };
  return { ok: true, session };
}

/**
 * «مخاطبان بازیابی اجتماعی» — a recovery request is not a send. It names the
 * recipients who will receive the share, and every one of them must already be
 * a guardian. A request with a stranger in it is refused in full, not
 * partially executed: this is the one list an attacker most wants widened.
 */
export function requestSocialRecovery({ recipients = [], approvals = 0, now = Date.now() } = {}) {
  const policy = loadPolicy();
  const named = Array.isArray(recipients) ? recipients.map((r) => String(r || '').trim()) : [];
  const threshold = Number(policy.recoveryThreshold ?? 2);
  if (!named.length) return { ok: false, code: 'NO_RECIPIENTS' };
  if (named.length > policy.guardians.length) return { ok: false, code: 'NOT_A_GUARDIAN' };
  const known = new Set(policy.guardians.map((g) => g.toLowerCase()));
  const stranger = named.find((r) => !known.has(r.toLowerCase()));
  if (stranger) return { ok: false, code: 'NOT_A_GUARDIAN', address: stranger };
  const approvalCount = Number(approvals);
  return {
    ok: true,
    recipients: named,
    threshold: Number.isFinite(threshold) && threshold > 0 ? threshold : 2,
    approvalsRequired: Math.max(1, Math.min(named.length, Number.isFinite(approvalCount) && approvalCount > 0 ? approvalCount : 2)),
    at: now,
    note: 'Contacts only. This app cannot move a recovered seed or sign on their behalf.'
  };
}

export function endSession() {
  return savePolicy({ session: null });
}

export function activeSession(policy, now = Date.now()) {
  const s = policy?.session;
  if (!s || !Number.isFinite(s.expiresAt)) return null;
  if (now >= s.expiresAt) return null;
  return s;
}

/**
 * Decide whether a spend is allowed.
 *
 * @returns {{ ok: boolean, code?: string, remainingUsd?: number, needsConfirm?: boolean }}
 */
export function checkPolicy({ usd, to = null, now = Date.now(), origin = 'user', sessionKey = null, recovery = null } = {}) {
  const policy = loadPolicy();
  if (!policy.enabled) return { ok: true, remainingUsd: null, needsConfirm: false };

  const amount = Number(usd);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, code: 'BAD_AMOUNT' };

  /* A social-recovery request is checked against the GUARDIANS, not the
     destination allowlist: the two lists answer different questions. */
  if (recovery) {
    const request = requestSocialRecovery({ ...recovery, now });
    if (!request.ok) return { ok: false, code: request.code };
    return { ok: true, recovery: request, remainingUsd: null, needsConfirm: true };
  }

  if (to && policy.allowlist.length) {
    if (!destinationKind(to) || !policy.allowlist.some((a) => a.toLowerCase() === String(to).trim().toLowerCase())) {
      return { ok: false, code: 'NOT_ALLOWLISTED' };
    }
  }

  const session = activeSession(policy, now);
  /* «کلید نشست» is enforced for AGENT-originated actions. A user clicking Send
     in their own wallet is already the authentication; an intent the OS is
     about to execute is not. Without the key it gets the ordinary caps, not
     the session's raised ones — and no silent escalation. */
  const keyOk = session && verifySessionKey(sessionKey, now, policy).ok;
  const sessionApplies = Boolean(session) && (session.requireKey !== true || keyOk || origin !== 'intent');
  if (session && session.requireKey === true && origin === 'intent' && !keyOk) {
    return { ok: false, code: sessionKey ? 'BAD_SESSION_KEY' : 'SESSION_KEY_REQUIRED' };
  }

  const perTx = sessionApplies && session.perTxUsd != null ? session.perTxUsd : policy.perTxLimitUsd;
  if (amount > perTx) return { ok: false, code: 'OVER_TX_LIMIT', remainingUsd: perTx };

  const spent = loadSpend(now);
  const daily = policy.dailyLimitUsd + (sessionApplies ? (session.bonusUsd ?? 0) : 0);
  const remaining = Math.max(0, daily - spent.usd);
  if (amount > remaining) return { ok: false, code: 'OVER_DAILY_LIMIT', remainingUsd: remaining };

  const needsConfirm = amount >= policy.requireConfirmAboveUsd;
  return { ok: true, remainingUsd: remaining - amount, needsConfirm, sessionKeyUsed: Boolean(sessionApplies && session) };
}

export function addGuardian(address) {
  if (!isAddr(address)) return { error: 'BAD_ADDRESS' };
  const policy = loadPolicy();
  const next = address.trim();
  if (policy.guardians.some((g) => g.toLowerCase() === next.toLowerCase())) {
    return { error: 'DUPLICATE' };
  }
  if (policy.guardians.length >= 5) return { error: 'TOO_MANY' };
  return { policy: savePolicy({ guardians: [...policy.guardians, next] }) };
}

export function removeGuardian(address) {
  const policy = loadPolicy();
  return {
    policy: savePolicy({
      guardians: policy.guardians.filter((g) => g.toLowerCase() !== String(address).toLowerCase())
    })
  };
}

export function addAllowlist(address) {
  const checked = validateDestination(address);
  if (!checked.ok) return { error: 'BAD_ADDRESS' };
  const policy = loadPolicy();
  const next = checked.value;
  if (policy.allowlist.some((g) => g.toLowerCase() === next.toLowerCase())) {
    return { error: 'DUPLICATE' };
  }
  return { policy: savePolicy({ allowlist: [...policy.allowlist, next] }) };
}

export function removeAllowlist(address) {
  const policy = loadPolicy();
  return {
    policy: savePolicy({
      allowlist: policy.allowlist.filter((g) => g.toLowerCase() !== String(address).toLowerCase())
    })
  };
}
