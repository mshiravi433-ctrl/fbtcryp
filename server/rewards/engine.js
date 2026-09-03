/**
 * FBT REWARDS ENGINE — the pure rules core.
 * ---------------------------------------------------------------------------
 * API-FIRST · ON-CHAIN-FIRST · LOW STORAGE · NON-CUSTODIAL.
 *
 * The engine owns:
 *   · idempotent event ingestion (one credit per fingerprint)
 *   · verification of on-chain evidence through the existing RPC layer
 *   · level / missions / achievements derivation from ledger counters
 *   · referral code binding (wallet-signature verified) and attribution
 *   · claim preparation / simulation with single-use nonces (dormant until a
 *     distributor contract is configured — never a fake claim)
 *
 * Everything is a function of (config + ledger + seen-set + now). Storage is
 * injected through `io`, so the same rules run under the real KV store and
 * under a memory store in the test probes.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  ACTIONS, LEVELS, MISSIONS, ACHIEVEMENTS, REFERRAL, CLAIM, FBT,
  canonicalAction, levelFor
} from './config.js';

/* -------------------------------------------------------------------------- */
/* small pure helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Local calendar day key (YYYYMMDD, stable across DST like dailyRewards.js). */
export function dayKey(at = Date.now()) {
  const d = new Date(Number(at));
  if (!Number.isFinite(d.getTime())) return null;
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export const isEvmAddress = (a) => /^0x[a-fA-F0-9]{40}$/.test(String(a || ''));
export const isTxHash = (h) => /^0x[a-fA-F0-9]{64}$/.test(String(h || ''));
export const isSolSignature = (s) => /^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(String(s || ''));

export const normWallet = (w) => {
  const s = String(w || '').trim();
  return /^0x/i.test(s) ? s.toLowerCase() : s; // base58 (Solana) is case-sensitive: never lower-case it
};
export const normCode = (c) => String(c || '').trim().toUpperCase();
const CODE_RE = /^[A-Z0-9_-]{4,32}$/;
export const isValidCode = (c) => CODE_RE.test(String(c || '').trim());
const EVENT_ID_RE = /^[A-Za-z0-9._:-]{4,96}$/;
export const isValidEventId = (id) => EVENT_ID_RE.test(String(id || ''));

/** A per-account + per-event fingerprint: duplicate protection. */
export function eventFingerprint(owner, ev) {
  const wallet = normWallet(ev.wallet);
  const tx = String(ev.txHash || '').trim().toLowerCase();
  if (tx && (isTxHash(tx) || isSolSignature(tx))) {
    return `tx:${String(ev.chainId || '')}:${tx}:${wallet || '*'}`;
  }
  const id = isValidEventId(ev.id) ? String(ev.id) : `auto:${ev.action}:${ev.at ?? Date.now()}`;
  return `id:${owner}:${id}`;
}

/* -------------------------------------------------------------------------- */
/* configurable level table                                                    */
/* -------------------------------------------------------------------------- */

export { levelFor };

export function levelState(points, levels = LEVELS) {
  const { level, next, progress } = levelFor(points, levels);
  return {
    current: { id: level.id, index: level.index, min: level.min, nameKey: `rank.tier.${level.id}` },
    next: next ? { id: next.id, index: next.index, min: next.min, nameKey: `rank.tier.${next.id}` } : null,
    progress,
    toNext: next ? Math.max(0, next.min - points) : 0,
    maxed: !next
  };
}

/* -------------------------------------------------------------------------- */
/* mission / achievement derivation                                            */
/* -------------------------------------------------------------------------- */

function countFor(ledger, action, day) {
  return Number(ledger?.days?.[day]?.[action] || 0);
}

/** A mission's current progress value, read from the ledger. */
export function missionProgressValue(mission, ledger, day) {
  if (mission.scope === 'day') {
    return mission.actions.reduce((sum, a) => sum + countFor(ledger, a, day), 0);
  }
  if (mission.scope === 'ever') {
    return mission.actions.reduce((sum, a) => sum + Number(ledger?.firsts?.[a] != null ? 1 : 0), 0);
  }
  if (mission.scope === 'streak') {
    return Number(ledger?.streak?.count || 0);
  }
  return 0;
}

/** Missions for one day — derived, never invented; not-live actions excluded. */
export function dailyMissions(ledger, day, now = Date.now()) {
  const live = new Set(Object.entries(ACTIONS).filter(([, def]) => def.live !== false).map(([k]) => k));
  return MISSIONS
    .filter((m) => m.scope === 'day' && m.actions.some((a) => live.has(a)))
    .map((m) => {
      const progress = missionProgressValue(m, ledger, day);
      const done = ledger?.missionsDone?.[m.id] === day;
      return {
        id: m.id,
        target: m.target,
        progress: Math.min(progress, m.target),
        pts: m.pts,
        done,
        claimed: done
      };
    });
}

/** Milestone missions (ever) + streak missions. */
export function milestoneMissions(ledger, day) {
  const out = [];
  for (const m of MISSIONS) {
    if (m.scope === 'ever') {
      const progress = missionProgressValue(m, ledger, day);
      out.push({
        id: m.id, target: m.target, progress: Math.min(progress, m.target),
        pts: m.pts, done: ledger?.missionsDone?.[m.id] === 'ever'
      });
    }
  }
  for (const m of MISSIONS) {
    if (m.scope === 'streak') {
      const progress = Number(ledger?.streak?.count || 0);
      out.push({
        id: m.id, target: m.target, progress: Math.min(progress, m.target),
        pts: m.pts, done: ledger?.missionsDone?.[m.id] === m.id
      });
    }
  }
  return out;
}

export function achievementsFor(ledger) {
  const by = ledger?.byAction || {};
  const count = (a) => Number(by[a]?.count || 0);
  return ACHIEVEMENTS
    .filter((a) => {
      const def = ACTIONS[a.action];
      return !def || def.live !== false; // an achievement for a dormant action is never advertised
    })
    .map((a) => ({
      id: a.id,
      label: a.label,
      icon: a.icon,
      done: a.action === 'streak3'
        ? (ledger?.streak?.count || 0) >= 3
        : a.action === 'streak7'
          ? (ledger?.streak?.count || 0) >= 7
          : count(a.action) >= a.min
    }));
}

/* -------------------------------------------------------------------------- */
/* ingestion                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Validate one incoming event (shape only). Returns { ok, error?, clean }.
 */
export function validateEvent(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'BAD_EVENT' };
  const action = canonicalAction(raw.action);
  if (!action) return { ok: false, error: 'UNKNOWN_ACTION' };
  const ev = {
    id: String(raw.id || ''),
    action,
    reportedAction: String(raw.action || ''),
    at: Number(raw.at) || Date.now(),
    wallet: normWallet(raw.wallet),
    chainId: raw.chainId != null ? Number(raw.chainId) : null,
    txHash: String(raw.txHash || raw.signature || '').trim(),
    refCode: raw.refCode ? String(raw.refCode).trim().toUpperCase() : null,
    device: String(raw.device || ''),
    amount: Number(raw.amount) > 0 ? Number(raw.amount) : null
  };
  if (ev.id && !isValidEventId(ev.id)) return { ok: false, error: 'BAD_EVENT_ID' };
  if (ev.refCode && !isValidCode(ev.refCode)) return { ok: false, error: 'BAD_REF_CODE' };
  const def = ACTIONS[action];
  if (ev.txHash && def.verify === 'none') ev.txHash = ''; // not needed; never trusted for these
  return { ok: true, clean: ev };
}

/** Fill event.id when the client did not send one (deterministic for tx). */
export function ensureEventId(owner, ev) {
  if (isValidEventId(ev.id)) return ev;
  if (ev.txHash) return { ...ev, id: `tx-${String(ev.chainId || '')}-${ev.txHash.toLowerCase().slice(0, 24)}` };
  return { ...ev, id: `r-${createHash('sha256').update(`${owner}|${ev.action}|${ev.at}|${ev.wallet}`).digest('hex').slice(0, 20)}` };
}

/**
 * Verify on-chain evidence. `verify` is injected (defaults in verify.js);
 * returns { ok:true, source } or { ok:false, code }.
 */
async function verifyEvidence(ev, verify) {
  const def = ACTIONS[ev.action];
  if (def.verify === 'none') return { ok: true, source: 'none' };
  if (!ev.txHash) {
    return def.verify === 'lenient' && def.requiresWallet !== true
      ? { ok: true, source: 'no-evidence-lenient' }
      : { ok: false, code: 'EVIDENCE_REQUIRED' };
  }
  if (!verify) return { ok: false, code: 'VERIFIER_UNAVAILABLE' };
  return verify(ev);
}

/**
 * Ingest a batch of events for one account.
 *
 * Returns one row per event; a duplicate (same fingerprint) is reported as
 * `duplicate: true` and NEVER re-credits. Only rows that changed the ledger
 * return `credited: true` with the points that landed.
 */
export async function ingestEvents({ owner, events, io, now = Date.now(), verify = null, opts = {} }) {
  const results = [];
  let ledger = await io.getLedger(owner);
  let mutated = false;
  const day = dayKey(now);
  const seen = await io.getSeen(owner);
  const freshSeen = [];

  for (const raw of events || []) {
    const v = validateEvent(raw);
    if (!v.ok) {
      results.push({ ok: false, code: v.error, action: raw?.action ?? null });
      continue;
    }
    let ev = v.clean;
    ev = ensureEventId(owner, ev);

    const fingerprint = eventFingerprint(owner, ev);
    if (seen.some((r) => r.k === fingerprint)) {
      results.push({ ok: true, duplicate: true, action: ev.action, eventId: ev.id });
      continue;
    }

    /* daily cap — counted on the LOCAL DAY THE ACTIVITY HAPPENED, so a late
       replay of an old event can never fill today's budget */
    const def = ACTIONS[ev.action];
    const evDay = dayKey(Number.isFinite(ev.at) ? ev.at : now);
    if (def.dailyCap && Number(ledger.days?.[evDay]?.[ev.action] || 0) >= def.dailyCap) {
      results.push({ ok: true, capped: true, action: ev.action, eventId: ev.id });
      continue;
    }
    /* once-ever */
    if (def.once && ledger.firsts?.[ev.action] != null) {
      results.push({ ok: true, duplicate: true, reason: 'once', action: ev.action, eventId: ev.id });
      continue;
    }

    /* evidence */
    const ver = await verifyEvidence(ev, verify);
    if (!ver.ok) {
      results.push({ ok: false, code: ver.code || 'VERIFY_FAILED', action: ev.action, eventId: ev.id });
      continue;
    }

    /* commit */
    const at = Number.isFinite(ev.at) ? ev.at : now;
    if (!ledger.created) ledger.created = at;
    ledger.updated = at;
    ledger.points += def.points;
    ledger.byAction[ev.action] = ledger.byAction[ev.action] || { count: 0, points: 0 };
    ledger.byAction[ev.action].count += 1;
    ledger.byAction[ev.action].points += def.points;
    if (ledger.firsts[ev.action] == null) ledger.firsts[ev.action] = at;
    ledger.days[evDay] = ledger.days[evDay] || {};
    ledger.days[evDay][ev.action] = (ledger.days[evDay][ev.action] || 0) + 1;

    /* streak for daily check-in */
    if (ev.action === 'dailyCheckin') {
      const last = ledger.streak?.lastDay;
      const yesterday = dayKey(at - 86400_000);
      if (last !== evDay) {
        ledger.streak = {
          lastDay: evDay,
          count: last === yesterday ? (ledger.streak?.count || 0) + 1 : 1
        };
      }
    }

    recordCredit(ledger, { id: ev.id, action: ev.action, pts: def.points, at, evidence: ver.source });

    /* mission completions that this event may have caused */
    const missionBonuses = [];
    for (const m of MISSIONS) {
      if (m.scope === 'day' && ledger.missionsDone[m.id] === day) continue;
      if (m.scope === 'ever' && ledger.missionsDone[m.id] === 'ever') continue;
      if (m.scope === 'streak' && ledger.missionsDone[m.id] === m.id) continue;
      const touches = m.scope === 'streak'
        ? ev.action === 'dailyCheckin' && missionProgressValue(m, ledger, day) >= m.target
        : m.actions.includes(ev.action) && missionProgressValue(m, ledger, day) >= m.target;
      if (!touches) continue;
      ledger.missionsDone[m.id] = m.scope === 'day' ? day : m.scope === 'ever' ? 'ever' : m.id;
      if (m.pts > 0) {
        ledger.points += m.pts;
        recordCredit(ledger, { id: `mission:${m.id}`, action: `mission:${m.id}`, pts: m.pts, at });
        missionBonuses.push({ missionId: m.id, pts: m.pts });
      }
    }

    /* referral attribution (see referralCredit below) */
    let referralResult = null;
    if (opts?.onReferralOpportunity) {
      referralResult = await opts.onReferralOpportunity({ owner, ev, ledger, at, day });
    }

    freshSeen.push({ k: fingerprint, at });
    mutated = true;
    results.push({ ok: true, credited: true, action: ev.action, eventId: ev.id, pts: def.points, missionBonuses, referral: referralResult });
  }

  if (mutated) {
    /* prune old day keys — the ledger can never grow unbounded */
    const dayKeys = Object.keys(ledger.days || {}).sort();
    for (const k of dayKeys.slice(0, -DAYS_RETAINED)) delete ledger.days[k];
    await io.saveLedger(owner, ledger);
    const combined = [...seen, ...freshSeen];
    if (combined.length) {
      combined.sort((a, b) => (a.at || 0) - (b.at || 0));
      await io.saveSeen(owner, combined.slice(-SEEN_CAP));
    }
  }
  return { results, ledger };
}

const DAYS_RETAINED = 45;
const SEEN_CAP = 300;

function recordCredit(ledger, entry) {
  const rows = ledger.history || [];
  rows.unshift({
    id: entry.id || null,
    action: entry.action,
    pts: entry.pts,
    at: entry.at,
    evidence: entry.evidence || null
  });
  ledger.history = rows.slice(0, 25);
}

/* -------------------------------------------------------------------------- */
/* summary                                                                     */
/* -------------------------------------------------------------------------- */

export async function buildSummary({ owner, io, now = Date.now(), opts = {} }) {
  const ledger = await io.getLedger(owner);
  const day = dayKey(now);
  const level = levelState(ledger.points, opts.levels || LEVELS);
  const missions = dailyMissions(ledger, day, now);
  const milestones = milestoneMissions(ledger, day);
  const achievements = achievementsFor(ledger);

  return {
    account: { kind: owner.startsWith('tg:') ? 'telegram' : 'device', owner },
    points: ledger.points,
    fbt: {
      balance: ledger.points, // 1 point = 1 FBT (loyalty ledger, no token)
      tokenLaunched: FBT.tokenLaunched,
      market: FBT.tokenLaunched ? 'live' : 'not_launched'
    },
    level,
    rank: { available: false, reason: 'NO_GLOBAL_LEADERBOARD' },
    streak: ledger.streak || { lastDay: null, count: 0 },
    referrals: {
      total: Number(ledger.referrals || 0),
      code: ledger.refCode || null,
      codeLive: Boolean(ledger.refCode)
    },
    missions: { today: missions, milestones },
    achievements,
    history: (ledger.history || []).slice(0, 20),
    claim: claimStatus(ledger, opts.levels),
    utilities: utilityStatus(),
    updated: ledger.updated || null
  };
}

/** Claim surface (spec §11). Honest at every layer. */
export function claimStatus(ledger, cfg = CLAIM) {
  const launched = Boolean(cfg.distributorChain && cfg.distributorAddress && cfg.tokenAddress);
  if (!launched) {
    return {
      status: 'NOT_LAUNCHED',
      code: 'FBT_TOKEN_NOT_LAUNCHED',
      claimable: false,
      eligible: false,
      reason: 'FBT_TOKEN_NOT_LAUNCHED'
    };
  }
  return {
    status: 'READY',
    claimable: true,
    eligible: Number(ledger.points) > 0,
    distributorChain: cfg.distributorChain,
    distributorAddress: cfg.distributorAddress,
    tokenAddress: cfg.tokenAddress,
    balance: Number(ledger.points)
  };
}

/** FBT utility rows — each rendered only when the backend truly runs it. */
export function utilityStatus() {
  return [
    {
      id: 'feeDiscount',
      launched: false,
      code: 'NOT_LAUNCHED',
      reason: 'swap fee discount not wired into the live swap router yet (see src/lib/fbt.js)'
    },
    { id: 'rewardBoost', launched: false, code: 'NOT_LAUNCHED' },
    { id: 'referralBoost', launched: false, code: 'NOT_LAUNCHED' },
    { id: 'premium', launched: false, code: 'NOT_LAUNCHED' }
  ];
}

/* -------------------------------------------------------------------------- */
/* referral (spec §7)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Bind a referral code to a wallet. The wallet must prove ownership:
 * `signature` over `message` (personal_sign / EIP-191) is recovered with
 * ethers.verifyMessage and must equal the wallet. Telegram-bound accounts can
 * bind through their verified session (via='telegram', no signature needed).
 */
export async function bindCode({ code, wallet, owner, signature = null, message = null, via = 'telegram', io, now = Date.now() }) {
  if (!isValidCode(code)) return { ok: false, code: 'BAD_REF_CODE' };
  const existing = await io.getRefcode(code);
  if (existing && existing.owner !== owner) return { ok: false, code: 'CODE_TAKEN' };
  if (existing) return { ok: true, duplicate: true, code, owner: existing.owner };

  if (via === 'telegram') {
    if (!owner.startsWith('tg:')) return { ok: false, code: 'TELEGRAM_OWNER_REQUIRED' };
  } else {
    if (!isEvmAddress(wallet)) return { ok: false, code: 'WALLET_REQUIRED' };
    if (!message || !signature) return { ok: false, code: 'SIGNATURE_REQUIRED' };
    const expected = `${REFERRAL.bindMessagePrefix} ${code} for ${normWallet(wallet)}`;
    if (message !== expected) return { ok: false, code: 'BAD_BIND_MESSAGE' };
    let recovered = null;
    try {
      const { verifyMessage } = await import('ethers');
      recovered = normWallet(verifyMessage(message, signature));
    } catch {
      return { ok: false, code: 'SIGNATURE_VERIFY_FAILED' };
    }
    if (!recovered || recovered !== normWallet(wallet)) return { ok: false, code: 'SIGNATURE_MISMATCH' };
  }

  await io.bindRefcode({ code, owner, wallet: via === 'telegram' ? null : normWallet(wallet), via, at: now });
  /* credit ledger link so summary shows the live code */
  const ledger = await io.getLedger(owner);
  ledger.refCode = code;
  ledger.updated = now;
  await io.saveLedger(owner, ledger);
  return { ok: true, code, owner };
}

/**
 * Called during ingest when an event carries a refCode: the owner of the code
 * earns the referral reward once per NEW qualifying invitee wallet.
 */
export async function referralOpportunity({ owner, ev, ledger, at, day, io, now = at }) {
  const code = ev.refCode;
  if (!code) return null;
  if (!REFERRAL.qualifying.includes(ev.action)) return null;
  if (!isEvmAddress(ev.wallet) && !isSolSignature(ev.wallet) && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ev.wallet)) return null;
  const ref = await io.getRefcode(code);
  if (!ref) return null;

  const inviteeWallet = normWallet(ev.wallet);
  /* self-referral: same wallet or same account */
  if (ref.owner === owner) return { skipped: 'self' };
  if (REFERRAL.rejectSelfWallet && ref.wallet === inviteeWallet) return { skipped: 'self-wallet' };
  /* farm: same device already attributed this code */
  const attrs = await io.getRefattr(code);
  if (attrs.some((r) => r.wallet === inviteeWallet)) return { skipped: 'duplicate-wallet' };
  /* daily cap per code */
  const todayCount = attrs.filter((r) => dayKey(r.at) === day).length;
  if (todayCount >= REFERRAL.maxPerCodePerDay) return { skipped: 'daily-cap' };
  if (attrs.length >= REFERRAL.maxAttributedPerCode) return { skipped: 'total-cap' };

  await io.addRefattr(code, inviteeWallet, at);

  /* credit the referrer's ledger */
  const refLedger = await io.getLedger(ref.owner);
  const def = ACTIONS.referral;
  refLedger.points += def.points;
  refLedger.referrals = Number(refLedger.referrals || 0) + 1;
  refLedger.byAction.referral = refLedger.byAction.referral || { count: 0, points: 0 };
  refLedger.byAction.referral.count += 1;
  refLedger.byAction.referral.points += def.points;
  if (refLedger.firsts.referral == null) refLedger.firsts.referral = at;
  recordCredit(refLedger, { id: `ref:${code}:${inviteeWallet.slice(0, 12)}`, action: 'referral', pts: def.points, at, evidence: 'attributed' });
  if (refLedger.missionsDone.referralEver == null) {
    refLedger.missionsDone.referralEver = 'ever';
    for (const m of MISSIONS) {
      if (m.id === 'referralEver' && m.pts > 0) {
        refLedger.points += m.pts;
        recordCredit(refLedger, { id: 'mission:referralEver', action: 'mission:referralEver', pts: m.pts, at });
      }
    }
  }
  refLedger.updated = at;
  await io.saveLedger(ref.owner, refLedger);
  return { credited: true, owner: ref.owner, code, wallet: inviteeWallet };
}

/* -------------------------------------------------------------------------- */
/* claim (spec §11) — nonce issuance + simulation. Broadcast happens in the    */
/* user's wallet against a real distributor contract when one is configured.   */
/* -------------------------------------------------------------------------- */

function nonceHash(nonce) {
  return createHash('sha256').update(String(nonce)).digest('hex');
}

export async function prepareClaim({ owner, wallet, io, now = Date.now(), claimCfg = CLAIM }) {
  const status = claimStatus(await io.getLedger(owner), claimCfg);
  if (status.status !== 'READY') return { ok: false, code: status.code, claim: status };
  if (!isEvmAddress(wallet)) return { ok: false, code: 'WALLET_REQUIRED' };

  const nonce = randomBytes(24).toString('hex');
  const expiresAt = now + CLAIM.nonceTtlMs;
  const pending = await io.getPendingNonces ? await io.getPendingNonces(owner) : null;

  /* bounded pending-nonce set (server keeps only the HASH) */
  const list = pending || [];
  list.push({ h: nonceHash(`${owner}|${nonce}`), exp: expiresAt });
  const fresh = list
    .filter((n) => n.exp > now)
    .slice(-CLAIM.maxPendingNonces);
  if (io.savePendingNonces) await io.savePendingNonces(owner, fresh);

  return {
    ok: true,
    claim: {
      claimId: createHash('sha256').update(`${owner}|${nonce}`).digest('hex').slice(0, 24),
      nonce, // returned to the client so the USER can sign it
      expiresAt,
      message: `FBT Rewards claim ${nonce.slice(0, 12)} for ${normWallet(wallet)}`,
      chainId: CLAIM.distributorChain,
      distributor: CLAIM.distributorAddress,
      token: CLAIM.tokenAddress,
      amount: status.balance,
      custodial: false,
      nextStep: 'SIGN_IN_WALLET_THEN_BROADCAST'
    }
  };
}

export async function simulateClaim({ owner, wallet, nonce, io, now = Date.now(), claimCfg = CLAIM }) {
  const status = claimStatus(await io.getLedger(owner), claimCfg);
  if (status.status !== 'READY') return { ok: false, code: status.code };
  if (!isEvmAddress(wallet) || !nonce || !/^[0-9a-f]{48}$/.test(String(nonce))) {
    return { ok: false, code: 'BAD_NONCE' };
  }
  const pending = (await io.getPendingNonces ? await io.getPendingNonces(owner) : []) || [];
  const hit = pending.find((n) => n.exp > now && safeEqualHex(n.h, nonceHash(`${owner}|${nonce}`)));
  if (!hit) return { ok: false, code: 'UNKNOWN_NONCE' };

  /* single-use: consuming the nonce here means a replayed simulate/prepare
     with the same nonce can never pass again (replay protection). */
  const fresh = pending.filter((n) => n !== hit);
  if (io.savePendingNonces) await io.savePendingNonces(owner, fresh);

  return {
    ok: true,
    simulated: {
      claimId: createHash('sha256').update(`${owner}|${nonce}`).digest('hex').slice(0, 24),
      wallet: normWallet(wallet),
      amount: status.balance,
      distributor: CLAIM.distributorAddress,
      chainId: CLAIM.distributorChain,
      replayProtected: true,
      custodial: false,
      nextStep: 'BROADCAST_REQUIRES_DISTRIBUTOR_CONTRACT'
    }
  };
}

function safeEqualHex(a, b) {
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* plumbing                                                                    */
/* -------------------------------------------------------------------------- */

export const ioDefault = (kv) => ({
  getLedger: (o) => kv.getLedger(o),
  saveLedger: (o, l) => kv.saveLedger(o, l),
  getSeen: (o) => kv.getSeen(o),
  saveSeen: (o, s) => kv.saveSeen(o, s),
  getRefcode: (c) => kv.getRefcode(c),
  bindRefcode: (x) => kv.bindRefcode(x),
  getRefbind: (w) => kv.getRefbind(w),
  getRefattr: (c) => kv.getRefattr(c),
  addRefattr: (c, w, at) => kv.addRefattr(c, w, at),
  getPendingNonces: (o) => kv.getPendingNonces ? kv.getPendingNonces(o) : Promise.resolve([]),
  savePendingNonces: (o, n) => kv.savePendingNonces ? kv.savePendingNonces(o, n) : Promise.resolve(n)
});
