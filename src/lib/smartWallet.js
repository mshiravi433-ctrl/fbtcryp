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

const STORAGE_KEY = 'fbt-smart-wallet-v1';
const SPEND_KEY = 'fbt-smart-wallet-spend-v1';

export const DEFAULT_POLICY = {
  enabled: false,
  dailyLimitUsd: 500,
  perTxLimitUsd: 250,
  allowlist: [],
  guardians: [],
  session: null,
  requireConfirmAboveUsd: 100,
  updatedAt: 0
};

const isAddr = (s) => /^0x[a-fA-F0-9]{40}$/.test(String(s || '').trim());
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
    allowlist: Array.isArray(raw.allowlist) ? raw.allowlist.filter(isAddr) : [],
    guardians: Array.isArray(raw.guardians) ? raw.guardians.filter(isAddr).slice(0, 5) : [],
    dailyLimitUsd: clampUsd(raw.dailyLimitUsd, DEFAULT_POLICY.dailyLimitUsd),
    perTxLimitUsd: clampUsd(raw.perTxLimitUsd, DEFAULT_POLICY.perTxLimitUsd),
    requireConfirmAboveUsd: clampUsd(raw.requireConfirmAboveUsd, DEFAULT_POLICY.requireConfirmAboveUsd)
  };
}

export function savePolicy(patch) {
  const next = { ...loadPolicy(), ...patch, updatedAt: Date.now() };
  next.allowlist = (next.allowlist || []).filter(isAddr).slice(0, 20);
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
export function startSession({ minutes = 30, bonusUsd = 0, perTxUsd = null } = {}, now = Date.now()) {
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins < 1 || mins > 24 * 60) return { error: 'BAD_SESSION' };
  const session = {
    startedAt: now,
    expiresAt: now + mins * 60_000,
    bonusUsd: clampUsd(bonusUsd, 0),
    perTxUsd: perTxUsd == null ? null : clampUsd(perTxUsd, 0)
  };
  return { policy: savePolicy({ session }) };
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
export function checkPolicy({ usd, to = null, now = Date.now() } = {}) {
  const policy = loadPolicy();
  if (!policy.enabled) return { ok: true, remainingUsd: null, needsConfirm: false };

  const amount = Number(usd);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, code: 'BAD_AMOUNT' };

  if (to && policy.allowlist.length) {
    if (!isAddr(to) || !policy.allowlist.some((a) => a.toLowerCase() === to.toLowerCase())) {
      return { ok: false, code: 'NOT_ALLOWLISTED' };
    }
  }

  const session = activeSession(policy, now);
  const perTx = session?.perTxUsd != null ? session.perTxUsd : policy.perTxLimitUsd;
  if (amount > perTx) return { ok: false, code: 'OVER_TX_LIMIT', remainingUsd: perTx };

  const spent = loadSpend(now);
  const daily = policy.dailyLimitUsd + (session?.bonusUsd ?? 0);
  const remaining = Math.max(0, daily - spent.usd);
  if (amount > remaining) return { ok: false, code: 'OVER_DAILY_LIMIT', remainingUsd: remaining };

  const needsConfirm = amount >= policy.requireConfirmAboveUsd;
  return { ok: true, remainingUsd: remaining - amount, needsConfirm };
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
  if (!isAddr(address)) return { error: 'BAD_ADDRESS' };
  const policy = loadPolicy();
  const next = address.trim();
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
