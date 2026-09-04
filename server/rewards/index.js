/**
 * FBT REWARDS — HTTP API (/api/v1/rewards).
 * ---------------------------------------------------------------------------
 * API-FIRST: every dashboard number comes from here; the client store is only
 * the instant on-device ledger that feeds events in and renders while the
 * network is away.
 *
 * Endpoints
 *   POST /events                     — ingest real activity (idempotent)
 *   GET  /summary                    — the whole dashboard in one call
 *   GET  /missions                   — today's missions + milestones
 *   GET  /level                      — level state
 *   GET  /referral                   — code state for this account
 *   POST /referral/bind              — bind code → verified wallet/telegram
 *   GET  /eligibility                — claim eligibility
 *   POST /claim/prepare              — single-use nonce (when distributor live)
 *   POST /claim/simulate             — consume a nonce, replay-protected
 *
 * Security properties (spec §15):
 *   · identity = verified Telegram session when present, else the device
 *     scope header — the SAME scoping the goal engine uses; never a secret.
 *   · every POST is rate-limited per account.
 *   · every event is idempotent (one credit per fingerprint forever).
 *   · on-chain evidence is verified through server/chainIntel RPCs before
 *     money-moving actions are credited; failures are NEVER credited.
 *   · claim nonces are stored as hashes only, are single-use and expire.
 *   · the server holds no private key, signs nothing and broadcasts nothing.
 *
 * meta always reports storage durability so the UI can say when the ledger is
 * per-instance (preview) instead of implying a durable global record.
 */
import { Router } from 'express';
import * as kv from './store.js';
import * as engine from './engine.js';
import { verifyEvidence } from './verify.js';
import { CLAIM } from './config.js';
import { ownerFromRequest } from '../financialGoals.js';

export const REWARDS_SCHEMA = 'fbt.rewards.v1';
export const REWARDS_LIMITATIONS = Object.freeze([
  'Points are a reputation score on the FBT ledger — not a token balance, not money, not withdrawable.',
  'FBT is not an issued token; on-chain FBT balance, price and markets do not exist yet (FBT_MARKET = not_launched).',
  'Claim endpoints issue and simulate nonces only; broadcasting requires a deployed reward distributor contract (env FBT_REWARDS_DISTRIBUTOR_*).',
  'Ledger durability equals the existing KV store: durable on Vercel Blob when configured, per-instance otherwise.',
  'Wallet-controlled funds never touch this API: no private key, no custody, no broadcast.'
]);

const io = engine.ioDefault(kv);

/* --------------------------------- meta ---------------------------------- */

const meta = () => ({
  schema: REWARDS_SCHEMA,
  durable: kv.durable(),
  tables: [...kv.TABLES],
  limitations: [...REWARDS_LIMITATIONS]
});

const error = (res, code, status = 400) =>
  res.status(status).json({ ok: false, error: code, meta: meta() });

/* ------------------------- rate limiting (in-mem) ------------------------ */

const WINDOW_MS = 60_000;
const WRITE_MAX = Number(process.env.REWARDS_WRITE_RATE_LIMIT || 120);
const hits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, rec] of hits) if (now > rec.reset) hits.delete(key);
}, WINDOW_MS).unref?.();

function writeBudget(req) {
  const who = ownerFromRequest(req);
  const key = who.ok ? who.owner : req.ip || 'anon';
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now > rec.reset) {
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    return true;
  }
  rec.count += 1;
  return rec.count <= WRITE_MAX;
}

function identity(req, res) {
  const who = ownerFromRequest(req);
  if (!who.ok) {
    error(res, who.code);
    return null;
  }
  return who;
}

/* ------------------------------ the router ------------------------------- */

export function rewardsRouter() {
  const router = Router();

  /**
   * POST /events — ingest real activity.
   * Body: { events: [...] } (batch ≤ 25). Each event:
   *   { id?, action, at?, wallet?, chainId?, txHash?, refCode? }
   * Response rows per event: { credited | duplicate | capped } + points.
   */
  router.post('/events', async (req, res) => {
    if (!writeBudget(req)) {
      res.set('retry-after', '1');
      return error(res, 'REWARDS_RATE_LIMITED', 429);
    }
    const who = identity(req, res);
    if (!who) return undefined;

    const raw = Array.isArray(req.body?.events) ? req.body.events.slice(0, 25) : [];
    if (raw.length === 0) return error(res, 'EVENTS_REQUIRED');

    /* one account at a time: serialize read-modify-write per owner in-process */
    const out = await engine.ingestEvents({
      owner: who.owner,
      events: raw,
      io,
      now: Date.now(),
      verify: verifyEvidence,
      opts: {
        onReferralOpportunity: (ctx) => engine.referralOpportunity({ ...ctx, io })
      }
    });

    res.set('cache-control', 'private, no-store');
    return res.json({
      ok: true,
      data: {
        account: who.owner,
        points: out.ledger.points,
        results: out.results
      },
      meta: meta()
    });
  });

  /** GET /summary — everything the dashboard needs in one round-trip. */
  router.get('/summary', async (req, res) => {
    const who = identity(req, res);
    if (!who) return undefined;
    const summary = await engine.buildSummary({ owner: who.owner, io });
    res.set('cache-control', 'private, no-store');
    return res.json({ ok: true, data: summary, meta: meta() });
  });

  /** GET /missions */
  router.get('/missions', async (req, res) => {
    const who = identity(req, res);
    if (!who) return undefined;
    const ledger = await io.getLedger(who.owner);
    const day = engine.dayKey(Date.now());
    res.set('cache-control', 'private, no-store');
    return res.json({
      ok: true,
      data: {
        today: engine.dailyMissions(ledger, day),
        milestones: engine.milestoneMissions(ledger, day),
        achievements: engine.achievementsFor(ledger)
      },
      meta: meta()
    });
  });

  /** GET /level */
  router.get('/level', async (req, res) => {
    const who = identity(req, res);
    if (!who) return undefined;
    const ledger = await io.getLedger(who.owner);
    res.set('cache-control', 'private, no-store');
    return res.json({
      ok: true,
      data: { points: ledger.points, ...engine.levelState(ledger.points) },
      meta: meta()
    });
  });

  /** GET /referral — this account's code state. */
  router.get('/referral', async (req, res) => {
    const who = identity(req, res);
    if (!who) return undefined;
    const ledger = await io.getLedger(who.owner);
    const bound = ledger.refCode ? await io.getRefcode(ledger.refCode) : null;
    res.set('cache-control', 'private, no-store');
    return res.json({
      ok: true,
      data: {
        code: ledger.refCode || null,
        bound: Boolean(bound),
        boundVia: bound?.via || null,
        boundWallet: bound?.wallet || null,
        owner: who.owner,
        total: Number(ledger.referrals || 0)
      },
      meta: meta()
    });
  });

  /**
   * POST /referral/bind — bind this account's code to a wallet (EVM
   * signature) or to the verified Telegram session. One code per owner.
   * Telegram binding needs no signature (session is already verified).
   */
  router.post('/referral/bind', async (req, res) => {
    if (!writeBudget(req)) {
      res.set('retry-after', '1');
      return error(res, 'REWARDS_RATE_LIMITED', 429);
    }
    const who = identity(req, res);
    if (!who) return undefined;
    const { code, wallet, signature, message } = req.body || {};
    const via = who.owner.startsWith('tg:')
      ? 'telegram'
      : (wallet && signature) ? 'wallet' : 'device';
    const result = await engine.bindCode({
      code: String(code || '').toUpperCase(),
      wallet: wallet || null,
      owner: who.owner,
      signature: signature || null,
      message: message || null,
      via,
      io
    });
    if (!result.ok) return error(res, result.code, result.code === 'CODE_TAKEN' ? 409 : 400);
    res.set('cache-control', 'private, no-store');
    return res.json({ ok: true, data: { code: result.code, bound: true, via }, meta: meta() });
  });

  /** GET /eligibility — what can be claimed today (honest). */
  router.get('/eligibility', async (req, res) => {
    const who = identity(req, res);
    if (!who) return undefined;
    const ledger = await io.getLedger(who.owner);
    const claim = engine.claimStatus(ledger);
    res.set('cache-control', 'private, no-store');
    return res.json({
      ok: true,
      data: {
        claim,
        walletRequired: CLAIM.distributorAddress ? true : false,
        points: ledger.points
      },
      meta: meta()
    });
  });

  /** POST /claim/prepare — single-use nonce for a future distributor claim. */
  router.post('/claim/prepare', async (req, res) => {
    if (!writeBudget(req)) {
      res.set('retry-after', '1');
      return error(res, 'REWARDS_RATE_LIMITED', 429);
    }
    const who = identity(req, res);
    if (!who) return undefined;
    const wallet = String(req.body?.wallet || '');
    const result = await engine.prepareClaim({ owner: who.owner, wallet, io });
    if (!result.ok) return error(res, result.code, result.code === 'FBT_TOKEN_NOT_LAUNCHED' ? 409 : 400);
    res.set('cache-control', 'private, no-store');
    return res.json({ ok: true, data: result.claim, meta: meta() });
  });

  /** POST /claim/simulate — validate + consume a nonce (replay-protected). */
  router.post('/claim/simulate', async (req, res) => {
    if (!writeBudget(req)) {
      res.set('retry-after', '1');
      return error(res, 'REWARDS_RATE_LIMITED', 429);
    }
    const who = identity(req, res);
    if (!who) return undefined;
    const wallet = String(req.body?.wallet || '');
    const nonce = String(req.body?.nonce || '');
    const result = await engine.simulateClaim({ owner: who.owner, wallet, nonce, io });
    if (!result.ok) return error(res, result.code);
    res.set('cache-control', 'private, no-store');
    return res.json({ ok: true, data: result.simulated, meta: meta() });
  });

  return router;
}

export default rewardsRouter;
